'use strict';

/**
 * What a CRM form does once a visitor presses Submit — show its message, or
 * send the visitor to a page (task 86bcwy44f, slice B), and optionally email
 * the visitor a confirmation (task 86bcx18bg). No I/O here, so the node suite
 * can pin every rule without a database.
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
    // The visitor's confirmation email (task 86bcx18bg). Off unless switched
    // on, so every form saved before this sends the visitor nothing.
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
    && !h.confirmationEnabled
    && !h.confirmationSubject
    && !h.confirmationBody.trim();
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

/**
 * Does the form ask the visitor for their email? The live form sends the
 * field keyed `email` as the submission's address, so that key is the test.
 */
function formHasEmailField(fields) {
  return (Array.isArray(fields) ? fields : [])
    .some((field) => field && field.type !== 'meta' && text(field.key).toLowerCase() === 'email');
}

/**
 * Why these settings cannot be saved on a form with these fields, or '' when
 * they can. A confirmation on a form that never collects an address would be
 * switched on and never sent — refused rather than kept quietly.
 */
function confirmationSettingsProblem(handling, fields) {
  if (!normalizeFormHandling(handling).confirmationEnabled) return '';
  if (formHasEmailField(fields)) return '';
  return 'This form has no Email field, so it cannot email the visitor a confirmation. Add the Email field or turn the confirmation off.';
}

/**
 * Replace `{{first_name}}`-style placeholders with what the visitor submitted.
 * An unknown placeholder becomes blank rather than staying as braces in an
 * email a member of the public reads. `{{email}}` is the submitted address.
 */
function fillPlaceholders(template, values) {
  const map = values && typeof values === 'object' ? values : {};
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
    const value = map[key] ?? map[String(key).toLowerCase()];
    return value === undefined || value === null ? '' : String(value).trim();
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The confirmation email for one submission, or null when none is owed: the
 * form has it off, or the visitor gave no address. The wording is the site
 * owner's plain text; whatever the visitor typed into it is escaped in the
 * HTML copy, because a placeholder carries their input into the message.
 */
/**
 * Is this ONE plain email address — what a visitor types for themselves —
 * and nothing more? The submit endpoint is public, so the Email box holds
 * whatever a script POSTs. A comma-joined list would mail every stranger in
 * it while using a single slot of the per-address throttle, and
 * "Win a prize <victim@example.com>" would put the sender's text in the To
 * line. So no commas, semicolons, spaces, angle brackets or double quotes, exactly
 * one "@", and the lengths the email standard allows (round-2 review of
 * task 86bcx18bg).
 */
function isSinglePlainAddress(value) {
  const address = String(value ?? '');
  if (!address || address.length > 254) return false;
  if (/[\s,;<>"()\[\]\\]/.test(address)) return false;
  const parts = address.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain);
}

function buildConfirmationEmail(form, { email, data, siteName } = {}) {
  const handling = normalizeFormHandling(form?.handling);
  const to = text(email);
  // Anything that is not one plain address is skipped silently — the
  // submission still succeeds; only the confirmation is not owed.
  if (!handling.confirmationEnabled || !isSinglePlainAddress(to)) return null;
  const site = text(siteName) || 'us';
  const values = { ...(data && typeof data === 'object' ? data : {}), email: to };
  const subject = fillPlaceholders(handling.confirmationSubject, values).trim() || `Thanks for contacting ${site}`;
  const body = fillPlaceholders(handling.confirmationBody, values).trim()
    || `Thank you for getting in touch with ${site}. We have your message and will reply soon.`;
  const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #18324a; font-size: 15px; line-height: 1.5;">
        ${body.split(/\n{2,}/).map((para) => `<p style="margin: 0 0 14px;">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`).join('')}
      </div>
    `;
  return { to, subject, text: body, html };
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
  formHasEmailField,
  confirmationSettingsProblem,
  fillPlaceholders,
  isSinglePlainAddress,
  buildConfirmationEmail,
};
