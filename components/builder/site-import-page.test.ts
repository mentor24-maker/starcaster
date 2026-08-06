import { describe, expect, it } from 'vitest';
import { readEnvelopeList, readEnvelopeObject } from './site-import-page';

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
