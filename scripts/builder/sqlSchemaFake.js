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

  function filterRows(tableName, params) {
    let rows = data.get(tableName).slice();
    for (const [key, value] of params.get('filters') || []) {
      const match = /^eq\.(.*)$/.exec(value);
      if (!match) throw new Error(`sqlSchemaFake: unsupported filter ${key}=${value}`);
      rows = rows.filter((row) => String(row[key]) === match[1]);
    }
    if (params.has('or')) rows = rows.filter((row) => matchesOr(row, params.get('or')));
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
