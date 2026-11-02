'use strict';

/**
 * Has every database change that shipped in docs/SQL actually been applied
 * to production?
 *
 * Ticket 86bcu8ftx. Schema changes ship here as hand-run files in docs/SQL
 * (DOCTRINE §6.5 and §7): the code merges and deploys on its own, the SQL
 * waits for Dane to paste it into Supabase. Nothing ever checked that the
 * second half happened. On 2026-10-28 two sign-in window attempts and the
 * whole Outreach screen failed on the live site because sixteen files had
 * merged with their code and never been run — some since 13 October. A sweep
 * that day found nine more gaps, the oldest months old.
 *
 * `npm run schema:check` did not catch any of it, and could not: it compares
 * production with a SNAPSHOT OF PRODUCTION (docs/schema/production.sql). Its
 * question is "did someone change production without recording it?". A file
 * that was never applied changes nothing in production, so production goes
 * on matching its own record perfectly. It also runs on no schedule. The
 * question this file answers is the other one: "does production contain what
 * the repo says it should?"
 *
 * HOW. Every docs/SQL file is read for the two things a probe can check
 * cheaply and without guessing: the tables it creates (`create table`) and
 * the columns it adds (`alter table … add column`). Renames and drops in ANY
 * file are followed, so a table later renamed is looked for under its new
 * name and a table later dropped is not looked for at all. Production is read
 * once (information_schema.columns) and every declared object is looked up.
 *
 * WHAT IT CANNOT SEE, said out loud: indexes, policies, functions, triggers,
 * constraints, data backfills, and any change written some other way (a
 * `create table` inside a DO block, for instance). A green run means every
 * table and column the files declare exists — not that every line ran.
 *
 * Three verdicts, never two (docs/DOCTRINE.md §3.11):
 *   OK           production was read and every declared object exists, or is
 *                explained in EXPLAINED below
 *   UNAPPLIED    at least one file declares something production lacks
 *   CANNOT TELL  production could not be read — never a pass
 *
 * The pure half lives here so it can be tested without a database;
 * scripts/unapplied_sql_watch.mjs does the reading, the stamp and the posting.
 */

const VERDICT = Object.freeze({ OK: 'OK', UNAPPLIED: 'UNAPPLIED', CANNOT_TELL: 'CANNOT TELL' });
const EXIT = Object.freeze({ OK: 0, UNAPPLIED: 1, 'CANNOT TELL': 2 });

/** An unapplied file is re-announced at most this often while it stays unapplied. */
const REPEAT_EVERY_MS = 24 * 60 * 60 * 1000;
/** A CANNOT TELL is repeated at most this often, like every other watchdog. */
const CANNOT_TELL_EVERY_MS = 6 * 60 * 60 * 1000;

const GITHUB_BLOB = 'https://github.com/mentor24-maker/starcaster/blob/main/docs/SQL/';

/**
 * Gaps that are known and deliberate. Each entry is one file and the reason
 * nobody should apply it; the check stops counting it, and lists it on every
 * run so the excuse stays visible. Add an entry only with a reason a reader
 * can verify — "the code that read it was removed in #NNN" — never "noise".
 */
const EXPLAINED = Object.freeze({
  // Audited 2026-10-28 for task 86bcu8ftx.
  'team_invitations_setup.sql':
    'Retired. Live invites use routes/invitations.js → appInvitationsStore; teamInvitationsStore is reached only '
    + 'through devTeamStore and teamInviteDelivery, which no route calls. Do NOT apply: it also opens the table to '
    + 'the public key with an "Allow all access" policy, against enable_rls_lockdown.sql.',
  'campaigns_schema_add_topic.sql':
    'Never wired. No store or route reads or writes campaigns.topic (lib/store.js campaign functions, routes/contacts.js).',
  'messaging_wyr_questions_category.sql':
    'Retired. Nothing reads messaging_wyr_questions.category; the only mention of the table is project delete, and '
    + 'Would-You-Rather questions are read from builder_polls now.',
  'project_scope_remaining_setup.sql':
    'Do NOT apply: it names builder_forms by its old name develop_forms, so its index fails and the whole file '
    + 'rolls back. Its every other table is already applied; builder_forms_tenant_columns.sql replaces the rest '
    + 'and is checked in its place.',
});

