'use strict';

/**
 * What a CRM form does once a visitor presses Submit — the per-form settings
 * kept in `crm_forms.handling` (task 86bcwy44f) and the pure rules that read
 * them. No I/O here, so the node suite can pin every rule without a database.
 *
 * A form saved before these settings existed has no `handling` at all, and
 * every default below is chosen so that form behaves exactly as it did:
 * show the message, alert the project's Contact Alert Email, send the visitor
 * nothing.
 */

const DEFAULT_SUCCESS_MESSAGE = 'Thank you! Your information has been saved.';
const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.';
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
    alertEmails: parseEmailList(src.alertEmails),
    alertSubject: text(src.alertSubject).slice(0, 200),
    confirmationEnabled: src.confirmationEnabled === true,
    confirmationSubject: text(src.confirmationSubject).slice(0, 200),
    confirmationBody: String(src.confirmationBody ?? '').slice(0, 10000),
  };
}

/** True when a form carries nothing but defaults — i.e. it behaves as before. */
function isDefaultHandling(handling) {
  const h = normalizeFormHandling(handling);
  return h.afterSubmit === 'message'
    && !h.redirectUrl
    && !h.redirectPageId
    && !h.alertEmails.length
    && !h.alertSubject
    && !h.confirmationEnabled
    && !h.confirmationSubject
    && !h.confirmationBody.trim();
}

/**
 * The part of the settings a public visitor's browser may see. The team's
 * alert addresses and the confirmation wording are the site owner's business;
 * the public form only needs to know where to go next.
 */
function publicFormHandling(handling) {
  const h = normalizeFormHandling(handling);
  return { afterSubmit: h.afterSubmit, redirectUrl: h.afterSubmit === 'redirect' ? h.redirectUrl : '' };
}

/** What the submit endpoint answers a successful visitor with. */
function submitSuccessResponse(form) {
  const handling = normalizeFormHandling(form?.handling);
  return {
    message: text(form?.successMessage) || DEFAULT_SUCCESS_MESSAGE,
    redirectUrl: handling.afterSubmit === 'redirect' ? handling.redirectUrl : '',
  };
}

/** The form's own alert list when it has one; otherwise the project's. */
function resolveAlertRecipients(form, projectAlertEmails) {
  const own = normalizeFormHandling(form?.handling).alertEmails;
  return own.length ? own : parseEmailList(projectAlertEmails);
}

/**
 * Replace `{{first_name}}`-style placeholders with what the visitor submitted.
 * Unknown placeholders become blank rather than staying as braces in an email
 * a member of the public reads. `{{email}}` is the submitted address.
 */
function fillPlaceholders(template, values) {
  const map = values && typeof values === 'object' ? values : {};
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
    const value = map[key] ?? map[String(key).toLowerCase()];
    return value === undefined || value === null ? '' : String(value).trim();
  });
}

/** The contact's `source`, naming the form that captured it. */
function contactSourceForForm(form, fallback) {
  const name = text(form?.name);
  if (name) return `Form: ${name}`.slice(0, 200);
  return text(fallback) || 'form';
}

module.exports = {
  DEFAULT_SUCCESS_MESSAGE,
  DEFAULT_ERROR_MESSAGE,
  parseEmailList,
  safeRedirectUrl,
  normalizeFormHandling,
  isDefaultHandling,
  publicFormHandling,
  submitSuccessResponse,
  resolveAlertRecipients,
  fillPlaceholders,
  contactSourceForForm,
};
