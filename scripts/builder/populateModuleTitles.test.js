'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TITLE_SOURCES,
  DEFAULT_TITLE_PRIORITY,
  normalizePriority,
  deriveTitle,
  populateTitlesInSections,
} = require('../../lib/populateModuleTitles.js');

function heading(text, { level = 'h2', column = 'left', fontSize } = {}) {
  return { id: `h-${text}`, type: 'heading', column, name: '', text, settings: { level, ...(fontSize ? { fontSize } : {}) } };
}
function image({ alt = '', url = '', column = 'left' } = {}) {
  return { id: `img-${alt || url}`, type: 'image', column, name: '', text: '', settings: { alt, imageUrl: url } };
}
function button(text, { column = 'left' } = {}) {
  return { id: `btn-${text}`, type: 'button', column, name: '', text, settings: {} };
}
function textModule(text, { column = 'left' } = {}) {
  return { id: `txt`, type: 'text', column, name: '', text, settings: {} };
}

test('left-most heading beats a right-side heading', () => {
  const modules = [
    heading('Left Column Title', { level: 'h2', column: 'left' }),
    heading('Right Column Title', { level: 'h1', column: 'right' }),
  ];
  // Even though the right heading is an H1 (larger), left-most has higher priority.
  assert.equal(deriveTitle(modules, DEFAULT_TITLE_PRIORITY), 'Left Column Title');
});

test('largest heading wins within the same column', () => {
  const modules = [
    heading('Small One', { level: 'h4', column: 'left' }),
    heading('Big One', { level: 'h1', column: 'left' }),
  ];
  assert.equal(deriveTitle(modules, DEFAULT_TITLE_PRIORITY), 'Big One');
});

test('font size breaks a heading-level tie', () => {
  const modules = [
    heading('Thirty Two', { level: 'h2', column: 'left', fontSize: '32' }),
    heading('Forty Eight', { level: 'h2', column: 'left', fontSize: '48' }),
  ];
  assert.equal(deriveTitle(modules, DEFAULT_TITLE_PRIORITY), 'Forty Eight');
});

test('right-side heading only applies when there are two columns', () => {
  // Single-column section: a right-side rule must not fire; fall through works.
  const single = [heading('Only Heading', { column: 'left' })];
  assert.equal(deriveTitle(single, ['heading-rightside', 'heading-leftmost']), 'Only Heading');
});

test('falls back to left-most image alt when no heading', () => {
  const modules = [
    image({ alt: 'A friendly golden retriever', column: 'left' }),
    image({ alt: 'A cat', column: 'right' }),
  ];
  assert.equal(deriveTitle(modules, DEFAULT_TITLE_PRIORITY), 'A friendly golden retriever');
});

test('image filename is the last-resort fallback', () => {
  const modules = [image({ url: 'https://cdn.example.com/assets/happy_team-photo.jpg', column: 'left' })];
  assert.equal(deriveTitle(modules, DEFAULT_TITLE_PRIORITY), 'happy team photo');
});

test('button label and text first-line feed titles when configured', () => {
  assert.equal(deriveTitle([button('Get Started Today')], DEFAULT_TITLE_PRIORITY), 'Get Started Today');
  assert.equal(
    deriveTitle([textModule('<p>First paragraph line.</p><p>Second.</p>')], DEFAULT_TITLE_PRIORITY),
    'First paragraph line.'
  );
});

test('priority order is honored — image before heading when reordered', () => {
  const modules = [heading('Heading Wins Normally', { column: 'left' }), image({ alt: 'Image Alt', column: 'left' })];
  const imageFirst = ['image-leftmost', 'heading-leftmost'];
  assert.equal(deriveTitle(modules, imageFirst), 'Image Alt');
});

test('normalizePriority drops unknown keys and appends missing ones', () => {
  const result = normalizePriority(['image-leftmost', 'bogus', 'image-leftmost']);
  assert.equal(result[0], 'image-leftmost');
  assert.equal(new Set(result).size, result.length, 'no duplicates');
  assert.equal(result.length, TITLE_SOURCES.length, 'every known source present');
});