// ── parsing ──────────────────────────────────────────────────────────────────

const IDENT = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)';
const QUALIFIED = `(?:${IDENT}\\s*\\.\\s*)?${IDENT}`;

/** `public."Foo"` → `foo`; anything outside the public schema → null. */
function bareName(raw) {
  const parts = String(raw).split('.').map((p) => p.trim());
  if (parts.length > 2) return null;
  if (parts.length === 2) {
    const schema = parts[0].replace(/"/g, '').toLowerCase();
    if (schema !== 'public') return null;
  }
  const last = parts[parts.length - 1];
  return last.startsWith('"') ? last.replace(/"/g, '') : last.toLowerCase();
}

/** Comments and dollar-quoted bodies (function code) removed, so neither can declare anything. */
function stripNoise(sql) {
  return String(sql)
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

const NOT_A_COLUMN = new Set(['constraint', 'primary', 'foreign', 'unique', 'check', 'exclude']);

/**
 * One file → what it declares and what it renames or drops.
 * Returns { tables, columns: [{table, column}], tableRenames: [{from, to}],
 *           columnRenames: [{table, from, to}], droppedTables, droppedColumns: [{table, column}] }
 */
function parseSql(sql) {
  const out = { tables: [], columns: [], tableRenames: [], columnRenames: [], droppedTables: [], droppedColumns: [] };
  const statements = stripNoise(sql).split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const stmt of statements) {
    let m = stmt.match(new RegExp(`^create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED})`, 'i'));
    if (m) {
      const name = bareName(m[1]);
      if (name) out.tables.push(name);
      continue;
    }
    m = stmt.match(new RegExp(`^drop\\s+table\\s+(?:if\\s+exists\\s+)?((?:${QUALIFIED})(?:\\s*,\\s*${QUALIFIED})*)`, 'i'));
    if (m) {
      for (const raw of m[1].split(',')) {
        const name = bareName(raw);
        if (name) out.droppedTables.push(name);
      }
      continue;
    }
    m = stmt.match(new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})\\s+(.*)$`, 'i'));
    if (!m) continue;
    const table = bareName(m[1]);
    if (!table) continue;
    const rest = m[2];
    let r = rest.match(new RegExp(`^rename\\s+to\\s+(${QUALIFIED})`, 'i'));
    if (r) {
      const to = bareName(r[1]);
      if (to) out.tableRenames.push({ from: table, to });
      continue;
    }
    r = rest.match(new RegExp(`^rename\\s+(?:column\\s+)?(${IDENT})\\s+to\\s+(${IDENT})`, 'i'));
    if (r) {
      out.columnRenames.push({ table, from: bareName(r[1]), to: bareName(r[2]) });
      continue;
    }
    // One ALTER may carry several comma-separated actions.
    const addRe = new RegExp(`(?:^|,)\\s*add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?(${IDENT})`, 'gi');
    let a;
    while ((a = addRe.exec(rest))) {
      const column = bareName(a[1]);
      if (!column || NOT_A_COLUMN.has(column)) continue;
      out.columns.push({ table, column });
    }
    const dropRe = new RegExp(`(?:^|,)\\s*drop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?(${IDENT})`, 'gi');
    while ((a = dropRe.exec(rest))) {
      const column = bareName(a[1]);
      if (!column || NOT_A_COLUMN.has(column) || column === 'not' || column === 'default') continue;
      out.droppedColumns.push({ table, column });
    }
  }
  return out;
}

/** Follow a rename chain (a → b → c) to the name production should have now. */
function finalName(map, name) {
  const seen = new Set();
  let current = name;
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current);
  }
  return current;
}

/**
 * Every file → the objects production should now contain, after following
 * renames and drops across ALL files.
 *   files — [{ file, sql }]
 * Returns { expected: [{ file, kind: 'table'|'column', table, column? }], superseded: count }
 */
function expectedObjects(files) {
  const parsed = files.map(({ file, sql }) => ({ file, ...parseSql(sql) }));
  const tableRenames = new Map();
  const dropped = new Set();
  const columnRenames = new Map();
  const droppedColumns = new Set();
  for (const p of parsed) {
    for (const { from, to } of p.tableRenames) tableRenames.set(from, to);
    for (const t of p.droppedTables) dropped.add(t);
  }
  for (const p of parsed) {
    for (const { table, from, to } of p.columnRenames) {
      columnRenames.set(`${finalName(tableRenames, table)}.${from}`, `${finalName(tableRenames, table)}.${to}`);
    }
    for (const { table, column } of p.droppedColumns) droppedColumns.add(`${finalName(tableRenames, table)}.${column}`);
  }
  const expected = [];
  let superseded = 0;
  const seen = new Set();
  for (const p of parsed) {
    for (const t of p.tables) {
      const table = finalName(tableRenames, t);
      if (dropped.has(table) || dropped.has(t)) { superseded += 1; continue; }
      const key = `${p.file}|${table}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expected.push({ file: p.file, kind: 'table', table });
    }
    for (const c of p.columns) {
      const table = finalName(tableRenames, c.table);
      if (dropped.has(table) || dropped.has(c.table)) { superseded += 1; continue; }
      const full = finalName(columnRenames, `${table}.${c.column}`);
      if (droppedColumns.has(full)) { superseded += 1; continue; }
      const [t, column] = full.split('.');
      const key = `${p.file}|${t}.${column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expected.push({ file: p.file, kind: 'column', table: t, column });
    }
  }
  return { expected, superseded };
}

// ── judging ──────────────────────────────────────────────────────────────────

/**
 * Judge one reading.
 *   expected — from expectedObjects()
 *   live     — [{ table, column }] from production's information_schema, or null
 *   error    — why production could not be read
 *   explained — { [file]: reason }
 *   present  — every file name read from docs/SQL, so plan() can say WHY a
 *              file stopped being checked (deleted, or a later file drops it)
 *
 * `checked` is the files this reading actually looked production up for. It is
 * the only evidence plan() accepts for an all-clear (round-2 review of 86bcu8ftx).
 */
function judge({ expected, live, error = '', explained = EXPLAINED, present = null }) {
  const checked = [...new Set(expected.map((obj) => obj.file))].sort();
  const presentList = Array.isArray(present) ? [...present].sort() : null;
  if (!Array.isArray(live)) {
    return {
      verdict: VERDICT.CANNOT_TELL,
      files: [],
      excused: [],
      checked: [],
      present: presentList,
      reason: `production's structure could not be read (${String(error || 'no reading').slice(0, 300)})`,
    };
  }
  if (!live.length) {
    // An empty public schema is not a database with nothing missing; it is a
    // read that saw nothing (wrong database, no permission). Never a pass.
    return {
      verdict: VERDICT.CANNOT_TELL,
      files: [],
      excused: [],
      checked: [],
      present: presentList,
      reason: 'production answered with no tables at all — that is a blind read, not an empty database',
    };
  }
  const tables = new Set(live.map((r) => r.table));
  const columns = new Set(live.map((r) => `${r.table}.${r.column}`));
  const byFile = new Map();
  for (const obj of expected) {
    const present = obj.kind === 'table' ? tables.has(obj.table) : columns.has(`${obj.table}.${obj.column}`);
    if (present) continue;
    if (!byFile.has(obj.file)) byFile.set(obj.file, []);
    byFile.get(obj.file).push(obj);
  }
  const files = [];
  const excused = [];
  for (const [file, missing] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (explained[file]) excused.push({ file, missing, reason: explained[file] });
    else files.push({ file, missing });
  }
  if (!files.length) {
    return {
      verdict: VERDICT.OK,
      files,
      excused,
      checked,
      present: presentList,
      reason: `all ${expected.length} tables and columns declared in docs/SQL exist in production`
        + (excused.length ? ` (${excused.length} file${excused.length === 1 ? '' : 's'} explained)` : ''),
    };
  }
  return {
    verdict: VERDICT.UNAPPLIED,
    files,
    excused,
    checked,
    present: presentList,
    reason: `${files.length} docs/SQL file${files.length === 1 ? ' declares' : 's declare'} something production does not have`,
  };
}

