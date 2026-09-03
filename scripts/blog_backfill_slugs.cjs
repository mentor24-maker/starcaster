'use strict';

/**
 * Give every blog post an address (86bbu23n7).
 *
 * A post with a blank slug cannot be reached: the public blog addresses a post
 * BY slug, so the row exists, the manager lists it, and the link goes nowhere.
 * Five of Delray's published posts were in that state — written through the
 * Create Post form, whose Slug field says "auto-generated if blank" while the
 * store wrote the empty string it was handed. The store now derives one
 * (lib/slugify.js); this repairs the rows written before it did.
 *
 * It also re-normalizes any slug that does not match the rule, so a post saved
 * with capitals or punctuation before today ends up where the new rule says it
 * lives.
 *
 * DRY RUN BY DEFAULT. It prints exactly what it would write and changes
 * nothing until --apply, and it reads every row back afterwards rather than
 * trusting the write (landmine 12).
 *
 *   doppler run --project starcaster --config prd -- \
 *     node scripts/blog_backfill_slugs.cjs --project <projectId>
 *   doppler run --project starcaster --config prd -- \
 *     node scripts/blog_backfill_slugs.cjs --project <projectId> --apply
 */

const { sbQuery, tableConfig } = require('../lib/supabase');
const { slugify } = require('../lib/slugify');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] || '') : '';
}
const APPLY = process.argv.includes('--apply');

/**
 * The address each post should have, with collisions suffixed. Resolved
 * against the WHOLE set at once — including the slugs this run is about to
 * assign — because two untitled-alike posts would otherwise both be handed
 * the same new address and the second write would fail on the unique index.
 */
function planSlugs(rows) {
  const taken = new Set();
  for (const p of rows) {
    const current = String(p.slug || '').trim();
    if (current && current === slugify(current)) taken.add(current);
  }
  const plan = [];
  for (const p of rows) {
    const current = String(p.slug || '').trim();
    const wanted = slugify(current) || slugify(p.title);
    if (!wanted) {
      plan.push({ id: p.id, title: p.title, from: current, to: '', skip: 'no title to derive an address from' });
      continue;
    }
    if (wanted === current) continue; // already correct — nothing to write
    let candidate = wanted;
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${wanted}-${n}`;
    taken.add(candidate);
    plan.push({ id: p.id, title: p.title, from: current, to: candidate, status: p.status });
  }
  return plan;
}

(async () => {
  const projectId = arg('project');
  if (!projectId) {
    console.error('Usage: node scripts/blog_backfill_slugs.cjs --project <projectId> [--apply]');
    process.exit(1);
  }

  const res = await sbQuery({
    table: tableConfig().blogPosts,
    query:
      `select=id,title,slug,status&project_id=eq.${encodeURIComponent(projectId)}` +
      '&order=created_at.asc&limit=1000',
  });
  if (!res.ok) {
    console.error('Could not read blog_posts:', String(res.error).slice(0, 300));
    process.exit(2);
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  const plan = planSlugs(rows);
  const writes = plan.filter((p) => p.to);
  const stuck = plan.filter((p) => p.skip);

  console.log(`${rows.length} post(s) in ${projectId}`);
  console.log(`${writes.length} need a new address, ${stuck.length} cannot be given one, ${rows.length - plan.length} already correct\n`);
  for (const p of writes) {
    console.log(`  ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}   [${p.status}] ${String(p.title).slice(0, 55)}`);
  }
  for (const p of stuck) {
    console.log(`  SKIPPED ${p.id}: ${p.skip}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Add --apply to perform these changes.');
    return;
  }
  if (!writes.length) {
    console.log('\nNothing to do.');
    return;
  }

  console.log('\nApplying…');
  let failed = 0;
  for (const p of writes) {
    const upd = await sbQuery({
      method: 'PATCH',
      table: tableConfig().blogPosts,
      query: `id=eq.${encodeURIComponent(p.id)}&project_id=eq.${encodeURIComponent(projectId)}`,
      headers: { Prefer: 'return=minimal' },
      body: { slug: p.to, updated_at: new Date().toISOString() },
    });
    if (!upd.ok) {
      failed += 1;
      console.log(`  FAILED ${p.id}: ${String(upd.error).slice(0, 160)}`);
    }
  }

  // Read back rather than trusting the writes.
  const after = await sbQuery({
    table: tableConfig().blogPosts,
    query: `select=id,title,slug,status&project_id=eq.${encodeURIComponent(projectId)}&limit=1000`,
  });
  const afterRows = Array.isArray(after.data) ? after.data : [];
  const stillBlank = afterRows.filter((p) => !String(p.slug || '').trim());
  const nonConforming = afterRows.filter((p) => {
    const s = String(p.slug || '').trim();
    return s && s !== slugify(s);
  });
  console.log(`\nverified by re-reading ${afterRows.length} row(s):`);
  console.log(`  still blank      : ${stillBlank.length}`);
  console.log(`  still non-conforming: ${nonConforming.length}`);
  console.log(`  write failures   : ${failed}`);
  for (const p of stillBlank) console.log(`    blank: ${p.id} ${String(p.title).slice(0, 60)}`);
  process.exit(failed || stillBlank.length ? 1 : 0);
})();
