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
  // "Custom form builder coming soon. Standard fields are shown for now."
  // reached visitors on a published contact form for the whole of ticket
  // 86bbugd2e, through three rounds of review, because none of the phrases
  // above match it — it names no admin area, it just talks about the Builder
  // as a product. A visitor has no idea what is coming, or to whom.
  //
  // "coming soon" ALONE is not the defect, and matching it alone is wrong:
  // BuilderPublicSitePage renders "Coming soon." when a URL has no published
  // page, which is correct copy for a visitor and must keep rendering. What
  // makes it a leak is the line ALSO naming our tooling. Hence the AND below
  // — the lookahead is the "coming soon" half, the tail is the tooling half,
  // and either may come first.
  /(?=.*\bcoming soon\b).*\b(?:builder|module|editor)\b/i,
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

/*
 * Attributes that are MACHINERY — the value is never read by a visitor, so a
 * phrase found inside one is not a leak. Everything else on a JSX line is kept
 * and tested.
 *
 * The list is deny-by-default on purpose, and it was allow-by-default for one
 * round (ticket 86bbvqcbk, round-2 review). Blanking every attribute except a
 * short "visible" list also blanked ordinary React props that carry visitor
 * copy, which is a shape that appears throughout the scanned files:
 *
 *   caught on main, MISSED by an allow-list:
 *     <EmptyState message="No posts found. Add posts in the Messaging section." />
 *     <Note text="Set a Form ID in module settings" />
 *
 * Both phrases are landmine 16's own examples. A prop name cannot be predicted
 * — message, text, label, emptyText, caption, whatever the component chose —
 * so the only list that can be complete is the list of things a visitor
 * definitely cannot read.
 *
 * What this list has to keep out is the case it was added for: className etc.
 * turned every `builder-*` CSS class into evidence that a line "names our
 * tooling", so the coming-soon rule matched ordinary tenant copy —
 *
 *   no     <p>Coming soon.</p>
 *   MATCH  <p className="builder-public-site-empty">Coming soon.</p>      <- wrong
 *   MATCH  <div className="builder-preview-module">Our clubhouse is coming soon.</div>
 *
 * scripts/builder/builderOnlyNotesVisibleText.test.js pins BOTH directions:
 * those four stay clean, and a phrase passed as a prop is still caught.
 */
const MACHINERY_ATTRS = new Set([
  'classname', 'style', 'href', 'src', 'srcset', 'key', 'id', 'ref', 'type', 'role',
  'target', 'rel', 'name', 'htmlfor', 'width', 'height', 'loading', 'method', 'action',
]);

/**
 * Is this attribute machinery — something a visitor can never read?
 *
 * `data-*` always is. `aria-*` mostly is, but aria-label and aria-description
 * are spoken to a screen-reader user, so they are text a person receives and
 * stay in scope.
 */
function isMachineryAttr(name) {
  const attr = name.toLowerCase();
  if (attr === 'aria-label' || attr === 'aria-description') return false;
  if (attr.startsWith('data-') || attr.startsWith('aria-')) return true;
  return MACHINERY_ATTRS.has(attr);
}

const ATTR = /([A-Za-z][A-Za-z0-9_:-]*)\s*=\s*("[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})/g;

/**
 * The part of a line a visitor would actually read: text between the tags,
 * plus every attribute value that is not machinery.
 */
function visibleText(line) {
  return line.replace(ATTR, (match, name) =>
    (isMachineryAttr(name) ? `${name}=` : match));
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
    const code = visibleText(line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''));
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

module.exports = { run, BUILDER_PHRASES, visibleText };
