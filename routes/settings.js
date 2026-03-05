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
  getApiConfig, deleteApiConfig
} = require('../lib/apiSettings');
const { relayOpenClaw }            = require('../lib/openclawGateway');
const { upsertMirroredAcquireJob } = require('../lib/acquireMirror');
const {
  hasSupabaseConfig, listDatabaseTables, createDatabaseField
} = require("../lib/ContactsStore");
const { logActivity } = require('../lib/activityLog');
const { getProfile, saveProfile } = require('../lib/profileStore');

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

  // GET /api/settings/database/tables
  if (pathname === '/api/settings/database/tables' && method === 'GET') {
    const result = await listDatabaseTables();
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const tables = result.data || [];
    return sendOk(res, 200, tables, { tables }, { total: tables.length }), true;
  }

  if (pathname === '/api/settings/profile' && method === 'GET') {
    const profile = getProfile();
    return sendOk(res, 200, profile, { profile }), true;
  }

  if (pathname === '/api/settings/profile' && method === 'POST') {
    const body = await parseJsonBody(req);
    const profile = saveProfile({
      projectName: body.project_name || body.projectName,
      contactName: body.contact_name || body.contactName,
      email: body.email,
      phone: body.phone,
      website: body.website,
      logoDataUrl: body.logo_data_url || body.logoDataUrl,
    });
    logActivity({
      action: 'settings.profile_saved',
      entityType: 'settings',
      summary: `Profile saved: ${profile.projectName || 'Untitled project'}`
    });
    return sendOk(res, 200, profile, { profile }), true;
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
    upsertMirroredAcquireJob(openClawMatch[1], body, responsePayload);
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
