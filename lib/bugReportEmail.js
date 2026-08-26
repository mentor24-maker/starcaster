'use strict';

/**
 * Bug Report 5/5 — when the module's "Email each report" toggle is on, a
 * stored report ALSO goes to the project's support address, using the same
 * plumbing the Support module uses (lib/mailer.js + the project's Support
 * Email setting). No new mailer, no new template beyond the minimal one here.
 *
 * Three rules carried over from 3/5 (lib/bugReportForward.js), for the same
 * reasons:
 *
 *   1. The row is written FIRST and this runs AFTER. Nothing here can fail
 *      the reporter's request — Resend down, no API key, no support address:
 *      the visitor still gets their thank-you, and the failure is logged
 *      loudly with a greppable prefix (DOCTRINE 3.11 — report what could not
 *      be done, never pretend).
 *   2. It is AWAITED by the route, not fire-and-forget. Vercel freezes the
 *      lambda the moment the response goes out, which silently kills
 *      in-flight work.
 *   3. It never throws.
 *
 * AND ONE RULE OF ITS OWN, which is the whole security design:
 *
 *   4. THE TOGGLE IS READ FROM THE SERVER'S OWN COPY OF THE PAGES, NEVER FROM
 *      THE REQUEST. `/api/public/bug-report` takes no auth — any visitor to
 *      any tenant site can post to it. If the flag travelled in the request
 *      body, anyone could turn a tenant's site into a mail relay pointed at
 *      the owner's inbox, at whatever rate the rate limiter allows. So the
 *      request is not consulted; the project's pages are.
 *
 * The failure asymmetry that follows from 4: if the pages cannot be read, we
 * DO NOT SEND. "Cannot tell" is not "on". A missed alert costs one email the
 * operator can still find in the Loop Queue (3/5 files every report as a task
 * regardless); a wrongly-sent one is mail they did not ask for from a path a
 * stranger triggered. The report itself is never at risk either way — it was
 * saved before this ran.
 */

const { sendEmail: defaultSendEmail } = require('./mailer');
const { listPages: defaultListPages } = require('./builderPagesStore');
const { resolveSupportDeliveryEmail: defaultResolveSupportEmail } = require('./projectSiteSettingsStore');
const { getPublicProjectById: defaultGetProject } = require('./projectsStore');
const { resolveScreenshotUrls: defaultResolveScreenshotUrls } = require('./bugReportForward');

const LOG_PREFIX = '[bug-report email FAILED]';

/** The module setting added by this task; "true"/"false" strings, as all builder settings are. */
const SETTING_KEY = 'emailReports';
const MODULE_TYPE = 'bug-report';

/** Page scan ceiling. listPages takes the LIMIT FIRST (CLAUDE.md landmine 12). */
const PAGE_SCAN_LIMIT = 5000;

