'use strict';

/**
 * Bug Report 3/5 — every stored report also becomes a ClickUp task, HELD for
 * the operator in "Needs your input" (lib/clickupForward.js asserts that).
 *
 * Ordering is the whole design: the row is written FIRST, this runs AFTER,
 * and nothing here can fail the reporter's request. ClickUp down, token
 * missing, token wrong — the row is marked `failed_forward`, the failure is
 * logged loudly with a greppable prefix, and the visitor still gets their
 * thank-you. The row is the record; the task is a convenience that points at
 * it (DOCTRINE 3.11: report what could not be done, never pretend).
 */

const { createHeldTask, createSyntheticReportTask, isConfigured: isClickupConfigured } = require('./clickupForward');
const { classifyReportOrigin } = require('./bugReportOrigin');
const { getPublicProjectById } = require('./projectsStore');
const { getAssetById, rowToAsset } = require('./assetsStore');
const { setBugReportForwardStatus } = require('./projectBugReportsStore');

const LOG_PREFIX = '[bug-report forward FAILED]';
const NAME_MAX = 90;

function tagSafe(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Public text goes inside a fence so it cannot format, link, or @-mention. */
function fenced(text) {
  const clean = String(text || '').replace(/```/g, "'''").trim();
  return '```\n' + (clean || '(empty)') + '\n```';
}

function firstLine(text, max) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * The task name and markdown body for one report. Pure, so the shape is
 * testable without ClickUp.
 */
function composeBugReportTask(report, { project = null, screenshotUrls = [] } = {}) {
  const projectLabel = project?.name ? `${project.name} (${project.id})` : String(report.projectId || '(unknown project)');
  const name = `Bug report: ${firstLine(report.description, NAME_MAX) || '(no description)'} — ${project?.name || report.projectId || 'unknown site'}`;

  const lines = [
    '## What the reporter said',
    '',
    fenced(report.description),
    '',
    '## Where and who',
    '',
    `- **Page:** ${report.pageUrl ? report.pageUrl : '(not recorded)'}`,
    `- **Project:** ${projectLabel}`,
    `- **Viewer tier:** ${report.viewerTier || 'public'}`,
    `- **Browser:** ${report.userAgent ? `\`${String(report.userAgent).replace(/`/g, "'").slice(0, 300)}\`` : '(not recorded)'}`,
    `- **Submitted:** ${report.createdAt || '(unknown)'}`,
    `- **Report id:** \`${report.id}\``,
    '',
    '## Screenshots',
    '',
    ...(screenshotUrls.length
      ? screenshotUrls.map((url, i) => `- [Screenshot ${i + 1}](${url})`)
      : ['(none attached)']),
    '',
    '---',
    '_Filed automatically from a public bug report. Held for the operator: nothing in the build loops will touch this until you move it._',
  ];

  const projectTag = tagSafe(project?.slug || project?.id || report.projectId);
  const tags = ['bug-report', ...(projectTag ? [projectTag] : [])];
  return { name, markdownDescription: lines.join('\n'), tags };
}

async function resolveScreenshotUrls(report, scope) {
  const urls = [];
  for (const id of Array.isArray(report.screenshotAssetIds) ? report.screenshotAssetIds : []) {
    try {
      const found = await getAssetById(id, scope);
      if (found.ok) {
        const asset = rowToAsset(found.data);
        if (asset?.location) urls.push(asset.location);
      }
    } catch {
      // A missing screenshot must not block the forward; the body says how many landed.
    }
  }
  return urls;
}

/**
 * Forward one freshly-stored report. Never throws. Returns what happened so
 * the caller can include it in logs; the row's status is updated here.
 */
async function forwardBugReport(report, scope, deps = {}) {
  const log = deps.log || console.error;
  const reportId = String(report?.id || '');
  const projectId = String(scope?.projectId || report?.projectId || '');

  async function fail(reason, code) {
    const marked = await setBugReportForwardStatus(reportId, 'failed_forward', scope).catch(() => ({ ok: false }));
    log(`${LOG_PREFIX} report ${reportId} (project ${projectId}): ${reason}` +
      (marked?.ok ? ' — row marked failed_forward.' : ' — AND the row could not be marked failed_forward.'));
    return { ok: false, code, error: reason, markedFailed: Boolean(marked?.ok) };
  }

  try {
    if (!isClickupConfigured(deps)) {
      return await fail(
        'CLICKUP_API_TOKEN is not set on this server. Add it in Doppler/Vercel AND redeploy — an env edit does not reach the running deployment (CLAUDE.md landmine 10).',
        'CLICKUP_NOT_CONFIGURED'
      );
    }

    let project = null;
    try {
      const loaded = await getPublicProjectById(projectId);
      if (loaded.ok) project = loaded.data;
    } catch { /* the id alone is enough for the body */ }

    const screenshotUrls = await resolveScreenshotUrls(report, scope);
    const task = composeBugReportTask(report, { project, screenshotUrls });

    // Did our own machinery file this? The report is stored and forwarded
    // either way — the harness POSTing here IS the proof the live path works
    // — but a report no person wrote does not go into the operator's lane
    // (task 86bbk0tvk). The classifier is deliberately reluctant: losing a
    // real customer's report costs far more than one interruption.
    const origin = deps.classifyReportOrigin
      ? deps.classifyReportOrigin({ pageUrl: report.pageUrl, userAgent: report.userAgent, projectName: project?.name })
      : classifyReportOrigin({ pageUrl: report.pageUrl, userAgent: report.userAgent, projectName: project?.name });

    const created = origin.synthetic
      ? await (deps.createSyntheticReportTask || createSyntheticReportTask)({
          ...task,
          markdownDescription: `${task.markdownDescription}\n\n---\n_Filed closed and unassigned: ${origin.why}. If this was a real person, that classification is the bug — see lib/bugReportOrigin.js._`,
        }, deps)
      : await (deps.createHeldTask || createHeldTask)(task, deps);
    if (!created.ok) {
      // When create succeeded but a later step failed, createHeldTask returns
      // the task id/url — a task may exist in the queue. Carry it into the log
      // so an orphan is findable, never silent.
      const orphan = created.taskId ? ` (task ${created.taskId}${created.url ? ` ${created.url}` : ''} may exist — check it)` : '';
      return await fail(`${created.error}${orphan}`, created.code);
    }

    const marked = await setBugReportForwardStatus(reportId, 'forwarded', scope);
    if (!marked.ok) {
      log(`${LOG_PREFIX} report ${reportId}: task ${created.taskId} created (${created.url}) but the row could not be marked forwarded: ${marked.error || 'unknown'}`);
    }
    return { ok: true, taskId: created.taskId, url: created.url, markedForwarded: Boolean(marked.ok) };
  } catch (e) {
    return await fail(`unexpected error: ${e instanceof Error ? e.message : String(e)}`, 'FORWARD_THREW');
  }
}

module.exports = {
  LOG_PREFIX,
  composeBugReportTask,
  forwardBugReport,
  // Shared with lib/bugReportEmail.js so the task body and the email list the
  // same screenshots. Two readers of one shape drift apart.
  resolveScreenshotUrls,
};
