'use strict';

/**
 * Theme Wizard API — Phases 1 and 2.
 *
 * Spec: docs/THEME_WIZARD_SPEC.md. The wizard proposes three complete looks for
 * a site, the operator ranks them, and later rounds build on the winner.
 *
 * The shape of a round: POST /sessions/:id/generate queues a job and returns
 * immediately, then the client calls POST /jobs/:id/advance repeatedly, once
 * per model call, until it reports done. Generation work lives in
 * lib/themeWizardGenerator.js; nothing it returns is trusted until
 * lib/themeWizardValidate.js has checked it.
 *
 * AUTH: staff-only for v1 (spec §2, "agency-only ... build the guardrails now").
 * Requires a platform app_session (centralized in routes/index.js), and
 * '/api/builder/theme-wizard' sits in PROJECT_ADMIN_SESSION_DENY_PREFIXES so
 * tenant project-admin sessions cannot reach it.
 */

const { parseJsonBody, sendOk, sendErr } = require('./http');
const { requestProjectScope } = require('../lib/requestProjectScope');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { listPages, updatePage } = require('../lib/builderPagesStore');
const { createTheme } = require('../lib/builderThemesStore');
const store = require('../lib/themeWizardStore');
const {
  buildStyleBrief,
  buildStyleBriefFromText,
  buildStyleBriefFromUrl,
  buildStyleBriefFromImage,
  describeHeroReference,
  deriveDirections,
  generateCandidate,
  sumUsage,
} = require('../lib/themeWizardGenerator');
const { getAssetById } = require('../lib/assetsStore');
const { validateThemePatch, applyLockedValues } = require('../lib/themeWizardValidate');

const PREFIX = '/api/builder/theme-wizard';

const SEED_TYPES = ['current_pages', 'external_url', 'brand_kit', 'brief'];

function requireProject(req, res) {
  const scope = requestProjectScope(req);
  if (!scope.projectId) {
    sendErr(res, 400, 'An active project is required (x-project-id header)', { code: 'PROJECT_REQUIRED' });
    return null;
  }
  return scope;
}

/**
 * Generation runs one model call per HTTP request.
 *
 * A full round is four calls — read the site, choose three directions, then one
 * candidate each — and Fable 5 is not fast. Doing that inside a single request
 * would blow the serverless ceiling, and the failure mode is the 2026-07-22
 * propagation bug: frozen mid-loop with some of the work done and no record of
 * which (hazard 4.2).
 *
 * So the job carries its own progress and the client advances it one step at a
 * time. Each request is bounded, a crash loses at most one step, and the
 * progress the UI shows is real rather than a spinner with a guessed caption.
 */
const STEP_BRIEF = 'brief';
const STEP_DIRECTIONS = 'directions';
const STEP_CANDIDATES = 'candidates';
const TOTAL_SLOTS = 3;

function describeProgress(input) {
  const step = String(input?.step || STEP_BRIEF);
  const done = Number(input?.completedSlots || 0);
  if (step === STEP_BRIEF) return { step, label: 'Reading the site', current: 0, total: TOTAL_SLOTS + 2 };
  if (step === STEP_DIRECTIONS) return { step, label: 'Choosing three directions', current: 1, total: TOTAL_SLOTS + 2 };
  if (step === STEP_CANDIDATES) {
    return { step, label: `Generating ${Math.min(done + 1, TOTAL_SLOTS)} of ${TOTAL_SLOTS}`, current: 2 + done, total: TOTAL_SLOTS + 2 };
  }
  return { step: 'done', label: 'Finished', current: TOTAL_SLOTS + 2, total: TOTAL_SLOTS + 2 };
}

