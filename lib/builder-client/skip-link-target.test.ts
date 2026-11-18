import { describe, expect, it } from 'vitest';
import {
  SKIP_LINK_TARGET_ID,
  pickSkipLinkTarget,
  skipLinkTargetElementId,
  type SkipLinkSection
} from './skip-link-target';

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
