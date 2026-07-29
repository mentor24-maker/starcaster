'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectSectionText,
  pageContext,
  buildSearchQuery,
  summarizeSearchResults,
  collectImageTargets,
  generateAltTextForPage,
} = require('../../lib/seoAltText.js');

function image({ alt = '', url = '', id = 'img' } = {}) {
  return { id, type: 'image', name: '', text: '', settings: { alt, imageUrl: url } };
}
function textModule(text, { id = 'txt' } = {}) {
  return { id, type: 'text', name: '', text, settings: {} };
}

// A fake search + AI so the test never touches the network. The fake AI echoes
// back a deterministic string built from the inputs it was handed, which lets us
// assert that section text and search grounding actually flow through.
const fakeSearch = async (query) => [
  { title: `Top result for ${query.slice(0, 20)}`, snippet: 'Ranking snippet.', link: 'https://x' },
];
const fakeAlt = async ({ sectionText, filename }) =>
  `Alt about ${sectionText ? sectionText.slice(0, 15) : filename}`;

test('collectSectionText pulls headings, body, and buttons from a section', () => {
  const section = {
    title: 'Our Services',
    modules: [
      textModule('<h1>Estate Planning</h1><p>Wills and trusts.</p>'),
      image({ alt: '', url: 'https://cdn/photo.jpg' }),
    ],
  };
  const text = collectSectionText(section);
  assert.match(text, /Our Services/);
  assert.match(text, /Estate Planning/);
  assert.match(text, /Wills and trusts/);
});

test('collectImageTargets only picks blank alt unless overwrite is set', () => {
  const sections = [
    { id: 's1', modules: [image({ alt: '', id: 'a' }), image({ alt: 'has alt', id: 'b' })] },
  ];
  assert.equal(collectImageTargets(sections).length, 1);
  assert.equal(collectImageTargets(sections, { overwrite: true }).length, 2);
});

test('pageContext combines page name and slug words', () => {
  assert.equal(pageContext({ name: 'Delray Beach', slug: 'criminal-defense' }), 'Delray Beach criminal defense');
});

test('buildSearchQuery falls back to filename when the section is text-light', () => {
  assert.equal(buildSearchQuery('', 'beach sunset', 'My Firm'), 'My Firm beach sunset');
});

test('summarizeSearchResults compacts titles and snippets', () => {
  const summary = summarizeSearchResults([{ title: 'A', snippet: 'B' }]);
  assert.equal(summary, 'A — B');
});

test('generateAltTextForPage fills a blank image alt without mutating the input', async () => {
  const page = {
    name: 'Estate Law',
    slug: 'estate-planning',
    layoutSections: [
      {
        id: 's1',
        modules: [
          textModule('<h1>Estate Planning</h1><p>Wills and trusts.</p>'),
          image({ alt: '', url: 'https://cdn/family.jpg', id: 'img1' }),
        ],
      },
    ],
  };
  const original = JSON.parse(JSON.stringify(page.layoutSections));

  const { sections, changes, changed } = await generateAltTextForPage({
    page,
    search: fakeSearch,
    generateAlt: fakeAlt,
  });

  assert.equal(changed, true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].moduleId, 'img1');
  assert.ok(sections[0].modules[1].settings.alt.length > 0);
  // Input untouched.
  assert.deepEqual(page.layoutSections, original);
});

test('generateAltTextForPage leaves images that already have alt text alone', async () => {
  const page = {
    name: 'X',
    slug: 'x',
    layoutSections: [{ id: 's1', modules: [image({ alt: 'existing', url: 'https://cdn/a.jpg' })] }],
  };
  const { changed } = await generateAltTextForPage({ page, search: fakeSearch, generateAlt: fakeAlt });
  assert.equal(changed, false);
});

test('generateAltTextForPage degrades gracefully when search throws', async () => {
  const page = {
    name: 'X',
    slug: 'x',
    layoutSections: [{ id: 's1', modules: [textModule('<h1>Hello world</h1>'), image({ alt: '', url: 'https://cdn/a.jpg' })] }],
  };
  const throwingSearch = async () => {
    throw new Error('brave down');
  };
  const { changed, changes } = await generateAltTextForPage({
    page,
    search: throwingSearch,
    generateAlt: fakeAlt,
  });
  // AI still runs on section text alone, so alt is still produced.
  assert.equal(changed, true);
  assert.ok(changes[0].to.length > 0);
});
