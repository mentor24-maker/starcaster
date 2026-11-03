'use strict';

/**
 * CRM form handling, slice B (Loop Queue 86bcwy44f): the form's own success
 * message, and "After submit: go to a page" — kept inside the form's existing
 * `fields` list, so no database change — with forms that set nothing behaving
 * exactly as before. Plus each form's own team-alert list and subject
 * (86bcx188j), falling back to the project's Contact Alert Email when blank.
 *
 * The submit endpoint is driven through routes/crm.js with an in-memory
 * database and contact list standing in for Supabase.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const handling = require('../../lib/crmFormHandling.js');

const PROJECT_ID = 'proj_1';
const PROJECT_DOMAIN = 'tenant.example.com';
const FORM_OWNER = 'user_owner_1';

// ── Pure rules ───────────────────────────────────────────────────────────────

test('a form with no handling reads as today\'s behaviour', () => {
  assert.deepEqual(handling.normalizeFormHandling(undefined), {
    afterSubmit: 'message',
    redirectUrl: '',
    redirectPageId: '',
    alertEmails: [],
    alertSubject: '',
    confirmationEnabled: false,
    confirmationSubject: '',
    confirmationBody: '',
  });
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

// ── Where it is kept: inside `fields`, no column ─────────────────────────────

const META = handling.CRM_FORM_HANDLING_META_KEY;
const REDIRECT = { afterSubmit: 'redirect', redirectUrl: '/thank-you', redirectPageId: 'pg_9', alertEmails: [], alertSubject: '' };
const FIELDS = [{ key: 'email', label: 'Email', type: 'email', required: true }];

test('forms store: the redirect rides inside fields, never as its own column', () => {
  const { formInputToRow } = require('../../lib/crmFormsStore.js');
  const row = formInputToRow({ id: 'f1', crmConfigId: 'c1', name: 'Contact', fields: FIELDS, handling: REDIRECT }, { includeStylesMeta: true });
  assert.equal('handling' in row, false, 'a handling column would need SQL that option B does not have');
  const metas = row.fields.filter((f) => f.key === META);
  assert.equal(metas.length, 1);
  assert.deepEqual(metas[0].handling, handling.normalizeFormHandling(REDIRECT));
  assert.ok(row.fields.some((f) => f.key === '__crm_form_styles__'), 'the styles entry is kept alongside');
});

test('forms store: reading the row back gives the redirect, and no visitor-facing field for it', () => {
  const { formInputToRow, sanitizeForm } = require('../../lib/crmFormsStore.js');
  const row = formInputToRow({ id: 'f1', crmConfigId: 'c1', name: 'Contact', fields: FIELDS, handling: REDIRECT }, { includeStylesMeta: true });
  const form = sanitizeForm(row);
  assert.deepEqual(form.handling, handling.normalizeFormHandling(REDIRECT));
  assert.deepEqual(form.fields.map((f) => f.key), ['email']);
});

test('forms store: a save that does not touch After submit keeps it (Form Appearance panel, rename)', () => {
  const { formInputToRow, sanitizeForm } = require('../../lib/crmFormsStore.js');
  const stored = sanitizeForm(formInputToRow({ id: 'f1', crmConfigId: 'c1', name: 'Contact', fields: FIELDS, handling: REDIRECT }, { includeStylesMeta: true }));
  // What updateForm does: merge the patch onto the stored form, write it again.
  const rewritten = formInputToRow(sanitizeForm({ ...stored, name: 'Renamed', styles: { buttonBg: '#ff0000' } }), { includeStylesMeta: true });
  assert.deepEqual(sanitizeForm(rewritten).handling, handling.normalizeFormHandling(REDIRECT));
  assert.equal(rewritten.fields.filter((f) => f.key === META).length, 1, 'never doubled');
});

test('forms store: a form with no After submit setting stores exactly the fields it did before', () => {
  const { formInputToRow, sanitizeForm } = require('../../lib/crmFormsStore.js');
  const row = formInputToRow({ id: 'f1', crmConfigId: 'c1', name: 'Contact', fields: FIELDS }, { includeStylesMeta: true });
  assert.equal(row.fields.some((f) => f.key === META), false);
  assert.equal(sanitizeForm({ id: 'old', fields: FIELDS }).handling.afterSubmit, 'message', 'a form from before reads as defaults');
  // Switching back to "Show message" with no page removes the entry again.
  const cleared = formInputToRow({ id: 'f1', crmConfigId: 'c1', name: 'Contact', fields: [...FIELDS, { key: META, type: 'meta', handling: REDIRECT }], handling: {} }, { includeStylesMeta: true });
  assert.equal(cleared.fields.some((f) => f.key === META), false);
});

// ── The submit endpoint, end to end ──────────────────────────────────────────

/** An in-memory PostgREST: just enough of eq / in / order for these stores. */
function fakeDatabase() {
  const tables = { app_projects: [{ id: PROJECT_ID, name: 'Tenant Site', domain: PROJECT_DOMAIN }] };
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
      tableConfig: () => ({}),
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
        const rows = tables[table].filter((row) => filters.every((f) => f(row)));
        return { ok: true, status: 200, data: rows };
      },
    },
  };
}

