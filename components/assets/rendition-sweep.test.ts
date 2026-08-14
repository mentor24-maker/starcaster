import { describe, expect, it, vi } from 'vitest';
import { runRenditionSweep, type SweepBatchResult } from './rendition-sweep';

const okResult = (id: number, originalBytes = 1000, copyBytes = 250): SweepBatchResult => ({
  id,
  ok: true,
  originalBytes,
  copyBytes
});

describe('rendition sweep', () => {
  it('sends every pending image, in order, and never over-fills a batch', async () => {
    const sent: number[][] = [];
    const outcome = await runRenditionSweep({
      pendingIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      batchSize: 4,
      generate: async (ids) => {
        sent.push(ids);
        return ids.map((id) => okResult(id));
      }
    });

    expect(sent).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
    expect(outcome.done).toBe(9);
    expect(outcome.total).toBe(9);
    expect(outcome.stopped).toBe(false);
  });

  it('keeps going after a batch throws, so one blip does not abandon the library', async () => {
    const outcome = await runRenditionSweep({
      pendingIds: [1, 2, 3, 4],
      batchSize: 2,
      generate: async (ids) => {
        if (ids.includes(1)) throw new Error('network blip');
        return ids.map((id) => okResult(id));
      }
    });

    expect(outcome.done).toBe(2);
    expect(outcome.failures).toHaveLength(2);
    expect(outcome.failures[0].error).toBe('network blip');
  });

  it('counts an image the endpoint never mentioned as failed, not as done', async () => {
    const outcome = await runRenditionSweep({
      pendingIds: [1, 2],
      batchSize: 2,
      generate: async () => [okResult(1)]
    });

    expect(outcome.done).toBe(1);
    expect(outcome.failures).toEqual([{ id: 2, ok: false, error: 'No answer for this image' }]);
  });

  it('stops between batches when asked, leaving the rest for next time', async () => {
    const sent: number[][] = [];
    let batches = 0;
    const outcome = await runRenditionSweep({
      pendingIds: [1, 2, 3, 4, 5, 6],
      batchSize: 2,
      shouldStop: () => batches >= 2,
      generate: async (ids) => {
        batches += 1;
        sent.push(ids);
        return ids.map((id) => okResult(id));
      }
    });

    expect(sent).toEqual([[1, 2], [3, 4]]);
    expect(outcome.stopped).toBe(true);
    expect(outcome.done).toBe(4);
  });

  it('never starts at all if stopping is requested up front', async () => {
    const generate = vi.fn();
    const outcome = await runRenditionSweep({
      pendingIds: [1, 2],
      batchSize: 2,
      shouldStop: () => true,
      generate
    });

    expect(generate).not.toHaveBeenCalled();
    expect(outcome.stopped).toBe(true);
    expect(outcome.done).toBe(0);
  });

  it('adds up only genuine savings', async () => {
    const outcome = await runRenditionSweep({
      pendingIds: [1, 2, 3],
      batchSize: 3,
      generate: async () => [
        okResult(1, 2_000_000, 500_000),
        // An already-lean original whose copies weigh more is not a saving.
        okResult(2, 100, 900),
        okResult(3, 1_000, 400)
      ]
    });

    expect(outcome.savedBytes).toBe(1_500_600);
  });

  it('reports progress after each batch so a bar can move', async () => {
    const seen: number[] = [];
    await runRenditionSweep({
      pendingIds: [1, 2, 3, 4, 5],
      batchSize: 2,
      generate: async (ids) => ids.map((id) => okResult(id)),
      onProgress: (progress) => seen.push(progress.done)
    });

    expect(seen).toEqual([2, 4, 5]);
  });

  it('caps how many failures it holds on to', async () => {
    const outcome = await runRenditionSweep({
      pendingIds: Array.from({ length: 20 }, (_, i) => i + 1),
      batchSize: 5,
      maxFailuresKept: 3,
      generate: async (ids) => ids.map((id) => ({ id, ok: false, error: 'nope' }))
    });

    expect(outcome.failures).toHaveLength(3);
    expect(outcome.done).toBe(0);
  });

  it('handles an empty queue without calling anything', async () => {
    const generate = vi.fn();
    const outcome = await runRenditionSweep({ pendingIds: [], batchSize: 4, generate });

    expect(generate).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ done: 0, total: 0, savedBytes: 0, stopped: false });
  });

  it('falls back to a sane batch size rather than looping one at a time forever', async () => {
    const sent: number[][] = [];
    await runRenditionSweep({
      pendingIds: [1, 2, 3, 4, 5],
      batchSize: 0,
      generate: async (ids) => {
        sent.push(ids);
        return ids.map((id) => okResult(id));
      }
    });

    expect(sent[0]).toHaveLength(4);
  });
});
