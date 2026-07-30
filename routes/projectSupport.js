'use strict';

/**
 * Support requests from a tenant's own admin area (/admin-support).
 *
 * AUTH: no exemption is registered in routes/index.js for /api/support, so
 * every route here requires a session. `/api/support` is also absent from
 * PROJECT_ADMIN_SESSION_DENY_PREFIXES in lib/projectAdminApiAuth.js, which is
 * what lets a tenant admin (app_admin_session on their custom domain) reach it
 * without a platform login. That path also sets req.projectContext from the
 * session row, so a tenant admin is pinned to their own project and the
 * x-project-id header cannot redirect them at someone else's site.
 */

const { parseJsonBody, sendOk, sendErr, getUrlObj } = require('./http');
const {
  createSupportRequest,
  listSupportRequests,
  MAX_TITLE_CHARS,
} = require('../lib/projectSupportRequestsStore');
const { resolveSupportAlertEmail } = require('../lib/projectSiteSettingsStore');
const { uploadAssetFile, isConfigured: isAssetStorageConfigured } = require('../lib/assetStorage');
const { getPublicProjectById } = require('../lib/projectsStore');
const { sendEmail } = require('../lib/mailer');
const { checkEndpointLimit } = require('../lib/rateLimiter');

/** Matches routes/assets.js, so a screenshot that uploads there uploads here. */
const MAX_UPLOAD_BASE64_CHARS = 9_000_000;
const SCREENSHOT_CATEGORY = 'Support Requests';

