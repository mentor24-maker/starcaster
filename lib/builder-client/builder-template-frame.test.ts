import { describe, expect, it } from 'vitest';
import {
  applyTemplateFrame,
  bodySectionsOf,
  describeTemplateFrameChange,
  frameSectionsOf,
  isFrameSection,
  type FrameSection
} from './builder-template-frame';

/**
 * The property that matters, stated once: APPLYING A TEMPLATE NEVER LOSES BODY.
 *
 * On 2026-08-14 applying a template assigned its sections over the page's and
 * the Delray home page went from 35 sections to 4. PR #231 stopped that by
 * refusing to touch a page with content; this makes the operation correct
 * instead of inert. Every test below is ultimately checking that the body
 * comes out the other side.
 */

const frame = (savedSectionId: string, title: string): FrameSection => ({
  id: `inst-${savedSectionId}`,
  canonical: true,
  savedSectionId,
  title
});

const body = (id: string, title: string): FrameSection => ({ id, title });

describe('what counts as frame', () => {
  it('is a live link to a saved section, and nothing else', () => {
    expect(isFrameSection(frame('ss1', 'Header'))).toBe(true);
    expect(isFrameSection(body('b1', 'Hero'))).toBe(false);
  });

  it('a detached copy is body — it is the page\'s own now', () => {
    // Detaching sets canonical:false but keeps savedSectionId as provenance.
    expect(isFrameSection({ canonical: false, savedSectionId: 'ss1' })).toBe(false);
  });

  it('canonical without a saved section is not frame — it links to nothing', () => {
    expect(isFrameSection({ canonical: true })).toBe(false);
  });

  it('survives junk instead of throwing on the save path', () => {
    expect(isFrameSection(null)).toBe(false);
    expect(isFrameSection(undefined)).toBe(false);
    expect(bodySectionsOf(null)).toEqual([]);
    expect(frameSectionsOf(undefined)).toEqual([]);
  });
});

