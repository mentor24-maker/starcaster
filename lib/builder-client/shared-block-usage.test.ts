import { describe, expect, it } from 'vitest';
import {
  buildSavedSectionUsageIndex,
  describeCanonicalOverwrite,
  describePropagationOutcome,
  describePushImpact,
  describeUsage,
  driftedFollowingPages,
  savedSectionUsage,
  type UsagePage,
  type UsagePageWithContent,
} from './shared-block-usage';

const MENU = 'saved_section_menu';
const FOOTER = 'saved_section_footer';

function page(name: string, sections: Array<{ id?: string; canonical?: boolean }>): UsagePage {
  return {
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    layoutSections: sections.map((s) => ({ savedSectionId: s.id, canonical: s.canonical })),
  };
}

describe('counting who follows a shared block', () => {
  const pages: UsagePage[] = [
    page('Home', [{ id: MENU, canonical: true }, { id: FOOTER, canonical: true }]),
    page('About', [{ id: MENU, canonical: true }]),
    page('Contact', [{ id: MENU, canonical: false }]),
    page('Landing', [{}]),
  ];

  it('counts only the copies that actually take updates', () => {
    const usage = savedSectionUsage(pages, MENU);
    expect(usage.following).toBe(2);
    expect(usage.pages).toBe(2);
    expect(usage.independent).toBe(1);
    expect(usage.pageLabels).toEqual(['Home', 'About']);
  });

  it('a page holding the same block twice counts as one page', () => {
    const twice = [page('Odd', [{ id: MENU, canonical: true }, { id: MENU, canonical: true }])];
    const usage = savedSectionUsage(twice, MENU);
    expect(usage.following).toBe(2);
    expect(usage.pages).toBe(1);
  });

  it('indexes every block in a single pass', () => {
    const index = buildSavedSectionUsageIndex(pages);
    expect(index.get(MENU)?.pages).toBe(2);
    expect(index.get(FOOTER)?.pages).toBe(1);
  });

  it('an unknown block, and junk input, are simply unused', () => {
    expect(savedSectionUsage(pages, 'nope').pages).toBe(0);
    expect(savedSectionUsage(null, MENU).pages).toBe(0);
    expect(savedSectionUsage(pages, '').pages).toBe(0);
    expect(buildSavedSectionUsageIndex(undefined).size).toBe(0);
  });
});

describe('what the operator reads', () => {
  it('describes usage in pages, not jargon', () => {
    expect(describeUsage({ following: 3, independent: 0, pages: 3, pageLabels: [] })).toBe('3 pages');
    expect(describeUsage({ following: 1, independent: 0, pages: 1, pageLabels: [] })).toBe('1 page');
    expect(describeUsage({ following: 0, independent: 2, pages: 0, pageLabels: [] })).toBe('2 disconnected copies');
    expect(describeUsage(undefined)).toBe('Not used yet');
  });

  it('warns before a save that reaches other pages, and names them', () => {
    const text = describePushImpact('Menu Banner', {
      following: 2, independent: 0, pages: 2, pageLabels: ['Home', 'About'],
    });
    expect(text).toContain('updates it on 2 pages');
    expect(text).toContain('• Home');
    expect(text).toContain('• About');
    expect(text).toContain('Continue?');
  });

  it('stays quiet when nothing follows the block', () => {
    // A first save, or a block nobody uses, must not raise a dialog.
    expect(describePushImpact('New Section', { following: 0, independent: 0, pages: 0, pageLabels: [] })).toBeNull();
    expect(describePushImpact('New Section', undefined)).toBeNull();
  });

  it('caps the preview list rather than printing 138 lines', () => {
    const labels = Array.from({ length: 40 }, (_, i) => `Page ${i + 1}`);
    const text = describePushImpact('Header', { following: 40, independent: 0, pages: 40, pageLabels: labels }) ?? '';
    expect(text).toContain('updates it on 40 pages');
    expect(text).toContain('…and 28 more');
    expect(text).not.toContain('Page 40');
  });

  it('spells out what overwriting the original does, and to which pages', () => {
    const impact = describeCanonicalOverwrite('Footer Menu', {
      following: 3, independent: 1, pages: 3, pageLabels: ['Home', 'About', 'Contact'],
    });
    expect(impact.summary).toContain('Replaces “Footer Menu” itself');
    expect(impact.summary).toContain('the 3 pages that follow it');
    expect(impact.pageLabels).toEqual(['Home', 'About', 'Contact']);
    expect(impact.more).toBe(0);
  });

  it('still asks when nothing follows the original yet', () => {
    // Unlike describePushImpact, this one never returns "no question to ask" —
    // the choice between updating the original and filing a copy stands even
    // when the original is used nowhere else. That IS the bug it exists for.
    const impact = describeCanonicalOverwrite('Footer Menu', undefined);
    expect(impact.summary).toContain('Replaces “Footer Menu” itself');
    expect(impact.summary).toContain('No other page follows it yet');
    expect(impact.pageLabels).toEqual([]);
  });

  it('caps the overwrite page list the same way the confirm text does', () => {
    const labels = Array.from({ length: 40 }, (_, i) => `Page ${i + 1}`);
    const impact = describeCanonicalOverwrite('Header', {
      following: 40, independent: 0, pages: 40, pageLabels: labels,
    });
    expect(impact.pageLabels).toHaveLength(12);
    expect(impact.more).toBe(28);
  });

  it('reports what actually happened, including a partial failure', () => {
    expect(describePropagationOutcome('Menu', { updated: 35, failed: 0 }))
      .toBe('Saved "Menu" and updated 35 pages.');
    expect(describePropagationOutcome('Menu', { updated: 1, failed: 0 }))
      .toBe('Saved "Menu" and updated 1 page.');
    expect(describePropagationOutcome('Menu', { updated: 0, failed: 0 }))
      .toBe('Saved "Menu". No pages use it yet.');
    // The case that used to be invisible: a fan-out that half worked.
    expect(describePropagationOutcome('Menu', { updated: 30, failed: 5 }))
      .toContain('5 pages could not be updated');
  });

  it('names the pages a fan-out skipped for having local changes', () => {
    expect(describePropagationOutcome('Menu', { updated: 32, failed: 0, skipped: [{ name: 'Rates' }, { name: 'FAQ' }] }))
      .toBe('Saved "Menu" and updated 32 pages. 2 pages have local changes and were skipped.');
    expect(describePropagationOutcome('Menu', { updated: 0, failed: 0, skipped: [{ name: 'Rates' }] }))
      .toBe('Saved "Menu". 1 page has local changes and was skipped — nothing else changed.');
    // No skipped key at all (an older caller) must read exactly as before.
    expect(describePropagationOutcome('Menu', { updated: 5, failed: 0 }))
      .toBe('Saved "Menu" and updated 5 pages.');
  });
});

