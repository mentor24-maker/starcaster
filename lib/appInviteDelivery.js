'use strict';

/**
 * lib/appInviteDelivery.js
 * The email that carries a platform invitation, and the one that goes back to
 * an inviter when someone lands without a workspace.
 */

const { sendEmail } = require('./mailer');
const { getAppPublicOrigin } = require('./appOrigin');

function safeText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return safeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The sign-up link. `#signup-invite=` deliberately differs from the existing
 * `#project-invite=`: that one adds an already-registered user to another
 * project, this one is the only route to creating an account at all.
 */
function buildSignupUrl(origin, rawToken) {
  const base = safeText(origin).replace(/\/+$/, '') || 'http://localhost:3001';
  return `${base}/#signup-invite=${encodeURIComponent(rawToken)}`;
}

/**
 * Two audiences, one link. Telling somebody who already has a StarCaster
 * login to "create your account" sends them to a form that will refuse them,
 * so the wording turns on whether the address is already registered.
 */
function buildInviteEmailHtml({ inviterName, projectName, signupUrl, hasAccount }) {
  const inviter = escapeHtml(inviterName) || 'A StarCaster admin';
  const project = escapeHtml(projectName);
  const url = escapeHtml(signupUrl);
  const cta = hasAccount ? (project ? `Join ${project}` : 'Open StarCaster') : 'Create your account';

  const lead = hasAccount
    ? (project
      ? `<p>${inviter} has invited you to <strong>${project}</strong> on StarCaster.</p>
         <p>You already have a StarCaster account — sign in with this address and the workspace will be added to it.</p>`
      : `<p>${inviter} has invited you to another workspace on StarCaster.</p>`)
    : (project
      ? `<p>${inviter} has invited you to create a StarCaster account.</p><p>You'll start in <strong>${project}</strong>.</p>`
      : `<p>${inviter} has invited you to create a StarCaster account.</p>
         <p>Once you're in, you can ask them which workspace you should have access to.</p>`);

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; max-width: 560px;">
      <h2 style="margin: 0 0 1rem;">${hasAccount && project ? `You're invited to ${project}` : "You're invited to StarCaster"}</h2>
      ${lead}
      <p style="margin: 2rem 0;">
        <a href="${url}" style="display: inline-block; padding: 12px 20px; background: #0b3d7a; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">${escapeHtml(cta)}</a>
      </p>
      <p style="font-size: 0.9rem; color: #4b5563;">Or copy this link into your browser:<br><a href="${url}">${url}</a></p>
      <p style="font-size: 0.85rem; color: #6b7280;">This invitation expires in 7 days and can only be used once. If you did not expect this email, you can ignore it.</p>
    </div>
  `.trim();
}

async function sendInviteEmail({ req, toEmail, rawToken, inviterName, projectName, hasAccount }) {
  const to = safeText(toEmail);
  if (!to) return { ok: false, status: 400, error: 'A recipient address is required' };

  const signupUrl = buildSignupUrl(getAppPublicOrigin(req), rawToken);
  const project = safeText(projectName);
  const inviter = safeText(inviterName) || 'A StarCaster admin';

  const subject = hasAccount
    ? (project ? `You're invited to ${project} on StarCaster` : "You've been invited to another StarCaster workspace")
    : (project ? `You're invited to ${project} on StarCaster` : "You're invited to StarCaster");

  const text = hasAccount
    ? `${inviter} has invited you to ${project || 'another workspace'} on StarCaster. You already have an account — sign in with this address and it will be added.\n\n${signupUrl}\n\nThis invitation expires in 7 days.`
    : `${inviter} has invited you to create a StarCaster account.\n\n${signupUrl}\n\nThis invitation expires in 7 days.`;

  return sendEmail({
    to,
    subject,
    html: buildInviteEmailHtml({ inviterName, projectName: project, signupUrl, hasAccount }),
    text,
  });
}

function buildAccessRequestHtml({ requesterName, requesterEmail, note, appUrl }) {
  const who = escapeHtml(requesterName) || escapeHtml(requesterEmail);
  const email = escapeHtml(requesterEmail);
  const message = safeText(note)
    ? `<blockquote style="margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid #d1d5db; color: #374151;">${escapeHtml(note)}</blockquote>`
    : '';

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; max-width: 560px;">
      <h2 style="margin: 0 0 1rem;">${who} is waiting for a workspace</h2>
      <p><strong>${who}</strong> (${email}) signed up from your invitation, but the invitation didn't name a workspace — so they can't see anything yet.</p>
      ${message}
      <p>Add them from <strong>Settings &rsaquo; Projects</strong>, on the project they should have.</p>
      <p style="margin: 2rem 0;">
        <a href="${escapeHtml(appUrl)}" style="display: inline-block; padding: 12px 20px; background: #0b3d7a; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">Open StarCaster</a>
      </p>
    </div>
  `.trim();
}

/**
 * Tell the person who invited them. Deliberately NOT "pick a project and
 * email its owners": a user with no workspace would have to be shown a list
 * of every project on the platform to choose from, which leaks one client's
 * existence to another. The inviter is already known, so nothing is exposed.
 */
async function sendAccessRequestEmail({ req, toEmails, requesterName, requesterEmail, note }) {
  const recipients = (Array.isArray(toEmails) ? toEmails : [toEmails])
    .map(safeText)
    .filter(Boolean);
  if (!recipients.length) return { ok: false, status: 400, error: 'No one to notify' };

  const appUrl = getAppPublicOrigin(req);
  return sendEmail({
    to: recipients,
    subject: `${safeText(requesterName) || safeText(requesterEmail)} needs access to a workspace`,
    html: buildAccessRequestHtml({ requesterName, requesterEmail, note, appUrl }),
    text: `${safeText(requesterName) || safeText(requesterEmail)} (${safeText(requesterEmail)}) signed up but has no workspace yet.\n\n${safeText(note)}\n\n${appUrl}`,
    replyTo: safeText(requesterEmail) || undefined,
  });
}

module.exports = {
  buildSignupUrl,
  sendInviteEmail,
  sendAccessRequestEmail,
};
