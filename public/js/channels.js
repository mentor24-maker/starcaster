window.App = window.App || {};

App.channels = (function () {
  const { state, els, api, notify } = App;
  let activeFilteredChannelType = null;
  let activePlatformFilter = '';

  const PLATFORM_LOGO_LOCAL = {
    x: '/images/logos/x.svg',
    facebook: '/images/logos/facebook.svg',
    instagram: '/images/logos/instagram.svg',
    youtube: '/images/logos/youtube.svg',
    tiktok: '/images/logos/tiktok.svg',
    linkedin: '/images/logos/linkedin.svg',
    bluesky: '/images/logos/bluesky.svg',
    reddit: '/images/logos/reddit.svg',
    medium: '/images/logos/medium.svg',
    substack: '/images/logos/substack.svg',
  };

  const PLATFORM_LOGO_REMOTE = {
    pinterest: 'https://cdn.simpleicons.org/pinterest/bd081c',
    threads: 'https://cdn.simpleicons.org/threads/000000',
    snapchat: 'https://cdn.simpleicons.org/snapchat/fffc00',
    telegram: 'https://cdn.simpleicons.org/telegram/26a5e4',
    discord: 'https://cdn.simpleicons.org/discord/5865f2',
    twitch: 'https://cdn.simpleicons.org/twitch/9146ff',
    mastodon: 'https://cdn.simpleicons.org/mastodon/6364ff',
    patreon: 'https://cdn.simpleicons.org/patreon/ff424d',
    whatsapp: 'https://cdn.simpleicons.org/whatsapp/25d366',
  };

  const SOCIAL_PLATFORMS = [
    'Bluesky',
    'Discord',
    'Facebook',
    'Instagram',
    'LinkedIn',
    'Mastodon',
    'Medium',
    'Patreon',
    'Pinterest',
    'Reddit',
    'Snapchat',
    'Substack',
    'Telegram',
    'Threads',
    'TikTok',
    'Twitch',
    'WhatsApp',
    'X',
    'YouTube',
  ];

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  function normalizePlatformKey(value) {
    return safeText(value).toLowerCase();
  }

  function platformToLogoKey(platformName) {
    const key = normalizePlatformKey(platformName);
    if (!key) return 'web';
    if (key === 'x' || key.includes('twitter')) return 'x';
    if (key.includes('facebook')) return 'facebook';
    if (key.includes('instagram')) return 'instagram';
    if (key.includes('youtube')) return 'youtube';
    if (key.includes('tiktok')) return 'tiktok';
    if (key.includes('linkedin')) return 'linkedin';
    if (key.includes('pinterest')) return 'pinterest';
    if (key.includes('threads')) return 'threads';
    if (key.includes('bluesky')) return 'bluesky';
    if (key.includes('snapchat')) return 'snapchat';
    if (key.includes('reddit')) return 'reddit';
    if (key.includes('telegram')) return 'telegram';
    if (key.includes('discord')) return 'discord';
    if (key.includes('twitch')) return 'twitch';
    if (key.includes('mastodon')) return 'mastodon';
    if (key.includes('medium')) return 'medium';
    if (key.includes('substack')) return 'substack';
    if (key.includes('patreon')) return 'patreon';
    if (key.includes('whatsapp')) return 'whatsapp';
    return key.replace(/[^a-z0-9]/g, '');
  }

  function platformLogoSrc(platformName) {
    const key = platformToLogoKey(platformName);
    return PLATFORM_LOGO_LOCAL[key] || PLATFORM_LOGO_REMOTE[key] || '/images/logos/web.svg';
  }

  function formatPlatformDisplayName(platformName) {
    const raw = safeText(platformName);
    if (!raw) return '-';
    const match = SOCIAL_PLATFORMS.find(
      (platform) =>
        normalizePlatformKey(platform) === normalizePlatformKey(raw) || platformMatchesFilter(platform, raw)
    );
    return match || raw;
  }

  function buildPlatformCell(platformName) {
    const wrap = document.createElement('div');
    wrap.className = 'channels-platform-cell';

    const icon = document.createElement('img');
    icon.className = 'channels-platform-icon';
    icon.src = platformLogoSrc(platformName);
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');

    const name = document.createElement('strong');
    name.className = 'channels-platform-name';
    name.textContent = formatPlatformDisplayName(platformName);

    wrap.appendChild(icon);
    wrap.appendChild(name);
    return wrap;
  }

  function syncPlatformFilterIcon() {
    const icon = byId('channelsFilterPlatformIcon');
    const select = byId('channelsFilterPlatform');
    if (!icon || !select) return;
    const value = safeText(select.value);
    icon.src = platformLogoSrc(value || 'web');
    icon.classList.toggle('channels-platform-icon--muted', !value);
  }

  function platformMatchesFilter(channelName, filterValue) {
    const filter = normalizePlatformKey(filterValue);
    if (!filter) return true;
    const channel = normalizePlatformKey(channelName);
    if (channel === filter) return true;
    if (filter === 'x' && (channel === 'x' || channel.includes('twitter'))) return true;
    if (filter.includes('twitter') && (channel === 'x' || channel.includes('twitter'))) return true;
    if (filter.includes('facebook') && channel.includes('facebook')) return true;
    if (filter.includes('instagram') && channel.includes('instagram')) return true;
    if (filter.includes('youtube') && channel.includes('youtube')) return true;
    if (filter.includes('tiktok') && channel.includes('tiktok')) return true;
    if (filter.includes('linkedin') && channel.includes('linkedin')) return true;
    return channel.includes(filter) || filter.includes(channel);
  }

  function fillPlatformSelect(selectEl, { includePlaceholder = true, selectedValue = '' } = {}) {
    if (!selectEl) return;
    const previous = safeText(selectedValue || selectEl.value);
    selectEl.innerHTML = '';
    if (includePlaceholder) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select platform';
      selectEl.appendChild(placeholder);
    }
    SOCIAL_PLATFORMS.forEach((platform) => {
      const option = document.createElement('option');
      option.value = platform;
      option.textContent = platform;
      selectEl.appendChild(option);
    });
    if (previous) {
      const match = SOCIAL_PLATFORMS.find((p) => normalizePlatformKey(p) === normalizePlatformKey(previous));
      selectEl.value = match || previous;
    }
  }

  function fillPlatformFilterSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All Platforms';
    selectEl.appendChild(all);
    SOCIAL_PLATFORMS.forEach((platform) => {
      const option = document.createElement('option');
      option.value = platform;
      option.textContent = platform;
      selectEl.appendChild(option);
    });
    selectEl.value = activePlatformFilter;
    syncPlatformFilterIcon();
  }

  function syncVirtualPersonalityFields(formKind, channelTypeOverride) {
    const isCreate = formKind === 'create';
    const vpLabel = byId(isCreate ? 'channelTypeAssignLabel' : 'channelEditTypeAssignLabel');
    const vpSelect = byId(isCreate ? 'channelTypeAssign' : 'channelEditTypeAssign');
    if (!vpLabel || !vpSelect) return;

    const channelType = channelTypeOverride || activeFilteredChannelType;
    if (String(channelType || '').toLowerCase() === 'virtual') {
      vpLabel.classList.remove('hidden');
      vpSelect.classList.remove('hidden');
      const vps = (state.contacts || []).filter((c) => (c.contactClass || c.contact_class) === 'personality');
      vpSelect.innerHTML = '<option value="">-- Select Virtual Personality --</option>';
      vps.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `${v.firstName || ''} ${v.lastName || ''}`.trim() || v.email;
        vpSelect.appendChild(opt);
      });
      return;
    }

    vpLabel.classList.add('hidden');
    vpSelect.classList.add('hidden');
    vpSelect.innerHTML = '';
  }

  function openChannelsPage() {
    activeFilteredChannelType = null;
    activePlatformFilter = '';

    const heading = byId('channelsPageHeading');
    if (heading) heading.textContent = 'Channels';
    const subtitle = byId('channelsPageSubtitle');
    if (subtitle) {
      subtitle.textContent =
        'Connect social accounts used for outreach. Create channels on the left; browse and filter existing channels on the right.';
    }

    syncVirtualPersonalityFields('create');
    fillPlatformFilterSelect(byId('channelsFilterPlatform'));

    App.setActivePage('channelsPage');
    refresh().catch((err) => notify(err.message || 'Unable to load channels', true));
    return false;
  }

  function openFilteredChannelsPage(type) {
    activeFilteredChannelType = type;
    activePlatformFilter = '';

    const headerDisplay = type === 'virtual' ? 'Virtual Channels' : 'Organic Channels';
    const heading = byId('channelsPageHeading');
    if (heading) heading.textContent = `Channels: ${headerDisplay}`;

    const subtitle = byId('channelsPageSubtitle');
    if (subtitle) {
      if (type === 'virtual') subtitle.textContent = 'Social accounts proxying as synthesized Virtual Personalities.';
      if (type === 'organic') subtitle.textContent = 'Primary, authentic social accounts owned and operated directly by your brand.';
    }

    syncVirtualPersonalityFields('create');
    fillPlatformFilterSelect(byId('channelsFilterPlatform'));

    App.setActivePage('channelsPage');
    renderChannels();
    return false;
  }

  function isUrl(value) {
    const text = safeText(value);
    if (!text) return false;
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function normalizeHandle(value) {
    return safeText(value).replace(/^@+/, '');
  }

  function buildChannelUrl(channelName, userName) {
    const rawUser = safeText(userName);
    if (!rawUser) return '';
    if (isUrl(rawUser)) return rawUser;

    const channel = safeText(channelName).toLowerCase();
    const handle = normalizeHandle(rawUser);
    if (!handle) return '';

    if (channel.includes('facebook')) {
      if (/^\d+$/.test(handle)) return `https://www.facebook.com/profile.php?id=${encodeURIComponent(handle)}`;
      return `https://www.facebook.com/${encodeURIComponent(handle)}`;
    }
    if (channel.includes('instagram')) return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
    if (channel === 'x' || channel.includes('twitter')) return `https://x.com/${encodeURIComponent(handle)}`;
    if (channel.includes('youtube')) {
      if (rawUser.startsWith('@')) return `https://www.youtube.com/${rawUser}`;
      return `https://www.youtube.com/@${encodeURIComponent(handle)}`;
    }
    if (channel.includes('tiktok')) return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
    if (channel.includes('linkedin')) return `https://www.linkedin.com/in/${encodeURIComponent(handle)}`;
    if (channel.includes('patreon')) return `https://www.patreon.com/${encodeURIComponent(handle)}`;
    if (channel.includes('substack')) return `https://${handle}.substack.com`;
    if (channel.includes('medium')) return `https://medium.com/@${encodeURIComponent(handle)}`;
    if (channel.includes('bluesky')) return `https://bsky.app/profile/${encodeURIComponent(handle)}`;
    if (channel.includes('threads')) return `https://www.threads.net/@${encodeURIComponent(handle)}`;
    if (channel.includes('pinterest')) return `https://www.pinterest.com/${encodeURIComponent(handle)}/`;
    if (channel.includes('telegram')) return `https://t.me/${encodeURIComponent(handle)}`;
    if (channel.includes('reddit')) return `https://www.reddit.com/user/${encodeURIComponent(handle)}/`;
    if (channel.includes('snapchat')) return `https://www.snapchat.com/add/${encodeURIComponent(handle)}`;
    if (channel.includes('discord')) return '';
    if (channel.includes('twitch')) return `https://www.twitch.tv/${encodeURIComponent(handle)}`;
    if (channel.includes('mastodon')) return '';
    if (channel.includes('whatsapp')) return '';

    return '';
  }

  function openEditPage(item) {
    const id = Number(item?.id || 0) || 0;
    if (!id || !els.channelEditForm) {
      return notify('Channel id is missing', true);
    }

    els.channelEditForm.reset();
    fillPlatformSelect(byId('channelEditPlatformInput'), { selectedValue: item.channel || '' });
    syncVirtualPersonalityFields('edit', item.channelType);

    const vpSelect = byId('channelEditTypeAssign');
    if (vpSelect && String(item.channelType || '').toLowerCase() === 'virtual') {
      vpSelect.value = item.contactId || '';
    }

    if (els.channelEditId) els.channelEditId.value = String(id);
    els.channelEditForm.user_name.value = String(item.userName || '');
    els.channelEditForm.email.value = String(item.email || '');
    els.channelEditForm.password.value = '';
    App.setActivePage('editChannelPage');
  }

  async function deleteChannel(item) {
    const id = Number(item?.id || 0) || 0;
    if (!id) return notify('Channel id is missing', true);
    if (!confirm(`Delete channel "${item.channel}"?`)) return;

    try {
      await api(`/api/channels/${id}`, { method: 'DELETE' });
      notify('Channel deleted');
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function cloneChannel(item) {
    const id = Number(item?.id || 0) || 0;
    if (!id) return notify('Channel id is missing', true);

    const baseUser = safeText(item.userName) || 'channel';
    const clonedUser = /\s*\(copy\)$/i.test(baseUser) ? baseUser : `${baseUser} (copy)`;

    const payload = {
      channel: safeText(item.channel),
      userName: clonedUser,
      email: safeText(item.email),
      channelType: item.channelType || activeFilteredChannelType || 'organic',
      contactId: item.contactId || null,
      password: '',
    };

    if (!payload.channel) return notify('Platform is required to clone', true);
    if (!payload.userName) return notify('User name is required to clone', true);

    try {
      await api('/api/channels', { method: 'POST', body: JSON.stringify(payload) });
      notify('Channel cloned');
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  function renderChannels() {
    if (!els.channelsTable) return;
    els.channelsTable.innerHTML = '';

    const projectId = App.state?.currentProjectId || '';
    if (!projectId && activeFilteredChannelType) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.cssText = 'text-align:center; padding:1.5rem; color:#888;';
      td.textContent = 'Select a project to view project-specific channels.';
      tr.appendChild(td);
      els.channelsTable.appendChild(tr);
      return;
    }

    let activeSet = state.channels || [];
    if (activeFilteredChannelType) {
      activeSet = activeSet.filter(
        (c) => String(c.channelType || 'organic').toLowerCase() === String(activeFilteredChannelType).toLowerCase()
      );
    }
    if (activePlatformFilter) {
      activeSet = activeSet.filter((c) => platformMatchesFilter(c.channel, activePlatformFilter));
    }

    if (!activeSet.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.cssText = 'text-align:center; padding:1.5rem; color:#888;';
      td.textContent = activePlatformFilter ? 'No channels match this platform.' : 'No channels yet.';
      tr.appendChild(td);
      els.channelsTable.appendChild(tr);
      return;
    }

    activeSet.forEach((item) => {
      const tr = document.createElement('tr');

      const channelTd = document.createElement('td');
      if (safeText(item.channel)) {
        channelTd.appendChild(buildPlatformCell(item.channel));
      } else {
        channelTd.textContent = '-';
      }

      const userTd = document.createElement('td');
      const userName = safeText(item.userName);
      const channelUrl = buildChannelUrl(item.channel, userName);
      if (userName && channelUrl) {
        const link = document.createElement('a');
        link.href = channelUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = userName;
        userTd.appendChild(link);
      } else {
        userTd.textContent = userName || '-';
      }

      const emailTd = document.createElement('td');
      emailTd.textContent = item.email || '-';

      const passwordTd = document.createElement('td');
      passwordTd.textContent = item.passwordMasked || '-';

      const actionsTd = document.createElement('td');
      actionsTd.className = 'channels-actions-cell';
      const rowId = Number(item.id || 0) || 0;
      if (rowId > 0) {
        const editBtn = App.makeIconButton('edit', 'Edit Channel', () => openEditPage(item));
        const cloneBtn = App.makeIconButton('clone', 'Clone Channel', () => {
          void cloneChannel(item);
        }, { marginLeft: '8px' });
        const deleteBtn = App.makeIconButton('delete', 'Delete Channel', () => deleteChannel(item), {
          danger: true,
          marginLeft: '8px',
        });
        actionsTd.appendChild(editBtn);
        actionsTd.appendChild(cloneBtn);
        actionsTd.appendChild(deleteBtn);
      } else {
        actionsTd.textContent = '-';
      }

      tr.appendChild(channelTd);
      tr.appendChild(userTd);
      tr.appendChild(emailTd);
      tr.appendChild(passwordTd);
      tr.appendChild(actionsTd);
      els.channelsTable.appendChild(tr);
    });
  }

  async function refresh() {
    if (!els.channelsTable) return;
    const result = await api('/api/channels');
    state.channels = result.channels || [];
    renderChannels();
  }

  function init() {
    state.channels = state.channels || [];

    fillPlatformSelect(byId('channelPlatformInput'));
    fillPlatformSelect(byId('channelEditPlatformInput'));
    fillPlatformFilterSelect(byId('channelsFilterPlatform'));

    const platformFilter = byId('channelsFilterPlatform');
    if (platformFilter) {
      platformFilter.addEventListener('change', () => {
        activePlatformFilter = safeText(platformFilter.value);
        syncPlatformFilterIcon();
        renderChannels();
      });
    }

    if (els.backFromEditChannelBtn) {
      els.backFromEditChannelBtn.addEventListener('click', () => {
        if (activeFilteredChannelType) {
          openFilteredChannelsPage(activeFilteredChannelType);
        } else {
          openChannelsPage();
        }
      });
    }
  }

  async function submitChannelCreate(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = els.channelForm;
    if (!form) return false;
    const formData = new FormData(form);
    const payload = {
      channel: String(formData.get('channel') || '').trim(),
      userName: String(formData.get('user_name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      password: String(formData.get('password') || '').trim(),
      channelType: activeFilteredChannelType || 'organic',
      contactId: formData.get('contact_id') || null,
    };

    try {
      await api('/api/channels', { method: 'POST', body: JSON.stringify(payload) });
      notify('Channel created');
      form.reset();
      fillPlatformSelect(byId('channelPlatformInput'));
      await refresh();
      App.setActivePage('channelsPage');
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  async function submitChannelEdit(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = els.channelEditForm;
    if (!form) return false;
    const formData = new FormData(form);
    const channelId = Number(formData.get('id') || 0) || 0;
    if (!channelId) return notify('Channel id is required', true);

    const payload = {
      channel: String(formData.get('channel') || '').trim(),
      userName: String(formData.get('user_name') || '').trim(),
      email: String(formData.get('email') || '').trim(),
    };
    const cId = formData.get('contact_id');
    if (cId) payload.contactId = cId;
    const password = String(formData.get('password') || '');
    if (password.trim()) payload.password = password.trim();

    try {
      await api(`/api/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      notify('Channel updated');
      form.reset();
      await refresh();
      if (activeFilteredChannelType) {
        openFilteredChannelsPage(activeFilteredChannelType);
      } else {
        openChannelsPage();
      }
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  return {
    manifest: { id: 'channels', label: 'Channels', pageId: 'channelsPage' },
    init,
    openChannelsPage,
    openFilteredChannelsPage,
    refresh,
    submitChannelCreate,
    submitChannelEdit,
    onPageActivated: refresh,
  };
})();
