'use strict';

/**
 * Jump links survive the import (task SC-854). A menu that scrolled to
 * About, Services and Contact used to arrive doing nothing: the capture kept
 * no element ids, so the import could not tell which section `#contact-us`
 * meant. Bayside went live like that on 2026-11-17.
 *
 * The Bayside fixture is its real capture (job simp_1794945570334_oh518a)
 * with the original's ids added where the normalizer now files them — read
 * off the live original: `<div id="about-us" class="et_pb_section">` and its
 * siblings each land on their section's heading.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { normalizeSite } = require('../../lib/site-import/dist/normalize.js');
const {
  mapSite, referenceSectionLinks, buildMenuSection, isSkipLink, demoteEditedSectionLinks,
} = require('../../lib/site-import/dist/map.js');
const { referenceJumpLinks } = require('../../lib/siteImportJumpLinks.js');
const { resolvePageLink, buildPageAddressMap } = require('../../lib/builder-client/page-link.js');

const IR = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bayside-home.json'), 'utf8'));
const SITE = IR.sourceUrl;
const fresh = () => JSON.parse(JSON.stringify(IR));
const mapBayside = (ir = fresh()) => mapSite(ir, { existingSlugs: [] });
const headingSection = (page, word) =>
  page.sections.find((s) => s.modules.some((m) => new RegExp(`<h2[^>]*>\\s*${word}`).test(m.text || '')));

test('Bayside: the three menu links become links to their sections', () => {
  const out = mapBayside();
  const home = out.pages[0];
  const byLabel = Object.fromEntries(out.menus.top.items.map((i) => [i.label, i.href]));
  assert.equal(byLabel['About Us'], '/#about-us');
  assert.equal(byLabel['Services'], '/#services');
  assert.equal(byLabel['Contact Us'], '/#contact-us');

  for (const [word, name] of [['About Us', 'about-us'], ['Services', 'services'], ['Contact Us', 'contact-us']]) {
    const section = headingSection(home, word);
    assert.ok(section, `the "${word}" section exists`);
    assert.equal(section.anchorName, name, `the "${word}" section carries the original's id as its anchor name`);
    const target = out.sectionLinks.find((t) => t.fallback === `/#${name}`);
    assert.deepEqual({ ...target, uses: undefined }, { fallback: `/#${name}`, pageKey: home.key, sectionId: section.id, uses: undefined });
    assert.ok(target.uses.length >= 1, 'it remembers the links pointed at it');
  }
  // Only linked sections are named: nothing links to "resources" or the
  // page wrappers, so no section wears those.
  const named = home.sections.filter((s) => s.anchorName).map((s) => s.anchorName);
  assert.deepEqual(named.sort(), ['about-us', 'contact-us', 'services']);
  assert.equal(out.report.jumpLinks.linked, 3);
  assert.deepEqual(out.report.jumpLinks.unresolved, []);
});

test('Bayside: once the page has an id, the menu stores each link by reference', () => {
  const out = mapBayside();
  const home = out.pages[0];
  const pageIds = { [home.key]: '501' };
  const top = buildMenuSection('top', out.menus, 'simp_x');
  const { sections: [menu], referenced } = referenceSectionLinks([top], out.sectionLinks, pageIds);
  assert.equal(referenced, 3);
  const items = JSON.parse(menu.modules.find((m) => m.type === 'navigation').settings.navItems);
  const contact = items.find((i) => i.label === 'Contact Us');
  const section = headingSection(home, 'Contact Us');
  assert.equal(contact.href, `page:501#${section.id}|/#contact-us`);
  assert.equal(items.find((i) => i.label === 'Home').href, '/', 'an ordinary link is left alone');

  // Resolved the way a served page resolves it — and renaming the anchor
  // later moves the link with it, the point of storing the section's id.
  const layout = home.sections.map(({ sourceElementIds, dispositions, ...s }) => s);
  const addresses = buildPageAddressMap([{ id: '501', slug: '', layoutSections: layout }]);
  assert.equal(resolvePageLink(contact.href, addresses).href, '/#contact-us');
  layout.find((s) => s.id === section.id).anchorName = 'get-in-touch';
  const renamed = buildPageAddressMap([{ id: '501', slug: '', layoutSections: layout }]);
  assert.equal(resolvePageLink(contact.href, renamed).href, '/#get-in-touch');
});

test('referencing leaves alone a page with no id yet, and links already referenced', () => {
  const out = mapBayside();
  const top = buildMenuSection('top', out.menus, 'simp_x');
  const none = referenceSectionLinks([top], out.sectionLinks, {});
  assert.equal(none.referenced, 0);
  assert.equal(none.sections[0], top, 'no page id: the plain address stays, and it still works');
  const once = referenceSectionLinks([top], out.sectionLinks, { [out.pages[0].key]: '7' }).sections;
  assert.equal(referenceSectionLinks(once, out.sectionLinks, { [out.pages[0].key]: '7' }).referenced, 0);
});

/** Bayside with links added inside the "About Us" text, for the cases its
 *  own menu does not have. */
