'use strict';

/**
 * A create the target refused because the row is ALREADY THERE.
 *
 * An importer's job is "make sure these exist", so a row that already exists is
 * the job being done, not a failure — it belongs in `skipped`, alongside the
 * ones the importer's own dedupe set caught before it asked.
 *
 * Until 86bbu4gdu round 3 both importers counted it as an error, and that only
 * became reachable when `messaging_tags` gained its unique index: `force` exists
 * precisely to bypass the local dedupe set (`if (!force && existing.has(key))
 * continue`), so a forced re-run asked for every tag again, got a 409 for each
 * one, and reported a hard **500 with a duplicate message** on a run where
 * nothing was wrong. `runGenericTextToTextImport` was worse — its `ok` is
 * `errors.length === 0`, so one duplicate made it report failure on a run that
 * had genuinely created new rows.
 *
 * 409 is the whole of it: every store here answers a uniqueness refusal with
 * 409 and nothing else with it, and both tag stores translate the raw
 * constraint dump into that status before it gets this far (`isDuplicateTag`).
 * A 500, a 400 or a network failure is still an error and still lands in
 * `errors` — a run that could not reach the database must not read as a run
 * where everything was already present.
 *
 * One definition, required by both importers, because two copies of a rule this
 * small are two copies that drift.
 */
function isDuplicateRefusal(res) {
  return Boolean(res) && res.ok !== true && Number(res.status) === 409;
}

module.exports = { isDuplicateRefusal };
