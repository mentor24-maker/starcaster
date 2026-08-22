'use strict';

/**
 * The parsing half of `npm run check:css`.
 *
 * Lives here rather than beside the script because `npm run test:builder`
 * already globs this folder and already runs in CI, so the scanner is covered
 * from the day it lands — before the browser half can be gated (thread T2).
 *
 * Every case below is a mistake this scanner actually made while it was being
 * written, not a hypothetical. The comments say which.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../ui/css-source-scan.mjs');

test('finds declarations with the line the human would open', async () => {
  const { scanCssSource } = await load();
  const { declarations } = scanCssSource('.a {\n  color: red;\n  max-width: 4px;\n}\n', 'x.css');
  assert.equal(declarations.length, 2);
  assert.deepEqual(
    declarations.map((d) => [d.prop, d.value, d.line]),
    [['color', 'red', 2], ['max-width', '4px', 3]]
  );
  assert.equal(declarations[0].file, 'x.css');
});

test('a selector is not a declaration, and neither is an at-rule prelude', async () => {
  const { scanCssSource } = await load();
  const { declarations } = scanCssSource(
    '@media (min-width: 700px) {\n  a:hover {\n    color: red;\n  }\n}\n'
  );
  // `(min-width: 700px)` and `a:hover` both contain a colon; only one real
  // declaration exists here.
  assert.deepEqual(declarations.map((d) => d.prop), ['color']);
});

test('a data URI keeps its colons and semicolons to itself', async () => {
  const { scanCssSource } = await load();
  // THE CASE THAT BREAKS NAIVE SPLITTING: `url(data:image/svg+xml;base64,…)`
  // carries both separators inside parens. Splitting on either turns one
  // working rule into two fake findings.
  const { declarations } = scanCssSource(
    ".i {\n  background: url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=);\n  color: red;\n}\n"
  );
  assert.equal(declarations.length, 2);
  assert.match(declarations[0].value, /^url\(data:image\/svg\+xml;base64,/);
  assert.equal(declarations[1].prop, 'color');
});

test('comments and strings do not swallow the rules around them', async () => {
  const { scanCssSource } = await load();
  const { declarations } = scanCssSource(
    '/* color: fake; */\n.a {\n  content: "a; b: c";\n  color: red;\n}\n'
  );
  assert.deepEqual(declarations.map((d) => d.prop), ['content', 'color']);
});

test('strips !important without losing the declaration', async () => {
  const { scanCssSource } = await load();
  const { declarations } = scanCssSource('.a { color: red !important; }');
  assert.equal(declarations[0].value, 'red');
  assert.equal(declarations[0].important, true);
});

test('records @keyframes names, including a vendor-prefixed one', async () => {
  const { scanCssSource } = await load();
  const { keyframes } = scanCssSource(
    '@keyframes sc-effect-turn { to { rotate: 360deg } }\n' +
    '@-webkit-keyframes sc-effect-hop { to { translate: 0 -10px } }\n'
  );
  assert.deepEqual(keyframes.map((k) => k.name), ['sc-effect-turn', 'sc-effect-hop']);
});

test('sibling declarations share a block, so a prefixed twin is findable', async () => {
  const { scanCssSource } = await load();
  // `line-clamp: 2` beside a working `-webkit-line-clamp: 2` is deliberate
  // future-proofing. Knowing they are siblings is the only way to tell that
  // from a genuinely dead line.
  const { declarations } = scanCssSource(
    '.a {\n  -webkit-line-clamp: 2;\n  line-clamp: 2;\n}\n.b {\n  line-clamp: 3;\n}\n'
  );
  const [webkit, twin, lonely] = declarations;
  assert.equal(webkit.block, twin.block);
  assert.notEqual(lonely.block, twin.block);
});

test('a var() fallback is not an animation name', async () => {
  const { animationNamesFromDeclaration } = await load();
  // THE BUG THIS CAUGHT: splitting the value on every comma cut
  // `var(--sc-effect-travel-duration, 8s)` in half and reported `8s)` as an
  // animation with no keyframes — five times, against working image effects.
  assert.deepEqual(
    animationNamesFromDeclaration(
      'animation',
      'sc-effect-travel var(--sc-effect-travel-duration, 8s) linear infinite'
    ),
    ['sc-effect-travel']
  );
});

