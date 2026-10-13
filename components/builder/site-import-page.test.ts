import { describe, expect, it } from 'vitest';
import { builtPageRows, importStatus, readEnvelopeList, readEnvelopeObject } from './site-import-page';

/**
 * Pins the envelope-reading behavior against the REAL server shape,
 * `sendOk(res, status, { jobs })` → `{ ok: true, data: { jobs: [...] } }`.
 * The original code treated unwrapEnvelope's return (the data OBJECT) as
 * the array itself; the first successful fetch then crashed the render
 * (`jobs.map is not a function`) and React unmounted the whole screen —
 * the blank-page incident of 2026-08-06.
 */
describe('site-import envelope readers', () => {
  const jobs = [{ id: 'simp_1' }, { id: 'simp_2' }];

  it('reads a list out of the standard envelope', () => {
    expect(readEnvelopeList({ ok: true, data: { jobs } }, 'jobs')).toEqual(jobs);
  });

  it('tolerates legacy top-level keys', () => {
    expect(readEnvelopeList({ ok: true, jobs }, 'jobs')).toEqual(jobs);
  });

  it('returns an empty list for anything unexpected — never a non-array', () => {
    expect(readEnvelopeList({ ok: true, data: {} }, 'jobs')).toEqual([]);
    expect(readEnvelopeList({ ok: true, data: { jobs: 'nope' } }, 'jobs')).toEqual([]);
    expect(readEnvelopeList({}, 'jobs')).toEqual([]);
    expect(readEnvelopeList({ ok: true, data: jobs as unknown as Record<string, unknown> }, 'jobs')).toEqual([]);
  });

  it('reads an object out of the standard envelope', () => {
    const job = { id: 'simp_1', status: 'queued' };
    expect(readEnvelopeObject({ ok: true, data: { job } }, 'job')).toEqual(job);
    expect(readEnvelopeObject({ ok: true, job }, 'job')).toEqual(job);
    expect(readEnvelopeObject({ ok: true, data: {} }, 'job')).toBeNull();
    expect(readEnvelopeObject({}, 'job')).toBeNull();
  });
});

/**
 * An import is two steps — copy the site, then build the Builder pages — and
 * the raw status only knows about the first. Showing it read "COMPLETE" over
 * an empty Pages list (Strands Movie job simp_1791736361987_b1etxy,
 * 2026-10-12). The word "complete" must never reach the badge.
 */
describe('importStatus — the two-step wording', () => {
  const builtMap = {
    at: '2026-10-09T18:00:00Z',
    pageIds: { '/': '101', '/about': '102', '/contact': '103' },
  };

  it('a finished copy with no pages built says so, not COMPLETE', () => {
    const s = importStatus({ status: 'complete', checkpoints: { capture: { at: 'x' } } });
    expect(s.label).toBe('Captured — pages not built yet');
    expect(s.tone).toBe('captured');
    expect(s.built).toBe(false);
    expect(s.label.toLowerCase()).not.toContain('complete');
  });

  it('a built import counts its pages and dates the build in Mountain time', () => {
    const s = importStatus({ status: 'complete', checkpoints: { map: builtMap } });
    expect(s).toEqual({ label: 'Built 3 draft pages on Oct 9', tone: 'built', built: true, pageCount: 3 });
  });

  it('dates by the Mountain-time day, not UTC', () => {
    // 03:00 UTC on Oct 10 is still the evening of Oct 9 in Denver.
    const s = importStatus({ status: 'complete', checkpoints: { map: { ...builtMap, at: '2026-10-10T03:00:00Z' } } });
    expect(s.label).toBe('Built 3 draft pages on Oct 9');
  });

  it('one page is singular, and a missing build time drops the date rather than inventing one', () => {
    const s = importStatus({ status: 'complete', checkpoints: { map: { pageIds: { '/': '1' } } } });
    expect(s.label).toBe('Built 1 draft page');
  });

  it('a failed capture still reads failed', () => {
    const s = importStatus({ status: 'failed', checkpoints: {} });
    expect(s).toMatchObject({ label: 'failed', tone: 'failed', built: false });
  });

  it('a running job still shows the stage in progress', () => {
    for (const status of ['queued', 'capturing', 'extracting', 'normalizing']) {
      expect(importStatus({ status, checkpoints: {} })).toMatchObject({ label: status, tone: 'running' });
    }
  });
});

describe('builtPageRows — naming the pages the build step wrote', () => {
  const pageIds = { '/about': '102', '/': '101' };

  it('pairs each source path with its Builder page, sorted by path', () => {
    const rows = builtPageRows(pageIds, [
      { id: 101, name: 'Home', slug: 'home' },
      { id: '102', name: 'About', slug: 'about' },
    ]);
    expect(rows).toEqual([
      { path: '/', pageId: '101', name: 'Home', slug: 'home', missing: false },
      { path: '/about', pageId: '102', name: 'About', slug: 'about', missing: false },
    ]);
  });

  it('marks a page missing only when the page list WAS read and lacks it', () => {
    expect(builtPageRows(pageIds, [{ id: '101', name: 'Home' }]).find((r) => r.path === '/about')?.missing).toBe(true);
    // An unread list (null) is "could not tell", never "deleted".
    expect(builtPageRows(pageIds, null).every((r) => !r.missing)).toBe(true);
  });
});