const RELOAD = [
  'routes/crm.js',
  // Fresh limiter counters per test: every test emails the same visitor.
  'lib/rateLimiter.js',
  'lib/crmFormConfirmation.js',
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
    listContacts: async () => contacts,
    findContactByEmail: async (_configId, email) => contacts.find((c) => c.email === email) || null,
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

test('a returning visitor (same email twice) still gets the form\'s answer both times', async () => {
  const { route, contacts, restore } = loadRoute({ form: baseForm({ afterSubmit: 'redirect', redirectUrl: '/thank-you' }) });
  try {
    const first = await submit(route);
    const second = await submit(route);
    assert.equal(contacts.length, 1);
    assert.equal(second.status, 200);
    assert.equal(first.payload.redirectUrl, '/thank-you');
    assert.equal(second.payload.redirectUrl, '/thank-you');
  } finally {
    restore();
  }
});

test('a submit with no form id behaves exactly as before', async () => {
  const { route, contacts, mail, restore } = loadRoute({ form: baseForm({ afterSubmit: 'redirect', redirectUrl: '/thank-you' }), projectAlertEmails: ['owner@example.com'] });
  try {
    const { status, payload } = await submit(route, { crm_form_id: undefined });
    assert.equal(status, 200);
    assert.equal(payload.message, handling.DEFAULT_SUCCESS_MESSAGE);
    assert.equal(payload.redirectUrl, '');
    assert.equal(contacts[0].source, 'form');
    assert.deepEqual(mail.map((m) => m.to), [['owner@example.com']], 'the project alert still goes out');
  } finally {
    restore();
  }
});

test('a form id from another project is ignored, not obeyed', async () => {
  const foreign = { ...baseForm({ afterSubmit: 'redirect', redirectUrl: '/elsewhere' }), projectId: 'proj_other' };
  const { route, restore } = loadRoute({ form: foreign });
  try {
    const { payload } = await submit(route);
    assert.equal(payload.redirectUrl, '');
    assert.equal(payload.message, handling.DEFAULT_SUCCESS_MESSAGE);
  } finally {
    restore();
  }
});

// ── Visitor confirmation email (task 86bcx18bg) ─────────────────────────────

const CONFIRM = {
  confirmationEnabled: true,
  confirmationSubject: 'We got your message, {{first_name}}',
  confirmationBody: 'Hi {{first_name}} {{last_name}},\n\nWe will reply to {{email}} soon. {{ unknown_key }}',
};

test('placeholders fill from what the visitor typed; unknown ones go blank, never braces', () => {
  assert.equal(handling.fillPlaceholders('Hi {{first_name}}{{nope}}!', { first_name: 'Ana' }), 'Hi Ana!');
  const message = handling.buildConfirmationEmail({ handling: CONFIRM }, { email: 'v@example.com', data: { first_name: 'Ana' }, siteName: 'Delray' });
  assert.equal(message.subject, 'We got your message, Ana');
  assert.equal(message.to, 'v@example.com');
  assert.doesNotMatch(message.text, /[{}]/);
  assert.match(message.text, /We will reply to v@example\.com soon\./);
});

test('what the visitor typed is escaped in the HTML copy', () => {
  const message = handling.buildConfirmationEmail(
    { handling: { ...CONFIRM, confirmationBody: 'Hi {{first_name}}' } },
    { email: 'v@example.com', data: { first_name: '<img src=x onerror=alert(1)>' } }
  );
  assert.doesNotMatch(message.html, /<img/);
  assert.match(message.html, /&lt;img/);
});

test('no confirmation is owed when it is off, or when no address was given', () => {
  assert.equal(handling.buildConfirmationEmail({ handling: { ...CONFIRM, confirmationEnabled: false } }, { email: 'v@example.com' }), null);
  assert.equal(handling.buildConfirmationEmail({ handling: CONFIRM }, { email: '' }), null);
  assert.equal(handling.buildConfirmationEmail(null, { email: 'v@example.com' }), null);
});

test('a confirmation cannot be switched on for a form with no Email field', () => {
  assert.match(handling.confirmationSettingsProblem(CONFIRM, [{ key: 'first_name', type: 'text' }]), /no Email field/);
  assert.equal(handling.confirmationSettingsProblem(CONFIRM, FIELDS), '');
  assert.equal(handling.confirmationSettingsProblem({ confirmationEnabled: false }, []), '', 'off is always allowed');
});

test('forms store: the confirmation settings ride inside fields and read back', () => {
  const { formInputToRow, sanitizeForm } = require('../../lib/crmFormsStore.js');
  const row = formInputToRow({ id: 'f1', crmConfigId: 'c1', name: 'Contact', fields: FIELDS, handling: CONFIRM }, { includeStylesMeta: true });
  const back = sanitizeForm(row);
  assert.equal(back.handling.confirmationEnabled, true);
  assert.equal(back.handling.confirmationSubject, CONFIRM.confirmationSubject);
  assert.equal(back.handling.confirmationBody, CONFIRM.confirmationBody);
});

test('confirmation ON: the visitor is emailed with placeholders filled, reply-to the team', async () => {
  const form = { ...baseForm(CONFIRM), fields: FIELDS };
  const { route, mail, restore } = loadRoute({ form, projectAlertEmails: ['team@example.com'] });
  try {
    const { status } = await submit(route);
    assert.equal(status, 200);
    const toVisitor = mail.filter((m) => m.to === 'visitor@example.com');
    assert.equal(toVisitor.length, 1, 'exactly one confirmation to the visitor');
    assert.equal(toVisitor[0].subject, 'We got your message, Ana');
    assert.match(toVisitor[0].text, /^Hi Ana ,/);
    assert.deepEqual(toVisitor[0].replyTo, ['team@example.com']);
  } finally {
    restore();
  }
});

test('confirmation OFF: nothing is sent to the visitor', async () => {
  const form = { ...baseForm({}), fields: FIELDS };
  const { route, mail, restore } = loadRoute({ form, projectAlertEmails: ['team@example.com'] });
  try {
    await submit(route);
    assert.equal(mail.filter((m) => m.to === 'visitor@example.com').length, 0);
    assert.equal(mail.length, 1, 'only the team alert');
  } finally {
    restore();
  }
});

test('two quick submissions to the same address send ONE confirmation, and both succeed', async () => {
  const form = { ...baseForm(CONFIRM), fields: FIELDS };
  const { route, mail, restore } = loadRoute({ form, projectAlertEmails: ['team@example.com'] });
  const quiet = console.warn;
  console.warn = () => {};
  try {
    // Each call comes from a different client, so only the per-address
    // limit can be what holds the later ones back.
    const first = await submit(route);
    const second = await submit(route);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200, 'the submission itself still succeeds');
    assert.equal(second.payload.message, "Thanks — we'll call you");
    const toVisitor = mail.filter((m) => m.to === 'visitor@example.com');
    assert.equal(toVisitor.length, 1, `one confirmation per address per hour, got ${toVisitor.length}`);
  } finally {
    console.warn = quiet;
    restore();
  }
});

