'use strict';

/**
 * The two judgements behind a before/after shot (scripts/ui/visual-diff.mjs).
 *
 * WHY THESE ARE TESTED AND THE HARNESS IS NOT
 * `shoot_changes.mjs` needs a checkout, a git history, a dev server and a real
 * browser, so nothing in CI can run a line of it. Everything decided inside it
 * is therefore decided untested — which is fine for plumbing and not fine for
 * these two, because both fail SILENTLY. A surface list missing `src/css/`
 * reports "no visual change" on a restyle; a comparison with a tolerance
 * reports "no visual change" on a button that moved. Both read exactly like a
 * clean run.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../ui/visual-diff.mjs');

/** Raw-pixel buffers shaped the way sharp hands them over. */
function pixels(width, height, fill = [0, 0, 0, 255]) {
  const channels = fill.length;
  const data = Buffer.alloc(width * height * channels);
  for (let p = 0; p < width * height; p += 1) {
    for (let c = 0; c < channels; c += 1) data[p * channels + c] = fill[c];
  }
  return { data, width, height, channels };
}

test('a stylesheet edit counts as a visual change', async () => {
  const { visualFilesIn } = await load();
  assert.deepEqual(visualFilesIn(['src/css/_builder-react-overrides.css']), ['src/css/_builder-react-overrides.css']);
});

test('a renderer edit counts, and so does the page model behind it', async () => {
  const { visualFilesIn } = await load();
  assert.deepEqual(
    visualFilesIn(['components/builder-template-preview.tsx', 'lib/builder-client/builder-template.ts']),
    ['components/builder-template-preview.tsx', 'lib/builder-client/builder-template.ts']
  );
});

test('server routes, docs and scripts do not', async () => {
  const { visualFilesIn } = await load();
  assert.deepEqual(visualFilesIn(['routes/builder.js', 'docs/WORK-LOG.md', 'scripts/ship_thread.cjs']), []);
});

test('a file path is matched exactly, not by prefix', async () => {
  // `public/builder-preview.html` is listed as a FILE. Matching it as a prefix
  // would drag in `public/builder-preview.html.bak` and, worse, a rule written
  // as `public/` later would quietly pull in every built artifact — and the
  // built artifacts change on every build, so the harness would shoot on
  // every run and the operator would stop reading the results.
  const { visualFilesIn } = await load();
  assert.deepEqual(visualFilesIn(['public/builder-preview.html']), ['public/builder-preview.html']);
  assert.deepEqual(visualFilesIn(['public/builder-bundle.js', 'public/app-shell.html']), []);
});

test('identical pixels are identical', async () => {
  const { comparePixels } = await load();
  const result = comparePixels(pixels(4, 4), pixels(4, 4));
  assert.equal(result.identical, true);
  assert.equal(result.changedPixels, 0);
});

test('ONE differing channel on ONE pixel is a change — there is no tolerance', async () => {
  // The whole method rests on this. A "close enough" comparison hides the 1px
  // border and the two-shade colour shift, which are precisely the changes
  // that need a human eye rather than a pixel count.
  const { comparePixels } = await load();
  const after = pixels(4, 4);
  after.data[5] += 1; // pixel 1, green channel
  const result = comparePixels(pixels(4, 4), after);
  assert.equal(result.identical, false);
  assert.equal(result.changedPixels, 1);
  assert.match(result.summary, /first at 1,0/);
});

test('a pixel differing on several channels is still ONE changed pixel', async () => {
  const { comparePixels } = await load();
  const after = pixels(4, 4);
  after.data[0] = 9; after.data[1] = 9; after.data[2] = 9;
  assert.equal(comparePixels(pixels(4, 4), after).changedPixels, 1);
});

test('a box that changed size is a change, not a crash', async () => {
  // Comparing buffers of different lengths index-by-index would either throw
  // or read undefined and call it equal. A module that got taller is one of
  // the most common real results, so it has to be the reported answer.
  const { comparePixels } = await load();
  const result = comparePixels(pixels(4, 4), pixels(4, 8));
  assert.equal(result.identical, false);
  assert.match(result.summary, /4×4 → 4×8/);
});

test('the summary reports how much moved and never whether it is right', async () => {
  // DOCTRINE §5.14: a pixel count proves something changed, never that it
  // changed correctly. Wording that implied a verdict would be read as one.
  const { comparePixels, describeChange } = await load();
  const after = pixels(10, 10);
  after.data[0] = 200;
  const line = describeChange('typography', comparePixels(pixels(10, 10), after));
  assert.match(line, /^typography: 1 of 100 pixels differ/);
  assert.doesNotMatch(line, /wrong|broken|regress|ok\b/i);
});
