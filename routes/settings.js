'use strict';

/**
 * routes/settings.js
 * All /api/settings/* and /api/openclaw/* routes.
 *
 * #9 — Standardized API Response Envelope: sendOk() / sendErr()
 * Rate limiting: OpenClaw relay calls are ⚡ rate limited via checkEndpointLimit()
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const {
  listApiSchemas, listApiConfigsMasked, upsertApiConfig,
  getApiConfig, deleteApiConfig, getProviderValues,
  getProviderCredentialDiagnostics,
  listArchiveApiRestorePreview, restoreApiConfigsFromArchive
} = require('../lib/apiSettings');
const { verifyProvider, isVerifiable } = require('../lib/credentialVerify');
const { getBuildInfo }             = require('../lib/buildInfo');
const { recordVerifiedIdentity, describeIdentityChange } = require('../lib/credentialIdentityStore');
const { findStaleEnvVars, describeStaleEnvVars }         = require('../lib/vercelEnvAudit');
const { relayOpenClaw }            = require('../lib/openclawGateway');
const { upsertMirroredAcquireJob } = require('../lib/acquireMirror');
const {
  addRun: addOrchestratorRun,
  listRuns: listOrchestratorRuns,
  getLatestRun: getLatestOrchestratorRun,
  updateChecklistStep: updateOrchestratorChecklistStep,
} = require('../lib/orchestratorRunsStore');
const {
  listSupportedPlatforms: listConnectionOpsPlatforms,
  getConnectionOps,
  updateGate: updateConnectionOpsGate,
  addAttempt: addConnectionOpsAttempt,
} = require('../lib/connectionOpsStore');
const {
  hasSupabaseConfig, listDatabaseTables, createDatabaseField,
  listContactOptions, createContactOption, updateContactOption, deleteContactOption
} = require("../lib/ContactsStore");
const { logActivity } = require('../lib/activityLog');
const { requestProjectScope } = require('../lib/requestProjectScope');
const {
  getProfile,
  saveProfile,
  getYoutubeMinerResponseContext,
  saveYoutubeMinerResponseContext,
  getYoutubeMinerPromptConfig,
  saveYoutubeMinerPromptConfig,
} = require('../lib/profileStore');
const {
  getTrainingPromptConfig,
  saveTrainingPromptConfig,
  getTrainingSettings,
  saveTrainingSettings,
  listTrainingItems,
  saveTrainingItems,
  listTrainingRulesGuides,
  saveTrainingRulesGuides,
} = require('../lib/trainingStore');
const config = require('../lib/config');

function safeText(value) {
  return String(value || '').trim();
}

function senderLabel(name, email) {
  const n = safeText(name);
  const e = safeText(email);
  if (n && e) return `${n} (${e})`;
  return e || n || '';
}

/**
 * Did the account behind these credentials change since the last check?
 *
 * Only meaningful after a passing check that named an account. Returns null when
 * the feature is unavailable (migration not applied, no project scope, provider
 * reports no identity) so the response simply omits it — an absent annotation is
 * honest, whereas `changed: false` from an untracked check would be a claim we
 * cannot support.
 */
async function annotateIdentityDrift(provider, result, projectId) {
  if (!result || result.ok !== true) return null;
  const identity = result.identity || null;
  if (!identity || (!identity.label && !identity.id)) return null;
  try {
    const record = await recordVerifiedIdentity({ projectId, provider, identity });
    if (!record.tracked) return null;
    const message = describeIdentityChange(record, identity.label);
    return {
      tracked: true,
      changed: Boolean(record.changed),
      previous: record.previous ? { label: record.previous.label, id: record.previous.id } : null,
      message,
    };
  } catch (_) {
    // Bookkeeping must never break the check it decorates.
    return null;
  }
}

/**
 * Were any of this provider's environment variables edited after the running
 * deployment was built? That is the difference between "the value in Vercel is
 * wrong" and "the value in Vercel is right but not live yet" — indistinguishable
 * from the outside, and the cause of the 2026-07-29 misdiagnosis.
 *
 * Needs VERCEL_API_TOKEN; returns a `checked: false` note with the reason
 * otherwise, so the UI can say why rather than staying silent.
 */