/** `team_invitations (table)`, `segments.segment_type`. */
function describeMissing(obj) {
  return obj.kind === 'table' ? `${obj.table} (table)` : `${obj.table}.${obj.column}`;
}

// ── what to say, given what has been said ─────────────────────────────────────

/**
 * state — { alarmed: { [file]: postedAt }, cannotTellAt: '' } from the stamp file
 *
 * A file is named when first seen unapplied and again every REPEAT_EVERY_MS
 * while it stays that way — "post on the bus until they exist" is the ticket's
 * wording, and a gap named once and then never again is how these sat for
 * months. When a file is applied, one all-clear names it and it is forgotten.
 * A CANNOT TELL leaves the memory alone: not being able to look is not the
 * same as the file having been applied.
 *
 * A file also leaves judged.files when somebody adds it to EXPLAINED — the very
 * step the alarm tells an agent session to take — and it is still missing from
 * production then. So it is reported as `explained`, never as `cleared`: an
 * all-clear naming a file production does not have is a false pass from a
 * watchdog whose whole job is to be believed (round-1 review of 86bcu8ftx).
 *
 * And a file leaves judged.files when it is DELETED from docs/SQL — the other
 * resolution the alarm offers — or when a later file drops everything it
 * declared. Production has looked at nothing for it then, so it is `dropped`,
 * never `cleared`: an all-clear needs the file to be one this reading actually
 * checked (judged.checked). A reading that does not say what it checked clears
 * nothing (round-2 review of 86bcu8ftx).
 */
