'use strict';

/**
 * What a CRM form does once a visitor presses Submit — show its message, or
 * send the visitor to a page (task 86bcwy44f, slice B) — and who on the team
 * is alerted about it, under what subject (task 86bcx188j). No I/O here, so the
 * node suite can pin every rule without a database.
 *
 * Where it is kept: inside the form's existing `fields` list, as one hidden
 * entry with type "meta" — the same trick the form's styles already use
 * (`__crm_form_styles__`, lib/crmFormStyles.js). Every reader of `fields`
 * already drops "meta" entries, so no visitor-facing field appears, and no
 * database change is needed.
 *
 * A form saved before this existed has no such entry, and every default below
 * is chosen so that form behaves exactly as it did: show the message, and
 * alert the project's Contact Alert Email.
 */

const CRM_FORM_HANDLING_META_KEY = '__crm_form_handling__';
const DEFAULT_SUCCESS_MESSAGE = 'Thank you! Your information has been saved.';
const AFTER_SUBMIT_CHOICES = new Set(['message', 'redirect']);
const MAX_ALERT_EMAILS = 20;
const SIMPLE_EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function text(value) {
  return String(value ?? '').trim();
}

/** "a@b.co, c@d.co\ne@f.co" or an array → unique, valid, lower-cased addresses. */
function parseEmailList(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const email = text(part).toLowerCase();
    if (!email || !SIMPLE_EMAIL.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= MAX_ALERT_EMAILS) break;
  }
  return out;
}

/** The addresses in a list that are not addresses — so the editor can say which. */
function invalidEmailEntries(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  return parts.map(text).filter((part) => part && !SIMPLE_EMAIL.test(part.toLowerCase()));
}

/**
 * Where a visitor may be sent. A same-site path ("/thank-you") or a full
 * http(s) address; anything else — `javascript:`, a protocol-relative
 * "//evil.example", a bare word — is refused as blank, because this value is
 * handed straight to `window.location` on a client's public site.
 */
function safeRedirectUrl(input) {
  const url = text(input);
  if (!url) return '';
  if (url.startsWith('/')) {
    if (url.startsWith('//') || url.startsWith('/\\')) return '';
    return /[\s<>"]/.test(url) ? '' : url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeFormHandling(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const redirectUrl = safeRedirectUrl(src.redirectUrl);
  const afterSubmit = AFTER_SUBMIT_CHOICES.has(src.afterSubmit) && redirectUrl ? src.afterSubmit : 'message';
  return {
    afterSubmit,
    // Kept even while "Show message" is chosen, so switching back and forth in
    // the editor does not lose the page that was picked.
    redirectUrl,
    redirectPageId: text(src.redirectPageId),
    // Team alerts for this form (task 86bcx188j). Blank = the project's
    // Contact Alert Email, so a form nobody touched alerts who it always did.
    alertEmails: parseEmailList(src.alertEmails),
    alertSubject: text(src.alertSubject).replace(/[\r\n]+/g, ' ').slice(0, 200),
  };
}

/** True when a form carries nothing but defaults — i.e. it behaves as before. */
function isDefaultHandling(handling) {
  const h = normalizeFormHandling(handling);
  return h.afterSubmit === 'message'
    && !h.redirectUrl
    && !h.redirectPageId
    && !h.alertEmails.length
    && !h.alertSubject;
}

/**
 * The part of the settings a public visitor's browser may see. The team's
 * alert addresses and subject are the site owner's business; a published page
 * reads the form by id with no sign-in, and only needs where to go next.
 */
function publicFormHandling(handling) {
  const h = normalizeFormHandling(handling);
  return { afterSubmit: h.afterSubmit, redirectUrl: h.redirectUrl, redirectPageId: h.redirectPageId };
}

/** The form's own alert list when it has one; otherwise the project's. */
function resolveAlertRecipients(form, projectAlertEmails) {
  const own = normalizeFormHandling(form?.handling).alertEmails;
  return own.length ? own : parseEmailList(projectAlertEmails);
}

/**
 * Replace `{{first_name}}`-style placeholders with what the visitor submitted.
 * Unknown placeholders become blank rather than staying as braces.
 * `{{email}}` is the submitted address.
 */
function fillPlaceholders(template, values) {
  const map = values && typeof values === 'object' ? values : {};
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
    const value = map[key] ?? map[String(key).toLowerCase()];
    return value === undefined || value === null ? '' : String(value).trim();
  });
}

/**
 * The alert's subject line: the form's own, placeholders filled, when it has
 * one; the long-standing subject otherwise. A visitor's value can never put a
 * line break in a mail header, and a subject that fills to nothing falls back.
 */
function alertSubjectFor(form, { siteName, email, data } = {}) {
  const fallback = `New contact form submission — ${text(siteName) || 'your site'}`;
  const own = normalizeFormHandling(form?.handling).alertSubject;
  if (!own) return fallback;
  const filled = fillPlaceholders(own, { ...(data || {}), email: email || '' })
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);
  return filled || fallback;
}

/** The handling stored in a raw `fields` list, or undefined when there is none. */
function readFormHandlingMeta(fields) {
  const meta = (Array.isArray(fields) ? fields : [])
    .find((field) => text(field?.key) === CRM_FORM_HANDLING_META_KEY);
  return meta ? normalizeFormHandling(meta.handling) : undefined;
}

/**
 * `fields` with the handling entry on the end. A form with only defaults gets
 * no entry, so a form nobody changes stores exactly the fields it did before.
 * Any handling entry already in the list is replaced, never doubled.
 */
function embedFormHandlingMeta(fields, handling) {
  const list = (Array.isArray(fields) ? fields : [])
    .filter((field) => text(field?.key) !== CRM_FORM_HANDLING_META_KEY);
  if (isDefaultHandling(handling)) return list;
  list.push({
    key: CRM_FORM_HANDLING_META_KEY,
    label: '',
    type: 'meta',
    required: false,
    handling: normalizeFormHandling(handling),
  });
  return list;
}

/** What the submit endpoint answers a successful visitor with. */
function submitSuccessResponse(form) {
  const handling = normalizeFormHandling(form?.handling);
  return {
    message: text(form?.successMessage) || DEFAULT_SUCCESS_MESSAGE,
    redirectUrl: handling.afterSubmit === 'redirect' ? handling.redirectUrl : '',
  };
}

module.exports = {
  CRM_FORM_HANDLING_META_KEY,
  DEFAULT_SUCCESS_MESSAGE,
  parseEmailList,
  invalidEmailEntries,
  safeRedirectUrl,
  normalizeFormHandling,
  publicFormHandling,
  resolveAlertRecipients,
  fillPlaceholders,
  alertSubjectFor,
  isDefaultHandling,
  readFormHandlingMeta,
  embedFormHandlingMeta,
  submitSuccessResponse,
};
