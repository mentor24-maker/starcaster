#!/usr/bin/env node
/**
 * Give every untagged font in the library AI tags (Font Library 5/7, task
 * 86bchyd4k).
 *
 *   npm run fonts:autotag              dry run: asks the AI, prints the proposed tags per font, writes nothing
 *   npm run fonts:autotag -- --apply   the same, and saves them
 *
 * Which database it reads and writes is whatever SUPABASE_URL says, and it
 * prints which one first. Local:      doppler run --project starcaster --config dev -- npm run fonts:autotag
 *                                     Production: doppler run --project starcaster --config prd -- npm run fonts:autotag
 *
 * Only fonts with NO tags are touched, in both modes. A font that already has
 * tags — a person's edits, or an earlier run's — is counted and left alone,
 * and the write itself refuses a font whose tags appeared after it was read
 * (lib/fontsStore.js fillEmptyFontTags). So a second --apply writes nothing.
 *
 * Both modes ask the AI, so the dry run costs the same few cents as the real
 * one: the proposals ARE the dry run's output.
 *
 * Exit: 0 done, 1 some font could not be tagged (named; run again — it
 *       resumes), 2 could not start (no database, no font table).
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { isConfigured: supabaseConfigured } = require('../lib/supabase');
const fontsStore = require('../lib/fontsStore');
const { suggestFontTags } = require('../lib/fontAutoTag');
const { classify } = require('../lib/environmentBanner');

const CONCURRENCY = 4;
const apply = process.argv.slice(2).includes('--apply');

function out(line = '') { process.stdout.write(`${line}\n`); }
function stop(code, line) { process.stderr.write(`${line}\n`); process.exit(code); }

async function eachLimited(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function main() {
  if (!supabaseConfigured()) stop(2, 'No database is configured (SUPABASE_URL / SUPABASE_SERVICE_KEY). Run it under doppler run.');
  out(`Database: ${classify(process.env.SUPABASE_URL)} (${process.env.SUPABASE_URL})`);
  out(apply ? 'Mode: APPLY — tags will be saved.' : 'Mode: dry run — nothing will be saved. Add --apply to save.');

  const listed = await fontsStore.listAllFontsForScript(5000);
  if (!listed.ok) stop(2, `Could not read the font library: ${listed.error || listed.status}`);
  const fonts = listed.data;
  const untagged = fonts.filter((f) => !f.tags.length);
  out(`Fonts: ${fonts.length} in total, ${fonts.length - untagged.length} already tagged (left alone), ${untagged.length} to tag.`);
  out('');

  const counts = { proposed: 0, saved: 0, skipped: 0, failed: 0 };
  const failures = [];
  await eachLimited(untagged, CONCURRENCY, async (font) => {
    const where = font.visibility === 'platform' ? 'shared' : `project ${font.projectId}`;
    const suggested = await suggestFontTags(font, { scope: font.projectId ? { projectId: font.projectId } : undefined });
    if (!suggested.ok) {
      counts.failed += 1;
      failures.push(`${font.family}: ${suggested.error}`);
      out(`  FAILED   ${font.family} (${where}) — ${suggested.error}`);
      return;
    }
    counts.proposed += 1;
    if (!apply) {
      out(`  propose  ${font.family} (${where}): ${suggested.tags.join(', ')}`);
      return;
    }
    const saved = await fontsStore.fillEmptyFontTags(font.id, suggested.tags);
    if (saved.ok) {
      counts.saved += 1;
      out(`  saved    ${font.family} (${where}): ${saved.data.tags.join(', ')}`);
    } else if (saved.status === 409) {
      counts.skipped += 1;
      out(`  left     ${font.family} (${where}) — ${saved.error}`);
    } else {
      counts.failed += 1;
      failures.push(`${font.family}: ${saved.error || saved.status}`);
      out(`  FAILED   ${font.family} (${where}) — ${saved.error || saved.status}`);
    }
  });

  out('');
  out(apply
    ? `Done: ${counts.saved} tagged, ${counts.skipped} left alone (tagged meanwhile), ${counts.failed} failed, `
      + `${fonts.length - untagged.length} already tagged before the run.`
    : `Dry run: ${counts.proposed} proposals, ${counts.failed} failed. Nothing was saved.`);
  if (failures.length) {
    out('Run it again to retry the failures — it only ever touches untagged fonts.');
    process.exit(1);
  }
}

main().catch((err) => stop(1, `fonts:autotag stopped: ${err?.stack || err}`));
