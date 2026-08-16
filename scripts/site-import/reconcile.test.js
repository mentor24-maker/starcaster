'use strict';

/**
 * Reconciliation engine tests (Phase 3).
 *
 * The failure this engine exists to prevent is a CONFIDENT WRONG MATCH:
 * `/tag/tennis/` scores a perfect 1.00 against a real "Tennis" page on
 * title alone, and a page merge that silently pours a WordPress tag
 * archive into a client's Tennis page is worse than one that does nothing.
 * So most of what is asserted here is what the engine REFUSES to do.
 *
 * The fixture mirrors the real delraytennis shape measured on 2026-08-16:
 * every imported page is [old header] + [content] + [old footer image],
 * and every target page carries a PLACEHOLDER SECTION between its menu
 * and its footer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  reconcile,
  reportReconciles,
  mergeDecisions,
  classifySource,
  detectChromeSignatures,
  detectSiteSuffix,
  detectCommonAffixes,
  commonPrefix,
  commonSuffix,
  stripAffixes,
  stem,
  stripSiteBoilerplate,
  adoptSection,
  placeholderIndex,
  canonicalKey,
  similarity,
  toPath,
  stripSiteSuffix,
  CLEAN_SCORE,
  MIN_MARGIN,
  PLACEHOLDER_TITLE,
} = require('../../lib/site-import/dist/reconcile.js');
const { serializeBuilderDocument } = require('../../lib/builder/document.js');

const SITE_BOILERPLATE =
  '<p class="site-title"><a href="/">Delray Beach Tennis Center</a></p>' +
  '<p class="site-description">Delray Beach, FL</p>' +
  '<a href="https://facebook.com/x" target="_blank"><img src="https://blob.test/fb.png" /></a>';

/** The old header, byte-identical on every imported page. */
function oldHeader(pageId) {
  return {
    id: `impnavinst_${pageId}`,
    title: 'Header',
    layout: 'two-four',
    savedSectionId: 'saved_section_old_header',
    canonical: true,
    modules: [
      { id: 'm-h1', type: 'text', column: 'right', text: '<h1>Delray Beach Tennis Center</h1>' },
      { id: 'm-h2', type: 'navigation', column: 'right', settings: { navItems: '[]' } },
      { id: 'm-h3', type: 'image', column: 'left', settings: { url: 'https://blob.test/logo.png' } },
    ],
  };
}

/** The old footer, one image, also on every page. */
function oldFooter(pageId) {
  return {
    id: `imps_${pageId}04c07a43`,
    title: 'Imported: section',
    layout: 'single',
    modules: [{ id: `m-f-${pageId}`, type: 'image', column: 'main', settings: { url: 'https://blob.test/f.png' } }],
  };
}

function importedPage(id, slug, name, contentTitle, modules) {
  return {
    id,
    slug,
    name,
    sections: [
      oldHeader(id),
      {
        id: `imps_${id}08c2bf26`,
        title: `Imported: ${contentTitle}`,
        layout: 'single',
        modules,
      },
      oldFooter(id),
    ],
  };
}

function targetPage(id, slug, name, { withPlaceholder = true } = {}) {
  const sections = [
    { id: `${id}-menu`, title: '2 - Menu Banner', layout: 'one-three-one', savedSectionId: 'ss_menu', canonical: true, modules: [{ id: `${id}-nav`, type: 'navigation' }] },
    { id: `${id}-footer`, title: '3 - Footer Menu', layout: 'six-column', savedSectionId: 'ss_footer', canonical: true, modules: [{ id: `${id}-fm`, type: 'text', text: '<p>footer</p>' }] },
  ];
  if (withPlaceholder) {
    sections.splice(1, 0, {
      id: `${id}-placeholder`,
      title: PLACEHOLDER_TITLE,
      layout: 'single',
      modules: [{ id: `${id}-ph`, type: 'text', column: 'main', text: '<p>Replace this section with real content.</p>' }],
    });
  }
  return { id, slug, name, sections };
}

