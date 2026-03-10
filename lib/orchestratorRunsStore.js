const fs = require('fs');
const path = require('path');
const { listApiConfigsMasked } = require('./apiSettings');

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
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ runs: [] }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
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
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
  fs.chmodSync(STORE_FILE, 0o600);
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

function addRun(recordInput) {
  const store = readStoreSync();
  const record = createRunRecord(recordInput || {});
  store.runs.unshift(record);
  if (store.runs.length > MAX_RUNS) store.runs = store.runs.slice(0, MAX_RUNS);
  writeStoreSync(store);
  return record;
}

function listRuns(limit = 20) {
  const store = readStoreSync();
  const max = Math.max(1, Math.min(Number(limit) || 20, 100));
  return store.runs.slice(0, max);
}

function getLatestRun() {
  const runs = listRuns(1);
  return runs.length ? runs[0] : null;
}

function updateChecklistStep(runIdInput, channelInput, stepIdInput, doneInput) {
  const runId = String(runIdInput || '').trim();
  const channel = normalizeChannelKey(channelInput);
  const stepId = String(stepIdInput || '').trim();
  if (!runId || !channel || !stepId) {
    return { ok: false, status: 400, error: 'run_id, channel, and step_id are required' };
  }
  const store = readStoreSync();
  const run = store.runs.find((row) => String(row.id || '') === runId);
  if (!run) return { ok: false, status: 404, error: 'Run not found' };
  const checklist = Array.isArray(run.channelsChecklist) ? run.channelsChecklist : [];
  const channelRow = checklist.find((row) => normalizeChannelKey(row.channel) === channel);
  if (!channelRow) return { ok: false, status: 404, error: 'Channel checklist entry not found' };
  const steps = Array.isArray(channelRow.steps) ? channelRow.steps : [];
  const step = steps.find((row) => String(row.id || '') === stepId);
  if (!step) return { ok: false, status: 404, error: 'Checklist step not found' };
  step.done = doneInput === true;
  run.updatedAt = new Date().toISOString();
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
