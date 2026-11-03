'use strict';

/**
 * CRM form handling (Loop Queue 86bcwy44f): every submission kept, the form's
 * own success message and redirect, per-form team alerts, the visitor's
 * confirmation email — and forms with none of the new settings behaving
 * exactly as before.
 *
 * The submit endpoint is driven through routes/crm.js with an in-memory
 * database standing in for Supabase, so the duplicate-email case is checked by
 * READING THE SUBMISSION ROWS BACK, not by trusting the insert (CLAUDE.md
 * landmine 12: a scoped insert can succeed and still land with no tenant).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const handling = require('../../lib/crmFormHandling.js');

const PROJECT_ID = 'proj_1';
const PROJECT_DOMAIN = 'tenant.example.com';
const FORM_OWNER = 'user_owner_1';

// ── Pure rules ───────────────────────────────────────────────────────────────

test('a form with no handling reads as today\'s behaviour', () => {
  const h = handling.normalizeFormHandling(undefined);
  assert.equal(h.afterSubmit, 'message');
  assert.deepEqual(h.alertEmails, []);
  assert.equal(h.confirmationEnabled, false);
  assert.equal(handling.isDefaultHandling(undefined), true);
  assert.deepEqual(handling.submitSuccessResponse({ successMessage: '' }), {
    message: handling.DEFAULT_SUCCESS_MESSAGE,
    redirectUrl: '',
  });
});

test('redirect is honoured only with a safe address', () => {
  assert.equal(handling.normalizeFormHandling({ afterSubmit: 'redirect', redirectUrl: '/thank-you' }).afterSubmit, 'redirect');
  for (const bad of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'thank-you', 'data:text/html,x']) {
    const h = handling.normalizeFormHandling({ afterSubmit: 'redirect', redirectUrl: bad });
    assert.equal(h.afterSubmit, 'message', `${bad} must not become a redirect`);
    assert.equal(h.redirectUrl, '');
  }
});

test('alert list: the form\'s own addresses, else the project\'s', () => {
  const own = { handling: { alertEmails: 'Sales@Example.com, bad-address, ops@example.com; sales@example.com' } };
  assert.deepEqual(handling.resolveAlertRecipients(own, ['owner@example.com']), ['sales@example.com', 'ops@example.com']);
  assert.deepEqual(handling.resolveAlertRecipients({ handling: {} }, ['owner@example.com']), ['owner@example.com']);
  assert.deepEqual(handling.resolveAlertRecipients(null, []), []);
});

test('placeholders fill from the submission; unknown ones go blank', () => {
  assert.equal(
    handling.fillPlaceholders('Hi {{first_name}} ({{ email }}) {{nope}}!', { first_name: 'Ana', email: 'a@b.co' }),
    'Hi Ana (a@b.co) !'
  );
});

test('the public view of a form never carries the team\'s addresses', () => {
  const pub = handling.publicFormHandling({
    afterSubmit: 'redirect',
    redirectUrl: '/thanks',
    alertEmails: ['team@example.com'],
    confirmationEnabled: true,
    confirmationBody: 'secret wording',
  });
  assert.deepEqual(pub, { afterSubmit: 'redirect', redirectUrl: '/thanks' });
});

// ── The forms store's round trip ─────────────────────────────────────────────

test('forms store: handling is written only when the caller sets it', () => {
  const { formInputToRow, sanitizeForm } = require('../../lib/crmFormsStore.js');
  const form = { id: 'f1', crmConfigId: 'c1', name: 'Contact', handling: { afterSubmit: 'redirect', redirectUrl: '/thanks' } };
  assert.equal('handling' in formInputToRow(form), false, 'a save that does not touch handling must not write the column');
  const row = formInputToRow(form, { includeHandling: true });
  assert.equal(row.handling.redirectUrl, '/thanks');
  assert.equal(sanitizeForm({ ...row, handling: row.handling }).handling.afterSubmit, 'redirect');
  assert.equal(sanitizeForm({ id: 'old' }).handling.afterSubmit, 'message', 'a row from before the column reads as defaults');
});

// ── The submit endpoint, end to end ──────────────────────────────────────────

/** An in-memory PostgREST: just enough of eq / in / order for these stores. */
function fakeDatabase() {
  const tables = { app_projects: [{ id: PROJECT_ID, name: 'Tenant Site', domain: PROJECT_DOMAIN }], crm_form_submissions: [] };
  const calls = [];
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
    module: {
      isConfigured: () => true,
      tableConfig: () => ({ crmFormSubmissions: 'crm_form_submissions' }),
      sbQuery: async (options) => {
        calls.push(options);
        const table = options.table;
        if (!tables[table]) return { ok: true, status: 200, data: [] };
        if (options.method === 'POST') {
          const rows = (options.body || []).map((r) => ({ ...r }));
          tables[table].push(...rows);
          return { ok: true, status: 201, data: rows };
        }
        const filters = parse(options.query);
        let rows = tables[table].filter((row) => filters.every((f) => f(row)));
        if (/order=created_at\.desc/.test(options.query || '')) {
          rows = rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        }
        return { ok: true, status: 200, data: rows };
      },
    },
  };
}

