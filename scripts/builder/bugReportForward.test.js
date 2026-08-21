'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Bug Report 3/5 — every stored report becomes a ClickUp task HELD for the
 * operator ("Needs your input", assigned to 48012725), created AFTER the row
 * is written and never able to fail the reporter's request.
 *
 * Three layers, each pinned:
 *  - lib/clickupForward.js asserts the held status and the operator assignee
 *    IN CODE, reads the task back, and deletes one that landed wrong;
 *  - lib/bugReportForward.js composes the task body and marks the row
 *    forwarded / failed_forward;
 *  - routes/publicSite.js runs it after the write and still answers 201 when
 *    ClickUp is broken or unconfigured.
 */

const LOOP_QUEUE = '901418546619';
const OPERATOR = 48012725;
const MACHINE = 54254347;

// ── A fake ClickUp: records requests, answers like the real API ────────────

function fakeClickup({ createStatus = 401, landedStatus = 'Needs your input', landedAssignees = [OPERATOR], stickyWrongStatus = false } = {}) {
  const requests = [];
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url).replace('https://api.clickup.com', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body, auth: init.headers?.Authorization });
    const json = (status, payload) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) });

    if (method === 'POST' && path === `/api/v2/list/${LOOP_QUEUE}/task`) {
      if (createStatus !== 200) return json(createStatus, { err: 'Token invalid', ECODE: 'OAUTH_025' });
      return json(200, { id: 'task_abc', url: 'https://app.clickup.com/t/task_abc' });
    }
    if (method === 'GET' && path === '/api/v2/task/task_abc') {
      reads += 1;
      // After a corrective PUT the second read may show the fix — unless sticky.
      const corrected = reads > 1 && !stickyWrongStatus;
      return json(200, {
        id: 'task_abc',
        status: { status: corrected ? 'Needs your input' : landedStatus },
        assignees: (corrected ? [OPERATOR] : landedAssignees).map((id) => ({ id })),
        description: 'body',
      });
    }
    if (method === 'PUT' || method === 'DELETE') return json(200, { id: 'task_abc' });
    return json(404, { err: 'unexpected path' });
  };
  return { fetchImpl, requests };
}

// ── lib/clickupForward ─────────────────────────────────────────────────────

test('a held task is created in the Loop Queue as "Needs your input", assigned to the operator, and read back', async () => {
  const { createHeldTask } = require('../../lib/clickupForward');
  const { fetchImpl, requests } = fakeClickup({ createStatus: 200 });
  const result = await createHeldTask(
    { name: 'Bug report: the menu overlaps', markdownDescription: '# body', tags: ['bug-report', 'proj-1'] },
    { fetchImpl, token: 'test-token' }
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.taskId, 'task_abc');
  const post = requests.find((r) => r.method === 'POST');
  assert.equal(post.body.status, 'Needs your input');
  assert.deepEqual(post.body.assignees, [OPERATOR]);
  assert.deepEqual(post.body.tags, ['bug-report', 'proj-1']);
  assert.equal(post.auth, 'test-token');
  assert.ok(requests.some((r) => r.method === 'GET' && r.path === '/api/v2/task/task_abc'), 'must read the task back, not trust the 200');
  assert.equal(result.status, 'Needs your input');
});