test('reads the name out of a full animation shorthand, wherever it sits', async () => {
  const { animationNamesFromDeclaration } = await load();
  assert.deepEqual(
    animationNamesFromDeclaration('animation', '3s ease-in 1s 2 reverse both paused slidein'),
    ['slidein']
  );
  assert.deepEqual(
    animationNamesFromDeclaration('animation', 'spin 2s cubic-bezier(0.4, 0, 0.2, 1), hop 1s steps(4, end)'),
    ['spin', 'hop']
  );
  assert.deepEqual(animationNamesFromDeclaration('animation-name', 'a, b'), ['a', 'b']);
});

test('says nothing about names it cannot know, and nothing about other properties', async () => {
  const { animationNamesFromDeclaration } = await load();
  assert.deepEqual(animationNamesFromDeclaration('animation-name', 'none'), []);
  // A name arriving through a variable is unknowable from the source; a guess
  // here would report a keyframe that does not exist and is not missing.
  assert.deepEqual(animationNamesFromDeclaration('animation-name', 'var(--which)'), []);
  assert.deepEqual(animationNamesFromDeclaration('color', 'red'), []);
});

test('a var() with a fallback is a decision, without one is a risk', async () => {
  const { varUsesFromValue } = await load();
  assert.deepEqual(varUsesFromValue('var(--a)'), [{ name: '--a', hasFallback: false }]);
  assert.deepEqual(varUsesFromValue('var(--a, 3px)'), [{ name: '--a', hasFallback: true }]);
  assert.deepEqual(
    varUsesFromValue('calc(var(--a) + var(--b, 2px))'),
    [{ name: '--a', hasFallback: false }, { name: '--b', hasFallback: true }]
  );
});

test('finds a custom property defined outside CSS, in both shapes it takes', async () => {
  const { customPropertiesInSource } = await load();
  const found = customPropertiesInSource(
    'el.style.setProperty("--sc-effect-bounce", x);\n' +
    '<section style="--auth-bg-image: url(\'/a.jpg\')">\n'
  );
  assert.ok(found.has('--sc-effect-bounce'));
  // The inline-style shape. Missing it reported a variable that IS defined,
  // and a check that cries wolf on working code gets skipped.
  assert.ok(found.has('--auth-bg-image'));
});

test('collects every class a selector mentions, including compound ones', async () => {
  const { classSelectorsInCss } = await load();
  const found = classSelectorsInCss('.a .b > .c:hover, .d.e { color: red }');
  for (const name of ['a', 'b', 'c', 'd', 'e']) assert.ok(found.has(name), name);
});

test('finds prefixed classes the code emits, with the line to open', async () => {
  const { prefixedClassesInSource } = await load();
  const hits = prefixedClassesInSource(
    'const a = 1;\n<div className="starcaster-effect-spin" />\n',
    ['starcaster-effect-']
  );
  assert.deepEqual(hits, [{ name: 'starcaster-effect-spin', line: 2 }]);
});

test('says nothing about a class it cannot resolve from the text', async () => {
  const { prefixedClassesInSource } = await load();
  // Interpolated and concatenated names are unknowable here, and reporting
  // the fragment would flag working code. The effect sweep in check:render
  // covers the dynamic case by enumerating the real option list instead.
  assert.deepEqual(
    prefixedClassesInSource('`starcaster-effect-${value}`', ['starcaster-effect-']),
    []
  );
  assert.deepEqual(
    prefixedClassesInSource('"builder-preview-image-" + variant', ['builder-preview-']),
    []
  );
});

test('splits only on top-level commas', async () => {
  const { splitTopLevel } = await load();
  assert.deepEqual(splitTopLevel('a, b'), ['a', ' b']);
  assert.deepEqual(splitTopLevel('rgb(1, 2, 3), b'), ['rgb(1, 2, 3)', ' b']);
});
