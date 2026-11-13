'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * Bug Report 3/5 — every stored report becomes a tracker ticket HELD for the
 * operator ("needs your input", assigned to the operator's actor), filed
 * AFTER the row is written and never able to fail the reporter's request.
 * Until SC-796 this was a ClickUp task; the guards are the same.
 *
 * Three layers, each pinned:
 *  - lib/trackerForward.js asserts the held status and the operator assignee
 *    IN CODE, reads the ticket back, and deletes one that landed wrong;
 *  - lib/bugReportForward.js composes the ticket body and marks the row
 *    forwarded / failed_forward;
 *  - routes/publicSite.js runs it after the write and still answers 201 when
 *    the tracker is broken or unconfigured.
 */

const PROJECT_CONFIG = require('../../spirality.project.json');
const OPERATOR = Number(PROJECT_CONFIG.operatorUserId);
const MACHINE = Number(PROJECT_CONFIG.machineUserId);
const BASE = 'https://tracker.test:8443';
const TICKET = 'SC-9001';

// ── A fake tracker: records requests, answers like tracker/server.mjs ──────

function fakeTracker({ createStatus = 401, landedStatus = 'needs your input', landedAssignee = OPERATOR, stickyWrongStatus = false, deleteStatus = 200, readBackBody = 'body', throwOn = null } = {}) {
  const requests = [];
  let reads = 0;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url).replace(BASE, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body, auth: init.headers?.Authorization, url: String(url) });
    // Simulate a hung tracker: the real request aborts and is caught.
    if (throwOn && throwOn === method) {
      const e = new Error('aborted'); e.name = 'TimeoutError'; throw e;
    }
    const json = (status, payload) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) });

    if (method === 'POST' && path === '/projects/starcaster/tickets') {
      if (createStatus !== 201) return json(createStatus, { error: 'unauthorised', message: 'that token is not a sign-in' });
      return json(201, { id: TICKET, status: body.status });
    }
    if (method === 'GET' && path === `/tickets/${TICKET}`) {
      reads += 1;
      const corrected = reads > 1 && !stickyWrongStatus;
      return json(200, {
        id: TICKET,
        status: corrected ? 'needs your input' : landedStatus,
        assignee: corrected ? OPERATOR : landedAssignee,
        description: readBackBody,
        comments: [],
      });
    }
    if (method === 'DELETE') return json(deleteStatus, deleteStatus === 200 ? { deleted: TICKET } : { error: 'not-deletable', message: 'started' });
    if (method === 'PATCH') return json(200, { ticket: { id: TICKET }, changed: ['status'] });
    return json(404, { error: 'unexpected path' });
  };
  return { fetchImpl, requests };
}

const deps = (extra) => ({ token: 'test-token', baseUrl: BASE, ...extra });

// ── lib/trackerForward ─────────────────────────────────────────────────────

test('a held ticket is filed in the StarCaster project as "needs your input", assigned to the operator, and read back', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201 });
  const result = await createHeldTask(
    { name: 'Bug report: the menu overlaps', markdownDescription: '# body', tags: ['bug-report', 'proj-1'] },
    deps({ fetchImpl })
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.taskId, TICKET);
  assert.equal(result.url, `${PROJECT_CONFIG.trackerUrl}/t/${TICKET}`, 'the link is the page Dane opens');
  const post = requests.find((r) => r.method === 'POST');
  assert.equal(post.body.status, 'needs your input');
  assert.equal(post.body.assignee, OPERATOR);
  assert.equal(post.body.description, '# body');
  assert.deepEqual(post.body.tags, ['bug-report', 'proj-1']);
  assert.equal(post.auth, 'Bearer test-token');
  assert.ok(requests.every((r) => !/clickup\.com/.test(r.url)), 'nothing goes to ClickUp');
  assert.ok(requests.some((r) => r.method === 'GET' && r.path === `/tickets/${TICKET}`), 'must read the ticket back, not trust the 201');
  assert.equal(result.status, 'needs your input');
});