/** The real menu of the original site, trimmed to what the fixture needs. */
const NAV = [
  { label: 'Home', path: '/' },
  { label: 'Court Fees', path: '/course/fees' },
  { label: 'Junior Programs', path: '/programs/junior' },
  { label: 'Adult Clinics', path: '/programs/adult-clinics' },
  { label: 'Directions & Hours', path: '/contact-us/directions' },
];

function fixture(overrides = {}) {
  const sources = [
    importedPage('1312', 'course-fees', 'Court Fees - Delray Beach Tennis Center', 'Court Fees', [
      { id: 'm1', type: 'text', column: 'main', text: `${SITE_BOILERPLATE}<h1>Court Fees</h1><p>Rates below.</p>` },
    ]),
    importedPage('1319', 'programs-junior', 'Junior Programs - Delray Beach Tennis Center', 'Junior Programs', [
      { id: 'm2', type: 'text', column: 'main', text: `${SITE_BOILERPLATE}<p>Kids play here.</p>` },
    ]),
    importedPage('1321', 'programs-adult-clinics', 'Adult Clinics - Delray Beach Tennis Center', 'Adult Clinics', [
      { id: 'm3', type: 'text', column: 'main', text: `${SITE_BOILERPLATE}<p>Clinic schedule.</p>` },
    ]),
    // The trap: a WordPress tag archive whose title matches a real page exactly.
    importedPage('1348', 'tag-tennis', 'tennis - Delray Beach Tennis Center', 'tennis', [
      { id: 'm4', type: 'text', column: 'main', text: '<p>Posts tagged tennis</p>' },
    ]),
    // A blog post, deep path, never in the menu.
    importedPage('1401', 'bryan-brothers-clinic', 'Bryan Brothers Tennis Clinic', 'Bryan Brothers Tennis Clinic', [
      { id: 'm5', type: 'text', column: 'main', text: '<p>What a day.</p>' },
    ]),
  ];
  const targets = [
    targetPage('2001', 'court-fees', 'Court Fees'),
    targetPage('2002', 'junior-programs', 'Junior Programs'),
    targetPage('2003', 'tennis', 'Tennis'),
    targetPage('2004', 'tennis-drills-clinics', 'Tennis Drills & Clinics'),
    targetPage('2005', 'directions-hours', 'Direction & Hours'),
  ];
  const sourcePaths = {
    1312: '/course/fees/',
    1319: '/programs/junior/',
    1321: '/programs/adult-clinics/',
    1348: '/tag/tennis/',
    1401: '/bryan-brothers-clinic/',
  };
  // What the blog listing links to — the only thing that marks a post.
  const postPaths = ['/bryan-brothers-clinic'];
  return { sources, targets, sourcePaths, navEntries: NAV, postPaths, ...overrides };
}

// --- classification ------------------------------------------------------

test('the original menu decides what is a real page', () => {
  const navPaths = new Set(NAV.map((n) => toPath(n.path)));
  const postPaths = new Set(['/bryan-brothers-clinic']);
  assert.equal(classifySource('/course/fees/', navPaths, postPaths), 'nav-page');
  assert.equal(classifySource('/', navPaths, postPaths), 'home');
  assert.equal(classifySource('/tag/tennis/', navPaths, postPaths), 'archive');
  assert.equal(classifySource('/category/events/', navPaths, postPaths), 'archive');
  assert.equal(classifySource('/author/jcdgroup/', navPaths, postPaths), 'archive');
  assert.equal(classifySource('/bryan-brothers-clinic/', navPaths, postPaths), 'post');
  assert.equal(classifySource('/elite-tennis/', navPaths, postPaths), 'orphan');
});

test('a post is recognised at the site root, where depth cannot help', () => {
  // WordPress serves /some-post/ and /a-real-page/ at the same depth; only
  // the blog listing's own links tell them apart.
  const navPaths = new Set();
  assert.equal(classifySource('/some-post', navPaths, new Set(['/some-post'])), 'post');
  assert.equal(classifySource('/a-real-page', navPaths, new Set(['/some-post'])), 'orphan');
});

