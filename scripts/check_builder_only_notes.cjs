#!/usr/bin/env node
'use strict';

/**
 * scripts/check_builder_only_notes.cjs — fail on an instruction addressed to
 * the page BUILDER that can reach a visitor.
 *
 * A module that finds nothing sometimes explains itself: "Set a Form ID in
 * module settings", "Add tags in the Messaging section", "Add posts in module
 * settings". That text is written for whoever is building the page. It also
 * renders on the published tenant site, where the reader has no module
 * settings, no Messaging section and nothing they can do — so at best it is
 * noise on a client's site and at worst it reads as the site being broken.
 *
 * Dane reported exactly that on 2026-09-03: "No tags found. Add tags in the
 * Messaging section." printed under a blog post on delraytennis.starcaster.pro.
 * Six of these were live when he asked, and two had ALREADY been fixed the
 * same day in PR #576 — the shape came straight back, because nothing stopped
 * it. That is what this check is for.
 *
 * The rule: any such string must sit inside a <BuilderOnlyNote>, which renders
 * null when `liveSite` is true. Guarding by hand with `if (liveSite)` is fine
 * too and is not flagged, as long as the phrase itself is inside the component.
 *
 * Separate script and separate BLOCKING CI step for the reason
 * check_machine_paths.cjs gives: check_conventions.cjs --all runs
 * continue-on-error in CI, so a rule folded only into it is advisory.
 *
 *   npm run check:builder-notes
 *   node scripts/check_builder_only_notes.cjs --all
 */

const fs = require('fs');
const { execSync } = require('child_process');

const SELF = 'scripts/check_builder_only_notes.cjs';

/*
 * Phrases that address the person editing the page. Deliberately narrow: each
 * one names a place only an admin can reach, so ordinary visitor-facing copy
 * ("no results found", "nothing here yet") is untouched. A phrase list beats a
 * cleverer heuristic here — a false positive on a client's real copy would
 * teach people to reach for SKIP_CONVENTIONS.
 */
const BUILDER_PHRASES = [
  /\bin module settings\b/i,
  /\bin the Messaging section\b/i,
  /\bin Builder\s*›/i,
  /\bAdd (?:tags|topics|posts|items) in the\b/i,
];

// Files that actually render tenant pages. A phrase in a settings PANEL is
// fine — panels are only ever seen in the Builder.
const RENDER_FILES = [
  'components/builder-template-preview.tsx',
  'components/builder-preview-page.tsx',
  'components/BuilderPublicSitePage.tsx',
];

const ADVICE =
  'Wrap it in <BuilderOnlyNote liveSite={liveSite}>…</BuilderOnlyNote>, which\n' +
  '    renders nothing on a published page, and thread liveSite into the component\n' +
  '    if it does not have it yet. If the note is the ONLY thing the module would\n' +
  '    render, return null on a live site instead — a lone heading over empty space\n' +
  '    is the same defect wearing a hat. See docs/DOCTRINE.md and PR #576.';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Is this line inside a <BuilderOnlyNote> block?
 *
 * Scans backwards for the nearest opening or closing tag. Crude on purpose:
 * the alternative is parsing TSX, and a check that is hard to reason about
 * gets bypassed rather than fixed.
 */
function insideBuilderOnlyNote(lines, index) {
  // The note's own line first. An inline
  // `<BuilderOnlyNote …>text</BuilderOnlyNote>` carries both tags, and
  // scanning backwards from the line's end met the CLOSING one first and
  // called a correctly guarded note a leak. A false positive is worse than a
  // missed one here: it teaches people to reach for SKIP_CONVENTIONS, and
  // then the check is off for everything.
  if (lines[index].includes('<BuilderOnlyNote')) return true;
  for (let i = index - 1; i >= 0 && index - i < 40; i -= 1) {
    if (lines[i].includes('</BuilderOnlyNote>')) return false;
    if (lines[i].includes('<BuilderOnlyNote')) return true;
  }
  return false;
}

function scan(content, where, failures) {
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    // A phrase inside a comment is documentation, including this file's own
    // explanation and the comments left on every fix.
    const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    const hit = BUILDER_PHRASES.find((re) => re.test(code));
    if (!hit) return;
    if (insideBuilderOnlyNote(lines, i)) return;
    failures.push(
      `Builder-only instruction can reach a visitor, ${where}:${i + 1}\n` +
      `    ${line.trim().slice(0, 110)}\n` +
      `    ${ADVICE}`,
    );
  });
}

/**
 * @param {{ all?: boolean }} opts
 * @returns {{ failures: string[], notes: string[] }}
 */
function run(opts = {}) {
  const failures = [];
  const notes = [];
  let scanned = 0;

  for (const file of RENDER_FILES) {
    if (file === SELF || !fs.existsSync(file)) continue;
    scan(fs.readFileSync(file, 'utf8'), file, failures);
    scanned += 1;
  }

  // Never a silent pass: if the files this check exists for are not there, the
  // check did not run, and that is not the same as finding nothing.
  if (scanned === 0) {
    failures.push(
      'check_builder_only_notes scanned NO files — every path in RENDER_FILES is missing.\n' +
      '    A renamed renderer silently disables this check, so it fails instead.',
    );
  } else {
    notes.push(`builder-only notes: ${scanned} render file(s) scanned, ${failures.length} leak(s).`);
  }
  void sh;
  void opts;
  return { failures, notes };
}

if (require.main === module) {
  const { failures, notes } = run({ all: process.argv.includes('--all') });
  for (const note of notes) console.log(`[builder-notes] ${note}`);
  if (failures.length) {
    console.error('\n[builder-notes] Blocked — a note meant for the page builder would render to visitors:\n');
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    process.exit(1);
  }
  console.log('[builder-notes] OK — every builder-only instruction is guarded.');
}

module.exports = { run, BUILDER_PHRASES };