function isOn(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
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
 * The page URL is whatever the visitor's browser reported — untrusted text.
 * It is shown either way, but only ever LINKED when it is plainly http(s),
 * so a crafted `javascript:` or `data:` value cannot become a live link in
 * the operator's mail client.
 */
function safeLink(value) {
  const url = String(value ?? '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function firstLine(text, max) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * Does ANY bug-report module on these pages ask for email?
 *
 * Project-wide on purpose. The module is a floating site-wide trigger — one
 * icon in a corner, normally placed on a shared section — so "this project
 * wants bug reports emailed" is the question the setting actually answers.
 * Matching the report back to the exact page would mean trusting the
 * visitor-supplied page URL to pick a page, which is rule 4 again by another
 * route.
 *
 * Pure, so the scan is testable without a database.
 */
function pagesAskForEmail(pages) {
  for (const page of Array.isArray(pages) ? pages : []) {
    const sections = Array.isArray(page?.layoutSections)
      ? page.layoutSections
      : Array.isArray(page?.layoutSections?.sections)
        ? page.layoutSections.sections
        : [];
    for (const section of sections) {
      const modules = Array.isArray(section?.modules) ? section.modules : [];
      for (const module of modules) {
        if (module?.type === MODULE_TYPE && isOn(module?.settings?.[SETTING_KEY])) return true;
      }
    }
  }
  return false;
}

/**
 * Ask the project's own pages whether email is wanted.
 *
 * @returns {Promise<{ wanted: boolean, ok: boolean, error?: string }>}
 *   `ok: false` means the question could not be answered — the caller must
 *   treat that as "do not send" and say so in the log, never as "off".
 */
async function projectWantsBugReportEmail(scope, deps = {}) {
  const listPages = deps.listPages || defaultListPages;
  try {
    const result = await listPages(PAGE_SCAN_LIMIT, scope);
    if (!result?.ok) {
      return { wanted: false, ok: false, error: result?.error || 'the project pages could not be read' };
    }
    return { wanted: pagesAskForEmail(result.data), ok: true };
  } catch (e) {
    return { wanted: false, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The minimal plain email for one report. Pure, so its shape is testable
 * without Resend.
 */
function composeBugReportEmail(report, { project = null, screenshotUrls = [] } = {}) {
  const siteName = String(project?.name || '').trim() || String(report?.projectId || 'your site');
  const summary = firstLine(report?.description, 80) || '(no description)';
  const pageUrl = String(report?.pageUrl || '').trim();
  const pageLink = safeLink(pageUrl);

  const textLines = [
    `Site:      ${siteName}`,
    `Page:      ${pageUrl || '(not recorded)'}`,
    `Viewer:    ${report?.viewerTier || 'public'}`,
    `Submitted: ${report?.createdAt || '(unknown)'}`,
    `Report id: ${report?.id || '(unknown)'}`,
    '',
    String(report?.description || '(no description given)'),
  ];
  if (screenshotUrls.length) {
    textLines.push('', 'Screenshots:', ...screenshotUrls.map((url, i) => `  ${i + 1}. ${url}`));
  } else {
    textLines.push('', 'Screenshots: (none attached)');
  }

  const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #18324a;">
          <h2 style="margin: 0 0 4px;">Bug report on ${escapeHtml(siteName)}</h2>
          <p style="margin: 0 0 16px; color: #587592; font-size: 13px;">
            ${pageLink
              ? `<a href="${escapeHtml(pageLink)}">${escapeHtml(pageUrl)}</a>`
              : escapeHtml(pageUrl || '(page not recorded)')}
            &middot; ${escapeHtml(report?.viewerTier || 'public')} visitor
          </p>
          <div style="padding: 16px; background: #f3f6f9; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(report?.description || '(no description given)')}</div>
          ${screenshotUrls.length
            ? `<p style="margin: 16px 0 0;">${screenshotUrls
                .map((url, i) => `<a href="${escapeHtml(url)}">Screenshot ${i + 1}</a>`)
                .join(' &middot; ')}</p>`
            : ''}
          <p style="margin: 16px 0 0; color: #587592; font-size: 12px;">Report id ${escapeHtml(report?.id || '(unknown)')}</p>
        </div>
      `;

  return {
    subject: `[Bug report] ${siteName}: ${summary}`,
    fromName: `${siteName} Bug Reports`,
    text: textLines.join('\n'),
    html,
  };
}

/**
 * Email one freshly-stored report, if the project asked for it. Never throws.
 *
 * @returns {Promise<{ sent: boolean, reason: string }>} `reason` is '' on a
 *   send, 'not_enabled' when the toggle is off, and otherwise names what went
 *   wrong. Every non-send that is not simply "off" is also logged.
 */
async function emailBugReport(report, scope, deps = {}) {
  const log = deps.log || console.error;
  const sendEmail = deps.sendEmail || defaultSendEmail;
  const resolveSupportEmail = deps.resolveSupportDeliveryEmail || defaultResolveSupportEmail;
  const getProject = deps.getPublicProjectById || defaultGetProject;
  const resolveScreenshotUrls = deps.resolveScreenshotUrls || defaultResolveScreenshotUrls;

  const reportId = String(report?.id || '');
  const projectId = String(scope?.projectId || report?.projectId || '');

  function fail(reason, code) {
    log(`${LOG_PREFIX} report ${reportId} (project ${projectId}): ${reason}`);
    return { sent: false, reason: code };
  }

  try {
    const wants = await projectWantsBugReportEmail(scope, deps);
    if (!wants.ok) {
      // Rule 4's asymmetry: unreadable is NOT off. Say so out loud.
      return fail(
        `could not tell whether "Email each report" is on (${wants.error}) — no email sent. The report itself is saved; check the Loop Queue task.`,
        'setting_unreadable'
      );
    }
    if (!wants.wanted) return { sent: false, reason: 'not_enabled' };

    const to = await resolveSupportEmail(projectId);
    if (!to) {
      return fail(
        '"Email each report" is on but this project has no Support Email set — set one in Site Settings, or turn the toggle off.',
        'no_address'
      );
    }

    let project = null;
    try {
      const loaded = await getProject(projectId);
      if (loaded?.ok) project = loaded.data;
    } catch { /* the id alone is enough for the body */ }

    let screenshotUrls = [];
    try {
      screenshotUrls = await resolveScreenshotUrls(report, scope);
    } catch { /* a missing screenshot must not block the email */ }

    const mail = await sendEmail({ to, ...composeBugReportEmail(report, { project, screenshotUrls }) });
    if (!mail?.ok) return fail(`the email did not send: ${mail?.error || 'unknown error'}`, 'send_failed');

    return { sent: true, reason: '' };
  } catch (e) {
    return fail(`unexpected error: ${e instanceof Error ? e.message : String(e)}`, 'threw');
  }
}

module.exports = {
  LOG_PREFIX,
  SETTING_KEY,
  pagesAskForEmail,
  projectWantsBugReportEmail,
  composeBugReportEmail,
  emailBugReport,
};
