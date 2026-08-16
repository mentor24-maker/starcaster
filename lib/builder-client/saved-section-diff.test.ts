import { describe, expect, it } from 'vitest';
import {
  PAGE_LIST_LIMIT,
  capList,
  describeGroupCount,
  describeGroupVerdict,
  describeSectionDiff,
  diffSavedSectionOverwrite,
  diffSectionInstance,
  moduleExcerpt,
  plainTextExcerpt,
  type DiffModule,
  type DiffPage,
  type DiffSection,
} from './saved-section-diff';

const MENU = 'saved_section_menu';

function mod(over: Partial<DiffModule> = {}): DiffModule {
  return { id: 'm1', type: 'text', column: 'a', name: '', text: '', settings: {}, ...over };
}

function section(over: Partial<DiffSection> = {}): DiffSection {
  return {
    id: 'sec-master',
    title: 'Menu',
    alignment: 'left',
    paddingTop: '18',
    background: { mode: 'none', color: '', color2: '', imageUrl: '', styleKey: '' },
    modules: [mod()],
    ...over,
  };
}

/** A page holding one following instance of MENU, built from a section. */
function page(name: string, instance: DiffSection, instanceId = 'inst-1'): DiffPage {
  return {
    id: name.toLowerCase(),
    name,
    slug: name.toLowerCase(),
    layoutSections: [{ ...instance, id: instanceId, savedSectionId: MENU, canonical: true }],
  };
}

describe('reading content out of a module', () => {
  it('strips tags and entities so a paragraph reads as a paragraph', () => {
    expect(plainTextExcerpt('<p>Call <strong>555&#39;0100</strong>&nbsp;today</p>'))
      .toBe("Call 555'0100 today");
  });

  it('closes block tags with a space so two paragraphs do not run together', () => {
    expect(plainTextExcerpt('<p>One</p><p>Two</p>')).toBe('One Two');
  });

  it('falls back through the places a module keeps its visible words', () => {
    expect(moduleExcerpt(mod({ text: '<h2>Our rates</h2>' }))).toBe('Our rates');
    expect(moduleExcerpt(mod({ type: 'button', settings: { buttonText: 'Book now' } }))).toBe('Book now');
    expect(moduleExcerpt(mod({ type: 'image', settings: { imageUrl: 'https://cdn/x/hero.jpg?v=2' } }))).toBe('hero.jpg');
    expect(moduleExcerpt(mod({ name: 'Spacer' }))).toBe('Spacer');
    expect(moduleExcerpt(mod())).toBe('');
  });
});

