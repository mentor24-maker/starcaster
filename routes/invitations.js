'use strict';

/**
 * routes/invitations.js
 * Platform invitations — the only route to a StarCaster login.
 *
 * Who may invite (decided with the operator, 2026-08-12):
 *   - the platform owner (app user role 'owner') — anyone, into any project
 *     or into none at all;
 *   - a project owner — into that project only.
 * Nobody else. A plain member cannot grow the platform.
 *
 * SECURITY NOTE: GET /api/invitations/verify is deliberately unauthenticated
 * — the invited person has no account yet, so nothing else could reach it. It
 * takes a token, and answers only with the invited email address and the
 * project name, so a stolen link reveals nothing the link's holder was not
 * already being told in the email. It never lists invitations and never
 * accepts one; redemption happens in POST /api/auth/register.
 */

const { sendOk, sendErr, parseJsonBody, normalizeApiPathname, getUrlObj } = require('./http');
const {
  createInvitation,
  getInvitationByToken,
  getInvitationById,
  listInvitations,
  revokeInvitation,
} = require('../lib/appInvitationsStore');
const { sendInviteEmail, sendAccessRequestEmail, buildSignupUrl } = require('../lib/appInviteDelivery');
const { getAppPublicOrigin } = require('../lib/appOrigin');
const { listProjectsForUser, addMemberToProject, setActiveProjectForSession } = require('../lib/projectsStore');
const { getUserById, findUserByEmail } = require('../lib/authStore');
const { acceptInvitation } = require('../lib/appInvitationsStore');

function safeText(value) {
  return String(value || '').trim();
}

function isPlatformOwner(req) {
  return safeText(req?.authUser?.role).toLowerCase() === 'owner';
}

/**
 * Resolve who the invite is for and whether this user may send it.
 * Returns { ok, projectId, projectName } or an error shape.
 */
