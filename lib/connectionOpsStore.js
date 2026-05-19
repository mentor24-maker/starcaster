const fs = require('fs');
const path = require('path');
const { getProviderValues } = require('./apiSettings');
const { sbQuery, isConfigured: isSupabaseConfigured, tableConfig } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile, isLocalJsonFsWritable } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'connection_ops.json');
const MAX_ATTEMPTS = 200;
const MEMORY_NODES = new Map();
const SUPPORT_CACHE = { value: null };

const PLATFORM_SPECS = {
  x: {
    label: 'X',
    provider: 'x',
    requiredLocalFields: ['api_key', 'api_secret', 'access_token', 'access_token_secret'],
    recommendedLocalFields: ['account_name'],
    humanGates: [
      { key: 'developer_app_ready', label: 'X developer app is active with write access' },
      { key: 'saved_credentials', label: 'Saved API key/secret + access token/secret in APP' },
      { key: 'auth_check_passed', label: 'Auth check passed' },
      { key: 'completed_smoke_test', label: 'Completed post smoke test from Promote > Social' },
    ],
    playbook: [
      {
        code: 'X_AUTH_FAILED',
        title: 'X auth test failed',
        likelyCause: 'Token pair is invalid, expired, or mismatched with app key/secret.',
        fixSteps: [
          'Regenerate user access token/secret in X developer portal.',
          'Re-save all four X fields in Settings > APIs > X.',
          'Run X auth test again.',
        ],
        portalUrl: 'https://developer.x.com/en/portal/dashboard',
      },
      {
        code: 'X_ACCESS_TIER_BLOCKED',
        title: 'Access tier does not include posting endpoint',
        likelyCause: 'Current product/access tier does not permit tweet create endpoint.',
        fixSteps: [
          'Review product access level in X developer portal.',
          'Upgrade/change tier if posting endpoint is required.',
          'Regenerate access token after permission changes.',
        ],
        portalUrl: 'https://developer.x.com/en/portal/product',
      },
    ],
  },
  facebook: {
    label: 'Facebook',
    provider: 'meta',
    requiredLocalFields: ['access_token', 'page_id'],
    recommendedLocalFields: ['app_id', 'app_secret'],
    humanGates: [
      { key: 'meta_app_ready', label: 'Meta app is configured for Facebook Page publishing' },
      { key: 'saved_credentials', label: 'Saved page access_token and page_id in APP' },
      { key: 'auth_check_passed', label: 'Auth check passed (page lookup)' },
      { key: 'completed_smoke_test', label: 'Completed post smoke test from Promote > Social' },
    ],
    playbook: [
      {
        code: 'FACEBOOK_401',
        title: 'Unauthorized (401)',
        likelyCause: 'Page access token is invalid/expired.',
        fixSteps: [
          'Generate a fresh long-lived Page token in Meta tools.',
          'Save updated token in Settings > APIs > Meta.',
          'Run Facebook auth test again.',
        ],
        portalUrl: 'https://developers.facebook.com/tools/explorer/',
      },
      {
        code: 'FACEBOOK_PERMISSION_DENIED',
        title: 'Permission denied',
        likelyCause: 'Token lacks required Page publish permission.',
        fixSteps: [
          'Confirm app has required permissions and user/page role.',
          'Re-consent and regenerate token.',
        ],
        portalUrl: 'https://developers.facebook.com/apps/',
      },
    ],
  },
  instagram: {
    label: 'Instagram',
    provider: 'instagram',
    requiredLocalFields: ['access_token', 'business_account_id'],
    recommendedLocalFields: ['app_id', 'app_secret'],
    humanGates: [
      { key: 'professional_account_ready', label: 'Instagram account is Professional and linked to a Page' },
      { key: 'saved_credentials', label: 'Saved access_token and business_account_id in APP' },
      { key: 'auth_check_passed', label: 'Auth check passed (IG user lookup)' },
      { key: 'completed_smoke_test', label: 'Completed image post smoke test from Promote > Social' },
    ],
    playbook: [
      {
        code: 'INSTAGRAM_IMAGE_REQUIRED',
        title: 'Image URL required',
        likelyCause: 'Instagram publish endpoint requires image/video media.',
        fixSteps: [
          'Set a campaign primary image before posting.',
          'Retry publish from Promote > Social.',
        ],
        portalUrl: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
      },
      {
        code: 'INSTAGRAM_401',
        title: 'Unauthorized (401)',
        likelyCause: 'Instagram token is invalid/expired or missing permissions.',
        fixSteps: [
          'Regenerate token and verify account linkage.',
          'Save new token and rerun auth test.',
        ],
        portalUrl: 'https://developers.facebook.com/tools/explorer/',
      },
    ],
  },
  threads: {
    label: 'Threads',
    provider: 'threads',
    requiredLocalFields: ['access_token', 'user_id'],
    recommendedLocalFields: ['app_id', 'app_secret'],
    humanGates: [
      { key: 'threads_app_ready', label: 'Threads API access is enabled in Meta app' },
      { key: 'saved_credentials', label: 'Saved access_token and user_id in APP' },
      { key: 'auth_check_passed', label: 'Auth check passed (Threads user lookup)' },
      { key: 'completed_smoke_test', label: 'Completed post smoke test from Promote > Social' },
    ],
    playbook: [
      {
        code: 'THREADS_401',
        title: 'Unauthorized (401)',
        likelyCause: 'Threads token invalid/expired or scope missing.',
        fixSteps: [
          'Re-consent Threads scopes and regenerate token.',
          'Save token and rerun auth test.',
        ],
        portalUrl: 'https://developers.facebook.com/docs/threads',
      },
    ],
  },
  telegram: {
    label: 'Telegram',
    provider: 'telegram',
    requiredLocalFields: ['bot_token'],
    recommendedLocalFields: ['chat_id'],
    humanGates: [
      { key: 'created_botfather_bot', label: 'Created bot in BotFather' },
      { key: 'saved_bot_token', label: 'Saved bot token in APP' },
      { key: 'sent_first_message', label: 'Sent first message to bot in Telegram' },
      { key: 'captured_chat_id', label: 'Captured chat_id via getUpdates' },
      { key: 'completed_smoke_test', label: 'Completed smoke test from APP' },
    ],
    playbook: [
      {
        code: 'MISSING_BOT_TOKEN',
        title: 'Bot token missing',
        likelyCause: 'Bot token not generated or not saved to Settings > APIs.',
        fixSteps: [
          'Open @BotFather and run /newbot (or /token).',
          'Copy token and save it under Settings > APIs > Telegram.',
        ],
        portalUrl: 'https://t.me/BotFather',
      },
      {
        code: 'CHAT_ID_NOT_FOUND',
        title: 'chat_id missing',
        likelyCause: 'No message has been sent to the bot yet, so update stream is empty.',
        fixSteps: [
          'Send any message to your bot from the target Telegram account/channel.',
          'Open https://api.telegram.org/bot<TOKEN>/getUpdates and copy chat.id.',
          'Save chat_id in Settings > APIs > Telegram.',
        ],
        portalUrl: 'https://core.telegram.org/bots/api#getupdates',
      },
      {
        code: 'TELEGRAM_401',
        title: 'Unauthorized (401)',
        likelyCause: 'Invalid bot token or token revoked.',
        fixSteps: [
          'Regenerate bot token in BotFather via /token.',
          'Update Settings > APIs > Telegram with the new value.',
        ],
        portalUrl: 'https://t.me/BotFather',
      },
      {
        code: 'TELEGRAM_403',
        title: 'Forbidden (403)',
        likelyCause: 'Bot lacks permission or was blocked by user/channel.',
        fixSteps: [
          'Ensure bot is added to target group/channel with posting permission.',
          'Ensure user has started chat with the bot in direct-message flow.',
        ],
        portalUrl: 'https://core.telegram.org/bots',
      },
      {
        code: 'NETWORK_TIMEOUT',
        title: 'Network/timeout failure',
        likelyCause: 'Temporary upstream issue or connectivity problem.',
        fixSteps: [
          'Retry after 1-5 minutes.',
          'Confirm local network access and rerun diagnostics.',
        ],
        portalUrl: 'https://core.telegram.org/bots/api',
      },
    ],
  },
  reddit: {
    label: 'Reddit',
    provider: 'reddit',
    requiredLocalFields: ['client_id', 'client_secret'],
    recommendedLocalFields: ['refresh_token', 'user_agent', 'username'],
    humanGates: [
      { key: 'developer_account_ready', label: 'Developer account is active (not stuck in captcha loop)' },
      { key: 'app_created', label: 'Created app at Reddit app preferences' },
      { key: 'saved_client_credentials', label: 'Saved client_id and client_secret in APP' },
      { key: 'generated_refresh_token', label: 'Generated and saved refresh_token' },
      { key: 'auth_check_passed', label: 'Auth check passed (/api/v1/me)' },
    ],
    playbook: [
      {
        code: 'CAPTCHA_LOOP',
        title: 'Create app form loops on captcha',
        likelyCause: 'Reddit anti-abuse check/session state or browser extension interference.',
        fixSteps: [
          'Clear reddit.com cookies and disable ad/privacy extensions for reddit.com.',
          'Retry from an already logged-in normal window (not private window if login fails there).',
          'If blocked, wait 10-30 minutes and retry once.',
        ],
        portalUrl: 'https://www.reddit.com/prefs/apps',
      },
      {
        code: 'NETWORK_SECURITY_BLOCKED',
        title: 'Blocked by network security',
        likelyCause: 'IP/network reputation is temporarily blocked upstream before app creation logic runs.',
        fixSteps: [
          'Retry from a different network (mobile hotspot) using a clean browser profile.',
          'Attempt app creation once at old.reddit.com/prefs/apps, then stop repeated retries.',
          'File support ticket with timestamp, blocked URL, account name, and public IP.',
          'Keep APP credentials pending until Reddit clears the network block.',
        ],
        portalUrl: 'https://support.reddithelp.com/hc/en-us/requests/new',
      },
      {
        code: 'MISSING_CLIENT_KEYS',
        title: 'Missing client_id/client_secret',
        likelyCause: 'App not created successfully or values copied from wrong screen.',
        fixSteps: [
          'Open app preferences and locate your app card.',
          'Copy app ID (under app name) as client_id and secret as client_secret.',
          'Save both in Settings > APIs > Reddit.',
        ],
        portalUrl: 'https://www.reddit.com/prefs/apps',
      },
      {
        code: 'MISSING_REFRESH_TOKEN',
        title: 'Refresh token missing',
        likelyCause: 'OAuth auth-code exchange not completed.',
        fixSteps: [
          'Run OAuth auth-code flow with scope(s) needed for posting/commenting.',
          'Exchange code for refresh_token and save in Settings > APIs > Reddit.',
        ],
        portalUrl: 'https://github.com/reddit-archive/reddit/wiki/OAuth2',
      },
      {
        code: 'REDDIT_401',
        title: 'Unauthorized (401)',
        likelyCause: 'Invalid/revoked refresh token or mismatched client credentials.',
        fixSteps: [
          'Regenerate refresh token using same app credentials.',
          'Re-save client_id/client_secret/refresh_token and retry auth check.',
        ],
        portalUrl: 'https://www.reddit.com/prefs/apps',
      },
      {
        code: 'SCOPE_INSUFFICIENT',
        title: 'Insufficient scope for endpoint',
        likelyCause: 'Refresh token was minted without required scopes.',
        fixSteps: [
          'Reauthorize app requesting needed scopes (e.g. identity, read, submit).',
          'Exchange code again and replace refresh_token in APP.',
        ],
        portalUrl: 'https://www.reddit.com/dev/api/',
      },
    ],
  },
  bluesky: {
    label: 'Bluesky',
    provider: 'bluesky',
    requiredLocalFields: ['identifier', 'app_password'],
    recommendedLocalFields: ['service_url'],
    humanGates: [
      { key: 'account_ready', label: 'Bluesky account is active' },
      { key: 'created_app_password', label: 'Created app password in Bluesky settings' },
      { key: 'saved_credentials', label: 'Saved identifier and app password in APP' },
      { key: 'auth_check_passed', label: 'Session/auth check passed' },
      { key: 'completed_smoke_test', label: 'Completed post smoke test from Promote > Social' },
    ],
    playbook: [
      {
        code: 'MISSING_IDENTIFIER',
        title: 'Identifier missing',
        likelyCause: 'Handle/email not saved in Settings > APIs > Bluesky.',
        fixSteps: [
          'Use your Bluesky handle (e.g. name.bsky.social) or login email as identifier.',
          'Save identifier in Settings > APIs > Bluesky.',
        ],
        portalUrl: 'https://bsky.app/settings',
      },
      {
        code: 'MISSING_APP_PASSWORD',
        title: 'App password missing',
        likelyCause: 'No app password generated yet (main account password will not work here).',
        fixSteps: [
          'Open Bluesky App Passwords and create a new app password.',
          'Copy and save it in Settings > APIs > Bluesky.',
        ],
        portalUrl: 'https://bsky.app/settings/app-passwords',
      },
      {
        code: 'BLUESKY_401',
        title: 'Unauthorized (401)',
        likelyCause: 'Invalid identifier/app password pair or revoked app password.',
        fixSteps: [
          'Create a fresh app password and replace the old value in APP.',
          'Confirm identifier matches the same account used to create app password.',
        ],
        portalUrl: 'https://bsky.app/settings/app-passwords',
      },
      {
        code: 'BLUESKY_RATE_LIMIT',
        title: 'Rate limited / upstream busy',
        likelyCause: 'Temporary service throttling.',
        fixSteps: [
          'Wait 1-5 minutes and retry once.',
          'Avoid rapid repeated publishes while testing.',
        ],
        portalUrl: 'https://status.bsky.app/',
      },
    ],
  },
};

