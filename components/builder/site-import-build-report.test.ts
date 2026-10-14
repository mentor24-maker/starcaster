import { describe, expect, it } from 'vitest';
import {
  MENUS_PREDATE_MESSAGE,
  leftoverReason,
  mapReportUrl,
  summarizeBuildReport,
  summarizeMenus,
} from './site-import-build-report';

/**
 * Task 86bch6e2q. The fixture is a trimmed copy of the REAL map report for
 * strandsmovie.com (job simp_1791736361987_b1etxy), including its two extra
 * copies of the home page, which share the source path "/".
 */
const strands = {
  // The headline counter is deliberately wrong here: the total must come
  // from the rows, which is what an older report needed (see the source).
  elements: { total: 3806, mapped: 1097, placeholder: 0 },
  pages: [
    { path: '/', slug: 'home', modules: 21, placeholders: 3 },
    { path: '/the-story/', slug: 'the-story', modules: 46, placeholders: 2 },
    { path: '/2025/05/28/five-plot-holes-in-the-strands-screenplay/', slug: '2025-05-28-five-plot-holes', modules: 12, placeholders: 3 },
    { path: '/author/dane/', slug: 'author-dane', modules: 7, placeholders: 2 },
    { path: '/category/uncategorized/', slug: 'category-uncategorized', modules: 7, placeholders: 2 },
    { path: '/nfts/strands-movie-poster-v1/', slug: 'nfts-strands-movie-poster-v1', modules: 8, placeholders: 2 },
    { path: '/forums/', slug: 'forums', modules: 14, placeholders: 3 },
    { path: '/', slug: 'home-imported', modules: 8, placeholders: 2 },
    { path: '/', slug: 'home-imported-2', modules: 8, placeholders: 2 },
  ],
  placeholderPatterns: [
    { signature: 'form: no text', count: 44 },
    { signature: 'embed: no text', count: 11 },
    { signature: 'form: short text', count: 10 },
    { signature: 'form: long text', count: 5 },
    { signature: 'table: 9 row 36 cell long text', count: 2 },
    { signature: 'table: 5 row 10 cell long text', count: 14 },
  ],
};

describe('leftoverReason', () => {
  it('flags WordPress leftovers in plain words', () => {
    expect(leftoverReason({ path: '/author/dane/', slug: 'author-dane' })).toMatch(/author/);
    expect(leftoverReason({ path: '/category/strands/', slug: 'category-strands' })).toMatch(/category/);
    expect(leftoverReason({ path: '/tag/news/', slug: 'tag-news' })).toMatch(/tag/);
    expect(leftoverReason({ path: '/forums/forum/x/', slug: 'forums-forum-x' })).toMatch(/forum/);
    expect(leftoverReason({ path: '/2025/10/26/hello', slug: '2025-10-26-hello' })).toMatch(/dated/);
    expect(leftoverReason({ path: '/feed/', slug: 'feed' })).toMatch(/feed/);
    expect(leftoverReason({ path: '/author/dane/page/2/', slug: 'x' })).not.toBeNull();
  });

  it('flags repeat copies of the home page, but not the first one', () => {
    expect(leftoverReason({ path: '/', slug: 'home' })).toBeNull();
    expect(leftoverReason({ path: '/', slug: 'home' }, true)).toMatch(/home page/);
    expect(leftoverReason({ path: '/', slug: 'home-imported' })).toMatch(/home page/);
    expect(leftoverReason({ path: '/', slug: 'home-imported-2' })).toMatch(/home page/);
  });

  it('flags a page the mapper renamed because its address was taken', () => {
    expect(leftoverReason({ path: '/Events-Calendar/', slug: 'events-calendar-imported' })).toMatch(/duplicate/);
    expect(leftoverReason({ path: '/events-calendar/', slug: 'events-calendar' })).toBeNull();
  });

  it('leaves real pages alone', () => {
    for (const path of ['/the-story/', '/content/music/', '/nfts/strands-movie-poster-v1/', '/privacy-policy/', '/blog/']) {
      expect(leftoverReason({ path, slug: 'x' })).toBeNull();
    }
  });
});

describe('summarizeBuildReport', () => {
  it('keeps every page from the report, in order, with its counts', () => {
    const summary = summarizeBuildReport(strands);
    expect(summary.rows.map((r) => r.slug)).toEqual(strands.pages.map((p) => p.slug));
    expect(summary.rows[0]).toMatchObject({ path: '/', slug: 'home', modules: 21, placeholders: 3, leftover: null });
  });

  it('counts the leftovers', () => {
    const summary = summarizeBuildReport(strands);
    expect(summary.rows.filter((r) => r.leftover).map((r) => r.slug)).toEqual([
      '2025-05-28-five-plot-holes',
      'author-dane',
      'category-uncategorized',
      'forums',
      'home-imported',
      'home-imported-2',
    ]);
    expect(summary.leftoverCount).toBe(6);
  });

  it('totals placeholders by kind', () => {
    const summary = summarizeBuildReport(strands);
    expect(summary.placeholderTotal).toBe(21);
    expect(summary.placeholderKinds).toEqual([
      { kind: 'form', count: 59 },
      { kind: 'table', count: 16 },
      { kind: 'embed', count: 11 },
    ]);
  });

  it('reports no theme when the report carries none', () => {
    expect(summarizeBuildReport(strands).theme).toBeNull();
  });

  it('survives an empty or malformed report', () => {
    const summary = summarizeBuildReport({} as never);
    expect(summary.rows).toEqual([]);
    expect(summary.placeholderTotal).toBe(0);
  });
});