function plan({ judged, state = {}, now = Date.now(), repeatMs = REPEAT_EVERY_MS, everyMs = CANNOT_TELL_EVERY_MS }) {
  const alarmed = { ...((state && state.alarmed) || {}) };
  const at = new Date(now).toISOString();

  if (judged.verdict === VERDICT.CANNOT_TELL) {
    const then = Date.parse((state && state.cannotTellAt) || '');
    const due = !(Number.isFinite(then) && now - then < everyMs);
    return { alarm: [], cleared: [], explained: [], dropped: [], cannotTell: due, next: { alarmed, cannotTellAt: due ? at : state.cannotTellAt } };
  }

  const unapplied = new Set(judged.files.map((f) => f.file));
  const alarm = judged.files.filter((f) => {
    const then = Date.parse(alarmed[f.file] || '');
    return !(Number.isFinite(then) && now - then < repeatMs);
  });
  const excused = new Map((judged.excused || []).map((f) => [f.file, f]));
  const gone = Object.keys(alarmed).filter((file) => !unapplied.has(file));
  const checked = new Set(judged.checked || []);
  const present = Array.isArray(judged.present) ? new Set(judged.present) : null;
  const cleared = gone.filter((file) => !excused.has(file) && checked.has(file));
  const explained = gone.filter((file) => excused.has(file)).map((file) => excused.get(file));
  const dropped = gone.filter((file) => !excused.has(file) && !checked.has(file)).map((file) => ({
    file,
    reason: !present ? 'it was not among the files this reading checked'
      : present.has(file) ? 'a later docs/SQL file drops everything it declared'
        : 'it is no longer in docs/SQL',
  }));
  for (const f of alarm) alarmed[f.file] = at;
  for (const file of gone) delete alarmed[file];
  return { alarm, cleared, explained, dropped, cannotTell: false, next: { alarmed, cannotTellAt: '' } };
}