function normalizeScope(scope) {
  return {
    projectId: String(scope?.projectId || scope?.project_id || '').trim(),
    userId: String(scope?.userId || scope?.user_id || '').trim(),
  };
}

function memoryKey(scope, platform) {
  const { projectId } = normalizeScope(scope);
  return `${projectId || '_global'}::${normalizePlatform(platform)}`;
}

function connectionOpsTable() {
  return tableConfig().connectionOpsState;
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsSupabaseConnectionOps() {
  if (!isSupabaseConfigured()) return false;
  if (SUPPORT_CACHE.value !== null) return SUPPORT_CACHE.value;
  const table = connectionOpsTable();
  const probe = await sbQuery({ table, query: 'select=project_id&limit=1' });
  SUPPORT_CACHE.value = probe.ok || !isMissingTableError(probe.error);
  return SUPPORT_CACHE.value;
}

function defaultNode() {
  return {
    gates: {},
    attempts: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeNode(input) {
  const node = input && typeof input === 'object' ? input : defaultNode();
  if (!node.gates || typeof node.gates !== 'object') node.gates = {};
  if (!Array.isArray(node.attempts)) node.attempts = [];
  if (!node.updatedAt) node.updatedAt = new Date().toISOString();
  return node;
}

function rowToNode(row) {
  if (!row || typeof row !== 'object') return defaultNode();
  return normalizeNode({
    gates: row.gates,
    attempts: row.attempts,
    updatedAt: row.updated_at || row.updatedAt,
  });
}

function readLegacyFileStore() {
  try {
    ensureJsonFile(STORE_FILE, { platforms: {} }, { mode: 0o600 });
    if (!fs.existsSync(STORE_FILE)) return { platforms: {} };
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { platforms: {} };
    if (!parsed.platforms || typeof parsed.platforms !== 'object') parsed.platforms = {};
    return parsed;
  } catch {
    return { platforms: {} };
  }
}

function writeLegacyFileStore(store) {
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

async function loadPlatformNode(platformInput, scope = null) {
  const platform = normalizePlatform(platformInput);
  const { projectId } = normalizeScope(scope);
  const key = memoryKey(scope, platform);

  if (projectId && (await supportsSupabaseConnectionOps())) {
    const table = connectionOpsTable();
    const result = await sbQuery({
      table,
      query: `select=gates,attempts,updated_at&project_id=eq.${encodeURIComponent(projectId)}&platform=eq.${encodeURIComponent(platform)}&limit=1`,
    });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : null;
      const node = row ? rowToNode(row) : defaultNode();
      MEMORY_NODES.set(key, node);
      return node;
    }
    if (!isMissingTableError(result.error)) {
      const cached = MEMORY_NODES.get(key);
      if (cached) return normalizeNode(cached);
      return defaultNode();
    }
  }

  const cached = MEMORY_NODES.get(key);
  if (cached) return normalizeNode(cached);

  if (!projectId) {
    const legacy = readLegacyFileStore();
    const legacyNode = legacy.platforms?.[platform];
    if (legacyNode) return normalizeNode(legacyNode);
  }

  return defaultNode();
}

async function savePlatformNode(platformInput, scope, nodeInput) {
  const platform = normalizePlatform(platformInput);
  const { projectId } = normalizeScope(scope);
  const key = memoryKey(scope, platform);
  const node = normalizeNode(nodeInput);
  node.updatedAt = new Date().toISOString();
  MEMORY_NODES.set(key, node);

  if (projectId && (await supportsSupabaseConnectionOps())) {
    const table = connectionOpsTable();
    const result = await sbQuery({
      method: 'POST',
      table,
      query: 'on_conflict=project_id,platform&select=project_id,platform,gates,attempts,updated_at',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [{
        project_id: projectId,
        platform,
        gates: node.gates,
        attempts: node.attempts,
        updated_at: node.updatedAt,
      }],
    });
    if (result.ok) return node;
    if (!isMissingTableError(result.error)) return node;
  }

  if (!projectId && isLocalJsonFsWritable()) {
    const store = readLegacyFileStore();
    store.platforms[platform] = node;
    writeLegacyFileStore(store);
  }

  return node;
}

function normalizePlatform(input) {
  return String(input || '').trim().toLowerCase();
}

function listSupportedPlatforms() {
  return Object.entries(PLATFORM_SPECS).map(([key, spec]) => ({
    key,
    label: spec.label,
    provider: spec.provider,
  }));
}

function computeReadiness(platform, node, values) {
  const spec = PLATFORM_SPECS[platform];
  const reqFields = spec.requiredLocalFields || [];
  const recFields = spec.recommendedLocalFields || [];
  const gates = spec.humanGates || [];

  const requiredPresent = reqFields.every((key) => String(values?.[key] || '').trim());
  const reqPct = reqFields.length
    ? Math.round((reqFields.filter((key) => String(values?.[key] || '').trim()).length / reqFields.length) * 100)
    : 100;
  const recPct = recFields.length
    ? Math.round((recFields.filter((key) => String(values?.[key] || '').trim()).length / recFields.length) * 100)
    : 100;
  const completedGates = gates.filter((gate) => node?.gates?.[gate.key] === true).length;
  const gatePct = gates.length ? Math.round((completedGates / gates.length) * 100) : 100;

  // Score composition: local credential readiness (60) + human gates (40)
  const score = Math.round((reqPct * 0.5) + (recPct * 0.1) + (gatePct * 0.4));

  let level = 'red';
  if (requiredPresent && gatePct >= 80) level = 'green';
  else if (requiredPresent) level = 'yellow';

  return {
    score,
    level,
    requiredPresent,
    reqPct,
    recPct,
    gatePct,
    completedGates,
    totalGates: gates.length,
  };
}

function computeNextAction(platform, readiness, values, gates) {
  if (platform === 'x') {
    if (!String(values?.api_key || '').trim() || !String(values?.api_secret || '').trim()) {
      return 'Save API key and API secret in Settings > APIs > X.';
    }
    if (!String(values?.access_token || '').trim() || !String(values?.access_token_secret || '').trim()) {
      return 'Save access token and access token secret in Settings > APIs > X.';
    }
    if (!gates?.saved_credentials) return 'Mark "Saved credentials" gate complete.';
    if (!gates?.auth_check_passed) return 'Run X auth check and mark it complete.';
    if (!gates?.completed_smoke_test) return 'Run X smoke post from Promote > Social.';
    if (readiness.level === 'green') return 'Ready for X posting workflows.';
  }
  if (platform === 'facebook') {
    if (!String(values?.access_token || '').trim() || !String(values?.page_id || '').trim()) {
      return 'Save Facebook page access_token and page_id in Settings > APIs > Meta.';
    }
    if (!gates?.saved_credentials) return 'Mark "Saved credentials" gate complete.';
    if (!gates?.auth_check_passed) return 'Run Facebook auth check and mark it complete.';
    if (!gates?.completed_smoke_test) return 'Run Facebook smoke post from Promote > Social.';
    if (readiness.level === 'green') return 'Ready for Facebook publishing.';
  }
  if (platform === 'instagram') {
    if (!String(values?.access_token || '').trim() || !String(values?.business_account_id || '').trim()) {
      return 'Save Instagram access_token and business_account_id in Settings > APIs > Instagram.';
    }
    if (!gates?.saved_credentials) return 'Mark "Saved credentials" gate complete.';
    if (!gates?.auth_check_passed) return 'Run Instagram auth check and mark it complete.';
    if (!gates?.completed_smoke_test) return 'Run Instagram smoke post (with image) from Promote > Social.';
    if (readiness.level === 'green') return 'Ready for Instagram publishing.';
  }
  if (platform === 'threads') {
    if (!String(values?.access_token || '').trim() || !String(values?.user_id || '').trim()) {
      return 'Save Threads access_token and user_id in Settings > APIs > Threads.';
    }
    if (!gates?.saved_credentials) return 'Mark "Saved credentials" gate complete.';
    if (!gates?.auth_check_passed) return 'Run Threads auth check and mark it complete.';
    if (!gates?.completed_smoke_test) return 'Run Threads smoke post from Promote > Social.';
    if (readiness.level === 'green') return 'Ready for Threads publishing.';
  }
  if (platform === 'telegram') {
    if (!String(values?.bot_token || '').trim()) {
      return 'Create bot in BotFather, then save bot_token in Settings > APIs > Telegram.';
    }
    if (!gates?.created_botfather_bot) return 'Mark "Created bot in BotFather" gate complete.';
    if (!gates?.saved_bot_token) return 'Mark "Saved bot token in APP" gate complete.';
    if (!gates?.sent_first_message) return 'Send a first message to the bot from target account.';
    if (!String(values?.chat_id || '').trim()) return 'Capture chat_id from getUpdates and save it in Settings > APIs.';
    if (!gates?.captured_chat_id) return 'Mark "Captured chat_id" gate complete.';
    if (!gates?.completed_smoke_test) return 'Run smoke test and mark completion.';
    if (readiness.level === 'green') return 'Ready to send Telegram post from Promote flow.';
  }
  if (platform === 'reddit') {
    if (!gates?.developer_account_ready) {
      return 'Confirm Reddit developer account flow is working and app creation page is usable.';
    }
    if (!gates?.app_created) {
      return 'Create Reddit app at /prefs/apps and capture client_id + client_secret.';
    }
    if (!String(values?.client_id || '').trim() || !String(values?.client_secret || '').trim()) {
      return 'Save client_id and client_secret in Settings > APIs > Reddit.';
    }
    if (!gates?.saved_client_credentials) return 'Mark "Saved client credentials" gate complete.';
    if (!String(values?.refresh_token || '').trim()) {
      return 'Generate OAuth refresh_token and save it in Settings > APIs > Reddit.';
    }
    if (!gates?.generated_refresh_token) return 'Mark "Generated refresh token" gate complete.';
    if (!gates?.auth_check_passed) return 'Run Reddit auth check and mark it complete.';
    if (readiness.level === 'green') return 'Ready for Reddit posting workflows.';
  }
  if (platform === 'bluesky') {
    if (!gates?.account_ready) return 'Confirm Bluesky account is active and login works.';
    if (!gates?.created_app_password) return 'Create an app password in Bluesky settings.';
    if (!String(values?.identifier || '').trim() || !String(values?.app_password || '').trim()) {
      return 'Save identifier and app_password in Settings > APIs > Bluesky.';
    }
    if (!gates?.saved_credentials) return 'Mark "Saved credentials" gate complete.';
    if (!gates?.auth_check_passed) return 'Run Bluesky auth check and mark it complete.';
    if (!gates?.completed_smoke_test) return 'Send a Bluesky smoke post from Promote > Social.';
    if (readiness.level === 'green') return 'Ready for Bluesky publishing.';
  }
  return 'Continue with next incomplete setup step.';
}

async function getConnectionOps(platformInput, scope = null) {
  const platform = normalizePlatform(platformInput);
  const spec = PLATFORM_SPECS[platform];
  if (!spec) return { ok: false, status: 400, error: 'Unsupported platform' };

  const node = await loadPlatformNode(platform, scope);
  const values = getProviderValues(spec.provider);
  const readiness = computeReadiness(platform, node, values);
  const gates = (spec.humanGates || []).map((gate) => ({
    ...gate,
    done: node.gates?.[gate.key] === true,
  }));
  const nextAction = computeNextAction(platform, readiness, values, node.gates || {});
  const attempts = [...node.attempts].sort((a, b) => {
    const ta = Date.parse(String(a?.createdAt || '')) || 0;
    const tb = Date.parse(String(b?.createdAt || '')) || 0;
    return tb - ta;
  });
  const latestAttempt = attempts[0] || null;

  return {
    ok: true,
    status: 200,
    data: {
      platform,
      label: spec.label,
      provider: spec.provider,
      readiness,
      nextAction,
      gates,
      playbook: spec.playbook || [],
      latestAttempt,
      attempts,
      providerTest: null,
    },
  };
}

async function updateGate(platformInput, gateKeyInput, doneInput, scope = null) {
  const platform = normalizePlatform(platformInput);
  const spec = PLATFORM_SPECS[platform];
  if (!spec) return { ok: false, status: 400, error: 'Unsupported platform' };
  const gateKey = String(gateKeyInput || '').trim();
  const gateExists = (spec.humanGates || []).some((gate) => gate.key === gateKey);
  if (!gateExists) return { ok: false, status: 400, error: 'Unsupported gate key' };

  const node = await loadPlatformNode(platform, scope);
  node.gates[gateKey] = doneInput === true;
  await savePlatformNode(platform, scope, node);
  return getConnectionOps(platform, scope);
}

async function addAttempt(platformInput, input = {}, scope = null) {
  const platform = normalizePlatform(platformInput);
  const spec = PLATFORM_SPECS[platform];
  if (!spec) return { ok: false, status: 400, error: 'Unsupported platform' };

  const status = String(input.status || '').trim().toLowerCase();
  const allowed = new Set(['success', 'blocked', 'in_progress', 'info']);
  if (!allowed.has(status)) return { ok: false, status: 400, error: 'Unsupported attempt status' };

  const node = await loadPlatformNode(platform, scope);
  const attempt = {
    id: `cop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status,
    blockerCode: String(input.blocker_code || input.blockerCode || '').trim(),
    summary: String(input.summary || '').trim(),
    details: String(input.details || '').trim(),
  };
  node.attempts.unshift(attempt);
  if (node.attempts.length > MAX_ATTEMPTS) node.attempts = node.attempts.slice(0, MAX_ATTEMPTS);
  await savePlatformNode(platform, scope, node);
  return getConnectionOps(platform, scope);
}

module.exports = {
  listSupportedPlatforms,
  getConnectionOps,
  updateGate,
  addAttempt,
};
