'use strict';

/**
 * Correct the one Substack reply that really posted but reads as failed (SC-920).
 *
 * On 2026-11-18 the Mini posted a reply on Dane's Substack account. OpenClaw
 * handed back https://substack.com/profile/397402153-dane-christensen/note/c-391111888,
 * which IS the reply — the Mini's screenshot shows it live — but the poster
 * only knew the /@name/note/c-N shape, called it "not a link to a Note", and
 * marked the row `failed`. A failed row offers Try again, which would post the
 * same reply a second time, in public. The poster is fixed; this moves that one
 * row to `posted`, with its link, and clears the error.
 *
 * The store does not allow failed -> posted (STATUS_MOVES), so this writes the
 * row directly, and only when it finds EXACTLY one row in exactly that state:
 * kind `reply`, status `failed`, the "not a link to a Note" error, and that
 * link (or no link) on it. Any OTHER failed reply carrying a /profile/ link is
 * listed and left alone — the ticket names one row, and nobody has looked at
 * the others' screenshots.
 *
 * DRY RUN BY DEFAULT. `--apply` writes, guarded on `status=failed`, and reads
 * the row back rather than trusting the write.
 *
 *   doppler run --project starcaster --config prd -- node scripts/substack_fix_reply_20261118.cjs
 *   doppler run --project starcaster --config prd -- node scripts/substack_fix_reply_20261118.cjs --apply
 */

const { sbQuery, tableConfig } = require('../lib/supabase');

const LINK = 'https://substack.com/profile/397402153-dane-christensen/note/c-391111888';
const ERROR_MARK = 'is not a link to a Note';
const APPLY = process.argv.includes('--apply');
const table = tableConfig().substackNotesItems;

const COLUMNS = 'id,project_id,kind,status,approved_at,posting_started_at,updated_at,posted_url,posted_at,error,target_url';

function mountain(iso) {
  if (!iso) return '(none)';
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' }) + ' MT';
}

function show(row) {
  return [
    `  id:          ${row.id}`,
    `  project:     ${row.project_id}`,
    `  status:      ${row.status}`,
    `  approved:    ${mountain(row.approved_at)}`,
    `  posted link: ${row.posted_url || '(none)'}`,
    `  posted at:   ${mountain(row.posted_at)}`,
    `  replying to: ${row.target_url || '(none)'}`,
    `  error:       ${row.error ? row.error.slice(0, 200) : '(none)'}`,
  ].join('\n');
}

(async () => {
  const read = await sbQuery({
    table,
    query: `select=${COLUMNS}&kind=eq.reply&status=eq.failed&order=approved_at.asc&limit=500`,
  });
  if (!read.ok || !Array.isArray(read.data)) {
    console.error(`Could not read ${table}: ${String(read.error || 'no rows array').slice(0, 300)}`);
    process.exit(2);
  }
  const failed = read.data;
  const target = failed.filter((r) => String(r.error || '').includes(ERROR_MARK)
    && (r.posted_url === LINK || !r.posted_url)
    && String(r.approved_at || '').startsWith('2026-11-18'));
  const others = failed.filter((r) => !target.includes(r) && /substack\.com\/profile\//.test(String(r.posted_url || '')));

  console.log(`${failed.length} failed Substack repl${failed.length === 1 ? 'y' : 'ies'} in all.`);
  if (others.length) {
    console.log(`\n${others.length} OTHER failed repl${others.length === 1 ? 'y has' : 'ies have'} a /profile/ link — listed, NOT touched:`);
    for (const r of others) console.log(show(r) + '\n');
  }
  if (target.length !== 1) {
    console.error(`\nExpected exactly one row to correct, found ${target.length}. Nothing written.`);
    for (const r of target) console.error(show(r) + '\n');
    process.exit(target.length === 0 ? 3 : 1);
  }

  const row = target[0];
  // When it went out: the worker began posting at posting_started_at (3:51 PM
  // MT) and the screenshot shows the reply live at 3:53; the start is the one
  // instant the row recorded, so it stands for both.
  const postedAt = row.posting_started_at || row.updated_at;
  const patch = { status: 'posted', posted_url: LINK, posted_at: postedAt, error: '', updated_at: new Date().toISOString() };
  console.log('\nThe row to correct:\n' + show(row));
  console.log(`\nWould write: status posted, posted link ${LINK}, posted at ${mountain(postedAt)}, error cleared.`);
  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Add --apply to write it.');
    return;
  }

  const write = await sbQuery({
    method: 'PATCH',
    table,
    query: `id=eq.${encodeURIComponent(row.id)}&status=eq.failed`,
    body: patch,
    headers: { Prefer: 'return=representation' },
  });
  if (!write.ok) {
    console.error(`The write failed: ${String(write.error).slice(0, 300)}`);
    process.exit(1);
  }
  if (!Array.isArray(write.data) || write.data.length !== 1) {
    console.error(`The write matched ${Array.isArray(write.data) ? write.data.length : 'an unknown number of'} rows, not one — the row moved since it was read.`);
    process.exit(1);
  }

  const back = await sbQuery({ table, query: `select=${COLUMNS}&id=eq.${encodeURIComponent(row.id)}` });
  const now = back.ok && Array.isArray(back.data) ? back.data[0] : null;
  if (!now) {
    console.error(`Written, but the read-back failed: ${String(back.error || 'no row').slice(0, 300)}`);
    process.exit(2);
  }
  console.log('\nRead back:\n' + show(now));
  if (now.status !== 'posted' || now.posted_url !== LINK || now.error) {
    console.error('\nThe read-back does not match what was written.');
    process.exit(1);
  }
  console.log('\nCorrected: the reply reads as posted, with its link.');
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
