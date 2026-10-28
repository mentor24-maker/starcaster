'use strict';

/**
 * docs/SQL/outreach_lessons_setup.sql, for a test's fake database
 * (./sqlSchemaFake.js). Outreach wizard 13/19 (task 86bcrmbpm).
 *
 * The file creates `outreach_lessons` and adds `lessons_used` to all three
 * channels' draft tables, but most tests build only their own channel's
 * tables — so this keeps the `add column` for the tables named and drops the
 * rest, and drops the readonly-login grant the fake does not read. Everything
 * else is the real file, so a tenant column taken out of it still fails the
 * tests that use it (landmine 12).
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'docs', 'SQL', 'outreach_lessons_setup.sql');

function lessonsSql(channelTables = []) {
  const keep = new Set(channelTables);
  return fs.readFileSync(FILE, 'utf8')
    .replace(/\ndo \$\$[\s\S]*?end \$\$;\s*$/i, '\n')
    .replace(/alter table public\.([a-z_]+)\s+add column if not exists lessons_used[^;]*;/g,
      (whole, table) => (keep.has(table) ? whole : ''));
}

module.exports = { lessonsSql };