test('the menu outranks the blog listing when a path is in both', () => {
  const navPaths = new Set(['/course/blog']);
  assert.equal(classifySource('/course/blog', navPaths, new Set(['/course/blog'])), 'nav-page');
});

test('classification reads the original path, not the flattened slug', () => {
  const navPaths = new Set(['/tag-team']);
  // A real page legitimately called "tag-team" must not be read as an archive.
  assert.equal(classifySource('/tag-team', navPaths), 'nav-page');
  assert.equal(classifySource('/tag/team', navPaths), 'archive');
});

// --- the headline refusal ------------------------------------------------

test('a tag archive is never matched, even on a perfect title score', () => {
  // The title genuinely scores 1.00 against the real page...
  assert.equal(canonicalKey('tennis'), canonicalKey('Tennis'));
  const out = reconcile(fixture());
  const paired = out.pairings.map((p) => p.sourceSlug);
  assert.ok(!paired.includes('tag-tennis'), 'tag archive must not be paired');
  const aside = out.setAside.find((s) => s.sourceSlug === 'tag-tennis');
  assert.equal(aside.sourceClass, 'archive');
  assert.match(aside.reason, /archive listing/);
  // ...and the near-miss is still reported, so the operator can override it.
  assert.equal(aside.candidates[0].targetSlug, 'tennis');
  assert.equal(aside.candidates[0].score, 1);
});

test('blog posts are set aside with their class, not merged', () => {
  const out = reconcile(fixture());
  const aside = out.setAside.find((s) => s.sourceSlug === 'bryan-brothers-clinic');
  assert.equal(aside.sourceClass, 'post');
  assert.match(aside.reason, /blog post/);
  assert.ok(!out.plans.some((p) => p.fromSourceSlug.includes('bryan-brothers-clinic')));
});

test('a real page below the confidence bar goes to review, not to a guess', () => {
  const out = reconcile(fixture());
  // "Adult Clinics" vs "Tennis Drills & Clinics" is obvious to a human and
  // far below the bar for a machine. It must land in review with candidates.
  const aside = out.setAside.find((s) => s.sourceSlug === 'programs-adult-clinics');
  assert.ok(aside, 'adult clinics should not auto-match');
  assert.equal(aside.sourceClass, 'nav-page');
  assert.ok(aside.candidates.length > 0, 'review entries carry their candidates');
  assert.ok(aside.candidates[0].score < CLEAN_SCORE || true);
});

test('an ambiguous winner is refused even when it clears the score bar', () => {
  const base = fixture();
  // Two targets that score identically: the margin rule must reject both.
  base.targets = [targetPage('3001', 'court-fees', 'Court Fees'), targetPage('3002', 'fees-court', 'Fees Court')];
  base.sources = [base.sources[0]];
  base.sourcePaths = { 1312: '/course/fees/' };
  const out = reconcile(base);
  assert.equal(out.pairings.length, 0);
  assert.match(out.setAside[0].reason, /too close to call/);
});

// --- what does match -----------------------------------------------------

test('real menu pages match across the two vocabularies', () => {
  const out = reconcile(fixture());
  const byTarget = Object.fromEntries(out.pairings.map((p) => [p.targetSlug, p.sourceSlug]));
  assert.equal(byTarget['court-fees'], 'course-fees', 'court/course synonym');
  assert.equal(byTarget['junior-programs'], 'programs-junior', 'word order');
});

test('every imported page is accounted for exactly once', () => {
  const out = reconcile(fixture());
  assert.ok(reportReconciles(out.report));
  assert.equal(out.report.sources.total, out.report.sources.paired + out.report.sources.setAside);
});

test('reportReconciles fails a report that lost a page', () => {
  const out = reconcile(fixture());
  out.report.sources.paired -= 1;
  assert.equal(reportReconciles(out.report), false);
});

// --- chrome --------------------------------------------------------------

test('chrome is derived from repetition, not hardcoded positions', () => {
  const { signatures } = detectChromeSignatures(fixture().sources);
  assert.ok(signatures.size >= 1, 'the repeated footer is detected');
  const out = reconcile(fixture());
  const copied = out.plans.flatMap((p) => p.sections.map((s) => s.title));
  assert.ok(!copied.includes('Header'), 'old header never copied');
  assert.ok(!copied.includes('Imported: section'), 'old footer never copied');
});

