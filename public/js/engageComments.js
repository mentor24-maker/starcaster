window.App = window.App || {};

App.engageComments = (function () {
  const { api, notify } = App;

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  function setStatus(message, isError = false) {
    const el = byId('engageCommentsStatus');
    if (!el) return;
    el.textContent = safeText(message);
    el.style.color = isError ? '#b00020' : '';
  }

  function renderPreview(payload) {
    const el = byId('engageCommentsPreview');
    if (!el) return;
    el.textContent = JSON.stringify(payload || {}, null, 2);
  }

  async function refreshStatus() {
    try {
      setStatus('Checking Reddit connection...');
      const res = await api('/api/engage/reddit/status');
      const status = res?.status || res?.data || {};
      renderPreview({ status });
      if (status?.configured) {
        setStatus(status?.authOk ? 'Reddit configured and authenticated.' : 'Reddit configured. Authentication check failed.');
      } else {
        setStatus('Reddit API is not configured in Settings > APIs.', true);
      }
    } catch (err) {
      setStatus(err.message || 'Reddit status check failed', true);
      renderPreview({ ok: false, error: err.message || 'Status check failed' });
    }
  }

  async function postComment() {
    const target = safeText(byId('engageCommentsTargetInput')?.value);
    const targetKind = safeText(byId('engageCommentsTargetKindSelect')?.value) || 'post';
    const submitMode = safeText(byId('engageCommentsSubmitModeSelect')?.value) || 'reddit_api';
    const text = safeText(byId('engageCommentsBodyInput')?.value);
    if (!target) return setStatus('Target URL or thing ID is required.', true);
    if (!text) return setStatus('Comment text is required.', true);
    try {
      const useOpenClaw = submitMode === 'openclaw';
      setStatus(useOpenClaw ? 'Queueing OpenClaw Reddit comment job...' : 'Posting Reddit comment...');
      const res = await api(useOpenClaw ? '/api/engage/reddit/comment-openclaw' : '/api/engage/reddit/comment', {
        method: 'POST',
        body: JSON.stringify({ target, targetKind, text }),
      });
      const payload = res?.result || res?.data || res;
      renderPreview(payload);
      if (useOpenClaw) {
        setStatus('OpenClaw Reddit comment job queued.');
        notify('OpenClaw Reddit comment job queued');
      } else {
        setStatus('Reddit comment posted.');
        notify('Reddit comment posted');
      }
    } catch (err) {
      setStatus(err.message || 'Failed to post Reddit comment', true);
      notify(err.message || 'Failed to post Reddit comment', true);
    }
  }

  function init() {
    const form = byId('engageCommentsForm');
    const statusBtn = byId('engageCommentsStatusBtn');
    const settingsBtn = byId('engageCommentsOpenSettingsBtn');

    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        postComment();
      });
    }
    if (statusBtn) {
      statusBtn.addEventListener('click', () => {
        refreshStatus();
      });
    }
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        App.setActivePage('settingsApisPage');
      });
    }
  }

  return {
    manifest: { id: 'engageComments', label: 'Engage Comments', pageId: 'engageCommentResponsesPage' },
    init,
    refresh: async function refresh() {},
    onPageActivated: async function onPageActivated() {
      await refreshStatus();
    },
  };
})();
