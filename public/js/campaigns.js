window.App = window.App || {};

App.campaigns = (function () {
  const { state, els, api, notify } = App;

  let builderTweets = [];
  let builderHashtags = [];

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  function extractDriveId(url) {
    const text = safeText(url);
    if (!text) return '';
    const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (byPath) return byPath[1];
    try {
      const parsed = new URL(text);
      return parsed.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function assetPreviewUrl(asset) {
    const location = safeText(asset?.location);
    if (!location) return '';
    const driveId = extractDriveId(location);
    if (driveId) return `/api/assets/drive-file/${encodeURIComponent(driveId)}`;
    try {
      const parsed = new URL(location);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return location;
    } catch {}
    return '';
  }

  function parseCampaignConfig(campaign) {
    const raw = safeText(campaign?.content);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.builder === 'campaign-v1') {
        return parsed;
      }
    } catch {}
    return null;
  }

  function setSelectOptions(select, options, placeholder, currentValue) {
    if (!select) return;
    const desired = String(currentValue || '');
    select.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    (Array.isArray(options) ? options : []).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });

    if (desired && Array.from(select.options).some((option) => option.value === desired)) {
      select.value = desired;
    }
  }

  function channelLabel(channel) {
    return safeText(
      channel?.channel
      || channel?.name
      || channel?.handle
      || channel?.userName
      || channel?.id
    );
  }

  function renderBuilderSelects() {
    const channels = Array.isArray(state.channels) ? state.channels : [];
    const assets = Array.isArray(state.assets) ? state.assets : [];
    const images = assets.filter((asset) => safeText(asset.assetType) === 'Image');
    const videos = assets.filter((asset) => safeText(asset.assetType) === 'Video');
    const leadMagnets = assets.filter((asset) => safeText(asset.assetType) === 'Lead Magnet');

    setSelectOptions(
      byId('campaignChannelSelect'),
      channels.map((channel) => ({ value: channel.id, label: channelLabel(channel) || `Channel ${channel.id}` })),
      channels.length ? 'Channel' : 'No channels available yet'
    );

    setSelectOptions(
      byId('campaignSegmentSelect'),
      (Array.isArray(state.segments) ? state.segments : []).map((segment) => ({
        value: segment.id,
        label: safeText(segment.name) || `Segment ${segment.id}`,
      })),
      'Segment (optional)'
    );

    setSelectOptions(
      byId('campaignHeadlineSelect'),
      [],
      'Headline (placeholder until Messaging > Headlines exists)'
    );

    setSelectOptions(
      byId('campaignBlurbSelect'),
      [],
      'Blurb (placeholder until Messaging > Blurbs exists)'
    );

    setSelectOptions(
      byId('campaignPitchSelect'),
      [],
      'Pitch (placeholder until Messaging > Pitch exists)'
    );

    const hashtagGroups = [];
    const grouped = new Map();
    builderHashtags.forEach((row) => {
      const key = String(row.campaign_id || '');
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    Array.from(grouped.entries()).forEach(([campaignId, rows]) => {
      const linked = channels.find(() => false); // intentional no-op; keeps structure explicit
      const campaign = (Array.isArray(state.campaigns) ? state.campaigns : []).find((item) => String(item.id) === campaignId);
      const name = safeText(campaign?.name) || `Campaign ${campaignId}`;
      hashtagGroups.push({ value: campaignId, label: `${name} (${rows.length} hashtag${rows.length === 1 ? '' : 's'})` });
      void linked;
    });
    setSelectOptions(
      byId('campaignHashtagGroupSelect'),
      hashtagGroups,
      hashtagGroups.length ? 'Select Hashtag Group' : 'Hashtag Group (create hashtags first)'
    );

    setSelectOptions(
      byId('campaignCtaSelect'),
      [],
      'CTA (placeholder until Messaging > CTAs exists)'
    );

    setSelectOptions(
      byId('campaignTweetSelect'),
      builderTweets.map((tweet) => {
        const content = safeText(tweet.content);
        const label = content.length > 80 ? `${content.slice(0, 77)}...` : content;
        return { value: tweet.id, label: label || `Tweet ${tweet.id}` };
      }),
      'Tweet (optional)'
    );

    setSelectOptions(
      byId('campaignPrimaryImageSelect'),
      images.map((asset) => ({ value: asset.id, label: safeText(asset.assetName) || `Image ${asset.id}` })),
      images.length ? 'Primary Image' : 'Primary Image (no image assets yet)'
    );

    setSelectOptions(
      byId('campaignPrimaryVideoSelect'),
      videos.map((asset) => ({ value: asset.id, label: safeText(asset.assetName) || `Video ${asset.id}` })),
      'Primary Video (optional)'
    );

    setSelectOptions(
      byId('campaignLandingPageSelect'),
      [],
      'Landing Page (placeholder)'
    );

    setSelectOptions(
      byId('campaignFormObjectSelect'),
      [],
      'Form (placeholder)'
    );

    setSelectOptions(
      byId('campaignLeadMagnetSelect'),
      leadMagnets.map((asset) => ({ value: asset.id, label: safeText(asset.assetName) || `Asset ${asset.id}` })),
      leadMagnets.length ? 'PDF (optional)' : 'PDF (placeholder)'
    );

    const campaignForm = byId('campaignForm');
    const submitBtn = campaignForm?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = channels.length === 0;
  }

  async function loadBuilderSources() {
    const [channelsRes, assetsRes, segmentsRes, tweetsRes, hashtagsRes] = await Promise.allSettled([
      api('/api/channels'),
      api('/api/assets'),
      api('/api/segments'),
      api('/api/messaging/tweets?limit=200'),
      api('/api/messaging/hashtags?limit=5000'),
    ]);

    if (channelsRes.status === 'fulfilled' && Array.isArray(channelsRes.value.channels)) {
      state.channels = channelsRes.value.channels;
    }
    if (assetsRes.status === 'fulfilled' && Array.isArray(assetsRes.value.assets)) {
      state.assets = assetsRes.value.assets;
    }
    if (segmentsRes.status === 'fulfilled' && Array.isArray(segmentsRes.value.segments)) {
      state.segments = segmentsRes.value.segments;
    }

    builderTweets = tweetsRes.status === 'fulfilled' && Array.isArray(tweetsRes.value.tweets)
      ? tweetsRes.value.tweets
      : [];
    builderHashtags = hashtagsRes.status === 'fulfilled' && Array.isArray(hashtagsRes.value.hashtags)
      ? hashtagsRes.value.hashtags
      : [];

    renderBuilderSelects();
    renderCampaigns();
  }

  function renderCampaigns() {
    const tbody = byId('campaignCards');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = Array.isArray(state.campaigns) ? state.campaigns : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No campaigns yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const channelsById = new Map((Array.isArray(state.channels) ? state.channels : []).map((channel) => [String(channel.id), channel]));
    const assetsById = new Map((Array.isArray(state.assets) ? state.assets : []).map((asset) => [String(asset.id), asset]));

    rows.forEach((campaign) => {
      const config = parseCampaignConfig(campaign);
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(campaign.name) || '-';
      tr.appendChild(nameTd);

      const channelTd = document.createElement('td');
      const channel = config?.channelId ? channelsById.get(String(config.channelId)) : null;
      channelTd.textContent = channelLabel(channel) || '-';
      tr.appendChild(channelTd);

      const headlineTd = document.createElement('td');
      headlineTd.textContent = safeText(config?.headlineLabel || campaign.subject) || '-';
      tr.appendChild(headlineTd);

      const imageTd = document.createElement('td');
      const primaryImage = config?.primaryImageId ? assetsById.get(String(config.primaryImageId)) : null;
      const imageUrl = assetPreviewUrl(primaryImage);
      if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = safeText(primaryImage?.assetName) || 'Primary image';
        img.style.height = '50px';
        img.style.width = 'auto';
        img.style.display = 'block';
        imageTd.appendChild(img);
      } else {
        imageTd.textContent = '-';
      }
      tr.appendChild(imageTd);

      const ctaTd = document.createElement('td');
      ctaTd.textContent = safeText(config?.ctaLabel) || '-';
      tr.appendChild(ctaTd);

      tbody.appendChild(tr);
    });
  }

  function selectedOptionText(select) {
    if (!select) return '';
    const option = select.options[select.selectedIndex];
    return safeText(option?.textContent);
  }

  function init() {
    const toggleBtn = byId('campaignToggleFormBtn');
    const form = byId('campaignForm');

    if (toggleBtn && form) {
      toggleBtn.addEventListener('click', async () => {
        const isHidden = form.classList.contains('hidden');
        form.classList.toggle('hidden', !isHidden);
        toggleBtn.textContent = isHidden ? 'Hide Form' : 'Add Campaign';
        if (isHidden) {
          await loadBuilderSources();
        }
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const channelSelect = byId('campaignChannelSelect');
        const segmentSelect = byId('campaignSegmentSelect');
        const landingSelect = byId('campaignLandingPageSelect');
        const formObjectSelect = byId('campaignFormObjectSelect');
        const headlineSelect = byId('campaignHeadlineSelect');
        const blurbSelect = byId('campaignBlurbSelect');
        const pitchSelect = byId('campaignPitchSelect');
        const tweetSelect = byId('campaignTweetSelect');
        const hashtagSelect = byId('campaignHashtagGroupSelect');
        const ctaSelect = byId('campaignCtaSelect');
        const imageSelect = byId('campaignPrimaryImageSelect');
        const videoSelect = byId('campaignPrimaryVideoSelect');
        const leadMagnetSelect = byId('campaignLeadMagnetSelect');

        const payload = {
          name: safeText(form.elements.name?.value),
          subject: selectedOptionText(headlineSelect) || safeText(form.elements.name?.value),
          content: JSON.stringify({
            builder: 'campaign-v1',
            channelId: safeText(channelSelect?.value),
            channelLabel: selectedOptionText(channelSelect),
            segmentId: safeText(segmentSelect?.value),
            segmentLabel: selectedOptionText(segmentSelect),
            landingPageId: safeText(landingSelect?.value),
            landingPageLabel: selectedOptionText(landingSelect),
            formObjectId: safeText(formObjectSelect?.value),
            formObjectLabel: selectedOptionText(formObjectSelect),
            headlineId: safeText(headlineSelect?.value),
            headlineLabel: selectedOptionText(headlineSelect),
            blurbId: safeText(blurbSelect?.value),
            blurbLabel: selectedOptionText(blurbSelect),
            pitchId: safeText(pitchSelect?.value),
            pitchLabel: selectedOptionText(pitchSelect),
            tweetId: safeText(tweetSelect?.value),
            tweetLabel: selectedOptionText(tweetSelect),
            ctaId: safeText(ctaSelect?.value),
            ctaLabel: selectedOptionText(ctaSelect),
            primaryImageId: safeText(imageSelect?.value),
            primaryImageLabel: selectedOptionText(imageSelect),
            primaryVideoId: safeText(videoSelect?.value),
            primaryVideoLabel: selectedOptionText(videoSelect),
            hashtagGroupId: safeText(hashtagSelect?.value),
            hashtagGroupLabel: selectedOptionText(hashtagSelect),
            leadMagnetId: safeText(leadMagnetSelect?.value),
            leadMagnetLabel: selectedOptionText(leadMagnetSelect),
          }),
          segmentId: safeText(segmentSelect?.value),
        };

        if (!payload.name) {
          notify('Campaign name is required', true);
          return;
        }
        if (!safeText(channelSelect?.value)) {
          notify('Select a channel', true);
          return;
        }

        try {
          await api('/api/campaigns', { method: 'POST', body: JSON.stringify(payload) });
          form.reset();
          renderBuilderSelects();
          form.classList.add('hidden');
          if (toggleBtn) toggleBtn.textContent = 'Add Campaign';
          notify('Campaign created');
          await App.refresh();
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
  }

  return {
    manifest: { id: 'campaigns', label: 'Campaigns', pageId: 'campaignsPage' },
    init,
    refresh: loadBuilderSources,
    renderCampaigns,
    onPageActivated: loadBuilderSources,
  };
})();