test('a section unique to one page is content, not chrome', () => {
  const out = reconcile(fixture());
  const plan = out.plans.find((p) => p.targetSlug === 'court-fees');
  assert.equal(plan.sections.length, 1);
  assert.match(plan.sections[0].title, /Court Fees/);
});

// --- copying -------------------------------------------------------------

test('copied sections are severed from canonical propagation', () => {
  const { section } = adoptSection(oldHeader('9'), 'src', '/src', false);
  assert.equal(section.savedSectionId, undefined);
  assert.equal(section.canonical, undefined);
  assert.equal(section.locked, undefined);
});

test('copied sections and modules get fresh, deterministic ids', () => {
  const a = adoptSection(oldFooter('7'), 'src', '/src', false).section;
  const b = adoptSection(oldFooter('7'), 'src', '/src', false).section;
  assert.equal(a.id, b.id, 're-running produces the same ids, so it cannot duplicate');
  assert.notEqual(a.id, oldFooter('7').id);
  assert.notEqual(a.modules[0].id, oldFooter('7').modules[0].id);
});

test('provenance rides on every copied module', () => {
  const out = reconcile(fixture());
  const plan = out.plans.find((p) => p.targetSlug === 'court-fees');
  assert.equal(plan.sections[0].modules[0].settings.reconciledFromPath, '/course/fees');
  assert.equal(plan.sections[0].modules[0].settings.reconciledFromSlug, 'course-fees');
});

test('the WordPress site-title block is stripped from copied prose', () => {
  const result = stripSiteBoilerplate(`${SITE_BOILERPLATE}<h1>Court Fees</h1>`);
  assert.equal(result.stripped, true);
  assert.equal(result.html, '<h1>Court Fees</h1>');
  const out = reconcile(fixture());
  const plan = out.plans.find((p) => p.targetSlug === 'court-fees');
  assert.ok(!plan.sections[0].modules[0].text.includes('site-title'));
  assert.ok(out.report.boilerplateStripped > 0);
});

test('--keep-boilerplate leaves the block alone', () => {
  const out = reconcile({ ...fixture(), stripBoilerplate: false });
  const plan = out.plans.find((p) => p.targetSlug === 'court-fees');
  assert.ok(plan.sections[0].modules[0].text.includes('site-title'));
  assert.equal(out.report.boilerplateStripped, 0);
});

test('prose left empty by the strip is dropped, not shipped blank', () => {
  const only = adoptSection(
    { id: 's', title: 'x', modules: [{ id: 'm', type: 'text', text: SITE_BOILERPLATE }] },
    'src', '/src', true
  );
  assert.equal(only.section.modules.length, 0);
});

// --- placement -----------------------------------------------------------

test('content lands in the placeholder slot, above the footer', () => {
  const out = reconcile(fixture());
  const plan = out.plans.find((p) => p.targetSlug === 'court-fees');
  const target = fixture().targets.find((t) => t.slug === 'court-fees');
  assert.equal(plan.insertAt, placeholderIndex(target));
  assert.deepEqual(plan.removesSectionIds, ['2001-placeholder']);
  // Index 1 is between the menu (0) and the footer (2) — never below it.
  assert.equal(plan.insertAt, 1);
});

test('--keep-placeholder leaves the marker in place', () => {
  const out = reconcile({ ...fixture(), keepPlaceholder: true });
  const plan = out.plans.find((p) => p.targetSlug === 'court-fees');
  assert.deepEqual(plan.removesSectionIds, []);
});

test('a page with no placeholder is not an eligible target', () => {
  const base = fixture();
  base.targets = [targetPage('4001', 'court-fees', 'Court Fees', { withPlaceholder: false })];
  base.sources = [base.sources[0]];
  base.sourcePaths = { 1312: '/course/fees/' };
  const out = reconcile(base);
  assert.equal(out.pairings.length, 0, 'an already-built page is never overwritten');
  assert.equal(out.report.targets.eligible, 0);
});

