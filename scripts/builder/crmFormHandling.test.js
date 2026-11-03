'use strict';

/**
 * CRM form handling, slice B (Loop Queue 86bcwy44f): the form's own success
 * message, and "After submit: go to a page" — kept inside the form's existing
 * `fields` list, so no database change — with forms that set nothing behaving
 * exactly as before.
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
const REDIRECT = { afterSubmit: 'redirect', redirectUrl: '/thank-you', redirectPageId: 'pg_9' };
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
