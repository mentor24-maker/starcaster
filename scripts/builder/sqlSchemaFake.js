'use strict';

/**
 * A tiny in-memory stand-in for Supabase, whose schema is READ FROM the real
 * `docs/SQL/*.sql` file rather than hand-copied into the test.
 *
 * Why bother: the interesting failures in this codebase are ones where the
 * table and the code disagree and nothing errors — a table missing
 * `owner_user_id` makes lib/projectScope.js's probe fail and scopedInsertRow
 * silently stops stamping the tenant (CLAUDE.md landmine 12, 550 untenanted
 * rows on 2026-08-16). A test that hard-codes the column list cannot catch
 * that, because the hard-coded copy stays right while the SQL goes wrong.
 * Parsing the SQL means deleting a column from the file fails the test.
 *
 * It understands only what the setup files here actually use: create table if
 * not exists, column types/defaults/not-null, `check (col in (...))`, unique
 * (optionally partial) indexes, and enable row level security. It is not a
 * Postgres. Anything it does not understand, it refuses loudly rather than
 * ignoring — a fake that quietly skips a constraint is worse than no fake.
 */

const fs = require('fs');

// ── Parsing ─────────────────────────────────────────────────────────────────

function stripComments(sql) {
  return String(sql)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Split on top-level commas only — `check (x in ('a','b'))` has its own. */
function splitTopLevel(text, separator = ',') {
  const parts = [];
  let depth = 0;
  let current = '';
  let inString = false;
  for (const char of text) {
    if (char === "'") inString = !inString;
    if (!inString) {
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === separator && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseColumn(definition) {
  const match = /^([a-z_][a-z0-9_]*)\s+([\s\S]+)$/i.exec(definition.trim());
  if (!match) return null;
  const [, name, rest] = match;
  if (['primary', 'unique', 'check', 'constraint', 'foreign'].includes(name.toLowerCase())) return null;

  const typeMatch = /^([a-z ]+?)(\s|$|\()/i.exec(rest.trim());
  const type = (typeMatch ? typeMatch[1] : rest).trim().toLowerCase();

  const checkMatch = /check\s*\(\s*[a-z_][a-z0-9_]*\s+in\s*\(([^)]*)\)\s*\)/i.exec(rest);
  const allowed = checkMatch
    ? checkMatch[1].split(',').map((value) => value.trim().replace(/^'|'$/g, ''))
    : null;

  const defaultMatch = /default\s+([^\s,]+(?:\([^)]*\))?)/i.exec(rest);

  return {
    name,
    type,
    notNull: /\bnot\s+null\b/i.test(rest),
    default: defaultMatch ? defaultMatch[1].trim() : null,
    allowed,
  };
}

/** `content_hash is not null and content_hash <> ''` → a predicate function. */
function parsePartialPredicate(text) {
  const clauses = String(text).split(/\band\b/i).map((clause) => clause.trim()).filter(Boolean);
  const tests = clauses.map((clause) => {
    let match = /^([a-z_][a-z0-9_]*)\s+is\s+not\s+null$/i.exec(clause);
    if (match) return (row) => row[match[1]] !== null && row[match[1]] !== undefined;
    match = /^([a-z_][a-z0-9_]*)\s+is\s+null$/i.exec(clause);
    if (match) return (row) => row[match[1]] === null || row[match[1]] === undefined;
    match = /^([a-z_][a-z0-9_]*)\s*<>\s*'([^']*)'$/i.exec(clause);
    if (match) return (row) => row[match[1]] !== match[2];
    throw new Error(`sqlSchemaFake: unsupported index predicate "${clause}"`);
  });
  return (row) => tests.every((test) => test(row));
}

function parseSchemaText(sqlText) {
  const statements = splitTopLevel(stripComments(sqlText), ';');
  const tables = new Map();
  const indexes = [];
  const rlsEnabled = new Set();

  for (const statement of statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;

    let match = /^create table if not exists public\.([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)$/i.exec(statement.trim());
    if (match) {
      const [, name, body] = match;
      const columns = new Map();
      for (const definition of splitTopLevel(body)) {
        const column = parseColumn(definition);
        if (column) columns.set(column.name, column);
      }
      if (!tables.has(name)) tables.set(name, { name, columns });
      continue;
    }

    match = /^create (unique )?index if not exists ([a-z_][a-z0-9_]*) on public\.([a-z_][a-z0-9_]*) \(([^)]*)\)(?: where (.+))?$/i.exec(normalized);
    if (match) {
      const [, unique, name, table, columnList, predicate] = match;
      if (!indexes.some((index) => index.name === name)) {
        indexes.push({
          name,
          table,
          unique: Boolean(unique),
          columns: columnList.split(',').map((column) => column.trim().split(/\s+/)[0]),
          predicate: predicate ? parsePartialPredicate(predicate) : () => true,
        });
      }
      continue;
    }

    match = /^alter table public\.([a-z_][a-z0-9_]*) enable row level security$/i.exec(normalized);
    if (match) {
      rlsEnabled.add(match[1]);
      continue;
    }

    throw new Error(`sqlSchemaFake: unsupported statement — ${normalized.slice(0, 120)}`);
  }

  return { tables, indexes, rlsEnabled, statements: statements.map((s) => s.trim()).filter(Boolean) };
}

function parseSchemaFile(filePath) {
  return parseSchemaText(fs.readFileSync(filePath, 'utf8'));
}

// ── The fake database ───────────────────────────────────────────────────────

function parseQuery(query) {
  const params = new Map();
  for (const pair of String(query || '').split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    const key = index === -1 ? pair : pair.slice(0, index);
    const value = index === -1 ? '' : pair.slice(index + 1);
    if (key === 'select' || key === 'order' || key === 'limit') params.set(key, value);
    else if (key === 'or') params.set('or', value);
    else {
      const filters = params.get('filters') || [];
      filters.push([key, decodeURIComponent(value)]);
      params.set('filters', filters);
    }
  }
  return params;
}

/** Only the two shapes lib/projectScope.js emits. */
function matchesOr(row, orValue) {
  const text = decodeURIComponent(String(orValue || ''));
  const projectIds = [...text.matchAll(/project_id\.eq\.([^,)]+)/g)].map((m) => m[1]);
  const allowsNullProject = /project_id\.is\.null/.test(text);
  if (projectIds.includes(String(row.project_id))) return true;
  return allowsNullProject && (row.project_id === null || row.project_id === undefined);
}