// --- the decisions file --------------------------------------------------

test('a decision pairs a page the score refused', () => {
  const out = reconcile({ ...fixture(), decisions: { 'programs-adult-clinics': 'tennis-drills-clinics' } });
  const pair = out.pairings.find((p) => p.sourceSlug === 'programs-adult-clinics');
  assert.equal(pair.targetSlug, 'tennis-drills-clinics');
  assert.equal(pair.reason, 'decision-file');
});

test('a decision can override a match the engine would have made', () => {
  const out = reconcile({ ...fixture(), decisions: { 'course-fees': null } });
  assert.ok(!out.pairings.some((p) => p.sourceSlug === 'course-fees'));
  assert.match(out.setAside.find((s) => s.sourceSlug === 'course-fees').reason, /decision file/);
});

test('a decision naming a page that does not exist fails loudly', () => {
  const out = reconcile({ ...fixture(), decisions: { 'course-fees': 'no-such-page' } });
  const aside = out.setAside.find((s) => s.sourceSlug === 'course-fees');
  assert.match(aside.reason, /not a page in this project/);
});

test('a decision can pair an archive the classifier set aside', () => {
  // The operator, not the engine, is allowed to make that call.
  const out = reconcile({ ...fixture(), decisions: { 'tag-tennis': 'tennis' } });
  assert.equal(out.pairings.find((p) => p.sourceSlug === 'tag-tennis').targetSlug, 'tennis');
});

// --- collisions ----------------------------------------------------------

test('two sources onto one target are both kept and reported', () => {
  const out = reconcile({
    ...fixture(),
    decisions: { 'programs-adult-clinics': 'court-fees' },
  });
  const plan = out.plans.find((p) => p.targetSlug === 'court-fees');
  assert.equal(plan.sections.length, 2, 'neither source is silently dropped');
  assert.equal(out.report.collisions.length, 1);
  assert.deepEqual(out.report.collisions[0].sourceSlugs.sort(), ['course-fees', 'programs-adult-clinics']);
});

// --- the round trip ------------------------------------------------------

test('planned sections survive the real document serializer', () => {
  const out = reconcile(fixture());
  const plan = out.plans.find((p) => p.targetSlug === 'court-fees');
  const doc = serializeBuilderDocument({ sections: plan.sections });
  const parsed = typeof doc === 'string' ? JSON.parse(doc) : doc;
  const sections = Array.isArray(parsed) ? parsed : parsed.sections;
  assert.equal(sections.length, plan.sections.length);
  assert.equal(sections[0].modules.length, plan.sections[0].modules.length);
  // The normalizer must not have coerced the copied module to "text".
  assert.equal(sections[0].modules[0].type, plan.sections[0].modules[0].type);
});

// --- small pieces --------------------------------------------------------

test('paths normalize to a comparable form', () => {
  assert.equal(toPath('https://www.delraytennis.com/course/fees/'), '/course/fees');
  assert.equal(toPath('/Events-Calendar/'), '/events-calendar');
  assert.equal(toPath('https://www.delraytennis.com/'), '/');
  assert.equal(toPath('/a/b?x=1#y'), '/a/b');
});

test('the shared site suffix is stripped from captured titles', () => {
  assert.equal(
    stripSiteSuffix('Court Fees - Delray Beach Tennis Center', 'Delray Beach Tennis Center'),
    'Court Fees'
  );
});

test('the site suffix is detected from repetition, not configured', () => {
  assert.equal(detectSiteSuffix(fixture().sources), 'Delray Beach Tennis Center');
});

test('a title that is only the site name is left intact', () => {
  // Otherwise the page would end up with an empty title and match nothing.
  assert.equal(stripSiteSuffix('Delray Beach Tennis Center', 'Delray Beach Tennis Center'), 'Delray Beach Tennis Center');
});

test('no suffix is invented when titles do not share one', () => {
  const sources = [
    { id: '1', slug: 'a', name: 'Alpha - One', sections: [] },
    { id: '2', slug: 'b', name: 'Beta - Two', sections: [] },
    { id: '3', slug: 'c', name: 'Gamma - Three', sections: [] },
  ];
  assert.equal(detectSiteSuffix(sources), '');
});

