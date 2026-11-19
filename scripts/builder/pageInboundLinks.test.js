'use strict';

// "What points at this page?" (task 86bcxn69z) — the one scan the Pages
// screen's delete warning and the weekly broken-link check both use.

const test = require('node:test');
const assert = require('node:assert/strict');

const scan = require('../../lib/pageInboundLinks');

const nav = (items) => ({ type: 'navigation', settings: { navItems: JSON.stringify(items) } });
const button = (href, name = '') => ({ type: 'button', name, settings: { href } });

function project() {
  const header = {
    id: 'sec-header',
    title: 'Header',
    savedSectionId: 'ss1',
    canonical: true,
    modules: [nav([{ id: 'n1', label: 'About', href: '/about' }, { id: 'n2', label: 'Blog', href: 'https://blog.example.org/x' }])],
  };
  return {
    domain: 'www.client.com',
    savedSections: [{ id: 'ss1', name: 'Site header', section: { ...header, savedSectionId: undefined, canonical: undefined } }],
    pages: [
      { id: '1', name: 'Home', slug: '', layoutSections: [header, { title: 'Hero', modules: [button('page:2|/contact', 'Learn more')] }] },
      { id: '2', name: 'Contact', slug: 'contact', layoutSections: { sections: [header] } },
      { id: '3', name: 'About', slug: 'about', layoutSections: [header] },
      { id: '4', name: 'Lonely', slug: 'lonely', layoutSections: [] },
    ],
    forms: [
      {
        id: 'f1',
        name: 'Request White Paper',
        fields: [{ key: '__crm_form_handling__', handling: { afterSubmit: 'redirect', redirectPageId: '2' } }],
      },
    ],
  };
}

test('a reference, a typed menu address and a form are all found, each named', () => {
  const p = project();
  const links = scan.collectProjectLinks(p);
  const toContact = scan.linksToPages(links, p.pages, ['2'])['2'].map(scan.describeLink);
  assert.deepEqual(toContact, [
    'Home page › Hero › Button "Learn more"',
    'CRM form "Request White Paper" › Form › After submit',
  ]);
  const toAbout = scan.linksToPages(links, p.pages, ['3'])['3'].map(scan.describeLink);
  assert.deepEqual(toAbout, ['Saved section "Site header" › Header › Menu › Menu Item "About" (shown on 3 pages)']);
});

test('a page nothing points at is absent from the answer', () => {
  const p = project();
  const answer = scan.linksToPages(scan.collectProjectLinks(p), p.pages, ['4']);
  assert.deepEqual(answer, {});
});

test('a link FROM a page deleted in the same batch does not count', () => {
  const p = project();
  const links = scan.collectProjectLinks(p);
  const answer = scan.linksToPages(links, p.pages, ['1', '2']);
  // Home's button is going too; the form still points at Contact.
  assert.deepEqual(answer['2'].map((l) => l.source.kind), ['form']);
});

test('a page copy that CHANGED its shared header still reports its own link', () => {
  const p = project();
  p.pages[3].layoutSections = [{
    title: 'Header', savedSectionId: 'ss1', canonical: true,
    modules: [nav([{ label: 'Old about', href: '/about-us' }])],
  }];
  const broken = scan.brokenLinks(scan.collectProjectLinks(p), p.pages).map(scan.describeLink);
  assert.deepEqual(broken, ['Lonely page › Header › Menu › Menu Item "Old about"']);
});

test('the weekly check names a reference to a deleted page and a typed address nothing answers', () => {
  const p = project();
  p.pages = p.pages.filter((page) => page.id !== '2');
  p.pages[0].layoutSections.push({ title: 'Footer', modules: [button('https://client.com/gone?x=1'), button('/admin-logout'), button('https://elsewhere.com/gone')] });
  const broken = scan.brokenLinks(scan.collectProjectLinks(p), p.pages);
  assert.deepEqual(broken.map((l) => [scan.describeLink(l), l.reason]), [
    ['Home page › Hero › Button "Learn more"', 'points at page 2, which no longer exists'],
    ['Home page › Footer › Button', 'goes to /gone, and no page has that address'],
    ['CRM form "Request White Paper" › Form › After submit', 'points at page 2, which no longer exists'],
  ]);
});