describe('drift: a following copy edited on its own page', () => {
  const master = { title: 'Footer', modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'Call us', settings: {} }] };

  function pageWithContent(name: string, section: Record<string, unknown> | null): UsagePageWithContent {
    return {
      name,
      slug: name.toLowerCase(),
      layoutSections: section
        ? [{ savedSectionId: FOOTER, canonical: true, title: 'Footer', modules: master.modules, ...section }]
        : [],
    };
  }

  it('an untouched copy is not reported as drifted', () => {
    const pages = [pageWithContent('Home', {})];
    expect(driftedFollowingPages(pages, FOOTER, master)).toEqual({ count: 0, pageLabels: [] });
  });

  it('a hand-edited copy is named', () => {
    const pages = [
      pageWithContent('Home', {}),
      pageWithContent('Rates', { modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'EDITED', settings: {} }] }),
    ];
    expect(driftedFollowingPages(pages, FOOTER, master)).toEqual({ count: 1, pageLabels: ['Rates'] });
  });

  it('an unfollowed (independent) copy is never counted as drifted — it opted out on purpose', () => {
    const pages = [pageWithContent('Rates', { canonical: false, modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'EDITED', settings: {} }] })];
    expect(driftedFollowingPages(pages, FOOTER, master).count).toBe(0);
  });

  it('with no master to compare against, nothing is ever reported as drifted', () => {
    const pages = [pageWithContent('Rates', { modules: [{ id: 'm1', type: 'text', column: 'main', name: '', text: 'EDITED', settings: {} }] })];
    expect(driftedFollowingPages(pages, FOOTER, null)).toEqual({ count: 0, pageLabels: [] });
  });

  it('describePushImpact splits the count into "will update" and "will be skipped"', () => {
    const text = describePushImpact('Footer', { following: 3, independent: 0, pages: 3, pageLabels: ['Home', 'Rates', 'FAQ'] }, 1);
    expect(text).toContain('updates it on 2 pages');
    expect(text).toContain('1 page has local changes and will be skipped');
  });

  it('describeCanonicalOverwrite does the same for the save-modal impact', () => {
    const impact = describeCanonicalOverwrite(
      'Footer',
      { following: 3, independent: 0, pages: 3, pageLabels: ['Home', 'Rates', 'FAQ'] },
      ['Rates']
    );
    expect(impact.summary).toContain('2 pages');
    expect(impact.summary).toContain('1 page has local changes and will be skipped');
    expect(impact.driftedPageLabels).toEqual(['Rates']);
  });

  it('with no drifted pages, both descriptions read exactly as they did before Sync 5/7', () => {
    const usage = { following: 3, independent: 0, pages: 3, pageLabels: ['Home', 'About', 'Contact'] };
    expect(describePushImpact('Footer', usage)).not.toContain('will be skipped');
    expect(describeCanonicalOverwrite('Footer', usage).summary).not.toContain('will be skipped');
  });
});
