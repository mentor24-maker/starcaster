'use strict';

const crypto = require('crypto');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { encryptSecret, decryptSecret } = require('./channelsCipher');

const PROVIDER_FACEBOOK_PAGE = 'facebook_page';
const MEMORY_CREDS = new Map();
const MEMORY_HANDOFFS = new Map();
const SUPPORT_CACHE = { credentials: null, handoffs: null };

function t() { return tableConfig(); }

function safeText(value) {
  return String(value || '').trim();
}

function memoryCredsKey(projectId) {
  return `${safeText(projectId)}:${PROVIDER_FACEBOOK_PAGE}`;
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsCredentialsTable() {
  if (!isSupabaseConfigured()) return false;
  if (SUPPORT_CACHE.credentials !== null) return SUPPORT_CACHE.credentials;
  const probe = await sbQuery({
    table: t().projectSocialCredentials,
    query: 'select=project_id&limit=1',
  });
  SUPPORT_CACHE.credentials = probe.ok || !isMissingTableError(probe.error);
  return SUPPORT_CACHE.credentials;
}

async function supportsHandoffsTable() {
  if (!isSupabaseConfigured()) return false;
  if (SUPPORT_CACHE.handoffs !== null) return SUPPORT_CACHE.handoffs;
  const probe = await sbQuery({
    table: t().projectOauthHandoffs,
    query: 'select=id&limit=1',
  });
  SUPPORT_CACHE.handoffs = probe.ok || !isMissingTableError(probe.error);
  return SUPPORT_CACHE.handoffs;
}

function rowToCredential(row) {
  if (!row) return null;
  const tokenRes = decryptSecret({
    password_enc: row.access_token_enc,
    password_iv: row.access_token_iv,
    password_tag: row.access_token_tag,
  });
  const accessToken = tokenRes.ok ? safeText(tokenRes.data?.plaintext) : '';
  return {
    projectId: safeText(row.project_id),
    provider: safeText(row.provider) || PROVIDER_FACEBOOK_PAGE,
    pageId: safeText(row.page_id),
    pageName: safeText(row.page_name),
    accessToken,
    connectedAt: safeText(row.connected_at),
    updatedAt: safeText(row.updated_at),
    hasAccessToken: Boolean(accessToken),
  };
}

async function getFacebookPage(projectId) {
  const pid = safeText(projectId);
  if (!pid) return null;

  if (await supportsCredentialsTable()) {
    const res = await sbQuery({
      table: t().projectSocialCredentials,
      query: `select=project_id,provider,page_id,page_name,access_token_enc,access_token_iv,access_token_tag,connected_at,updated_at&project_id=eq.${encodeURIComponent(pid)}&provider=eq.${encodeURIComponent(PROVIDER_FACEBOOK_PAGE)}&limit=1`,
    });
    if (res.ok) {
      const row = Array.isArray(res.data) ? res.data[0] : null;
      const cred = rowToCredential(row);
      if (cred) {
        MEMORY_CREDS.set(memoryCredsKey(pid), cred);
        return cred;
      }
      return null;
    }
    if (!isMissingTableError(res.error)) {
      const cached = MEMORY_CREDS.get(memoryCredsKey(pid));
      return cached || null;
    }
  }

  return MEMORY_CREDS.get(memoryCredsKey(pid)) || null;
}

async function saveFacebookPage(projectId, input = {}) {
  const pid = safeText(projectId);
  const pageId = safeText(input.pageId || input.page_id);
  const pageName = safeText(input.pageName || input.page_name);
  const accessToken = safeText(input.accessToken || input.access_token);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };
  if (!pageId || !accessToken) {
    return { ok: false, status: 400, error: 'pageId and accessToken are required' };
  }

  const enc = encryptSecret(accessToken);
  if (!enc.ok) return { ok: false, status: 500, error: enc.error };

  const tableAvailable = await supportsCredentialsTable();
  if (isSupabaseConfigured() && !tableAvailable) {
    // Supabase is set up but this specific table is missing — almost certainly
    // an unapplied migration (docs/SQL/project_social_credentials_setup.sql).
    // Falling back to in-memory storage here would report success while the
    // connection silently evaporates on the next serverless invocation.
    return {
      ok: false,
      status: 500,
      error: 'project_social_credentials table is missing. Run docs/SQL/project_social_credentials_setup.sql in Supabase before connecting a Facebook Page.',
    };
  }

  const now = new Date().toISOString();
  const cred = {
    projectId: pid,
    provider: PROVIDER_FACEBOOK_PAGE,
    pageId,
    pageName,
    accessToken,
    connectedAt: now,
    updatedAt: now,
    hasAccessToken: true,
  };
  MEMORY_CREDS.set(memoryCredsKey(pid), cred);

  if (tableAvailable) {
    const res = await sbQuery({
      method: 'POST',
      table: t().projectSocialCredentials,
      query: 'on_conflict=project_id,provider&select=project_id,provider,page_id,page_name,access_token_enc,access_token_iv,access_token_tag,connected_at,updated_at',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: [{
        project_id: pid,
        provider: PROVIDER_FACEBOOK_PAGE,
        page_id: pageId,
        page_name: pageName,
        access_token_enc: enc.data.password_enc,
        access_token_iv: enc.data.password_iv,
        access_token_tag: enc.data.password_tag,
        key_version: enc.data.key_version,
        connected_at: now,
        updated_at: now,
      }],
    });
    if (!res.ok && !isMissingTableError(res.error)) {
      return { ok: false, status: res.status || 500, error: safeText(res.error) || 'Could not save Facebook Page credentials' };
    }
  }

  return { ok: true, status: 200, data: cred };
}

