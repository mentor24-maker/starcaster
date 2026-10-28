import { describe, expect, it } from 'vitest';
import { createdMessage, defaultBoxWarning, importThemeRecordOf, introLine, readThemePreview } from './site-import-theme-panel';

/**
 * "Create theme from this import" (task 86bctakkk). The panel reads which
 * theme an import already made from two places — its own checkpoint, and a
 * full page build's — and the preview from the real server envelope.
 */
describe('importThemeRecordOf', () => {
  it('is null when no theme was ever made', () => {
    expect(importThemeRecordOf({})).toBeNull();
    expect(importThemeRecordOf(undefined)).toBeNull();
    expect(importThemeRecordOf({ map: { at: '2026-10-01', pageIds: {} } })).toBeNull();
  });

  it('reads a full build\'s theme, which always became the default', () => {
    expect(importThemeRecordOf({ map: { at: '2026-10-01', theme: { name: 'alphire 1', previousDefaultName: 'Default' } } })).toEqual({
      name: 'alphire 1',
      madeDefault: true,
      previousDefaultName: 'Default',
    });
  });

  it('prefers whichever was made last', () => {
    const checkpoints = {
      map: { at: '2026-10-01T00:00:00Z', theme: { name: 'alphire 1' } },
      theme: { at: '2026-10-27T00:00:00Z', name: 'alphire 2', madeDefault: false, previousDefaultName: '' },
    };
    expect(importThemeRecordOf(checkpoints)?.name).toBe('alphire 2');
    expect(importThemeRecordOf(checkpoints)?.madeDefault).toBe(false);
    checkpoints.map.at = '2026-10-28T00:00:00Z';
    expect(importThemeRecordOf(checkpoints)?.name).toBe('alphire 1');
  });
});

describe('readThemePreview', () => {
  it('reads the server envelope `{ ok, data: { name, theme, notes, previousDefault } }`', () => {
    const body = {
      ok: true,
      data: { name: 'alphire 1', theme: { palette: { surface: '#000000' } }, notes: ['fonts: …'], previousDefault: { name: 'Default' } },
    };
    expect(readThemePreview(body)).toEqual({
      name: 'alphire 1',
      notes: ['fonts: …'],
      palette: { surface: '#000000' },
      previousDefaultName: 'Default',
      pagesRestyledByDefault: null,
    });
  });

  it('reads the count of pages the default box would restyle, and keeps "could not count" apart from 0', () => {
    const base = { name: 'alphire 1', theme: {}, notes: [] };
    expect(readThemePreview({ ok: true, data: { ...base, pagesRestyledByDefault: 17 } })?.pagesRestyledByDefault).toBe(17);
    expect(readThemePreview({ ok: true, data: { ...base, pagesRestyledByDefault: 0 } })?.pagesRestyledByDefault).toBe(0);
    expect(readThemePreview({ ok: true, data: { ...base, pagesRestyledByDefault: null } })?.pagesRestyledByDefault).toBeNull();
  });

  it('is null for an answer with no theme name', () => {
    expect(readThemePreview({ ok: true, data: {} })).toBeNull();
  });
});

/*
 * Review round 1: making the theme the default restyles the live site at once
 * with no page row touched, so the screen must never pair a ticked box with
 * "No page is changed".
 */
describe('the default box tells the truth', () => {
  it('names the live-site pages it restyles, with the count', () => {
    expect(defaultBoxWarning(17)).toBe('Making it the default changes how 17 published pages look on the live site right away.');
    expect(defaultBoxWarning(1)).toBe('Making it the default changes how 1 published page looks on the live site right away.');
    expect(defaultBoxWarning(0)).toMatch(/changes nothing on the live site/);
  });

  it('still warns when the pages could not be counted, rather than reading as none', () => {
    expect(defaultBoxWarning(null)).toMatch(/every published page without a theme of its own .* live site right away/);
    expect(defaultBoxWarning(null)).not.toMatch(/changes nothing/);
  });

  it('says "No page is changed" only while the box is unticked', () => {
    expect(introLine(false)).toMatch(/No page is changed\./);
    expect(introLine(true)).not.toMatch(/No page is changed/);
    expect(introLine(true)).toMatch(/makes it the default/);
  });

  it('after creating, says the live site changed when it was made the default', () => {
    const made = createdMessage('alphire 1', true, 'To undo: …');
    expect(made).not.toMatch(/No page was changed/);
    expect(made).toMatch(/the live site now uses this theme's colours and fonts/);
    expect(createdMessage('alphire 1', false, '')).toBe('Theme “alphire 1” created. No page was changed.');
  });
});
