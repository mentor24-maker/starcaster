'use strict';

/**
 * Content Transform Handlers Store
 * ─────────────────────────────────
 * Global (non-project-scoped) pool of user-defined HTML transformation rules.
 * Backed by Supabase `content_transform_handlers` table; falls back to an
 * in-memory array if the table is not yet migrated.
 *
 * Handler schema:
 *   id          text    primary key
 *   name        text    display name
 *   description text    optional explanation
 *   type        text    'promote-h2' | 'promote-h3' | 'delete' | 'strip-tag' | 'find-replace' | 'bold'
 *   tag         text    source HTML tag for promote-h2/strip-tag (e.g. 'u', 'em')
 *   pattern     text    regex string for delete/find-replace
 *   replacement text    replacement string for find-replace
 *   flags       text    regex flags (default 'gi')
 *   enabled     bool
 *   created_at  timestamptz
 */

const { sbQuery, isConfigured: isSupabaseConfigured } = require('./supabase');

const TABLE = 'content_transform_handlers';

// In-memory fallback when Supabase table doesn't exist yet.
const _mem = [];

let _tableExists = false;
let _tableCheckedAt = 0;
const TABLE_CACHE_TTL = 30000; // re-probe after 30s so a fresh migration is picked up quickly

async function checkTable() {
  const now = Date.now();
  if (now - _tableCheckedAt < TABLE_CACHE_TTL) return _tableExists;
  if (!isSupabaseConfigured()) { _tableCheckedAt = now; _tableExists = false; return false; }
  const probe = await sbQuery({ table: TABLE, query: 'select=id&limit=1' }).catch(() => ({ ok: false }));
  _tableExists = probe.ok || (probe.error && !String(probe.error || '').includes('42P01'));
  _tableCheckedAt = now;
  return _tableExists;
}

function makeId() {
  return `handler_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function listHandlers() {
  if (await checkTable()) {
    const result = await sbQuery({ table: TABLE, query: 'select=*&order=created_at.asc' }).catch(() => null);
    if (result?.ok && Array.isArray(result.data)) return result.data;
  }
  return [..._mem];
}

async function createHandler(handler) {
  const row = {
    id: makeId(),
    name: String(handler.name || '').trim(),
    description: String(handler.description || '').trim(),
    type: String(handler.type || 'delete').trim(),
    tag: String(handler.tag || '').trim(),
    pattern: String(handler.pattern || '').trim(),
    replacement: String(handler.replacement || '').trim(),
    flags: String(handler.flags || 'gi').trim(),
    enabled: true,
    created_at: new Date().toISOString(),
  };

  if (await checkTable()) {
    const result = await sbQuery({
      method: 'POST',
      table: TABLE,
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: row,
    }).catch(() => null);
    if (result?.ok) return Array.isArray(result.data) ? result.data[0] : row;
  }

  _mem.push(row);
  return row;
}

async function deleteHandler(id) {
  if (await checkTable()) {
    await sbQuery({
      method: 'DELETE',
      table: TABLE,
      query: `id=eq.${encodeURIComponent(id)}`,
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
  }
  const idx = _mem.findIndex((h) => h.id === id);
  if (idx !== -1) _mem.splice(idx, 1);
}

async function toggleHandler(id, enabled) {
  if (await checkTable()) {
    await sbQuery({
      method: 'PATCH',
      table: TABLE,
      query: `id=eq.${encodeURIComponent(id)}`,
      headers: { Prefer: 'return=minimal' },
      body: { enabled: Boolean(enabled) },
    }).catch(() => {});
  }
  const h = _mem.find((h) => h.id === id);
  if (h) h.enabled = Boolean(enabled);
}

/**
 * Apply all enabled user-defined handlers to an HTML string.
 * Called after identifyHeaderLines(sanitizeImportHtml(html)) in the pipeline.
 */
function applyHandlers(html, handlers) {
  let out = html;
  for (const h of handlers) {
    if (!h.enabled) continue;
    try {
      if ((h.type === 'promote-h2' || h.type === 'promote-h3') && h.tag) {
        const target = h.type === 'promote-h2' ? 'h2' : 'h3';
        const re = new RegExp(`<${h.tag}[^>]*>([\\s\\S]*?)<\\/${h.tag}>`, 'gi');
        out = out.replace(re, `<${target}>$1</${target}>`);
      } else if (h.type === 'strip-tag' && h.tag) {
        const re = new RegExp(`<${h.tag}[^>]*>([\\s\\S]*?)<\\/${h.tag}>`, 'gi');
        out = out.replace(re, '$1');
      } else if (h.type === 'bold' && h.pattern) {
        const re = new RegExp(h.pattern, h.flags || 'gi');
        out = out.replace(re, '<strong>$&</strong>');
      } else if (h.type === 'delete' && h.pattern) {
        const re = new RegExp(h.pattern, h.flags || 'gi');
        out = out.replace(re, '');
      } else if (h.type === 'find-replace' && h.pattern) {
        const re = new RegExp(h.pattern, h.flags || 'gi');
        out = out.replace(re, h.replacement || '');
      }
    } catch {
      // invalid regex — skip silently
    }
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

module.exports = { listHandlers, createHandler, deleteHandler, toggleHandler, applyHandlers };
