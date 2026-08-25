'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOG_PREFIX,
  pagesAskForEmail,
  projectWantsBugReportEmail,
  composeBugReportEmail,
  emailBugReport,
} = require('../../lib/bugReportEmail');

/**
 * Bug Report 5/5 — the optional email to the project's support address.
 *
 * Two things are actually worth pinning here, and neither is "an email got
 * sent":
 *
 *   1. THE TOGGLE CANNOT COME FROM THE REQUEST. `/api/public/bug-report` has
 *      no auth, so a request-supplied flag would let any visitor point a
 *      tenant's own site at the owner's inbox. The setting is read from the
 *      project's pages, and these tests prove a request that SHOUTS for email
 *      gets none when the pages do not ask for it.
 *   2. A PAGE READ THAT FAILS MEANS "DO NOT SEND", not "off" and not "send".
 *      That asymmetry is the whole failure design; a test that let an
 *      unreadable page list fall through to either answer would be the bug.
 *
 * Plus the inherited rule from 3/5: nothing here may throw or block the
 * reporter's thank-you.
 */

const SCOPE = { projectId: 'proj_1', userId: '' };

const REPORT = Object.freeze({
  id: 'rep_1',
  projectId: 'proj_1',
  description: 'The booking button does nothing on mobile.',
  pageUrl: 'https://example.com/book',
  viewerTier: 'public',
  createdAt: '2026-08-23T10:00:00Z',
  screenshotAssetIds: [],
});

/** A project whose pages carry a bug-report module with the toggle in a given state. */
function pagesWithToggle(value) {
  return [{
    id: 'page_1',
    layoutSections: [{
      id: 'sec_1',
      modules: [{ id: 'mod_1', type: 'bug-report', settings: { visibility: 'public', emailReports: value } }],
    }],
  }];
}

function deps({ pages = pagesWithToggle('true'), listPagesResult, sendResult = { ok: true }, address = 'owner@example.com' } = {}) {
  const sent = [];
  const logs = [];
  return {
    sent,
    logs,
    deps: {
      log: (m) => logs.push(String(m)),
      listPages: async (limit, scope) => {
        // Landmine 12: the limit comes FIRST. A store call written the other
        // way round reads the scope as a limit and returns every project's
        // pages — a tenant leak that looks like a successful query.
        assert.equal(typeof limit, 'number', 'listPages must be called with the limit first');
        assert.equal(scope, SCOPE);
        return listPagesResult || { ok: true, data: pages };
      },
      resolveSupportDeliveryEmail: async () => address,
      getPublicProjectById: async () => ({ ok: true, data: { name: 'Delray Tennis' } }),
      resolveScreenshotUrls: async () => [],
      sendEmail: async (payload) => { sent.push(payload); return sendResult; },
    },
  };
}

// ── 1. The scan itself ────────────────────────────────────────────────────

test('a bug-report module with the toggle on is found', () => {
  assert.equal(pagesAskForEmail(pagesWithToggle('true')), true);
});

test('the toggle off, absent, or a non-"true" string all mean off', () => {
  assert.equal(pagesAskForEmail(pagesWithToggle('false')), false);
  assert.equal(pagesAskForEmail(pagesWithToggle('')), false);
  assert.equal(pagesAskForEmail(pagesWithToggle('yes')), false);
  assert.equal(pagesAskForEmail([{ layoutSections: [{ modules: [{ type: 'bug-report', settings: {} }] }] }]), false);
});

test('the toggle on a DIFFERENT module type is ignored', () => {
  const pages = [{ layoutSections: [{ modules: [{ type: 'contact-form', settings: { emailReports: 'true' } }] }] }];
  assert.equal(pagesAskForEmail(pages), false);
});

test('malformed page shapes do not throw', () => {
  assert.equal(pagesAskForEmail(null), false);
  assert.equal(pagesAskForEmail([null, {}, { layoutSections: 'nope' }]), false);
  assert.equal(pagesAskForEmail([{ layoutSections: [{ modules: null }] }]), false);
});

test('the { sections: [...] } column shape is read as well as the bare array', () => {
  // Landmine 13 / the lineage bug: layout_sections is stored as
  // { sections: [...] } but handed around as a bare array. Reading only one
  // shape means the setting silently reads as "off" for half the callers.
  const wrapped = [{ layoutSections: { sections: [{ modules: [{ type: 'bug-report', settings: { emailReports: 'true' } }] }] } }];
  assert.equal(pagesAskForEmail(wrapped), true);
});

// ── 2. A failed page read is not "off" ────────────────────────────────────

test('a page read that fails reports ok:false, not wanted:false-and-fine', async () => {
  const r = await projectWantsBugReportEmail(SCOPE, deps({ listPagesResult: { ok: false, error: 'boom' } }).deps);
  assert.equal(r.ok, false);
  assert.equal(r.wanted, false);
  assert.match(r.error, /boom/);
});

test('a page read that throws is caught and reported as unreadable', async () => {
  const r = await projectWantsBugReportEmail(SCOPE, { listPages: async () => { throw new Error('network'); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /network/);
});

test('an unreadable page list sends NO email and logs loudly', async () => {
  const h = deps({ listPagesResult: { ok: false, error: 'RLS said no' } });
  const out = await emailBugReport(REPORT, SCOPE, h.deps);
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'setting_unreadable');
  assert.equal(h.sent.length, 0, 'must not send on a guess');
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], new RegExp(LOG_PREFIX.replace(/[[\]]/g, '\\$&')));
  assert.match(h.logs[0], /RLS said no/);
});