test('with every page present nothing is broken', () => {
  const p = project();
  assert.deepEqual(scan.brokenLinks(scan.collectProjectLinks(p), p.pages), []);
});

test('typed addresses: own pages only, and the home page answers to / and /home', () => {
  assert.equal(scan.typedAddress('/About/', 'path'), 'about');
  assert.equal(scan.typedAddress('/home', 'path'), '');
  assert.equal(scan.typedAddress('/', 'path'), '');
  assert.equal(scan.typedAddress('/about#team', 'path'), 'about');
  assert.equal(scan.typedAddress('//cdn.example.com/x', 'path'), null);
  assert.equal(scan.typedAddress('mailto:a@b.c', 'path'), null);
  assert.equal(scan.typedAddress('#top', 'path'), null);
  assert.equal(scan.typedAddress('/blog/a-post', 'path'), null);
  assert.equal(scan.typedAddress('https://www.client.com/about', 'path', 'client.com'), 'about');
  assert.equal(scan.typedAddress('https://other.com/about', 'path', 'client.com'), null);
  assert.equal(scan.typedAddress('https://client.com/about', 'path', ''), null);
  assert.equal(scan.typedAddress('post', 'slug'), 'post');
  assert.equal(scan.typedAddress('page:9|/x', 'path'), null);
});

test('a reference in a setting nobody listed is still found, and so is one inside a table cell', () => {
  const p = {
    pages: [
      { id: '1', name: 'Home', slug: '', layoutSections: [{ title: 'A', modules: [
        { type: 'some-future-module', settings: { whatever: 'page:7|/seven' } },
        { type: 'table', settings: { tableData: JSON.stringify({ cells: { '0-1': [{ type: 'image', settings: { linkUrl: 'page:7|/seven' } }] } }) } },
      ] }] },
      { id: '7', name: 'Seven', slug: 'seven', layoutSections: [] },
    ],
  };
  const hits = scan.linksToPages(scan.collectProjectLinks(p), p.pages, ['7'])['7'].map(scan.describeLink);
  assert.deepEqual(hits, [
    'Home page › A › some-future-module › whatever',
    'Home page › A › table › cell 0-1 › Image',
  ]);
});

test('a form showing its message is not a link, even with a page remembered', () => {
  const links = scan.collectProjectLinks({
    forms: [{ id: 'f', name: 'F', fields: [{ key: '__crm_form_handling__', handling: { afterSubmit: 'message', redirectPageId: '2' } }] }],
  });
  assert.deepEqual(links, []);
});

test('the five settings 86bcxu518 made pickers are scanned, references and typed addresses both', () => {
  const p = {
    pages: [
      { id: '1', name: 'Home', slug: '', layoutSections: [{ title: 'A', modules: [
        { type: 'breadcrumb', settings: { items: JSON.stringify([{ id: 'c1', label: 'Courts', url: 'page:7|/seven' }, { id: 'c2', label: 'Old', url: '/gone' }]) } },
        { type: 'headline-rotator', settings: { headlines: JSON.stringify([{ id: 'h1', label: 'Book now', href: '/gone' }]) } },
        { type: 'player-portal', settings: { redirectPath: 'page:7|/seven' } },
        { type: 'player-portal', settings: { redirectPath: '/portal/dashboard' } },
        { type: 'admin-blog-links', settings: { managerPageUrl: '/gone', postViewUrl: 'page:7|/seven' } },
      ] }] },
      { id: '7', name: 'Seven', slug: 'seven', layoutSections: [] },
    ],
  };
  const links = scan.collectProjectLinks(p);
  assert.deepEqual(scan.linksToPages(links, p.pages, ['7'])['7'].map(scan.describeLink), [
    'Home page › A › Breadcrumb › Crumb "Courts"',
    'Home page › A › Player sign-in › Redirect Path',
    'Home page › A › Blog Links Manager › Post View Page',
  ]);
  // A typed address nothing answers is broken; /portal/dashboard is not a Builder page, so it is not judged.
  assert.deepEqual(scan.brokenLinks(links, p.pages).map(scan.describeLink), [
    'Home page › A › Breadcrumb › Crumb "Old"',
    'Home page › A › Headline Rotator › Headline "Book now"',
    'Home page › A › Blog Links Manager › Blog Manager Page',
  ]);
});

