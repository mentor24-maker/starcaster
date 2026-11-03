'use strict';

/**
 * Send a visitor the confirmation email their form promises (task 86bcx18bg).
 * The wording and the "is one owed?" rule live in lib/crmFormHandling.js;
 * this is only the sending.
 *
 * Dependencies are required at CALL time, so the node suite can swap the
 * mailer per test without this module holding on to the first test's copy.
 *
 * A mail failure never fails the submission: by the time this runs the
 * visitor's contact is saved, and a site owner's mail trouble must not show
 * them an error. Failures go to the server log instead.
 */

const { buildConfirmationEmail } = require('./crmFormHandling');

async function sendVisitorConfirmation({ projectId, form, email, data }) {
  if (!buildConfirmationEmail(form, { email, data })) return { sent: false, reason: 'not-owed' };
  try {
    const { getPublicProjectById } = require('./projectsStore');
    const { getContactAlertEmails } = require('./projectSiteSettingsStore');
    const { sendEmail } = require('./mailer');
    const projectResult = await getPublicProjectById(projectId).catch(() => null);
    const siteName = String(projectResult?.data?.name || '').trim();
    const message = buildConfirmationEmail(form, { email, data, siteName });
    // A visitor who hits Reply reaches the team — the project's Contact Alert
    // Email — never a no-reply address.
    const team = await getContactAlertEmails(projectId).catch(() => []);
    const mail = await sendEmail({
      to: message.to,
      fromName: siteName || undefined,
      replyTo: team.length ? team : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (!mail?.ok) console.error('[crm] Visitor confirmation email failed:', mail?.error);
    return { sent: Boolean(mail?.ok) };
  } catch (err) {
    console.error('[crm] Visitor confirmation email threw:', err?.message || err);
    return { sent: false, reason: 'threw' };
  }
}

module.exports = { sendVisitorConfirmation };
