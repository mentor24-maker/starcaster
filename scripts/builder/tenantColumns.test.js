'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sqlDir = path.join(__dirname, '..', '..', 'docs', 'SQL');
const read = (name) => fs.readFileSync(path.join(sqlDir, name), 'utf8');

/**
 * Tenant columns on the tables this session's work writes through
 * scopedInsertRow.
 *
 * lib/projectScope.js decides whether to stamp a tenant by probing the table
 * for BOTH project_id and owner_user_id. A table with only project_id fails
 * that probe and scopedInsertRow silently stops stamping either column — the
 * insert still succeeds, so nothing errors and the rows land untenanted.
 *
 * It happened twice on 2026-08-16. builder_published_pages wrote ten rows with
 * a blank project_id and every published page read back as unpublished, which
 * was caught in minutes because the feature visibly did not work.
 * builder_page_revisions had the same gap since it shipped and nobody noticed
 * for two days, because its reads filter by page_id and skip the project scope
 * too — Page History worked perfectly while all 550 production rows sat with
 * no tenant. The visible failure is the lucky one.
 *
 * Scoped to the two tables written through scopedInsertRow by this work rather
 * than every table in docs/SQL: about a dozen older tables have the same gap,
 * and whether it matters for each depends on how its store writes. Widening
 * this test is a decision about those tables, not about this rule.
 */

const SCOPED_TABLES = [
  { file: 'develop_builder_published_pages_setup.sql', table: 'builder_published_pages' },
  { file: 'builder_page_revisions_owner_user_id.sql', table: 'builder_page_revisions' },
];

for (const { file, table } of SCOPED_TABLES) {
  test(`${table} carries both tenant columns, or scopedInsertRow stamps neither`, () => {
    const sql = read(file);
    assert.match(sql, /project_id/, `${file} must name project_id`);
    assert.match(sql, /owner_user_id/, `${file} must name owner_user_id`);
  });
}

test('the revisions backfill only copies a page its own project', () => {
  const sql = read('builder_page_revisions_owner_user_id.sql');
  assert.match(sql, /FROM builder_landing_page/i, 'source is the page the revision belongs to');
  assert.match(sql, /p\.id = r\.page_id/i, 'joined on that page, not guessed');
  assert.match(sql, /COALESCE\(r\.project_id, ''\) = ''/i, 'never overwrites a value that is already there');
  // Anchored to statements: an earlier version of this matched the word
  // "deleted" inside a comment explaining what happens to orphaned revisions.
  assert.doesNotMatch(sql, /^\s*(DELETE|DROP)\b/im, 'additive only — no destructive statements');
});

test('the landmine is written down where the next person will read it', () => {
  const claude = fs.readFileSync(path.join(__dirname, '..', '..', 'CLAUDE.md'), 'utf8');
  assert.match(claude, /BOTH `project_id` and `owner_user_id`/, 'landmine 12 must survive edits to CLAUDE.md');
});