test('one client cannot email a stream of different strangers', async () => {
  const form = { ...baseForm(CONFIRM), fields: FIELDS };
  const { route, mail, restore } = loadRoute({ form });
  const quiet = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 20; i += 1) {
      const res = { statusCode: 0, body: '', headers: {}, setHeader() {}, end(chunk) { this.body = chunk || ''; } };
      const req = {
        method: 'POST',
        url: '/api/crm/contact-submit',
        headers: { host: PROJECT_DOMAIN, 'user-agent': 'test-agent' },
        socket: { remoteAddress: '203.0.113.9' },
        body: { crmConfigId: 'cfg_1', crm_form_id: 'form_1', projectId: PROJECT_ID, email: `stranger${i}@example.com`, data: { first_name: 'X' } },
      };
      await route.handle(req, res, '/api/crm/contact-submit', 'POST');
      assert.equal(res.statusCode, 200);
    }
    const toStrangers = mail.filter((m) => /^stranger\d+@/.test(m.to));
    assert.ok(toStrangers.length >= 1 && toStrangers.length <= 5, `at most five per client per hour, got ${toStrangers.length}`);
  } finally {
    console.warn = quiet;
    restore();
  }
});

test('only ONE plain address is owed a confirmation — never a list or a "Name <addr>"', () => {
  const owed = (email) => handling.buildConfirmationEmail({ handling: CONFIRM }, { email });
  assert.equal(owed('v@example.com').to, 'v@example.com', 'a normal address still gets one');
  assert.equal(owed("o'brien@example.co.uk").to, "o'brien@example.co.uk", 'an apostrophe is a real address');
  const forty = Array.from({ length: 40 }, (_, i) => `stranger${i}@example.com`);
  for (const bad of [
    forty.join(','),
    forty.join(';'),
    'a@example.com b@example.com',
    'Win a prize http://x.test <victim@example.com>',
    '"Prize" victim@example.com',
    'victim@example.com\nBcc: other@example.com',
    'two@@example.com',
    'a@b@example.com',
    'no-at-sign.example.com',
    'v@localhost',
    `${'x'.repeat(65)}@example.com`,
    `v@${'d'.repeat(250)}.com`,
  ]) {
    assert.equal(owed(bad), null, `must send nothing for ${JSON.stringify(bad.slice(0, 60))}`);
  }
});

