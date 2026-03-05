window.App = window.App || {};

App.channels = (function () {
  const { state, els, api, notify } = App;

  function safeText(value) {
    return String(value || '').trim();
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

    return '';
  }

  function openEditPage(item) {
    const id = Number(item?.id || 0) || 0;
    if (!id || !els.channelEditForm) {
      return notify('Channel id is missing', true);
    }

    els.channelEditForm.reset();
    if (els.channelEditId) els.channelEditId.value = String(id);
    els.channelEditForm.channel.value = String(item.channel || '');
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

  function renderChannels() {
    if (!els.channelsTable) return;
    els.channelsTable.innerHTML = '';
    (state.channels || []).forEach((item) => {
      const tr = document.createElement('tr');

      const channelTd = document.createElement('td');
      channelTd.textContent = item.channel || '-';

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
      const id = Number(item.id || 0) || 0;
      if (id > 0) {
        const editBtn = App.makeIconButton('edit', 'Edit Channel', () => openEditPage(item));
        const deleteBtn = App.makeIconButton('delete', 'Delete Channel', () => deleteChannel(item), { danger: true, marginLeft: '8px' });

        actionsTd.appendChild(editBtn);
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

    if (els.openAddChannelPageBtn) {
      els.openAddChannelPageBtn.addEventListener('click', () => {
        if (els.channelForm) els.channelForm.reset();
        App.setActivePage('addChannelPage');
      });
    }

    if (els.backToChannelsBtn) {
      els.backToChannelsBtn.addEventListener('click', () => {
        App.setActivePage('channelsPage');
      });
    }

    if (els.backFromEditChannelBtn) {
      els.backFromEditChannelBtn.addEventListener('click', () => {
        App.setActivePage('channelsPage');
      });
    }

    if (els.channelForm) {
      els.channelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(els.channelForm);
        const payload = {
          channel: String(formData.get('channel') || '').trim(),
          userName: String(formData.get('user_name') || '').trim(),
          email: String(formData.get('email') || '').trim(),
          password: String(formData.get('password') || '').trim(),
        };

        try {
          await api('/api/channels', { method: 'POST', body: JSON.stringify(payload) });
          notify('Channel created');
          els.channelForm.reset();
          await refresh();
          App.setActivePage('channelsPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    if (els.channelEditForm) {
      els.channelEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(els.channelEditForm);
        const channelId = Number(formData.get('id') || 0) || 0;
        if (!channelId) return notify('Channel id is required', true);

        const payload = {
          channel: String(formData.get('channel') || '').trim(),
          userName: String(formData.get('user_name') || '').trim(),
          email: String(formData.get('email') || '').trim(),
        };
        const password = String(formData.get('password') || '');
        if (password.trim()) {
          payload.password = password.trim();
        }

        try {
          await api(`/api/channels/${channelId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          notify('Channel updated');
          els.channelEditForm.reset();
          await refresh();
          App.setActivePage('channelsPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
  }

  return {
    manifest: { id: 'channels', label: 'Channels', pageId: 'channelsPage' },
    init,
    refresh,
    onPageActivated: refresh,
  };
})();
