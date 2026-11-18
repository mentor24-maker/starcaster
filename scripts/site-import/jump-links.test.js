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
  mapSite, referenceSectionLinks, buildMenuSection, isSkipLink,
} = require('../../lib/site-import/dist/map.js');
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
    assert.deepEqual(target, { fallback: `/#${name}`, pageKey: home.key, sectionId: section.id });
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
