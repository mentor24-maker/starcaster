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

/* ------------------------------------------------------------------ stage 4 */

import {
  isFrameReference,
  resolveFrameSection,
  resolveTemplateSections,
  toTemplateFrameReference,
  toTemplateReferences,
  type SavedSectionLike
} from './builder-template-frame';

const ids = () => {
  let n = 0;
  return () => `gen-${++n}`;
};

const master = (id: string, title: string, text: string): SavedSectionLike => ({
  id,
  name: title,
  section: { id: `m-${id}`, title, modules: [{ id: `mod-${id}`, type: 'text', text, settings: {} }] }
});

describe('templates store a reference, not a copy', () => {
  it('strips a frame section to what identifies it', () => {
    const ref = toTemplateFrameReference({
      id: 's1', title: 'Contact Strip', canonical: true, savedSectionId: 'ss1',
      modules: [{ id: 'm', type: 'text', text: 'SIX WEEKS OLD' }], background: { color: 'red' }
    });
    expect(ref).toEqual({ id: 's1', title: 'Contact Strip', canonical: true, savedSectionId: 'ss1' });
    expect(ref.modules).toBeUndefined();
  });

  it('leaves body sections completely alone — their position marks the slot', () => {
    const bodySection = { id: 'b', title: 'Hero', modules: [{ id: 'm', type: 'heading' }] };
    expect(toTemplateFrameReference(bodySection)).toEqual(bodySection);
  });

  it('converts a whole template in one pass', () => {
    const out = toTemplateReferences([
      frame('ss1', 'Header'), body('b', 'Body'), frame('ss2', 'Footer')
    ].map((s) => ({ ...s, modules: [{ id: 'x', type: 'text' }] })));
    expect(out[0].modules).toBeUndefined();
    expect(out[1].modules).toBeDefined();
    expect(out[2].modules).toBeUndefined();
  });

  it('recognises a pure reference, including the shape the server hands back', () => {
    expect(isFrameReference({ canonical: true, savedSectionId: 'ss1' })).toBe(true);
    // Writing a reference drops `modules`, but the server normalises sections
    // and returns `modules: []`. Verified against a real round trip; treating
    // that as a copy would leave an empty band when a master is deleted.
    expect(isFrameReference({ canonical: true, savedSectionId: 'ss1', modules: [] })).toBe(true);
    expect(isFrameReference({ canonical: true, savedSectionId: 'ss1', modules: [{ id: 'm' }] })).toBe(false);
  });

  it('a stored reference with a dead master is dropped, not rendered empty', () => {
    const stored = { id: 'i', canonical: true, savedSectionId: 'gone', title: 'Top Bar', modules: [] };
    expect(resolveFrameSection(stored, [master('ss1', 'Other', 'x')], ids())).toBeNull();
  });
});

describe('resolving a reference against the live master', () => {
  const masters = [master('ss1', 'Contact Strip', 'CURRENT CONTENT')];

  it('rebuilds from the master, so the applied frame is never stale', () => {
    const resolved = resolveFrameSection(
      { id: 'inst', canonical: true, savedSectionId: 'ss1' }, masters, ids()
    );
    expect(resolved?.title).toBe('Contact Strip');
    expect((resolved?.modules?.[0] as { text: string }).text).toBe('CURRENT CONTENT');
    expect(resolved?.canonical).toBe(true);
    expect(resolved?.savedSectionId).toBe('ss1');
  });

  it('keeps the master\'s module ids, which is how local drift is detected', () => {
    const resolved = resolveFrameSection(
      { id: 'inst', canonical: true, savedSectionId: 'ss1' }, masters, ids()
    );
    expect((resolved?.modules?.[0] as { id: string }).id).toBe('mod-ss1');
  });

  it('falls back to the stored copy — no migration needed for old templates', () => {
    const oldStyle = {
      id: 'inst', canonical: true, savedSectionId: 'gone',
      title: 'Old Copy', modules: [{ id: 'm', type: 'text', text: 'stored' }]
    };
    expect(resolveFrameSection(oldStyle, masters, ids())?.title).toBe('Old Copy');
  });

  it('drops a reference whose master was deleted, rather than leaving a blank band', () => {
    expect(resolveFrameSection({ id: 'i', canonical: true, savedSectionId: 'gone' }, masters, ids())).toBeNull();
  });

  it('passes body sections through untouched', () => {
    const b = body('b', 'Hero');
    expect(resolveFrameSection(b, masters, ids())).toEqual(b);
  });

  it('resolveTemplateSections drops dead references and keeps the rest in order', () => {
    const out = resolveTemplateSections(
      [
        { id: 'a', canonical: true, savedSectionId: 'ss1' },
        body('b', 'Hero'),
        { id: 'c', canonical: true, savedSectionId: 'gone' }
      ],
      masters,
      ids()
    );
    expect(out.map((s) => s.title)).toEqual(['Contact Strip', 'Hero']);
  });
});

describe('applying a reference-only template', () => {
  const masters = [master('ss1', 'Slim Contact Bar', 'FRESH')];

  it('stamps CURRENT master content, not whatever the template last saw', () => {
    const template = [
      { id: 't1', canonical: true, savedSectionId: 'ss1', title: 'STALE NAME' },
      body('tb', 'placeholder')
    ];
    const page = [body('h', 'Hero'), body('c', 'Cards')];
    const result = applyTemplateFrame(page, template, { savedSections: masters, makeId: ids() });

    expect(result.sections.map((s) => s.title)).toEqual(['Slim Contact Bar', 'Hero', 'Cards']);
    expect((result.sections[0].modules?.[0] as { text: string }).text).toBe('FRESH');
    expect(result.keptBody).toBe(2);
  });

  it('still keeps the body when a frame reference is dead', () => {
    const template = [{ id: 't1', canonical: true, savedSectionId: 'gone' }, body('tb', 'p')];
    const page = [body('h', 'Hero')];
    const result = applyTemplateFrame(page, template, { savedSections: masters, makeId: ids() });
    expect(result.sections.map((s) => s.title)).toEqual(['Hero']);
    expect(result.keptBody).toBe(1);
  });

  it('without savedSections it behaves exactly as before — stage 3 callers unaffected', () => {
    const template = [frame('ss1', 'Header'), body('tb', 'p')];
    const page = [body('h', 'Hero')];
    expect(applyTemplateFrame(page, template).sections.map((s) => s.title)).toEqual(['Header', 'Hero']);
  });
});
