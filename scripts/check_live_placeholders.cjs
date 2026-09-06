#!/usr/bin/env node
'use strict';

/**
 * scripts/check_live_placeholders.cjs — render every Builder module type as a
 * VISITOR would see it, and fail on Builder-time scaffolding that reaches them.
 *
 * Ticket 86bbvqcbk. Four review rounds of 86bbugd2e each closed the placeholder
 * the round before had named and missed the next one; three were still live on
 * client sites at the end of it — "Post body will appear here when opened with
 * ?post=slug." on delraytennis.starcaster.pro/blog-post and on a law firm's
 * public site, "?event=your-event-slug" on the events page, and "Use the Create
 * Post module" on five published pages across two tenants.
 *
 * check_builder_only_notes.cjs GREPS the source, and could not have found any
 * of those three: none carries a phrase on its list and none is an
 * `x.length ? x : PLACEHOLDER` fallback — they are plain JSX branches. The only
 * way to see them is to render the module and read the text. So this is the
 * sibling gate, and the two are complementary rather than redundant:
 *
 *   check:builder-notes      static, fast, catches a KNOWN PHRASE anywhere
 *   check:live-placeholders  renders 61 module types in 3 placements, catches
 *                            a phrase FAMILY wherever it actually comes out
 *
 * The sweep itself is a vitest file, because rendering React needs jsdom and
 * the repo already has that wired. This script exists so it is also a named,
 * blocking gate in pre-commit and CI — the same reason check_builder_only_notes
 * is its own step rather than a rule folded into check_conventions --all, which
 * runs continue-on-error in CI.
 *
 *   npm run check:live-placeholders
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SWEEP = 'components/builder-live-placeholder-sweep.test.tsx';

function fail(message) {
  console.error(`\n[live-placeholders] ${message}\n`);
  process.exit(1);
}

// Never a silent pass: a renamed or deleted sweep is the check not running,
// which is not the same as the check finding nothing.
if (!fs.existsSync(path.join(ROOT, SWEEP))) {
  fail(
    `Cannot run — ${SWEEP} is missing.\n` +
    '    That file IS this gate. If it moved, update SWEEP here; if it was\n' +
    '    deleted, 61 module types are no longer being rendered for visitors.',
  );
}

const result = spawnSync(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', SWEEP],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CI: '1' } },
);

if (result.error) {
  fail(
    `Cannot run — vitest did not start (${result.error.message}).\n` +
    '    This is "could not take a reading", not a pass. Run `npm ci` and try again.',
  );
}

if (result.status !== 0) {
  fail(
    'Blocked — a module renders Builder-time text to visitors.\n' +
    '    The failing test names the module, the placement and the phrase, and\n' +
    '    prints what a visitor would actually read.\n\n' +
    '    Guard it on `liveSite`: render nothing, or ordinary visitor copy that\n' +
    '    names the reason (landmine 17). Where the note is ALL the module would\n' +
    '    render, return null — a lone heading over empty space is the same\n' +
    '    defect. If the module is genuinely admin-only, add it to ADMIN_ALLOWED\n' +
    `    in ${SWEEP} WITH ITS REASON.`,
  );
}

console.log('[live-placeholders] OK — every module type renders visitor-safe text in all three placements.');