test('a comma-joined list or a "Name <addr>" in the Email box sends nothing, and the submit still succeeds', async () => {
  const form = { ...baseForm(CONFIRM), fields: FIELDS };
  const { route, mail, restore } = loadRoute({ form, projectAlertEmails: ['team@example.com'] });
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const list = Array.from({ length: 40 }, (_, i) => `stranger${i}@example.com`).join(',');
    for (const email of [list, 'Win a prize http://x.test <victim@example.com>']) {
      const { status, payload } = await submit(route, { email });
      assert.equal(status, 200);
      assert.equal(payload.message, "Thanks — we'll call you");
    }
    const toVisitors = mail.filter((m) => /stranger|victim/.test(String(m.to)));
    assert.equal(toVisitors.length, 0, `no confirmation to a list or a display name, got ${toVisitors.length}`);
    const normal = await submit(route, { email: 'single@example.com' });
    assert.equal(normal.status, 200);
    assert.equal(mail.filter((m) => m.to === 'single@example.com').length, 1, 'a normal address still sends one');
  } finally {
    console.warn = quiet;
    restore();
  }
});

test('a mail failure never fails the submission', async () => {
  const form = { ...baseForm(CONFIRM), fields: FIELDS };
  const { route, restore } = loadRoute({ form });
  const mailer = require.cache[require.resolve('../../lib/mailer.js')];
  const original = mailer.exports.sendEmail;
  mailer.exports.sendEmail = async () => { throw new Error('provider down'); };
  const quiet = console.error;
  console.error = () => {};
  try {
    const { status, payload } = await submit(route);
    assert.equal(status, 200);
    assert.equal(payload.message, "Thanks — we'll call you");
  } finally {
    console.error = quiet;
    mailer.exports.sendEmail = original;
    restore();
  }
});

test('saving a form with the confirmation on and no Email field is refused', async () => {
  const { route, restore } = loadRoute({ form: { ...baseForm({}), fields: FIELDS } });
  try {
    const created = await call(route, 'POST', '/api/crm/forms', {
      body: { crmConfigId: 'cfg_1', name: 'No email', fields: [{ key: 'first_name', type: 'text' }], handling: CONFIRM },
      authUser: { id: FORM_OWNER },
    });
    assert.equal(created.status, 400);
    assert.match(created.payload.error.message, /no Email field/);
    const removed = await call(route, 'PUT', '/api/crm/forms/form_1', {
      body: { fields: [{ key: 'first_name', type: 'text' }], handling: CONFIRM },
      authUser: { id: FORM_OWNER },
    });
    assert.equal(removed.status, 400);
  } finally {
    restore();
  }
});

// ── Per-form team alerts (Loop Queue 86bcx188j) ───────────────────────────────

