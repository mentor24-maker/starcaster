'use strict';

/**
 * Give the already-imported posts the tags their source had (86bbu503t).
 *
 * The blog bulk importer did not read tags until 86bbu4zve, so the posts
 * imported before it landed carry an empty `tags` array while their tags sit
 * intact in the snapshot they were built from. This re-derives them.
 *
 * It calls the SAME extraction the importer now uses
 * (`lib/blogImportExtract.js`) rather than carrying its own copy or a
 * hardcoded list — two definitions of "what the tags are" would drift, and
 * the whole point is that the answer comes from the data.
 *
 * A post is matched to its snapshot BY SLUG. A post with no matching snapshot
 * is reported as COULD NOT CHECK, by name, and left alone: "this post has no
 * tags in its source" and "I could not find its source" are different answers
 * and only one of them means the row is already correct.
 *
 * DRY RUN BY DEFAULT. It prints exactly what it would write and changes
 * nothing until --apply, and it reads every row back afterwards rather than
 * trusting the write (landmine 12).
 *
 *   doppler run --project starcaster --config prd -- \
 *     node scripts/blog_backfill_import_tags.cjs --project <projectId>
 *   doppler run --project starcaster --config prd -- \
 *     node scripts/blog_backfill_import_tags.cjs --project <projectId> --apply
 */

// Local runs read .env.local, the same two files and the same order server.js
// uses. A production run gets its credentials from doppler, where no .env
// exists and `override: false` makes this a no-op — so the rehearsal on a
// local copy and the real run are the same program.
try {
  const dotenv = require('dotenv');
  dotenv.config();
  dotenv.config({ path: '.env.local', override: false });
} catch {
  // dotenv is a dev dependency; absent in production, which is fine.
}

const { sbQuery, tableConfig } = require('../lib/supabase');
const { buildCandidate } = require('../lib/blogImportExtract');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] || '') : '';
}
const APPLY = process.argv.includes('--apply');

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * What this run would do to each post, as one of four outcomes. A post is only
 * ever in one of them, and every post is in exactly one — a post that fell
 * through every branch would be silently untouched, which is the shape of an
 * all-clear that checked nothing.
 */
function planTags(posts, snapshotsBySlug) {
  const writes = [];
  const noSource = [];
  const noTagsInSource = [];
  const alreadyTagged = [];

  for (const post of posts) {
    if (Array.isArray(post.tags) && post.tags.length > 0) {
      alreadyTagged.push(post);
      continue;
    }
    const snapshot = snapshotsBySlug.get(normalizeSlug(post.slug));
    if (!snapshot) {
      noSource.push(post);
      continue;
    }
    const candidate = buildCandidate(snapshot);
    if (!candidate.tagsFound) {
      noTagsInSource.push(post);
      continue;
    }
    writes.push({ id: post.id, title: post.title, slug: post.slug, tags: candidate.tags });
  }

  return { writes, noSource, noTagsInSource, alreadyTagged };
}

async function main() {
  const projectId = arg('project');
  if (!projectId) {
    console.error('Usage: node scripts/blog_backfill_import_tags.cjs --project <projectId> [--apply]');
    process.exit(1);
  }
  const scope = `project_id=eq.${encodeURIComponent(projectId)}`;

  const postsRes = await sbQuery({
    table: tableConfig().blogPosts,
    query: `select=id,title,slug,status,tags&${scope}&order=created_at.asc&limit=1000`,
  });
  if (!postsRes.ok) {
    console.error('Could not read blog_posts:', String(postsRes.error).slice(0, 300));
    process.exit(2);
  }

  const snapsRes = await sbQuery({
    table: tableConfig().builderPublishedPages,
    query: `select=page_id,slug,payload,published_at&${scope}&limit=1000`,
  });
  if (!snapsRes.ok) {
    console.error('Could not read builder_published_pages:', String(snapsRes.error).slice(0, 300));
    process.exit(2);
  }

  const posts = Array.isArray(postsRes.data) ? postsRes.data : [];
  const snapshots = Array.isArray(snapsRes.data) ? snapsRes.data : [];
  const snapshotsBySlug = new Map();
  for (const row of snapshots) {
    const key = normalizeSlug(row.slug);
    if (key && !snapshotsBySlug.has(key)) snapshotsBySlug.set(key, row);
  }

  const { writes, noSource, noTagsInSource, alreadyTagged } = planTags(posts, snapshotsBySlug);

  console.log(`${posts.length} post(s) and ${snapshots.length} snapshot(s) in ${projectId}\n`);
  console.log(`  ${writes.length} would get tags`);
  console.log(`  ${alreadyTagged.length} already have tags (left alone)`);
  console.log(`  ${noTagsInSource.length} have a snapshot that carries no tags`);
  console.log(`  ${noSource.length} COULD NOT CHECK — no snapshot matched their address\n`);

  for (const w of writes) {
    console.log(`  ${w.slug}`);
    console.log(`      -> ${w.tags.join(', ')}`);
  }
  for (const p of noTagsInSource) {
    console.log(`  no tags in source: ${p.slug} — ${String(p.title).slice(0, 55)}`);
  }
  for (const p of noSource) {
    console.log(`  COULD NOT CHECK: ${p.slug || '(no address)'} — ${String(p.title).slice(0, 55)}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Add --apply to perform these changes.');
    process.exit(0);
  }
  if (!writes.length) {
    console.log('\nNothing to do.');
    process.exit(0);
  }

  console.log('\nApplying…');
  let failed = 0;
  for (const w of writes) {
    const upd = await sbQuery({
      method: 'PATCH',
      table: tableConfig().blogPosts,
      query: `id=eq.${encodeURIComponent(w.id)}&${scope}`,
      headers: { Prefer: 'return=minimal' },
      body: { tags: w.tags, updated_at: new Date().toISOString() },
    });
    if (!upd.ok) {
      failed += 1;
      console.log(`  FAILED ${w.id}: ${String(upd.error).slice(0, 160)}`);
    }
  }

  // Read back rather than trusting the writes.
  const after = await sbQuery({
    table: tableConfig().blogPosts,
    query: `select=id,slug,tags&${scope}&limit=1000`,
  });
  if (!after.ok) {
    console.log(`\nCOULD NOT VERIFY — the read-back failed: ${String(after.error).slice(0, 160)}`);
    process.exit(2);
  }
  const afterById = new Map((Array.isArray(after.data) ? after.data : []).map((p) => [p.id, p]));
  let unverified = 0;
  console.log('\nverified by re-reading each row:');
  for (const w of writes) {
    const stored = afterById.get(w.id);
    const tags = Array.isArray(stored && stored.tags) ? stored.tags : [];
    const ok = tags.length === w.tags.length && tags.every((t, i) => t === w.tags[i]);
    if (!ok) unverified += 1;
    console.log(`  ${ok ? 'ok  ' : 'DIFF'} ${w.slug}: ${tags.join(', ') || '(empty)'}`);
  }
  console.log(`\n  write failures: ${failed}`);
  console.log(`  rows that did not read back as written: ${unverified}`);
  process.exit(failed || unverified ? 1 : 0);
}

// Exported so the planning half can be tested without a database; the run
// itself only happens when this file is invoked as a program.
module.exports = { planTags, normalizeSlug };

if (require.main === module) {
  main();
}
