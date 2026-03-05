/**
 * public/js/acquire.js
 * Acquire jobs table, direct web acquire, and OpenClaw job lifecycle actions.
 */

window.App = window.App || {};
App.acquire = (function () {
  const { state, els, api, notify, setPreview, prettyJson } = App;

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

  async function loadDirectHarvestRun(runId) {
    const res = await api(`/api/acquire/direct-runs/${encodeURIComponent(runId)}`);
    state.directAcquireCurrentRun = res.run || null;
    renderDirectHarvestPagesTable();
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
  }

  return {
    manifest: { id: 'acquire', label: 'Acquire', pageId: 'acquirePage' },
    init, refreshHarvestJobs, refreshDirectHarvestRuns, renderHarvestJobsTable
  };
})();