function renderAlarm({ files, node, at }) {
  const blocks = files.map((f) => [
    `• ${f.file} — production is missing ${f.missing.map(describeMissing).join(', ')}`,
    `  ${GITHUB_BLOB}${f.file}`,
  ].join('\n'));
  return [
    `[CC-starcaster] 🔴 Database changes that shipped with merged code are not on production (${files.length} file${files.length === 1 ? '' : 's'})`,
    '',
    'The code that needs these is already live, so whatever reads them fails on the live site until the SQL is run in Supabase.',
    '',
    ...blocks,
    '',
    'An agent session decides for each one: hand Dane the file to run (a live feature), or delete the file and the code that reads it (a retired one). '
      + 'A gap that is deliberate goes in EXPLAINED in lib/unappliedSql.js with its reason.',
    `Checked from ${node} at ${at}. Each file is named again once a day until production has it; one all-clear when it does.`,
  ].join('\n');
}

function renderClear({ files, node, at }) {
  return [
    `[CC-starcaster] ✅ ${files.length === 1 ? 'A database change is' : `${files.length} database changes are`} now on production`,
    '',
    files.join(', '),
    `Checked from ${node} at ${at}.`,
  ].join('\n');
}

function renderExplained({ files, node, at }) {
  return [
    `[CC-starcaster] 🟡 ${files.length === 1 ? 'A database change is' : `${files.length} database changes are`} now explained — still NOT on production`,
    '',
    ...files.map((f) => `• ${f.file} — ${f.reason}`),
    '',
    'These stop repeating because an agent session recorded why the gap is deliberate (EXPLAINED in lib/unappliedSql.js), not because the SQL was run.',
    `Checked from ${node} at ${at}.`,
  ].join('\n');
}

function renderDropped({ files, node, at }) {
  return [
    `[CC-starcaster] 🟡 ${files.length === 1 ? 'A database change is' : `${files.length} database changes are`} no longer checked — never confirmed on production`,
    '',
    ...files.map((f) => `• ${f.file} — ${f.reason}`),
    '',
    'These stop repeating because the file stopped declaring anything to look for, not because the SQL was run. '
      + 'If the code that read it is gone too, that is the end of it.',
    `Checked from ${node} at ${at}.`,
  ].join('\n');
}

function renderCannotTell({ judged, node, at }) {
  return [
    '[CC-starcaster] ⚠️ Unapplied database changes — CANNOT TELL whether production has every docs/SQL change',
    '',
    judged.reason,
    '',
    'This is not a pass. Until it can read production again, a database change that ships with code and is never run goes unnoticed — '
      + 'which is how the Outreach screen broke on the live site in October 2026.',
    `Checked from ${node} at ${at}. Re-posts every 6h while it stays this way.`,
  ].join('\n');
}

// ── the "SQL waiting for you" ticket (task 86bcwam1k) ────────────────────────
//
// Everything above posts to the bus, which agent sessions read and Dane does
// not — and Dane is the only one who can run SQL on production (DOCTRINE
// §6.5). So the finding reached everyone except the one person who could act
// on it: builder_project_shares sat uncreated until he found "You have no
// other projects" himself on 2026-10-30, and six Substack Miner columns were
// missing for three days after their tickets went Live. This is the same
// reading, written to ONE ClickUp ticket he already looks at, rewritten in
// place (no comments, so no "all is well" ×365) and assigned to him exactly
// while something is waiting.

const SQL_TASK_NAME = 'SQL waiting for you';
/** Where Dane runs it; said in the steps because Supabase holds two projects. */
const SUPABASE_PROJECT = 'StarCaster';
/** The ticket is rewritten at most this often when nothing on it changed. */
const TICKET_REFRESH_MS = 60 * 60 * 1000;
const FEATURE_MAX_CHARS = 300;

/** The file's leading comment block, one entry per line, `--` removed. */
function headerLines(sql) {
  const out = [];
  for (const line of String(sql).split('\n')) {
    const t = line.trim();
    if (!t) { out.push(''); continue; }
    if (!t.startsWith('--')) break;
    out.push(t.replace(/^-+\s?/, ''));
  }
  return out;
}