test('populateTitlesInSections fills blanks only by default', () => {
  const sections = [
    {
      id: 's1',
      title: '',
      modules: [heading('Welcome Home', { column: 'left' })],
    },
    {
      id: 's2',
      title: 'Kept Title',
      modules: [heading('Ignored For Section', { column: 'left' })],
    },
  ];
  const { sections: out, changes, changed } = populateTitlesInSections(sections, {});
  assert.equal(changed, true);
  assert.equal(out[0].title, 'Welcome Home');
  assert.equal(out[0].modules[0].name, 'Welcome Home');
  assert.equal(out[1].title, 'Kept Title', 'existing title left untouched');
  // s2 module still gets a name (its own name was blank).
  assert.equal(out[1].modules[0].name, 'Ignored For Section');
  assert.ok(changes.some((c) => c.level === 'section' && c.to === 'Welcome Home'));
});

test('overwrite replaces existing titles', () => {
  const sections = [{ id: 's1', title: 'Old', modules: [heading('New Heading', { column: 'left' })] }];
  const { sections: out } = populateTitlesInSections(sections, { overwrite: true });
  assert.equal(out[0].title, 'New Heading');
});

test('input sections are not mutated', () => {
  const sections = [{ id: 's1', title: '', modules: [heading('Immutable', { column: 'left' })] }];
  const snapshot = JSON.stringify(sections);
  populateTitlesInSections(sections, {});
  assert.equal(JSON.stringify(sections), snapshot, 'original left unchanged');
});

test('a section with no titelable content produces no change', () => {
  const sections = [{ id: 's1', title: '', modules: [{ id: 'code1', type: 'code', column: 'left', name: '', text: 'x=1', settings: {} }] }];
  const { changed } = populateTitlesInSections(sections, {});
  assert.equal(changed, false);
});

test('auto-generated "Content Block" placeholder titles are replaced in blanks-only mode', () => {
  const sections = [
    { id: 's1', title: 'Content Block 1', modules: [heading('Our Services', { column: 'left' })] },
    { id: 's2', title: 'Content Block 2', modules: [heading('About Us', { column: 'left' })] },
  ];
  const { sections: out, changes } = populateTitlesInSections(sections, {});
  assert.equal(out[0].title, 'Our Services', 'Content Block 1 replaced');
  assert.equal(out[1].title, 'About Us', 'Content Block 2 replaced');
  assert.ok(changes.some((c) => c.level === 'section' && c.from === 'Content Block 1' && c.to === 'Our Services'));
});

test('a real, operator-chosen title is left alone in blanks-only mode', () => {
  // Module already named too, so nothing at all should change.
  const named = { id: 'm1', type: 'heading', column: 'left', name: 'Heading Named', text: 'Different Heading', settings: { level: 'h2' } };
  const sections = [{ id: 's1', title: 'Meet Our Attorneys', modules: [named] }];
  const { sections: out, changed } = populateTitlesInSections(sections, {});
  assert.equal(out[0].title, 'Meet Our Attorneys', 'real title untouched');
  assert.equal(changed, false);
});

test('placeholder module names are replaced too', () => {
  const sections = [{
    id: 's1',
    title: 'Kept',
    modules: [{ id: 'm1', type: 'heading', column: 'left', name: 'Content Block 3', text: 'Contact Us', settings: { level: 'h2' } }],
  }];
  const { sections: out } = populateTitlesInSections(sections, {});
  assert.equal(out[0].modules[0].name, 'Contact Us', 'placeholder module name replaced');
});

test('a Content-Block placeholder with no derivable content keeps its old name (no blanking)', () => {
  const sections = [{ id: 's1', title: 'Content Block 9', modules: [{ id: 'c', type: 'code', column: 'left', name: '', text: 'x', settings: {} }] }];
  const { sections: out, changed } = populateTitlesInSections(sections, {});
  assert.equal(out[0].title, 'Content Block 9', 'unchanged when nothing to derive');
  assert.equal(changed, false);
});