describe('applying a template frame', () => {
  const page = [
    frame('contact', 'Contact Strip'),
    frame('menu', 'Menu Banner'),
    body('hero', 'Hero'),
    body('cards', 'Feature Cards'),
    body('programs', 'Programs'),
    frame('footer', 'Footer')
  ];

  const template = [
    frame('contact2', 'Slim Contact Bar'),
    body('placeholder', 'Your Heading Goes Here'),
    frame('footer2', 'Big Footer')
  ];

  it('keeps every body section, in order', () => {
    const result = applyTemplateFrame(page, template);
    const titles = result.sections.filter((s) => !isFrameSection(s)).map((s) => s.title);
    expect(titles).toEqual(['Hero', 'Feature Cards', 'Programs']);
    expect(result.keptBody).toBe(3);
  });

  it('discards the TEMPLATE\'s own body — its placeholder must not reach the page', () => {
    const result = applyTemplateFrame(page, template);
    const titles = result.sections.map((s) => s.title);
    expect(titles).not.toContain('Your Heading Goes Here');
  });

  it('puts the body where the template\'s body was', () => {
    const result = applyTemplateFrame(page, template);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Slim Contact Bar',
      'Hero',
      'Feature Cards',
      'Programs',
      'Big Footer'
    ]);
  });

  it('replaces the old frame and reports what left', () => {
    const result = applyTemplateFrame(page, template);
    expect(result.frameAdded).toBe(2);
    expect(result.frameRemoved).toBe(3);
    expect(result.frameRemovedNames).toEqual(['Contact Strip', 'Menu Banner', 'Footer']);
  });

  it('a frame section the new template also has is NOT reported as removed', () => {
    const shared = [frame('contact', 'Contact Strip'), body('x', 'X')];
    const result = applyTemplateFrame(page, shared);
    expect(result.frameRemovedNames).toEqual(['Menu Banner', 'Footer']);
  });

  it('a template with no frame at all leaves the body alone — the built-in stub case', () => {
    const result = applyTemplateFrame(page, []);
    expect(result.sections.map((s) => s.title)).toEqual(['Hero', 'Feature Cards', 'Programs']);
    expect(result.keptBody).toBe(3);
    expect(result.frameAdded).toBe(0);
  });

  it('an all-frame template puts the body last', () => {
    const allFrame = [frame('a', 'Top Bar'), frame('b', 'Nav')];
    const result = applyTemplateFrame(page, allFrame);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Top Bar',
      'Nav',
      'Hero',
      'Feature Cards',
      'Programs'
    ]);
  });

  it('keeps frame that comes after the body position, after the body', () => {
    const interleaved = [
      frame('top', 'Top'),
      body('mid', 'mid'),
      frame('a', 'After A'),
      frame('b', 'After B')
    ];
    const result = applyTemplateFrame(page, interleaved);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Top',
      'Hero',
      'Feature Cards',
      'Programs',
      'After A',
      'After B'
    ]);
  });

  it('an empty page gains just the frame', () => {
    const result = applyTemplateFrame([], template);
    expect(result.sections.map((s) => s.title)).toEqual(['Slim Contact Bar', 'Big Footer']);
    expect(result.keptBody).toBe(0);
  });

  it('a page of nothing but body survives a frameless template unchanged', () => {
    const onlyBody = [body('a', 'A'), body('b', 'B')];
    expect(applyTemplateFrame(onlyBody, []).sections).toEqual(onlyBody);
  });

  it('NEVER drops a body section, for any template shape', () => {
    // The one invariant. Property-style sweep over the shapes that exist.
    const shapes: FrameSection[][] = [
      [],
      [frame('a', 'A')],
      [body('x', 'X')],
      [frame('a', 'A'), body('x', 'X')],
      [body('x', 'X'), frame('a', 'A')],
      [frame('a', 'A'), body('x', 'X'), frame('b', 'B')],
      [frame('a', 'A'), frame('b', 'B'), body('x', 'X'), body('y', 'Y')]
    ];
    for (const shape of shapes) {
      const result = applyTemplateFrame(page, shape);
      const kept = result.sections.filter((s) => !isFrameSection(s)).map((s) => s.id);
      expect(kept).toEqual(['hero', 'cards', 'programs']);
    }
  });
});

describe('what the operator is told before anything is written', () => {
  it('leads with what is KEPT, because that is the fear this control earned', () => {
    const result = applyTemplateFrame(
      [frame('c', 'Contact'), body('a', 'A'), body('b', 'B')],
      [frame('c2', 'New Contact'), body('p', 'placeholder')]
    );
    const message = describeTemplateFrameChange('Club Inner', result);
    const keptLine = message.split('\n').find((line) => line.includes('kept'));
    expect(keptLine).toBeTruthy();
    expect(keptLine).toContain('2 content sections are kept');
    expect(message.indexOf('kept')).toBeLessThan(message.indexOf('removed'));
  });

  it('names the shared sections that will go, and says they are recoverable', () => {
    const result = applyTemplateFrame(
      [frame('c', 'Contact Strip'), body('a', 'A')],
      [body('p', 'p')]
    );
    const message = describeTemplateFrameChange('Plain', result);
    expect(message).toContain('Contact Strip');
    expect(message).toContain('add them back');
  });

  it('says plainly when only the tag changes', () => {
    const result = applyTemplateFrame([body('a', 'A')], []);
    expect(describeTemplateFrameChange('Stub', result)).toContain('only the page tag changes');
  });

  it('uses singular wording for one section', () => {
    const result = applyTemplateFrame([body('a', 'A')], [frame('f', 'F'), body('p', 'p')]);
    const message = describeTemplateFrameChange('One', result);
    expect(message).toContain('Your 1 content section is kept');
    expect(message).toContain('brings 1 shared section');
  });
});