const RELOAD = [
  'routes/crm.js',
  'lib/crmFormSubmit.js',
  'lib/crmFormSubmissionsStore.js',
  'lib/projectScope.js',
  'lib/projectsStore.js',
  'lib/publicSiteHostBinding.js',
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
      if (row.email && contacts.some((c) => c.email === row.email)) {
        const err = new Error('A contact with this email already exists in this CRM.');
        err.code = 'DUPLICATE_EMAIL';
        throw err;
      }
      const created = { id: `ct_${contacts.length + 1}`, ...row, projectId: scope.projectId };
      contacts.push(created);
      return created;
    },
    findContactByEmail: async (_config, email) => contacts.find((c) => c.email === email) || null,
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
      pageUrl: '/contact',
      ...overrides,
    },
  });
}

function baseForm(handlingInput) {
  return {
    id: 'form_1',
    crmConfigId: 'cfg_1',
    projectId: PROJECT_ID,
    ownerUserId: FORM_OWNER,
    name: 'Contact us',
    successMessage: "Thanks — we'll call you",
    errorMessage: 'Sorry, try again',
    fields: [],
    handling: handling.normalizeFormHandling(handlingInput),
  };
}

test('submit answers with the FORM\'s success message, not a fixed sentence', async () => {
  const { route, restore } = loadRoute({ form: baseForm({}) });
  try {
    const { status, payload } = await submit(route);
    assert.equal(status, 200);
    assert.equal(payload.message, "Thanks — we'll call you");
    assert.equal(payload.redirectUrl, '');
  } finally {
    restore();
  }
});

test('the same email twice: ONE contact, TWO submission rows, both tenanted', async () => {
  const { route, db, contacts, restore } = loadRoute({ form: baseForm({}) });
  try {
    assert.equal((await submit(route)).status, 200);
    assert.equal((await submit(route, { data: { first_name: 'Ana', message: 'Second message' } })).status, 200);
    assert.equal(contacts.length, 1, 'a returning visitor is not a second contact');
    assert.equal(contacts[0].source, 'Form: Contact us', "the contact's source names the form");

    // Read the rows back the way the Submissions list does.
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
      assert.equal(row.page_url, '/contact');
    }
    assert.deepEqual(read.data.map((r) => r.data.message).sort(), ['Call me', 'Second message']);
  } finally {
    restore();
  }
});

test('a redirect form answers with where to send the visitor', async () => {
  const { route, restore } = loadRoute({ form: baseForm({ afterSubmit: 'redirect', redirectUrl: '/thank-you' }) });
  try {
    const { payload } = await submit(route);
    assert.equal(payload.redirectUrl, '/thank-you');
    assert.equal(payload.data.redirectUrl, '/thank-you');
  } finally {
    restore();
  }
});

