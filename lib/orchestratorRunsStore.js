const fs = require('fs');
const path = require('path');
const { listApiConfigsMasked } = require('./apiSettings');
const { sbQuery, isConfigured: isSupabaseConfigured, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery } = require('./projectScope');
const { attachScopeFields, matchesScopedRecord, normalizeScope } = require('./projectScopeFile');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'orchestrator_runs.json');
const MAX_RUNS = 100;

const CHANNEL_SPECS = {
  x: {
    label: 'X',
    provider: 'x',
    docsUrl: 'https://developer.x.com/en/portal/dashboard',
    steps: [
      { id: 'x_app', text: 'Create/verify X developer app and set Read/Write permissions.', url: 'https://developer.x.com/en/portal/projects-and-apps' },
      { id: 'x_tokens', text: 'Generate API key/secret and Access token/secret.', url: 'https://developer.x.com/en/portal/projects-and-apps' },
    ],
  },
  facebook: {
    label: 'Facebook',
    provider: 'meta',
    docsUrl: 'https://developers.facebook.com/apps/',
    steps: [
      { id: 'fb_app', text: 'Create Meta app and enable required Graph permissions.', url: 'https://developers.facebook.com/apps/' },
      { id: 'fb_token', text: 'Generate long-lived user/page token and capture Page ID.', url: 'https://developers.facebook.com/tools/explorer/' },
    ],
  },
  instagram: {
    label: 'Instagram',
    provider: 'instagram',
    docsUrl: 'https://developers.facebook.com/docs/instagram-platform/get-started',
    steps: [
      { id: 'ig_professional', text: 'Ensure Instagram account is Professional and linked to a Facebook Page.', url: 'https://www.instagram.com/accounts/professional_account_settings/' },
      { id: 'ig_token', text: 'Generate Graph token and capture instagram_business_account ID.', url: 'https://developers.facebook.com/tools/explorer/' },
    ],
  },
  linkedin: {
    label: 'LinkedIn',
    provider: 'linkedin',
    docsUrl: 'https://www.linkedin.com/developers/apps',
    steps: [
      { id: 'li_app', text: 'Create LinkedIn app and request needed product access.', url: 'https://www.linkedin.com/developers/apps' },
      { id: 'li_oauth', text: 'Run OAuth flow and store access/refresh token.', url: 'https://learn.microsoft.com/en-us/linkedin/' },
    ],
  },
  threads: {
    label: 'Threads',
    provider: 'threads',
    docsUrl: 'https://developers.facebook.com/docs/threads',
    steps: [
      { id: 'threads_app', text: 'Configure Threads API through Meta app.', url: 'https://developers.facebook.com/apps/' },
      { id: 'threads_token', text: 'Grant permissions and save token/account id.', url: 'https://developers.facebook.com/docs/threads' },
    ],
  },
  bluesky: {
    label: 'Bluesky',
    provider: 'bluesky',
    docsUrl: 'https://bsky.app/settings/app-passwords',
    steps: [
      { id: 'bsky_pwd', text: 'Create app password in Bluesky settings.', url: 'https://bsky.app/settings/app-passwords' },
    ],
  },
  pinterest: {
    label: 'Pinterest',
    provider: 'pinterest',
    docsUrl: 'https://developers.pinterest.com/apps/',
    steps: [
      { id: 'pin_app', text: 'Create Pinterest app and configure redirect URLs.', url: 'https://developers.pinterest.com/apps/' },
      { id: 'pin_oauth', text: 'Complete OAuth and store tokens.', url: 'https://developers.pinterest.com/' },
    ],
  },
  reddit: {
    label: 'Reddit',
    provider: 'reddit',
    docsUrl: 'https://www.reddit.com/prefs/apps',
    steps: [
      { id: 'reddit_app', text: 'Create Reddit app and capture client id/secret.', url: 'https://www.reddit.com/prefs/apps' },
      { id: 'reddit_refresh', text: 'Generate and store refresh token.', url: 'https://github.com/reddit-archive/reddit/wiki/OAuth2' },
    ],
  },
  telegram: {
    label: 'Telegram',
    provider: 'telegram',
    docsUrl: 'https://core.telegram.org/bots',
    steps: [
      { id: 'tg_bot', text: 'Create bot via BotFather and capture bot token.', url: 'https://core.telegram.org/bots' },
      { id: 'tg_chat', text: 'Capture target chat/channel ID for posting.', url: 'https://core.telegram.org/bots/api' },
    ],
  },
  youtube: {
    label: 'YouTube',
    provider: 'youtube',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      { id: 'yt_key', text: 'Enable YouTube Data API and create API key.', url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
      { id: 'yt_creds', text: 'Open API credentials and copy key/client values.', url: 'https://console.cloud.google.com/apis/credentials' },
    ],
  },
  quora: {
    label: 'Quora',
    provider: 'quora',
    docsUrl: 'https://www.quora.com/business',
    steps: [
      { id: 'quora_access', text: 'Request Quora API/partner access and app credentials.', url: 'https://www.quora.com/business' },
      { id: 'quora_ads', text: 'Confirm account/business access in Ads Manager.', url: 'https://www.quora.com/adsmanager' },
    ],
  },
  substack: {
    label: 'Substack',
    provider: 'substack',
    docsUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSe71I98Od4wyv23cHozydPxsT4x7AxfrXR1w2ZIpUiAHJK2VQ/viewform',
    steps: [
      { id: 'substack_form', text: 'Submit Substack Developer API request form.', url: 'https://docs.google.com/forms/d/e/1FAIpQLSe71I98Od4wyv23cHozydPxsT4x7AxfrXR1w2ZIpUiAHJK2VQ/viewform' },
      { id: 'substack_pub', text: 'Confirm publication URL and API token access.', url: 'https://support.substack.com/hc/en-us/articles/45099095296916-Substack-Developer-API' },
    ],
  },
  medium: {
    label: 'Medium',
    provider: 'medium',
    docsUrl: 'https://help.medium.com/hc/en-us/articles/213480228-API-Importing',
    steps: [
      { id: 'medium_token', text: 'Confirm Medium API access path and generate integration token if available.', url: 'https://help.medium.com/hc/en-us/articles/213480228-API-Importing' },
    ],
  },
  patreon: {
    label: 'Patreon',
    provider: 'patreon',
    docsUrl: 'https://www.patreon.com/portal/registration/register-clients',
    steps: [
      { id: 'patreon_client', text: 'Register Patreon client and capture client id/secret.', url: 'https://www.patreon.com/portal/registration/register-clients' },
      { id: 'patreon_oauth', text: 'Complete OAuth grant and save refresh token.', url: 'https://docs.patreon.com/' },
    ],
  },
};