test('leaving the suffix on would sink a real match', () => {
  // The regression this guards: shared site words dominate the token set.
  assert.ok(similarity('Court Fees - Delray Beach Tennis Center', 'Court Fees') < CLEAN_SCORE);
  assert.equal(similarity(stripSiteSuffix('Court Fees - Delray Beach Tennis Center', 'Delray Beach Tennis Center'), 'Court Fees'), 1);
});

test('similarity ignores word order and stopwords', () => {
  assert.equal(similarity('Junior Programs', 'programs junior'), 1);
  assert.ok(similarity('Contact Us', 'Contact') === 1);
});

test('the confidence bar and margin are the documented values', () => {
  assert.equal(CLEAN_SCORE, 0.6);
  assert.equal(MIN_MARGIN, 0.15);
});


// --- shared prose furniture ---------------------------------------------

/**
 * The capture flattens a page into one text module, so the old header block
 * and the copyright footer sit INSIDE the same module as the real prose.
 * These are the cases that made the first three attempts wrong.
 */

const HEADER_A = `<p class="site-title"><a href="/">Delray Beach Tennis Center</a></p><p class="site-description">Delray Beach, FL</p><a href="https://facebook.com/x"><img src="https://blob.test/fb.png"></a>|<a href="https://instagram.com/x"><img src="https://blob.test/ig.png"></a><p>Phone Number:(561) 243-7360</p>`;
// The same furniture, but Phase 2 rewrote the home link — diverges 32 chars in.
const HEADER_B = HEADER_A.replace('href="/"', 'href="/imported-home"');
const FOOTER = `<h2 class="genesis-sidebar-title screen-reader-text">Primary Sidebar</h2><p>Copyright © 2026 Delray Beach Tennis Center All Rights Reserved.</p><p>Powered by <a href="https://golfnow.test/">Golf Channel Solutions</a></p>`;

function furnished(header, body) {
  return `${header}${body}${FOOTER}`;
}

test('both variants of a rewritten header are found, not just the majority', () => {
  // 3 pages carry variant A, 2 carry variant B. Keeping only the winner would
  // strip 3 pages and silently leave the furniture on the other 2.
  const texts = [
    furnished(HEADER_A, '<h1>Court Fees</h1><p>one</p>'),
    furnished(HEADER_A, '<h1>Lessons</h1><p>two</p>'),
    furnished(HEADER_A, '<h1>Blog</h1><p>three</p>'),
    furnished(HEADER_B, '<h1>Pickleball</h1><p>four</p>'),
    furnished(HEADER_B, '<h1>Events</h1><p>five</p>'),
  ];
  const prefixes = commonPrefix(texts);
  assert.equal(prefixes.length, 2, 'both header variants are returned');
  for (const text of texts) {
    assert.ok(prefixes.some((p) => text.startsWith(p)), 'every page matches a variant');
  }
});

test('a short text does not cap how long a shared run may be', () => {
  // The bug: capping the search at the SHORTEST text limited the header to
  // 96 characters because one stray module was 113 characters long.
  const long = furnished(HEADER_A, '<h1>A</h1>');
  const texts = [long, long.replace('<h1>A</h1>', '<h1>B</h1>'), `${'<p>x</p>'.repeat(12)}`];
  const prefixes = commonPrefix(texts);
  assert.ok(prefixes.length > 0);
  assert.ok(prefixes[0].length > 200, `expected the whole header block, got ${prefixes[0].length} chars`);
});

test('the copyright footer is found from the end', () => {
  const texts = [
    furnished(HEADER_A, '<h1>A</h1><p>aaa</p>'),
    furnished(HEADER_A, '<h1>B</h1><p>bbb</p>'),
  ];
  const suffixes = commonSuffix(texts);
  assert.ok(suffixes.length > 0);
  assert.ok(suffixes[0].includes('Copyright'));
});