async function annotateEnvStaleness(provider, result) {
  // Only worth the API call when something is actually wrong and at least one
  // value came from an environment variable.
  if (!result || result.ok === true) return null;
  let envNames = [];
  try {
    const diag = getProviderCredentialDiagnostics(provider);
    if (!diag || !diag.ok) return null;
    envNames = Object.entries(diag.sources || {})
      .filter(([, source]) => source === 'env')
      .map(([field]) => (diag.envKeys || {})[field])
      .filter(Boolean);
  } catch (_) {
    return null;
  }
  if (!envNames.length) return null;

  try {
    const staleness = await findStaleEnvVars(envNames);
    const message = describeStaleEnvVars(staleness);
    return {
      checked: Boolean(staleness.checked),
      reason: staleness.reason || '',
      stale: staleness.stale || [],
      envVarsChecked: envNames,
      message,
    };
  } catch (_) {
    return null;
  }
}

async function handle(req, res, pathname, method) {
  // GET /api/health — always allowed, no rate limit
  if (pathname === '/api/health' && method === 'GET') {
    const payload = { now: new Date().toISOString(), promoLeads: { supabaseConfigured: hasSupabaseConfig() } };
    return sendOk(res, 200, payload, payload), true;
  }

  // GET /api/settings/apis/schema
  if (pathname === '/api/settings/apis/schema' && method === 'GET') {
    const providers = listApiSchemas();
    return sendOk(res, 200, providers, { providers }), true;
  }

  // GET /api/settings/connection-ops/platforms
  if (pathname === '/api/settings/connection-ops/platforms' && method === 'GET') {
    const platforms = listConnectionOpsPlatforms();
    return sendOk(res, 200, platforms, { platforms }), true;
  }

  // GET /api/settings/apis
  if (pathname === '/api/settings/apis' && method === 'GET') {
    const configs = listApiConfigsMasked();
    return sendOk(res, 200, configs, { configs }, { total: configs.length }), true;
  }

  // POST /api/settings/apis
  if (pathname === '/api/settings/apis' && method === 'POST') {
    const body   = await parseJsonBody(req);
    const result = await upsertApiConfig(body);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'settings.api_saved', entityType: 'settings',
      summary: `API config saved: ${body.provider || 'unknown provider'}`
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  // GET /api/settings/apis/archive/preview
  if (pathname === '/api/settings/apis/archive/preview' && method === 'GET') {
    const result = listArchiveApiRestorePreview();
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  // GET /api/settings/orchestrator/runs/latest
  if (pathname === '/api/settings/orchestrator/runs/latest' && method === 'GET') {
    const scope = requestProjectScope(req);
    const run = await getLatestOrchestratorRun(scope);
    return sendOk(res, 200, run, { run }), true;
  }

  // GET /api/settings/orchestrator/runs
  if (pathname === '/api/settings/orchestrator/runs' && method === 'GET') {
    const scope = requestProjectScope(req);
    const runs = await listOrchestratorRuns(25, scope);
    return sendOk(res, 200, runs, { runs }), true;
  }

  // PATCH /api/settings/orchestrator/runs/:id/checklist
  const orchestratorChecklistMatch = pathname.match(/^\/api\/settings\/orchestrator\/runs\/([^/]+)\/checklist$/);
  if (orchestratorChecklistMatch && method === 'PATCH') {
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const result = await updateOrchestratorChecklistStep(
      orchestratorChecklistMatch[1],
      body?.channel,
      body?.step_id || body?.stepId,
      body?.done === true,
      scope
    );
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { run: result.data }), true;
  }

  // POST /api/settings/orchestrator/run
  if (pathname === '/api/settings/orchestrator/run' && method === 'POST') {
    const scope = requestProjectScope(req);
    const body = await parseJsonBody(req);
    const channels = Array.isArray(body?.channels) && body.channels.length
      ? body.channels
      : ['x', 'facebook', 'instagram', 'linkedin', 'threads', 'bluesky', 'pinterest', 'reddit', 'telegram', 'youtube', 'quora', 'substack', 'medium', 'patreon'];
    const goals = Array.isArray(body?.goals) && body.goals.length
      ? body.goals
      : ['automate_credential_inventory', 'separate_agent_tasks_vs_human_tasks', 'minimize_human_steps', 'produce_channel_readiness_report'];
    const outputs = Array.isArray(body?.outputs) && body.outputs.length
      ? body.outputs
      : ['readiness_matrix', 'human_minimum_checklist', 'next_actions'];
    const request = {
      manual_confirmed: true,
      type: 'operations.api_setup_orchestrator',
      workspace_id: safeText(body?.workspace_id || body?.workspaceId || 'alphire-main') || 'alphire-main',
      requested_by: {
        user_id: safeText(body?.requested_by_user_id || body?.requestedByUserId || 'alphire-ui') || 'alphire-ui',
        email: safeText(body?.requested_by_email || body?.requestedByEmail || 'ops@alphire.ai') || 'ops@alphire.ai',
      },
      payload: {
        channels,
        goals,
        run_mode: safeText(body?.run_mode || body?.runMode || 'guided') || 'guided',
        include_diagnostics: body?.include_diagnostics !== false,
        outputs,
      },
      policy: { requires_manual_approval: true },
    };

    const relayResult = await relayOpenClaw('create_job', request);
    const runRecord = await addOrchestratorRun({
      request,
      relayResult: relayResult.ok ? relayResult.data : null,
      relayError: relayResult.ok ? null : relayResult.error,
      relayStatus: relayResult.status,
    }, scope);

    logActivity({
      action: 'settings.orchestrator_run',
      entityType: 'settings',
      summary: relayResult.ok
        ? `API setup orchestrator completed (${runRecord.id})`
        : `API setup orchestrator failed (${runRecord.id})`,
    });

    if (!relayResult.ok) {
      return sendErr(res, relayResult.status || 500, relayResult.error || 'Orchestrator run failed', {
        details: [runRecord.id],
      }), true;
    }

    return sendOk(res, 200, runRecord, { run: runRecord }), true;
  }

  // POST /api/settings/apis/archive/restore
  if (pathname === '/api/settings/apis/archive/restore' && method === 'POST') {
    const body = await parseJsonBody(req);
    const result = restoreApiConfigsFromArchive({ overwrite: body?.overwrite === true });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'settings.api_restore_archive',
      entityType: 'settings',
      summary: `Restored ${result.data.restored.length} API provider(s) from archive`
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  // GET /api/settings/apis/:provider
  const connectionOpsAttemptMatch = pathname.match(/^\/api\/settings\/connection-ops\/([^/]+)\/attempts$/);
  if (connectionOpsAttemptMatch && method === 'POST') {
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const result = await addConnectionOpsAttempt(connectionOpsAttemptMatch[1], body || {}, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'settings.connection_ops_attempt',
      entityType: 'settings',
      summary: `Connection Ops attempt logged: ${connectionOpsAttemptMatch[1]}`,
    });
    return sendOk(res, 200, result.data, { connectionOps: result.data }), true;
  }

  const connectionOpsGateMatch = pathname.match(/^\/api\/settings\/connection-ops\/([^/]+)\/gates\/([^/]+)$/);
  if (connectionOpsGateMatch && method === 'PATCH') {
    const body = await parseJsonBody(req);
    const scope = requestProjectScope(req);
    const result = await updateConnectionOpsGate(connectionOpsGateMatch[1], connectionOpsGateMatch[2], body?.done === true, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'settings.connection_ops_gate',
      entityType: 'settings',
      summary: `Connection Ops gate updated: ${connectionOpsGateMatch[1]} ${connectionOpsGateMatch[2]}`,
    });
    return sendOk(res, 200, result.data, { connectionOps: result.data }), true;
  }

  const connectionOpsMatch = pathname.match(/^\/api\/settings\/connection-ops\/([^/]+)$/);
  if (connectionOpsMatch && method === 'GET') {
    const scope = requestProjectScope(req);
    const result = await getConnectionOps(connectionOpsMatch[1], scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { connectionOps: result.data }), true;
  }

  // GET /api/settings/apis/:provider/diagnostics
  // Where each credential value is coming from (env var vs Settings) and which
  // are unset — masked previews and env var NAMES only, never secret values.
  // Works for every provider in API_SCHEMAS, not just the ones with a live test.
  const apiDiagnosticsMatch = pathname.match(/^\/api\/settings\/apis\/([^/]+)\/diagnostics$/);
  if (apiDiagnosticsMatch && method === 'GET') {
    const diag = getProviderCredentialDiagnostics(apiDiagnosticsMatch[1]);
    if (!diag.ok) return sendErr(res, 400, diag.error || 'Unsupported provider'), true;
    const payload = {
      ...diag,
      verifiable: isVerifiable(apiDiagnosticsMatch[1]),
      // When the running deployment was built. Any env-sourced value changed
      // after this timestamp is not live yet, no matter what Vercel shows.
      deployment: getBuildInfo(),
    };
    return sendOk(res, 200, payload, { diagnostics: payload }), true;
  }

  // GET /api/settings/apis/:provider/verify
  // Live authenticated call to the provider: does it work, and as whom?
  const apiVerifyMatch = pathname.match(/^\/api\/settings\/apis\/([^/]+)\/verify$/);
  if (apiVerifyMatch && method === 'GET') {
    // Each check is a real request to an outside API — rate limited so repeated
    // clicking cannot trip the provider's own limits and look like a failure.
    // Returns true when it has already sent a 429; that is the repo convention.
    if (checkEndpointLimit(req, res, 'settings.verifyCredentials')) return true;
    const scope = requestProjectScope(req);
    const provider = apiVerifyMatch[1];
    const result = await verifyProvider(provider, { projectId: scope?.projectId });

    // Two decorations, both optional and both silent when unavailable. Neither
    // may break the verification it annotates.
    const [drift, staleness] = await Promise.all([
      annotateIdentityDrift(provider, result, scope?.projectId),
      annotateEnvStaleness(provider, result),
    ]);
    if (drift) result.identityDrift = drift;
    if (staleness) result.envStaleness = staleness;

    // A failed check is a successful request that reports bad news — 200 with
    // ok:false inside, so the UI can render the detail instead of an error toast.
    return sendOk(res, 200, result, { verification: result }), true;
  }

  // GET /api/settings/apis/:provider
  const apiProviderMatch = pathname.match(/^\/api\/settings\/apis\/([^/]+)$/);
  if (apiProviderMatch && method === 'GET') {
    const result = getApiConfig(apiProviderMatch[1]);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  // DELETE /api/settings/apis/:provider
  if (apiProviderMatch && method === 'DELETE') {
    const result = deleteApiConfig(apiProviderMatch[1]);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'settings.api_deleted', entityType: 'settings',
      summary: `API config deleted: ${apiProviderMatch[1]}`
    });
    return sendOk(res, 200, result.data, result.data), true;
  }

  const contactOptionsMatch = pathname.match(/^\/api\/settings\/contacts\/(types|statuses|sources|segment_types)$/);
  if (contactOptionsMatch && method === 'GET') {
    const result = await listContactOptions(contactOptionsMatch[1], { activeOnly: req.url.includes('active=true') });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, { options: result.data || [] }, { options: result.data || [] }), true;
  }

  if (contactOptionsMatch && method === 'POST') {
    const body = await parseJsonBody(req);
    const result = await createContactOption(contactOptionsMatch[1], body);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, result.data), true;
  }

  const contactOptionIdMatch = pathname.match(/^\/api\/settings\/contacts\/(types|statuses|sources|segment_types)\/([^/]+)$/);
  if (contactOptionIdMatch && method === 'PATCH') {
    const body = await parseJsonBody(req);
    const result = await updateContactOption(contactOptionIdMatch[1], contactOptionIdMatch[2], body);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  if (contactOptionIdMatch && method === 'DELETE') {
    const result = await deleteContactOption(contactOptionIdMatch[1], contactOptionIdMatch[2]);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  // GET /api/settings/database/tables
  if (pathname === '/api/settings/database/tables' && method === 'GET') {
    const result = await listDatabaseTables();
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const tables = result.data || [];
    return sendOk(res, 200, tables, { tables }, { total: tables.length }), true;
  }

  if (pathname === '/api/settings/profile' && method === 'GET') {
    const profile = await getProfile(req.authUser?.id || req.authUser?.email || '');
    const account = {
      name: safeText(req.authUser?.name),
      email: safeText(req.authUser?.email).toLowerCase(),
    };
    const result = {
      ...profile,
      contactName: safeText(profile?.contactName) || account.name,
      email: safeText(profile?.email) || account.email,
      account,
    };
    return sendOk(res, 200, result, { profile: result }), true;
  }

  if (pathname === '/api/settings/profile' && method === 'POST') {
    const body = await parseJsonBody(req);
    const accountName = safeText(req.authUser?.name);
    const accountEmail = safeText(req.authUser?.email).toLowerCase();
    const profile = await saveProfile({
      contactName: safeText(body.contact_name || body.contactName) || accountName,
      email: safeText(body.email) || accountEmail,
      phone: body.phone,
      website: body.website,
      logoDataUrl: body.logo_data_url || body.logoDataUrl,
    }, req.authUser?.id || req.authUser?.email || '');
    const result = {
      ...profile,
      account: { name: accountName, email: accountEmail },
    };
    logActivity({
      action: 'settings.profile_saved',
      entityType: 'settings',
      summary: `Profile saved: ${profile.contactName || accountName || accountEmail || 'user'}`
    });
    return sendOk(res, 200, result, { profile: result }), true;
  }

  if (pathname === '/api/settings/youtube-miner-context' && method === 'GET') {
    const promptCfg = await getTrainingPromptConfig(req.authUser?.id || req.authUser?.email || '');
    return sendOk(
      res,
      200,
      { youtube_response_context: promptCfg.context, youtube_response_guidelines: promptCfg.guidelines },
      { youtube_response_context: promptCfg.context, youtube_response_guidelines: promptCfg.guidelines }
    ), true;
  }

  if (pathname === '/api/settings/youtube-miner-context' && method === 'POST') {
    const body = await parseJsonBody(req);
    const result = await saveTrainingPromptConfig(
      safeText(body?.youtube_response_context || body?.response_context),
      safeText(body?.youtube_response_guidelines || body?.response_guidelines),
      req.authUser?.id || req.authUser?.email || ''
    );
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  if (pathname === '/api/settings/training/context' && method === 'GET') {
    const promptCfg = await getTrainingPromptConfig(req.authUser?.id || req.authUser?.email || '');
    const payload = {
      training_context: promptCfg.context,
      training_guidelines: promptCfg.guidelines,
      youtube_response_context: promptCfg.context,
      youtube_response_guidelines: promptCfg.guidelines,
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/settings/training/context' && method === 'POST') {
    const body = await parseJsonBody(req);
    const result = await saveTrainingPromptConfig(
      safeText(body?.training_context || body?.youtube_response_context || body?.response_context),
      safeText(body?.training_guidelines || body?.youtube_response_guidelines || body?.response_guidelines),
      req.authUser?.id || req.authUser?.email || ''
    );
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const payload = {
      training_context: result.data?.youtubeResponseContext || '',
      training_guidelines: result.data?.youtubeResponseGuidelines || '',
      youtube_response_context: result.data?.youtubeResponseContext || '',
      youtube_response_guidelines: result.data?.youtubeResponseGuidelines || '',
      updatedAt: result.data?.updatedAt || '',
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/settings/training/settings' && method === 'GET') {
    const result = await getTrainingSettings(req.authUser?.id || req.authUser?.email || '');
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  if (pathname === '/api/settings/training/settings' && method === 'POST') {
    const body = await parseJsonBody(req);
    const result = await saveTrainingSettings(body || {}, req.authUser?.id || req.authUser?.email || '');
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  const trainingItemsMatch = pathname.match(/^\/api\/settings\/training\/(topics|categories|attributes|approaches)$/);
  if (trainingItemsMatch && method === 'GET') {
    const kind = trainingItemsMatch[1];
    const result = await listTrainingItems(kind, req.authUser?.id || req.authUser?.email || '');
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, { items: result.data || [] }, { items: result.data || [] }), true;
  }

  if (trainingItemsMatch && method === 'POST') {
    const body = await parseJsonBody(req);
    const kind = trainingItemsMatch[1];
    const result = await saveTrainingItems(kind, Array.isArray(body?.items) ? body.items : [], req.authUser?.id || req.authUser?.email || '');
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, { items: result.data || [] }, { items: result.data || [] }), true;
  }

  if (pathname === '/api/settings/training/rules-guides' && method === 'GET') {
    const result = await listTrainingRulesGuides(req.authUser?.id || req.authUser?.email || '');
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, { items: result.data || [] }, { items: result.data || [] }), true;
  }

  if (pathname === '/api/settings/training/rules-guides' && method === 'POST') {
    const body = await parseJsonBody(req);
    const result = await saveTrainingRulesGuides(Array.isArray(body?.items) ? body.items : [], req.authUser?.id || req.authUser?.email || '');
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, { items: result.data || [] }, { items: result.data || [] }), true;
  }

  if (pathname === '/api/settings/email-senders' && method === 'GET') {
    const profile = await getProfile(req.authUser?.id || req.authUser?.email || '');
    const resend = getProviderValues('resend');
    const items = [];
    const seen = new Set();
    const pushSender = (email, name, source, primary = false) => {
      const e = safeText(email).toLowerCase();
      if (!e || !e.includes('@') || seen.has(e)) return;
      seen.add(e);
      items.push({
        value: e,
        label: senderLabel(name, e),
        name: safeText(name),
        email: e,
        source,
        primary: Boolean(primary),
      });
    };

    pushSender(
      config.get('emailFromAddress'),
      config.get('emailFromName'),
      'env',
      true
    );
    pushSender(
      resend?.email_from_address,
      resend?.email_from_name,
      'settings',
      items.length === 0
    );
    pushSender(
      profile?.email,
      profile?.contactName || '',
      'profile',
      items.length === 0
    );

    if (!items.length) {
      pushSender('mentorofaio@gmail.com', 'Mentor of AIIO', 'fallback', true);
    }

    return sendOk(res, 200, items, { senders: items }), true;
  }

  // POST /api/settings/database/fields
  if (pathname === '/api/settings/database/fields' && method === 'POST') {
    const body   = await parseJsonBody(req);
    const result = await createDatabaseField(body);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    logActivity({
      action: 'settings.field_created', entityType: 'settings',
      summary: `Database field created: ${body.label || body.key || 'unknown'}`,
      meta: { table: body.table }
    });
    return sendOk(res, 201, result.data, result.data), true;
  }

  // POST /api/openclaw/:action — ⚡ RATE LIMITED (external API relay)
  const openClawMatch = pathname.match(/^\/api\/openclaw\/([^/]+)$/);
  if (openClawMatch && method === 'POST') {
    if (checkEndpointLimit(req, res, 'openclaw')) return true;

    const body   = await parseJsonBody(req);
    const result = await relayOpenClaw(openClawMatch[1], body);
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error, {
        details: result.data ? [String(result.data)] : []
      }), true;
    }
    const responsePayload = { action: openClawMatch[1], result: result.data };
    await upsertMirroredAcquireJob(openClawMatch[1], body, responsePayload, requestProjectScope(req));
    logActivity({
      action: `openclaw.${openClawMatch[1]}`, entityType: 'acquire',
      summary: `OpenClaw action: ${openClawMatch[1]}`
    });
    return sendOk(res, result.status || 200, responsePayload, responsePayload), true;
  }

  return false;
}

const manifest = {
  id:       'settings',
  label:    'Settings & OpenClaw Gateway',
  prefixes: ['/api/settings', '/api/openclaw', '/api/health']
};

module.exports = { handle, manifest };