test('team alerts: a form\'s own list replaces the project\'s; none falls back', async () => {
  const own = loadRoute({ form: baseForm({ alertEmails: ['sales@example.com'], alertSubject: 'Lead from {{first_name}}' }), projectAlertEmails: ['owner@example.com'] });
  try {
    await submit(own.route);
    const alerts = own.mail.filter((m) => m.to.includes('sales@example.com') || m.to.includes('owner@example.com'));
    assert.equal(alerts.length, 1);
    assert.deepEqual(alerts[0].to, ['sales@example.com'], 'only the form\'s addresses');
    assert.equal(alerts[0].subject, 'Lead from Ana');
  } finally {
    own.restore();
  }

  const fallback = loadRoute({ form: baseForm({}), projectAlertEmails: ['owner@example.com'] });
  try {
    await submit(fallback.route);
    assert.equal(fallback.mail.length, 1, 'confirmation is off, so only the alert goes out');
    assert.deepEqual(fallback.mail[0].to, ['owner@example.com']);
    assert.equal(fallback.mail[0].subject, 'New contact form submission — Tenant Site');
  } finally {
    fallback.restore();
  }
});

test('confirmation on: the visitor gets it with placeholders filled; off: nothing', async () => {
  const on = loadRoute({
    form: baseForm({ confirmationEnabled: true, confirmationSubject: 'We got your message', confirmationBody: 'Hi {{first_name}}, thanks!' }),
  });
  try {
    await submit(on.route);
    const toVisitor = on.mail.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes('visitor@example.com'));
    assert.equal(toVisitor.length, 1);
    assert.equal(toVisitor[0].subject, 'We got your message');
    assert.equal(toVisitor[0].text, 'Hi Ana, thanks!');
  } finally {
    on.restore();
  }

  const off = loadRoute({ form: baseForm({ confirmationEnabled: false, confirmationSubject: 'unused' }) });
  try {
    await submit(off.route);
    assert.equal(off.mail.length, 0, 'no alert list and no confirmation means no mail at all');
  } finally {
    off.restore();
  }
});

test('a submit with no form id behaves exactly as before', async () => {
  const { route, db, contacts, mail, restore } = loadRoute({ form: baseForm({}), projectAlertEmails: ['owner@example.com'] });
  try {
    const { status, payload } = await submit(route, { crm_form_id: undefined });
    assert.equal(status, 200);
    assert.equal(payload.message, handling.DEFAULT_SUCCESS_MESSAGE);
    assert.equal(payload.redirectUrl, '');
    assert.equal(contacts[0].source, 'form');
    assert.equal(db.tables.crm_form_submissions.length, 0);
    assert.deepEqual(mail.map((m) => m.to), [['owner@example.com']]);
  } finally {
    restore();
  }
});

test('a form id from another project is ignored, not obeyed', async () => {
  const foreign = { ...baseForm({ afterSubmit: 'redirect', redirectUrl: '/elsewhere' }), projectId: 'proj_other' };
  const { route, db, restore } = loadRoute({ form: foreign });
  try {
    const { payload } = await submit(route);
    assert.equal(payload.redirectUrl, '');
    assert.equal(db.tables.crm_form_submissions.length, 0);
  } finally {
    restore();
  }
});

test('public GET of a form hides the team\'s addresses; a signed-in user sees them', async () => {
  const form = baseForm({ alertEmails: ['team@example.com'], confirmationEnabled: true, confirmationBody: 'x' });
  const { route, restore } = loadRoute({ form });
  try {
    const anon = await call(route, 'GET', '/api/crm/forms/form_1');
    assert.deepEqual(anon.payload.form.handling, { afterSubmit: 'message', redirectUrl: '' });
    const admin = await call(route, 'GET', '/api/crm/forms/form_1', { authUser: { id: 'u1' } });
    assert.deepEqual(admin.payload.form.handling.alertEmails, ['team@example.com']);
  } finally {
    restore();
  }
});

test('Forms list carries each form\'s submission count, and Submissions lists newest first', async () => {
  const { route, restore } = loadRoute({ form: baseForm({}) });
  try {
    await submit(route, { data: { message: 'first' } });
    await new Promise((r) => setTimeout(r, 5));
    await submit(route, { data: { message: 'second' } });
    const list = await call(route, 'GET', '/api/crm/forms?configId=cfg_1', { authUser: { id: 'u1' } });
    assert.equal(list.payload.forms[0].submissionCount, 2);
    const subs = await call(route, 'GET', '/api/crm/forms/form_1/submissions', { authUser: { id: 'u1' } });
    assert.equal(subs.status, 200);
    assert.deepEqual(subs.payload.submissions.map((s) => s.data.message), ['second', 'first']);
  } finally {
    restore();
  }
});