function baysideWithLinks(html) {
  const ir = fresh();
  const els = ir.pages[0].sections.flatMap((s) => s.elements);
  const prose = els.find((e) => e.class === 'text' && /Barrow has nearly 30 years/.test(e.textContent));
  prose.html = prose.html.replace(/<\/p>\s*$/, ` ${html}</p>`);
  return ir;
}

test('a link inside text becomes a section link, and gains its reference on apply', () => {
  const out = mapBayside(baysideWithLinks(`<a href="${SITE}#services">our services</a>`));
  const text = out.pages[0].sections.flatMap((s) => s.modules).find((m) => /our services/.test(m.text || ''));
  assert.match(text.text, /<a href="\/#services">our services<\/a>/);
  const services = headingSection(out.pages[0], 'Services');
  const { sections } = referenceSectionLinks(out.pages[0].sections, out.sectionLinks, { [out.pages[0].key]: 9 });
  const after = sections.flatMap((s) => s.modules).find((m) => /our services/.test(m.text || ''));
  assert.match(after.text, new RegExp(`<a data-page-link="page:9#${services.id}\\|/#services" href="/#services">`));
});

test('a jump link the import cannot point anywhere is listed with its reason', () => {
  const out = mapBayside(baysideWithLinks(
    '<a href="#respond">Leave a reply</a> <a href="/team/#joshua">Joshua</a>'
  ));
  const { unresolved } = out.report.jumpLinks;
  assert.equal(unresolved.length, 2, JSON.stringify(unresolved));
  const reply = unresolved.find((u) => u.href === '#respond');
  assert.equal(reply.page, '/');
  assert.equal(reply.label, 'Leave a reply');
  assert.match(reply.why, /nothing the import built on \/ carries the id "respond"/);
  const team = unresolved.find((u) => u.href === '/team/#joshua');
  assert.match(team.why, /\/team\/\) was not imported/);
  const text = out.pages[0].sections.flatMap((s) => s.modules).map((m) => m.text || '').join('');
  assert.match(text, /href="\/#respond">Leave a reply/, 'the link is kept, not dropped');
});

test('"skip to content" links are left out, keeping their words', () => {
  assert.equal(isSkipLink('genesis-content'), true);
  assert.equal(isSkipLink('main'), true);
  assert.equal(isSkipLink('anything', 'Skip to content'), true);
  assert.equal(isSkipLink('contact-us', 'Contact Us'), false);

  const out = mapBayside(baysideWithLinks('<a href="#genesis-content">Skip to main content</a>'));
  const text = out.pages[0].sections.flatMap((s) => s.modules).map((m) => m.text || '').join('');
  assert.doesNotMatch(text, /genesis-content/);
  assert.match(text, /Skip to main content/);
  assert.equal(out.report.jumpLinks.skipLinks, 1);
  assert.deepEqual(out.report.jumpLinks.unresolved, []);
});

