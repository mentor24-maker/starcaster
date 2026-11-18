import { describe, expect, it } from 'vitest';
import {
  SKIP_LINK_TARGET_ID,
  pickSkipLinkTarget,
  skipLinkTargetElementId,
  withSectionLineage,
  type SkipLinkSection
} from './skip-link-target';
import { normalizeBuilderDocument } from './builder-template';

/**
 * Which section the live page's hidden "Skip to content" link jumps to
 * (SC-857). Each case is one line of the rule in skip-link-target.ts.
 */

const shared = (id: string, extra: Partial<SkipLinkSection> = {}): SkipLinkSection => ({
  id,
  canonical: true,
  savedSectionId: `saved-${id}`,
  modules: [{ type: 'text' }],
  ...extra
});
const nav = (id: string): SkipLinkSection => ({ id, modules: [{ type: 'text' }, { type: 'navigation' }] });
const plain = (id: string, extra: Partial<SkipLinkSection> = {}): SkipLinkSection => ({
  id,
  modules: [{ type: 'text' }],
  ...extra
});

describe('pickSkipLinkTarget', () => {
  it('jumps past a shared (saved) header to the first section after it', () => {
    const sections = [shared('contact-strip'), shared('menu-banner'), plain('hero'), plain('about')];
    expect(pickSkipLinkTarget(sections)?.id).toBe('hero');
  });

  it('with no shared sections, jumps to the first section that is not navigation', () => {
    const sections = [nav('menu'), plain('hero'), plain('about')];
    expect(pickSkipLinkTarget(sections)?.id).toBe('hero');
  });

  it('counts a navigation section inside the leading header run', () => {
    const sections = [shared('contact-strip'), nav('menu'), plain('hero')];
    expect(pickSkipLinkTarget(sections)?.id).toBe('hero');
  });

  it('does not treat a shared section further down as header', () => {
    const sections = [plain('hero'), shared('cta'), plain('about')];
    expect(pickSkipLinkTarget(sections)?.id).toBe('hero');
  });

  it('on a page with only one section, jumps to that section', () => {
    expect(pickSkipLinkTarget([plain('only')])?.id).toBe('only');
    expect(pickSkipLinkTarget([shared('only')])?.id).toBe('only');
    expect(pickSkipLinkTarget([nav('only')])?.id).toBe('only');
  });

  it('when every section is header furniture, prefers the first one without a menu', () => {
    const sections = [nav('menu'), shared('footer')];
    expect(pickSkipLinkTarget(sections)?.id).toBe('footer');
  });

  it('when every section holds a menu, falls back to the first section', () => {
    expect(pickSkipLinkTarget([nav('a'), nav('b')])?.id).toBe('a');
  });

  it('a page with no sections gets no skip link', () => {
    expect(pickSkipLinkTarget([])).toBeNull();
    expect(pickSkipLinkTarget(null)).toBeNull();
    expect(pickSkipLinkTarget(undefined)).toBeNull();
  });

  it('returns the section object itself, so two rows sharing an id cannot be confused', () => {
    const header = shared('dup');
    const content = plain('dup');
    expect(pickSkipLinkTarget([header, content])).toBe(content);
  });
});

describe('skipLinkTargetElementId', () => {
  it('uses the fixed id when the section has no anchor name', () => {
    expect(skipLinkTargetElementId(plain('hero'))).toBe(SKIP_LINK_TARGET_ID);
  });

  it("keeps the section's own anchor name, because that is already its id", () => {
    expect(skipLinkTargetElementId(plain('hero', { anchorName: 'welcome' }))).toBe('welcome');
  });
});

/**
 * The SC-857 send-back: live pages run sections through
 * normalizeBuilderDocument, which drops savedSectionId/canonical, so the
 * shared-header rule above never fired on a real page. These go through the
 * REAL normalizer, the way BuilderPublicSitePage and the preview page do.
 */
describe('withSectionLineage (through the real page loader)', () => {
  const rawPage = (shape: 'array' | 'wrapped' | 'string') => {
    const sections = [
      { id: 'logo-bar', canonical: true, savedSectionId: 'saved-logo', layout: 'single', modules: [{ type: 'text', text: 'Logo' }] },
      { id: 'menu', layout: 'single', modules: [{ type: 'navigation', settings: {} }] },
      { id: 'content', layout: 'single', modules: [{ type: 'text', text: 'Hello' }] }
    ];
    if (shape === 'wrapped') return { name: 'Home', layoutSections: { sections } };
    if (shape === 'string') return { name: 'Home', layoutSections: JSON.stringify(sections) };
    return { name: 'Home', layoutSections: sections };
  };

  it('the loader alone loses the marker (why this helper exists)', () => {
    const doc = normalizeBuilderDocument(rawPage('array'));
    expect(doc.layoutSections[0].savedSectionId).toBeUndefined();
  });

  for (const shape of ['array', 'string'] as const) {
    it(`a shared logo bar with no menu, then a menu: the link skips both (${shape})`, () => {
      const page = rawPage(shape);
      const sections = withSectionLineage(page, normalizeBuilderDocument(page).layoutSections);
      expect(sections[0]).toMatchObject({ canonical: true, savedSectionId: 'saved-logo' });
      expect(pickSkipLinkTarget(sections)?.id).toBe('content');
    });
  }

  it('reads the { sections } wrapper the way the loader does', () => {
    const page = { name: 'Home', sections: (rawPage('array').layoutSections as unknown[]) };
    const sections = withSectionLineage(page, normalizeBuilderDocument(page).layoutSections);
    expect(pickSkipLinkTarget(sections)?.id).toBe('content');
  });

  it('pairs sections the way the loader does when it drops a junk row', () => {
    const page = rawPage('array') as { layoutSections: unknown[] };
    page.layoutSections = [null, ...page.layoutSections, 'junk'];
    const sections = withSectionLineage(page, normalizeBuilderDocument(page).layoutSections);
    expect(sections.map((s) => s.id)).toEqual(['logo-bar', 'menu', 'content']);
    expect(pickSkipLinkTarget(sections)?.id).toBe('content');
  });

  it('changes nothing when the two lists do not pair up one-for-one', () => {
    const normalized = normalizeBuilderDocument(rawPage('array')).layoutSections;
    expect(withSectionLineage({ layoutSections: [] }, normalized)).toBe(normalized);
  });

  it('leaves a section with no lineage untouched (same object)', () => {
    const page = rawPage('array');
    const normalized = normalizeBuilderDocument(page).layoutSections;
    expect(withSectionLineage(page, normalized)[2]).toBe(normalized[2]);
  });
});