/** Queue a round. Does no model work — the client then drives /advance. */
async function handleGenerate(req, res, sessionId, scope) {
  if (checkEndpointLimit(req, res, 'themeWizard.generate')) return true;

  const sessionResult = await store.getSession(sessionId, scope);
  if (!sessionResult.ok) return sendErr(res, sessionResult.status || 404, sessionResult.error || 'Session not found'), true;
  const session = sessionResult.data;

  const body = await parseJsonBody(req);
  const round = session.roundCount + 1;
  const parentCandidateId = String(body?.parentCandidateId || '').trim();

  if (round > 1 && !parentCandidateId) {
    return sendErr(res, 400, 'Round 2 and later build on the winner — pick a favourite first', { code: 'PARENT_REQUIRED' }), true;
  }

  const jobResult = await store.createJob({
    sessionId,
    projectId: scope.projectId,
    ownerUserId: scope.userId,
    type: 'generate_round',
    status: 'queued',
    input: {
      round,
      parentCandidateId,
      feedback: String(body?.feedback || '').slice(0, 4000),
      // Skip straight to directions when the brief already exists — it is a
      // property of the site, not of the round.
      step: session.styleBrief && Object.keys(session.styleBrief).length ? STEP_DIRECTIONS : STEP_BRIEF,
      directions: null,
      completedSlots: 0,
      warnings: [],
    },
  }, scope);
  if (!jobResult.ok) return sendErr(res, jobResult.status || 500, jobResult.error || 'Could not queue generation'), true;

  return sendOk(res, 202, {
    job: jobResult.data,
    round,
    progress: describeProgress(jobResult.data.input),
  }), true;
}

/**
 * Advance a queued job by exactly one step. Idempotent per step in the sense
 * that a failed step leaves the job on that step, so retrying repeats only the
 * work that did not land.
 */