async function deleteFacebookPage(projectId) {
  const pid = safeText(projectId);
  if (!pid) return { ok: false, status: 400, error: 'projectId is required' };
  MEMORY_CREDS.delete(memoryCredsKey(pid));

  if (await supportsCredentialsTable()) {
    await sbQuery({
      method: 'DELETE',
      table: t().projectSocialCredentials,
      query: `project_id=eq.${encodeURIComponent(pid)}&provider=eq.${encodeURIComponent(PROVIDER_FACEBOOK_PAGE)}`,
    });
  }

  return { ok: true, status: 200, data: { deleted: true } };
}

function makeHandoffId() {
  return `fbh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function createOAuthHandoff({ projectId, userId, pages = [], ttlMs = 15 * 60 * 1000 } = {}) {
  const pid = safeText(projectId);
  const uid = safeText(userId);
  if (!pid || !uid) return { ok: false, status: 400, error: 'projectId and userId are required' };
  const list = Array.isArray(pages) ? pages : [];
  if (!list.length) return { ok: false, status: 400, error: 'pages are required' };

  const id = makeHandoffId();
  const expiresAt = new Date(Date.now() + Math.max(60_000, Number(ttlMs) || 0)).toISOString();
  const row = {
    id,
    projectId: pid,
    userId: uid,
    provider: PROVIDER_FACEBOOK_PAGE,
    pages: list.map((page) => ({
      id: safeText(page.id),
      name: safeText(page.name),
      access_token: safeText(page.access_token || page.accessToken),
    })).filter((page) => page.id && page.access_token),
    expiresAt,
    createdAt: new Date().toISOString(),
  };
  MEMORY_HANDOFFS.set(id, row);

  if (await supportsHandoffsTable()) {
    await sbQuery({
      method: 'POST',
      table: t().projectOauthHandoffs,
      query: 'select=id',
      headers: { Prefer: 'return=representation' },
      body: [{
        id,
        project_id: pid,
        user_id: uid,
        provider: PROVIDER_FACEBOOK_PAGE,
        pages: row.pages,
        expires_at: expiresAt,
      }],
    });
  }

  return { ok: true, status: 200, data: { id, expiresAt } };
}

async function getOAuthHandoff(handoffId) {
  const id = safeText(handoffId);
  if (!id) return null;

  let row = MEMORY_HANDOFFS.get(id) || null;
  if (!row && (await supportsHandoffsTable())) {
    const res = await sbQuery({
      table: t().projectOauthHandoffs,
      query: `select=id,project_id,user_id,provider,pages,expires_at,created_at&id=eq.${encodeURIComponent(id)}&limit=1`,
    });
    if (res.ok) {
      const dbRow = Array.isArray(res.data) ? res.data[0] : null;
      if (dbRow) {
        row = {
          id: safeText(dbRow.id),
          projectId: safeText(dbRow.project_id),
          userId: safeText(dbRow.user_id),
          provider: safeText(dbRow.provider),
          pages: Array.isArray(dbRow.pages) ? dbRow.pages : [],
          expiresAt: safeText(dbRow.expires_at),
          createdAt: safeText(dbRow.created_at),
        };
        MEMORY_HANDOFFS.set(id, row);
      }
    }
  }

  if (!row) return null;
  const exp = Date.parse(row.expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    await deleteOAuthHandoff(id);
    return null;
  }
  return row;
}

async function deleteOAuthHandoff(handoffId) {
  const id = safeText(handoffId);
  if (!id) return;
  MEMORY_HANDOFFS.delete(id);
  if (await supportsHandoffsTable()) {
    await sbQuery({
      method: 'DELETE',
      table: t().projectOauthHandoffs,
      query: `id=eq.${encodeURIComponent(id)}`,
    });
  }
}

function publicFacebookPageSummary(cred) {
  if (!cred) return { connected: false, pageId: '', pageName: '', connectedAt: '' };
  return {
    connected: Boolean(cred.pageId && cred.hasAccessToken),
    pageId: safeText(cred.pageId),
    pageName: safeText(cred.pageName),
    connectedAt: safeText(cred.connectedAt),
  };
}

module.exports = {
  PROVIDER_FACEBOOK_PAGE,
  getFacebookPage,
  saveFacebookPage,
  deleteFacebookPage,
  createOAuthHandoff,
  getOAuthHandoff,
  deleteOAuthHandoff,
  publicFacebookPageSummary,
};
