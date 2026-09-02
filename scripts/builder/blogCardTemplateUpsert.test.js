'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const STORE = path.join(__dirname, '..', '..', 'lib', 'blogCardTemplateStore.js');
const source = fs.readFileSync(STORE, 'utf8');

/**
 * THE CARD TEMPLATE SAVE, AND THE TWO BUGS THAT MADE IT LIE (2026-09-02).
 *
 * `saveCardTemplate` sent `on_conflict=project_id` with no
 * `Prefer: resolution=merge-duplicates`. PostgREST only merges a conflicting
 * row when it is asked to — `on_conflict=` alone just names the column — so the
 * FIRST save for a project inserted, and every save after it came back 409
 * "duplicate key value violates unique constraint".
 *
 * On its own that would have been loud. The second bug is what hid it: on
 * failure the function fell through to the local-JSON path, wrote the file, and
 * returned the merged template. So the route answered 200 carrying the
 * operator's new values while the database still held the old ones — and on
 * Vercel the file write vanishes entirely (CLAUDE.md landmine 6). Save, reload,
 * everything reverted, no error anywhere.
 *
 * Found by driving the real Builder end to end rather than trusting the Live
 * Preview, which reads component state and would have looked right forever.
 *
 * Asserted against the SOURCE rather than behaviour: the failure needs a real
 * PostgREST with a row already present, which the node suite has no database
 * for — and an untested property is how this came back. `shipThread.test.js`
 * guards its no-force-push rule the same way, for the same reason.
 */

test('the upsert asks PostgREST to merge, not just names the column', () => {
  assert.match(
    source,
    /Prefer:\s*'resolution=merge-duplicates/,
    'saveCardTemplate must send Prefer: resolution=merge-duplicates — without it '
      + 'every save after the first 409s'
  );
});

test('a failed Supabase write is never reported as a save', () => {
  const save = source.slice(source.indexOf('async function saveCardTemplate'));
  const body = save.slice(0, save.indexOf('\nmodule.exports'));

  // The success line must not be the last word: something has to throw when the
  // write did not land, or the local-file path silently absorbs the failure.
  assert.match(
    body,
    /throw new Error\(\s*\n?\s*`Could not save the card template/,
    'saveCardTemplate must throw when Supabase is the store and the write failed, '
      + 'rather than falling through to the local file and returning the merged template'
  );

  // And the throw has to come BEFORE the local-file fallback, or it is dead code.
  const throwAt = body.indexOf('throw new Error');
  const fallbackAt = body.indexOf('const store = readStore()');
  assert.ok(throwAt > -1 && fallbackAt > -1, 'both paths should still exist');
  assert.ok(
    throwAt < fallbackAt,
    'the failure must be raised before the local-file fallback, not after it'
  );
});

test('the local-file path is still reachable when there is no database', () => {
  // The throw is guarded by supportsSupabase(); a machine with no Supabase
  // configured must still be able to save. Removing that guard would break
  // local development for anyone without the stack running.
  assert.match(source, /if \(await supportsSupabase\(\)\)/);
  assert.match(source, /const store = readStore\(\);/);
});
