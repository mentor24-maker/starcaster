'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The bulk template change's REPORT must not be able to rewrite the verdict of
 * the run it is reporting on.
 *
 * public/js/builder.js is parsed by nothing but the browser (landmine 9), so
 * the two defects below survived review, a full gate run and a real browser
 * pass. Both are structural — a call site and a brace — so both can be
 * asserted from here without a browser, and this file exists so a fourth call
 * site cannot be added without the guard.
 *
 * WHAT WENT WRONG (round 3's send-back, 2026-09-05):
 *
 *  1. The success report was built INSIDE the write's try. Every sentence this
 *     operation shows is worded in /shared/bulkTemplateOutcome.js, a separate
 *     <script> tag; with that one file blocked, wording a clean run threw a
 *     TypeError, the catch swallowed it, and a run in which every page moved
 *     and verified told the operator:
 *
 *       Cannot read properties of undefined (reading
 *       'describeBulkTemplateOutcome'). Some pages may already have been
 *       changed; the list has been reloaded. Restore All from Archives if this
 *       is not what you wanted.
 *
 *     Restore All rolls every page in the project back to the archive point
 *     and takes any unrelated edit made since with it — a destructive action
 *     recommended after nothing went wrong.
 *
 *  2. The pre-flight catch dereferenced the module with no guard at all, so in
 *     the same case the TypeError escaped as an unhandled rejection and the
 *     operator got no message whatever; the button simply re-enabled.
 *
 * Rounds 1 and 2 were sent back for the same defect in two other spellings: a
 * could-not-tell rendered as a definite answer, and a definite answer rendered
 * as a could-not-tell. It has never once been the write path.
 */

const BUILDER_JS = path.join(__dirname, '..', '..', 'public', 'js', 'builder.js');
const source = fs.readFileSync(BUILDER_JS, 'utf8');

/** The body of `name`, braces matched, so a test can reason about one function. */
function functionBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is gone from public/js/builder.js`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`could not find the end of ${name}`);
}

/**
 * The guard, lifted out and actually run.
 *
 * It closes over nothing but `App`, so it can be executed here rather than
 * described — which is the difference between this test failing when the guard
 * is removed and merely noticing that the text changed.
 */
function loadSayBulkTemplate(App) {
  const body = functionBody(source, 'sayBulkTemplate');
  // eslint-disable-next-line no-new-func
  const make = new Function('App', `function sayBulkTemplate(fnName, args, fallbackMessage) ${body}; return sayBulkTemplate;`);
  return make(App);
}

test('the module is dereferenced in exactly one place', () => {
  const code = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const hits = code.match(/App\.bulkTemplateOutcome/g) || [];
  assert.equal(
    hits.length,
    1,
    `App.bulkTemplateOutcome is reached ${hits.length} time(s); it must be reached only inside sayBulkTemplate, `
      + 'because an unguarded call site is a TypeError thrown from the handler that is supposed to be reporting.',
  );
  assert.match(functionBody(source, 'sayBulkTemplate'), /App\.bulkTemplateOutcome/);
});

test('a missing module falls back to the caller\'s sentence instead of throwing', () => {
  const say = loadSayBulkTemplate({});
  const said = say('describeBulkTemplateOutcome', { rows: [] }, 'the fallback sentence');
  assert.equal(said.message, 'the fallback sentence');
  assert.equal(said.isError, true);
});

test('a module that loaded WITHOUT the function falls back too', () => {
  // A stale cached bundle is the same failure as a missing one, and reads as
  // "the module is there" to a truthiness check.
  const say = loadSayBulkTemplate({ bulkTemplateOutcome: {} });
  assert.equal(say('describeBulkTemplateOutcome', {}, 'the fallback sentence').message, 'the fallback sentence');
});

test('when the module IS there, its wording is what the operator gets', () => {
  const outcomes = require('../../public/shared/bulkTemplateOutcome');
  const say = loadSayBulkTemplate({ bulkTemplateOutcome: outcomes });
  const said = say(
    'describeBulkTemplateOutcome',
    { rows: [{ ok: true, verified: true }, { ok: true, verified: true }], templateName: 'Website Main' },
    'the fallback sentence',
  );
  assert.equal(said.message, '2 pages moved to Website Main, all confirmed. Undo from Archives.');
  assert.equal(said.isError, false);
});

test('no fallback recommends Restore All, and none claims pages may have changed', () => {
  // The three fallbacks are the sentences shown when the module is absent —
  // the one case where the tested wording cannot run. They are the last place
  // this defect could come back, and they are unreachable from a browser test.
  // Comments are stripped rather than quoted around, so this reads whatever
  // wording is actually in the code — single-quoted, template literal or
  // otherwise. The dialog's own warning DOES offer Restore All, correctly, and
  // lives in another function.
  const code = functionBody(source, 'runBulkChangeTemplate')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  assert.ok(code.includes('sayBulkTemplate('), 'the report no longer goes through the guard');
  assert.doesNotMatch(
    code,
    /Restore All/,
    'a sentence in the write path recommends Restore All — which rolls the whole project back — '
      + 'and the paths that can reach it include ones where nothing went wrong',
  );
  assert.doesNotMatch(
    code,
    /may already have been changed/,
    'a fallback claims damage it cannot know about; the tested wording in /shared/ makes that call, not this file',
  );
});

test('the write\'s try holds the request and nothing else', () => {
  // The catch below this try says pages may have been re-poured. Anything else
  // inside it — a report, a notify, a dialog close — can therefore turn its own
  // failure into a false account of the operation. That is exactly what
  // happened: `App.bulkTemplateOutcome.describeBulkTemplateOutcome(...)` sat
  // one line above the catch that swallowed it.
  const body = functionBody(source, 'runBulkChangeTemplate');
  const marker = body.indexOf("api('/api/builder/landing-pages/bulk-set-template'");
  assert.notEqual(marker, -1, 'the bulk-set-template request is gone');
  const tryStart = body.lastIndexOf('try {', marker);
  assert.notEqual(tryStart, -1, 'the request is not inside a try');
  const block = functionBody(`function x() ${body.slice(tryStart + 'try '.length)}`, 'x');

  for (const forbidden of ['notify(', 'sayBulkTemplate(', 'refreshPagesTableAfterBulkChange(']) {
    assert.ok(
      !block.includes(forbidden),
      `${forbidden} is inside the write's try, so its own failure would be reported as the write failing`,
    );
  }
  assert.ok(block.includes('bulk-set-template'), 'the request itself should still be in there');
});
