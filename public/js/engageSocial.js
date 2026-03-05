window.App = window.App || {};

App.engageSocial = (function () {
  const { api, notify } = App;

  function el(id) {
    return document.getElementById(id);
  }

  function toIsoFromLocal(localValue) {
    const raw = String(localValue || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
  }

  function formatDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString();
  }

  function statusClass(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'published') return 'status-ok';
    if (value === 'failed') return 'status-bad';
    return 'status-warn';
  }

  function renderStatus(status) {
    const badge = el('engageSocialXStatus');
    const name = el('engageSocialAccountName');
    if (badge) {
      badge.className = `status-pill ${status?.configured ? 'status-ok' : 'status-bad'}`;
      badge.textContent = status?.configured ? 'Connected' : 'Not Connected';
    }
    if (name) {
      name.textContent = String(status?.accountName || '').trim() || '-';
    }
  }

  function renderCharCount() {
    const textarea = el('engageSocialText');
    const counter = el('engageSocialCharCount');
    const queueBtn = el('engageSocialQueueBtn');
    const publishBtn = el('engageSocialPublishNowBtn');
    if (!textarea || !counter) return;
    const length = String(textarea.value || '').length;
    counter.textContent = `${length} / 280`;
    counter.classList.toggle('engage-social-counter-over', length > 280);
    if (queueBtn) queueBtn.disabled = length > 280;
    if (publishBtn) publishBtn.disabled = length > 280;
  }

  function renderPosts(posts) {
    const tbody = el('engageSocialPostsTable');
    const scheduledCount = el('engageSocialScheduledCount');
    const failedCount = el('engageSocialFailedCount');
    const publishedCount = el('engageSocialPublishedCount');
    if (!tbody) return;

    const rows = Array.isArray(posts) ? posts : [];
    if (scheduledCount) scheduledCount.textContent = String(rows.filter((p) => p.status === 'scheduled' || p.status === 'queued' || p.status === 'publishing').length);
    if (failedCount) failedCount.textContent = String(rows.filter((p) => p.status === 'failed').length);
    if (publishedCount) publishedCount.textContent = String(rows.filter((p) => p.status === 'published').length);

    tbody.innerHTML = '';
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = 'No X posts yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((post) => {
      const tr = document.createElement('tr');

      const statusTd = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `status-pill ${statusClass(post.status)}`;
      pill.textContent = String(post.status || 'scheduled');
      statusTd.appendChild(pill);
      if (post.error) {
        const err = document.createElement('div');
        err.className = 'meta';
        err.style.marginTop = '6px';
        err.textContent = post.error;
        statusTd.appendChild(err);
      }
      tr.appendChild(statusTd);

      const scheduledTd = document.createElement('td');
      scheduledTd.textContent = formatDate(post.scheduledFor || post.createdAt);
      tr.appendChild(scheduledTd);

      const publishedTd = document.createElement('td');
      publishedTd.textContent = formatDate(post.publishedAt);
      tr.appendChild(publishedTd);

      const textTd = document.createElement('td');
      textTd.textContent = String(post.text || '');
      tr.appendChild(textTd);

      const remoteTd = document.createElement('td');
      remoteTd.textContent = String(post.remoteId || '-');
      tr.appendChild(remoteTd);

      const actionsTd = document.createElement('td');
      const canPublish = post.status !== 'published' && post.status !== 'publishing';
      if (canPublish) {
        const publishBtn = App.makeIconButton('publish', 'Publish Now', async function () {
          try {
            await api(`/api/engage/social/posts/${encodeURIComponent(post.id)}/publish`, { method: 'POST' });
            notify('X post published');
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

  async function refresh() {
    const [statusRes, postsRes] = await Promise.all([
      api('/api/engage/social/x/status'),
      api('/api/engage/social/posts'),
    ]);
    renderStatus(statusRes);
    renderPosts(postsRes.posts || []);
    renderCharCount();
  }

  async function submitComposer(publishNow) {
    const textarea = el('engageSocialText');
    const schedule = el('engageSocialSchedule');
    if (!textarea) return;

    const text = String(textarea.value || '').trim();
    const scheduledFor = toIsoFromLocal(schedule?.value || '');
    if (!text) {
      notify('Post text is required', true);
      return;
    }

    try {
      await api('/api/engage/social/posts', {
        method: 'POST',
        body: JSON.stringify({ text, scheduledFor, publishNow: !!publishNow }),
      });
      notify(publishNow ? 'X post published' : 'X post added to queue');
      textarea.value = '';
      if (schedule) schedule.value = '';
      renderCharCount();
      await refresh();
    } catch (err) {
      notify(err.message, true);
      await refresh();
    }
  }

  function init() {
    const form = el('engageSocialComposerForm');
    const text = el('engageSocialText');
    const publishNowBtn = el('engageSocialPublishNowBtn');
    const publishDueBtn = el('engageSocialPublishDueBtn');
    const openSettingsBtn = el('engageSocialOpenSettingsBtn');

    if (text) {
      text.addEventListener('input', renderCharCount);
    }

    if (form) {
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        await submitComposer(false);
      });
    }

    if (publishNowBtn) {
      publishNowBtn.addEventListener('click', async function () {
        await submitComposer(true);
      });
    }

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
        } else {
          const providerSelect = document.getElementById('apiProviderSelect');
          if (providerSelect) {
            providerSelect.value = 'x';
            if (typeof App.settings?.renderApiFieldInputs === 'function') {
              App.settings.renderApiFieldInputs();
            }
          }
        }
      });
    }
  }

  return {
    manifest: { id: 'engageSocial', label: 'Engage Social', pageId: 'engageSocialPage' },
    init,
    refresh,
    onPageActivated: refresh,
  };
})();