async function resolveInviteTarget(req, requestedProjectId) {
  const userId = safeText(req?.authUser?.id);
  const platformOwner = isPlatformOwner(req);

  // "Optional, defaults to the sender's project": an invite with no project
  // named lands the invitee wherever the sender is currently working.
  const fallbackProjectId = safeText(req?.projectContext?.project?.id);
  const targetProjectId = safeText(requestedProjectId) || fallbackProjectId;

  if (!targetProjectId) {
    // No project at all. Only the platform owner may create an account that
    // starts with nothing — for anyone else it would be an accident.
    if (!platformOwner) {
      return { ok: false, status: 400, error: 'Choose a project for this invitation', code: 'PROJECT_REQUIRED' };
    }
    return { ok: true, projectId: '', projectName: '' };
  }

  const listResult = await listProjectsForUser(userId);
  if (!listResult.ok) return { ok: false, status: listResult.status || 500, error: listResult.error };
  const projects = Array.isArray(listResult.data) ? listResult.data : [];
  const project = projects.find((row) => safeText(row?.id) === targetProjectId) || null;

  if (!project) {
    // Do not distinguish "no such project" from "not yours": that difference
    // would let anyone probe for the existence of other clients' projects.
    return { ok: false, status: 403, error: 'Project not found or access denied', code: 'FORBIDDEN' };
  }

  const isProjectOwner = safeText(project?.membership?.role).toLowerCase() === 'owner';
  if (!platformOwner && !isProjectOwner) {
    return { ok: false, status: 403, error: 'Only a project owner can invite people to it', code: 'FORBIDDEN' };
  }

  return { ok: true, projectId: targetProjectId, projectName: safeText(project?.name) };
}

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();
  const normalizedPath = normalizeApiPathname(pathname);
  if (!normalizedPath.startsWith('/api/invitations')) return false;

  // Unauthenticated: the invited person has no account yet. See SECURITY NOTE.
  if (normalizedPath === '/api/invitations/verify' && requestMethod === 'GET') {
    const token = safeText(getUrlObj(req)?.searchParams?.get('token'));
    if (!token) return sendErr(res, 400, 'Token is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await getInvitationByToken(token);
    if (!result.ok) return sendErr(res, result.status || 400, result.error, { code: 'INVITE_INVALID' }), true;

    const invitation = result.data;
    let projectName = '';
    if (invitation.projectId) {
      const inviterProjects = await listProjectsForUser(invitation.invitedByUserId);
      if (inviterProjects.ok) {
        const project = (inviterProjects.data || []).find((row) => safeText(row?.id) === invitation.projectId);
        projectName = safeText(project?.name);
      }
    }

    // Whether this address already has a login decides which form the visitor
    // is shown: "create your account" is a dead end for someone who already
    // has one. Disclosed only to a holder of a valid token, who was told the
    // address in the invitation email itself.
    const existing = await findUserByEmail(invitation.email);

    // Only what the recipient already knows from the email they received.
    const payload = {
      email: invitation.email,
      projectName,
      expiresAt: invitation.expiresAt,
      hasAccount: Boolean(existing),
    };
    return sendOk(res, 200, payload, payload), true;
  }

  const userId = safeText(req?.authUser?.id);
  if (!userId) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;

  /**
   * Redeem an invitation as somebody who ALREADY has a login.
   *
   * Registration redeems the token for a brand-new account; before this
   * existed, inviting an address that was already registered produced an
   * invitation that could never be accepted — the link only ever reached the
   * sign-up form, which then refused the duplicate address, and for a signed-in
   * user it did nothing at all.
   */
  if (normalizedPath === '/api/invitations/accept' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const token = safeText(body?.token);
    if (!token) return sendErr(res, 400, 'Token is required', { code: 'VALIDATION_ERROR' }), true;

    const lookup = await getInvitationByToken(token);
    if (!lookup.ok) return sendErr(res, lookup.status || 400, lookup.error, { code: 'INVITE_INVALID' }), true;
    const invitation = lookup.data;

    // Same rule as registration: the invitation names a mailbox, and only its
    // owner may spend it. Otherwise a forwarded link would let any signed-in
    // user join a project they were never invited to.
    const signedInEmail = safeText(req?.authUser?.email).toLowerCase();
    if (invitation.email !== signedInEmail) {
      return sendErr(
        res,
        403,
        `This invitation was sent to ${invitation.email}, but you are signed in as ${signedInEmail}. Sign out and sign in as ${invitation.email}.`,
        { code: 'INVITE_EMAIL_MISMATCH' }
      ), true;
    }

    const redeemed = await acceptInvitation(invitation.id, userId);
    if (!redeemed.ok) return sendErr(res, redeemed.status || 409, redeemed.error, { code: 'INVITE_ALREADY_USED' }), true;

    let projectName = '';
    if (invitation.projectId) {
      const granted = await addMemberToProject(invitation.projectId, userId, invitation.projectRole || 'member');
      if (!granted?.ok) {
        console.error(
          `[invitations] ${invitation.id} accepted but membership of ${invitation.projectId} was not granted:`,
          granted?.error || 'unknown error'
        );
        return sendErr(res, 500, 'Joined, but the workspace could not be added. Ask your administrator.', { code: 'MEMBERSHIP_FAILED' }), true;
      }

      // Drop them straight into the workspace they were invited to, rather
      // than leaving them wherever they happened to be.
      const sessionToken = safeText(req?.authSession?.token);
      if (sessionToken) {
        await setActiveProjectForSession(userId, invitation.projectId, sessionToken).catch(() => {});
      }

      const mine = await listProjectsForUser(userId);
      if (mine.ok) {
        const project = (mine.data || []).find((row) => safeText(row?.id) === invitation.projectId);
        projectName = safeText(project?.name);
      }
    }

    const payload = { projectId: invitation.projectId, projectName };
    return sendOk(res, 200, payload, payload), true;
  }

  // A user who landed with no workspace asks the person who invited them.
  if (normalizedPath === '/api/invitations/request-access' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const note = safeText(body?.note).slice(0, 1000);

    const mine = await listInvitations({ status: 'accepted' });
    if (!mine.ok) return sendErr(res, mine.status || 500, mine.error), true;
    const accepted = (mine.data || []).find((row) => safeText(row.acceptedUserId) === userId) || null;

    const inviterId = safeText(accepted?.invitedByUserId);
    const inviterResult = inviterId ? await getUserById(inviterId) : null;
    const inviterEmail = inviterResult?.ok ? safeText(inviterResult.data?.email) : '';
    if (!inviterEmail) {
      return sendErr(
        res,
        409,
        'We could not work out who invited you. Contact your StarCaster administrator directly.',
        { code: 'NO_INVITER' }
      ), true;
    }

    const sent = await sendAccessRequestEmail({
      req,
      toEmails: [inviterEmail],
      requesterName: safeText(req?.authUser?.name),
      requesterEmail: safeText(req?.authUser?.email),
      note,
    });
    if (!sent.ok) return sendErr(res, sent.status || 500, sent.error || 'Could not send the request', { code: 'EMAIL_FAILED' }), true;

    return sendOk(res, 200, { notified: inviterEmail }, { notified: inviterEmail }), true;
  }

  if (normalizedPath === '/api/invitations' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const email = safeText(body?.email).toLowerCase();
    const role = safeText(body?.projectRole || body?.role) || 'member';

    if (!email || !email.includes('@')) {
      return sendErr(res, 400, 'A valid email address is required', { code: 'VALIDATION_ERROR' }), true;
    }

    const target = await resolveInviteTarget(req, body?.projectId || body?.project_id);
    if (!target.ok) return sendErr(res, target.status || 403, target.error, { code: target.code || 'FORBIDDEN' }), true;

    const created = await createInvitation({
      email,
      projectId: target.projectId,
      projectRole: role,
      invitedByUserId: userId,
    });
    if (!created.ok) return sendErr(res, created.status || 500, created.error, { code: 'INVITE_FAILED' }), true;

    const { invitation, rawToken } = created.data;
    // Someone who already has a login gets "join this workspace", not "create
    // your account" — the latter points them at a form that would refuse them.
    const alreadyRegistered = Boolean(await findUserByEmail(email));
    const sent = await sendInviteEmail({
      req,
      toEmail: email,
      rawToken,
      inviterName: safeText(req?.authUser?.name) || safeText(req?.authUser?.email),
      projectName: target.projectName,
      hasAccount: alreadyRegistered,
    });

    // The invitation is real whether or not the mail server cooperated. Say so
    // plainly rather than reporting a clean success the operator would trust:
    // an unsent invite that looks sent is a person who never hears from you.
    //
    // The link comes back too, and only here — to the authenticated person who
    // just created it, never from the GET list. It is the manual fallback when
    // email fails, and the "copy invite link" people reach for anyway. Without
    // it a failed send leaves an invitation nobody on earth can redeem.
    const payload = {
      invitation,
      signupUrl: buildSignupUrl(getAppPublicOrigin(req), rawToken),
      emailSent: sent.ok,
      emailError: sent.ok ? '' : safeText(sent.error),
      hasAccount: alreadyRegistered,
    };
    return sendOk(res, 201, payload, payload), true;
  }

  if (normalizedPath === '/api/invitations' && requestMethod === 'GET') {
    // The platform owner sees every invitation; everyone else sees only the
    // ones they sent, so one project owner cannot enumerate another's people.
    const result = isPlatformOwner(req)
      ? await listInvitations({})
      : await listInvitations({ invitedByUserId: userId });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const invitations = result.data || [];
    return sendOk(res, 200, invitations, { invitations }, { total: invitations.length }), true;
  }

  const revokeMatch = normalizedPath.match(/^\/api\/invitations\/([^/]+)\/revoke\/?$/);
  if (revokeMatch && requestMethod === 'POST') {
    const invitationId = decodeURIComponent(revokeMatch[1] || '').trim();
    const existing = await getInvitationById(invitationId);
    if (!existing.ok) return sendErr(res, existing.status || 404, existing.error, { code: 'NOT_FOUND' }), true;

    if (!isPlatformOwner(req) && safeText(existing.data.invitedByUserId) !== userId) {
      return sendErr(res, 403, 'You can only revoke invitations you sent', { code: 'FORBIDDEN' }), true;
    }

    const result = await revokeInvitation(invitationId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error, { code: 'REVOKE_FAILED' }), true;
    return sendOk(res, 200, { invitation: result.data }, { invitation: result.data }), true;
  }

  return false;
}

const manifest = {
  id: 'invitations',
  label: 'Invitations',
  prefixes: ['/api/invitations'],
};

module.exports = { handle, manifest };
