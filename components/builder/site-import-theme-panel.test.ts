import { describe, expect, it } from 'vitest';
import { importThemeRecordOf, readThemePreview } from './site-import-theme-panel';

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
    });
  });

  it('is null for an answer with no theme name', () => {
    expect(readThemePreview({ ok: true, data: {} })).toBeNull();
  });
});
