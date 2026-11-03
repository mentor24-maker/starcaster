'use strict';

/**
 * What a CRM form does once a visitor presses Submit — show its message, or
 * send the visitor to a page (task 86bcwy44f, slice B). No I/O here, so the
 * node suite can pin every rule without a database.
 *
 * Where it is kept: inside the form's existing `fields` list, as one hidden
 * entry with type "meta" — the same trick the form's styles already use
 * (`__crm_form_styles__`, lib/crmFormStyles.js). Every reader of `fields`
 * already drops "meta" entries, so no visitor-facing field appears, and no
 * database change is needed.
 *
 * A form saved before this existed has no such entry, and every default below
 * is chosen so that form behaves exactly as it did: show the message.
 */

const CRM_FORM_HANDLING_META_KEY = '__crm_form_handling__';
const DEFAULT_SUCCESS_MESSAGE = 'Thank you! Your information has been saved.';
const AFTER_SUBMIT_CHOICES = new Set(['message', 'redirect']);

function text(value) {
  return String(value ?? '').trim();
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
  };
}

/** True when a form carries nothing but defaults — i.e. it behaves as before. */
function isDefaultHandling(handling) {
  const h = normalizeFormHandling(handling);
  return h.afterSubmit === 'message' && !h.redirectUrl && !h.redirectPageId;
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
  safeRedirectUrl,
  normalizeFormHandling,
  isDefaultHandling,
  readFormHandlingMeta,
  embedFormHandlingMeta,
  submitSuccessResponse,
};