describe('mapReportUrl', () => {
  const capture = 'https://store.public.blob.vercel-storage.com/SiteImport/simp_1/capture/index.json';
  it('prefers the URL the apply run recorded', () => {
    expect(mapReportUrl('simp_1', 'https://x/report.json', capture)).toBe('https://x/report.json');
  });
  it('derives the dry-run path from the capture index location', () => {
    expect(mapReportUrl('simp_1', undefined, capture)).toBe(
      'https://store.public.blob.vercel-storage.com/SiteImport/simp_1/map-report.json'
    );
  });
  it('returns null when there is nothing to derive from', () => {
    expect(mapReportUrl('simp_1', undefined, undefined)).toBeNull();
    expect(mapReportUrl('simp_2', undefined, capture)).toBeNull();
  });
});

/**
 * Task 86bchydp7. The `menus` shapes are what lib/site-import/map.ts writes
 * (86bchydp6); the notes are copied from it word for word.
 */
describe('summarizeMenus', () => {
  const withBoth = {
    pages: [],
    menus: { top: { items: 25, topLevel: 7, logo: true }, footer: { items: 2 }, notes: [] },
  };

  it('describes both menus', () => {
    const summary = summarizeMenus(withBoth);
    expect(summary.predates).toBe(false);
    if (summary.predates) return;
    expect(summary.lines).toEqual([
      { kind: 'top', label: 'Top Menu', detail: '25 links (7 at the top), logo found', reasons: [], built: null },
      { kind: 'footer', label: 'Footer Menu', detail: '2 links', reasons: [], built: null },
    ]);
  });

  it('gives both reasons verbatim when there is no logo and no footer', () => {
    const logoNote = 'no logo found in the header — the Top Menu is one column, menu only';
    const footerNote = 'no links found in the footer — no Footer Menu';
    const summary = summarizeMenus({
      pages: [],
      menus: { top: { items: 1, topLevel: 1, logo: false }, footer: null, notes: [logoNote, footerNote] },
    });
    if (summary.predates) throw new Error('read as predating menus');
    const [top, footer] = summary.lines;
    expect(top.detail).toBe('1 link (1 at the top)');
    expect(top.reasons).toEqual([logoNote]);
    expect(footer.detail).toBeNull();
    expect(footer.reasons).toEqual([footerNote]);
  });

  it('routes a missing Top Menu reason to the Top Menu, not the footer', () => {
    const summary = summarizeMenus({
      pages: [],
      menus: {
        top: null,
        footer: { items: 4 },
        notes: [
          'no logo found in the header — the Top Menu is one column, menu only',
          'no header menu found — the Top Menu has no links',
          'no header menu and no logo — no Top Menu',
        ],
      },
    });
    if (summary.predates) throw new Error('read as predating menus');
    expect(summary.lines[0].detail).toBeNull();
    expect(summary.lines[0].reasons).toHaveLength(3);
    expect(summary.lines[1].reasons).toEqual([]);
  });

  it('says a pre-menu report predates menu capture, never "no menus"', () => {
    const summary = summarizeMenus(strands);
    expect(summary).toEqual({ predates: true, message: MENUS_PREDATE_MESSAGE });
    expect(MENUS_PREDATE_MESSAGE).toMatch(/predates menu capture/);
    expect(MENUS_PREDATE_MESSAGE).not.toMatch(/no menus/i);
  });

  it('names the saved section each menu became after a build', () => {
    const summary = summarizeMenus(withBoth, {
      ids: { top: 'ss_1', footer: 'ss_2' },
      sections: [
        { id: 'ss_1', name: 'Top Menu (strandsmovie.com)' },
        { id: 'ss_9', name: 'Footer Menu' },
      ],
    });
    if (summary.predates) throw new Error('read as predating menus');
    expect(summary.lines[0].built).toBe('saved section “Top Menu (strandsmovie.com)”');
    expect(summary.lines[1].built).toBe('saved section ss_2 no longer exists in this project');
  });

  it('says why a built menu cannot be named', () => {
    const failed = summarizeMenus(withBoth, { ids: { top: 'ss_1' }, sections: null, error: 'HTTP 500' });
    if (failed.predates) throw new Error('read as predating menus');
    expect(failed.lines[0].built).toBe('saved section ss_1 (could not read its name: HTTP 500)');
    expect(failed.lines[1].built).toBe('no saved section was recorded for it on this import');
  });
});
