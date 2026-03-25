
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'api_settings.json');

const API_SCHEMAS = {
  supabase: {
    label: 'Supabase',
    fields: [
      { key: 'url', label: 'Project URL', required: true, secret: false },
      { key: 'service_role_key', label: 'Service Role Key', required: true, secret: true },
      { key: 'contacts_table', label: 'Contacts Table', required: false, secret: false },
      { key: 'promo_leads_table', label: 'Contacts Grid Table', required: false, secret: false },
      { key: 'promo_lead_fields_table', label: 'Contact Fields Table', required: false, secret: false },
      { key: 'harvest_youtube_details_table', label: 'Acquire YouTube Details Table', required: false, secret: false },
      { key: 'harvest_youtube_comments_table', label: 'Acquire YouTube Comments Table', required: false, secret: false },
      { key: 'harvest_youtube_videos_table', label: 'Acquire YouTube Videos Table', required: false, secret: false },
      { key: 'engage_youtube_comment_agents_table', label: 'Engage YouTube Comment Agents Table', required: false, secret: false },
      { key: 'messaging_emails_table', label: 'Messaging Emails Table', required: false, secret: false },
      { key: 'develop_email_templates_table', label: 'Develop Email Templates Table', required: false, secret: false }
    ]
  },
  anthropic: {
    label: 'Anthropic',
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true }
    ]
  },
  brave: {
    label: 'Brave Search',
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true }
    ]
  },
  exa: {
    label: 'Exa',
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true }
    ]
  },
  openai: {
    label: 'OpenAI',
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true }
    ]
  },
  linkedin: {
    label: 'LinkedIn',
    fields: [
      { key: 'client_id', label: 'Client ID', required: true, secret: true },
      { key: 'client_secret', label: 'Client Secret', required: true, secret: true },
      { key: 'access_token', label: 'Access Token', required: false, secret: true },
      { key: 'refresh_token', label: 'Refresh Token', required: false, secret: true },
      { key: 'organization_id', label: 'Organization ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  meta: {
    label: 'Meta',
    fields: [
      { key: 'app_id', label: 'App ID', required: true, secret: true },
      { key: 'app_secret', label: 'App Secret', required: true, secret: true },
      { key: 'access_token', label: 'Access Token', required: false, secret: true },
      { key: 'page_id', label: 'Page ID', required: false, secret: false },
      { key: 'instagram_account_id', label: 'Instagram Account ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  discord: {
    label: 'Discord',
    fields: [
      { key: 'bot_token', label: 'Bot Token', required: true, secret: true },
      { key: 'application_id', label: 'Application ID', required: false, secret: false },
      { key: 'public_key', label: 'Public Key', required: false, secret: true },
      { key: 'webhook_url', label: 'Webhook URL', required: false, secret: true },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  substack: {
    label: 'Substack',
    fields: [
      { key: 'publication_url', label: 'Publication URL', required: true, secret: false },
      { key: 'api_key', label: 'API Key', required: false, secret: true },
      { key: 'access_token', label: 'Access Token', required: false, secret: true },
      { key: 'publication_id', label: 'Publication ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  medium: {
    label: 'Medium',
    fields: [
      { key: 'integration_token', label: 'Integration Token', required: true, secret: true },
      { key: 'author_id', label: 'Author ID', required: false, secret: false },
      { key: 'publication_id', label: 'Publication ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  reddit: {
    label: 'Reddit',
    fields: [
      { key: 'client_id', label: 'Client ID', required: true, secret: true },
      { key: 'client_secret', label: 'Client Secret', required: true, secret: true },
      { key: 'refresh_token', label: 'Refresh Token', required: false, secret: true },
      { key: 'username', label: 'Username', required: false, secret: false },
      { key: 'user_agent', label: 'User Agent', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  instagram: {
    label: 'Instagram',
    fields: [
      { key: 'app_id', label: 'App ID', required: true, secret: true },
      { key: 'app_secret', label: 'App Secret', required: true, secret: true },
      { key: 'access_token', label: 'Access Token', required: false, secret: true },
      { key: 'business_account_id', label: 'Business Account ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  tiktok: {
    label: 'TikTok',
    fields: [
      { key: 'client_key', label: 'Client Key', required: true, secret: true },
      { key: 'client_secret', label: 'Client Secret', required: true, secret: true },
      { key: 'access_token', label: 'Access Token', required: false, secret: true },
      { key: 'open_id', label: 'Open ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  bluesky: {
    label: 'BlueSky',
    fields: [
      { key: 'identifier', label: 'Identifier', required: true, secret: false },
      { key: 'app_password', label: 'App Password', required: true, secret: true },
      { key: 'service_url', label: 'Service URL', required: false, secret: false }
    ]
  },
  mastodon: {
    label: 'Mastodon',
    fields: [
      { key: 'server_url', label: 'Server URL', required: true, secret: false },
      { key: 'access_token', label: 'Access Token', required: true, secret: true },
      { key: 'client_id', label: 'Client ID', required: false, secret: true },
      { key: 'client_secret', label: 'Client Secret', required: false, secret: true }
    ]
  },
  threads: {
    label: 'Threads',
    fields: [
      { key: 'app_id', label: 'App ID', required: true, secret: true },
      { key: 'app_secret', label: 'App Secret', required: true, secret: true },
      { key: 'access_token', label: 'Access Token', required: false, secret: true },
      { key: 'user_id', label: 'User ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  pinterest: {
    label: 'Pinterest',
    fields: [
      { key: 'app_id', label: 'App ID', required: true, secret: true },
      { key: 'app_secret', label: 'App Secret', required: true, secret: true },
      { key: 'access_token', label: 'Access Token', required: false, secret: true },
      { key: 'ad_account_id', label: 'Ad Account ID', required: false, secret: false },
      { key: 'board_id', label: 'Board ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  telegram: {
    label: 'Telegram',
    fields: [
      { key: 'bot_token', label: 'Bot Token', required: true, secret: true },
      { key: 'chat_id', label: 'Default Chat ID', required: false, secret: false },
      { key: 'webhook_url', label: 'Webhook URL', required: false, secret: true },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  slack: {
    label: 'Slack',
    fields: [
      { key: 'bot_token', label: 'Bot User OAuth Token', required: true, secret: true },
      { key: 'signing_secret', label: 'Signing Secret', required: false, secret: true },
      { key: 'app_token', label: 'App Token', required: false, secret: true },
      { key: 'default_channel', label: 'Default Channel', required: false, secret: false },
      { key: 'webhook_url', label: 'Webhook URL', required: false, secret: true }
    ]
  },
  whatsapp_business: {
    label: 'WhatsApp Business',
    fields: [
      { key: 'access_token', label: 'Access Token', required: true, secret: true },
      { key: 'phone_number_id', label: 'Phone Number ID', required: true, secret: false },
      { key: 'business_account_id', label: 'Business Account ID', required: false, secret: false },
      { key: 'app_secret', label: 'App Secret', required: false, secret: true },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  google_business_profile: {
    label: 'Google Business Profile',
    fields: [
      { key: 'client_id', label: 'Client ID', required: true, secret: true },
      { key: 'client_secret', label: 'Client Secret', required: true, secret: true },
      { key: 'refresh_token', label: 'Refresh Token', required: false, secret: true },
      { key: 'location_id', label: 'Location ID', required: false, secret: false },
      { key: 'account_id', label: 'Account ID', required: false, secret: false },
      { key: 'base_url', label: 'Endpoint URL', required: false, secret: false }
    ]
  },
  openclaw: {
    label: 'OpenClaw Gateway',
    fields: [
      { key: 'base_url', label: 'Gateway Base URL', required: true, secret: false },
      { key: 'api_key', label: 'Gateway API Key (optional)', required: false, secret: true },
      { key: 'timeout_ms', label: 'Timeout (ms)', required: false, secret: false }
    ]
  },
  transcriptapi: {
    label: 'TranscriptAPI',
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'base_url', label: 'Base URL', required: false, secret: false },
      { key: 'timeout_ms', label: 'Timeout (ms)', required: false, secret: false }
    ]
  },
  youtube: {
    label: 'YouTube Data API',
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true }
    ]
  },
  x: {
    label: 'X (Twitter)',
    fields: [
      { key: 'api_key', label: 'API Key', required: true, secret: true },
      { key: 'api_secret', label: 'API Secret', required: true, secret: true },
      { key: 'access_token', label: 'Access Token', required: true, secret: true },
      { key: 'access_token_secret', label: 'Access Token Secret', required: true, secret: true },
      { key: 'account_name', label: 'Account Name', required: false, secret: false }
    ]
  },
  google_drive: {
    label: 'Google Drive',
    fields: [
      { key: 'client_id', label: 'OAuth Client ID', required: true, secret: true },
      { key: 'client_secret', label: 'OAuth Client Secret', required: true, secret: true },
      { key: 'refresh_token', label: 'OAuth Refresh Token', required: true, secret: true },
      { key: 'root_folder_name', label: 'Root Folder Name', required: false, secret: false },
      { key: 'assets_folder_name', label: 'Assets Folder Name', required: false, secret: false }
    ]
  }
};

function normalizeKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function ensureStoreFile() {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ apis: {} }, null, 2), { mode: 0o600 });
    fs.chmodSync(SETTINGS_FILE, 0o600);
  }
}

function readStoreSync() {
  try {
    ensureStoreFile();
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { apis: {} };
    if (!parsed.apis || typeof parsed.apis !== 'object') parsed.apis = {};
    return parsed;
  } catch {
    return { apis: {} };
  }
}

function writeStoreSync(store) {
  try {
    ensureStoreFile();
    const tmp = `${SETTINGS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, SETTINGS_FILE);
    fs.chmodSync(SETTINGS_FILE, 0o600);
  } catch (err) {
    const e = err || new Error('Failed to write API settings');
    throw e;
  }
}

function maskValue(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function listApiSchemas() {
  return Object.entries(API_SCHEMAS).map(([provider, schema]) => ({
    provider,
    label: schema.label,
    fields: schema.fields.map((f) => ({
      key: f.key,
      label: f.label,
      required: !!f.required,
      secret: !!f.secret
    }))
  }));
}

function getProviderValues(provider) {
  const key = normalizeKey(provider);
  const store = readStoreSync();
  const node = store.apis[key];
  const storedValues = (node && typeof node === 'object' && typeof node.values === 'object')
    ? { ...node.values }
    : {};
  const envValues = getProviderEnvValues(key);
  // In serverless environments, persisted file values can be stale/read-only.
  // Prefer explicit env vars when present.
  const merged = { ...storedValues };
  for (const [k, v] of Object.entries(envValues)) {
    if (v) merged[k] = v;
  }
  return merged;
}

function listApiConfigsMasked() {
  const store = readStoreSync();
  return Object.entries(API_SCHEMAS).map(([provider, schema]) => {
    const node = store.apis[provider];
    const values = getProviderValues(provider);
    const maskedValues = {};
    schema.fields.forEach((field) => {
      const value = String(values[field.key] || '').trim();
      maskedValues[field.key] = field.secret ? maskValue(value) : value;
    });
    const configured = schema.fields.every((field) => {
      if (!field.required) return true;
      return String(values[field.key] || '').trim().length > 0;
    });
    return {
      provider,
      label: schema.label,
      configured,
      updatedAt: node?.updatedAt || null,
      values: maskedValues
    };
  });
}

function firstEnvValue(keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function getProviderEnvValues(provider) {
  const key = normalizeKey(provider);
  const out = {};
  const schema = API_SCHEMAS[key];

  // Generic convention fallback:
  //   <PROVIDER>_<FIELD>, uppercased (e.g. YOUTUBE_API_KEY, X_ACCESS_TOKEN).
  if (schema && Array.isArray(schema.fields)) {
    const prefix = String(key).toUpperCase();
    for (const field of schema.fields) {
      const fieldKey = String(field?.key || '').toUpperCase();
      if (!fieldKey) continue;
      const envName = `${prefix}_${fieldKey}`;
      const value = firstEnvValue([envName]);
      if (value) out[field.key] = value;
    }
  }

  if (key === 'openclaw') {
    out.base_url = firstEnvValue(['OPENCLAW_BASE_URL']);
    out.api_key = firstEnvValue(['OPENCLAW_API_KEY']);
    out.timeout_ms = firstEnvValue(['OPENCLAW_TIMEOUT_MS']);
    return out;
  }

  if (key === 'youtube') {
    out.api_key = firstEnvValue([
      'YOUTUBE_API_KEY',
      'YOUTUBE_DATA_API_KEY',
      'YOUTUBE_KEY',
      'YT_API_KEY',
      'YT_KEY',
      'GOOGLE_API_KEY',
      'GOOGLEAPI_KEY',
      'GCP_API_KEY'
    ]);
    return out;
  }

  if (key === 'x') {
    out.api_key = firstEnvValue(['X_API_KEY', 'TWITTER_API_KEY']);
    out.api_secret = firstEnvValue(['X_API_SECRET', 'TWITTER_API_SECRET']);
    out.access_token = firstEnvValue(['X_ACCESS_TOKEN', 'TWITTER_ACCESS_TOKEN']);
    out.access_token_secret = firstEnvValue(['X_ACCESS_TOKEN_SECRET', 'TWITTER_ACCESS_TOKEN_SECRET']);
    out.account_name = firstEnvValue(['X_ACCOUNT_NAME', 'TWITTER_ACCOUNT_NAME']);
    return out;
  }

  if (key === 'bluesky') {
    out.identifier = firstEnvValue(['BLUESKY_IDENTIFIER']);
    out.app_password = firstEnvValue(['BLUESKY_APP_PASSWORD']);
    out.service_url = firstEnvValue(['BLUESKY_SERVICE_URL']);
    return out;
  }

  if (key === 'reddit') {
    out.client_id = firstEnvValue(['REDDIT_CLIENT_ID']);
    out.client_secret = firstEnvValue(['REDDIT_CLIENT_SECRET']);
    out.refresh_token = firstEnvValue(['REDDIT_REFRESH_TOKEN']);
    out.username = firstEnvValue(['REDDIT_USERNAME']);
    out.user_agent = firstEnvValue(['REDDIT_USER_AGENT']);
    out.base_url = firstEnvValue(['REDDIT_BASE_URL']);
    return out;
  }

  if (key === 'telegram') {
    out.bot_token = firstEnvValue(['TELEGRAM_BOT_TOKEN']);
    out.chat_id = firstEnvValue(['TELEGRAM_CHAT_ID']);
    out.webhook_url = firstEnvValue(['TELEGRAM_WEBHOOK_URL']);
    out.base_url = firstEnvValue(['TELEGRAM_BASE_URL']);
    return out;
  }

  if (key === 'facebook') {
    out.app_id = firstEnvValue(['FACEBOOK_APP_ID', 'META_APP_ID']);
    out.app_secret = firstEnvValue(['FACEBOOK_APP_SECRET', 'META_APP_SECRET']);
    out.access_token = firstEnvValue(['FACEBOOK_ACCESS_TOKEN', 'META_ACCESS_TOKEN']);
    out.page_id = firstEnvValue(['FACEBOOK_PAGE_ID', 'META_PAGE_ID']);
    out.base_url = firstEnvValue(['FACEBOOK_BASE_URL']);
    return out;
  }

  if (key === 'meta') {
    out.app_id = firstEnvValue(['META_APP_ID', 'FACEBOOK_APP_ID']);
    out.app_secret = firstEnvValue(['META_APP_SECRET', 'FACEBOOK_APP_SECRET']);
    out.access_token = firstEnvValue(['META_ACCESS_TOKEN', 'FACEBOOK_ACCESS_TOKEN']);
    out.page_id = firstEnvValue(['META_PAGE_ID', 'FACEBOOK_PAGE_ID']);
    out.instagram_account_id = firstEnvValue(['META_INSTAGRAM_ACCOUNT_ID', 'INSTAGRAM_ACCOUNT_ID']);
    out.base_url = firstEnvValue(['META_BASE_URL', 'FACEBOOK_BASE_URL']);
    return out;
  }

  if (key === 'instagram') {
    out.app_id = firstEnvValue(['INSTAGRAM_APP_ID']);
    out.app_secret = firstEnvValue(['INSTAGRAM_APP_SECRET']);
    out.access_token = firstEnvValue(['INSTAGRAM_ACCESS_TOKEN']);
    out.business_account_id = firstEnvValue(['INSTAGRAM_BUSINESS_ACCOUNT_ID', 'INSTAGRAM_ACCOUNT_ID']);
    out.base_url = firstEnvValue(['INSTAGRAM_BASE_URL']);
    return out;
  }

  if (key === 'threads') {
    out.app_id = firstEnvValue(['THREADS_APP_ID']);
    out.app_secret = firstEnvValue(['THREADS_APP_SECRET']);
    out.access_token = firstEnvValue(['THREADS_ACCESS_TOKEN']);
    out.user_id = firstEnvValue(['THREADS_USER_ID']);
    out.base_url = firstEnvValue(['THREADS_BASE_URL']);
    return out;
  }

  if (key === 'supabase') {
    out.url = firstEnvValue(['SUPABASE_URL']);
    out.service_role_key = firstEnvValue(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY']);
    out.contacts_table = firstEnvValue(['SUPABASE_CONTACTS_TABLE']);
    out.promo_leads_table = firstEnvValue(['SUPABASE_PROMO_LEADS_TABLE']);
    out.promo_lead_fields_table = firstEnvValue(['SUPABASE_PROMO_LEAD_FIELDS_TABLE']);
    out.harvest_youtube_details_table = firstEnvValue(['SUPABASE_HARVEST_YOUTUBE_DETAILS_TABLE']);
    out.harvest_youtube_comments_table = firstEnvValue(['SUPABASE_HARVEST_YOUTUBE_COMMENTS_TABLE']);
    return out;
  }

  return out;
}

function upsertApiConfig(input) {
  const provider = normalizeKey(input.provider);
  if (!provider || !API_SCHEMAS[provider]) {
    return { ok: false, status: 400, error: 'Unsupported provider' };
  }
  const schema = API_SCHEMAS[provider];
  const rawValues = input && typeof input.values === 'object' ? input.values : {};
  const values = {};

  for (const field of schema.fields) {
    const value = String(rawValues[field.key] || '').trim();
    if (field.required && !value) {
      return { ok: false, status: 400, error: `${field.label} is required` };
    }
    if (value) values[field.key] = value;
  }

  const store = readStoreSync();
  store.apis[provider] = {
    provider,
    label: schema.label,
    values,
    updatedAt: new Date().toISOString()
  };
  try {
    writeStoreSync(store);
  } catch (err) {
    if (err && (err.code === 'EROFS' || /read-only file system/i.test(String(err.message || '')))) {
      return {
        ok: false,
        status: 409,
        error: 'This deployment is read-only. Set provider credentials in Vercel Project Environment Variables instead of saving in-app.',
      };
    }
    return { ok: false, status: 500, error: `Could not save API settings: ${String(err?.message || 'unknown error')}` };
  }

  return { ok: true, status: 200, data: { provider, label: schema.label } };
}

function getApiConfig(providerInput) {
  const provider = normalizeKey(providerInput);
  if (!provider || !API_SCHEMAS[provider]) {
    return { ok: false, status: 400, error: 'Unsupported provider' };
  }
  const schema = API_SCHEMAS[provider];
  const values = getProviderValues(provider);
  return {
    ok: true,
    status: 200,
    data: {
      provider,
      label: schema.label,
      values
    }
  };
}

function deleteApiConfig(providerInput) {
  const provider = normalizeKey(providerInput);
  if (!provider || !API_SCHEMAS[provider]) {
    return { ok: false, status: 400, error: 'Unsupported provider' };
  }
  const store = readStoreSync();
  if (!store.apis[provider]) {
    return { ok: false, status: 404, error: 'Provider config not found' };
  }
  delete store.apis[provider];
  try {
    writeStoreSync(store);
  } catch (err) {
    if (err && (err.code === 'EROFS' || /read-only file system/i.test(String(err.message || '')))) {
      return {
        ok: false,
        status: 409,
        error: 'This deployment is read-only. Remove provider credentials from Vercel Project Environment Variables instead.',
      };
    }
    return { ok: false, status: 500, error: `Could not delete API settings: ${String(err?.message || 'unknown error')}` };
  }
  return { ok: true, status: 200, data: { deleted: true, provider } };
}

module.exports = {
  SETTINGS_FILE,
  listApiSchemas,
  listApiConfigsMasked,
  getProviderValues,
  upsertApiConfig,
  getApiConfig,
  deleteApiConfig
};