test('alert addresses are cleaned: lower-cased, de-duplicated, non-addresses dropped', () => {
  const h = handling.normalizeFormHandling({ alertEmails: 'Team@Example.com, nope; team@example.com\nsales@example.com' });
  assert.deepEqual(h.alertEmails, ['team@example.com', 'sales@example.com']);
  assert.deepEqual(handling.invalidEmailEntries('a@b.co, nope'), ['nope']);
});

test('a form with only alert settings is not "default" — they are stored', () => {
  assert.equal(handling.isDefaultHandling({ alertEmails: ['a@b.co'] }), false);
  assert.equal(handling.isDefaultHandling({ alertSubject: 'Hi' }), false);
  const { formInputToRow, sanitizeForm } = require('../../lib/crmFormsStore.js');
  const row = formInputToRow({ id: 'f1', crmConfigId: 'c1', name: 'F', fields: [], handling: { alertEmails: 'a@b.co', alertSubject: 'New lead: {{first_name}}' } });
  const back = sanitizeForm(row);
  assert.deepEqual(back.handling.alertEmails, ['a@b.co']);
  assert.equal(back.handling.alertSubject, 'New lead: {{first_name}}');
  assert.equal(back.fields.length, 0, 'no visitor-facing field for it');
});

test('a visitor value cannot put a line break into the alert subject', () => {
  const form = { handling: handling.normalizeFormHandling({ alertSubject: 'Lead: {{first_name}}' }) };
  const subject = handling.alertSubjectFor(form, { siteName: 'Site', data: { first_name: 'Ann\r\nBcc: x@evil.example' } });
  assert.equal(/[\r\n]/.test(subject), false);
  assert.equal(handling.alertSubjectFor({ handling: { alertSubject: '{{nothing}}' } }, { siteName: 'Site' }), 'New contact form submission — Site');
});

test('a form with its own alert addresses emails those addresses only, with its own subject', async () => {
  const form = baseForm({ alertEmails: 'Coach@Example.com, desk@example.com', alertSubject: 'Lesson request from {{first_name}}' });
  const { route, mail, restore } = loadRoute({ form, projectAlertEmails: ['owner@example.com'] });
  try {
    const { status } = await submit(route);
    assert.equal(status, 200);
    assert.equal(mail.length, 1);
    assert.deepEqual(mail[0].to, ['coach@example.com', 'desk@example.com']);
    assert.equal(mail[0].subject, 'Lesson request from Ana');
    assert.match(mail[0].text, /Form: Contact us/, 'the alert names the form it came from');
  } finally {
    restore();
  }
});

test('a form with no alert addresses alerts the project Contact Alert Email, with the old subject', async () => {
  const { route, mail, restore } = loadRoute({ form: baseForm({}), projectAlertEmails: ['owner@example.com'] });
  try {
    await submit(route);
    assert.deepEqual(mail.map((m) => m.to), [['owner@example.com']]);
    assert.match(mail[0].subject, /^New contact form submission — /);
  } finally {
    restore();
  }
});

test('a mail failure to a form\'s own alert list never fails the submission', async () => {
  const { route, restore } = loadRoute({ form: baseForm({ alertEmails: 'a@b.co' }) });
  const mailer = require.resolve('../../lib/mailer.js');
  const previous = require.cache[mailer].exports.sendEmail;
  require.cache[mailer].exports.sendEmail = async () => { throw new Error('provider down'); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const { status, payload } = await submit(route);
    assert.equal(status, 200);
    assert.equal(payload.message, "Thanks — we'll call you");
  } finally {
    console.error = originalError;
    require.cache[mailer].exports.sendEmail = previous;
    restore();
  }
});

test('the public read of a form hides its alert addresses; a signed-in read keeps them', async () => {
  const form = baseForm({ afterSubmit: 'redirect', redirectUrl: '/thanks', alertEmails: 'coach@example.com', alertSubject: 'Private' });
  const { route, restore } = loadRoute({ form });
  try {
    const anon = await call(route, 'GET', '/api/crm/forms/form_1');
    assert.equal(anon.status, 200);
    assert.equal(anon.payload.data.handling.redirectUrl, '/thanks');
    assert.equal(JSON.stringify(anon.payload).includes('coach@example.com'), false);
    assert.equal(JSON.stringify(anon.payload).includes('Private'), false);
    const admin = await call(route, 'GET', '/api/crm/forms/form_1', { authUser: { id: 'user_owner_1' } });
    assert.deepEqual(admin.payload.data.handling.alertEmails, ['coach@example.com']);
  } finally {
    restore();
  }
});