test('the default address is the public one in spirality.project.json, never the Mini\'s loopback', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201 });
  await createHeldTask({ name: 'x', markdownDescription: 'y' }, { token: 't', fetchImpl, env: {} });
  assert.ok(PROJECT_CONFIG.trackerPublicUrl, 'spirality.project.json must carry trackerPublicUrl');
  assert.match(requests[0].url, new RegExp(`^${PROJECT_CONFIG.trackerPublicUrl.replace(/[.:/]/g, '\\$&')}/projects/starcaster/tickets$`));
  assert.doesNotMatch(requests[0].url, /127\.0\.0\.1|localhost|\.local[:/]/);
});

test('the status assertion lives in code: asking for "queued" is refused before any request', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, deps({ fetchImpl, status: 'Queued' }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HELD_STATUS_REQUIRED');
  assert.equal(requests.length, 0, 'no request may be made for a non-held status');
});

test('only the operator may hold the ticket — a machine assignee is refused before any request', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, deps({ fetchImpl, assignee: MACHINE }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OPERATOR_ASSIGNEE_REQUIRED');
  assert.equal(requests.length, 0);
});

test('no token → TRACKER_NOT_CONFIGURED naming TRACKER_TOKEN_APP, and no request', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, deps({ fetchImpl, token: '' }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACKER_NOT_CONFIGURED');
  assert.match(result.error, /TRACKER_TOKEN_APP/);
  assert.equal(requests.length, 0);
});

// 2026-09-15 (task 86bc0zuvb): a test run with the company keys loaded filed
// 34 fixture reports as real tasks in the operator's lane. Stub the GLOBAL
// fetch — the transport a real server uses — and prove a test run never calls it.
async function withGlobalFetchSpy(fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'SC-1' }) };
  };
  try { return await fn(calls); } finally { globalThis.fetch = realFetch; }
}

test('a test run holding a REAL token and no injected transport never reaches the tracker', async () => {
  const { createHeldTask, createSyntheticReportTask, postBusMessage } = require('../../lib/trackerForward');
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test must mark this process, or the guard has nothing to read');
  await withGlobalFetchSpy(async (calls) => {
    const held = await createHeldTask({ name: 'Bug report: Menu overlaps logo', markdownDescription: 'y' }, { token: 'real_looking' });
    const synthetic = await createSyntheticReportTask({ name: 'Bug report: x', markdownDescription: 'y' }, { token: 'real_looking' });
    const bus = await postBusMessage('ALARM: x', { token: 'real_looking' });
    assert.deepEqual(calls, [], 'no request may leave a test run');
    assert.equal(held.ok, false);
    assert.match(held.error, /test run may not reach the real tracker/);
    assert.equal(synthetic.ok, false);
    assert.match(synthetic.error, /test run may not reach the real tracker/);
    assert.equal(bus.ok, false);
    assert.match(bus.why, /test run may not reach the real tracker/);
  });
});

test('outside a test runner the same call DOES go out — the guard reads the runner, not the token', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  await withGlobalFetchSpy(async (calls) => {
    await createHeldTask({ name: 'Bug report: real visitor', markdownDescription: 'y' }, { token: 'real_looking', env: {} });
    assert.ok(calls.some((u) => u.endsWith('/projects/starcaster/tickets')), `a production server must still forward, saw: ${calls.join(', ')}`);
  });
});

test('a broken token answers a plain failure (HTTP 401), never a throw', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl } = fakeTracker({ createStatus: 401 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, deps({ fetchImpl, token: 'bad' }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACKER_CREATE_FAILED');
  assert.match(result.error, /HTTP 401/);
});

test('a ticket that lands "queued" is corrected once, and if still wrong it is DELETED and reported', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201, landedStatus: 'queued', stickyWrongStatus: true });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, deps({ fetchImpl }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HELD_STATUS_NOT_HONOURED');
  const patch = requests.find((r) => r.method === 'PATCH');
  assert.ok(patch, 'one corrective PATCH');
  assert.deepEqual(patch.body, { status: 'needs your input', assignee: OPERATOR });
  assert.ok(requests.some((r) => r.method === 'DELETE' && r.path === `/tickets/${TICKET}`), 'the hazard is removed');
  assert.match(result.error, /deleted it/);
});