async function handleAdvance(req, res, jobId, scope) {
  if (checkEndpointLimit(req, res, 'themeWizard.generate')) return true;

  const jobResult = await store.getJob(jobId, scope);
  if (!jobResult.ok) return sendErr(res, jobResult.status || 404, jobResult.error || 'Job not found'), true;
  const job = jobResult.data;

  if (job.status === 'succeeded') {
    return sendOk(res, 200, { job, progress: describeProgress({ step: 'done' }), done: true }), true;
  }
  if (job.status === 'failed') {
    return sendErr(res, 409, job.error || 'This round already failed; start a new one', { code: 'JOB_FAILED' }), true;
  }

  const sessionResult = await store.getSession(job.sessionId, scope);
  if (!sessionResult.ok) return sendErr(res, sessionResult.status || 404, sessionResult.error || 'Session not found'), true;
  const session = sessionResult.data;

  const input = { ...(job.input || {}) };
  const fail = async (message, status = 502) => {
    await store.updateJob(jobId, { status: 'failed', error: message, finishedAt: new Date().toISOString() }, scope);
    return sendErr(res, status, message, { code: 'GENERATION_FAILED' }), true;
  };

  if (job.status === 'queued') {
    await store.updateJob(jobId, { status: 'running', startedAt: new Date().toISOString() }, scope);
  }

  // ── Step 1: read the site into a style brief ──────────────────────────────
  if (input.step === STEP_BRIEF) {
    const seed = session.seedPayload || {};
    let brief;

    // One adapter per seed type (spec §5). Each produces the same style-brief
    // shape, so everything downstream is identical regardless of where the look
    // was derived from.
    if (session.seedType === 'brief') {
      brief = await buildStyleBriefFromText({ text: seed.text }, undefined);
    } else if (session.seedType === 'external_url') {
      brief = await buildStyleBriefFromUrl({ url: seed.url }, undefined);
    } else if (session.seedType === 'brand_kit') {
      const asset = await getAssetById(seed.assetId, scope);
      if (!asset.ok) return fail('That logo could not be found in Assets', 404);
      const imageUrl = asset.data?.location || '';
      if (!imageUrl) return fail('That asset has no image file behind it', 400);
      brief = await buildStyleBriefFromImage({ imageUrl, note: seed.note }, undefined);
    } else {
      const pagesResult = await listPages(50, scope);
      const pages = pagesResult.ok && Array.isArray(pagesResult.data) ? pagesResult.data : [];
      if (!pages.length) return fail('This project has no pages to read a style from', 400);
      brief = await buildStyleBrief({ pages, projectName: scope.project?.name }, undefined);
    }

    if (!brief.ok) return fail(brief.error || 'Could not read the style', brief.status);

    // Hero banner context (any seed type can carry it): the operator's own
    // description of the banner area, plus — when they pasted a reference
    // URL — a read of that site's actual hero treatment. Both feed every
    // candidate alongside the brief. A failed reference read degrades to a
    // warning: the banner note is enhancement, the brief is the substance.
    let heroUsage = null;
    const heroParts = [];
    if (String(seed.heroNote || '').trim()) heroParts.push(String(seed.heroNote).trim().slice(0, 2000));
    if (String(seed.heroReferenceUrl || '').trim()) {
      const reference = await describeHeroReference({ url: seed.heroReferenceUrl });
      if (reference.ok && String(reference.text || '').trim()) {
        heroParts.push(`The reference site's hero treatment: ${reference.text.trim().slice(0, 3000)}`);
        heroUsage = reference.usage;
      } else if (!reference.ok) {
        input.warnings = [...(input.warnings || []),
          `The reference site could not be read (${reference.error || 'unknown error'}); continuing without it`];
      }
    }
    const briefData = heroParts.length
      ? { ...brief.data, heroBanner: heroParts.join('\n\n') }
      : brief.data;

    await store.updateSession(job.sessionId, {
      styleBrief: briefData,
      // Recorded from day one so the cost throttle that is deliberately
      // deferred (spec §9) has real history to work from whenever it is built.
      tokensSpent: session.tokensSpent + sumUsage(brief.usage),
    }, scope);
    input.step = STEP_DIRECTIONS;
    const updated = await store.updateJob(jobId, { input }, scope);
    return sendOk(res, 200, { job: updated.ok ? updated.data : job, progress: describeProgress(input) }), true;
  }

  // ── Step 2: choose three directions that actually differ ──────────────────
  if (input.step === STEP_DIRECTIONS) {
    const priorResult = await store.listCandidates(job.sessionId, scope);
    const priorDirections = priorResult.ok ? priorResult.data.map((c) => c.direction).filter(Boolean) : [];

    const chosen = await deriveDirections({
      styleBrief: session.styleBrief,
      priorDirections,
      feedback: input.feedback || '',
    }, undefined);
    if (!chosen.ok) return fail(chosen.error || 'Could not choose directions', chosen.status);

    const directions = Array.isArray(chosen.data?.directions) ? chosen.data.directions : [];
    if (directions.length !== TOTAL_SLOTS) {
      return fail(`Expected ${TOTAL_SLOTS} directions, got ${directions.length}`);
    }

    await store.updateSession(job.sessionId, {
      tokensSpent: session.tokensSpent + sumUsage(chosen.usage),
    }, scope);
    input.directions = directions;
    input.step = STEP_CANDIDATES;
    const updated = await store.updateJob(jobId, { input }, scope);
    return sendOk(res, 200, { job: updated.ok ? updated.data : job, progress: describeProgress(input), directions }), true;
  }

  // ── Step 3: one candidate per call, against its own committed direction ───
  if (input.step === STEP_CANDIDATES) {
    const slotIndex = Number(input.completedSlots || 0);
    const direction = (input.directions || [])[slotIndex];
    if (!direction) return fail('The round lost its directions; start a new one');

    let parentPatch = null;
    if (input.parentCandidateId) {
      const parent = await store.getCandidate(input.parentCandidateId, scope);
      if (parent.ok) parentPatch = parent.data.themePatch;
    }

    // Hero banners: slot i keys on banner i (wrapping when fewer than three
    // were chosen), so the three looks are grounded in three different
    // photographs rather than three guesses.
    const heroUrls = Array.isArray(session.seedPayload?.heroBannerUrls)
      ? session.seedPayload.heroBannerUrls.filter((u) => typeof u === 'string' && u.trim())
      : [];
    const heroUrl = heroUrls.length ? heroUrls[slotIndex % heroUrls.length] : '';
    const heroNote = String(session.styleBrief?.heroBanner || '');

    const generated = await generateCandidate({
      styleBrief: session.styleBrief,
      direction,
      lockedValues: session.lockedValues || {},
      parentPatch,
      feedback: input.feedback || '',
      heroImage: heroUrl ? { url: heroUrl, note: heroNote } : null,
    }, undefined);
    if (!generated.ok) return fail(generated.error || 'Could not generate this option', generated.status);

    // §6.5 — nothing the model returned is trusted until it validates.
    const { rationale, ...rawPatch } = generated.data || {};
    const checked = validateThemePatch(rawPatch);
    if (!checked.ok) {
      return fail(`Option ${slotIndex + 1} came back malformed and was discarded: ${checked.errors.join('; ')}`);
    }

    // §6.4 — locks are stated in the prompt AND enforced here.
    const { patch, overridden } = applyLockedValues(checked.patch, session.lockedValues || {});

    // Stamped by the server, not returned by the model: the server chose the
    // banner, so the model cannot mis-assign it.
    if (heroUrl) patch.heroBannerUrl = heroUrl;

    const created = await store.createCandidate({
      sessionId: job.sessionId,
      projectId: scope.projectId,
      round: input.round,
      slot: slotIndex + 1,
      direction: String(direction.label || '').slice(0, 500),
      rationale: String(rationale || '').slice(0, 2000),
      themePatch: patch,
      parentCandidateId: input.parentCandidateId || '',
    }, scope);
    if (!created.ok) return fail(created.error || 'Could not save this option', created.status);

    input.completedSlots = slotIndex + 1;
    input.warnings = [...(input.warnings || []), ...checked.warnings];
    if (overridden.length) input.warnings.push(`Locked values re-applied on option ${slotIndex + 1}: ${overridden.join(', ')}`);

    const finished = input.completedSlots >= TOTAL_SLOTS;
    if (finished) input.step = 'done';

    const updated = await store.updateJob(jobId, {
      input,
      status: finished ? 'succeeded' : 'running',
      finishedAt: finished ? new Date().toISOString() : undefined,
    }, scope);
    await store.updateSession(job.sessionId, {
      tokensSpent: session.tokensSpent + sumUsage(generated.usage),
      ...(finished ? { roundCount: input.round } : {}),
    }, scope);

    return sendOk(res, 200, {
      job: updated.ok ? updated.data : job,
      candidate: created.data,
      progress: describeProgress(input),
      done: finished,
      warnings: checked.warnings,
    }), true;
  }

  return fail(`Unknown generation step "${input.step}"`, 500);
}

