'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { orderDefaultThemeFirst, rowToTheme, setDefaultTheme } = require('../../lib/builderThemesStore');
const { pickThemeForPage } = require('../../lib/builderPagesStore');

/**
 * A PAGE WITH NO THEME OF ITS OWN USES THE PROJECT'S DEFAULT — NOT THE LAST
 * THEME SAVED (task 86bbzybx6).
 *
 * listThemes returns themes newest-saved first and every reader takes `[0]`
 * for a page with no theme id, so saving ANY theme recoloured every such page.
 * On Delray that was 49 pages, one "Theme Wizard — Scoreboard Green" save away
 * from turning green.
 *
 * Rows are fed through rowToTheme exactly as listThemes does, in listThemes'
 * own order (updated_at desc), so these tests exercise the shape production
 * reads rather than a hand-made one.
 */

const row = (id, { updated, created, isDefault } = {}) => ({
  id,
  name: id,
  updated_at: updated,
  created_at: created,
  ...(isDefault === undefined ? {} : { is_default: isDefault }),
});
const order = (rows) => orderDefaultThemeFirst(rows, rows.map(rowToTheme)).map((t) => t.id);

// Newest-saved first, as listThemes queries them.
const DELRAY = [
  row('scoreboard-green', { updated: '2026-09-13T10:00:00Z', created: '2026-09-10T00:00:00Z', isDefault: false }),
  row('delray-1', { updated: '2026-09-12T10:00:00Z', created: '2026-08-01T00:00:00Z', isDefault: true }),
  row('coastal', { updated: '2026-09-11T10:00:00Z', created: '2026-09-09T00:00:00Z', isDefault: false }),
];

test('the flagged default comes first, even when another theme was saved more recently', () => {
  assert.deepEqual(order(DELRAY), ['delray-1', 'scoreboard-green', 'coastal']);
});

test('the ticket: saving another theme does NOT move which theme an unthemed page shows', () => {
  const themes = orderDefaultThemeFirst(DELRAY, DELRAY.map(rowToTheme));
  const unthemed = { id: 'p1', themeId: '' };
  assert.equal(pickThemeForPage(unthemed, themes).id, 'delray-1');

  // "Save" coastal: it jumps to the top of the updated_at order.
  const afterSave = [
    row('coastal', { updated: '2026-09-14T10:00:00Z', created: '2026-09-09T00:00:00Z', isDefault: false }),
    DELRAY[0],
    DELRAY[1],
  ];
  const themesAfter = orderDefaultThemeFirst(afterSave, afterSave.map(rowToTheme));
  assert.equal(pickThemeForPage(unthemed, themesAfter).id, 'delray-1');
});

test('a page that names a theme keeps it — the default only fills in for pages without one', () => {
  const themes = orderDefaultThemeFirst(DELRAY, DELRAY.map(rowToTheme));
  assert.equal(pickThemeForPage({ id: 'p2', themeId: 'coastal' }, themes).id, 'coastal');
});

test('column present but nothing flagged (default deleted, or a new project): the OLDEST theme, not the newest', () => {
  const rows = DELRAY.map((r) => ({ ...r, is_default: false }));
  assert.deepEqual(order(rows)[0], 'delray-1');
});

test('two flagged (a switch whose second write failed): the newest-saved flagged one — the one just chosen', () => {
  const rows = [
    row('just-chosen', { updated: '2026-09-14T10:00:00Z', created: '2026-09-01T00:00:00Z', isDefault: true }),
    row('newest-unflagged', { updated: '2026-09-13T10:00:00Z', created: '2026-09-02T00:00:00Z', isDefault: false }),
    row('previous-default', { updated: '2026-09-01T10:00:00Z', created: '2026-08-01T00:00:00Z', isDefault: true }),
  ];
  assert.equal(order(rows)[0], 'just-chosen');
});

test('before the migration runs (no is_default column), the order is exactly what it was — nothing a visitor sees changes on deploy', () => {
  const rows = DELRAY.map(({ is_default, ...rest }) => rest);
  assert.deepEqual(order(rows), ['scoreboard-green', 'delray-1', 'coastal']);
});

test('one theme or none: returned as is', () => {
  assert.deepEqual(order([]), []);
  assert.deepEqual(order([DELRAY[0]]), ['scoreboard-green']);
});

test('isDefault is read only from the column, and an ordinary theme save never writes it', () => {
  assert.equal(rowToTheme(row('a', { isDefault: true })).isDefault, true);
  assert.equal(rowToTheme(row('a', { isDefault: false })).isDefault, false);
  assert.equal(rowToTheme(row('a')).isDefault, false);
  // inputToRow is not exported; read its source so a later edit that starts
  // writing is_default on every save (clearing the default) fails here.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'builderThemesStore.js'), 'utf8');
  const start = src.indexOf('function inputToRow(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.ok(start > -1, 'inputToRow is gone — re-point this test');
  assert.doesNotMatch(body, /is_default/);
});

test('setting a default refuses without a project — the unmark step would otherwise reach every project', async () => {
  const res = await setDefaultTheme('delray-1', { projectId: '', userId: 'u1' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  const none = await setDefaultTheme('delray-1', null);
  assert.equal(none.ok, false);
});

test('listThemes hands its rows through orderDefaultThemeFirst', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'builderThemesStore.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const start = src.indexOf('async function listThemes(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /data: orderDefaultThemeFirst\(rows, rows\.map\(rowToTheme\)\)/);
});

test('the migration backfills each project with the theme its pages show TODAY, without touching updated_at', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'SQL', 'builder_themes_is_default_migration.sql'), 'utf8')
    .replace(/--.*$/gm, '');
  assert.match(sql, /add column if not exists is_default boolean not null default false/);
  assert.match(sql, /order by project_id, updated_at desc, created_at desc/, 'the backfill must pick the newest-saved theme, which is what pages show today');
  assert.match(sql, /set local session_replication_role = replica;[\s\S]*update public\.builder_themes[\s\S]*commit;/,
    'the updated_at trigger must be off for the backfill, or every page using the default reads as pending in Publish');
});