test('the capture files each id on the element a visitor lands on', () => {
  const html = '<html><body><div id="page"><header data-scim="1"><a href="#contact">Contact</a></header>' +
    '<section id="about" data-scim="2"><h2 data-scim="3">About</h2><p data-scim="4">We are here.</p></section>' +
    '<a id="contact"></a><section data-scim="5"><h2 id="contact-heading" data-scim="6">Contact</h2>' +
    '<svg><defs><linearGradient id="grad"></linearGradient></defs></svg><p data-scim="7">Call us.</p></section>' +
    '</div></body></html>';
  const input = {
    jobId: 'j', sourceUrl: 'https://site.test/', capturedAt: '', assets: [],
    pages: [{
      desktop: {
        url: 'https://site.test/', finalUrl: 'https://site.test/', viewport: 'desktop', html,
        styles: {}, rects: {}, fullPageScreenshot: '', sectionScreenshots: {}, elementScreenshots: {},
        assetUrls: [], fontFamilies: [], meta: { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' },
      },
    }],
  };
  const { ir } = normalizeSite(input);
  const els = ir.pages[0].sections.flatMap((s) => s.elements);
  const on = (text) => els.find((e) => e.textContent === text).anchors;
  assert.deepEqual(els.find((e) => e.class === 'link').anchors, ['page'], 'an outer wrapper lands on the first thing in it');
  assert.deepEqual(on('About'), ['about'], 'a section lands on its heading');
  assert.deepEqual(els.find((e) => e.textContent === 'Contact' && e.class === 'heading').anchors,
    ['contact', 'contact-heading'], 'an empty marker before a band lands on the band, with the heading\'s own id');
  assert.equal(on('Call us.'), undefined, 'an SVG gradient id is not a place on the page');
  assert.equal(on('We are here.'), undefined);
});

/** One page through the real normalizer, for the filing cases. */
function normalizeOne(body) {
  const html = `<html><body>${body}</body></html>`;
  const { ir } = normalizeSite({
    jobId: 'j', sourceUrl: 'https://site.test/', capturedAt: '', assets: [],
    pages: [{
      desktop: {
        url: 'https://site.test/', finalUrl: 'https://site.test/', viewport: 'desktop', html,
        styles: {}, rects: {}, fullPageScreenshot: '', sectionScreenshots: {}, elementScreenshots: {},
        assetUrls: [], fontFamilies: [], meta: { title: '', metaDescription: '', ogTags: {}, canonicalUrl: '', lang: '' },
      },
    }],
  });
  return ir;
}

test('an id INSIDE a line of text is filed on that line, not the one after it', () => {
  // Review of SC-854: the element containing an id comes before it in
  // document order, so "the first one after" filed these one section low.
  const ir = normalizeOne(
    '<section data-scim="1"><h2 data-scim="2">Team</h2><p data-scim="3"><a id="team"></a>Our team is here.</p></section>' +
    '<section data-scim="4"><h2 data-scim="5">Pricing</h2><p data-scim="6">Plans.</p></section>'
  );
  const els = ir.pages[0].sections.flatMap((s) => s.elements);
  const holder = els.filter((e) => (e.anchors || []).includes('team'));
  assert.equal(holder.length, 1, JSON.stringify(els.map((e) => [e.textContent, e.anchors])));
  assert.match(holder[0].textContent, /Our team is here/);
  assert.equal(els.find((e) => e.textContent === 'Pricing').anchors, undefined, 'not the next section\'s heading');
});

test('an id on a span inside a heading lands on that heading (table-of-contents plugins)', () => {
  const ir = normalizeOne(
    '<section data-scim="1"><h2 data-scim="2"><span id="faq">FAQ</span></h2><p data-scim="3">Answers follow.</p></section>'
  );
  const els = ir.pages[0].sections.flatMap((s) => s.elements);
  assert.deepEqual(els.find((e) => e.textContent === 'FAQ').anchors, ['faq']);
  assert.equal(els.find((e) => e.textContent === 'Answers follow.').anchors, undefined);
  assert.equal(ir.anchorsRecorded, true, 'a fresh IR says its ids were looked for');
});

test('an import from before jump-link capture says so, never that each id is missing', () => {
  const old = fresh();
  delete old.anchorsRecorded;
  for (const el of old.pages.flatMap((p) => p.sections.flatMap((s) => s.elements))) delete el.anchors;
  const out = mapBayside(old);
  const j = out.report.jumpLinks;
  assert.deepEqual(j.unresolved, [], 'no per-id "missing" reason: nobody looked');
  assert.equal(j.notRecorded.links, 3);
  assert.match(j.notRecorded.why, /prepared before/);
  assert.match(j.notRecorded.why, new RegExp(`--stage normalize --job ${old.jobId}`));
  assert.match(j.notRecorded.why, /no fresh capture is needed/);
  assert.match(j.notRecorded.why, /doppler run --config prd -- node scripts\/site_import_worker\.mjs/, 'the step as it actually runs');
  assert.match(j.notRecorded.why, /agent session/, 'a step an agent session runs, not a command for the operator');
  // The links still point at the right page, as written.
  const byLabel = Object.fromEntries(out.menus.top.items.map((i) => [i.label, i.href]));
  assert.equal(byLabel['Contact Us'], '/#contact-us');
});

test('a file opened at a page and a text fragment are not jump links', () => {
  const out = mapBayside(baysideWithLinks(
    `<a href="${SITE}files/menu.pdf#page=3">menu</a> <a href="#:~:text=Barrow">quote</a> <a href="${SITE}#:~:text=Barrow">home quote</a>`
  ));
  assert.deepEqual(out.report.jumpLinks.unresolved, []);
  const text = out.pages[0].sections.flatMap((s) => s.modules).map((m) => m.text || '').join('');
  assert.match(text, new RegExp(`href="${SITE}files/menu\\.pdf#page=3">menu`), 'a file link is left exactly as written');
  assert.match(text, /href="#:~:text=Barrow">quote/);
});

test('an href the whole-link pass cannot match is still localized, never left pointing at the live site', () => {
  const out = mapBayside(baysideWithLinks(
    `<a title="a>b" href="${SITE}#services">odd services</a> <a title="c>d" href="${SITE}">odd home</a>`
  ));
  const text = out.pages[0].sections.flatMap((s) => s.modules).map((m) => m.text || '').join('');
  assert.doesNotMatch(text, new RegExp(`href="${SITE}`), text);
  assert.match(text, /href="\/#services">odd services/);
  assert.match(text, /href="\/">odd home/);
  assert.doesNotMatch(text, /\u0001/, 'the pass marker never reaches the stored text');
});

test('a designed link to "#content" is a real link when the import built a section carrying that id', () => {
  // Review of SC-854: the id test ran before the lookup, so a button to a
  // section named "content" went dead. Only the words "Skip to …" decide
  // before the lookup; an id like "content" is a skip link only when nothing
  // built carries it.
  const ir = baysideWithLinks('<a href="#content">what we cover</a> <a href="#main">Skip to content</a>');
  const servicesEl = ir.pages[0].sections.flatMap((s) => s.elements).find((e) => (e.anchors || []).includes('services'));
  servicesEl.anchors.push('content');
  const out = mapBayside(ir);
  const text = out.pages[0].sections.flatMap((s) => s.modules).map((m) => m.text || '').join('');
  assert.match(text, /<a href="\/#[^"]+">what we cover<\/a>/, text);
  assert.equal(out.report.jumpLinks.skipLinks, 1, 'the "Skip to content" link is still left out by its words');
  assert.equal(out.report.jumpLinks.linked, 4);
  assert.deepEqual(out.report.jumpLinks.unresolved, []);
  // Nothing built carries "main": still a skip link by its id.
  const plain = mapBayside(baysideWithLinks('<a href="#primary">x</a>'));
  assert.equal(plain.report.jumpLinks.skipLinks, 1);
});

test('a link to a section a person edited is a leftover, not counted as linked', () => {
  const out = mapBayside();
  const contact = headingSection(out.pages[0], 'Contact Us');
  const editedLive = new Map([[contact.id, { id: contact.id, modules: [] }]]);
  const kept = demoteEditedSectionLinks(out.report, out.sectionLinks, editedLive);
  assert.equal(kept.length, 2);
  assert.ok(!kept.some((t) => t.sectionId === contact.id), 'not stored by reference');
  assert.equal(out.report.jumpLinks.linked, 2);
  const left = out.report.jumpLinks.unresolved;
  assert.equal(left.length, 1, JSON.stringify(left));
  assert.equal(left[0].label, 'Contact Us');
  assert.match(left[0].why, /edited by hand.*"contact-us"/);

  // Kept copy already wears the name: the link works, so it stays linked.
  const again = mapBayside();
  const c2 = headingSection(again.pages[0], 'Contact Us');
  const ok = demoteEditedSectionLinks(again.report, again.sectionLinks, new Map([[c2.id, { anchorName: 'contact-us' }]]));
  assert.equal(ok.length, 3);
  assert.equal(again.report.jumpLinks.linked, 3);
});

/** An in-memory page store with the real store's envelope shape. */
function fakePages(pages, { failUpdate = new Set(), failGet = new Set(), dropOnWrite = new Set() } = {}) {
  const rows = new Map(pages.map((p) => [String(p.id), JSON.parse(JSON.stringify(p))]));
  const calls = { updates: [] };
  return {
    calls,
    rows,
    async getPage(id) {
      if (failGet.has(String(id))) return { ok: false, status: 503, error: { message: 'database unavailable' } };
      const row = rows.get(String(id));
      return row ? { ok: true, status: 200, data: JSON.parse(JSON.stringify(row)) } : { ok: false, status: 404 };
    },
    async updatePage(id, page) {
      calls.updates.push(String(id));
      if (failUpdate.has(String(id))) return { ok: false, status: 500, error: { message: 'write refused' } };
      const stored = JSON.parse(JSON.stringify(page));
      if (dropOnWrite.has(String(id))) stored.layoutSections = page.layoutSections.map(() => ({ id: 'x', modules: [] }));
      rows.set(String(id), stored);
      return { ok: true, status: 200, data: stored };
    },
  };
}

function twoBaysidePages() {
  // The same Bayside home mapped as two pages, so one can fail and the other
  // must still be done.
  const out = mapBayside(baysideWithLinks(`<a href="${SITE}#services">our services</a>`));
  const home = out.pages[0];
  const layout = home.sections.map(({ sourceElementIds, dispositions, ...s }) => s);
  const second = { ...home, key: `${home.key}-copy`, slug: 'copy' };
  out.pages.push(second);
  // Its links point at the home page's sections: a link to another page's
  // section, which the read-back must count too.
  const pageIds = { [home.key]: '11', [second.key]: '12' };
  const owned = new Map([['11', layout.map((s) => s.id)], ['12', layout.map((s) => s.id)]]);
  const rows = [{ id: '11', slug: '', layoutSections: layout }, { id: '12', slug: 'copy', layoutSections: layout }];
  return { out, pageIds, owned, rows };
}

for (const [name, opts] of [
  ['the write is refused', { failUpdate: new Set(['11']) }],
  ['the page cannot be read', { failGet: new Set(['11']) }],
  ['the read-back is short', { dropOnWrite: new Set(['11']) }],
]) {
  test(`a jump-link write that fails (${name}) never throws, so the build still records its pages`, async () => {
    // Review of SC-854: a throw here ran before the map checkpoint recorded
    // the page ids, so the next build made a second set of pages.
    const { out, pageIds, owned, rows } = twoBaysidePages();
    const store = fakePages(rows, opts);
    const warnings = [];
    const errors = [];
    const result = await referenceJumpLinks({
      out, pageIds, ownedSectionIds: owned, pagesStore: store, scope: {}, referenceSectionLinks,
      warn: (l) => warnings.push(l), error: (l) => errors.push(l),
    });
    assert.deepEqual(result.failed, [out.pages[0].slug]);
    assert.equal(result.pagesChanged, 1, 'the other page is still done');
    assert.ok(result.linksReferenced > 0);
    assert.match(JSON.stringify(store.rows.get('12').layoutSections), /page:11#/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not stored by reference/);
    assert.equal(errors.length, 1);
  });
}

test('the runner records its pages even when the jump-link step fails', () => {
  // The step returns failures instead of throwing; the runner must mark the
  // run failed from them and must not reintroduce a throw before the
  // checkpoint. Read from the source, since the runner is not importable.
  const src = fs.readFileSync(path.join(__dirname, '..', 'site_import_map.mjs'), 'utf8');
  const call = src.indexOf('await referenceJumpLinks(');
  const checkpoint = src.indexOf('pageIds,\n      sectionHashes,');
  assert.ok(call > 0 && checkpoint > call, 'the step runs before the checkpoint is built');
  assert.match(src.slice(call, checkpoint), /if \(jump\.failed\.length\) process\.exitCode = 1;/);
  assert.doesNotMatch(src, /async function referenceJumpLinks/, 'no throwing local copy');
});
