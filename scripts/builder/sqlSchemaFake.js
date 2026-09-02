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
 * not exists, column types/defaults/not-null, inline `primary key`, inline
 * `unique`, inline `references`, `check (col in (...))`, unique (optionally
 * partial) indexes, `alter column ... drop not null|default`, enable row
 * level security, `or=` filter trees, and the `Prefer` header. It is not a Postgres. Anything it does not understand, it
 * refuses loudly rather than ignoring — a fake that quietly skips a constraint
 * is worse than no fake.
 *
 * THAT PROMISE WAS NOT TRUE UNTIL 2026-08-25. parseColumn read `primary key`,
 * `unique` and `references ... on delete cascade` straight past, recording only
 * name/type/not-null/default/allowed — so the fake accepted a duplicate primary
 * key (real Postgres: 23505) and a dangling foreign key (23503) and answered
 * ok:true to both. This is the same hole as the ORDER BY one below and it
 * matters for the same reason: this fake is deliberately reusable
 * infrastructure for Studio slices 2/8-8/8, so a later slice testing "the same
 * id cannot be used twice" would have passed while enforcing nothing.
 * parseColumn now consumes every clause it finds and THROWS on a leftover,
 * which is what makes the paragraph above checkable rather than aspirational.
 *
 * THREE MORE HOLES CLOSED 2026-08-26, all the same shape — a rule read past in
 * silence rather than refused. (1) `headers` was accepted by JavaScript and
 * consulted by nothing, so a store forgetting `Prefer: return=representation`
 * passed here and 404'd in production off PostgREST's empty 204. (2) `matchesOr`
 * scraped `project_id` out with a regex and never looked at `owner_user_id`, so
 * the tenancy filter was half-read — in the over-permissive direction. (3) the
 * unique index String()-compared, so two NULLs collided as the text 'null', a
 * constraint Postgres does not have. This file is the harness for Studio slices
 * 2/8-8/8; each of those was six more chances to ship a bug with a green run
 * behind it.
 *
 * TABLE-LEVEL `primary key (a, b, c)` LANDED 2026-08-29, same shape again: it
 * fell out of parseColumn as a null and was dropped, so a composite key — the
 * only kind that cannot be written inline — was declared in the SQL and
 * enforced by nothing. Any other table-level constraint now throws instead of
 * being skipped. DELETE landed with it, for tables no other table references.
 *
 * The one thing still declared and not exercised is `on delete cascade`. A
 * DELETE from a table something else points at refuses out loud rather than
 * deleting the parent and orphaning the children, which is a database Postgres
 * is not.
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
  // A `$$ ... $$` function body is one token, semicolons and all. Without
  // this, splitting a schema on ';' cuts a trigger function into fragments
  // and every one of them reads as an unsupported statement.
  let inDollarQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (!inString && char === '$' && text[i + 1] === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i += 1;
      continue;
    }
    if (inDollarQuote) {
      current += char;
      continue;
    }
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

/**
 * Cut `<keyword> ( ... )` out of `text`, counting parentheses so a nested
 * `in ('a','b')` does not end the clause early. Returns the clause (parens
 * included) and what is left, or null if the keyword is not there.
 */
function cutParenClause(text, keywordRegex) {
  const found = keywordRegex.exec(text);
  if (!found) return null;
  let i = found.index + found[0].length;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== '(') return null;
  const start = i;
  let depth = 0;
  let inString = false;
  for (; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") inString = !inString;
    else if (!inString && char === '(') depth += 1;
    else if (!inString && char === ')') {
      depth -= 1;
      if (depth === 0) { i += 1; break; }
    }
  }
  if (depth !== 0) throw new Error(`sqlSchemaFake: unbalanced parentheses in "${text}"`);
  return {
    clause: text.slice(start, i),
    remaining: `${text.slice(0, found.index)} ${text.slice(i)}`.replace(/\s+/g, ' ').trim(),
  };
}