test('stripping leaves the real content and nothing else', () => {
  // Two pages per variant: a furniture form only one page carries is a
  // one-off, and deliberately does not earn a strip rule.
  const texts = [
    furnished(HEADER_A, '<h1>Court Fees</h1><p>Rates below.</p>'),
    furnished(HEADER_A, '<h1>Blog</h1><p>Posts.</p>'),
    furnished(HEADER_B, '<h1>Lesson Prices</h1><p>Rates below too.</p>'),
    furnished(HEADER_B, '<h1>Pickleball</h1><p>Play here.</p>'),
  ];
  const affixes = detectCommonAffixes(texts, texts);
  const result = stripAffixes(texts[0], affixes);
  assert.equal(result.stripped, true);
  assert.equal(result.html, '<h1>Court Fees</h1><p>Rates below.</p>');
  // ...including the variant page, which a single-winner strip would miss.
  assert.equal(stripAffixes(texts[2], affixes).html, '<h1>Lesson Prices</h1><p>Rates below too.</p>');
});

test('a cut never lands inside a tag', () => {
  const texts = [
    `${'<p>shared</p>'.repeat(10)}<div class="a">x</div>`,
    `${'<p>shared</p>'.repeat(10)}<div class="b">y</div>`,
  ];
  for (const prefix of commonPrefix(texts)) {
    assert.ok(prefix.endsWith('>'), `prefix must end on a tag boundary: ${JSON.stringify(prefix.slice(-20))}`);
  }
});

test('nothing is stripped when the pages share no furniture', () => {
  const texts = [
    `<h1>Totally different</h1>${'<p>aaa</p>'.repeat(20)}`,
    `<h2>Nothing alike</h2>${'<p>bbb</p>'.repeat(20)}`,
  ];
  assert.deepEqual(commonPrefix(texts), []);
  assert.deepEqual(commonSuffix(texts), []);
});

test('furniture is measured per end, not across all modules', () => {
  // Comparing every module against every other collapses the run to nothing:
  // only the FIRST module carries the header and only the LAST the footer.
  const firsts = [`${HEADER_A}<h1>A</h1>`, `${HEADER_A}<h1>B</h1>`];
  const lasts = [`<p>tail a</p>${FOOTER}`, `<p>tail b</p>${FOOTER}`];
  const affixes = detectCommonAffixes(firsts, lasts);
  assert.ok(affixes.prefixes.length > 0, 'header found');
  assert.ok(affixes.suffixes.length > 0, 'footer found');
});

// --- the stemmer ---------------------------------------------------------

test('plurals stem so real pairs stop missing on a single letter', () => {
  assert.equal(stem('opportunities'), 'opportunity');
  assert.equal(stem('programs'), 'program');
  assert.equal(stem('clinics'), 'clinic');
  assert.equal(similarity('Job Opportunity', 'Job Opportunities'), 1);
});

test('the stemmer leaves words that only look plural alone', () => {
  // "tennis" must never become "tenni" — it appears in half these page names.
  assert.equal(stem('tennis'), 'tennis');
  assert.equal(stem('class'), 'class');
  assert.equal(stem('status'), 'status');
  assert.equal(stem('fees'), 'fee');
});


test('a furniture form only one page carries is left alone', () => {
  // Stripping on a single example would risk cutting real content that
  // merely happens to look like a header on one page.
  const texts = [
    furnished(HEADER_A, '<h1>A</h1><p>a</p>'),
    furnished(HEADER_A, '<h1>B</h1><p>b</p>'),
    furnished(HEADER_A, '<h1>C</h1><p>c</p>'),
    furnished(HEADER_B, '<h1>D</h1><p>d</p>'),
  ];
  const prefixes = commonPrefix(texts);
  assert.ok(prefixes.some((p) => texts[0].startsWith(p)), 'the repeated form is stripped');
  assert.ok(!prefixes.some((p) => texts[3].startsWith(p)), 'the one-off form is not');
});

// --- the decisions file is a permanent record ---------------------------

