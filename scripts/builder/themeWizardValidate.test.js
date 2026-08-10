'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHex,
  contrastRatio,
  validateThemePatch,
  applyLockedValues,
} = require('../../lib/themeWizardValidate');

/**
 * Everything here guards the boundary between "a model wrote some JSON" and
 * "this is a theme we will render". Spec §6.5: a malformed patch must fail the
 * candidate, not corrupt a preview.
 */

test('hex colours are normalised, and non-colours are not colours', () => {
  assert.equal(normalizeHex('#AABBCC'), '#aabbcc');
  assert.equal(normalizeHex('aabbcc'), '#aabbcc');
  assert.equal(normalizeHex('#abc'), '#aabbcc', 'shorthand expands');
  assert.equal(normalizeHex('rebeccapurple'), '', 'CSS names are not accepted');
  assert.equal(normalizeHex('rgb(1,2,3)'), '');
  assert.equal(normalizeHex(''), '');
  assert.equal(normalizeHex(null), '');
});

test('a well-formed patch passes and keeps its values', () => {
  const result = validateThemePatch({
    primaryColor: '#111111',
    backgroundColor: '#ffffff',
    typography: {
      fonts: { heading: 'playfair', body: 'inter' },
      colors: { text: '#222222', link: '#0055aa' },
      scale: { baseSize: 16, ratio: 1.25, baseLineHeight: 1.5 },
    },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.patch.typography.fonts.heading, 'playfair');
  assert.equal(result.patch.typography.scale.baseSize, 16);
});

test('an invented font family fails the candidate outright', () => {
  // A font key outside the list renders as nothing at all. Silently dropping it
  // would hand the operator a candidate whose whole type character is missing
  // and ask them to judge it.
  const result = validateThemePatch({
    primaryColor: '#111111',
    typography: { fonts: { heading: 'Georgia, serif', body: 'inter' } },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Georgia, serif.*not an available font/);
});

test('font keys are matched case-insensitively', () => {
  const result = validateThemePatch({ typography: { fonts: { heading: 'Playfair' } } });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.patch.typography.fonts.heading, 'playfair');
});

test('out-of-range scale values are clamped, not rejected', () => {
  const result = validateThemePatch({
    primaryColor: '#111111',
    typography: { scale: { baseSize: 400, ratio: 9, baseLineHeight: 1.5 } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.patch.typography.scale.baseSize, 24);
  assert.equal(result.patch.typography.scale.ratio, 1.8);
  assert.equal(result.warnings.length, 2, 'clamping is recorded, not silent');
});

test('contrast ratio matches the WCAG anchors', () => {
  // Black on white is the 21:1 ceiling; a colour against itself is the 1:1
  // floor. If either anchor drifts, every pair check below it is meaningless.
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(contrastRatio('#3366aa', '#3366aa'), 1);
  assert.equal(
    contrastRatio('#000000', '#ffffff'),
    contrastRatio('#ffffff', '#000000'),
    'order must not matter'
  );
});

test('a well-formed role palette passes with normalised hexes', () => {
  const result = validateThemePatch({
    palette: {
      surface: '#FFFFFF', surfaceText: '#1a2733',
      band: '#eef4fb', bandText: '#1a2733',
      inverse: '#12294a', inverseText: '#f2f7fd',
      header: '#12294a', headerText: '#ffffff',
      button: '#2f7d32', buttonText: '#ffffff',
    },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.patch.palette.surface, '#ffffff');
  assert.equal(result.patch.palette.inverse, '#12294a');
});

test('an unreadable palette pair fails the candidate', () => {
  // "Navy text on navy" is not a bold look, it is a bug the preview would
  // faithfully render and ask the operator to judge.
  const result = validateThemePatch({
    palette: { inverse: '#12294a', inverseText: '#1a3055' },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /inverseText on palette\.inverse is unreadable/);
});

test('a low-but-legible palette pair is a warning, not a failure', () => {
  const result = validateThemePatch({
    palette: { button: '#2f7d32', buttonText: '#d9ead9' },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.match(result.warnings.join(' '), /buttonText on palette\.button is low-contrast/);
});

test('unknown palette roles are dropped and bad colours warned', () => {
  const result = validateThemePatch({
    palette: {
      surface: '#ffffff',
      surfaceText: 'charcoal-ish',
      glow: '#ff00ff',
    },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(Object.keys(result.patch.palette), ['surface']);
  assert.match(result.warnings.join(' '), /surfaceText: "charcoal-ish" is not a colour/);
});

test('a palette that is not an object fails the candidate', () => {
  const result = validateThemePatch({ palette: 'moody blues' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /palette must be an object/);
});

test('keys outside colours-and-typography are dropped', () => {
  // Spec §2 scopes the wizard to colours and typography. borderRadius and
  // logoWideId are real BuilderTheme fields — they are still not this feature's
  // to write.
  const result = validateThemePatch({
    primaryColor: '#111111',
    borderRadius: 40,
    logoWideId: 'asset_123',
    somethingInvented: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.patch), ['primaryColor']);
});

test('a patch with nothing usable in it fails', () => {
  // An empty patch previews as "no change", which reads to the operator as a
  // boring option rather than a broken one.
  const result = validateThemePatch({ borderRadius: 12 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /nothing usable/);
});

test('non-objects fail rather than throwing', () => {
  for (const bad of [null, undefined, 'a string', 42, ['array']]) {
    const result = validateThemePatch(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should fail`);
  }
});

test('locked values overwrite whatever the model returned', () => {
  // Spec §6.4 is explicitly belt and braces: the lock is stated in the prompt
  // AND enforced here, because a prompt constraint is a request.
  const { patch, overridden } = applyLockedValues(
    { primaryColor: '#ff0000', typography: { fonts: { heading: 'bebas' } } },
    { primaryColor: '#1a4d8f', 'typography.fonts.heading': 'lora' },
  );
  assert.equal(patch.primaryColor, '#1a4d8f');
  assert.equal(patch.typography.fonts.heading, 'lora');
  assert.deepEqual(overridden.sort(), ['primaryColor', 'typography.fonts.heading']);
});

test('a locked path the model omitted entirely is still created', () => {
  const { patch } = applyLockedValues({}, { 'typography.colors.link': '#0055aa' });
  assert.equal(patch.typography.colors.link, '#0055aa');
});

test('applying locks does not mutate the input patch', () => {
  const original = { primaryColor: '#ff0000' };
  applyLockedValues(original, { primaryColor: '#000000' });
  assert.equal(original.primaryColor, '#ff0000', 'the caller keeps what it had');
});

test('a value the model already matched is not reported as overridden', () => {
  const { overridden } = applyLockedValues({ primaryColor: '#1a4d8f' }, { primaryColor: '#1a4d8f' });
  assert.deepEqual(overridden, [], 'obedience should not look like a correction');
});

test('treatments are bounded: tint normalised, opacity clamped, flags boolean', () => {
  const result = validateThemePatch({
    treatments: {
      heroOverlay: '#12294D',
      heroOverlayOpacity: 0.9,
      cardOverlap: 'true',
      footerInverse: false,
    },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.patch.treatments.heroOverlay, '#12294d'.replace('#12294d', '#12294d'));
  // 0.9 would black out the photo; the cap is 0.75 and the clamp is recorded.
  assert.equal(result.patch.treatments.heroOverlayOpacity, 0.75);
  assert.match(result.warnings.join(' '), /clamped to 0.75/);
  assert.equal(result.patch.treatments.cardOverlap, true);
  assert.equal(result.patch.treatments.footerInverse, false);
});

test('malformed treatments degrade without failing the candidate', () => {
  const result = validateThemePatch({
    primaryColor: '#111111',
    treatments: { heroOverlay: 'darkish', cardOverlap: 'maybe' },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.patch.treatments, undefined, 'nothing usable means no treatments key');
  assert.equal(result.warnings.length, 2);
});