function createFakeDb(schema, { idPrefix = 'row' } = {}) {
  const data = new Map();
  const calls = [];
  let counter = 0;

  for (const name of schema.tables.keys()) data.set(name, []);

  function applyDefaults(table, input) {
    const row = {};
    for (const [name, column] of table.columns) {
      if (input[name] !== undefined) {
        row[name] = input[name];
        continue;
      }
      if (column.default === 'gen_random_uuid()') {
        counter += 1;
        row[name] = `${idPrefix}-${counter}`;
      } else if (column.default === 'now()') {
        row[name] = new Date(1755000000000 + counter * 1000).toISOString();
      } else if (column.default !== null) {
        row[name] = column.default.replace(/^'|'(::[a-z]+)?$/g, '').replace(/::jsonb$/, '');
        if (row[name] === 'true') row[name] = true;
        else if (row[name] === 'false') row[name] = false;
        else if (/^-?\d+$/.test(row[name])) row[name] = Number(row[name]);
      } else {
        row[name] = null;
      }
    }
    return row;
  }

  function violation(table, row) {
    for (const [name, column] of table.columns) {
      const value = row[name];
      if (column.notNull && (value === null || value === undefined)) {
        return `null value in column "${name}" violates not-null constraint`;
      }
      if (column.allowed && value !== null && value !== undefined && !column.allowed.includes(String(value))) {
        return `new row violates check constraint on "${name}"`;
      }
    }
    return '';
  }

  function uniqueViolation(tableName, row, skipRow = null) {
    for (const index of schema.indexes) {
      if (index.table !== tableName || !index.unique) continue;
      if (!index.predicate(row)) continue;
      for (const existing of data.get(tableName)) {
        if (existing === skipRow) continue;
        if (!index.predicate(existing)) continue;
        if (index.columns.every((column) => String(existing[column]) === String(row[column]))) {
          return `duplicate key value violates unique constraint "${index.name}" (23505)`;
        }
      }
    }
    return '';
  }

  function selectColumns(tableName, row, select) {
    const table = schema.tables.get(tableName);
    const requested = String(select || '*').split(',').map((column) => column.trim()).filter(Boolean);
    if (requested.includes('*') || !requested.length) return { ...row };
    const picked = {};
    for (const column of requested) {
      if (!table.columns.has(column)) return { error: `column ${tableName}.${column} does not exist` };
      picked[column] = row[column];
    }
    return picked;
  }

  /**
   * Apply `order` the way PostgREST does.
   *
   * WHY THIS EXISTS (2026-08-24). The fake parsed `order` into its params and
   * then never used it. So every ordering assertion built on this fake was
   * asserting nothing: review pointed `listSourcesForSession` at
   * `order=no_such_column.asc` — which real PostgREST rejects with a 400 — and
   * all 20 tests still passed. Reversing asc to desc also still passed.
   *
   * Nothing was broken in production, because real PostgREST does order
   * correctly. It matters because this fake is deliberately reusable
   * infrastructure for Studio slices 2/8-8/8, and a later slice with a
   * genuinely wrong sort would have shipped green.
   *
   * Syntax: `col[.asc|.desc][.nullsfirst|.nullslast]`, comma-separated.
   * Null placement follows Postgres when unstated — ASC puts nulls last,
   * DESC puts them first.
   */
  function parseOrder(tableName, spec) {
    const table = schema.tables.get(tableName);
    const keys = [];
    for (const part of decodeURIComponent(String(spec || '')).split(',')) {
      const clean = part.trim();
      if (!clean) continue;
      const bits = clean.split('.');
      const column = bits.shift();
      if (!table.columns.has(column)) {
        // Real PostgREST refuses rather than silently ignoring — and silently
        // ignoring is exactly how this hole stayed open.
        return { error: `column "${column}" does not exist` };
      }
      let dir = 'asc';
      let nulls = '';
      for (const bit of bits) {
        const b = bit.toLowerCase();
        if (b === 'asc' || b === 'desc') dir = b;
        else if (b === 'nullsfirst' || b === 'nullslast') nulls = b;
        else return { error: `unknown order option "${bit}"` };
      }
      if (!nulls) nulls = dir === 'asc' ? 'nullslast' : 'nullsfirst';
      keys.push({ column, dir, nulls });
    }
    return { keys };
  }

  function compareValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  function orderRows(rows, keys) {
    // Stable: a tie falls back to the original order, matching a real query
    // with no further sort key.
    return rows
      .map((row, index) => ({ row, index }))
      .sort((x, y) => {
        for (const { column, dir, nulls } of keys) {
          const a = x.row[column];
          const b = y.row[column];
          const aNull = a === null || a === undefined;
          const bNull = b === null || b === undefined;
          if (aNull || bNull) {
            if (aNull && bNull) continue;
            return (aNull ? 1 : -1) * (nulls === 'nullslast' ? 1 : -1);
          }
          const cmp = compareValues(a, b);
          if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
        }
        return x.index - y.index;
      })
      .map(({ row }) => row);
  }

  function filterRows(tableName, params) {
    let rows = data.get(tableName).slice();
    for (const [key, value] of params.get('filters') || []) {
      const match = /^eq\.(.*)$/.exec(value);
      if (!match) throw new Error(`sqlSchemaFake: unsupported filter ${key}=${value}`);
      rows = rows.filter((row) => String(row[key]) === match[1]);
    }
    if (params.has('or')) rows = rows.filter((row) => matchesOr(row, params.get('or')));

    // Order BEFORE limit, as SQL does — limiting first would return a
    // different set of rows, not merely a differently-sorted one.
    if (params.has('order')) {
      const parsed = parseOrder(tableName, params.get('order'));
      if (parsed.error) return { error: parsed.error };
      rows = orderRows(rows, parsed.keys);
    }

    const limit = Number(params.get('limit'));
    if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
    return rows;
  }

  async function sbQuery({ method = 'GET', table: tableName = '', query = '', body = undefined } = {}) {
    calls.push({ method, table: tableName, query, body });
    const table = schema.tables.get(tableName);
    if (!table) {
      return { ok: false, status: 404, error: `relation "public.${tableName}" does not exist` };
    }
    const params = parseQuery(query);

    if (method === 'GET') {
      const rows = filterRows(tableName, params);
      // An unknown order column is a 400 from real PostgREST, not an ignored
      // parameter — the whole point of the fix.
      if (rows && rows.error) return { ok: false, status: 400, error: rows.error };
      const projected = [];
      for (const row of rows) {
        const picked = selectColumns(tableName, row, params.get('select'));
        if (picked.error) return { ok: false, status: 400, error: picked.error };
        projected.push(picked);
      }
      // A select of a column that does not exist fails even with no rows —
      // that is exactly how projectScope's probe learns the truth.
      if (!rows.length) {
        const probe = selectColumns(tableName, {}, params.get('select'));
        if (probe.error) return { ok: false, status: 400, error: probe.error };
      }
      return { ok: true, status: 200, data: projected };
    }

    if (method === 'POST') {
      const inputs = Array.isArray(body) ? body : [body];
      const created = [];
      for (const input of inputs) {
        for (const key of Object.keys(input || {})) {
          if (!table.columns.has(key)) {
            return { ok: false, status: 400, error: `column "${key}" of relation "${tableName}" does not exist` };
          }
        }
        const row = applyDefaults(table, input || {});
        const broken = violation(table, row);
        if (broken) return { ok: false, status: 400, error: broken };
        const duplicate = uniqueViolation(tableName, row);
        if (duplicate) return { ok: false, status: 409, error: duplicate };
        data.get(tableName).push(row);
        created.push({ ...row });
      }
      return { ok: true, status: 201, data: created };
    }

    if (method === 'PATCH') {
      const rows = filterRows(tableName, params);
      if (rows && rows.error) return { ok: false, status: 400, error: rows.error };
      const updated = [];
      for (const row of rows) {
        for (const key of Object.keys(body || {})) {
          if (!table.columns.has(key)) {
            return { ok: false, status: 400, error: `column "${key}" of relation "${tableName}" does not exist` };
          }
        }
        const next = { ...row, ...body };
        const broken = violation(table, next);
        if (broken) return { ok: false, status: 400, error: broken };
        const duplicate = uniqueViolation(tableName, next, row);
        if (duplicate) return { ok: false, status: 409, error: duplicate };
        Object.assign(row, body);
        updated.push({ ...row });
      }
      return { ok: true, status: 200, data: updated };
    }

    throw new Error(`sqlSchemaFake: unsupported method ${method}`);
  }

  return { sbQuery, data, calls, schema };
}

module.exports = { parseSchemaText, parseSchemaFile, createFakeDb };