const PRIORITY_LABELS = Object.freeze({
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Which project this call acts on.
 *
 * A project-admin session always wins — routes/index.js derives
 * projectContext from their session row, so they can only ever act on their
 * own project. The header/query fallbacks exist for platform users, whose
 * requests may arrive without a projectContext.
 */
function resolveProjectId(req) {
  if (req.authUser?.isProjectAdmin) {
    return String(req.projectContext?.project?.id || '').trim();
  }
  return String(
    req.projectContext?.project?.id
    || req.headers['x-project-id']
    || getUrlObj(req).searchParams?.get('projectId')
    || ''
  ).trim();
}

/**
 * Put a screenshot in blob storage and return its public URL.
 *
 * Deliberately does not create an `assets` row: the tenant's Assets library is
 * their own media, and support screenshots would only clutter it.
 *
 * Never throws. A screenshot that fails to upload must not lose the written
 * report attached to it, so the caller files the request anyway and surfaces
 * the problem in the response.
 */
async function uploadScreenshot(screenshot) {
  const fileName = String(screenshot?.fileName || '').trim();
  const fileBase64 = String(screenshot?.fileBase64 || '').trim();
  const mimeType = String(screenshot?.mimeType || '').trim().toLowerCase();

  if (!fileName || !fileBase64) return { ok: false, error: 'Screenshot is missing its file name or contents.' };
  if (!mimeType.startsWith('image/')) return { ok: false, error: 'Screenshots must be an image file.' };
  if (fileBase64.length > MAX_UPLOAD_BASE64_CHARS) {
    return { ok: false, error: 'That screenshot is too large. Please use an image under about 6MB.' };
  }
  if (!isAssetStorageConfigured()) {
    return { ok: false, error: 'Image storage is not configured, so the screenshot could not be saved.' };
  }

  try {
    const upload = await uploadAssetFile({
      assetType: 'Image',
      category: SCREENSHOT_CATEGORY,
      fileName,
      mimeType,
      fileBase64,
      makePublic: true,
    });
    if (!upload.ok) return { ok: false, error: upload.error || 'The screenshot could not be uploaded.' };
    return { ok: true, url: String(upload.data?.location || '').trim(), name: fileName };
  } catch (err) {
    return { ok: false, error: err?.message || 'The screenshot could not be uploaded.' };
  }
}

/**
 * Email the support address. Awaited by the caller rather than
 * fire-and-forget: on Vercel the lambda freezes the moment the response is
 * sent, which silently kills in-flight work.
 *
 * Never fails the submission — the request row is already saved, so a mail
 * problem must not show the admin an error. Returns whether mail went out so
 * the response can say so honestly.
 */
async function notifySupportAlertEmail({ projectId, request }) {
  try {
    const to = await resolveSupportAlertEmail(projectId);
    if (!to) return { sent: false, reason: 'no_address' };

    const projectResult = await getPublicProjectById(projectId);
    const siteName = String(projectResult?.data?.name || '').trim() || projectId;
    const priorityLabel = PRIORITY_LABELS[request.priority] || request.priority;
    const from = String(request.adminEmail || '').trim();

    const lines = [
      `Site:     ${siteName}`,
      `From:     ${from || '(unknown admin)'}`,
      `Priority: ${priorityLabel}`,
      '',
      request.description || '(no description given)',
    ];
    if (request.screenshotUrl) lines.push('', `Screenshot: ${request.screenshotUrl}`);

    const mail = await sendEmail({
      to,
      fromName: `${siteName} Support`,
      // Lets you hit Reply and reach the admin who filed it.
      replyTo: from || undefined,
      subject: `[${priorityLabel}] ${siteName}: ${request.title}`,
      text: lines.join('\n'),
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #18324a;">
          <h2 style="margin: 0 0 4px;">${escapeHtml(request.title)}</h2>
          <p style="margin: 0 0 16px; color: #587592; font-size: 13px;">
            ${escapeHtml(siteName)} &middot; ${escapeHtml(priorityLabel)} priority
            &middot; from ${escapeHtml(from || 'an unknown admin')}
          </p>
          <div style="padding: 16px; background: #f3f6f9; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(request.description || '(no description given)')}</div>
          ${request.screenshotUrl
            ? `<p style="margin: 16px 0 0;"><a href="${escapeHtml(request.screenshotUrl)}">View the attached screenshot</a></p>`
            : ''}
        </div>
      `,
    });

    return { sent: Boolean(mail.ok), reason: mail.ok ? '' : (mail.error || 'send_failed') };
  } catch (err) {
    return { sent: false, reason: err?.message || 'send_failed' };
  }
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith('/api/support')) return false;

  // POST /api/support/requests — file a new support request
  if (pathname === '/api/support/requests' && method === 'POST') {
    if (!req.authUser) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;
    if (checkEndpointLimit(req, res, 'admin.supportRequest')) return true;

    const projectId = resolveProjectId(req);
    if (!projectId) return sendErr(res, 400, 'Project ID is required', { code: 'PROJECT_REQUIRED' }), true;

    const body = await parseJsonBody(req);
    const title = String(body.title || '').trim();
    if (!title) {
      return sendErr(res, 400, 'Please give the issue a short title', { code: 'VALIDATION_ERROR' }), true;
    }
    if (title.length > MAX_TITLE_CHARS) {
      return sendErr(res, 400, `Issue title must be ${MAX_TITLE_CHARS} characters or fewer`, { code: 'VALIDATION_ERROR' }), true;
    }

    // The screenshot is optional, and a failed upload must not cost the admin
    // their written report — file the request either way and report the
    // upload problem alongside the success.
    let screenshotUrl = '';
    let screenshotName = '';
    let screenshotWarning = '';
    if (body.screenshot && typeof body.screenshot === 'object') {
      const uploaded = await uploadScreenshot(body.screenshot);
      if (uploaded.ok) {
        screenshotUrl = uploaded.url;
        screenshotName = uploaded.name;
      } else {
        screenshotWarning = uploaded.error;
      }
    }

    const created = await createSupportRequest({
      priority: body.priority,
      title,
      description: body.description,
      screenshotUrl,
      screenshotName,
    }, {
      projectId,
      adminUserId: req.authUser.id,
      adminEmail: req.authUser.email,
    });
    if (!created.ok) {
      return sendErr(res, created.status || 500, created.error || 'Failed to save the support request'), true;
    }

    const notified = await notifySupportAlertEmail({ projectId, request: created.data });

    const payload = {
      supportRequest: created.data,
      emailSent: notified.sent,
      ...(screenshotWarning ? { screenshotWarning } : {}),
    };
    return sendOk(res, 201, payload, payload), true;
  }

  // GET /api/support/requests — this project's own requests, newest first
  if (pathname === '/api/support/requests' && method === 'GET') {
    if (!req.authUser) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;

    const projectId = resolveProjectId(req);
    if (!projectId) return sendErr(res, 400, 'Project ID is required', { code: 'PROJECT_REQUIRED' }), true;

    const limit = getUrlObj(req).searchParams?.get('limit');
    const result = await listSupportRequests(projectId, { limit });
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error || 'Failed to read support requests'), true;
    }
    return sendOk(res, 200, result.data, { supportRequests: result.data }, { total: result.data.length }), true;
  }

  return false;
}

module.exports = {
  handle,
  manifest: {
    id: 'projectSupport',
    label: 'Tenant Support Requests',
    prefixes: ['/api/support'],
  },
  PRIORITY_LABELS,
};