/**
 * Apply is the dangerous one. It merges the candidate's theme into every
 * landing page and template in the project — the same bulk-rewrite shape as the
 * canonical-section save that wiped the Marinoff menu (hazard 4.1). Two rules
 * hold here and must keep holding:
 *
 *   1. Snapshot first, and abort the whole apply if the snapshot fails.
 *   2. Await every page write. The 2026-07-22 propagation bug was a
 *      fire-and-forget loop that the serverless freeze killed after 30 of 50
 *      pages; a caller that waits gets a real failure instead of silent drift.
 */
async function handleApply(req, res, candidateId, scope) {
  // Read the body once, up front — the request stream cannot be re-parsed
  // after the awaits below.
  const body = await parseJsonBody(req);

  const candidateResult = await store.getCandidate(candidateId, scope);
  if (!candidateResult.ok) return sendErr(res, candidateResult.status || 404, candidateResult.error || 'Candidate not found'), true;
  const candidate = candidateResult.data;

  const pagesResult = await listPages(5000, scope);
  if (!pagesResult.ok) return sendErr(res, pagesResult.status || 500, pagesResult.error || 'Could not load pages'), true;
  const pages = Array.isArray(pagesResult.data) ? pagesResult.data : [];
  if (!pages.length) return sendErr(res, 400, 'This project has no pages to apply a theme to', { code: 'NO_PAGES' }), true;

  // Rule 1 — snapshot before anything is written.
  const snapshot = await store.createApplySnapshot({
    sessionId: candidate.sessionId,
    label: `Theme Wizard — before applying "${candidate.direction}"`,
    pages,
  }, scope);
  if (!snapshot.ok) {
    return sendErr(res, snapshot.status || 500,
      `Nothing was changed: the safety snapshot failed (${snapshot.error || 'unknown error'})`,
      { code: 'SNAPSHOT_FAILED' }), true;
  }

  const themePatch = candidate.themePatch && typeof candidate.themePatch === 'object' ? candidate.themePatch : {};
  const themeName = String(body?.name || '').trim()
    || `Theme Wizard — ${candidate.direction}`.slice(0, 255);

  const themeResult = await createTheme({
    name: themeName,
    ...themePatch,
    // The banner this look was keyed to travels with the theme, so the site's
    // top band can wear it (and the hero overlay) everywhere the theme goes.
    ...(themePatch.heroBannerUrl ? { heroBanner: { url: String(themePatch.heroBannerUrl) } } : {}),
  }, scope);
  if (!themeResult.ok) return sendErr(res, themeResult.status || 500, themeResult.error || 'Could not save the theme'), true;

  // Rule 2 — awaited, and pageBackground is carried through explicitly so the
  // merge cannot drop it (hazard 4.6).
  const typography = themePatch.typography && typeof themePatch.typography === 'object' ? themePatch.typography : null;
  const results = await Promise.all(pages.map(async (page) => {
    const existingTheme = page.theme && typeof page.theme === 'object' ? page.theme : {};
    const mergedTheme = typography ? { ...existingTheme, typography } : existingTheme;
    const updated = await updatePage(String(page.id), {
      layoutSections: page.layoutSections,
      pageBackground: page.pageBackground,
      theme: mergedTheme,
    }, scope);
    return { id: page.id, name: page.name, ok: updated.ok, error: updated.error || null };
  }));

  const applied = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  await store.updateSession(candidate.sessionId, {
    status: 'applied',
    appliedCandidateId: candidate.id,
    applySnapshotId: String(snapshot.data?.id || ''),
  }, scope);

  return sendOk(res, 200, {
    theme: themeResult.data,
    snapshotId: snapshot.data?.id || null,
    applied,
    failed: failed.length,
    // Named, not counted: "3 pages failed" is not actionable, "these three
    // pages failed" is.
    failures: failed.map((r) => ({ id: r.id, name: r.name, error: r.error })),
  }), true;
}