test('the status assertion lives in code: asking for "Queued" is refused before any request', async () => {
  const { createHeldTask } = require('../../lib/clickupForward');
  const { fetchImpl, requests } = fakeClickup({ createStatus: 200 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, { fetchImpl, token: 't', status: 'Queued' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HELD_STATUS_REQUIRED');
  assert.equal(requests.length, 0, 'no request may be made for a non-held status');
});

test('the machine account can never be the assignee — refused before any request', async () => {
  const { createHeldTask } = require('../../lib/clickupForward');
  const { fetchImpl, requests } = fakeClickup({ createStatus: 200 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, { fetchImpl, token: 't', assignees: [MACHINE] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MACHINE_ASSIGNEE_REFUSED');
  assert.equal(requests.length, 0);
});

test('no token → CLICKUP_NOT_CONFIGURED and no request', async () => {
  const { createHeldTask } = require('../../lib/clickupForward');
  const { fetchImpl, requests } = fakeClickup({ createStatus: 200 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, { fetchImpl, token: '' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CLICKUP_NOT_CONFIGURED');
  assert.equal(requests.length, 0);
});

test('a broken token answers a plain failure (HTTP 401), never a throw', async () => {
  const { createHeldTask } = require('../../lib/clickupForward');
  const { fetchImpl } = fakeClickup({ createStatus: 401 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, { fetchImpl, token: 'bad' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CLICKUP_CREATE_FAILED');
  assert.match(result.error, /HTTP 401/);
});

test('a task that lands "queued" is corrected once, and if still wrong it is DELETED and reported', async () => {
  const { createHeldTask } = require('../../lib/clickupForward');
  // Sticky: ClickUp keeps answering "queued" even after the corrective PUT.
  const { fetchImpl, requests } = fakeClickup({ createStatus: 200, landedStatus: 'queued', stickyWrongStatus: true });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, { fetchImpl, token: 't' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HELD_STATUS_NOT_HONOURED');
  assert.ok(requests.some((r) => r.method === 'PUT'), 'one corrective PUT');
  assert.ok(requests.some((r) => r.method === 'DELETE' && r.path === '/api/v2/task/task_abc'), 'the hazard is removed');
  assert.match(result.error, /deleted it/);
});

test('a task that lands wrong but is fixed by the corrective PUT is accepted', async () => {
  const { createHeldTask } = require('../../lib/clickupForward');
  const { fetchImpl, requests } = fakeClickup({ createStatus: 200, landedStatus: 'queued', stickyWrongStatus: false });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, { fetchImpl, token: 't' });
  assert.equal(result.ok, true, result.error);
  assert.ok(requests.some((r) => r.method === 'PUT'));
  assert.ok(!requests.some((r) => r.method === 'DELETE'));
});

// ── lib/bugReportForward: composition ──────────────────────────────────────

test('the task body carries description, page, project, tier, browser, and screenshot links; public text is fenced', () => {
  const { composeBugReportTask } = require('../../lib/bugReportForward');
  const task = composeBugReportTask(
    {
      id: 'bug_1',
      projectId: 'proj_1',
      description: 'The menu overlaps the logo ``` and [a link](http://x) @everyone',
      pageUrl: 'https://tenant.example.com/contact',
      viewerTier: 'staff',
      userAgent: 'Mozilla/5.0 TestBrowser',
      createdAt: '2026-08-20T20:00:00Z',
      screenshotAssetIds: [1, 2],
    },
    { project: { id: 'proj_1', name: 'Delray Tennis', slug: 'delray-beach-tennis-center' }, screenshotUrls: ['https://blob.test/a.png', 'https://blob.test/b.png'] }
  );
  assert.match(task.name, /^Bug report: The menu overlaps the logo/);
  assert.match(task.name, /Delray Tennis$/);
  assert.match(task.markdownDescription, /```\nThe menu overlaps the logo ''' and \[a link\]\(http:\/\/x\) @everyone\n```/, 'description is fenced and inner fences neutralised');
  assert.match(task.markdownDescription, /\*\*Page:\*\* https:\/\/tenant\.example\.com\/contact/);
  assert.match(task.markdownDescription, /\*\*Project:\*\* Delray Tennis \(proj_1\)/);
  assert.match(task.markdownDescription, /\*\*Viewer tier:\*\* staff/);
  assert.match(task.markdownDescription, /Mozilla\/5\.0 TestBrowser/);
  assert.match(task.markdownDescription, /\[Screenshot 1\]\(https:\/\/blob\.test\/a\.png\)/);
  assert.match(task.markdownDescription, /\[Screenshot 2\]\(https:\/\/blob\.test\/b\.png\)/);
  assert.match(task.markdownDescription, /`bug_1`/);
  assert.deepEqual(task.tags, ['bug-report', 'delray-beach-tennis-center']);
});

test('with no project record and no screenshots the body still says so rather than going blank', () => {
  const { composeBugReportTask } = require('../../lib/bugReportForward');
  const task = composeBugReportTask({ id: 'bug_2', projectId: 'proj_9', description: 'x' }, {});
  assert.match(task.markdownDescription, /\*\*Project:\*\* proj_9/);
  assert.match(task.markdownDescription, /\(none attached\)/);
  assert.deepEqual(task.tags, ['bug-report', 'proj-9']);
});

// ── Route integration: after the write, never before, never failing the reporter ──

const supabasePath = require.resolve('../../lib/supabase.js');
const adminStorePath = require.resolve('../../lib/projectAdminStore.js');
const clickupForwardPath = require.resolve('../../lib/clickupForward.js');
const rebuildPaths = [
  '../../lib/projectScope.js',
  '../../lib/assetsStore.js',
  '../../lib/projectsStore.js',
  '../../lib/projectBugReportsStore.js',
  '../../lib/bugReportForward.js',
  '../../routes/publicSite.js',
].map((p) => require.resolve(p));
const realSupabase = require(supabasePath);

const KNOWN_PROJECT_ID = 'proj_1';

function withRouteMocks({ clickup } = {}) {
  const db = { bugReports: [] };
  const created = [];
  let nextId = 1;
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ ...realSupabase.tableConfig(), projectBugReports: 'project_bug_reports', assets: 'assets' }),
    sbQuery: async (options) => {
      const { table, method = 'GET', query = '' } = options;
      if (table === 'project_bug_reports') {
        if (/select=project_id,owner_user_id/.test(query)) return { ok: true, status: 200, data: [] };
        if (method === 'POST') {
          const row = { id: `bug_${nextId++}`, created_at: '2026-08-20T20:00:00Z', ...options.body[0] };
          db.bugReports.push(row);
          return { ok: true, status: 201, data: [row] };
        }
        const idMatch = /(?:^|&)id=eq\.([^&]*)/.exec(query);
        const id = idMatch ? decodeURIComponent(idMatch[1]) : null;
        const rows = db.bugReports.filter((r) => !id || r.id === id);
        if (method === 'PATCH') { for (const r of rows) Object.assign(r, options.body); }
        return { ok: true, status: 200, data: rows };
      }
      if (table === 'assets') return { ok: true, status: 200, data: [] };
      const idMatch = /(?:^|&)id=eq\.([^&]*)/.exec(query);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        return { ok: true, status: 200, data: id === KNOWN_PROJECT_ID ? [{ id, name: 'Project One', slug: 'project-one' }] : [] };
      }
      return { ok: true, status: 200, data: [] };
    },
  };
  const fakeAdminStore = { getAdminSession: async () => null };
  const realClickup = require(clickupForwardPath);
  const fakeClickupForward = {
    ...realClickup,
    isConfigured: () => clickup?.configured !== false,
    createHeldTask: async (task) => {
      created.push(task);
      return clickup?.outcome || { ok: true, taskId: 'task_abc', url: 'https://app.clickup.com/t/task_abc', status: 'Needs your input', assignees: [OPERATOR] };
    },
  };

  const saved = [supabasePath, adminStorePath, clickupForwardPath, ...rebuildPaths].map((p) => [p, require.cache[p]]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[adminStorePath] = { id: adminStorePath, filename: adminStorePath, loaded: true, exports: fakeAdminStore };
  require.cache[clickupForwardPath] = { id: clickupForwardPath, filename: clickupForwardPath, loaded: true, exports: fakeClickupForward };
  for (const p of rebuildPaths) delete require.cache[p];
  const publicSite = require('../../routes/publicSite.js');

  const logged = [];
  const realConsoleError = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };

  function restore() {
    console.error = realConsoleError;
    for (const [p, entry] of saved) { if (entry) require.cache[p] = entry; else delete require.cache[p]; }
    for (const p of rebuildPaths) delete require.cache[p];
  }
  return { publicSite, db, created, logged, restore };
}

let nextTestIp = 1;
async function submit(publicSite, body) {
  const req = {
    method: 'POST', url: '/api/public/bug-report',
    headers: { host: 'localhost', 'user-agent': 'test-agent' },
    socket: { remoteAddress: `203.0.113.${nextTestIp++}` },
    body: { projectId: KNOWN_PROJECT_ID, description: 'The submit button does nothing', pageUrl: '/contact', ...body },
  };
  const res = { statusCode: 0, body: '', headers: {}, setHeader() {}, end(chunk) { this.body = chunk || ''; } };
  await publicSite.handle(req, res, '/api/public/bug-report', 'POST');
  return { status: res.statusCode, payload: JSON.parse(res.body) };
}

test('route: a submitted report is forwarded AFTER the write and the row reads forwarded', async () => {
  const { publicSite, db, created, restore } = withRouteMocks();
  try {
    const { status, payload } = await submit(publicSite, {});
    assert.equal(status, 201);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.status, 'forwarded');
    assert.equal(created.length, 1, 'one held task created');
    assert.match(created[0].name, /The submit button does nothing/);
    assert.match(created[0].markdownDescription, /Project One \(proj_1\)/);
    assert.deepEqual(created[0].tags, ['bug-report', 'project-one']);
    assert.equal(db.bugReports[0].status, 'forwarded', 'READ THE ROW BACK');
  } finally {
    restore();
  }
});

test('route: a broken token still gives the reporter a 201; the row reads failed_forward; the failure is logged loudly', async () => {
  const { publicSite, db, logged, restore } = withRouteMocks({
    clickup: { outcome: { ok: false, code: 'CLICKUP_CREATE_FAILED', error: 'create task failed — HTTP 401: Token invalid' } },
  });
  try {
    const { status, payload } = await submit(publicSite, {});
    assert.equal(status, 201, 'the reporter must never pay for ClickUp being broken');
    assert.equal(payload.ok, true);
    assert.equal(payload.data.status, 'failed_forward');
    assert.equal(db.bugReports.length, 1, 'the row is the record and it exists');
    assert.equal(db.bugReports[0].status, 'failed_forward');
    assert.ok(logged.some((l) => l.includes('[bug-report forward FAILED]') && l.includes('HTTP 401')), `loud log expected, got: ${logged.join(' | ')}`);
  } finally {
    restore();
  }
});

test('route: with no CLICKUP_API_TOKEN the row reads failed_forward and the log names the env var and the redeploy', async () => {
  const { publicSite, db, logged, created, restore } = withRouteMocks({ clickup: { configured: false } });
  try {
    const { status } = await submit(publicSite, {});
    assert.equal(status, 201);
    assert.equal(created.length, 0, 'nothing is attempted without a token');
    assert.equal(db.bugReports[0].status, 'failed_forward');
    assert.ok(logged.some((l) => /CLICKUP_API_TOKEN/.test(l) && /redeploy/i.test(l)), `log must name the fix, got: ${logged.join(' | ')}`);
  } finally {
    restore();
  }
});
