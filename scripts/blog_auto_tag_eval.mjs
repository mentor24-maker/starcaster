#!/usr/bin/env node
/**
 * Measure the deterministic tag scorer against the tags authors already chose.
 * READ-ONLY. Nothing is written anywhere.
 *
 *   doppler run --project starcaster --config prd --no-check-version -- \
 *     npm run eval:auto-tag -- --project proj_1786047238296_opepjk
 *   npm run eval:auto-tag -- --from posts.json          # a JSON array of posts
 *   ... --thresholds 0.2,0.3,0.4,0.5,0.6  --max 5  --seed 7  --sample 10
 *
 * Leave-one-out: for every post that has tags, hide its tags, rebuild the
 * profiles from the OTHER posts (the full vocabulary kept, so a tag only this
 * post carried survives as an own-words profile), suggest, and compare.
 * Head = tags carried by 2+ posts (the centroid helps); tail = tags on exactly
 * one post (own words only). Reported separately on purpose.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { buildTagProfiles, suggestTags, collapseKey, normalizeTags, DEFAULT_THRESHOLD } = require('./lib/blogAutoTag.js');

const args = process.argv.slice(2);
const flagValue = (name, fallback = null) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
const PROJECT = flagValue('--project');
const FROM = flagValue('--from');
const THRESHOLDS = String(flagValue('--thresholds', '0.2,0.25,0.3,0.35,0.4,0.5,0.6')).split(',').map(Number).filter(Number.isFinite);
const MAX = Number(flagValue('--max', 5)) || 5;
const SEED = Number(flagValue('--seed', 7)) || 7;
const SAMPLE = Number(flagValue('--sample', 10)) || 10;
const SHOW_AT = Number(flagValue('--show-at', DEFAULT_THRESHOLD));
const OWN_WEIGHT = flagValue('--own-weight') == null ? undefined : Number(flagValue('--own-weight'));
const MIN_EVIDENCE = Number(flagValue('--min-evidence', 1)) || 1;
const LIST_ALL = args.includes('--list-all');

if (!PROJECT && !FROM) {
  console.error('Usage: --project <projectId> (under doppler --config prd) or --from <posts.json>');
  process.exit(1);
}

async function loadPosts() {
  if (FROM) return JSON.parse(readFileSync(FROM, 'utf8'));
  if (!process.env.SUPABASE_URL) { console.error('No SUPABASE_URL — run under doppler, or pass --from.'); process.exit(1); }
  const { listPosts } = require('./lib/blogPostsStore.js');
  const scope = { projectId: PROJECT, userId: '' };
  const all = [];
  // The limit is the first argument's field, capped at 100 a page (landmine 12); walk every page.
  for (let page = 1; page < 100; page++) {
    const batch = await listPosts({ page, limit: 100 }, scope);
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const pct = (num, den) => (den ? `${(100 * num / den).toFixed(0)}%` : 'n/a');

const started = Date.now();
const posts = await loadPosts();
const tagged = posts.filter((p) => normalizeTags(p.tags).length);
const tagUse = new Map();
for (const p of posts) for (const t of normalizeTags(p.tags)) { const k = collapseKey(t); tagUse.set(k, (tagUse.get(k) || 0) + 1); }
const vocabulary = [...new Set(posts.flatMap((p) => normalizeTags(p.tags)))];
console.log(`Project: ${PROJECT || FROM}   posts=${posts.length} tagged=${tagged.length} distinctTags=${vocabulary.length} (near-duplicate groups=${tagUse.size}; head=${[...tagUse.values()].filter((n) => n >= 2).length}, tail=${[...tagUse.values()].filter((n) => n === 1).length})`);
console.log(`Leave-one-out over ${tagged.length} tagged posts, max ${MAX} suggestions per post, ownTermWeight=${OWN_WEIGHT ?? 'default'}, minEvidence=${MIN_EVIDENCE}.\n`);

// One model per held-out post; suggestions at threshold 0 once, filtered per threshold after.
const perPost = tagged.map((post) => {
  const others = posts.map((q) => (q.id === post.id ? { ...q, tags: [] } : q));
  const model = buildTagProfiles(others, { vocabulary, ownTermWeight: OWN_WEIGHT });
  const real = new Set(normalizeTags(post.tags).map(collapseKey));
  const all = suggestTags({ ...post, tags: [] }, model, { threshold: 0, max: 1000, minEvidence: MIN_EVIDENCE });
  return { post, real, all };
});

const rows = [];
for (const threshold of THRESHOLDS) {
  let suggested = 0, hits = 0, covered = 0, realHead = 0, realTail = 0, hitHead = 0, hitTail = 0;
  for (const { real, all } of perPost) {
    const picks = all.filter((s) => s.score >= threshold).slice(0, MAX);
    suggested += picks.length;
    if (picks.length) covered++;
    const pickKeys = new Set(picks.map((s) => collapseKey(s.tag)));
    for (const k of real) {
      const head = (tagUse.get(k) || 0) >= 2;
      if (head) realHead++; else realTail++;
      if (pickKeys.has(k)) { hits++; if (head) hitHead++; else hitTail++; }
    }
  }
  rows.push({ threshold, suggested, precision: pct(hits, suggested), recall: pct(hits, realHead + realTail), recallHead: pct(hitHead, realHead), recallTail: pct(hitTail, realTail), coverage: pct(covered, perPost.length) });
}
console.log('threshold  suggested  precision  recall(all)  recall(head)  recall(tail)  coverage');
for (const r of rows) console.log(`${String(r.threshold).padEnd(9)}  ${String(r.suggested).padEnd(9)}  ${r.precision.padEnd(9)}  ${r.recall.padEnd(11)}  ${r.recallHead.padEnd(12)}  ${r.recallTail.padEnd(12)}  ${r.coverage}`);
console.log('\nprecision = suggested tags the author also chose / suggested;  recall = author tags recovered / author tags;  coverage = posts with 1+ suggestion');

if (LIST_ALL) {
  console.log(`\nEVERY suggestion at threshold ${SHOW_AT} (✓ = author chose it; blank = judge it):`);
  for (const { post, real, all } of perPost) {
    const picks = all.filter((s) => s.score >= SHOW_AT).slice(0, MAX);
    if (!picks.length) continue;
    console.log(`- ${String(post.title || post.id).slice(0, 80)}   [author: ${normalizeTags(post.tags).join(', ').slice(0, 120)}]`);
    for (const s of picks) console.log(`    ${real.has(collapseKey(s.tag)) ? '✓' : ' '} ${s.tag} [${s.score}] (${s.evidence.join(', ')})`);
  }
}
const rand = mulberry32(SEED);
const sample = [...perPost].sort(() => 0).filter(() => true).map((x, i) => [rand(), i, x]).sort((a, b) => a[0] - b[0]).slice(0, SAMPLE).map((x) => x[2]);
console.log(`\n${sample.length} random posts (seed ${SEED}) at threshold ${SHOW_AT} — ✓ = the author chose it too:`);
for (const { post, real, all } of sample) {
  const picks = all.filter((s) => s.score >= SHOW_AT).slice(0, 3);
  const line = picks.length ? picks.map((s) => `${real.has(collapseKey(s.tag)) ? '✓' : ' '} ${s.tag} [${s.score}] (${s.evidence.join(', ')})`).join(' | ') : '(no suggestion)';
  console.log(`- ${String(post.title || post.id).slice(0, 70)}\n    author: ${normalizeTags(post.tags).join(', ')}\n    → ${line}`);
}
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. Read-only: nothing was written.`);
