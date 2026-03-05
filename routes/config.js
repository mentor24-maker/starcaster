'use strict';

/**
 * routes/config.js
 * API endpoints for environment configuration management.
 *
 * #8 — Request Validation Layer: validate() on POST body.
 * #9 — Standardized API Response Envelope: sendOk() / sendErr() throughout.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { getSchema, listMasked, writeToVercel, SCHEMA } = require('../lib/config');
const { logActivity } = require('../lib/activityLog');
const { validate }    = require('../lib/validate');

const PREFIX = '/api/config';

const CONFIG_UPDATE_SCHEMA = {
  key:   { type: 'string', required: false, maxLength: 100 },
  env:   { type: 'string', required: false, maxLength: 100 },
  value: { type: 'string', required: true  },
};

const manifest = {
  id:       'config',
  label:    'Environment Configuration',
  prefixes: [PREFIX],
};

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith(PREFIX)) return false;

  // GET /api/config/schema
  if (method === 'GET' && pathname === `${PREFIX}/schema`) {
    const schema = getSchema();
    return sendOk(res, 200, schema, { schema }), true;
  }

  // GET /api/config
  if (method === 'GET' && pathname === PREFIX) {
    const config = listMasked();
    return sendOk(res, 200, config, { config }, { total: config.length }), true;
  }

  // POST /api/config
  if (method === 'POST' && pathname === PREFIX) {
    const body = await parseJsonBody(req);
    const v = validate(CONFIG_UPDATE_SCHEMA, body);
    if (!v.ok) return sendErr(res, 400, v.errors[0], { code: 'VALIDATION_ERROR', details: v.errors }), true;

    let schemaKey   = v.data.key;
    let schemaEntry = SCHEMA[schemaKey];

    if (!schemaEntry && v.data.env) {
      const found = Object.entries(SCHEMA).find(([, e]) => e.env === v.data.env);
      if (found) { [schemaKey, schemaEntry] = found; }
    }

    if (!schemaEntry) {
      return sendErr(res, 400, `Unknown config key. Use one of: ${Object.keys(SCHEMA).join(', ')}`, {
        code: 'UNKNOWN_KEY'
      }), true;
    }

    const envName    = schemaEntry.env;
    const isLocalDev = (process.env.NODE_ENV || 'development') !== 'production';

    process.env[envName] = v.data.value;

    let vercelResult = null;
    let note         = null;

    if (!isLocalDev) {
      vercelResult = await writeToVercel(envName, v.data.value);
      if (!vercelResult.ok) {
        note = `process.env updated for this process, but Vercel write failed: ${vercelResult.error}. ` +
               `Set it manually in Vercel dashboard → Project → Settings → Environment Variables.`;
      }
    } else {
      note = `process.env updated for this server process. To persist across restarts, ` +
             `add ${envName}=<value> to your .env file.`;
    }

    logActivity({
      action:     'config.env_updated',
      entityType: 'settings',
      summary:    `Env var updated: ${envName}`,
      meta:       { key: schemaKey, env: envName, vercelOk: vercelResult?.ok ?? null },
    });

    const payload = { ok: true, key: schemaKey, env: envName, note: note || 'Updated successfully.', vercel: vercelResult };
    return sendOk(res, 200, payload, payload), true;
  }

  return false;
}

module.exports = { handle, manifest };
