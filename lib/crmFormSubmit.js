'use strict';

/**
 * A public CRM form submission, end to end (task 86bcwy44f): keep the contact,
 * keep the submission, alert the team, confirm to the visitor, and say what the
 * visitor's browser should do next.
 *
 * Its dependencies are required at CALL time, not load time, so the node suite
 * can swap a store in require.cache per test without this module holding on to
 * the first test's copy.
 *
 * Mail never fails a submission. By the time an email is attempted, the
 * visitor's data is saved; a site owner's misconfigured mail provider must not
 * show them an error. Failures go to the server log instead.
 */

const {
  normalizeFormHandling,
  resolveAlertRecipients,
  fillPlaceholders,
  contactSourceForForm,
  submitSuccessResponse,
} = require('./crmFormHandling');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "first_name" -> "First Name" — used for alert-email row labels. */
function humanizeFieldKey(key) {
  return String(key || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function siteNameFor(projectId) {
  const { getPublicProjectById } = require('./projectsStore');
  const projectResult = await getPublicProjectById(projectId);
  return String(projectResult?.data?.name || '').trim() || 'your site';
}

/**
 * Email the team about a submission: the form's own alert list when it has
 * one, otherwise the project's Contact Alert Email (tenant admin Settings).
 * An empty result means no alerts — exactly as before.
 *
 * All recipients go on one message rather than one message each, so a reply
 * keeps the whole team on the thread.
 */
async function notifyContactAlertEmail({ projectId, form, email, data, isDuplicate, siteName }) {
  try {
    const { getContactAlertEmails } = require('./projectSiteSettingsStore');
    const { sendEmail } = require('./mailer');
    const handling = normalizeFormHandling(form?.handling);
    const alertTo = handling.alertEmails.length
      ? handling.alertEmails
      : resolveAlertRecipients(form, await getContactAlertEmails(projectId));
    if (!alertTo.length) return { sent: false, to: [] };

    const site = typeof siteName === 'function' ? await siteName() : (siteName || await siteNameFor(projectId));

    const rows = [];
    if (form?.name) rows.push(['Form', form.name]);
    if (email) rows.push(['Email', email]);
    for (const [key, value] of Object.entries(data || {})) {
      const text = String(value ?? '').trim();
      if (!text) continue;
      if (key === 'email' && email) continue;
      rows.push([humanizeFieldKey(key), text]);
    }
    if (!rows.length) rows.push(['(no details submitted)', '']);

    const footer = isDuplicate
      ? 'This email address was already in your contacts, so no new contact was created — the submission itself is saved with the form.'
      : 'This has been saved to your Contact Manager.';
    const subject = handling.alertSubject
      ? fillPlaceholders(handling.alertSubject, { ...data, email })
      : `New contact form submission — ${site}`;

    const textBody = [
      `New contact form submission on ${site}.`,
      '',
      ...rows.map(([label, value]) => `${label}: ${value}`),
      '',
      footer,
    ].join('\n');

    const htmlRows = rows.map(([label, value]) => `
      <tr>
        <td style="padding: 6px 12px 6px 0; color: #587592; font-size: 13px; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td>
        <td style="padding: 6px 0; color: #18324a; font-size: 14px;">${escapeHtml(value)}</td>
      </tr>`).join('');

    const mail = await sendEmail({
      to: alertTo,
      fromName: site,
      replyTo: email || undefined,
      subject,
      text: textBody,
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #18324a;">
          <h2 style="margin: 0 0 16px;">New contact form submission</h2>
          <table style="border-collapse: collapse;">${htmlRows}</table>
          <p style="margin: 20px 0 0; color: #587592; font-size: 13px;">${escapeHtml(footer)}</p>
        </div>
      `,
    });

    if (!mail?.ok) console.error('[crm] Contact alert email failed:', mail?.error);
    return { sent: Boolean(mail?.ok), to: alertTo };
  } catch (err) {
    console.error('[crm] Contact alert email threw:', err?.message || err);
    return { sent: false, to: [] };
  }
}

/**
 * The visitor's confirmation email, when the form has it switched on and the
 * visitor gave an address. The body is plain text the site owner wrote, with
 * `{{field_key}}` placeholders filled from the submission.
 */
async function sendVisitorConfirmation({ projectId, form, email, data, siteName }) {
  const handling = normalizeFormHandling(form?.handling);
  if (!handling.confirmationEnabled || !email) return { sent: false };
  try {
    const { sendEmail } = require('./mailer');
    const { getContactAlertEmails } = require('./projectSiteSettingsStore');
    const site = typeof siteName === 'function' ? await siteName() : (siteName || await siteNameFor(projectId));
    const values = { ...data, email };
    const subject = fillPlaceholders(handling.confirmationSubject, values) || `Thanks for contacting ${site}`;
    const body = fillPlaceholders(handling.confirmationBody, values).trim()
      || `Thank you for getting in touch with ${site}. We have your message and will reply soon.`;
    // A visitor who hits Reply should reach the team, not a no-reply address.
    const teamTo = resolveAlertRecipients(form, await getContactAlertEmails(projectId));
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #18324a; font-size: 15px; line-height: 1.5;">
        ${body.split(/\n{2,}/).map((para) => `<p style="margin: 0 0 14px;">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`).join('')}
      </div>
    `;
    const mail = await sendEmail({
      to: email,
      fromName: site,
      replyTo: teamTo[0] || undefined,
      subject,
      text: body,
      html,
    });
    if (!mail?.ok) console.error('[crm] Visitor confirmation email failed:', mail?.error);
    return { sent: Boolean(mail?.ok) };
  } catch (err) {
    console.error('[crm] Visitor confirmation email threw:', err?.message || err);
    return { sent: false };
  }
}

/**
 * The form a submission names, inside the project the request resolved to.
 * A form id from another project reads as no form at all — its settings
 * (redirect, alert addresses) must never apply to someone else's site.
 */
async function loadSubmittedForm(crmFormId, crmConfigId, projectId) {
  const id = String(crmFormId || '').trim();
  if (!id) return null;
  try {
    const { getForm } = require('./crmFormsStore');
    const form = await getForm(id, { projectId, userId: '' });
    if (!form) return null;
    if (form.projectId && form.projectId !== projectId) return null;
    if (form.crmConfigId && crmConfigId && form.crmConfigId !== crmConfigId) return null;
    return form;
  } catch (err) {
    console.error('[crm] Loading the submitted form failed:', err?.message || err);
    return null;
  }
}

/**
 * Run one public submission. Returns what the endpoint answers:
 * `{ message, redirectUrl }`. Throws only on a contact write that failed for a
 * reason other than a duplicate email — the visitor's data was NOT kept, so
 * that one must reach them as an error.
 */
async function processPublicSubmission({ crmConfigId, crmFormId, projectId, email, data, source, pageUrl }) {
  const { createContact, findContactByEmail } = require('./crmContactsStore');
  const form = await loadSubmittedForm(crmFormId, crmConfigId, projectId);

  let contactId = '';
  let isDuplicate = false;
  try {
    const created = await createContact({
      crmConfigId,
      email,
      data,
      source: contactSourceForForm(form, source),
      tags: [],
    }, { projectId, userId: '' });
    contactId = String(created?.id || '');
  } catch (err) {
    if (err.code !== 'DUPLICATE_EMAIL') throw err;
    isDuplicate = true;
    if (typeof findContactByEmail === 'function') {
      const existing = await findContactByEmail(crmConfigId, email, { projectId }).catch(() => null);
      contactId = String(existing?.id || '');
    }
  }

  // Every submission is kept, a returning visitor's included. A failure here
  // is logged loudly but does not fail the visitor: their contact is saved and
  // the team is still alerted with every field below.
  if (form) {
    try {
      const { createSubmission } = require('./crmFormSubmissionsStore');
      const saved = await createSubmission({
        crmFormId: form.id,
        crmContactId: contactId,
        email,
        data,
        pageUrl,
      }, { projectId, userId: form.ownerUserId || 'public_form' });
      if (!saved.ok) console.error('[crm] Form submission row was not written:', saved.error);
    } catch (err) {
      console.error('[crm] Form submission row threw:', err?.message || err);
    }
  }

  // Looked up once, and only if an email is actually going out.
  let siteNamePromise = null;
  const siteName = () => (siteNamePromise ||= siteNameFor(projectId).catch(() => 'your site'));
  // Awaited rather than fire-and-forget: on Vercel the lambda freezes as soon
  // as the response is sent, which silently kills in-flight work.
  await notifyContactAlertEmail({ projectId, form, email, data, isDuplicate, siteName });
  await sendVisitorConfirmation({ projectId, form, email, data, siteName });

  return submitSuccessResponse(form);
}

module.exports = {
  processPublicSubmission,
  notifyContactAlertEmail,
  sendVisitorConfirmation,
  loadSubmittedForm,
};
