window.App = window.App || {};

App.engageSocial = (function () {
  const { api, notify, state } = App;
  const TWEET_LIMIT = 280;
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

  function socialDeliveryForCampaign(campaign, config = parseConfig(campaign)) {
    const selectedChannel = campaignChannel(campaign, config);
    if (safeText(config.channelId) && !selectedChannel) {
      return {
        publisher: '',
        missingChannel: true,
        starcasterChannelId: safeText(config.channelId),
        targetPlatform: '',
        targetAccount: '',
      };
    }
    const platform = bufferPlatformKey(channelPlatform(selectedChannel));
    const account = channelAccount(selectedChannel);
    if (platform === 'x' || platform === 'tiktok') {
      return {
        publisher: 'buffer',
        starcasterChannelId: safeText(selectedChannel?.id || config.channelId),
        targetPlatform: platform,
        targetAccount: account,
      };
    }
    return {
      publisher: platform || 'x',
      starcasterChannelId: safeText(selectedChannel?.id || config.channelId),
      targetPlatform: platform,
      targetAccount: account,
    };
  }

  function characterCount(value) {
    return Array.from(String(value || '')).length;
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
    const hint = el('engageSocialScheduleTzHint');
    if (!hint) return;
    const tz = safeText(activeProject?.timezone) || 'UTC';
    hint.textContent = `Date and time are interpreted in the active project timezone (${tz}). Change it under Settings → Projects → Schedule Timezone.`;
  }

  function appendCtaUrl(ctaText) {
    const text = safeText(ctaText);
    if (!text) return '';
    const url = campaignProjectUrl();
    if (!url || text.includes(url)) return text;
    return `${text} ${url}`;
  }

  async function ensureEngageSocialProjectContext() {
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

  function buildTweet(campaign) {
    const config = parseConfig(campaign);
    const hidden = new Set(Array.isArray(config.hiddenContentFieldIds) ? config.hiddenContentFieldIds : []);
    const baseParts = [
      hidden.has('campaignTweetSelect') ? '' : safeText(config.tweetLabel || campaign?.subject),
      hidden.has('campaignTaglineSelect') ? '' : safeText(config.taglineLabel),
    ].filter(Boolean);
    const ctaText = hidden.has('campaignCtaSelect') ? '' : appendCtaUrl(config.ctaLabel);
    const shareUrl = campaignProjectUrl();
    const originalHashtags = hidden.has('campaignHashtagGroupSelect')
      ? []
      : safeText(config.hashtagsText || config.hashtagGroupLabel).split(/\s+/).filter(Boolean);
    let hashtags = originalHashtags.slice();
    let includeCta = !!ctaText;
    let includeLink = Boolean(shareUrl);
    const compose = () => {
      const bodyParts = [...baseParts];
      if (includeCta && ctaText) bodyParts.push(ctaText);
      const bodyJoined = bodyParts.join('\n\n');
      if (includeLink && shareUrl && !bodyJoined.includes(shareUrl)) bodyParts.push(shareUrl);
      const withHashtags = [...bodyParts];
      if (hashtags.length) withHashtags.push(hashtags.join(' '));
      return withHashtags.filter(Boolean).join('\n\n');
    };

    let text = compose();
    while (hashtags.length && characterCount(text) > TWEET_LIMIT) {
      hashtags = hashtags.slice(0, -1);
      text = compose();
    }
    if (includeCta && characterCount(text) > TWEET_LIMIT) {
      includeCta = false;
      text = compose();
    }
    if (includeLink && characterCount(text) > TWEET_LIMIT) {
      includeLink = false;
      text = compose();
    }
    const urlMissingFromTweet = Boolean(shareUrl) && !text.includes(shareUrl);
    return {
      text,
      count: characterCount(text),
      config,
      shareUrl,
      urlMissingFromTweet,
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
    return 'status-social-scheduled';
  }

  // --- Test Connection diagnostics ---

  async function testConnection() {
    const diagWrap = el('engageSocialDiagnosticsWrap');
    const diagPre = el('engageSocialDiagnosticsPreview');
    if (diagWrap) diagWrap.classList.remove('hidden');
    if (diagPre) diagPre.textContent = 'Running diagnostics...';

    const report = { checkedAt: new Date().toISOString(), checks: {} };

    try {
      // Step 1: Check credentials presence
      const statusRaw = await api('/api/engage/social/x/status');
      const statusRes = statusRaw?.data || statusRaw || {};
      report.checks.credentials = {
        configured: Boolean(statusRes?.configured),
        accountName: safeText(statusRes?.accountName),
        hasApiKey: Boolean(statusRes?.hasApiKey),
        hasApiSecret: Boolean(statusRes?.hasApiSecret),
        hasAccessToken: Boolean(statusRes?.hasAccessToken),
        hasAccessTokenSecret: Boolean(statusRes?.hasAccessTokenSecret),
      };
      // Show masked previews so user can compare with X Developer Console
      if (statusRes?.preview) {
        report.checks.credentials.valuePreview = {
          apiKey: safeText(statusRes.preview.apiKey),
          apiSecret: safeText(statusRes.preview.apiSecret),
          accessToken: safeText(statusRes.preview.accessToken),
          accessTokenSecret: safeText(statusRes.preview.accessTokenSecret),
        };
      }

      if (!statusRes?.configured) {
        report.checks.credentials.verdict = '❌ MISSING — Go to Settings > APIs > X to enter credentials';
        report.summary = '❌ X credentials are not configured';
        if (diagPre) diagPre.textContent = JSON.stringify(report, null, 2);
        return;
      }
      report.checks.credentials.verdict = '✅ All credentials present';
    } catch (err) {
      report.checks.credentials = { verdict: '❌ Could not check credentials', error: err.message };
    }

    try {
      // Step 2: Auth test — calls X /2/users/me
      const authRaw = await api('/api/engage/social/x/auth-test');
      const authRes = (typeof authRaw?.data === 'object' && authRaw?.data !== null) ? authRaw.data : authRaw || {};
      report.checks.auth = {
        authOk: Boolean(authRes?.authOk || authRaw?.authOk),
        status: authRes?.status || authRaw?.status || 0,
        accountName: safeText(authRes?.accountName || authRaw?.accountName),
        user: authRes?.user || authRaw?.user || null,
        error: safeText(authRes?.error || authRaw?.error),
      };
      // Include raw attempts if available
      const attempts = authRes?.attempts || authRaw?.attempts || [];
      if (Array.isArray(attempts) && attempts.length) {
        report.checks.auth.attempts = attempts;
      }

      if (authRes?.authOk) {
        const username = safeText(authRes?.user?.username || authRes?.user?.name || authRes?.accountName);
        report.checks.auth.verdict = `✅ Authenticated as @${username}`;
        report.summary = `✅ X connection is working — authenticated as @${username}`;
      } else {
        report.checks.auth.verdict = '❌ AUTH FAILED';
        const errDetail = safeText(authRes?.error);
        report.summary = `❌ X authentication failed: ${errDetail || 'Unknown error'}`;

        // Add troubleshooting hints based on error
        report.troubleshooting = [];
        const authStatus = Number(authRes?.status || 0) || 0;
        if (authStatus === 401 || errDetail.includes('401') || errDetail.toLowerCase().includes('unauthorized')) {
          report.troubleshooting.push('401 Unauthorized — your access tokens are invalid or expired.');
          report.troubleshooting.push('1. Go to the X Developer Portal → your App → Keys and Tokens');
          report.troubleshooting.push('2. Regenerate the Access Token and Secret');
          report.troubleshooting.push('3. Ensure App permissions are set to "Read and Write"');
          report.troubleshooting.push('4. Update the tokens in Settings > APIs > X');
          report.troubleshooting.push('5. If using Free tier: X Free API no longer supports tweet creation. Upgrade to Basic ($100/mo).');
        } else if (authStatus === 403 || errDetail.includes('403') || errDetail.toLowerCase().includes('forbidden')) {
          report.troubleshooting.push('403 Forbidden — your app may lack write permissions.');
          report.troubleshooting.push('Check App permissions in the X Developer Portal.');
        } else if (authStatus === 429 || errDetail.toLowerCase().includes('rate')) {
          report.troubleshooting.push('429 Rate Limit — too many requests. Wait a few minutes and try again.');
        } else {
          report.troubleshooting.push('Check your X Developer Portal for app status and credentials.');
          report.troubleshooting.push('Ensure the API Key and Secret match the Access Token and Secret.');
        }
      }
    } catch (err) {
      report.checks.auth = { verdict: '❌ Auth test request failed', error: err.message };
      report.summary = `❌ Auth test error: ${err.message}`;
    }

    try {
      const schedRaw = await api('/api/engage/social/scheduler-diagnostics');
      const sched = schedRaw?.schedulerDiagnostics || schedRaw?.data?.schedulerDiagnostics || schedRaw || {};
      report.checks.scheduler = sched;
      const cronAuthOk = Boolean(sched?.xAuth?.cron?.ok);
      const sessionAuthOk = Boolean(sched?.xAuth?.session?.ok);
      const mismatch = Boolean(sched?.xCredentials?.tokenMismatch);
      if (mismatch && sessionAuthOk && !cronAuthOk) {
        report.schedulerVerdict = '❌ Cron credentials differ from session — deploy cursor/engage-social-cron-publish-fix and ensure X_* env vars on Production.';
        if (!report.summary || report.summary.startsWith('✅')) {
          report.summary = report.schedulerVerdict;
        }
      } else if (!cronAuthOk && sched?.queue?.dueCount > 0) {
        report.schedulerVerdict = '❌ Cron auth would fail for due posts — check Vercel X_* env vars (not file settings).';
      } else if (cronAuthOk && sessionAuthOk) {
        report.schedulerVerdict = mismatch
          ? '⚠️ Auth OK but credential sets differ — scheduled cron may use different tokens until fix is deployed.'
          : '✅ Session and cron credential paths both authenticate.';
      }
    } catch (err) {
      report.checks.scheduler = { error: err.message };
    }

    if (diagPre) diagPre.textContent = JSON.stringify(report, null, 2);
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
    const select = el('engageSocialCampaignSelect');
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
    const select = el('engageSocialCampaignSelect');
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
    const tbody = el('engageSocialPostsTable');
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
      platformTd.textContent = safeText(post.channel).toUpperCase() || 'X';
      tr.appendChild(platformTd);

      const statusTd = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `status-pill ${statusClass(post.status)}`;
      pill.textContent = safeText(post.status) || 'scheduled';
      statusTd.appendChild(pill);
      if (post.error) {
        const err = document.createElement('div');
        err.className = 'meta';
        err.style.marginTop = '6px';
        err.style.color = '#c0392b';
        err.textContent = post.error;
        statusTd.appendChild(err);
      }
      const diag = post.diagnostics && typeof post.diagnostics === 'object' ? post.diagnostics : null;
      if (diag && (diag.publishMode || diag.credentialSources || diag.cronCredentialSources)) {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.style.marginTop = '6px';
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
        meta.textContent = parts.join(' · ');
        statusTd.appendChild(meta);
      }
      tr.appendChild(statusTd);

      const scheduledTd = document.createElement('td');
      scheduledTd.textContent = formatDate(post.scheduledFor || post.createdAt);
      tr.appendChild(scheduledTd);

      const publishedTd = document.createElement('td');
      publishedTd.textContent = formatDate(post.publishedAt);
      tr.appendChild(publishedTd);

      const thumbTd = document.createElement('td');
      thumbTd.className = 'engage-social-post-thumb-cell';
      const thumbSrc = postThumbnailSrc(post);
      if (thumbSrc) {
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = safeText(post.imageAlt) || 'Featured image';
        img.className = 'engage-social-post-thumb';
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
      actionsTd.style.whiteSpace = 'nowrap';
      const canPublish = post.status !== 'published' && post.status !== 'publishing';

      if (canPublish) {
        // For failed posts, label it "Retry"; otherwise "Publish Now"
        const label = post.status === 'failed' ? 'Retry' : 'Publish Now';
        const iconKey = post.status === 'failed' ? 'publish' : 'publish';
        const publishBtn = App.makeIconButton(iconKey, label, async function () {
          try {
            await api(`/api/engage/social/posts/${encodeURIComponent(post.id)}/publish`, { method: 'POST' });
            notify(post.status === 'failed' ? 'Retrying post...' : 'Social post published');
            await refresh();
          } catch (err) {
            notify(err.message, true);
            await refresh();
          }
        }, { primary: true });
        actionsTd.appendChild(publishBtn);
      }

      const deleteBtn = App.makeIconButton('delete', 'Delete Post', async function () {
        if (!confirm('Delete this social post?')) return;
        try {
          await api(`/api/engage/social/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
          notify('Social post deleted');
          await refresh();
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  // --- Send / Schedule ---

  async function queueCampaignPost(campaign, options) {
    await ensureEngageSocialProjectContext();
    const preview = buildTweet(campaign);
    const text = safeText(preview.text);
    if (!text) throw new Error('No post content could be assembled from this campaign.');
    if (preview.urlMissingFromTweet) {
      throw new Error('Tweet is over the X limit and the project URL could not be kept. Shorten tweet, tagline, CTA, or hashtags — or use a shorter Website URL on the project or profile.');
    }
    if (characterCount(text) > TWEET_LIMIT) throw new Error(`Tweet is ${characterCount(text) - TWEET_LIMIT} characters over the X limit.`);
    const config = preview.config;
    const publishNow = !!options?.publishNow;
    const delivery = socialDeliveryForCampaign(campaign, config);
    if (delivery.missingChannel) {
      throw new Error('Campaign channel details are not loaded yet. Refresh Engage Social and try again.');
    }
    const payload = {
      text,
      channel: delivery.publisher,
      campaignId: campaign.id,
      starcasterChannelId: delivery.starcasterChannelId,
      targetPlatform: delivery.targetPlatform,
      targetAccount: delivery.targetAccount,
      imageAlt: config.primaryImageLabel || '',
      publishNow,
    };
    if (publishNow) {
      payload.scheduledFor = '';
    } else {
      payload.scheduledForWall = safeText(options?.scheduledForWall);
    }
    return api('/api/engage/social/posts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  function setStatus(msg) {
    const statusEl = el('engageSocialStatus');
    if (statusEl) statusEl.textContent = msg || '';
  }

  async function handleSendNow() {
    const campaign = getSelectedCampaign();
    if (!campaign) { notify('Select a campaign first', true); return; }
    try {
      setStatus('Sending...');
      await queueCampaignPost(campaign, { publishNow: true });
      notify('Post sent to publisher');
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
    const scheduleAt = el('engageSocialScheduleAt')?.value;
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
      const input = el('engageSocialScheduleAt');
      if (input) input.value = '';
      await refresh();
    } catch (err) {
      setStatus('');
      notify(err.message, true);
    }
  }

  // --- Data refresh ---

  async function refresh() {
    const [postsRes, campaignsRes, projectRes, profileRes, assetsRes, channelsRes] = await Promise.allSettled([
      api('/api/engage/social/posts'),
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
    }
    if (postsRes.status === 'fulfilled') {
      renderPosts(postsRes.value.posts || postsRes.value.data || []);
    }
    updateScheduleTimezoneHint();
  }

  // --- Init ---

  function init() {
    const testConnectionBtn = el('engageSocialTestConnectionBtn');
    const publishDueBtn = el('engageSocialPublishDueBtn');
    const openSettingsBtn = el('engageSocialOpenSettingsBtn');
    const sendNowBtn = el('engageSocialSendNowBtn');
    const scheduleBtn = el('engageSocialScheduleBtn');

    if (testConnectionBtn) testConnectionBtn.addEventListener('click', testConnection);
    if (sendNowBtn) sendNowBtn.addEventListener('click', handleSendNow);
    if (scheduleBtn) scheduleBtn.addEventListener('click', handleSchedule);

    if (publishDueBtn) {
      publishDueBtn.addEventListener('click', async function () {
        try {
          const res = await api('/api/engage/social/posts/publish-due', { method: 'POST' });
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

    refresh().catch((err) => notify(err.message || 'Could not load social publisher', true));
  }

  return {
    manifest: {
      id: 'engageSocial',
      label: 'Engage Social',
      pageId: 'engageSocialPage',
    },
    init,
    refresh,
    onPageActivated() {
      updateScheduleTimezoneHint();
    },
  };
})();
