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
  '011_multitenancy_acquire_engage.sql':
    'Unused by the code: XAcquireStore and RedditAcquireStore write data/x_acquire_runs.json and '
    + 'data/reddit_acquire_runs.json and never touch these tables, so creating them changes nothing. That JSON '
    + 'write is its own defect (landmine 6), filed separately.',
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
};