// ── 3. The request cannot turn it on ──────────────────────────────────────

test('a report that carries its own emailReports flag is ignored', async () => {
  // The shape a hostile visitor would post. The pages say off; off wins.
  const hostile = { ...REPORT, emailReports: 'true', settings: { emailReports: 'true' }, sendEmail: true };
  const h = deps({ pages: pagesWithToggle('false') });
  const out = await emailBugReport(hostile, SCOPE, h.deps);
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'not_enabled');
  assert.equal(h.sent.length, 0);
});

test('the toggle off is a silent, unlogged non-event', async () => {
  const h = deps({ pages: pagesWithToggle('false') });
  const out = await emailBugReport(REPORT, SCOPE, h.deps);
  assert.equal(out.reason, 'not_enabled');
  assert.equal(h.logs.length, 0, 'an off toggle is not a failure and must not log');
});

// ── 4. The happy path, and what it sends ──────────────────────────────────

test('the toggle on sends one email to the support address', async () => {
  const h = deps();
  const out = await emailBugReport(REPORT, SCOPE, h.deps);
  assert.equal(out.sent, true);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].to, 'owner@example.com');
  assert.match(h.sent[0].subject, /Delray Tennis/);
  assert.match(h.sent[0].text, /booking button/);
  assert.equal(h.logs.length, 0);
});

test('the body carries the description, page, and report id', () => {
  const mail = composeBugReportEmail(REPORT, { project: { name: 'Delray Tennis' }, screenshotUrls: ['https://cdn/x.png'] });
  assert.match(mail.text, /The booking button does nothing on mobile\./);
  assert.match(mail.text, /https:\/\/example\.com\/book/);
  assert.match(mail.text, /rep_1/);
  assert.match(mail.text, /https:\/\/cdn\/x\.png/);
  assert.match(mail.html, /Screenshot 1/);
});

test('a hostile description cannot inject markup into the HTML body', () => {
  const mail = composeBugReportEmail(
    { ...REPORT, description: '<script>alert(1)</script>' },
    { project: { name: 'Delray Tennis' } }
  );
  assert.ok(!mail.html.includes('<script>'), 'the description must be escaped');
  assert.match(mail.html, /&lt;script&gt;/);
});

test('a javascript: page URL is shown but never linked', () => {
  // eslint-disable-next-line no-script-url
  const mail = composeBugReportEmail({ ...REPORT, pageUrl: 'javascript:alert(1)' }, {});
  assert.ok(!/href="javascript:/i.test(mail.html), 'must not become a live link');
  assert.match(mail.html, /javascript:alert\(1\)/, 'but the operator should still see what was reported');
});

// ── 5. Nothing here may break the submission ──────────────────────────────

test('no support address set: no email, a loud log, no throw', async () => {
  const h = deps({ address: '' });
  const out = await emailBugReport(REPORT, SCOPE, h.deps);
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'no_address');
  assert.match(h.logs[0], /Support Email/);
});

test('a broken mailer is reported, not thrown', async () => {
  const h = deps({ sendResult: { ok: false, error: 'Resend API key is completely missing' } });
  const out = await emailBugReport(REPORT, SCOPE, h.deps);
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'send_failed');
  assert.match(h.logs[0], /Resend API key/);
});

test('a mailer that throws is caught', async () => {
  const h = deps();
  h.deps.sendEmail = async () => { throw new Error('socket hang up'); };
  const out = await emailBugReport(REPORT, SCOPE, h.deps);
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'threw');
  assert.match(h.logs[0], /socket hang up/);
});

test('a broken screenshot lookup still sends the email', async () => {
  const h = deps();
  h.deps.resolveScreenshotUrls = async () => { throw new Error('assets down'); };
  const out = await emailBugReport(REPORT, SCOPE, h.deps);
  assert.equal(out.sent, true, 'a missing screenshot must not cost the alert');
  assert.match(h.sent[0].text, /none attached/);
});

test('a broken project lookup still sends, falling back to the project id', async () => {
  const h = deps();
  h.deps.getPublicProjectById = async () => { throw new Error('projects down'); };
  const out = await emailBugReport(REPORT, SCOPE, h.deps);
  assert.equal(out.sent, true);
  assert.match(h.sent[0].subject, /proj_1/);
});

// ── 6. The route runs it, and answers 201 either way ──────────────────────

test('the submit route calls emailBugReport after the row is written', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../routes/publicSite.js'), 'utf8');

  const write = src.indexOf('await createBugReport(');
  const email = src.indexOf('await emailBugReport(');
  assert.ok(write > -1, 'the route must still write the row');
  assert.ok(email > -1, 'the route must send the email');
  assert.ok(email > write, 'the row is the record: it is written BEFORE the email is attempted');

  // Awaited, not fire-and-forget: Vercel freezes the lambda the moment the
  // response goes out, which silently kills an un-awaited send.
  assert.ok(!/(?<!await )\bemailBugReport\(/.test(src),
    'emailBugReport must be awaited — an un-awaited send dies when the lambda freezes');
});