/** Cut a whole regex match out of `text`, returning the match and the rest. */
function cutMatch(text, regex) {
  const found = regex.exec(text);
  if (!found) return null;
  return {
    match: found,
    remaining: `${text.slice(0, found.index)} ${text.slice(found.index + found[0].length)}`
      .replace(/\s+/g, ' ').trim(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which declared types this fake can actually check a value against.
 *
 * A type NOT in here throws at parse time rather than being read past, for the
 * same reason an unrecognised column clause throws: a check that quietly does
 * not run is worse than no check, because the green run is taken as proof.
 * Each entry answers one question — is this value acceptable in this column —
 * and `null` is handled by the caller, never here.
 */
const TYPE_CHECKS = new Map([
  ['uuid', (value) => typeof value === 'string' && UUID_RE.test(value)],
  ['text', (value) => typeof value === 'string' || typeof value === 'number'],
  ['varchar', (value) => typeof value === 'string' || typeof value === 'number'],
  ['character varying', (value) => typeof value === 'string' || typeof value === 'number'],
  ['boolean', (value) => typeof value === 'boolean'],
  ['jsonb', () => true],
  ['json', () => true],
  ['integer', isIntegerValue],
  ['int', isIntegerValue],
  ['bigint', isIntegerValue],
  ['smallint', isIntegerValue],
  ['numeric', isNumberValue],
  ['decimal', isNumberValue],
  ['real', isNumberValue],
  ['double precision', isNumberValue],
  ['timestamptz', isTimestampValue],
  ['timestamp', isTimestampValue],
  ['timestamp with time zone', isTimestampValue],
  ['date', isTimestampValue],
]);

/**
 * Every type name this fake knows, longest first.
 *
 * The order is the whole point: matched shortest-first, `int` would swallow the
 * head of `interval` and `timestamp` the head of `timestamptz`.
 */
const TYPE_NAMES_LONGEST_FIRST = [...TYPE_CHECKS.keys()].sort((a, b) => b.length - a.length);

/**
 * The declared type at the head of a column definition.
 *
 * WHY THIS IS NOT A REGEX ANY MORE (2026-08-26). It was `/^([a-z ]+?)(\s|$|\()/i`
 * — non-greedy, so it stopped at the first space. `double precision` parsed as
 * `double` and `character varying` as `character`, and since neither is a key
 * in TYPE_CHECKS, both THREW instead of being checked. The three multi-word
 * entries in that table were unreachable: they looked supported and were not.
 * (`timestamp with time zone` survived only by accident, matching the shorter
 * `timestamp` key — the right answer for the wrong reason.)
 *
 * It failed loudly, which is what this file promises, and today's SQL declares
 * none of those types — so it cost nothing yet. It was a trap set for whichever
 * of slices 2/8-8/8 first adds a `double precision` column.
 *
 * A name must END at a space, a `(` or the end of the string, and a type this
 * fake does not know falls back to its first word so the caller can still name
 * it in the error it throws.
 */
function matchDeclaredType(text) {
  const lower = String(text).toLowerCase();
  for (const name of TYPE_NAMES_LONGEST_FIRST) {
    if (!lower.startsWith(name)) continue;
    const after = lower.charAt(name.length);
    if (after === '' || after === ' ' || after === '(') return name;
  }
  const first = /^[a-z_][a-z0-9_]*/i.exec(lower);
  return first ? first[0] : lower;
}

/** A number, or a string Postgres would read as one. Booleans are not numbers
 *  here even though `Number(true)` is 1 — that coercion is the bug, not the
 *  feature (see numberOrError in lib/videoSourcesStore.js). */
function isNumberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text !== '' && Number.isFinite(Number(text));
}

function isIntegerValue(value) {
  if (!isNumberValue(value)) return false;
  return Number.isInteger(Number(value));
}

function isTimestampValue(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== 'string' || !value.trim()) return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * One column definition → what the fake needs to enforce it.
 *
 * Every clause is CONSUMED as it is recognised, and whatever is left over at
 * the end throws. That is the whole design: a constraint this fake does not
 * implement can no longer be read past in silence, which is how inline
 * `primary key`, `unique` and `references` sat here unenforced.
 */
function parseColumn(definition) {
  const match = /^([a-z_][a-z0-9_]*)\s+([\s\S]+)$/i.exec(definition.trim());
  if (!match) return null;
  const [, name, rest] = match;
  // A table-level constraint on its own line, not a column.
  if (['primary', 'unique', 'check', 'constraint', 'foreign', 'exclude'].includes(name.toLowerCase())) {
    return null;
  }

  let remaining = rest.replace(/\s+/g, ' ').trim();

  // The type, plus any (length) or (precision, scale) after it. Multi-word
  // types are matched WHOLE — see matchDeclaredType for what stopping at the
  // first space cost.
  const type = matchDeclaredType(remaining);
  remaining = remaining.slice(type.length).trim();
  if (remaining.startsWith('(')) {
    const sized = cutParenClause(remaining, /^/);
    if (sized) remaining = sized.remaining;
  }

  if (!TYPE_CHECKS.has(type)) {
    throw new Error(
      `sqlSchemaFake: column "${name}" is declared "${type}", which this fake cannot check a `
      + 'value against. Add it to TYPE_CHECKS — an unchecked type is a column where anything '
      + 'at all lands with ok:true, which is what this file exists to stop.'
    );
  }

  // check ( ... ). Only the `col in (...)` form is implemented — any other
  // form REFUSES, because silently ignoring `check (n >= 0)` is the same bug
  // in a different costume.
  let allowed = null;
  const check = cutParenClause(remaining, /\bcheck\b/i);
  if (check) {
    remaining = check.remaining;
    const inMatch = /^\(\s*[a-z_][a-z0-9_]*\s+in\s*\(([^)]*)\)\s*\)$/i.exec(check.clause);
    if (!inMatch) {
      throw new Error(
        `sqlSchemaFake: the check on "${name}" is not the "col in (...)" form this fake `
        + `implements, and it will not be skipped — ${check.clause}`
      );
    }
    allowed = inMatch[1].split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
  }

  // references [public.]<table> (<column>) [on delete <action>]
  let references = null;
  const ref = cutMatch(
    remaining,
    /\breferences\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)(?:\s+on\s+delete\s+(cascade|restrict|no action|set null|set default))?/i
  );
  if (ref) {
    references = {
      table: ref.match[1],
      column: ref.match[2],
      onDelete: (ref.match[3] || 'no action').toLowerCase(),
    };
    remaining = ref.remaining;
  } else if (/\breferences\b/i.test(remaining)) {
    throw new Error(`sqlSchemaFake: unsupported references clause on "${name}" — ${remaining}`);
  }

  const def = cutMatch(remaining, /\bdefault\s+([^\s,]+(?:\([^)]*\))?)/i);
  if (def) remaining = def.remaining;

  const primaryKey = /\bprimary\s+key\b/i.test(remaining);
  remaining = remaining.replace(/\bprimary\s+key\b/gi, ' ');
  const notNull = /\bnot\s+null\b/i.test(remaining);
  remaining = remaining.replace(/\bnot\s+null\b/gi, ' ');
  const unique = /\bunique\b/i.test(remaining);
  remaining = remaining.replace(/\bunique\b/gi, ' ');
  remaining = remaining.replace(/\bnull\b/gi, ' ').replace(/\s+/g, ' ').trim();

  if (remaining) {
    throw new Error(
      `sqlSchemaFake: unsupported clause on column "${name}" — "${remaining}". `
      + 'Implement it or the fake would be enforcing less than the SQL says.'
    );
  }

  return {
    name,
    type,
    // A primary key is NOT NULL in Postgres whether or not it says so.
    notNull: notNull || primaryKey,
    default: def ? def.match[1].trim() : null,
    allowed,
    primaryKey,
    unique,
    references,
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
  /** function name → the column its before-update trigger stamps. */
  const triggerFunctions = new Map();
  /** table → (trigger name → column stamped on every update). */
  const triggers = new Map();

  for (const statement of statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;

    let match = /^create table if not exists public\.([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)$/i.exec(statement.trim());
    if (match) {
      const [, name, body] = match;
      const columns = new Map();
      // Table-level `primary key (a, b, c)`. It used to fall out of parseColumn
      // as a plain null and be dropped on the floor — the exact "read past in
      // silence" this file promises never to do, and the one that mattered
      // most, because a composite key is the only kind that CANNOT be written
      // inline. project_connections is keyed on (project_id, provider,
      // account_id); with the line ignored, two grants for the same account
      // could both be inserted and every test about re-authorising a
      // connection would have passed while enforcing nothing.
      let compositePrimaryKey = null;
      for (const definition of splitTopLevel(body)) {
        const column = parseColumn(definition);
        if (column) {
          columns.set(column.name, column);
          continue;
        }
        const composite = /^primary\s+key\s*\(([^)]*)\)$/i.exec(definition.trim());
        if (composite) {
          compositePrimaryKey = composite[1].split(',').map((part) => part.trim()).filter(Boolean);
          continue;
        }
        throw new Error(
          `sqlSchemaFake: unsupported table-level constraint on "${name}" — "${definition.trim()}". `
          + 'Implement it or the fake would be enforcing less than the SQL says.'
        );
      }
      if (compositePrimaryKey) {
        for (const columnName of compositePrimaryKey) {
          const column = columns.get(columnName);
          if (!column) {
            throw new Error(`sqlSchemaFake: primary key on ${name} names no column "${columnName}"`);
          }
          // A primary key is NOT NULL in Postgres whether or not it says so —
          // the same rule parseColumn applies to the inline form.
          column.notNull = true;
        }
      }
      if (!tables.has(name)) {
        const foreignKeys = [];
        if (compositePrimaryKey) {
          indexes.push({
            name: `${name}_pkey`,
            table: name,
            unique: true,
            columns: compositePrimaryKey,
            predicate: () => true,
          });
        }
        for (const column of columns.values()) {
          // An inline primary key or unique IS a unique index; expressing it as
          // one means uniqueViolation() enforces it with no second code path.
          if (column.primaryKey) {
            indexes.push({
              name: `${name}_pkey`,
              table: name,
              unique: true,
              columns: [column.name],
              predicate: () => true,
            });
          } else if (column.unique) {
            indexes.push({
              name: `${name}_${column.name}_key`,
              table: name,
              unique: true,
              columns: [column.name],
              // Postgres lets a UNIQUE column hold many nulls; a PRIMARY KEY
              // cannot be null at all, which the not-null check covers.
              predicate: (row) => row[column.name] !== null && row[column.name] !== undefined,
            });
          }
          if (column.references) {
            foreignKeys.push({
              column: column.name,
              refTable: column.references.table,
              refColumn: column.references.column,
              onDelete: column.references.onDelete,
            });
          }
        }
        tables.set(name, { name, columns, foreignKeys });
      }
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

    match = /^alter table (?:public\.)?([a-z_][a-z0-9_]*) alter column ([a-z_][a-z0-9_]*) drop (not null|default)$/i.exec(normalized);
    if (match) {
      const [, tableName, columnName, what] = match;
      const target = tables.get(tableName);
      if (!target) throw new Error(`sqlSchemaFake: alter table ${tableName} before it is created`);
      const column = target.columns.get(columnName);
      if (!column) throw new Error(`sqlSchemaFake: no column ${tableName}.${columnName} to alter`);
      if (what.toLowerCase() === 'default') column.default = null;
      else column.notNull = false;
      continue;
    }

    match = /^alter table public\.([a-z_][a-z0-9_]*) enable row level security$/i.exec(normalized);
    if (match) {
      rlsEnabled.add(match[1]);
      continue;
    }

    /*
     * The `updated_at` trigger idiom, IMPLEMENTED rather than skipped.
     *
     * Every table here maintains updated_at with a before-update trigger, so
     * the stores do not send the column on a PATCH. A fake that quietly
     * ignored the trigger would leave updated_at frozen at its insert value
     * and any test asserting "this row was touched" would pass over a
     * database that never touched it. Only this exact shape is recognised —
     * anything else still refuses loudly below.
     */
    match = /^create or replace function (?:public\.)?([a-z_][a-z0-9_]*)\(\) returns trigger language plpgsql as \$\$ begin new\.([a-z_][a-z0-9_]*) = now\(\); return new; end; \$\$$/i.exec(normalized);
    if (match) {
      triggerFunctions.set(match[1].toLowerCase(), match[2].toLowerCase());
      continue;
    }

    match = /^drop trigger if exists ([a-z_][a-z0-9_]*) on (?:public\.)?([a-z_][a-z0-9_]*)$/i.exec(normalized);
    if (match) {
      const dropped = triggers.get(match[2].toLowerCase());
      if (dropped) dropped.delete(match[1].toLowerCase());
      continue;
    }

    match = /^create trigger ([a-z_][a-z0-9_]*) before update on (?:public\.)?([a-z_][a-z0-9_]*) for each row execute function (?:public\.)?([a-z_][a-z0-9_]*)\(\)$/i.exec(normalized);
    if (match) {
      const [, triggerName, tableName, functionName] = match;
      const column = triggerFunctions.get(functionName.toLowerCase());
      if (!column) {
        throw new Error(
          `sqlSchemaFake: trigger ${triggerName} calls ${functionName}(), which this fake did not parse. `
          + 'Implement it or the fake would be enforcing less than the SQL says.'
        );
      }
      if (!tables.has(tableName)) {
        throw new Error(`sqlSchemaFake: trigger ${triggerName} on ${tableName} before it is created`);
      }
      if (!tables.get(tableName).columns.has(column)) {
        throw new Error(`sqlSchemaFake: trigger ${triggerName} maintains ${tableName}.${column}, which does not exist`);
      }
      if (!triggers.has(tableName)) triggers.set(tableName, new Map());
      triggers.get(tableName).set(triggerName.toLowerCase(), column);
      continue;
    }

    throw new Error(`sqlSchemaFake: unsupported statement — ${normalized.slice(0, 120)}`);
  }

  return { tables, indexes, rlsEnabled, triggers, statements: statements.map((s) => s.trim()).filter(Boolean) };
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

/**
 * One condition of a PostgREST `or=` filter: `col.eq.v`, `col.is.null`, or a
 * nested `and(...)`/`or(...)`. Anything else throws rather than being read past.
 */
function parseFilterNode(text) {
  const trimmed = String(text).trim();

  const group = /^(and|or)\((.*)\)$/is.exec(trimmed);
  if (group) {
    return {
      kind: group[1].toLowerCase(),
      children: splitTopLevel(group[2]).map(parseFilterNode),
    };
  }
  const equals = /^([a-z_][a-z0-9_]*)\.eq\.(.*)$/i.exec(trimmed);
  if (equals) return { kind: 'eq', column: equals[1], value: equals[2] };

  const isCheck = /^([a-z_][a-z0-9_]*)\.is\.(null|true|false)$/i.exec(trimmed);
  if (isCheck) {
    return { kind: 'is', column: isCheck[1], value: isCheck[2].toLowerCase() };
  }
  throw new Error(`sqlSchemaFake: unsupported or= condition "${trimmed}"`);
}

function evaluateFilterNode(row, node) {
  if (node.kind === 'or') return node.children.some((child) => evaluateFilterNode(row, child));
  if (node.kind === 'and') return node.children.every((child) => evaluateFilterNode(row, child));

  const value = row[node.column];
  const isNull = value === null || value === undefined;
  if (node.kind === 'is') {
    if (node.value === 'null') return isNull;
    return value === (node.value === 'true');
  }
  // NULL is never equal to anything in SQL, not even to the text 'null'.
  if (isNull) return false;
  return String(value) === node.value;
}

/**
 * A PostgREST `or=(...)` filter, evaluated properly.
 *
 * It used to scrape `project_id` out with two regexes and never look at
 * `owner_user_id` at all — so the third shape lib/projectScope.js emits,
 * `(project_id.eq.X,and(project_id.is.null,or(owner_user_id.eq.U,owner_user_id.is.null)))`,
 * was read as "project X, or ANY row with a null project". That is
 * over-permissive in the tenancy direction, which is the direction that matters:
 * a store that leaked another user's legacy rows would have passed here. It was
 * harmless on these two tables only because their project_id is NOT NULL, which
 * is exactly the kind of accident that stops being true in slice 2/8.
 *
 * Now the whole condition tree is parsed and evaluated, and a shape this cannot
 * read THROWS — the promise the header of this file makes.
 */
function parseOr(orValue) {
  const text = decodeURIComponent(String(orValue || '')).trim();
  const wrapped = /^\((.*)\)$/s.exec(text);
  if (!wrapped) {
    // PostgREST requires the parentheses; without them it reads the whole thing
    // as a column name (see the note in lib/projectScope.js).
    throw new Error(`sqlSchemaFake: or= must be parenthesised — got "${text}"`);
  }
  return splitTopLevel(wrapped[1]).map(parseFilterNode);
}

function matchesOr(row, conditions) {
  return conditions.some((node) => evaluateFilterNode(row, node));
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
        // Uuid-SHAPED, because the uuid column it lands in is now type-checked
        // and `row-1` is not a uuid. Deterministic on purpose: a test that
        // fails must fail the same way twice, so nothing here reaches for
        // real randomness. The counter is what makes each one distinct.
        // The leading groups carry hex LETTERS on purpose. They were all
        // zeroes, which is uuid-shaped but unreachable by a whole class of
        // bug: `id.toUpperCase()` was a no-op, so no fixture built on this
        // could ever exercise Postgres's case-insensitive uuid comparison —
        // and that is exactly the bug review found in videoSessionsStore
        // (a session refusing its OWN source over two spellings of one id).
        // Still deterministic; the counter is what makes each one distinct.
        row[name] = column.type === 'uuid'
          ? `a115c635-8658-4dad-a8b1-${String(counter).padStart(12, '0')}`
          : `${idPrefix}-${counter}`;
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
      if (value === null || value === undefined) continue;
      // The declared type was parsed and then never consulted, so
      // 'not-a-uuid-at-all' landed in a uuid column under ok:true and an
      // object landed in a text column as '[object Object]'. Postgres's own
      // wording, so a store branch that reads the error text is tested
      // against something it could actually be handed.
      const fits = TYPE_CHECKS.get(column.type);
      if (fits && !fits(value)) {
        return `invalid input syntax for type ${column.type}: "${describe(value)}"`;
      }
      if (column.allowed && !column.allowed.includes(String(value))) {
        return `new row violates check constraint on "${name}"`;
      }
    }
    return '';
  }

  /** A value in an error message, without throwing on a circular object. */
  function describe(value) {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /** A row Postgres would not consider for a unique index: any indexed column null. */
  function hasNullIndexColumn(index, row) {
    return index.columns.some((column) => row[column] === null || row[column] === undefined);
  }

  function uniqueViolation(tableName, row, skipRow = null) {
    for (const index of schema.indexes) {
      if (index.table !== tableName || !index.unique) continue;
      if (!index.predicate(row)) continue;
      // NULL is never equal to NULL, so a null in ANY indexed column means the
      // row simply is not a candidate for that index. The comparison below is
      // String()-based, which made two nulls collide as the text 'null' — a
      // constraint Postgres does not have, invented by the fake. The inline
      // `unique` path dodged it via its own predicate; the named
      // `create unique index` path did not, and that is the path slice 2/8
      // inherits.
      if (hasNullIndexColumn(index, row)) continue;
      for (const existing of data.get(tableName)) {
        if (existing === skipRow) continue;
        if (!index.predicate(existing)) continue;
        if (hasNullIndexColumn(index, existing)) continue;
        if (index.columns.every((column) => String(existing[column]) === String(row[column]))) {
          return `duplicate key value violates unique constraint "${index.name}" (23505)`;
        }
      }
    }
    return '';
  }

  /**
   * A foreign key that points at nothing. Real Postgres raises 23503 and
   * PostgREST answers 409 — which is what lib/videoSourcesStore.js's
   * isMissingSessionError() reads, so the fake must produce the same shape or
   * that branch is tested against a message it will never see.
   */
  function foreignKeyViolation(tableName, row) {
    const table = schema.tables.get(tableName);
    for (const fk of table.foreignKeys || []) {
      const value = row[fk.column];
      if (value === null || value === undefined) continue;
      const parent = data.get(fk.refTable);
      if (!parent || !parent.some((existing) => String(existing[fk.refColumn]) === String(value))) {
        return `insert or update on table "${tableName}" violates foreign key constraint `
          + `"${tableName}_${fk.column}_fkey" (23503) — key (${fk.column})=(${value}) `
          + `is not present in table "${fk.refTable}"`;
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

  /**
   * Can this URL text be cast to this column's type — the question real
   * PostgREST asks before it runs the query at all?
   *
   * The row-value checks in TYPE_CHECKS take JS values; a filter value is
   * always a string off the query string, so `boolean` is spelled out here
   * rather than being asked `typeof value === 'boolean'` and always refused.
   */
  /**
   * Does this stored cell equal this filter value, by the COLUMN's rules?
   *
   * `uuid` is compared case-insensitively because Postgres stores it
   * canonically and compares it that way — `A115C635-...` and `a115c635-...`
   * are one value to the database. A plain `===` here made the fake answer
   * "no such row" to a lookup real Postgres satisfies, which is a false
   * NEGATIVE: a store that works in production would fail its test, and the
   * obvious way to make that test pass is to break the store.
   *
   * Found by the fixture, not by reading: the generated ids used to be all
   * zeroes, so `toUpperCase()` was a no-op and nothing here could tell the
   * difference. See the id generator in applyDefaults.
   */
  function valuesEqual(type, cell, wanted) {
    if (type === 'uuid') return String(cell).toLowerCase() === wanted.toLowerCase();
    return String(cell) === wanted;
  }

  function filterValueFits(type, text) {
    const fits = TYPE_CHECKS.get(type);
    if (!fits) return true;
    if (type === 'boolean') return ['true', 'false', 't', 'f', '1', '0'].includes(text.toLowerCase());
    return fits(text);
  }

  /**
   * Is every column named in this `or=` tree a real column?
   *
   * Same hole as the `eq` filters below, one line over: `parseFilterNode`
   * checks that a column NAME is well-SHAPED and never that it exists, so a
   * typo inside an `or=` matched nothing and answered 200 with an empty list —
   * which is the exact shape of the cross-project tests this fake exists to
   * hold up.
   */
  function unknownOrColumn(table, node) {
    if (node.kind === 'or' || node.kind === 'and') {
      for (const child of node.children) {
        const bad = unknownOrColumn(table, child);
        if (bad) return bad;
      }
      return '';
    }
    return table.columns.has(node.column) ? '' : node.column;
  }

  /**
   * Apply the `col=eq.value` filters the way PostgREST does.
   *
   * WHY THE PREDICATE IS NO LONGER ONE LINE (2026-08-26). It was
   * `String(row[key]) === match[1]`, which got three separate things wrong,
   * all of them in the "answers 200 and means it" direction:
   *
   *   1. `String(null)` is the text `'null'`, so `col=eq.null` MATCHED a real
   *      SQL NULL. In PostgREST it matches nothing — `is.null` is the operator
   *      for that. This PR had already found and fixed the identical coercion
   *      twice, in `uniqueViolation` and in `evaluateFilterNode`; this was the
   *      third copy, left live.
   *   2. A misspelled column read `row[key]` as `undefined`, matched nothing,
   *      and answered `200` with `[]`. Real PostgREST answers `400`.
   *   3. A malformed uuid did the same, where Postgres raises
   *      `invalid input syntax for type uuid`.
   *
   * (2) and (3) are not test-only nits: `videoStudioCatalog.test.js` was
   * asserting a 404 on a path production returns as a 400, so the suite pinned
   * behaviour the real database does not have. This file is the declared
   * harness for Studio slices 2/8 through 8/8, and a check that quietly does
   * not run here buys false confidence seven more times.
   */
  function filterRows(tableName, params) {
    const table = schema.tables.get(tableName);
    let rows = data.get(tableName).slice();
    for (const [key, value] of params.get('filters') || []) {
      const match = /^eq\.(.*)$/.exec(value);
      if (!match) throw new Error(`sqlSchemaFake: unsupported filter ${key}=${value}`);
      if (!table.columns.has(key)) {
        return { error: `column ${tableName}.${key} does not exist` };
      }
      const wanted = match[1];
      const { type } = table.columns.get(key);
      if (!filterValueFits(type, wanted)) {
        return { error: `invalid input syntax for type ${type}: "${wanted}"` };
      }
      rows = rows.filter((row) => {
        const cell = row[key];
        // NULL is never equal to anything in SQL, not even to the text 'null'.
        if (cell === null || cell === undefined) return false;
        return valuesEqual(type, cell, wanted);
      });
    }
    if (params.has('or')) {
      // Parsed BEFORE the filter runs, not inside the predicate. `.filter()`
      // never calls its callback on an empty table, so an unreadable condition
      // sailed through as "no filter" whenever nothing had been inserted yet —
      // and a query matching nothing is exactly the shape of the cross-project
      // tests here. Same reasoning as the PATCH column check below.
      const conditions = parseOr(params.get('or'));
      for (const node of conditions) {
        const bad = unknownOrColumn(table, node);
        if (bad) return { error: `column ${tableName}.${bad} does not exist` };
      }
      rows = rows.filter((row) => matchesOr(row, conditions));
    }

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

  /**
   * What the caller asked to get BACK — the header this fake ignored entirely.
   *
   * `sbQuery` destructured `{ method, table, query, body }` only, so `headers`
   * was accepted by JavaScript and consulted by nothing. PostgREST answers a
   * POST with no `Prefer: return=representation` with **201 and an empty body**,
   * and a PATCH with **204 and an empty body** — lib/supabase.js turns both into
   * `data: null`. So a store that forgets the header reads `res.data[0]` as
   * undefined and returns a spurious 404 in production, while passing every test
   * here. This file is the harness for Studio slices 2/8-8/8; that is six more
   * chances to ship the bug with a green run behind it.
   *
   * An unknown header, or an unknown Prefer token, THROWS — the same bargain the
   * unsupported-clause and unknown-type checks already make.
   */
  function wantsRepresentation(headers) {
    const names = Object.keys(headers || {});
    const unknown = names.filter((name) => name.toLowerCase() !== 'prefer');
    if (unknown.length) {
      throw new Error(
        `sqlSchemaFake: header(s) ${unknown.join(', ')} are not implemented, so a test `
        + 'using one would prove nothing. Add support or drop the header.'
      );
    }
    const prefer = names.length ? String(headers[names[0]] || '') : '';
    if (!prefer.trim()) return false;

    let asked = false;
    for (const token of prefer.split(',').map((part) => part.trim().toLowerCase())) {
      if (!token) continue;
      if (token === 'return=representation') asked = true;
      else if (token === 'return=minimal') asked = false;
      else {
        throw new Error(`sqlSchemaFake: Prefer token "${token}" is not implemented`);
      }
    }
    return asked;
  }

  async function sbQuery({
    method = 'GET', table: tableName = '', query = '', body = undefined, headers = {},
  } = {}) {
    calls.push({ method, table: tableName, query, body, headers });
    const representation = wantsRepresentation(headers);
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
        const dangling = foreignKeyViolation(tableName, row);
        if (dangling) return { ok: false, status: 409, error: dangling };
        data.get(tableName).push(row);
        created.push({ ...row });
      }
      // 201 either way; the BODY is what the header decides. See above.
      return { ok: true, status: 201, data: representation ? created : null };
    }

    if (method === 'PATCH') {
      const rows = filterRows(tableName, params);
      if (rows && rows.error) return { ok: false, status: 400, error: rows.error };
      // BEFORE the loop, not inside it. Real Postgres parses the statement
      // before it looks for rows, so a typo'd column is a 400 whether or not
      // anything matched. Inside the loop it was a 400 only when a row
      // happened to match — and a filter matching nothing is exactly the shape
      // of the cross-project tests here, so a typo'd column name in one of
      // those would have shipped green (ok:true/200/[]).
      for (const key of Object.keys(body || {})) {
        if (!table.columns.has(key)) {
          return { ok: false, status: 400, error: `column "${key}" of relation "${tableName}" does not exist` };
        }
      }
      const updated = [];
      for (const row of rows) {
        const next = { ...row, ...body };
        const broken = violation(table, next);
        if (broken) return { ok: false, status: 400, error: broken };
        const duplicate = uniqueViolation(tableName, next, row);
        if (duplicate) return { ok: false, status: 409, error: duplicate };
        const dangling = foreignKeyViolation(tableName, next);
        if (dangling) return { ok: false, status: 409, error: dangling };
        Object.assign(row, body);
        // Before-update triggers, after the write, as Postgres does.
        for (const column of (schema.triggers?.get(tableName) || new Map()).values()) {
          row[column] = new Date().toISOString();
        }
        updated.push({ ...row });
      }
      // PostgREST answers 204, not 200, when no representation was asked for.
      return representation
        ? { ok: true, status: 200, data: updated }
        : { ok: true, status: 204, data: null };
    }

    if (String(method).toUpperCase() === 'DELETE') {
      // Implemented for tables NOTHING references. `on delete cascade` is still
      // not simulated, and a table that some other table points at still
      // refuses loudly rather than deleting the parent and leaving the children
      // behind — which would be the fake inventing a database Postgres is not.
      // Everything else about a DELETE is ordinary: match the filter, drop the
      // rows, and answer 204 unless a representation was asked for, exactly as
      // PostgREST does.
      const referenced = [...schema.tables.values()].filter((other) =>
        (other.foreignKeys || []).some((fk) => fk.refTable === tableName));
      if (referenced.length) {
        throw new Error(
          `sqlSchemaFake: DELETE from "${tableName}" is not implemented, because `
          + `${referenced.map((other) => other.name).join(', ')} reference(s) it and `
          + '`on delete cascade` is not simulated. Cascade behaviour has to be proved '
          + 'against real Postgres — see the "How to test" step on the ticket.'
        );
      }
      const rows = filterRows(tableName, params);
      if (rows && rows.error) return { ok: false, status: 400, error: rows.error };
      const remaining = data.get(tableName).filter((row) => !rows.includes(row));
      const removed = rows.map((row) => ({ ...row }));
      data.set(tableName, remaining);
      // PostgREST answers 204 with an empty body unless asked for the rows.
      return representation
        ? { ok: true, status: 200, data: removed }
        : { ok: true, status: 204, data: null };
    }
    throw new Error(`sqlSchemaFake: unsupported method ${method}`);
  }

  return { sbQuery, data, calls, schema };
}

module.exports = { parseSchemaText, parseSchemaFile, createFakeDb };
