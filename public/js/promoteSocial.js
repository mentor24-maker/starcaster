window.App = window.App || {};

App.promoteSocial = (function () {
  const { api, notify, state } = App;
  const SOCIAL_TEXT_LIMIT = 280;
  const PROJECT_URL_FIELDS = ['website', 'projectUrl', 'project_url', 'siteUrl', 'site_url', 'url', 'domain', 'canonicalUrl', 'canonical_url'];

  let campaigns = [];
  let posts = [];
  let assetsForThumbs = [];
  let activeProject = null;

  function el(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  async function promoteSocialApi(path, options) {
    const promotePath = String(path || '');
    try {
      return await api(promotePath, options);
    } catch (err) {
      const message = safeText(err?.message);
      const canFallback = promotePath.startsWith('/api/promote/social')
        && /route not found|not_found|404/i.test(message);
      if (!canFallback) throw err;
      return api(promotePath.replace('/api/promote/social', '/api/engage/social'), options);
    }
  }

  function parseConfig(campaign) {
    try {
      const parsed = JSON.parse(String(campaign?.content || '{}'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function campaignChannel(campaign, config = parseConfig(campaign)) {
    const desired = safeText(config.channelId);
    if (!desired) return null;
    const channels = Array.isArray(state.channels) ? state.channels : [];
    return channels.find((channel) => String(channel.id) === desired) || null;
  }

  function channelPlatform(channel) {
    return safeText(channel?.channel || channel?.name).toLowerCase();
  }

  function channelAccount(channel) {
    return safeText(channel?.userName || channel?.handle || channel?.displayName || channel?.email);
  }

  function bufferPlatformKey(platform) {
    const key = safeText(platform).toLowerCase();
    if (key === 'x' || key === 'twitter') return 'x';
    if (key === 'tiktok' || key === 'tik tok') return 'tiktok';
    return key;
  }

  function normalizeDeliveryPlatform(channel) {
    const key = channelPlatform(channel);
    if (key === 'facebook personal' || key === 'facebook_personal') return 'facebook_personal';
    return bufferPlatformKey(key);
  }

  function socialTextLimitForPublisher(publisher) {
    const key = safeText(publisher).toLowerCase();
    if (key === 'facebook_personal' || key === 'facebook') return 63206;
    return SOCIAL_TEXT_LIMIT;
  }

  function socialDeliveryForCampaign(campaign, config = parseConfig(campaign)) {
    const selectedChannel = campaignChannel(campaign, config);
    if (safeText(config.channelId) && !selectedChannel) {
      return {
        publisher: '',
        missingChannel: true,
        starcasterChannelId: safeText(config.channelId),
        targetPlatform: '',
        targetAccount: '',
        openclawProfile: '',
      };
    }
    const platform = normalizeDeliveryPlatform(selectedChannel);
    const account = channelAccount(selectedChannel);
    // Buffer routing is disabled — every platform publishes directly through
    // its own API. X uses the direct X API (default return below). TikTok has
    // no direct client yet, so TikTok campaigns will fail at publish until one
    // exists; that is intentional while the Buffer path is out of service.
    if (platform === 'facebook_personal') {
      return {
        publisher: 'facebook_personal',
        starcasterChannelId: safeText(selectedChannel?.id || config.channelId),
        targetPlatform: 'facebook_personal',
        targetAccount: account,
        openclawProfile: safeText(selectedChannel?.openclawProfile),
      };
    }
    return {
      publisher: platform || 'x',
      starcasterChannelId: safeText(selectedChannel?.id || config.channelId),
      targetPlatform: platform,
      targetAccount: account,
      openclawProfile: '',
    };
  }

  function normalizeProjectUrl(value) {
    const raw = safeText(value);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(raw)) return `https://${raw}`;
    return '';
  }

  function campaignProjectUrl() {
    const projectUrl = PROJECT_URL_FIELDS
      .map((field) => normalizeProjectUrl(activeProject?.[field]))
      .find(Boolean);
    return projectUrl || '';
  }

  function updateScheduleTimezoneHint() {
    const hint = el('promoteSocialScheduleTzHint');
    if (!hint) return;
    const tz = safeText(activeProject?.timezone) || 'UTC';
    hint.textContent = `Date and time are interpreted in the active project timezone (${tz}). Change it under Settings → Projects → Schedule Timezone.`;
  }

  async function ensurePromoteSocialProjectContext() {
    try {
      const current = await api('/api/projects/current', { method: 'GET' });
      const project = current.project || current.currentProject || current.data?.project || null;
      if (project?.id) {
        activeProject = project;
        state.currentProject = project;
        state.currentProjectId = safeText(project.id);
      }
    } catch (_) {}
    if (!activeProject && state.currentProject?.id) activeProject = state.currentProject;
  }

  function buildSocialText(campaign) {
    const config = parseConfig(campaign);
    // composeExcludedFieldIds covers both user-deleted rows and rows the channel
    // profile hides; older campaigns only recorded the user-deleted ones.
    const excludedIds = Array.isArray(config.composeExcludedFieldIds)
      ? config.composeExcludedFieldIds
      : config.hiddenContentFieldIds;
    const excluded = new Set(Array.isArray(excludedIds) ? excludedIds : []);
    const delivery = socialDeliveryForCampaign(campaign, config);
    const platform = safeText(delivery.targetPlatform).toLowerCase();
    const isFacebookChannel = platform === 'facebook' || platform === 'facebook_personal';
    const usesPostCopy = !excluded.has('campaignPostSelect')
      && (isFacebookChannel || excluded.has('campaignTweetSelect'));
    const primaryCopy = usesPostCopy
      ? config.postLabel
      : (excluded.has('campaignTweetSelect') ? '' : config.tweetLabel);
    // A selected Post's own URL (captured into config.postUrl) wins over the generic
    // project Website URL; fall back to the project URL when the Post has none.
    const postOwnUrl = usesPostCopy ? normalizeProjectUrl(config.postUrl) : '';
    const preview = App.composeXPost.composePost({
      primaryCopy,
      tagline: excluded.has('campaignTaglineSelect') ? '' : config.taglineLabel,
      cta: excluded.has('campaignCtaSelect') ? '' : config.ctaLabel,
      hashtags: excluded.has('campaignHashtagGroupSelect')
        ? []
        : (config.hashtagsText || config.hashtagGroupLabel),
      shareUrl: postOwnUrl || campaignProjectUrl(),
      projectUrl: campaignProjectUrl(),
      limit: socialTextLimitForPublisher(delivery.publisher),
      shortenUrls: platform === 'x',
    });
    return {
      text: preview.text,
      count: preview.count,
      limit: preview.limit,
      config,
      shareUrl: preview.shareUrl,
      urlMissingFromText: Boolean(preview.shareUrl) && !preview.urlIncluded,
    };
  }

  function formatDate(value) {
    const raw = safeText(value);
    if (!raw) return '-';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString();
  }

  function statusClass(status) {
    const value = safeText(status).toLowerCase();
    if (value === 'published') return 'status-social-published';
    if (value === 'failed') return 'status-social-failed';
    if (value === 'scheduled') return 'status-social-scheduled';
    if (value === 'publishing') return 'status-social-publishing';
    if (value === 'queued') return 'status-social-queued';
    if (value === 'awaiting_approval') return 'status-social-awaiting';
    return 'status-social-scheduled';
  }

  function formatPlatformLabel(channel) {
    const key = safeText(channel).toLowerCase();
    if (key === 'facebook_personal') return 'Facebook Personal';
    if (key === 'facebook') return 'Facebook Page';
    return safeText(channel).toUpperCase() || 'X';
  }

  // Token guards against an in-flight Facebook status lookup overwriting the
  // destination line after the user has already switched campaigns.
  let destinationRenderToken = 0;

  async function renderDestination() {
    const elDest = el('promoteSocialDestination');
    if (!elDest) return;
    const token = ++destinationRenderToken;
    const campaign = getSelectedCampaign();
    if (!campaign) { elDest.textContent = ''; return; }

    const delivery = socialDeliveryForCampaign(campaign, parseConfig(campaign));
    if (delivery.missingChannel) {
      elDest.textContent = 'Destination: campaign channel not loaded yet — refresh and try again.';
      return;
    }
    const platform = safeText(delivery.targetPlatform).toLowerCase();
    if (!platform) {
      elDest.textContent = 'Destination: no channel set on this campaign. Pick one in Campaign assembly.';
      return;
    }
    const label = formatPlatformLabel(delivery.publisher);

    if (delivery.publisher === 'facebook') {
      elDest.textContent = `Destination: ${label} — checking connected Page…`;
      try {
        const status = await promoteSocialApi('/api/promote/social/facebook/status');
        if (token !== destinationRenderToken) return;
        if (status && status.configured) {
          const page = safeText(status.pageName) || 'connected Page';
          elDest.textContent = `Destination: ${label} — ${page}`;
        } else {
          elDest.textContent = `Destination: ${label} — no Page connected. Connect one in Settings → APIs → Meta before sending.`;
        }
      } catch (_) {
        if (token !== destinationRenderToken) return;
        elDest.textContent = `Destination: ${label} (could not verify the connected Page)`;
      }
      return;
    }

    const account = safeText(delivery.targetAccount);
    elDest.textContent = account ? `Destination: ${label} — ${account}` : `Destination: ${label}`;
  }

  function openPostPreviewModal(post, previewPayload) {
    const modal = el('promoteSocialPostFailureModal');
    const title = el('promoteSocialPostFailureTitle');
    const meta = el('promoteSocialPostFailureMeta');
    const body = el('promoteSocialPostFailureBody');
    if (!modal || !body) return;
    if (title) title.textContent = 'Facebook Personal Preview';
    if (meta) {
      meta.textContent = `${formatPlatformLabel(post?.channel)} · Job ${safeText(previewPayload?.openclawJobId || post?.diagnostics?.openclawJobId) || 'pending'}`;
    }
    body.textContent = JSON.stringify(previewPayload || post?.diagnostics || {}, null, 2);
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  async function reviewFacebookPersonalPreview(post) {
    const res = await promoteSocialApi(
      `/api/promote/social/posts/${encodeURIComponent(post.id)}/facebook-personal/preview`
    );
    const preview = res?.preview || res?.data?.preview || res || {};
    openPostPreviewModal(post, preview);
  }

  async function approveFacebookPersonalPost(post) {
    if (!confirm('Approve this Facebook Personal preview and publish the post?')) return;
    await promoteSocialApi(
      `/api/promote/social/posts/${encodeURIComponent(post.id)}/facebook-personal/approve`,
      { method: 'POST' }
    );
    notify('Facebook Personal post approved and published');
    await refresh();
  }

  function formatDiagnosticsText(diag) {
    if (!diag || typeof diag !== 'object') return '';
    const parts = [];
    if (diag.publishMode) parts.push(`mode: ${diag.publishMode}`);
    if (diag.credentialSources) {
      const src = Object.entries(diag.credentialSources).map(([k, v]) => `${k}=${v}`).join(', ');
      if (src) parts.push(`creds: ${src}`);
    }
    if (diag.cronCredentialSources) {
      const src = Object.entries(diag.cronCredentialSources).map(([k, v]) => `${k}=${v}`).join(', ');
      if (src) parts.push(`cron creds: ${src}`);
    }
    if (diag.mediaUpload?.error) parts.push(`media: ${diag.mediaUpload.error}`);
    if (safeText(diag.videoUrl)) parts.push(`video: ${diag.videoUrl}`);
    if (safeText(diag.primaryVideoId)) parts.push(`asset: ${diag.primaryVideoId}`);
    if (diag.videoStaging && typeof diag.videoStaging === 'object') {
      const staged = safeText(diag.videoStaging.stagedUrl || diag.videoStaging.error);
      if (staged) parts.push(`staging: ${staged}`);
    }
    return parts.join('\n');
  }

  function buildPostFailureReport(post) {
    const lines = [];
    const err = safeText(post?.error);
    if (err) lines.push(err);
    const diagText = formatDiagnosticsText(post?.diagnostics);
    if (diagText) {
      if (lines.length) lines.push('');
      lines.push('Diagnostics:');
      lines.push(diagText);
    }
    if (!lines.length) return 'No error details were recorded for this post.';
    return lines.join('\n');
  }

  function openPostFailureModal(post) {
    const modal = el('promoteSocialPostFailureModal');
    const meta = el('promoteSocialPostFailureMeta');
    const body = el('promoteSocialPostFailureBody');
    if (!modal || !body) return;
    const platform = safeText(post?.channel).toUpperCase() || 'X';
    const scheduled = formatDate(post?.scheduledFor || post?.createdAt);
    if (meta) {
      meta.textContent = `${platform} · Scheduled ${scheduled}`;
    }
    body.textContent = buildPostFailureReport(post);
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closePostFailureModal() {
    const modal = el('promoteSocialPostFailureModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  function renderPostStatusCell(post) {
    const statusTd = document.createElement('td');
    statusTd.className = 'promote-social-post-status-cell';
    const status = safeText(post?.status).toLowerCase() || 'scheduled';

    if (status === 'failed') {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'status-pill status-social-failed promote-social-status-failed-link';
      link.textContent = 'Failed';
      link.setAttribute('aria-label', 'View failure details');
      link.addEventListener('click', () => openPostFailureModal(post));
      statusTd.appendChild(link);
      return statusTd;
    }

    if (status === 'awaiting_approval') {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'status-pill status-social-awaiting promote-social-status-failed-link';
      link.textContent = 'Awaiting Approval';
      link.setAttribute('aria-label', 'Review Facebook Personal preview');
      link.addEventListener('click', () => {
        reviewFacebookPersonalPreview(post).catch((err) => notify(err.message, true));
      });
      statusTd.appendChild(link);
      return statusTd;
    }

    const pill = document.createElement('span');
    pill.className = `status-pill ${statusClass(post.status)}`;
    pill.textContent = safeText(post.status) || 'scheduled';
    statusTd.appendChild(pill);
    return statusTd;
  }

  // --- Campaign dropdown (builder campaigns ready to publish) ---
  // Must match workflow statuses saved from Acquire → Campaigns (see public/js/campaigns.js).
  const PROMOTABLE_SOCIAL_STATUSES = new Set(['complete', 'ready', 'active', 'scheduled']);

  function normalizeWorkflowStatus(value) {
    return safeText(value).toLowerCase().replace(/[\s-]+/g, '_');
  }

  /** Prefer status inside campaign-v1 JSON (authoritative in UI); fall back to DB column. */
  function campaignWorkflowStatus(campaign) {
    const config = parseConfig(campaign);
    const fromConfig = config && typeof config.status === 'string' ? config.status : '';
    const raw = safeText(fromConfig) || safeText(campaign?.status);
    return normalizeWorkflowStatus(raw);
  }

  function renderCampaignSelect() {
    const select = el('promoteSocialCampaignSelect');
    if (!select) return;
    const current = select.value;
    while (select.options.length > 1) select.remove(1);
    const eligible = campaigns.filter((c) => PROMOTABLE_SOCIAL_STATUSES.has(campaignWorkflowStatus(c)));
    if (!eligible.length) {
      select.options[0].textContent = 'No campaigns (set status to Ready, Active, or Complete)';
      return;
    }
    select.options[0].textContent = 'Select campaign';
    eligible.forEach((campaign) => {
      const option = document.createElement('option');
      option.value = String(campaign.id);
      option.textContent = safeText(campaign.name) || `Campaign ${campaign.id}`;
      select.appendChild(option);
    });
    if (current && Array.from(select.options).some((o) => o.value === current)) {
      select.value = current;
    }
  }

  function getSelectedCampaign() {
    const select = el('promoteSocialCampaignSelect');
    if (!select || !select.value) return null;
    return campaigns.find((c) => String(c.id) === select.value) || null;
  }

  // --- Queue / History table ---

  function extractDriveFileIdFromLocation(value) {
    const text = safeText(value);
    if (!text) return '';
    const m = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    try {
      const u = new URL(text);
      const id = u.searchParams.get('id');
      if (id) return id.trim();
      if (String(u.hostname || '').includes('drive.google.com') && u.pathname.includes('/file/d/')) {
        const parts = u.pathname.split('/').filter(Boolean);
        const di = parts.indexOf('d');
        if (di >= 0 && parts[di + 1]) return parts[di + 1];
      }
    } catch {
      return '';
    }
    return '';
  }

  /** URLs safe to use as <img src> (https public, or same-origin asset proxy). */
  function isBrowserImgSrc(raw) {
    const u = safeText(raw);
    if (!u) return false;
    if (u.startsWith('/api/assets/')) return true;
    try {
      const parsed = new URL(u);
      const host = (parsed.hostname || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') return false;
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function normalizeAssetsPayload(body) {
    if (!body || typeof body !== 'object') return [];
    const fromData = body.data;
    if (Array.isArray(fromData)) return fromData;
    if (Array.isArray(body.assets)) return body.assets;
    return [];
  }

  function postThumbnailSrc(post) {
    const direct = safeText(post.imageUrl);
    if (isBrowserImgSrc(direct)) return direct;
    const cid = safeText(post.campaignId);
    const campaign = cid ? campaigns.find((c) => String(c.id) === cid) : null;
    if (!campaign) return '';
    const cfg = parseConfig(campaign);
    const pid = safeText(cfg.primaryImageId);
    if (!pid) return '';
    const pool = []
      .concat(Array.isArray(assetsForThumbs) ? assetsForThumbs : [])
      .concat(Array.isArray(state.assets) ? state.assets : []);
    const asset = pool.find((a) => String(a.id) === pid);
    if (!asset) return '';
    const loc = safeText(asset.location);
    if (isBrowserImgSrc(loc)) return loc;
    const driveId = extractDriveFileIdFromLocation(loc);
    if (driveId) return `/api/assets/drive-file/${encodeURIComponent(driveId)}`;
    return '';
  }

  function renderPosts(rows) {
    const tbody = el('promoteSocialPostsTable');
    if (!tbody) return;

    posts = Array.isArray(rows) ? rows : [];
    tbody.innerHTML = '';
    if (!posts.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = 'No social posts yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    posts.forEach((post) => {
      const tr = document.createElement('tr');
      const platformTd = document.createElement('td');
      platformTd.textContent = formatPlatformLabel(post.channel);
      tr.appendChild(platformTd);

      tr.appendChild(renderPostStatusCell(post));

      const scheduledTd = document.createElement('td');
      scheduledTd.textContent = formatDate(post.scheduledFor || post.createdAt);
      tr.appendChild(scheduledTd);

      const publishedTd = document.createElement('td');
      publishedTd.textContent = formatDate(post.publishedAt);
      tr.appendChild(publishedTd);

      const thumbTd = document.createElement('td');
      thumbTd.className = 'promote-social-post-thumb-cell';
      const thumbSrc = postThumbnailSrc(post);
      if (thumbSrc) {
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = safeText(post.imageAlt) || 'Featured image';
        img.className = 'promote-social-post-thumb';
        img.loading = 'lazy';
        img.decoding = 'async';
        thumbTd.appendChild(img);
      } else {
        const dash = document.createElement('span');
        dash.className = 'meta';
        dash.textContent = '—';
        thumbTd.appendChild(dash);
      }
      tr.appendChild(thumbTd);

      const textTd = document.createElement('td');
      textTd.textContent = safeText(post.text);
      tr.appendChild(textTd);

      const remoteTd = document.createElement('td');
      remoteTd.textContent = safeText(post.remoteId) || '-';
      tr.appendChild(remoteTd);

      const actionsTd = document.createElement('td');
      actionsTd.classList.add('promote-social-posts-actions-cell');
      const isAwaitingApproval = safeText(post.status).toLowerCase() === 'awaiting_approval';
      const canPublish = post.status !== 'published' && post.status !== 'publishing' && !isAwaitingApproval;
      const actionButtons = [];

      if (isAwaitingApproval) {
        actionButtons.push(App.makeIconButton('preview', 'Review Preview', async function () {
          try {
            await reviewFacebookPersonalPreview(post);
          } catch (err) {
            notify(err.message, true);
          }
        }));
        actionButtons.push(App.makeIconButton('approve', 'Approve & Post', async function () {
          try {
            await approveFacebookPersonalPost(post);
          } catch (err) {
            notify(err.message, true);
            await refresh();
          }
        }, { primary: true }));
      }

      if (canPublish) {
        const label = post.status === 'failed' ? 'Retry' : 'Publish Now';
        actionButtons.push(App.makeIconButton('publish', label, async function () {
          try {
            await promoteSocialApi(`/api/promote/social/posts/${encodeURIComponent(post.id)}/publish`, { method: 'POST' });
            notify(post.status === 'failed' ? 'Retrying post...' : 'Social post published');
            await refresh();
          } catch (err) {
            notify(err.message, true);
            await refresh();
          }
        }, { primary: true }));
      }

      actionButtons.push(App.makeIconButton('clone', 'Clone', async function () {
        try {
          await promoteSocialApi(`/api/promote/social/posts/${encodeURIComponent(post.id)}/clone`, { method: 'POST' });
          notify('Social post cloned');
          await refresh();
        } catch (err) {
          notify(err.message, true);
        }
      }));

      actionButtons.push(App.makeIconButton('delete', 'Delete', async function () {
        if (!confirm('Delete this social post?')) return;
        try {
          await promoteSocialApi(`/api/promote/social/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
          notify('Social post deleted');
          await refresh();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true }));

      App.finishTableActionsCell(actionsTd, ...actionButtons);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  // --- Send / Schedule ---

  async function queueCampaignPost(campaign, options) {
    await ensurePromoteSocialProjectContext();
    const preview = buildSocialText(campaign);
    const text = safeText(preview.text);
    if (!text) throw new Error('No post content could be assembled from this campaign.');
    if (preview.urlMissingFromText) {
      // The URL itself is never the problem on X — every link counts as 23
      // characters no matter how long it is.
      throw new Error(`Post text is ${preview.count} of ${preview.limit} characters, so the project URL could not be kept. Shorten the copy, tagline, CTA, or hashtags.`);
    }
    const config = preview.config;
    const delivery = socialDeliveryForCampaign(campaign, config);
    if (delivery.missingChannel) {
      throw new Error('Campaign channel details are not loaded yet. Refresh Promote Social and try again.');
    }
    if (delivery.publisher === 'facebook_personal' && !safeText(delivery.openclawProfile)) {
      throw new Error('Facebook Personal channel is missing OpenClaw Profile. Edit the channel under Channels and set the profile name.');
    }
    if (preview.count > preview.limit) {
      throw new Error(`Post text is ${preview.count} of ${preview.limit} characters — ${preview.count - preview.limit} over the limit for this channel.`);
    }
    const publishNow = !!options?.publishNow;
    const payload = {
      text,
      channel: delivery.publisher,
      campaignId: campaign.id,
      starcasterChannelId: delivery.starcasterChannelId,
      targetPlatform: delivery.targetPlatform,
      targetAccount: delivery.targetAccount,
      openclawProfile: delivery.openclawProfile,
      imageAlt: config.primaryImageLabel || '',
      publishNow,
    };
    if (publishNow) {
      payload.scheduledFor = '';
    } else {
      payload.scheduledForWall = safeText(options?.scheduledForWall);
    }
    return promoteSocialApi('/api/promote/social/posts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  function setStatus(msg) {
    const statusEl = el('promoteSocialStatus');
    if (statusEl) statusEl.textContent = msg || '';
  }

  async function handleSendNow() {
    const campaign = getSelectedCampaign();
    if (!campaign) { notify('Select a campaign first', true); return; }
    try {
      setStatus('Sending...');
      const delivery = socialDeliveryForCampaign(campaign, parseConfig(campaign));
      const res = await queueCampaignPost(campaign, { publishNow: true });
      const post = res?.post || res?.data?.post || null;
      if (delivery.publisher === 'facebook_personal' || safeText(post?.status).toLowerCase() === 'awaiting_approval') {
        notify('Facebook Personal preview queued — review and approve in the posts table');
      } else {
        notify('Post sent to publisher');
      }
      setStatus('');
      await refresh();
    } catch (err) {
      setStatus('');
      notify(err.message, true);
    }
  }

  async function handleSchedule() {
    const campaign = getSelectedCampaign();
    if (!campaign) { notify('Select a campaign first', true); return; }
    const scheduleAt = el('promoteSocialScheduleAt')?.value;
    if (!scheduleAt) { notify('Pick a date and time first', true); return; }
    try {
      setStatus('Scheduling...');
      const res = await queueCampaignPost(campaign, { scheduledForWall: scheduleAt });
      const tz = safeText(activeProject?.timezone) || 'UTC';
      const whenIso = res?.post?.scheduledFor || res?.data?.post?.scheduledFor;
      let msg = 'Scheduled';
      if (whenIso) {
        try {
          const disp = new Date(whenIso).toLocaleString(undefined, {
            timeZone: tz,
            dateStyle: 'short',
            timeStyle: 'short',
          });
          msg = `Scheduled for ${disp} (${tz})`;
        } catch (_) {
          msg = 'Scheduled';
        }
      }
      notify(msg);
      setStatus('');
      const input = el('promoteSocialScheduleAt');
      if (input) input.value = '';
      await refresh();
    } catch (err) {
      setStatus('');
      notify(err.message, true);
    }
  }

  // --- Data refresh ---

  async function refresh() {
    await ensurePromoteSocialProjectContext();
    const [postsRes, campaignsRes, projectRes, profileRes, assetsRes, channelsRes] = await Promise.allSettled([
      promoteSocialApi('/api/promote/social/posts'),
      api('/api/campaigns'),
      api('/api/projects/current'),
      api('/api/settings/profile'),
      api('/api/assets'),
      api('/api/channels'),
    ]);
    if (channelsRes.status === 'fulfilled') {
      state.channels = channelsRes.value.channels || channelsRes.value.data || [];
    }
    if (assetsRes.status === 'fulfilled') {
      assetsForThumbs = normalizeAssetsPayload(assetsRes.value);
    } else {
      assetsForThumbs = [];
    }
    if (projectRes.status === 'fulfilled') {
      activeProject = projectRes.value.project || projectRes.value.currentProject || projectRes.value.data?.project || null;
      if (activeProject?.id) {
        state.currentProject = activeProject;
        state.currentProjectId = safeText(activeProject.id);
      }
    }
    if (profileRes.status === 'fulfilled') {
      const profile = profileRes.value.profile || profileRes.value.data || {};
      if (profile && typeof profile === 'object') state.profile = { ...(state.profile || {}), ...profile };
    }
    if (campaignsRes.status === 'fulfilled') {
      campaigns = campaignsRes.value.campaigns || campaignsRes.value.data || [];
      renderCampaignSelect();
    } else {
      campaigns = [];
      renderCampaignSelect();
      const select = el('promoteSocialCampaignSelect');
      if (select?.options?.[0]) select.options[0].textContent = `Could not load campaigns: ${safeText(campaignsRes.reason?.message) || 'unknown error'}`;
    }
    if (postsRes.status === 'fulfilled') {
      renderPosts(postsRes.value.posts || postsRes.value.data || []);
    } else {
      renderPosts([]);
      setStatus(`Could not load queue/history: ${safeText(postsRes.reason?.message) || 'unknown error'}`);
    }
    updateScheduleTimezoneHint();
    renderDestination();
  }

  // --- Init ---

  function init() {
    const publishDueBtn = el('promoteSocialPublishDueBtn');
    const openSettingsBtn = el('promoteSocialOpenSettingsBtn');
    const sendNowBtn = el('promoteSocialSendNowBtn');
    const scheduleBtn = el('promoteSocialScheduleBtn');

    if (sendNowBtn) sendNowBtn.addEventListener('click', handleSendNow);
    if (scheduleBtn) scheduleBtn.addEventListener('click', handleSchedule);

    const campaignSelect = el('promoteSocialCampaignSelect');
    if (campaignSelect) campaignSelect.addEventListener('change', () => { renderDestination(); });

    if (publishDueBtn) {
      publishDueBtn.addEventListener('click', async function () {
        try {
          const res = await promoteSocialApi('/api/promote/social/posts/publish-due', { method: 'POST' });
          const processed = Array.isArray(res.processed) ? res.processed : [];
          const failures = processed.filter((item) => !item.ok).length;
          notify(failures ? `Processed ${processed.length} due posts (${failures} failed)` : `Processed ${processed.length} due posts`);
          await refresh();
        } catch (err) {
          notify(err.message, true);
          await refresh();
        }
      });
    }

    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', async function () {
        App.setActivePage('settingsApisPage');
        if (typeof App.settings?.refreshApiSettings === 'function') {
          try {
            await App.settings.refreshApiSettings();
          } catch (_) {}
        }
        if (typeof App.settings?.openApiSettingsForm === 'function') {
          App.settings.openApiSettingsForm('x', {}, 'Add API: X');
        }
      });
    }

    const failureModal = el('promoteSocialPostFailureModal');
    const failureCloseBtn = el('promoteSocialPostFailureCloseBtn');
    if (failureCloseBtn) failureCloseBtn.addEventListener('click', closePostFailureModal);
    if (failureModal) {
      failureModal.addEventListener('click', (e) => {
        if (e.target === failureModal) closePostFailureModal();
      });
    }

    refresh().catch((err) => notify(err.message || 'Could not load social publisher', true));
  }

  return {
    manifest: {
      id: 'promoteSocial',
      label: 'Promote Social',
      pageId: 'promoteSocialPage',
    },
    init,
    refresh,
    onPageActivated() {
      updateScheduleTimezoneHint();
    },
  };
})();