// SC-812's third send-back: one name per setting key could not match every
// panel using that key ("targetPageUrl" is "Results Page" on Site Search and
// "Target Page" on Blog Post Tags). This reads each module's own settings
// panel and fails when the name the delete warning shows is not its label.
test('each link setting is named with its own module panel\'s label', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', '..', 'components', 'builder');
  let compared = 0;
  const wrong = [];
  for (const [type, fields] of Object.entries(scan.LINK_SETTINGS)) {
    const file = path.join(dir, `builder-${type}-module-settings.tsx`);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const key of Object.keys(fields)) {
      const m = source.match(new RegExp(`key:\\s*"${key}",?\\s*(?:\\n\\s*)?label:\\s*"([^"]+)"`));
      if (!m) continue;
      compared += 1;
      const shown = scan.settingLabel(type, key);
      if (shown !== m[1]) wrong.push(`${type}.${key}: warning says "${shown}", panel says "${m[1]}"`);
    }
  }
  // A pattern that stopped matching would pass silently; 24 compare today.
  assert.ok(compared >= 22, `only ${compared} panel labels compared: the pattern no longer matches the panels`);
  assert.deepEqual(wrong, []);
});

// ------------------------------------------------------------- links to PART of a page (task SC-855)

// Bayside, 2026-11-17: the shared Top Menu jumped to #services, #about and
// #contact, no section carried those names, and this scan said nothing.
function bayside() {
  const menu = {
    id: 'sec-top',
    title: 'Top Menu',
    modules: [nav([
      { id: 'n1', label: 'Services', href: '#services' },
      { id: 'n2', label: 'About', href: '#about' },
      { id: 'n3', label: 'Contact', href: '#contact' },
      { id: 'n4', label: 'Menu parent', href: '#' },
      { id: 'n5', label: 'Top', href: '#top' },
    ])],
  };
  return {
    savedSections: [{ id: 'ssTop', name: 'Top Menu', section: menu }],
    pages: [{
      id: '10',
      name: 'Home',
      slug: '',
      layoutSections: [
        { ...menu, savedSectionId: 'ssTop', canonical: true },
        { id: 'sec-about', title: 'About us', anchorName: 'about', modules: [] },
        { id: 'sec-svc', title: 'Services', modules: [] },
      ],
    }],
  };
}

const jumpReasons = (p) => scan.brokenLinks(scan.collectProjectLinks(p), p.pages).map((l) => [scan.describeLink(l), l.reason]);

test('a shared menu jumping to names no section carries is broken; a named section, "#" and "#top" are not', () => {
  assert.deepEqual(jumpReasons(bayside()), [
    ['Saved section "Top Menu" › Top Menu › Menu › Menu Item "Services" (shown on 1 page)', 'jumps to #services, and nothing on the page has that name (on the Home page)'],
    ['Saved section "Top Menu" › Top Menu › Menu › Menu Item "Contact" (shown on 1 page)', 'jumps to #contact, and nothing on the page has that name (on the Home page)'],
  ]);
});

test('an id written inside a text module counts as somewhere to land', () => {
  const p = bayside();
  p.pages[0].layoutSections[2].modules.push({ type: 'text', text: '<h2 id="services">Services</h2><p id="contact">x</p>' });
  assert.deepEqual(jumpReasons(p), []);
});

test('a bare "#name" on a page is checked against THAT page', () => {
  const p = bayside();
  p.pages.push({ id: '11', name: 'Team', slug: 'team', layoutSections: [{ title: 'Hero', modules: [button('#about', 'Jump')] }] });
  assert.deepEqual(jumpReasons(p).filter(([where]) => where.startsWith('Team')), [
    ['Team page › Hero › Button "Jump"', 'jumps to #about, and nothing on the page has that name'],
  ]);
});