/**
 * What breaks without this file, in plain words.
 *
 * A `-- FEATURE: …` header line says it on purpose. Without one, the first
 * paragraph of the header comment (skipping the line that only repeats the
 * file name) is the best guess there is, and `guessed` makes the ticket say so
 * — a guess presented as a statement is how a wrong priority gets set.
 * Returns { text, guessed }.
 */
function featureOf(sql, file = '') {
  const lines = headerLines(sql);
  const i = lines.findIndex((l) => /^FEATURE:/i.test(l.trim()));
  const clip = (text) => (text.length > FEATURE_MAX_CHARS ? `${text.slice(0, FEATURE_MAX_CHARS - 1).trimEnd()}…` : text);
  if (i >= 0) {
    // A FEATURE line may wrap onto the comment lines below it, up to a blank.
    const parts = [lines[i].trim().replace(/^FEATURE:\s*/i, '')];
    for (let j = i + 1; j < lines.length && lines[j].trim() && !/^[A-Z][A-Z ]+:/.test(lines[j].trim()); j += 1) {
      parts.push(lines[j].trim());
    }
    return { text: clip(parts.join(' ').trim()), guessed: false };
  }
  const paragraph = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || /^[=\-─#*]+$/.test(l) || (file && l.toLowerCase() === file.toLowerCase())) {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(l);
  }
  return { text: clip(paragraph.join(' ').trim()), guessed: true };
}

/** `-- RUN AFTER docs/SQL/x.sql` lines, as bare file names. */
function statedRunAfter(sql) {
  const out = [];
  for (const l of headerLines(sql)) {
    const m = l.match(/^RUN\s+AFTER\s+(.*)$/i);
    if (!m) continue;
    for (const f of m[1].matchAll(/([A-Za-z0-9_.-]+\.sql)\b/g)) out.push(f[1].split('/').pop());
  }
  return out;
}

