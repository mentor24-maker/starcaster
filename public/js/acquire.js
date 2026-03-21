/**
 * public/js/acquire.js
 * Acquire jobs table, direct web acquire, and OpenClaw job lifecycle actions.
 */

window.App = window.App || {};
App.acquire = (function () {
  const { state, els, api, notify, setPreview, prettyJson } = App;
  let redditHarvestProgressTimer = null;
  let lastRedditDiscoveryResult = null;
  let lastBlueskyDiscoveryResult = null;

  // -------------------------------------------------------------------------
  // Stage helpers
  // -------------------------------------------------------------------------

  function stageClass(stage, isBusy = false) {
    if (isBusy || stage === 'RUNNING') return 'status-warn';
    if (stage === 'COMPLETED') return 'status-ok';
    if (stage === 'REJECTED') return 'status-bad';
    return 'status-warn';
  }

  function isActionAllowed(stage, action) {
    const s = String(stage || '').toUpperCase();
    if (!s) return true;
    if (action === 'run')         return s === 'PENDING_PREVIEW' || s === 'PENDING_APPROVAL' || s === 'APPROVED';
    if (action === 'preview_job') return s === 'PENDING_PREVIEW';
    if (action === 'approve_job') return s === 'PENDING_APPROVAL';
    if (action === 'execute_job') return s === 'APPROVED';
    return true;
  }

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  function upsertHarvestJobState(job) {
    if (!job || !job.id) return;
    const idx = state.acquireJobs.findIndex((j) => String(j.id) === String(job.id));
    if (idx >= 0) {
      state.acquireJobs[idx] = { ...state.acquireJobs[idx], ...job };
    } else {
      state.acquireJobs.unshift(job);
    }
    state.acquireJobs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  function deriveHarvestJobFromResponse(built, response) {
    const result = response?.result || {};
    const id = result?.job?.id || result?.job_id || built?.request?.job_id;
    if (!id) return null;
    const stage = result?.job?.status || result?.status || '';
    const urls = built?.request?.payload && Array.isArray(built.request.payload.source_urls)
      ? built.request.payload.source_urls : [];
    return {
      id: String(id),
      stage: String(stage || ''),
      url: String(urls[0] || ''),
      workspace_id: String(built?.request?.workspace_id || ''),
      type: String(built?.request?.type || ''),
      updated_at: new Date().toISOString()
    };
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function renderHarvestJobsTable() {
    if (!els.acquireJobsTable) return;
    els.acquireJobsTable.innerHTML = '';

    if (!state.acquireJobs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No jobs yet. Create one above to populate this list.';
      tr.appendChild(td);
      els.acquireJobsTable.appendChild(tr);
      return;
    }

    state.acquireJobs.forEach((job) => {
      const tr = document.createElement('tr');
      const stageValue = String(job.stage || '').toUpperCase();
      const isBusy = Boolean(state.acquireBusyByJob[job.id]);

      const idTd = document.createElement('td');
      idTd.textContent = job.id || '-';
      tr.appendChild(idTd);

      const stageTd = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `status-pill ${stageClass(stageValue, isBusy)}`;
      pill.textContent = isBusy ? 'RUNNING...' : (stageValue || '-');
      stageTd.appendChild(pill);
      tr.appendChild(stageTd);

      const urlTd = document.createElement('td');
      urlTd.textContent = job.url || '-';
      tr.appendChild(urlTd);

      const updatedTd = document.createElement('td');
      updatedTd.textContent = job.updated_at || '-';
      tr.appendChild(updatedTd);

      const actionsTd = document.createElement('td');

      const mkBtn = (label, onClick, enabled = true) => {
        const iconMap = {
          Load: 'load',
          Run: 'run',
          Status: 'status',
          Preview: 'preview',
          Approve: 'approve',
        };
        const btn = App.makeIconButton(iconMap[label] || 'view', label, onClick, { disabled: !enabled, marginRight: '6px' });
        return btn;
      };

      actionsTd.appendChild(mkBtn('Load', () => {
        if (job.id && els.acquireJobIdInput) els.acquireJobIdInput.value = job.id;
        if (job.url) {
          const src = els.acquireForm?.querySelector('textarea[name="source_urls"]');
          if (src) src.value = job.url;
        }
        notify(`Loaded ${job.id}`);
      }, !isBusy));

      actionsTd.appendChild(mkBtn('Run', () => runHarvestRowSequence(job), !isBusy && isActionAllowed(stageValue, 'run')));
      actionsTd.appendChild(mkBtn('Status',  () => runHarvestRowAction('job_status',  job), !isBusy));
      actionsTd.appendChild(mkBtn('Preview', () => runHarvestRowAction('preview_job', job), !isBusy && isActionAllowed(stageValue, 'preview_job')));
      actionsTd.appendChild(mkBtn('Approve', () => runHarvestRowAction('approve_job', job), !isBusy && isActionAllowed(stageValue, 'approve_job')));
      actionsTd.appendChild(mkBtn('Execute', () => runHarvestRowAction('execute_job', job), !isBusy && isActionAllowed(stageValue, 'execute_job')));
      actionsTd.appendChild(mkBtn('Delete', async () => {
        if (!confirm(`Delete ${job.id} from jobs list?`)) return;
        try {
          await api(`/api/acquire/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
          state.acquireJobs = state.acquireJobs.filter((j) => String(j.id) !== String(job.id));
          renderHarvestJobsTable();
          notify(`Deleted ${job.id}`);
        } catch (err) { notify(err.message, true); }
      }, !isBusy));

      tr.appendChild(actionsTd);
      els.acquireJobsTable.appendChild(tr);
    });
  }

  function renderDirectHarvestRunsTable() {
    if (!els.directAcquireRunsTable) return;
    els.directAcquireRunsTable.innerHTML = '';
    if (!state.directAcquireRuns.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No direct runs yet.';
      tr.appendChild(td); els.directAcquireRunsTable.appendChild(tr); return;
    }
    state.directAcquireRuns.forEach((run) => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => loadDirectHarvestRun(run.run_id).catch((e) => notify(e.message, true)));
      [run.run_id||'-', run.source_url||'-', String(run.pages_succeeded??'-'), String(run.pages_failed??'-'), run.finished_at||'-']
        .forEach((text) => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
      els.directAcquireRunsTable.appendChild(tr);
    });
  }

  function renderDirectHarvestPagesTable() {
    if (!els.directAcquirePagesTable) return;
    els.directAcquirePagesTable.innerHTML = '';
    const run = state.directAcquireCurrentRun;
    const pages = Array.isArray(run?.pages) ? run.pages : [];
    if (!pages.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No parsed pages loaded yet.';
      tr.appendChild(td); els.directAcquirePagesTable.appendChild(tr);
    } else {
      pages.forEach((page) => {
        const tr = document.createElement('tr');
        [page.url||'-', page.title||'-',
         Array.isArray(page.emails)?page.emails.join(', ')||'-':'-',
         Array.isArray(page.phones)?page.phones.join(', ')||'-':'-',
         page.body_snippet||'-'
        ].forEach((text) => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
        els.directAcquirePagesTable.appendChild(tr);
      });
    }
    if (els.directAcquireErrorsPreview) {
      const errors = Array.isArray(run?.errors) ? run.errors : [];
      els.directAcquireErrorsPreview.textContent = errors.length ? prettyJson({ errors }) : '{}';
      els.directAcquireErrorsPreview.classList.toggle('hidden', !errors.length);
    }
  }

  function buildUserIndex(users) {
    const map = new Map();
    (Array.isArray(users) ? users : []).forEach((user) => {
      const id = String(user && user.id || '').trim();
      if (!id) return;
      map.set(id, user);
    });
    return map;
  }

  function toIsoFromLocal(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
  }

  function estimateRedditHarvestSeconds(payload) {
    const mode = String(payload?.mode || 'auto');
    const maxPosts = Number(payload?.max_posts || 0);
    const maxComments = Number(payload?.max_comments || 0);
    const includeReplies = !!payload?.include_replies;
    let estimate = 18;
    if (mode === 'post') {
      estimate += Math.ceil(maxComments * 0.18);
    } else {
      estimate += Math.ceil(maxPosts * 0.9);
      estimate += Math.ceil(maxComments * 0.12);
    }
    if (includeReplies) estimate += 24;
    return Math.max(30, Math.min(900, estimate));
  }

  function setRedditHarvestProgress(percent, text) {
    const wrap = document.getElementById('redditHarvestProgressWrap');
    const bar = document.getElementById('redditHarvestProgressBar');
    const label = document.getElementById('redditHarvestProgressText');
    if (!wrap || !bar || !label) return;
    wrap.classList.remove('hidden');
    bar.value = Math.max(0, Math.min(100, Number(percent) || 0));
    label.textContent = String(text || '').trim() || 'Running…';
  }

  function clearRedditHarvestProgress() {
    if (redditHarvestProgressTimer) {
      clearInterval(redditHarvestProgressTimer);
      redditHarvestProgressTimer = null;
    }
  }

  function beginRedditHarvestProgress(payload) {
    clearRedditHarvestProgress();
    const startedAt = Date.now();
    const estimateSeconds = estimateRedditHarvestSeconds(payload);
    setRedditHarvestProgress(4, 'Queued request (phase 1 of 3)…');
    setRedditHarvestProgress(12, `Running OpenClaw harvest (phase 2 of 3)… ~${estimateSeconds}s remaining (estimated)`);
    redditHarvestProgressTimer = setInterval(() => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const remainingSeconds = Math.max(0, estimateSeconds - elapsedSeconds);
      const ratio = estimateSeconds > 0 ? Math.min(1, elapsedSeconds / estimateSeconds) : 0;
      const pct = Math.min(92, 12 + Math.round(ratio * 80));
      const eta = remainingSeconds > 0 ? `~${remainingSeconds}s remaining (estimated)` : 'finalizing…';
      setRedditHarvestProgress(pct, `Running OpenClaw harvest (phase 2 of 3)… ${eta}`);
    }, 1000);
    return {
      finishSuccess() {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        clearRedditHarvestProgress();
        setRedditHarvestProgress(100, `Completed in ${elapsedSeconds}s.`);
      },
      finishError(message) {
        clearRedditHarvestProgress();
        setRedditHarvestProgress(100, `Stopped: ${safeText(message) || 'request failed'}`);
      },
    };
  }

  function renderXHarvestItemsTable() {
    if (!els.xHarvestItemsTable) return;
    els.xHarvestItemsTable.innerHTML = '';
    const run = state.xHarvestCurrentRun;
    const result = run && run.result ? run.result : null;
    const tweets = Array.isArray(result && result.tweets) ? result.tweets : [];
    const replies = Array.isArray(result && result.replies) ? result.replies : [];
    const usersById = buildUserIndex(result && result.users);
    const rows = []
      .concat(tweets.map((item) => ({ type: 'tweet', item })))
      .concat(replies.map((item) => ({ type: 'reply', item })));

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No tweets/replies loaded yet.';
      tr.appendChild(td);
      els.xHarvestItemsTable.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const tweet = row.item || {};
        const tr = document.createElement('tr');
        const author = usersById.get(String(tweet.author_id || '').trim()) || {};
        const cells = [
          row.type,
          String(tweet.id || ''),
          String(author.username || author.name || tweet.author_id || '-'),
          String(tweet.created_at || '-'),
          String(tweet.text || '').trim(),
        ];
        cells.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value || '-';
          tr.appendChild(td);
        });
        els.xHarvestItemsTable.appendChild(tr);
      });
    }

    if (els.xHarvestRawPreview) {
      els.xHarvestRawPreview.textContent = run ? prettyJson(run) : '{}';
    }
  }

  function renderRedditHarvestItemsTable() {
    if (!els.redditHarvestItemsTable) return;
    els.redditHarvestItemsTable.innerHTML = '';
    const run = state.redditHarvestCurrentRun;
    const result = run && run.result ? run.result : null;
    const posts = Array.isArray(result && result.posts) ? result.posts : [];
    const primaryPost = (result && result.post) ? result.post : (posts[0] || null);
    App.setKeyValueRows(els.redditHarvestPostDetailsBody, primaryPost ? [
      ['Title', String(primaryPost.title || '').trim() || '-'],
      ['Subreddit', String(primaryPost.subreddit || run?.subreddit || '-')],
      ['Author', String(primaryPost.author || '-')],
      ['Score', String(primaryPost.score != null ? primaryPost.score : '-')],
      ['Created', String(primaryPost.created_utc ? new Date(Number(primaryPost.created_utc) * 1000).toISOString() : '-')],
      ['Permalink', String(primaryPost.permalink ? `https://www.reddit.com${primaryPost.permalink}` : '-')],
    ] : [
      ['Post', 'No post details loaded yet.'],
    ]);
    const comments = Array.isArray(result && result.comments) ? result.comments : [];
    const rows = []
      .concat(posts.map((item) => ({ type: 'post', item })))
      .concat(comments.map((item) => ({ type: 'comment', item })));

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No posts/comments loaded yet.';
      tr.appendChild(td);
      els.redditHarvestItemsTable.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const item = row.item || {};
        const tr = document.createElement('tr');
        const cols = [
          row.type,
          String(item.id || item.name || ''),
          String(item.author || '-'),
          String(item.score != null ? item.score : '-'),
          row.type === 'post' ? String(item.title || item.selftext || '').trim() : String(item.body || '').trim(),
        ];
        cols.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value || '-';
          tr.appendChild(td);
        });
        els.redditHarvestItemsTable.appendChild(tr);
      });
    }

    if (els.redditHarvestRawPreview) {
      els.redditHarvestRawPreview.textContent = run ? prettyJson(run) : '{}';
    }
  }

  function setRedditDiscoveryStatus(message, isError = false) {
    const el = document.getElementById('redditDiscoveryStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'Reddit discovery is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setRedditReplyStatus(message, isError = false) {
    const el = document.getElementById('redditReplyStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'Reddit reply generation is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyDiscoveryStatus(message, isError = false) {
    const el = document.getElementById('blueskyDiscoveryStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky discovery is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyReplyStatus(message, isError = false) {
    const el = document.getElementById('blueskyReplyStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky reply generation is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyPostingStatus(message, isError = false) {
    const el = document.getElementById('blueskyPostingStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky posting operator is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function renderBlueskyDiscoveryTable(result) {
    const tbody = document.getElementById('blueskyDiscoveryTable');
    const repliesTbody = document.getElementById('blueskyDiscoveryRepliesTable');
    const preview = document.getElementById('blueskyDiscoveryPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    if (repliesTbody) repliesTbody.innerHTML = '';
    lastBlueskyDiscoveryResult = result || null;
    const rows = Array.isArray(result?.candidates) ? result.candidates : [];
    const threadReplies = Array.isArray(result?.thread_replies) ? result.thread_replies : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 9;
      td.textContent = 'No BlueSky post candidates loaded yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      if (repliesTbody) {
        const replyTr = document.createElement('tr');
        const replyTd = document.createElement('td');
        replyTd.colSpan = 5;
        replyTd.textContent = 'No BlueSky thread replies loaded yet.';
        replyTr.appendChild(replyTd);
        repliesTbody.appendChild(replyTr);
      }
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');
      const cols = [
        String(item.discovery_score != null ? item.discovery_score : item.reply_opportunity || '-'),
        String(item.author_handle || item.author_display_name || '-'),
        String(item.text || item.post_url || '-'),
        String(item.like_count != null ? item.like_count : '-'),
        String(item.reply_count != null ? item.reply_count : '-'),
        String(item.repost_count != null ? item.repost_count : '-'),
        String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
        String(item.why_relevant || '-'),
      ];
      cols.forEach((value, idx) => {
        const td = document.createElement('td');
        if (idx === 2 && item.post_url) {
          const a = document.createElement('a');
          a.href = item.post_url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = value || '-';
          td.appendChild(a);
        } else {
          td.textContent = value || '-';
        }
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const useBtn = App.makeIconButton('copy', 'Use In Reply', () => {
        const replyTarget = document.getElementById('blueskyReplyTarget');
        const postingTarget = document.getElementById('blueskyPostingTarget');
        const nextValue = String(item.post_url || '').trim();
        if (replyTarget) replyTarget.value = nextValue;
        if (postingTarget) postingTarget.value = nextValue;
        notify('Copied BlueSky target into reply and posting forms');
      }, { primary: true });
      actionsTd.appendChild(useBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    if (repliesTbody) {
      if (!threadReplies.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = 'No thread replies loaded for the current target.';
        tr.appendChild(td);
        repliesTbody.appendChild(tr);
      } else {
        threadReplies.forEach((item) => {
          const tr = document.createElement('tr');
          [
            String(item.author_handle || item.author_display_name || '-'),
            String(item.text || '-'),
            String(item.like_count != null ? item.like_count : '-'),
            String(item.reply_count != null ? item.reply_count : '-'),
            String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
          ].forEach((value) => {
            const td = document.createElement('td');
            td.textContent = value || '-';
            tr.appendChild(td);
          });
          repliesTbody.appendChild(tr);
        });
      }
    }
  }

  function renderBlueskyReplyCandidates(result) {
    const tbody = document.getElementById('blueskyReplyCandidatesTable');
    const preview = document.getElementById('blueskyReplyCandidatesPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(result?.replies) ? result.replies : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No BlueSky reply candidates generated yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((item) => {
      const tr = document.createElement('tr');
      [
        String(item && item.text || '-'),
        String(item && item.tone || '-'),
        String(item && item.why || '-'),
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function renderRedditDiscoveryTable(result) {
    const tbody = document.getElementById('redditDiscoveryTable');
    const preview = document.getElementById('redditDiscoveryPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';

    lastRedditDiscoveryResult = result || null;
    const rows = Array.isArray(result?.candidates) ? result.candidates : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 9;
      td.textContent = 'No Reddit thread candidates found for the current filters.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');
      const cols = [
        String(item.discovery_score != null ? item.discovery_score : '-'),
        String(item.subreddit || '-'),
        String(item.title || item.discussion_url || '-'),
        String(item.author || '-'),
        String(item.score != null ? item.score : '-'),
        String(item.num_comments != null ? item.num_comments : '-'),
        String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
        Array.isArray(item.reasons) ? item.reasons.join(', ') : '-',
      ];
      cols.forEach((value, idx) => {
        const td = document.createElement('td');
        if (idx === 2 && item.discussion_url) {
          const a = document.createElement('a');
          a.href = item.discussion_url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = value || '-';
          td.appendChild(a);
        } else {
          td.textContent = value || '-';
        }
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const harvestBtn = App.makeIconButton('copy', 'Use In Harvest', () => {
        const harvestTarget = document.getElementById('redditHarvestTarget');
        const discoveryTarget = document.getElementById('redditDiscoveryTarget');
        const replyTarget = document.getElementById('redditReplyTarget');
        const nextValue = String(item.discussion_url || '').trim() || String(item.subreddit ? `https://www.reddit.com/r/${item.subreddit}` : '').trim();
        if (harvestTarget) harvestTarget.value = nextValue;
        if (discoveryTarget && !discoveryTarget.value) discoveryTarget.value = nextValue;
        if (replyTarget) replyTarget.value = nextValue;
        notify('Copied Reddit thread target into harvest form');
      }, { primary: true });
      const replyBtn = App.makeIconButton('messages', 'Generate Replies', async () => {
        const replyTarget = document.getElementById('redditReplyTarget');
        if (replyTarget) replyTarget.value = String(item.discussion_url || '').trim();
        try {
          await runRedditReplyCandidates(String(item.discussion_url || '').trim());
          notify('Reddit reply candidates generated');
        } catch (err) {
          setRedditReplyStatus(err.message || 'Could not generate Reddit replies', true);
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      actionsTd.appendChild(harvestBtn);
      actionsTd.appendChild(replyBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderRedditReplyCandidates(result) {
    const tbody = document.getElementById('redditReplyCandidatesTable');
    const preview = document.getElementById('redditReplyCandidatesPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(result?.replies) ? result.replies : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No Reddit reply candidates generated yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((item) => {
      const tr = document.createElement('tr');
      [
        String(item && item.text || '-'),
        String(item && item.tone || '-'),
        String(item && item.why || '-'),
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function renderXHarvestRunsTable() {
    if (!els.xHarvestRunsTable) return;
    els.xHarvestRunsTable.innerHTML = '';
    const runs = Array.isArray(state.xHarvestRuns) ? state.xHarvestRuns : [];
    if (!runs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No X harvest runs yet.';
      tr.appendChild(td);
      els.xHarvestRunsTable.appendChild(tr);
      return;
    }

    runs.forEach((run) => {
      const tr = document.createElement('tr');
      const cols = [
        String(run.run_id || ''),
        String(run.created_at || ''),
        String(run.query || '').trim() || (Array.isArray(run.hashtags) ? run.hashtags.map((tag) => `#${tag}`).join(' ') : '-'),
        String(run.total_tweets != null ? run.total_tweets : '-'),
        String(run.total_replies != null ? run.total_replies : '-'),
        String(run.errors != null ? run.errors : '-'),
      ];
      cols.forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });
      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'Load', () => {
        loadXHarvestRun(run.run_id).catch((err) => notify(err.message, true));
      }, { marginRight: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete', async () => {
        if (!confirm(`Delete X run ${run.run_id}?`)) return;
        try {
          await api(`/api/acquire/x-runs/${encodeURIComponent(run.run_id)}`, { method: 'DELETE' });
          state.xHarvestRuns = state.xHarvestRuns.filter((item) => String(item.run_id) !== String(run.run_id));
          if (String(state.xHarvestCurrentRun && state.xHarvestCurrentRun.run_id || '') === String(run.run_id)) {
            state.xHarvestCurrentRun = null;
            renderXHarvestItemsTable();
          }
          renderXHarvestRunsTable();
          notify('X harvest run deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      els.xHarvestRunsTable.appendChild(tr);
    });
  }

  function renderRedditHarvestRunsTable() {
    if (!els.redditHarvestRunsTable) return;
    els.redditHarvestRunsTable.innerHTML = '';
    const runs = Array.isArray(state.redditHarvestRuns) ? state.redditHarvestRuns : [];
    if (!runs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No Reddit harvest runs yet.';
      tr.appendChild(td);
      els.redditHarvestRunsTable.appendChild(tr);
      return;
    }

    runs.forEach((run) => {
      const tr = document.createElement('tr');
      const cols = [
        String(run.run_id || ''),
        String(run.created_at || ''),
        String(run.mode || ''),
        String(run.subreddit || run.target || ''),
        String(run.total_posts != null ? run.total_posts : '-'),
        String(run.total_comments != null ? run.total_comments : '-'),
      ];
      cols.forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'Load', () => {
        loadRedditHarvestRun(run.run_id).catch((err) => notify(err.message, true));
      }, { marginRight: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete', async () => {
        if (!confirm(`Delete Reddit run ${run.run_id}?`)) return;
        try {
          await api(`/api/acquire/reddit-runs/${encodeURIComponent(run.run_id)}`, { method: 'DELETE' });
          state.redditHarvestRuns = state.redditHarvestRuns.filter((item) => String(item.run_id) !== String(run.run_id));
          if (String(state.redditHarvestCurrentRun && state.redditHarvestCurrentRun.run_id || '') === String(run.run_id)) {
            state.redditHarvestCurrentRun = null;
            renderRedditHarvestItemsTable();
          }
          renderRedditHarvestRunsTable();
          notify('Reddit harvest run deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      els.redditHarvestRunsTable.appendChild(tr);
    });
  }

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  async function refreshHarvestJobs() {
    if (!els.acquireJobsTable) return;
    const res = await api('/api/acquire/jobs?limit=200');
    const fetched = Array.isArray(res.jobs) ? res.jobs : [];
    const byId = new Map();
    state.acquireJobs.forEach((j) => { if (j?.id) byId.set(String(j.id), j); });
    fetched.forEach((j) => {
      if (!j?.id) return;
      byId.set(String(j.id), { ...(byId.get(String(j.id)) || {}), ...j });
    });
    state.acquireJobs = Array.from(byId.values())
      .sort((a, b) => String(b.updated_at||'').localeCompare(String(a.updated_at||'')))
      .slice(0, 200);
    renderHarvestJobsTable();
  }

  async function refreshDirectHarvestRuns() {
    if (!els.directAcquireRunsTable) return;
    const res = await api('/api/acquire/direct-runs?limit=20');
    state.directAcquireRuns = Array.isArray(res.runs) ? res.runs : [];
    renderDirectHarvestRunsTable();
  }

  async function refreshXHarvestRuns() {
    if (!els.xHarvestRunsTable) return;
    const res = await api('/api/acquire/x-runs?limit=50');
    state.xHarvestRuns = Array.isArray(res.runs) ? res.runs : [];
    renderXHarvestRunsTable();
  }

  async function refreshRedditHarvestRuns() {
    if (!els.redditHarvestRunsTable) return;
    const res = await api('/api/acquire/reddit-runs?limit=50');
    state.redditHarvestRuns = Array.isArray(res.runs) ? res.runs : [];
    renderRedditHarvestRunsTable();
  }

  async function runRedditDiscovery() {
    const form = document.getElementById('redditDiscoveryForm');
    if (!form) return;
    const formData = new FormData(form);
    const payload = {
      target: String(formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      sort: String(formData.get('sort') || 'new').trim().toLowerCase(),
      max_posts: Number(formData.get('max_posts') || 20) || 20,
      keyword: String(formData.get('keyword') || '').trim(),
      min_score: Number(formData.get('min_score') || 0) || 0,
      min_comments: Number(formData.get('min_comments') || 0) || 0,
      start_time: String(formData.get('start_time') || '').trim(),
      end_time: String(formData.get('end_time') || '').trim(),
    };
    if (!payload.target) throw new Error('Subreddit or post URL is required.');
    setRedditDiscoveryStatus('Discovering Reddit threads...');
    const res = await api('/api/engage/reddit/discovery', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderRedditDiscoveryTable(res);
    const count = Array.isArray(res.candidates) ? res.candidates.length : 0;
    setRedditDiscoveryStatus(`Loaded ${count} Reddit thread candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runRedditReplyCandidates(explicitTarget) {
    const form = document.getElementById('redditReplyCandidatesForm');
    if (!form) return null;
    const formData = new FormData(form);
    const payload = {
      target: String(explicitTarget || formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      comment_limit: Number(formData.get('comment_limit') || 8) || 8,
    };
    if (!payload.target) throw new Error('Reddit thread URL is required.');
    setRedditReplyStatus('Generating Reddit reply candidates...');
    const res = await api('/api/engage/reddit/reply-candidates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderRedditReplyCandidates(res);
    const count = Array.isArray(res.replies) ? res.replies.length : 0;
    setRedditReplyStatus(`Generated ${count} Reddit reply candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runBlueskyDiscovery() {
    const form = document.getElementById('blueskyDiscoveryForm');
    if (!form) return null;
    const formData = new FormData(form);
    const payload = {
      target: String(formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      sort: String(formData.get('sort') || 'new').trim().toLowerCase(),
      max_posts: Number(formData.get('max_posts') || 20) || 20,
      keyword: String(formData.get('keyword') || '').trim(),
      min_likes: Number(formData.get('min_likes') || 0) || 0,
      min_replies: Number(formData.get('min_replies') || 0) || 0,
      start_time: String(formData.get('start_time') || '').trim(),
      end_time: String(formData.get('end_time') || '').trim(),
    };
    if (!payload.target) throw new Error('Handle, feed, or BlueSky post URL is required.');
    setBlueskyDiscoveryStatus('Discovering BlueSky posts...');
    const res = await api('/api/engage/bluesky/discovery', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderBlueskyDiscoveryTable(res);
    const count = Array.isArray(res.candidates) ? res.candidates.length : 0;
    setBlueskyDiscoveryStatus(`Loaded ${count} BlueSky post candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runBlueskyReplyCandidates(explicitTarget) {
    const form = document.getElementById('blueskyReplyCandidatesForm');
    if (!form) return null;
    const formData = new FormData(form);
    const payload = {
      target: String(explicitTarget || formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      context_limit: Number(formData.get('context_limit') || 8) || 8,
    };
    if (!payload.target) throw new Error('BlueSky post URL is required.');
    setBlueskyReplyStatus('Generating BlueSky reply candidates...');
    const res = await api('/api/engage/bluesky/reply-candidates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderBlueskyReplyCandidates(res);
    const count = Array.isArray(res.replies) ? res.replies.length : 0;
    setBlueskyReplyStatus(`Generated ${count} BlueSky reply candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function loadDirectHarvestRun(runId) {
    const res = await api(`/api/acquire/direct-runs/${encodeURIComponent(runId)}`);
    state.directAcquireCurrentRun = res.run || null;
    renderDirectHarvestPagesTable();
  }

  async function loadXHarvestRun(runId) {
    const res = await api(`/api/acquire/x-runs/${encodeURIComponent(runId)}`);
    state.xHarvestCurrentRun = res.run || null;
    renderXHarvestItemsTable();
  }

  async function loadRedditHarvestRun(runId) {
    const res = await api(`/api/acquire/reddit-runs/${encodeURIComponent(runId)}`);
    state.redditHarvestCurrentRun = res.run || null;
    renderRedditHarvestItemsTable();
  }

  // -------------------------------------------------------------------------
  // OpenClaw actions
  // -------------------------------------------------------------------------

  async function runHarvestRowAction(action, job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) { notify('job_id is required', true); return; }
    try {
      state.acquireBusyByJob[jobId] = true;
      renderHarvestJobsTable();
      const request = {
        manual_confirmed: true,
        job_id: jobId,
        role: (action === 'approve_job' || action === 'execute_job') ? 'approver'
            : action === 'preview_job' ? 'marketer' : 'operator'
      };
      if (action === 'approve_job') request.decision = 'APPROVE';
      if (action === 'execute_job') {
        let token = String(els.acquireApprovalTokenInput?.value || '').trim();
        if (!token) token = String(prompt('Enter approval token for execute_job') || '').trim();
        if (!token) throw new Error('approval_token is required for execute_job');
        request.approval_token = token;
        if (els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = token;
      }
      const response = await api(`/api/openclaw/${action}`, { method: 'POST', body: JSON.stringify(request) });
      setPreview(els.acquireRequestPreview, { action, request });
      setPreview(els.acquireResponsePreview, response);
      const derived = deriveHarvestJobFromResponse({ action, request }, response);
      if (derived) upsertHarvestJobState(derived);
      renderHarvestJobsTable();
      await refreshHarvestJobs();
      const approvalToken = response?.result?.approval?.approval_token;
      if (approvalToken && els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = approvalToken;
      notify(`Acquire ${action} request sent`);
    } catch (err) {
      notify(err.message, true);
    } finally {
      delete state.acquireBusyByJob[jobId];
      renderHarvestJobsTable();
    }
  }

  async function runHarvestRowSequence(job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) { notify('job_id is required', true); return; }
    try {
      state.acquireBusyByJob[jobId] = true;
      renderHarvestJobsTable();

      const previewReq = { manual_confirmed: true, job_id: jobId, role: 'marketer' };
      const previewRes = await api('/api/openclaw/preview_job', { method: 'POST', body: JSON.stringify(previewReq) });
      setPreview(els.acquireRequestPreview, { action: 'preview_job', request: previewReq });
      setPreview(els.acquireResponsePreview, previewRes);

      const approveReq = { manual_confirmed: true, job_id: jobId, decision: 'APPROVE', role: 'approver' };
      const approveRes = await api('/api/openclaw/approve_job', { method: 'POST', body: JSON.stringify(approveReq) });
      setPreview(els.acquireRequestPreview, { action: 'approve_job', request: approveReq });
      setPreview(els.acquireResponsePreview, approveRes);

      const approvalToken = String(approveRes?.result?.approval?.approval_token || '').trim();
      if (!approvalToken) throw new Error('No approval token returned from approve_job');
      if (els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = approvalToken;

      const executeReq = { manual_confirmed: true, job_id: jobId, approval_token: approvalToken, role: 'approver' };
      const executeRes = await api('/api/openclaw/execute_job', { method: 'POST', body: JSON.stringify(executeReq) });
      setPreview(els.acquireRequestPreview, { action: 'execute_job', request: executeReq });
      setPreview(els.acquireResponsePreview, executeRes);

      const derived = deriveHarvestJobFromResponse({ action: 'execute_job', request: executeReq }, executeRes);
      if (derived) upsertHarvestJobState(derived);
      renderHarvestJobsTable();
      await refreshHarvestJobs();
      notify(`Acquire run completed for ${jobId}`);
    } catch (err) {
      notify(err.message, true);
    } finally {
      delete state.acquireBusyByJob[jobId];
      renderHarvestJobsTable();
    }
  }

  // -------------------------------------------------------------------------
  // Request builders
  // -------------------------------------------------------------------------

  function parseSourceUrls(raw) {
    return String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
  }

  function buildHarvestRequest(formData) {
    const action = String(formData.get('action') || 'create_job');
    if (formData.get('manual_confirmed') !== 'on') throw new Error('Manual confirmation is required');
    const jobId = String(formData.get('job_id') || '').trim();
    const request = {
      manual_confirmed: true,
      role: (action === 'approve_job' || action === 'execute_job') ? 'approver'
          : action === 'preview_job' ? 'marketer' : 'operator'
    };
    if (action === 'create_job') {
      request.type = String(formData.get('type') || '').trim() || 'acquire.web';
      request.workspace_id = String(formData.get('workspace_id') || '').trim() || 'alphire-main';
      request.requested_by = {
        user_id: String(formData.get('requested_by_user_id') || '').trim() || 'alphire-ui',
        email: String(formData.get('requested_by_email') || '').trim() || 'ops@alphire.ai'
      };
      request.payload = {
        source_urls: parseSourceUrls(formData.get('source_urls')),
        max_pages: Number(formData.get('max_pages') || 5),
        body_snippet_chars: Number(formData.get('body_snippet_chars') || 500)
      };
      request.policy = { requires_manual_approval: true, approval_ttl_minutes: 30 };
      return { action, request };
    }
    if (!jobId) throw new Error('job_id is required for this action');
    request.job_id = jobId;
    if (action === 'preview_job') return { action, request };
    if (action === 'approve_job') {
      request.decision = String(formData.get('approval_decision') || 'APPROVE').trim() || 'APPROVE';
      return { action, request };
    }
    if (action === 'execute_job') {
      const token = String(formData.get('approval_token') || '').trim();
      if (!token) throw new Error('approval_token is required for execute_job');
      request.approval_token = token;
      return { action, request };
    }
    if (action === 'job_status') return { action, request };
    throw new Error('Unsupported action');
  }

  // -------------------------------------------------------------------------
  // Event binding
  // -------------------------------------------------------------------------

  function init() {
    clearRedditHarvestProgress();
    const redditProgressWrap = document.getElementById('redditHarvestProgressWrap');
    const redditProgressBar = document.getElementById('redditHarvestProgressBar');
    const redditProgressText = document.getElementById('redditHarvestProgressText');
    if (redditProgressWrap) redditProgressWrap.classList.remove('hidden');
    if (redditProgressBar) redditProgressBar.value = 0;
    if (redditProgressText) redditProgressText.textContent = 'Idle — ready to run Reddit harvest.';
    if (els.acquireForm) {
      els.acquireForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const built = buildHarvestRequest(new FormData(els.acquireForm));
          setPreview(els.acquireRequestPreview, built);
          const response = await api(`/api/openclaw/${built.action}`, { method: 'POST', body: JSON.stringify(built.request) });
          setPreview(els.acquireResponsePreview, response);
          const derived = deriveHarvestJobFromResponse(built, response);
          if (derived) { upsertHarvestJobState(derived); renderHarvestJobsTable(); }
          const createdId = response?.result?.job?.id;
          if (createdId && els.acquireJobIdInput) els.acquireJobIdInput.value = createdId;
          const token = response?.result?.approval?.approval_token;
          if (token && els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = token;
          await refreshHarvestJobs();
          notify(`Acquire ${built.action} request sent`);
        } catch (err) { notify(err.message, true); }
      });
    }
    if (els.acquireRefreshJobsBtn) {
      els.acquireRefreshJobsBtn.addEventListener('click', async () => {
        try { await refreshHarvestJobs(); notify('Acquire jobs refreshed'); }
        catch (err) { notify(err.message, true); }
      });
    }
    if (els.directAcquireRefreshBtn) {
      els.directAcquireRefreshBtn.addEventListener('click', async () => {
        try { await refreshDirectHarvestRuns(); notify('Direct acquire runs refreshed'); }
        catch (err) { notify(err.message, true); }
      });
    }
    if (els.directAcquireForm) {
      els.directAcquireForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const formData = new FormData(els.directAcquireForm);
          const payload = {
            manual_confirmed: formData.get('manual_confirmed') === 'on',
            source_url: String(formData.get('source_url') || '').trim(),
            max_pages: Number(formData.get('max_pages') || 5),
            body_snippet_chars: Number(formData.get('body_snippet_chars') || 600)
          };
          const res = await api('/api/acquire/direct-run', { method: 'POST', body: JSON.stringify(payload) });
          state.directAcquireCurrentRun = res.run || null;
          renderDirectHarvestPagesTable();
          await refreshDirectHarvestRuns();
          notify(`Direct ingest completed (${res.run?.pages_succeeded || 0} pages parsed)`);
        } catch (err) { notify(err.message, true); }
      });
    }
    if (els.xHarvestRefreshBtn) {
      els.xHarvestRefreshBtn.addEventListener('click', async () => {
        try {
          await refreshXHarvestRuns();
          notify('X harvest runs refreshed');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    if (els.xHarvestForm) {
      els.xHarvestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const formData = new FormData(els.xHarvestForm);
          const payload = {
            query: String(formData.get('query') || '').trim(),
            hashtags: String(formData.get('hashtags') || '').split(/[,\s]+/g).map((item) => item.trim()).filter(Boolean),
            lang: String(formData.get('lang') || '').trim(),
            start_time: toIsoFromLocal(formData.get('start_time')),
            end_time: toIsoFromLocal(formData.get('end_time')),
            max_tweets: Number(formData.get('max_tweets') || 25) || 25,
            include_replies: formData.get('include_replies') === 'on',
            max_replies_per_tweet: Number(formData.get('max_replies_per_tweet') || 10) || 10,
            exclude_retweets: formData.get('exclude_retweets') === 'on',
            exclude_replies: formData.get('exclude_replies') === 'on',
          };
          if (!payload.query && !payload.hashtags.length) {
            throw new Error('Add at least one query keyword or hashtag.');
          }
          const res = await api('/api/acquire/x-harvest', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          state.xHarvestCurrentRun = res.run || null;
          renderXHarvestItemsTable();
          await refreshXHarvestRuns();
          notify(`X harvest complete (${(state.xHarvestCurrentRun?.stats?.total_tweets || 0)} tweets, ${(state.xHarvestCurrentRun?.stats?.total_replies || 0)} replies)`);
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    if (els.redditHarvestRefreshBtn) {
      els.redditHarvestRefreshBtn.addEventListener('click', async () => {
        try {
          await refreshRedditHarvestRuns();
          notify('Reddit harvest runs refreshed');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
    const redditDiscoveryStatusBtn = document.getElementById('redditDiscoveryStatusBtn');
    if (redditDiscoveryStatusBtn) {
      redditDiscoveryStatusBtn.addEventListener('click', async () => {
        try {
          setRedditDiscoveryStatus('Checking Reddit connection...');
          const res = await api('/api/engage/reddit/status');
          const configured = Boolean(res?.configured);
          const ok = Boolean(res?.authOk);
          const authError = String(res?.auth?.error || '').trim();
          const message = !configured
            ? 'Reddit API is not configured in Settings > APIs.'
            : (ok
              ? 'Reddit configured and authenticated.'
              : (authError || 'Reddit is configured, but authentication failed.'));
          setRedditDiscoveryStatus(message, !ok);
          notify(message, !ok);
        } catch (err) {
          setRedditDiscoveryStatus(err.message || 'Reddit status check failed', true);
          notify(err.message, true);
        }
      });
    }
    const redditDiscoveryForm = document.getElementById('redditDiscoveryForm');
    if (redditDiscoveryForm) {
      redditDiscoveryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = redditDiscoveryForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          await runRedditDiscovery();
          notify('Reddit thread discovery complete');
        } catch (err) {
          setRedditDiscoveryStatus(err.message || 'Reddit thread discovery failed', true);
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    const redditDiscoveryUseTargetBtn = document.getElementById('redditDiscoveryUseTargetBtn');
    if (redditDiscoveryUseTargetBtn) {
      redditDiscoveryUseTargetBtn.addEventListener('click', () => {
        const discoveryTarget = document.getElementById('redditDiscoveryTarget');
        const harvestTarget = document.getElementById('redditHarvestTarget');
        const value = String(discoveryTarget && discoveryTarget.value || '').trim();
        if (!value) {
          notify('Add a Reddit discovery target first', true);
          return;
        }
        if (harvestTarget) harvestTarget.value = value;
        const replyTarget = document.getElementById('redditReplyTarget');
        if (replyTarget) replyTarget.value = value;
        notify('Copied discovery target into harvest form');
      });
    }
    const redditReplyCandidatesForm = document.getElementById('redditReplyCandidatesForm');
    if (redditReplyCandidatesForm) {
      redditReplyCandidatesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = redditReplyCandidatesForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          await runRedditReplyCandidates();
          notify('Reddit reply candidates generated');
        } catch (err) {
          setRedditReplyStatus(err.message || 'Could not generate Reddit reply candidates', true);
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    const blueskyRefreshBtn = document.getElementById('blueskyRefreshBtn');
    if (blueskyRefreshBtn) {
      blueskyRefreshBtn.addEventListener('click', () => {
        renderBlueskyDiscoveryTable(lastBlueskyDiscoveryResult);
        renderBlueskyReplyCandidates(null);
        setBlueskyDiscoveryStatus('BlueSky UI refreshed.', false);
        setBlueskyReplyStatus('BlueSky reply generation is idle.', false);
        setBlueskyPostingStatus('BlueSky posting operator is idle.', false);
        notify('BlueSky page refreshed');
      });
    }
    const blueskyDiscoveryStatusBtn = document.getElementById('blueskyDiscoveryStatusBtn');
    if (blueskyDiscoveryStatusBtn) {
      blueskyDiscoveryStatusBtn.addEventListener('click', async () => {
        try {
          setBlueskyDiscoveryStatus('Checking BlueSky connection...');
          const res = await api('/api/engage/social/bluesky/auth-test');
          const configured = Boolean(res?.configured);
          const ok = Boolean(res?.authOk);
          const message = !configured
            ? 'BlueSky API is not configured in Settings > APIs.'
            : (ok ? 'BlueSky configured and authenticated.' : String(res?.error || 'BlueSky authentication failed.'));
          setBlueskyDiscoveryStatus(message, !ok);
          setBlueskyPostingStatus(message, !ok);
          notify(message, !ok);
        } catch (err) {
          setBlueskyDiscoveryStatus(err.message || 'BlueSky status check failed', true);
          notify(err.message, true);
        }
      });
    }
    const blueskyDiscoveryForm = document.getElementById('blueskyDiscoveryForm');
    if (blueskyDiscoveryForm) {
      blueskyDiscoveryForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = blueskyDiscoveryForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          await runBlueskyDiscovery();
          notify('BlueSky discovery complete');
        } catch (err) {
          setBlueskyDiscoveryStatus(err.message || 'BlueSky discovery failed', true);
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    const blueskyDiscoveryUseTargetBtn = document.getElementById('blueskyDiscoveryUseTargetBtn');
    if (blueskyDiscoveryUseTargetBtn) {
      blueskyDiscoveryUseTargetBtn.addEventListener('click', () => {
        const discoveryTarget = document.getElementById('blueskyDiscoveryTarget');
        const replyTarget = document.getElementById('blueskyReplyTarget');
        const postingTarget = document.getElementById('blueskyPostingTarget');
        const value = String(discoveryTarget && discoveryTarget.value || '').trim();
        if (!value) {
          notify('Add a BlueSky discovery target first', true);
          return;
        }
        if (replyTarget) replyTarget.value = value;
        if (postingTarget) postingTarget.value = value;
        notify('Copied discovery target into BlueSky reply and posting forms');
      });
    }
    const blueskyReplyCandidatesForm = document.getElementById('blueskyReplyCandidatesForm');
    if (blueskyReplyCandidatesForm) {
      blueskyReplyCandidatesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = blueskyReplyCandidatesForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          await runBlueskyReplyCandidates();
          notify('BlueSky reply candidates generated');
        } catch (err) {
          setBlueskyReplyStatus(err.message || 'Could not generate BlueSky reply candidates', true);
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    const blueskyPostingStatusBtn = document.getElementById('blueskyPostingStatusBtn');
    const blueskyPostingToggleBtn = document.getElementById('blueskyPostingToggleBtn');
    const blueskyPostingPanel = document.getElementById('blueskyPostingPanel');
    const syncBlueskyPostingPanel = () => {
      const isHidden = Boolean(blueskyPostingPanel && blueskyPostingPanel.classList.contains('hidden'));
      if (blueskyPostingToggleBtn) blueskyPostingToggleBtn.textContent = isHidden ? 'Posting Operator' : 'Hide Posting Operator';
    };
    if (blueskyPostingToggleBtn && blueskyPostingPanel) {
      syncBlueskyPostingPanel();
      blueskyPostingToggleBtn.addEventListener('click', () => {
        blueskyPostingPanel.classList.toggle('hidden');
        syncBlueskyPostingPanel();
        if (!blueskyPostingPanel.classList.contains('hidden')) {
          blueskyPostingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
    if (blueskyPostingStatusBtn) {
      blueskyPostingStatusBtn.addEventListener('click', async () => {
        try {
          setBlueskyPostingStatus('Checking BlueSky posting setup...');
          const res = await api('/api/engage/social/bluesky/auth-test');
          const configured = Boolean(res?.configured);
          const ok = Boolean(res?.authOk);
          const message = !configured
            ? 'BlueSky API is not configured in Settings > APIs.'
            : (ok ? 'BlueSky posting auth is ready.' : String(res?.error || 'BlueSky posting setup failed.'));
          const preview = document.getElementById('blueskyPostingPreview');
          if (preview) preview.textContent = prettyJson(res || {});
          setBlueskyPostingStatus(message, !ok);
          notify(message, !ok);
        } catch (err) {
          setBlueskyPostingStatus(err.message || 'BlueSky posting check failed', true);
          notify(err.message, true);
        }
      });
    }
    const blueskyPostingForm = document.getElementById('blueskyPostingForm');
    if (blueskyPostingForm) {
      blueskyPostingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(blueskyPostingForm);
        const payload = {
          target: String(formData.get('target') || '').trim(),
          reply_text: String(formData.get('reply_text') || '').trim(),
          mode: 'dry_run',
        };
        const preview = document.getElementById('blueskyPostingPreview');
        if (preview) preview.textContent = prettyJson({
          ok: true,
          mode: 'dry_run',
          target: payload.target,
          reply_text: payload.reply_text,
          assumptions: ['BlueSky posting operator UI is wired. Backend dry-run execution is the next implementation step.'],
        });
        setBlueskyPostingStatus('BlueSky posting operator UI is ready. Backend dry-run execution is next.', false);
        notify('BlueSky posting operator UI scaffold is ready');
      });
    }
    if (els.redditHarvestForm) {
      els.redditHarvestForm.addEventListener('submit', async (e) => {
        const submitBtn = els.redditHarvestForm.querySelector('button[type="submit"]');
        e.preventDefault();
        let progress = null;
        let controller = null;
        let timer = null;
        let watchdog = null;
        try {
          const formData = new FormData(els.redditHarvestForm);
          const payload = {
            target: String(formData.get('target') || '').trim(),
            mode: String(formData.get('mode') || 'auto').trim().toLowerCase(),
            source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
            sort: String(formData.get('sort') || 'new').trim().toLowerCase(),
            max_posts: Number(formData.get('max_posts') || 100) || 100,
            max_comments: Number(formData.get('max_comments') || 500) || 500,
            keyword: String(formData.get('keyword') || '').trim(),
            start_time: String(formData.get('start_time') || '').trim(),
            end_time: String(formData.get('end_time') || '').trim(),
            include_replies: formData.get('include_replies') === 'on',
          };
          if (!payload.target) throw new Error('Subreddit or post URL is required.');
          if (submitBtn) submitBtn.disabled = true;
          progress = beginRedditHarvestProgress(payload);
          controller = new AbortController();
          timer = setTimeout(() => controller.abort(), 180000);
          const apiPromise = api('/api/acquire/reddit-harvest', {
            method: 'POST',
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          const watchdogPromise = new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(new Error('Reddit harvest watchdog timeout after 190s. Please retry with lower limits.')), 190000);
          });
          const res = await Promise.race([apiPromise, watchdogPromise]);
          state.redditHarvestCurrentRun = res.run || null;
          if (progress) {
            setRedditHarvestProgress(96, 'Saving harvest results (phase 3 of 3)…');
            progress.finishSuccess();
          }
          renderRedditHarvestItemsTable();
          await refreshRedditHarvestRuns();
          notify(`Reddit harvest complete (${(state.redditHarvestCurrentRun?.stats?.total_posts || 0)} posts, ${(state.redditHarvestCurrentRun?.stats?.total_comments || 0)} comments)`);
        } catch (err) {
          if (err?.name === 'AbortError') {
            err = new Error('Reddit harvest timed out after 180s. Try smaller limits (10 posts / 20 comments) and retry.');
          }
          if (progress) progress.finishError(err?.message || 'request failed');
          notify(err.message, true);
        } finally {
          if (timer) clearTimeout(timer);
          if (watchdog) clearTimeout(watchdog);
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    if (els.xHarvestRunsTable) {
      refreshXHarvestRuns().catch((err) => notify(err.message, true));
      renderXHarvestItemsTable();
    }
    if (els.redditHarvestRunsTable) {
      refreshRedditHarvestRuns().catch((err) => notify(err.message, true));
      renderRedditHarvestItemsTable();
    }
    renderRedditDiscoveryTable(null);
    setRedditDiscoveryStatus('Reddit discovery is idle.', false);
    renderRedditReplyCandidates(null);
    setRedditReplyStatus('Reddit reply generation is idle.', false);
    renderBlueskyDiscoveryTable(null);
    setBlueskyDiscoveryStatus('BlueSky discovery is idle.', false);
    renderBlueskyReplyCandidates(null);
    setBlueskyReplyStatus('BlueSky reply generation is idle.', false);
    setBlueskyPostingStatus('BlueSky posting operator is idle.', false);
  }

  return {
    manifest: { id: 'acquire', label: 'Acquire', pageId: 'acquirePage' },
    init, refreshHarvestJobs, refreshDirectHarvestRuns, refreshXHarvestRuns, refreshRedditHarvestRuns, renderHarvestJobsTable
  };
})();