test('a typed "/page#name" and a section reference are checked against the page they name', () => {
  const p = bayside();
  p.pages.push({
    id: '11', name: 'Team', slug: 'team', layoutSections: [{ title: 'Hero', modules: [
      button('/#about', 'Lands'),
      button('/#nowhere', 'Typed miss'),
      button('page:10#sec-about|/#about', 'Ref lands'),
      button('page:10#sec-svc|/#services', 'Ref unnamed'),
      button('page:10#sec-gone|/#old', 'Ref gone'),
    ] }],
  });
  assert.deepEqual(jumpReasons(p).filter(([where]) => where.startsWith('Team')), [
    ['Team page › Hero › Button "Typed miss"', 'jumps to #nowhere, and nothing on the page has that name (on the Home page)'],
    ['Team page › Hero › Button "Ref unnamed"', 'jumps to a section that has no Anchor Name, so it opens the top of the page (on the Home page)'],
    ['Team page › Hero › Button "Ref gone"', 'jumps to a section that is no longer on the page (it was #old) (on the Home page)'],
  ]);
});

test('a jump whose PAGE is gone is reported once, for the page', () => {
  const p = bayside();
  p.pages[0].layoutSections.push({ title: 'Footer', modules: [button('page:99#s1|/gone#x'), button('/gone#x')] });
  const reasons = jumpReasons(p).filter(([where]) => where.includes('Footer')).map(([, reason]) => reason);
  assert.deepEqual(reasons, ['points at page 99, which no longer exists', 'goes to /gone, and no page has that address']);
});

test('a jump it cannot check is CANNOT TELL, never clean', () => {
  const p = bayside();
  // The shared menu is shown on no page, so there is no page to look for #services on.
  p.pages[0].layoutSections = p.pages[0].layoutSections.filter((s) => s.savedSectionId !== 'ssTop');
  // And a page read without its sections cannot say whether "/team#x" lands.
  p.pages.push({ id: '12', name: 'Team', slug: 'team' });
  p.pages[0].layoutSections.push({ title: 'Footer', modules: [button('/team#x', 'Team')] });
  const links = scan.collectProjectLinks(p);
  assert.deepEqual(scan.brokenLinks(links, p.pages), []);
  assert.deepEqual(scan.uncheckedLinks(links, p.pages).map((l) => [scan.describeLink(l), l.reason]), [
    ['Saved section "Top Menu" › Top Menu › Menu › Menu Item "Services"', 'jumps to #services on whichever page shows it, and no page shows this shared section — CANNOT TELL whether it lands'],
    ['Saved section "Top Menu" › Top Menu › Menu › Menu Item "About"', 'jumps to #about on whichever page shows it, and no page shows this shared section — CANNOT TELL whether it lands'],
    ['Saved section "Top Menu" › Top Menu › Menu › Menu Item "Contact"', 'jumps to #contact on whichever page shows it, and no page shows this shared section — CANNOT TELL whether it lands'],
    ['Home page › Footer › Button "Team"', 'jumps to part of Team page, which was read without its sections — CANNOT TELL whether it lands'],
  ]);
});

test('a bare "#name" never reads as a link TO a page being deleted', () => {
  const p = bayside();
  assert.deepEqual(scan.linksToPages(scan.collectProjectLinks(p), p.pages, ['10']), {});
});

test('a shared menu missing on every page that shows it says so once, not per page', () => {
  const p = bayside();
  p.pages.push({ id: '11', name: 'Blog', slug: 'blog', layoutSections: [{ ...bayside().pages[0].layoutSections[0] }, { id: 'x', anchorName: 'services', modules: [] }] });
  const reasons = jumpReasons(p).map(([, reason]) => reason);
  assert.deepEqual(reasons, [
    'jumps to #services, and nothing on the page has that name (on the Home page)',
    'jumps to #about, and nothing on the page has that name (on /blog)',
    'jumps to #contact, and nothing on the page has that name (on all 2 pages that show it)',
  ]);
});