/** Tables a file touches without creating: ALTER TABLE, REFERENCES, CREATE INDEX … ON. */
function tablesUsed(sql) {
  const used = new Set();
  const statements = stripNoise(sql).split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const stmt of statements) {
    let m = stmt.match(new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})`, 'i'));
    if (m) { const n = bareName(m[1]); if (n) used.add(n); }
    m = stmt.match(new RegExp(`^create\\s+(?:unique\\s+)?index\\s+.*?\\bon\\s+(?:only\\s+)?(${QUALIFIED})`, 'i'));
    if (m) { const n = bareName(m[1]); if (n) used.add(n); }
    for (const r of stmt.matchAll(new RegExp(`\\breferences\\s+(${QUALIFIED})`, 'gi'))) {
      const n = bareName(r[1]);
      if (n) used.add(n);
    }
  }
  return used;
}

/**
 * Which waiting file must run before which.
 *   files — [{ file, sql }] for the waiting files only
 * A file runs after another waiting file when its header says so (RUN AFTER)
 * or when it alters, indexes or references a table only that file creates.
 * Returns { [file]: [file it runs after, …] }.
 */
function runAfter(files) {
  const names = new Set(files.map((f) => f.file));
  const creators = new Map();
  for (const f of files) for (const t of parseSql(f.sql).tables) if (!creators.has(t)) creators.set(t, f.file);
  const out = {};
  for (const f of files) {
    const deps = new Set(statedRunAfter(f.sql).filter((d) => names.has(d)));
    const own = new Set(parseSql(f.sql).tables);
    for (const t of tablesUsed(f.sql)) {
      const by = creators.get(t);
      if (by && by !== f.file && !own.has(t)) deps.add(by);
    }
    deps.delete(f.file);
    out[f.file] = [...deps].sort();
  }
  return out;
}

/**
 * The order Dane should run them in, top to bottom: newest merge first, except
 * that a file is always listed after everything it runs after. A cycle (which
 * would be a bug in the files) keeps the newest-first order for what is left.
 *   waiting — [{ file, addedAt }]; deps — from runAfter()
 */
function runOrder(waiting, deps = {}) {
  const newestFirst = (a, b) => (Date.parse(b.addedAt || '') || 0) - (Date.parse(a.addedAt || '') || 0)
    || a.file.localeCompare(b.file);
  const pending = [...waiting].sort(newestFirst);
  const placed = new Set();
  const order = [];
  while (pending.length) {
    const i = pending.findIndex((w) => (deps[w.file] || []).every((d) => placed.has(d) || !pending.some((p) => p.file === d)));
    const next = pending.splice(i >= 0 ? i : 0, 1)[0];
    placed.add(next.file);
    order.push(next);
  }
  return order;
}

/** `Sun, Nov 1, 7:15 PM MST` — Dane reads Mountain time. */
function mountainTime(ms) {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

const STEPS = 'Open the link → copy all → Supabase → **' + SUPABASE_PROJECT + '** project (not WaveCenter) → '
  + 'SQL Editor → paste → Run → nothing else to do, this ticket updates itself within the hour.';

function ticketFooter(explained) {
  const names = Object.keys(explained || {}).sort();
  const lines = ['---'];
  if (names.length) {
    lines.push(`${names.length} file${names.length === 1 ? '' : 's'} deliberately not run — do NOT run `
      + `${names.length === 1 ? 'it' : 'these'}; the reason for each is in lib/unappliedSql.js: ${names.join(', ')}`);
  }
  lines.push(
    '',
    `The **${SQL_TASK_NAME}**. Do not build this, do not close it, do not delete it.`,
    'It is rewritten in place by `npm run sql:unapplied -- --check` on the bus relay\'s wake (task 86bcwam1k), '
      + 'and Dane is assigned exactly while something is waiting.',
  );
  return lines.join('\n');
}

/**
 * What the ticket says, from one reading.
 *   judged    — from judge()
 *   waiting   — [{ file, addedAt, feature: {text, guessed} }] for judged.files
 *   deps      — from runAfter()
 *   lastGood  — { at, count, section } kept from the last reading that worked
 * Returns { body, fingerprint, assign, count, lastGood }:
 *   assign    — true: Dane must be assigned; false: nobody; null: leave it as
 *               it is (a CANNOT TELL with no earlier list says nothing either way)
 *   fingerprint — the body without its clock, so an unchanged list is not
 *               rewritten every ten minutes
 *   lastGood  — what to keep for the next CANNOT TELL
 *
 * A CANNOT TELL NEVER reads as "Nothing waiting". It says so at the top and
 * keeps the last good list below it, dated — "could not look" and "nothing to
 * do" are the two readings that must never share a picture (DOCTRINE §3.11).
 */
function renderSqlTicket({ judged, waiting = [], deps = {}, now = Date.now(), node = '', lastGood = null, explained = EXPLAINED }) {
  const when = mountainTime(now);
  const checked = `Last checked ${when}${node ? ` from ${node}` : ''}.`;
  const footer = ticketFooter(explained);

  if (judged.verdict === VERDICT.CANNOT_TELL) {
    const head = [
      '# ⚠️ CANNOT TELL — production could not be read',
      '',
      `${judged.reason}.`,
      '',
      '**This is not "nothing waiting".** Until production can be read again, a new SQL file that needs running would not appear here.',
      `Tried ${when}${node ? ` from ${node}` : ''}.`,
      '',
    ];
    const kept = lastGood && lastGood.section
      ? [`## The last good list, from ${mountainTime(Date.parse(lastGood.at))}`, '', lastGood.section]
      : ['No earlier reading is kept on this machine, so there is no list to show.'];
    const body = [...head, ...kept, '', footer].join('\n');
    const fingerprint = ['CANNOT TELL', judged.reason, lastGood ? lastGood.section : ''].join('\n');
    return {
      body,
      fingerprint,
      assign: lastGood ? lastGood.count > 0 : null,
      count: lastGood ? lastGood.count : null,
      lastGood,
    };
  }

  const ordered = runOrder(waiting, deps);
  if (!ordered.length) {
    const section = '# Nothing waiting';
    return {
      body: [`# Nothing waiting — last checked ${when}`, '', 'Every SQL file on `main` is on production.', '', footer].join('\n'),
      fingerprint: section,
      assign: false,
      count: 0,
      lastGood: { at: new Date(now).toISOString(), count: 0, section: 'Nothing was waiting.' },
    };
  }

  const missingOf = new Map((judged.files || []).map((f) => [f.file, f.missing]));
  const blocks = ordered.map((w, i) => {
    const feature = w.feature || { text: '', guessed: true };
    const without = feature.text
      ? `**Without it:** ${feature.text}${feature.guessed ? ' _(guessed from the file\'s first comment — it has no FEATURE line)_' : ''}`
      : '**Without it:** _unknown — the file has no FEATURE line and no header comment to guess from_';
    const lines = [
      `### ${i + 1}. [${w.file}](${GITHUB_BLOB}${w.file})`,
      '',
      without,
      '',
      `**Missing on production:** ${(missingOf.get(w.file) || []).map(describeMissing).join(', ') || '(unknown)'}`,
      '',
      `**Reached main:** ${Date.parse(w.addedAt || '') ? mountainTime(Date.parse(w.addedAt)) : 'unknown'}`,
    ];
    const after = deps[w.file] || [];
    if (after.length) lines.push('', `**Run after:** ${after.join(', ')}`);
    return lines.join('\n');
  });
  const n = ordered.length;
  const section = [
    `# ${n} file${n === 1 ? '' : 's'} waiting`,
    '',
    `**For each file, top to bottom:** ${STEPS}`,
    '',
    blocks.join('\n\n'),
  ].join('\n');
  return {
    body: [section, '', checked, '', footer].join('\n'),
    fingerprint: section,
    assign: true,
    count: n,
    lastGood: { at: new Date(now).toISOString(), count: n, section },
  };
}

