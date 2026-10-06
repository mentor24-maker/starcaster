import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExportSummary, HowToLoad, type ExportReport } from './wordpress-export-panel';

/**
 * The Export to WordPress (Divi) card's summary. Asserted on rendered markup,
 * because each line is a claim the operator acts on before handing a client
 * a file: what came along, what was left out on purpose, and — the one that
 * matters most — which modules did NOT make it and need rebuilding by hand.
 * The panel itself talks to window.App, so only the pure summary is rendered.
 */

function report(overrides: Partial<ExportReport> = {}): ExportReport {
  return {
    generatedAt: '2026-10-04T00:00:00.000Z',
    project: { name: 'Club', slug: 'club' },
    pages: [
      { name: 'Home', slug: 'home', status: 'publish', sections: 3, modules: 9 },
      { name: 'About', slug: 'about', status: 'draft', sections: 1, modules: 2 },
    ],
    pagesLeftOut: [],
    posts: { exported: 1, drafts: 2 },
    header: { sections: 2, modules: 4 },
    footer: { sections: 1, modules: 1 },
    menu: { items: 5 },
    images: 12,
    notExported: [],
    changed: [],
    homePageSlug: 'home',
    ...overrides,
  };
}

describe('ExportSummary', () => {
  it('counts what the file holds, and says why some pages are drafts', () => {
    const html = renderToStaticMarkup(<ExportSummary report={report()} bytes={2_300_000} />);
    expect(html).toContain('2 pages (1 as drafts, because they are unpublished here)');
    expect(html).toContain('1 blog post, plus 2 drafts');
    expect(html).toContain('12 images');
    expect(html).toContain('Header: 2 sections · Footer: 1 section');
    expect(html).toContain('Main menu: 5 links');
    expect(html).toContain('File size: 2.2 MB');
    expect(html).toContain('nothing is left behind');
  });

  it('names every module that did not export, with its page and reason', () => {
    const html = renderToStaticMarkup(
      <ExportSummary
        report={report({
          notExported: [{ where: 'Home', module: 'Spiral', type: 'galaxy', reason: 'animated effect with no Divi equivalent' }],
          changed: [{ where: 'Contact', module: 'Enquiry', type: 'crm-form', reason: 'rebuilt as a standard Divi contact form' }],
          pagesLeftOut: [{ name: 'Admin', slug: 'admin', reason: 'admin page' }],
        })}
        bytes={4000}
      />,
    );
    expect(html).toContain('<strong>Home</strong> — Spiral: animated effect with no Divi equivalent');
    expect(html).toContain('<strong>Contact</strong> — Enquiry: rebuilt as a standard Divi contact form');
    expect(html).toContain('Left out on purpose: Admin (admin page).');
    expect(html).not.toContain('nothing is left behind');
  });

  it('says plainly when a site has no shared header, footer or menu', () => {
    const html = renderToStaticMarkup(
      <ExportSummary report={report({ header: { sections: 0, modules: 0 }, footer: { sections: 0, modules: 0 }, menu: { items: 0 } })} bytes={10} />,
    );
    expect(html).toContain('No header — this site has no shared header section · no shared footer section');
    expect(html).toContain('No menu found on this site');
  });
});

describe('the .wpress choice', () => {
  it('does not show the .xml size for a .wpress, and says the images make it larger', () => {
    const html = renderToStaticMarkup(<ExportSummary report={report()} bytes={2_300_000} format="wpress" />);
    expect(html).not.toContain('File size: 2.2 MB');
    expect(html).toContain('carries all 12 images inside');
  });

  it('warns before the download that importing a .wpress replaces the site\'s pages and posts', () => {
    const html = renderToStaticMarkup(<HowToLoad format="wpress" homePageSlug="home" />);
    expect(html).toContain('All-in-One WP Migration');
    expect(html).toContain('replaces the site&#x27;s pages, posts, menus and comments');
    expect(html).toContain('logins and settings are kept');
    // The file sets these itself, so the steps must not send anyone to do them.
    expect(html).not.toContain('Settings → Reading');
    expect(html).not.toContain('Appearance → Menus');
  });

  it('keeps the WordPress Importer steps for the .xml', () => {
    const html = renderToStaticMarkup(<HowToLoad format="xml" homePageSlug="home" />);
    expect(html).toContain('Tools → Import → WordPress');
    expect(html).toContain('Download and import file attachments');
    expect(html).toContain('set the homepage to <strong>Home</strong>');
  });
});
