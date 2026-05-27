'use strict';

const { sendEmail } = require('./mailer');
const { getAppPublicOrigin } = require('./appOrigin');
const { getDevTeamMember } = require('./devTeamStore');
const { createTeamInvitation } = require('./teamInvitationsStore');

function safeText(value) {
  return String(value || '').trim();
}

function buildInviteAcceptUrl(origin, rawToken) {
  const base = safeText(origin).replace(/\/+$/, '') || 'http://localhost:3001';
  return `${base}/#invite=${encodeURIComponent(rawToken)}`;
}

function membershipRoleLabel(role) {
  if (role === 'admin') return 'Team Admin';
  if (role === 'editor') return 'Team Editor';
  return 'Team Member';
}

function buildInviteEmailHtml({ projectName, inviteUrl, membershipRole, inviterName }) {
  const project = safeText(projectName) || 'your project';
  const roleLabel = membershipRoleLabel(membershipRole);
  const inviter = safeText(inviterName) || 'A project owner';

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; max-width: 560px;">
      <h2 style="margin: 0 0 1rem;">You're invited to StarCaster</h2>
      <p>${inviter} invited you to join <strong>${project}</strong> as <strong>${roleLabel}</strong>.</p>
      <p>StarCaster helps creators and communities engage across the social web from one console.</p>
      <p style="margin: 2rem 0;">
        <a href="${inviteUrl}" style="display: inline-block; padding: 12px 20px; background: #0b3d7a; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">Accept Invitation</a>
      </p>
      <p style="font-size: 0.9rem; color: #4b5563;">Or copy this link into your browser:<br><a href="${inviteUrl}">${inviteUrl}</a></p>
      <p style="font-size: 0.85rem; color: #6b7280;">This invitation expires in 7 days. If you did not expect this email, you can ignore it.</p>
    </div>
  `.trim();
}

function canManageTeamInvites(req) {
  const userId = safeText(req?.authUser?.id);
  if (!userId) return false;
  const membership = req?.projectContext?.membership
    || req?.projectContext?.project?.membership
    || null;
  const role = safeText(membership?.role).toLowerCase();
  if (role === 'owner') return true;
  const createdBy = safeText(
    req?.projectContext?.project?.createdByUserId
    || req?.projectContext?.project?.created_by_user_id
  );
  return createdBy && createdBy === userId;
}

async function sendTeamMemberInvitation({
  projectId,
  teamMemberId,
  invitedByUserId,
  inviterName,
  projectName,
  req,
}) {
  const pid = safeText(projectId);
  const teamId = safeText(teamMemberId);
  const inviterId = safeText(invitedByUserId);
  if (!pid || !teamId || !inviterId) {
    return { ok: false, status: 400, error: 'projectId, teamMemberId, and invitedByUserId are required' };
  }

  const memberRes = await getDevTeamMember(teamId, pid);
  if (!memberRes.ok) return memberRes;
  const member = memberRes.data;
  const contact = member.contact || {};

  const createRes = await createTeamInvitation({
    projectId: pid,
    contactId: member.contact_id || contact.id,
    devTeamId: teamId,
    invitedByUserId: inviterId,
  });
  if (!createRes.ok) return createRes;

  const { invitation, rawToken } = createRes.data;
  const origin = getAppPublicOrigin(req);
  const inviteUrl = buildInviteAcceptUrl(origin, rawToken);
  const subject = `You're invited to ${safeText(projectName) || 'a StarCaster project'}`;
  const html = buildInviteEmailHtml({
    projectName,
    inviteUrl,
    membershipRole: invitation.membershipRole,
    inviterName,
  });

  const mail = await sendEmail({
    to: invitation.email,
    subject,
    html,
    text: `${inviterName || 'A project owner'} invited you to ${projectName || 'a StarCaster project'} (${membershipRoleLabel(invitation.membershipRole)}). Accept: ${inviteUrl}`,
  });
  if (!mail.ok) {
    return {
      ok: false,
      status: mail.status || 500,
      error: mail.error || 'Failed to send invitation email',
      data: { invitation },
    };
  }

  return {
    ok: true,
    status: 200,
    data: {
      invitation,
      emailed: true,
      email: invitation.email,
    },
  };
}

module.exports = {
  buildInviteAcceptUrl,
  canManageTeamInvites,
  sendTeamMemberInvitation,
};