/**
 * Should this wake rewrite the ticket? Yes when what it says changed, when the
 * assignment has to change, or once an hour so "last checked" stays honest.
 *   state — { writtenAt, fingerprint, assign } from the stamp
 */
function ticketDue({ rendered, state = {}, now = Date.now(), everyMs = TICKET_REFRESH_MS }) {
  if (!state || !state.writtenAt) return true;
  if (state.fingerprint !== rendered.fingerprint) return true;
  if (rendered.assign !== null && state.assign !== rendered.assign) return true;
  const then = Date.parse(state.writtenAt);
  return !(Number.isFinite(then) && now - then < everyMs);
}

/**
 * The assignee half of the write: what to add and remove so that Dane is the
 * only assignee while files wait, and nobody is once none do. `assign: null`
 * changes nothing.
 */
function assigneeChange({ current = [], assign, operatorId }) {
  const ids = current.map((a) => Number(a && a.id !== undefined ? a.id : a)).filter(Number.isFinite);
  if (assign === null || assign === undefined) return { add: [], rem: [] };
  if (assign) return { add: ids.includes(operatorId) ? [] : [operatorId], rem: ids.filter((id) => id !== operatorId) };
  return { add: [], rem: ids };
}

module.exports = {
  VERDICT,
  EXIT,
  REPEAT_EVERY_MS,
  CANNOT_TELL_EVERY_MS,
  GITHUB_BLOB,
  EXPLAINED,
  parseSql,
  expectedObjects,
  judge,
  describeMissing,
  plan,
  renderAlarm,
  renderClear,
  renderExplained,
  renderDropped,
  renderCannotTell,
  SQL_TASK_NAME,
  TICKET_REFRESH_MS,
  featureOf,
  statedRunAfter,
  tablesUsed,
  runAfter,
  runOrder,
  mountainTime,
  renderSqlTicket,
  ticketDue,
  assigneeChange,
};