describe('what one following page takes on', () => {
  it('the id and provenance the fan-out forces back are not reported as changes', () => {
    const before: DiffSection = { ...section(), id: 'inst-1', savedSectionId: MENU, canonical: true };
    const after: DiffSection = { ...section(), id: 'inst-1', savedSectionId: MENU, canonical: true };
    expect(diffSectionInstance(before, after)).toEqual([]);
  });

  it('an untouched instance is no visible change, not an empty-looking pass', () => {
    expect(diffSectionInstance(section(), section())).toHaveLength(0);
  });

  it('reports changed text as a short before and after', () => {
    const changes = diffSectionInstance(
      section({ modules: [mod({ text: '<p>Rates from $40/hr — no callout fee</p>' })] }),
      section({ modules: [mod({ text: '<p>Call 555-0100 for a free consult</p>' })] })
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('text');
    expect(changes[0].before).toBe('Rates from $40/hr — no callout fee');
    expect(changes[0].after).toBe('Call 555-0100 for a free consult');
  });

  it('names an added and a removed module by type and a scrap of content', () => {
    const changes = diffSectionInstance(
      section({ modules: [mod({ id: 'a', type: 'image', settings: { imageUrl: '/x/rates-banner.jpg' } })] }),
      section({ modules: [mod({ id: 'b', type: 'button', settings: { buttonText: 'Book now' } })] })
    );
    const removed = changes.find((c) => c.kind === 'module-removed');
    const added = changes.find((c) => c.kind === 'module-added');
    expect(removed?.detail).toContain('rates-banner.jpg');
    expect(added?.detail).toContain('Book now');
  });

  it('a canonicalLocked module is still replaced, and the diff says so', () => {
    // The flag guards module-level pushes; a section fan-out rewrites the whole
    // row regardless. Pretending otherwise would be the exact lie this exists
    // to prevent.
    const changes = diffSectionInstance(
      section({ modules: [mod({ text: '<p>Local wording</p>', canonicalLocked: true } as Partial<DiffModule>)] }),
      section({ modules: [mod({ text: '<p>Shared wording</p>' })] })
    );
    expect(changes.some((c) => c.kind === 'text')).toBe(true);
  });

  it('reports a reorder once for the row rather than once per module', () => {
    const one = mod({ id: 'a', type: 'heading' });
    const two = mod({ id: 'b', type: 'text' });
    const changes = diffSectionInstance(
      section({ modules: [one, two] }),
      section({ modules: [two, one] })
    );
    expect(changes.filter((c) => c.kind === 'module-moved')).toHaveLength(1);
    expect(changes[0].label).toBe('Modules reordered');
  });

  it('pairs a hand-rebuilt module by type and column, not by id', () => {
    const changes = diffSectionInstance(
      section({ modules: [mod({ id: 'old', text: '<p>Before</p>' })] }),
      section({ modules: [mod({ id: 'new', text: '<p>After</p>' })] })
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('text');
  });

  it('names the setting and the column for a per-column field', () => {
    const changes = diffSectionInstance(
      section({ cellPaddingTop: { a: '0' } }),
      section({ cellPaddingTop: { a: '24' } })
    );
    expect(changes[0].label).toBe('Cell padding top (column a)');
    expect(changes[0].before).toBe('0');
    expect(changes[0].after).toBe('24');
  });

  it('describes a background in words instead of dumping its object', () => {
    const changes = diffSectionInstance(
      section(),
      section({ background: { mode: 'image', color: '', color2: '', imageUrl: '/u/hero.jpg?v=3', styleKey: '' } })
    );
    expect(changes[0].label).toBe('Background');
    expect(changes[0].before).toBe('none');
    expect(changes[0].after).toBe('image hero.jpg');
  });

  it('a field that is absent on an older row and empty on the new one is not a change', () => {
    const changes = diffSectionInstance(section({ widthPercent: undefined }), section({ widthPercent: '' }));
    expect(changes).toEqual([]);
  });

  it('reports a module setting under the module it belongs to', () => {
    const changes = diffSectionInstance(
      section({ modules: [mod({ type: 'button', name: 'CTA', settings: { buttonText: 'Call' } })] }),
      section({ modules: [mod({ type: 'button', name: 'CTA', settings: { buttonText: 'Book' } })] })
    );
    expect(changes[0].label).toContain('CTA');
    expect(changes[0].label).toContain('Button text');
  });
});

describe('grouping the pages by what happens to them', () => {
  const proposed = section({ modules: [mod({ text: '<p>Shared wording</p>' })] });
  const stale = section({ modules: [mod({ text: '<p>Old wording</p>' })] });

  it('pages that change identically collapse into one group', () => {
    const pages = [page('Home', stale), page('About', stale), page('Services', stale)];
    const diff = diffSavedSectionOverwrite(pages, MENU, proposed);
    expect(diff.pages).toBe(3);
    expect(diff.changedPages).toBe(3);
    expect(diff.groups).toHaveLength(1);
    expect(diff.groups[0].pageLabels).toEqual(['Home', 'About', 'Services']);
    expect(diff.groups[0].changes).toHaveLength(1);
  });

  it('the page that drifted comes FIRST, ahead of the bulk it hides behind', () => {
    const drifted = section({
      modules: [mod({ text: '<p>Rates from $40/hr</p>' }), mod({ id: 'extra', type: 'image', settings: { imageUrl: '/u/rates.jpg' } })],
    });
    const diff = diffSavedSectionOverwrite([page('Home', stale), page('About', stale), page('Rates', drifted)], MENU, proposed);
    expect(diff.groups).toHaveLength(2);
    expect(diff.groups[0].pageLabels).toEqual(['Rates']);
    expect(diff.groups[0].changes.some((c) => c.kind === 'module-removed')).toBe(true);
    expect(diff.groups[1].pages).toBe(2);
  });

  it('no visible change is its own group, and it sorts last', () => {
    const pages = [page('Blog', proposed), page('Home', stale), page('Thanks', proposed)];
    const diff = diffSavedSectionOverwrite(pages, MENU, proposed);
    expect(diff.changedPages).toBe(1);
    expect(diff.unchangedPages).toBe(2);
    expect(diff.groups.map((g) => g.unchanged)).toEqual([false, true]);
    expect(diff.groups[1].pageLabels).toEqual(['Blog', 'Thanks']);
  });

  it('a group of 38 identical pages does not bury the 2 that differ', () => {
    const many = Array.from({ length: 38 }, (_, i) => page(`Page ${i + 1}`, stale, `inst-${i}`));
    const odd = section({ modules: [mod({ text: '<p>Hand-edited here</p>' })] });
    const diff = diffSavedSectionOverwrite([...many, page('Rates', odd), page('Team', proposed)], MENU, proposed);
    expect(diff.pages).toBe(40);
    // The one page that drifted reads before the 38 that did not, and the
    // "nothing to see" group is last.
    expect(diff.groups[0].pageLabels).toEqual(['Rates']);
    expect(diff.groups[1].pages).toBe(38);
    expect(diff.groups[2].unchanged).toBe(true);
  });

  it('skips unlinked copies and pages that never followed', () => {
    const pages: DiffPage[] = [
      page('Home', stale),
      { name: 'Unlinked', layoutSections: [{ ...stale, savedSectionId: MENU, canonical: false }] },
      { name: 'Other', layoutSections: [{ ...stale, savedSectionId: 'saved_section_footer', canonical: true }] },
      { name: 'Plain', layoutSections: [stale] },
    ];
    expect(diffSavedSectionOverwrite(pages, MENU, proposed).pages).toBe(1);
  });

  it('a page holding the copy twice says which copy each line is about', () => {
    const twice: DiffPage = {
      name: 'Odd',
      layoutSections: [
        { ...stale, id: 'i1', savedSectionId: MENU, canonical: true },
        { ...proposed, id: 'i2', savedSectionId: MENU, canonical: true },
      ],
    };
    const diff = diffSavedSectionOverwrite([twice], MENU, proposed);
    expect(diff.pages).toBe(1);
    expect(diff.groups[0].changes[0].label.startsWith('Copy 1:')).toBe(true);
  });

  it('falls back to the slug when a page has no name', () => {
    const unnamed: DiffPage = { slug: 'rates', layoutSections: [{ ...stale, savedSectionId: MENU, canonical: true }] };
    expect(diffSavedSectionOverwrite([unnamed], MENU, proposed).groups[0].pageLabels).toEqual(['/rates']);
  });

  it('flags a page list that came back at the API row cap', () => {
    // Past 1000 rows the editor's list is short but the fan-out still asks for
    // 5000, so the diff would under-report — the exact failure this prevents.
    const capped = Array.from({ length: PAGE_LIST_LIMIT }, (_, i) => page(`Page ${i}`, stale, `inst-${i}`));
    expect(diffSavedSectionOverwrite(capped, MENU, proposed).truncated).toBe(true);
    expect(diffSavedSectionOverwrite([page('Home', stale)], MENU, proposed).truncated).toBe(false);
  });

  it('answers empty rather than throwing when there is nothing to compare', () => {
    expect(diffSavedSectionOverwrite(null, MENU, proposed).pages).toBe(0);
    expect(diffSavedSectionOverwrite([page('Home', stale)], '', proposed).pages).toBe(0);
    expect(diffSavedSectionOverwrite([page('Home', stale)], MENU, null).pages).toBe(0);
  });
});

describe('capping what is shown without hiding what was dropped', () => {
  const proposed = section({ modules: [mod({ text: '<p>Shared</p>' })] });
  const stale = section({ modules: [mod({ text: '<p>Old</p>' })] });

  it('keeps the count of what it left out', () => {
    expect(capList(['a', 'b', 'c'], 2)).toEqual({ shown: ['a', 'b'], more: 1 });
    expect(capList(['a', 'b'], 8)).toEqual({ shown: ['a', 'b'], more: 0 });
    expect(capList(null, 8)).toEqual({ shown: [], more: 0 });
  });

  it('labels a group by its size and its verdict', () => {
    const diff = diffSavedSectionOverwrite([page('Home', stale), page('About', proposed)], MENU, proposed);
    expect(describeGroupCount(diff.groups[0])).toBe('1 page');
    expect(describeGroupVerdict(diff.groups[0])).toBe('1 change');
    expect(describeGroupVerdict(diff.groups[1])).toBe('no visible change');
  });
});

describe('the sentence over the top', () => {
  const proposed = section({ modules: [mod({ text: '<p>Shared</p>' })] });
  const stale = section({ modules: [mod({ text: '<p>Old</p>' })] });

  it('says nothing else follows it', () => {
    expect(describeSectionDiff(diffSavedSectionOverwrite([], MENU, proposed)))
      .toBe('No other page follows this section, so nothing else changes.');
  });

  it('says "no visible change" out loud when that is the whole answer', () => {
    const diff = diffSavedSectionOverwrite([page('Home', proposed), page('About', proposed)], MENU, proposed);
    expect(describeSectionDiff(diff)).toBe('All 2 pages already match — no visible change on any of them.');
  });

  it('splits the count when only some pages change', () => {
    const diff = diffSavedSectionOverwrite([page('Home', stale), page('About', proposed)], MENU, proposed);
    expect(describeSectionDiff(diff)).toBe('1 page changes; the other 1 has no visible change.');
  });

  it('counts plainly when every page changes', () => {
    const diff = diffSavedSectionOverwrite([page('Home', stale), page('About', stale)], MENU, proposed);
    expect(describeSectionDiff(diff)).toBe('2 pages change.');
  });
});