async function handleRevert(req, res, sessionId, scope) {
  const sessionResult = await store.getSession(sessionId, scope);
  if (!sessionResult.ok) return sendErr(res, sessionResult.status || 404, sessionResult.error || 'Session not found'), true;
  const session = sessionResult.data;

  const snapshot = await store.getApplySnapshot(session.applySnapshotId, scope);
  if (!snapshot.ok) {
    return sendErr(res, snapshot.status || 404,
      snapshot.error || 'This session has no snapshot to revert to', { code: 'NO_SNAPSHOT' }), true;
  }

  const snapshotPages = Array.isArray(snapshot.data?.pages) ? snapshot.data.pages : [];
  if (!snapshotPages.length) {
    return sendErr(res, 409, 'The snapshot for this session is empty; nothing was restored', { code: 'EMPTY_SNAPSHOT' }), true;
  }

  const results = await Promise.all(snapshotPages.map(async (snapPage) => {
    const pageId = String(snapPage?.id || '');
    if (!pageId) return { id: '', name: snapPage?.name || '', ok: false, error: 'missing id' };
    const restored = await updatePage(pageId, snapPage, scope);
    return { id: pageId, name: snapPage?.name || '', ok: restored.ok, error: restored.error || null };
  }));

  const restored = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  // Only stand the session back up if everything came back. A partial restore
  // that reports 'active' would invite a second apply on top of a half-reverted
  // site.
  if (!failed.length) {
    await store.updateSession(sessionId, {
      status: 'active',
      appliedCandidateId: '',
      applySnapshotId: '',
    }, scope);
  }

  return sendOk(res, 200, {
    restored,
    failed: failed.length,
    failures: failed.map((r) => ({ id: r.id, name: r.name, error: r.error })),
    sessionStatus: failed.length ? 'applied' : 'active',
  }), true;
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith(PREFIX)) return false;
  if (!req.authUser) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;

  const scope = requireProject(req, res);
  if (!scope) return true;

  // POST /sessions — start a wizard run
  if (pathname === `${PREFIX}/sessions` && method === 'POST') {
    const body = await parseJsonBody(req);
    const seedType = String(body?.seedType || 'current_pages').trim();
    if (!SEED_TYPES.includes(seedType)) {
      return sendErr(res, 400, `Unknown seed type "${seedType}". Expected one of: ${SEED_TYPES.join(', ')}`, { code: 'VALIDATION_ERROR' }), true;
    }
    const rawSeedPayload = body?.seedPayload && typeof body.seedPayload === 'object' ? body.seedPayload : {};
    // Hero-banner extras ride on any seed type. URLs only (the picker and the
    // upload flow both hand back URLs); capped at three, matching the slots.
    const heroBannerUrls = (Array.isArray(rawSeedPayload.heroBannerUrls) ? rawSeedPayload.heroBannerUrls : [])
      .map((value) => String(value || '').trim())
      .filter((value) => /^https?:\/\//i.test(value))
      .slice(0, 3);
    const seedPayload = {
      ...rawSeedPayload,
      heroBannerUrls,
      heroNote: String(rawSeedPayload.heroNote || '').slice(0, 2000),
      heroReferenceUrl: String(rawSeedPayload.heroReferenceUrl || '').trim().slice(0, 2048),
    };
    // Validate the seed's own input at create time. Discovering that the URL
    // box was empty three model calls into a round is a waste of the operator's
    // time and of tokens.
    if (seedType === 'external_url' && !String(seedPayload.url || '').trim()) {
      return sendErr(res, 400, 'Enter the website address to read', { code: 'VALIDATION_ERROR' }), true;
    }
    if (seedType === 'brief' && !String(seedPayload.text || '').trim()) {
      return sendErr(res, 400, 'Describe the organisation first', { code: 'VALIDATION_ERROR' }), true;
    }
    if (seedType === 'brand_kit' && !String(seedPayload.assetId || '').trim()) {
      return sendErr(res, 400, 'Pick a logo or brand image first', { code: 'VALIDATION_ERROR' }), true;
    }
    const result = await store.createSession({
      seedType,
      seedPayload,
      previewPageId: String(body?.previewPageId || '').trim(),
      ownerUserId: scope.userId,
    }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not start a wizard session'), true;
    return sendOk(res, 201, result.data), true;
  }

  // GET /sessions — list runs for the active project
  if (pathname === `${PREFIX}/sessions` && method === 'GET') {
    const result = await store.listSessions(scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not load sessions'), true;
    return sendOk(res, 200, result.data), true;
  }

  const sessionMatch = pathname.match(/^\/api\/builder\/theme-wizard\/sessions\/([^/]+)$/);
  const generateMatch = pathname.match(/^\/api\/builder\/theme-wizard\/sessions\/([^/]+)\/generate$/);
  const rankMatch = pathname.match(/^\/api\/builder\/theme-wizard\/sessions\/([^/]+)\/rank$/);
  const locksMatch = pathname.match(/^\/api\/builder\/theme-wizard\/sessions\/([^/]+)\/locks$/);
  const revertMatch = pathname.match(/^\/api\/builder\/theme-wizard\/sessions\/([^/]+)\/revert$/);
  const applyMatch = pathname.match(/^\/api\/builder\/theme-wizard\/candidates\/([^/]+)\/apply$/);
  const jobMatch = pathname.match(/^\/api\/builder\/theme-wizard\/jobs\/([^/]+)$/);
  const advanceMatch = pathname.match(/^\/api\/builder\/theme-wizard\/jobs\/([^/]+)\/advance$/);

  // GET /sessions/:id — session plus every round and job
  if (sessionMatch && method === 'GET') {
    const sessionId = decodeURIComponent(sessionMatch[1] || '').trim();
    const sessionResult = await store.getSession(sessionId, scope);
    if (!sessionResult.ok) return sendErr(res, sessionResult.status || 404, sessionResult.error || 'Session not found'), true;
    const [candidates, jobs] = await Promise.all([
      store.listCandidates(sessionId, scope),
      store.listJobs(sessionId, scope),
    ]);
    return sendOk(res, 200, {
      session: sessionResult.data,
      candidates: candidates.ok ? candidates.data : [],
      jobs: jobs.ok ? jobs.data : [],
    }), true;
  }

  // DELETE /sessions/:id — retire a past run (the DB cascades to its
  // candidates and jobs). An applied session is refused: its snapshot pointer
  // is the one-click undo for a live site-wide change, and deleting that to
  // tidy a list would be the Marinoff-menu shape again.
  if (sessionMatch && method === 'DELETE') {
    const sessionId = decodeURIComponent(sessionMatch[1] || '').trim();
    const sessionResult = await store.getSession(sessionId, scope);
    if (!sessionResult.ok) return sendErr(res, sessionResult.status || 404, sessionResult.error || 'Session not found'), true;
    if (sessionResult.data.status === 'applied') {
      return sendErr(res, 409,
        'This run’s theme is applied to the site, and this run holds the undo for it. Undo the apply first, or keep the run.',
        { code: 'SESSION_APPLIED' }), true;
    }
    const removed = await store.deleteSession(sessionId, scope);
    if (!removed.ok) return sendErr(res, removed.status || 500, removed.error || 'Could not delete the run'), true;
    return sendOk(res, 200, { deleted: true, id: sessionId }), true;
  }

  if (generateMatch && method === 'POST') {
    return handleGenerate(req, res, decodeURIComponent(generateMatch[1] || '').trim(), scope);
  }

  // POST /jobs/:id/advance — do one model call's worth of work
  if (advanceMatch && method === 'POST') {
    return handleAdvance(req, res, decodeURIComponent(advanceMatch[1] || '').trim(), scope);
  }

  // GET /jobs/:id — poll generation status
  if (jobMatch && method === 'GET') {
    const jobId = decodeURIComponent(jobMatch[1] || '').trim();
    const result = await store.getJob(jobId, scope);
    if (!result.ok) return sendErr(res, result.status || 404, result.error || 'Job not found'), true;
    return sendOk(res, 200, result.data), true;
  }

  // POST /sessions/:id/rank — ranking plus per-candidate feedback
  if (rankMatch && method === 'POST') {
    const sessionId = decodeURIComponent(rankMatch[1] || '').trim();
    const body = await parseJsonBody(req);
    const rankings = Array.isArray(body?.rankings) ? body.rankings : [];
    if (!rankings.length) return sendErr(res, 400, 'rankings is required', { code: 'VALIDATION_ERROR' }), true;

    const sessionResult = await store.getSession(sessionId, scope);
    if (!sessionResult.ok) return sendErr(res, sessionResult.status || 404, sessionResult.error || 'Session not found'), true;

    const updated = [];
    for (const entry of rankings) {
      const candidateId = String(entry?.candidateId || '').trim();
      if (!candidateId) continue;
      // Re-read through the scoped getter so a candidate id from another
      // project cannot be ranked into this session.
      const existing = await store.getCandidate(candidateId, scope);
      if (!existing.ok || existing.data.sessionId !== sessionId) {
        return sendErr(res, 404, `Candidate ${candidateId} is not part of this session`, { code: 'CANDIDATE_MISMATCH' }), true;
      }
      const result = await store.updateCandidate(candidateId, {
        rank: entry?.rank,
        feedback: entry?.feedback,
      }, scope);
      if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not save ranking'), true;
      updated.push(result.data);
    }
    return sendOk(res, 200, updated), true;
  }

  // POST /sessions/:id/locks — pin values a later round must not change
  if (locksMatch && method === 'POST') {
    const sessionId = decodeURIComponent(locksMatch[1] || '').trim();
    const body = await parseJsonBody(req);
    const lockedValues = body?.lockedValues && typeof body.lockedValues === 'object' ? body.lockedValues : {};
    const result = await store.updateSession(sessionId, { lockedValues }, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not save locks'), true;
    return sendOk(res, 200, result.data), true;
  }

  if (applyMatch && method === 'POST') {
    return handleApply(req, res, decodeURIComponent(applyMatch[1] || '').trim(), scope);
  }

  if (revertMatch && method === 'POST') {
    return handleRevert(req, res, decodeURIComponent(revertMatch[1] || '').trim(), scope);
  }

  return sendErr(res, 405, 'Method not allowed', { code: 'METHOD_NOT_ALLOWED' }), true;
}

module.exports = {
  handle,
  manifest: {
    id: 'themeWizard',
    label: 'Theme Wizard',
    prefixes: [PREFIX],
  },
};