test('BLOCKER: when the fail-safe DELETE itself fails, the result says the ticket SURVIVES — never "deleted it"', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201, landedStatus: 'queued', stickyWrongStatus: true, deleteStatus: 409 });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, deps({ fetchImpl }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HELD_STATUS_NOT_DELETED');
  assert.ok(requests.some((r) => r.method === 'DELETE'), 'the DELETE was attempted');
  assert.match(result.error, /could NOT be deleted/);
  assert.match(result.error, new RegExp(TICKET));
  assert.match(result.error, /Move or delete it by hand/);
  assert.doesNotMatch(result.error, /deleted it rather than/);
  assert.equal(result.taskId, TICKET, 'the surviving ticket id is returned so it can be found');
});

test('a hung tracker (request timeout) is a failure, never mistaken for success', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl } = fakeTracker({ createStatus: 201, throwOn: 'POST' });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, deps({ fetchImpl }));
  assert.equal(result.ok, false, 'a timeout must not read as a filed ticket');
  assert.equal(result.code, 'TRACKER_CREATE_FAILED');
  assert.match(result.error, /timed out/);
});

test('an empty ticket body (the 200-but-blank trap) is not accepted as landed', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201, readBackBody: '', stickyWrongStatus: true });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'real body' }, deps({ fetchImpl }));
  assert.equal(result.ok, false, 'a blank-bodied ticket must not pass');
  assert.ok(requests.some((r) => r.method === 'DELETE'), 'the blank ticket is removed');
});

test('a ticket that lands wrong but is fixed by the corrective PATCH is accepted', async () => {
  const { createHeldTask } = require('../../lib/trackerForward');
  const { fetchImpl, requests } = fakeTracker({ createStatus: 201, landedStatus: 'queued', stickyWrongStatus: false });
  const result = await createHeldTask({ name: 'x', markdownDescription: 'y' }, deps({ fetchImpl }));
  assert.equal(result.ok, true, result.error);
  assert.ok(requests.some((r) => r.method === 'PATCH'));
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
const trackerForwardPath = require.resolve('../../lib/trackerForward.js');
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

function withRouteMocks({ tracker } = {}) {
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
  const realTracker = require(trackerForwardPath);
  const fakeTrackerForward = {
    ...realTracker,
    isConfigured: () => tracker?.configured !== false,
    createHeldTask: async (task) => {
      created.push(task);
      return tracker?.outcome || { ok: true, taskId: TICKET, url: `http://mac-mini.local:4180/t/${TICKET}`, status: 'needs your input', assignees: [OPERATOR] };
    },
  };

  const saved = [supabasePath, adminStorePath, trackerForwardPath, ...rebuildPaths].map((p) => [p, require.cache[p]]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  require.cache[adminStorePath] = { id: adminStorePath, filename: adminStorePath, loaded: true, exports: fakeAdminStore };
  require.cache[trackerForwardPath] = { id: trackerForwardPath, filename: trackerForwardPath, loaded: true, exports: fakeTrackerForward };
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
    tracker: { outcome: { ok: false, code: 'TRACKER_CREATE_FAILED', error: 'file ticket failed — HTTP 401: that token is not a sign-in' } },
  });
  try {
    const { status, payload } = await submit(publicSite, {});
    assert.equal(status, 201, 'the reporter must never pay for the tracker being broken');
    assert.equal(payload.ok, true);
    assert.equal(payload.data.status, 'failed_forward');
    assert.equal(db.bugReports.length, 1, 'the row is the record and it exists');
    assert.equal(db.bugReports[0].status, 'failed_forward');
    assert.ok(logged.some((l) => l.includes('[bug-report forward FAILED]') && l.includes('HTTP 401')), `loud log expected, got: ${logged.join(' | ')}`);
  } finally {
    restore();
  }
});

test('route: with no TRACKER_TOKEN_APP the row reads failed_forward and the log names the env var and the redeploy', async () => {
  const { publicSite, db, logged, created, restore } = withRouteMocks({ tracker: { configured: false } });
  try {
    const { status } = await submit(publicSite, {});
    assert.equal(status, 201);
    assert.equal(created.length, 0, 'nothing is attempted without a token');
    assert.equal(db.bugReports[0].status, 'failed_forward');
    assert.ok(logged.some((l) => /TRACKER_TOKEN_APP/.test(l) && /redeploy/i.test(l)), `log must name the fix, got: ${logged.join(' | ')}`);
  } finally {
    restore();
  }
});