function ensureStoreFile() {
  ensureJsonFile(STORE_FILE, { runs: [] }, { mode: 0o600 });
}

function readStoreSync() {
  try {
    ensureStoreFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { runs: [] };
    if (!Array.isArray(parsed.runs)) parsed.runs = [];
    return parsed;
  } catch {
    return { runs: [] };
  }
}

function writeStoreSync(store) {
  ensureStoreFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

const SUPPORT_CACHE = { value: null };

function runsTable() {
  return tableConfig().orchestratorRuns;
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsSupabaseRuns() {
  if (!isSupabaseConfigured()) return false;
  if (SUPPORT_CACHE.value !== null) return SUPPORT_CACHE.value;
  const table = runsTable();
  const probe = await sbQuery({ table, query: 'select=id&limit=1' });
  SUPPORT_CACHE.value = probe.ok || !isMissingTableError(probe.error);
  return SUPPORT_CACHE.value;
}

function recordFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const base = row.run_json && typeof row.run_json === 'object' ? row.run_json : {};
  return {
    ...base,
    id: String(row.id || base.id || ''),
    status: String(row.status || base.status || ''),
    createdAt: String(row.created_at || base.createdAt || ''),
    updatedAt: String(row.updated_at || base.updatedAt || ''),
    projectId: String(row.project_id || base.projectId || ''),
    project_id: String(row.project_id || base.project_id || ''),
  };
}

function listFromFile(scope, limit) {
  const store = readStoreSync();
  const max = Math.max(1, Math.min(Number(limit) || 20, MAX_RUNS));
  return store.runs
    .filter((row) => matchesScopedRecord(row, scope))
    .slice(0, max);
}

function normalizeChannelKey(input) {
  return String(input || '').trim().toLowerCase();
}

function configsByProvider() {
  const map = new Map();
  listApiConfigsMasked().forEach((cfg) => map.set(String(cfg.provider || ''), cfg));
  return map;
}

function buildChannelChecklist(channelsInput) {
  const channels = Array.isArray(channelsInput) ? channelsInput : [];
  const cfgMap = configsByProvider();
  return channels.map((channelRaw) => {
    const key = normalizeChannelKey(channelRaw);
    const spec = CHANNEL_SPECS[key] || {
      label: key || 'Unknown',
      provider: key,
      docsUrl: '',
      steps: [],
    };
    const provider = String(spec.provider || key);
    const cfg = cfgMap.get(provider) || null;
    return {
      channel: key,
      label: spec.label,
      provider,
      docsUrl: spec.docsUrl || '',
      configured: Boolean(cfg?.configured),
      staleStatus: String(cfg?.staleCheck?.healthStatus || 'unknown'),
      staleFlags: Array.isArray(cfg?.staleCheck?.flags) ? cfg.staleCheck.flags : [],
      steps: (spec.steps || []).map((step) => ({
        id: String(step.id || ''),
        text: String(step.text || ''),
        url: String(step.url || ''),
        done: false,
      })),
    };
  });
}

function parseStructuredOutput(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return null;
}

function summarizeRun(channelsChecklist, structuredOutput, relayResult) {
  const total = channelsChecklist.length;
  const configured = channelsChecklist.filter((row) => row.configured).length;
  const warning = channelsChecklist.filter((row) => row.staleStatus === 'warning').length;
  const error = channelsChecklist.filter((row) => row.staleStatus === 'error').length;
  const mode = String(relayResult?.mode || '');
  return {
    totalChannels: total,
    configuredChannels: configured,
    flaggedWarningChannels: warning,
    flaggedErrorChannels: error,
    mode: mode || 'legacy',
    hasStructuredOutput: Boolean(structuredOutput),
  };
}

function createRunRecord({ request, relayResult, relayError, relayStatus }) {
  const payload = request?.payload && typeof request.payload === 'object' ? request.payload : {};
  const channelsChecklist = buildChannelChecklist(payload.channels);
  const outputText = String(relayResult?.output_text || '').trim();
  const structuredOutput = parseStructuredOutput(outputText);
  const createdAt = new Date().toISOString();
  const id = `orun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const status = relayError ? 'failed' : 'completed';
  const summary = summarizeRun(channelsChecklist, structuredOutput, relayResult);
  return {
    id,
    createdAt,
    status,
    request,
    relay: {
      status: Number(relayStatus || 0) || null,
      error: relayError ? String(relayError) : null,
      result: relayResult || null,
    },
    outputText,
    structuredOutput,
    channelsChecklist,
    summary,
  };
}

async function addRun(recordInput, scope = null) {
  const record = createRunRecord(recordInput || {});
  const scoped = attachScopeFields(record, scope);
  const { projectId, userId } = normalizeScope(scope);
  const now = new Date().toISOString();
  scoped.updatedAt = now;

  if (projectId && (await supportsSupabaseRuns())) {
    const table = runsTable();
    const row = {
      id: scoped.id,
      project_id: projectId,
      owner_user_id: userId || null,
      status: scoped.status,
      run_json: scoped,
      created_at: scoped.createdAt || now,
      updated_at: now,
    };
    const insert = await sbQuery({
      method: 'POST',
      table,
      query: 'on_conflict=project_id,id&select=*',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [row],
    });
    if (insert.ok) {
      const saved = Array.isArray(insert.data) ? insert.data[0] : null;
      return recordFromRow(saved) || scoped;
    }
    if (!isMissingTableError(insert.error)) return scoped;
  }

  const store = readStoreSync();
  store.runs.unshift(scoped);
  if (store.runs.length > MAX_RUNS) store.runs = store.runs.slice(0, MAX_RUNS);
  writeStoreSync(store);
  return scoped;
}

async function listRuns(limit = 20, scope = null) {
  const max = Math.max(1, Math.min(Number(limit) || 20, 100));
  const { projectId } = normalizeScope(scope);

  if (projectId && (await supportsSupabaseRuns())) {
    const table = runsTable();
    const query = await scopedListQuery(
      table,
      `select=id,status,run_json,created_at,updated_at&order=created_at.desc&limit=${max}`,
      scope
    );
    const result = await sbQuery({ table, query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : [])
        .map(recordFromRow)
        .filter(Boolean);
    }
    if (!isMissingTableError(result.error)) {
      return listFromFile(scope, max);
    }
  }

  return listFromFile(scope, max);
}

async function getLatestRun(scope = null) {
  const runs = await listRuns(1, scope);
  return runs.length ? runs[0] : null;
}

async function updateChecklistStep(runIdInput, channelInput, stepIdInput, doneInput, scope = null) {
  const runId = String(runIdInput || '').trim();
  const channel = normalizeChannelKey(channelInput);
  const stepId = String(stepIdInput || '').trim();
  if (!runId || !channel || !stepId) {
    return { ok: false, status: 400, error: 'run_id, channel, and step_id are required' };
  }

  const { projectId } = normalizeScope(scope);
  const now = new Date().toISOString();

  if (projectId && (await supportsSupabaseRuns())) {
    const table = runsTable();
    const loadQuery = await scopedIdQuery(table, `select=*&id=eq.${encodeURIComponent(runId)}&limit=1`, scope);
    const loadRes = await sbQuery({ table, query: loadQuery });
    if (loadRes.ok) {
      const row = Array.isArray(loadRes.data) ? loadRes.data[0] : null;
      const run = recordFromRow(row);
      if (!run) return { ok: false, status: 404, error: 'Run not found' };
      const checklist = Array.isArray(run.channelsChecklist) ? run.channelsChecklist : [];
      const channelRow = checklist.find((item) => normalizeChannelKey(item.channel) === channel);
      if (!channelRow) return { ok: false, status: 404, error: 'Channel checklist entry not found' };
      const steps = Array.isArray(channelRow.steps) ? channelRow.steps : [];
      const step = steps.find((item) => String(item.id || '') === stepId);
      if (!step) return { ok: false, status: 404, error: 'Checklist step not found' };
      step.done = doneInput === true;
      run.updatedAt = now;
      const patch = await sbQuery({
        method: 'PATCH',
        table,
        query: await scopedIdQuery(table, `id=eq.${encodeURIComponent(runId)}&select=*`, scope),
        headers: { Prefer: 'return=representation' },
        body: {
          run_json: run,
          updated_at: now,
        },
      });
      if (patch.ok) {
        const next = Array.isArray(patch.data) ? patch.data[0] : null;
        return { ok: true, status: 200, data: recordFromRow(next) || run };
      }
      return { ok: false, status: patch.status || 500, error: String(patch.error || 'Could not update checklist') };
    }
    if (!isMissingTableError(loadRes.error)) {
      return { ok: false, status: loadRes.status || 500, error: String(loadRes.error || 'Run not found') };
    }
  }

  const store = readStoreSync();
  const run = store.runs.find((row) => {
    if (String(row.id || '') !== runId) return false;
    return matchesScopedRecord(row, scope);
  });
  if (!run) return { ok: false, status: 404, error: 'Run not found' };
  const checklist = Array.isArray(run.channelsChecklist) ? run.channelsChecklist : [];
  const channelRow = checklist.find((row) => normalizeChannelKey(row.channel) === channel);
  if (!channelRow) return { ok: false, status: 404, error: 'Channel checklist entry not found' };
  const steps = Array.isArray(channelRow.steps) ? channelRow.steps : [];
  const step = steps.find((row) => String(row.id || '') === stepId);
  if (!step) return { ok: false, status: 404, error: 'Checklist step not found' };
  step.done = doneInput === true;
  run.updatedAt = now;
  writeStoreSync(store);
  return { ok: true, status: 200, data: run };
}

module.exports = {
  STORE_FILE,
  addRun,
  listRuns,
  getLatestRun,
  updateChecklistStep,
};