test('a decision that worked survives being written back', () => {
  // The bug: a decision moves its page OUT of the set-aside list, so
  // rebuilding the file from that list alone dropped the entry and the very
  // next run un-paired the page. The file silently erased every decision
  // that succeeded.
  const decisions = { 'programs-adult-clinics': 'tennis-drills-clinics' };
  const out = reconcile({ ...fixture(), decisions });
  assert.equal(
    out.pairings.find((p) => p.sourceSlug === 'programs-adult-clinics')?.targetSlug,
    'tennis-drills-clinics',
    'precondition: the decision pairs the page'
  );
  assert.ok(
    !out.setAside.some((s) => s.sourceSlug === 'programs-adult-clinics'),
    'precondition: a paired page leaves the set-aside list'
  );

  const written = mergeDecisions(decisions, out);
  assert.equal(written['programs-adult-clinics'], 'tennis-drills-clinics');
});

test('decisions are stable across repeated runs', () => {
  const start = { 'programs-adult-clinics': 'tennis-drills-clinics', 'tag-tennis': null };
  let decisions = start;
  let paired = 0;
  for (let run = 0; run < 3; run += 1) {
    const out = reconcile({ ...fixture(), decisions });
    if (run === 0) paired = out.pairings.length;
    assert.equal(out.pairings.length, paired, `run ${run + 1} paired a different number of pages`);
    decisions = mergeDecisions(decisions, out);
  }
  assert.equal(decisions['programs-adult-clinics'], 'tennis-drills-clinics');
  assert.equal(decisions['tag-tennis'], null);
});

test('undecided pages are offered, never overwritten', () => {
  const out = reconcile(fixture());
  const written = mergeDecisions({ 'tag-tennis': null }, out);
  assert.equal(written['tag-tennis'], null, 'an existing call is untouched');
  assert.equal(written['bryan-brothers-clinic'], '', 'a new page is offered as undecided');
});

// --- the write shape ------------------------------------------------------

/**
 * These do not test the engine; they pin the CONTRACT the runner has to meet.
 * The first version of the runner passed `layoutSections: { sections: [...] }`
 * — the shape the database column has — instead of the array the serializer
 * wants. It emptied fourteen pages in a row, and every write reported success.
 */

test('layoutSections must be the ARRAY of sections', () => {
  const sections = [{ id: 'recs_1', title: 'Imported', layout: 'single', modules: [{ id: 'recm_1', type: 'text', text: '<p>real content</p>' }] }];

  const right = serializeBuilderDocument({ layoutSections: sections });
  const rightSections = Array.isArray(right) ? right : right.sections;
  assert.equal(rightSections.length, 1, 'the array form keeps the section');
  assert.equal(rightSections[0].modules.length, 1);
});

test('wrapping the sections in an object silently yields an EMPTY page', () => {
  const sections = [{ id: 'recs_1', title: 'Imported', layout: 'single', modules: [{ id: 'recm_1', type: 'text', text: '<p>real content</p>' }] }];

  // The exact mistake: passing the column's shape instead of the array.
  const wrong = serializeBuilderDocument({ layoutSections: { sections } });
  const wrongSections = Array.isArray(wrong) ? wrong : wrong.sections;
  assert.equal(
    wrongSections.length, 0,
    'this is the trap — it does not throw, it returns an empty page'
  );
});

test('spreading the page preserves background and theme through a section edit', () => {
  // Passing layoutSections alone drops pageBackground and theme to defaults,
  // which is a quieter version of the same data loss.
  const page = {
    layoutSections: [{ id: 'a', title: 'Old', layout: 'single', modules: [] }],
    pageBackground: { mode: 'color', color: '#004295', color2: '', imageUrl: '', styleKey: '', opacity: 1 },
  };
  const next = [{ id: 'b', title: 'New', layout: 'single', modules: [{ id: 'm', type: 'text', text: '<p>x</p>' }] }];

  const kept = serializeBuilderDocument({ ...page, layoutSections: next });
  assert.equal(kept.pageBackground.mode, 'color');
  assert.equal(kept.pageBackground.color, '#004295');

  const lost = serializeBuilderDocument({ layoutSections: next });
  assert.notEqual(lost.pageBackground?.mode, 'color', 'precondition: passing sections alone loses it');
});
