'use strict';

/**
 * Every website form submission kept, a returning visitor's second message
 * included, and listed per form (Loop Queue 86bcx1858).
 *
 * The submit endpoint and the Forms list are driven through routes/crm.js with
 * an in-memory database and contact list standing in for Supabase.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const PROJECT_ID = 'proj_1';
const PROJECT_DOMAIN = 'tenant.example.com';
const FORM_OWNER = 'user_owner_1';

// ── Harness ──────────────────────────────────────────────────────────────────

/** An in-memory PostgREST: just enough of eq / in / order for these stores. */
function fakeDatabase() {
  const tables = { app_projects: [{ id: PROJECT_ID, name: 'Tenant Site', domain: PROJECT_DOMAIN }], crm_form_submissions: [] };
  const calls = [];
  // Tables that answer every query with a refusal, as a missing table does.
  const refuse = new Set();
  function parse(query) {
    const filters = [];
    for (const part of String(query || '').split('&')) {
      const m = /^([a-z_]+)=(eq|in)\.(.*)$/.exec(part);
      if (!m) continue;
      const value = decodeURIComponent(m[3]);
      filters.push(m[2] === 'eq'
        ? (row) => String(row[m[1]] ?? '') === value
        : (row) => value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).includes(String(row[m[1]] ?? '')));
    }
    return filters;
  }
  return {
    tables,
    calls,
    refuse,
    module: {
      isConfigured: () => true,
      tableConfig: () => ({}),
      sbQuery: async (options) => {
        calls.push(options);
        const table = options.table;
        if (refuse.has(table)) return { ok: false, status: 404, error: `relation "${table}" does not exist` };
        if (!tables[table]) return { ok: true, status: 200, data: [] };
        if (options.method === 'POST') {
          const rows = (options.body || []).map((r) => ({ ...r }));
          tables[table].push(...rows);
          return { ok: true, status: 201, data: rows };
        }
        const filters = parse(options.query);
        const rows = tables[table].filter((row) => filters.every((f) => f(row)));
        return { ok: true, status: 200, data: rows };
      },
    },
  };
}

const RELOAD = [
  'routes/crm.js',
  'lib/projectScope.js',
  'lib/projectsStore.js',
  'lib/publicSiteHostBinding.js',
  'lib/crmFormSubmissionsStore.js',
];

/**
 * Load routes/crm.js against the fake database, a fake contact list that
 * enforces one contact per email, a fake form, and a mailer that records.
 */
function loadRoute({ form = null, projectAlertEmails = [] } = {}) {
  const db = fakeDatabase();
  const contacts = [];
  const mail = [];
  const saved = new Map();
  const swap = (relative, exports) => {
    const file = require.resolve(`../../${relative}`);
    saved.set(file, require.cache[file]);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  swap('lib/supabase.js', db.module);
  swap('lib/crmContactsStore.js', {
    createContact: async (row, scope) => {
      if (row.email && contacts.some((c) => c.email === String(row.email).toLowerCase())) {
        const err = new Error('A contact with this email already exists in this CRM.');
        err.code = 'DUPLICATE_EMAIL';
        throw err;
      }
      const created = { id: `ct_${contacts.length + 1}`, ...row, email: row.email ? String(row.email).toLowerCase() : row.email, projectId: scope.projectId };
      contacts.push(created);
      return created;
    },
    findContactByEmail: async (configId, email) => contacts.find((c) => c.email === String(email || '').toLowerCase()) || null,
    listContacts: async () => contacts,
    getContact: async () => null,
    updateContact: async () => null,
    deleteContact: async () => null,
  });
  swap('lib/crmFormsStore.js', {
    getForm: async (id) => (form && form.id === id ? form : null),
    listForms: async () => (form ? [form] : []),
    createForm: async () => null,
    updateForm: async () => null,
    deleteForm: async () => null,
    getLastFormStoreError: () => '',
  });
  swap('lib/projectSiteSettingsStore.js', {
    ...require('../../lib/projectSiteSettingsStore.js'),
    getContactAlertEmails: async () => projectAlertEmails,
  });
  swap('lib/mailer.js', { sendEmail: async (message) => { mail.push(message); return { ok: true }; } });
  swap('lib/activityLog.js', { logActivity: () => {} });
  for (const relative of RELOAD) {
    const file = require.resolve(`../../${relative}`);
    if (!saved.has(file)) saved.set(file, require.cache[file]);
    delete require.cache[file];
  }
  const route = require('../../routes/crm.js');
  function restore() {
    for (const [file, previous] of saved.entries()) {
      if (previous) require.cache[file] = previous;
      else delete require.cache[file];
    }
  }
  return { route, db, contacts, mail, restore };
}

let nextIp = 1;
async function call(route, method, pathname, { body = {}, authUser = null } = {}) {
  const res = { statusCode: 0, body: '', headers: {} };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.end = (chunk) => { res.body = chunk || ''; };
  const req = {
    method,
    url: pathname,
    headers: { host: PROJECT_DOMAIN, 'user-agent': 'test-agent' },
    socket: { remoteAddress: `198.51.100.${nextIp++}` },
    body,
    authUser,
    projectContext: authUser ? { project: { id: PROJECT_ID } } : null,
  };
  await route.handle(req, res, pathname.split('?')[0], method);
  let payload = null;
  try { payload = JSON.parse(res.body); } catch (_) { payload = null; }
  return { status: res.statusCode, payload };
}

function submit(route, overrides = {}) {
  return call(route, 'POST', '/api/crm/contact-submit', {
    body: {
      crmConfigId: 'cfg_1',
      crm_form_id: 'form_1',
      projectId: PROJECT_ID,
      email: 'Visitor@Example.com',
      data: { first_name: 'Ana', message: 'Call me' },
      ...overrides,
    },
  });
}

function baseForm() {
  return {
    id: 'form_1',
    crmConfigId: 'cfg_1',
    projectId: PROJECT_ID,
    ownerUserId: FORM_OWNER,
    name: 'Contact us',
    successMessage: "Thanks — we'll call you",
    errorMessage: 'Sorry, try again',
    fields: [],
  };
}

// ── Every submission kept (Loop Queue 86bcx1858) ─────────────────────────────

test('the same email twice: ONE contact, TWO submission rows, both tenanted', async () => {
  const { route, db, contacts, restore } = loadRoute({ form: baseForm() });
  try {
    await submit(route, { data: { first_name: 'Ana', message: 'first' }, pageUrl: '/contact?ref=ad' });
    const second = await submit(route, { data: { first_name: 'Ana', message: 'second' }, pageUrl: '/pricing' });
    assert.equal(second.status, 200);
    assert.equal(contacts.length, 1, 'a returning visitor is still one contact');
    // Read the rows back the way the Submissions list does: by form AND project.
    const read = await db.module.sbQuery({
      table: 'crm_form_submissions',
      query: `select=*&crm_form_id=eq.form_1&project_id=eq.${PROJECT_ID}`,
    });
    assert.equal(read.data.length, 2, 'the second submission is kept, not thrown away');
    for (const row of read.data) {
      assert.equal(row.project_id, PROJECT_ID);
      assert.equal(row.owner_user_id, FORM_OWNER);
      assert.equal(row.crm_contact_id, contacts[0].id, 'both rows link to the one contact');
      assert.equal(row.email, 'visitor@example.com');
    }
    assert.deepEqual(read.data.map((r) => r.data.message), ['first', 'second']);
    assert.deepEqual(read.data.map((r) => r.page_url), ['/contact?ref=ad', '/pricing']);
  } finally {
    restore();
  }
});

test('the contact\'s source names the form that captured it', async () => {
  const { route, contacts, restore } = loadRoute({ form: baseForm() });
  try {
    await submit(route);
    assert.equal(contacts[0].source, 'Form: Contact us');
  } finally {
    restore();
  }
});

test('a page address that is not a page is not stored', async () => {
  const { route, db, restore } = loadRoute({ form: baseForm() });
  try {
    await submit(route, { pageUrl: 'javascript:alert(1)' });
    assert.equal(db.tables.crm_form_submissions[0].page_url, '');
  } finally {
    restore();
  }
});

test('a submission row that cannot be written never fails the visitor', async () => {
  const { route, db, contacts, restore } = loadRoute({ form: baseForm(), projectAlertEmails: ['owner@example.com'] });
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  db.refuse.add('crm_form_submissions');
  try {
    const { status, payload } = await submit(route);
    assert.equal(status, 200);
    assert.equal(payload.ok, true);
    assert.equal(contacts.length, 1, 'the contact is still kept');
    assert.ok(logged.some((line) => line.includes('NOT written')), 'the failure is logged, not swallowed');
  } finally {
    console.error = originalError;
    restore();
  }
});

test('a submit with no form id writes no submission row (no form to file it under)', async () => {
  const { route, db, restore } = loadRoute({ form: baseForm() });
  try {
    await submit(route, { crm_form_id: undefined });
    assert.equal(db.tables.crm_form_submissions.length, 0);
  } finally {
    restore();
  }
});

test('Forms list carries each form\'s submission count, and Submissions lists newest first', async () => {
  const { route, db, restore } = loadRoute({ form: baseForm() });
  try {
    await submit(route, { data: { message: 'first' } });
    // Distinct timestamps, so newest-first is a real claim and not insertion order.
    db.tables.crm_form_submissions[0].created_at = '2026-11-01T10:00:00.000Z';
    await submit(route, { data: { message: 'second' } });
    db.tables.crm_form_submissions[1].created_at = '2026-11-02T10:00:00.000Z';
    const list = await call(route, 'GET', '/api/crm/forms?configId=cfg_1', { authUser: { id: 'u1' } });
    assert.equal(list.payload.data[0].submissionCount, 2);
    const subs = await call(route, 'GET', '/api/crm/forms/form_1/submissions', { authUser: { id: 'u1' } });
    assert.equal(subs.status, 200);
    assert.deepEqual(subs.payload.submissions.map((s) => s.data.message), ['second', 'first']);
  } finally {
    restore();
  }
});

test('a count that could not be read is null ("could not be counted"), never 0', async () => {
  const { route, db, restore } = loadRoute({ form: baseForm() });
  const originalError = console.error;
  console.error = () => {};
  db.refuse.add('crm_form_submissions');
  try {
    const list = await call(route, 'GET', '/api/crm/forms?configId=cfg_1', { authUser: { id: 'u1' } });
    assert.equal(list.status, 200, 'the Forms list itself still loads');
    assert.equal(list.payload.data[0].submissionCount, null);
    const subs = await call(route, 'GET', '/api/crm/forms/form_1/submissions', { authUser: { id: 'u1' } });
    assert.notEqual(subs.status, 200, 'an unreadable list is an error, not an empty list');
  } finally {
    console.error = originalError;
    restore();
  }
});

test('another project\'s form has no submissions to show here', async () => {
  const foreign = { ...baseForm(), projectId: 'proj_other' };
  const { route, restore } = loadRoute({ form: foreign });
  try {
    const subs = await call(route, 'GET', '/api/crm/forms/form_1/submissions', { authUser: { id: 'u1' } });
    assert.equal(subs.status, 404);
  } finally {
    restore();
  }
});

test('the submissions list is not one of the public CRM routes', () => {
  const { isPublicCrmRoute } = require('../../lib/projectAdminApiAuth.js');
  assert.equal(isPublicCrmRoute('/api/crm/forms/form_1/submissions', 'GET'), false);
  assert.equal(isPublicCrmRoute('/api/crm/forms/form_1', 'GET'), true);
});

test('a submit with no form id keeps the contact exactly as before', async () => {
  const { route, contacts, mail, restore } = loadRoute({ form: baseForm(), projectAlertEmails: ['owner@example.com'] });
  try {
    const { status } = await submit(route, { crm_form_id: undefined });
    assert.equal(status, 200);
    assert.equal(contacts[0].source, 'form');
    assert.deepEqual(mail.map((m) => m.to), [['owner@example.com']], 'the project alert still goes out');
  } finally {
    restore();
  }
});

test('a form id from another project files no submission under it', async () => {
  const foreign = { ...baseForm(), projectId: 'proj_other' };
  const { route, db, contacts, restore } = loadRoute({ form: foreign });
  try {
    await submit(route);
    assert.equal(db.tables.crm_form_submissions.length, 0);
    assert.equal(contacts[0].source, 'form', 'and its name is not borrowed for the contact');
  } finally {
    restore();
  }
});
