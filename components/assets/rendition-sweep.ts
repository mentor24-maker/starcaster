/**
 * Walking a library of images through a slow endpoint, a few at a time.
 *
 * Deliberately separate from the React panel and free of any DOM or transport:
 * the part worth getting right is the walk — that no image is skipped, that one
 * bad batch does not abandon the rest, and that a stop request is honoured
 * between batches rather than mid-upload. That is all testable as plain logic.
 *
 * Building copies takes several seconds per image and a serverless function is
 * killed long before a whole library is done, which is why this is a loop of
 * small requests instead of one call.
 */

export type SweepBatchResult = {
  id: number;
  ok: boolean;
  error?: string;
  name?: string;
  originalBytes?: number;
  copyBytes?: number;
};

export type SweepProgress = {
  done: number;
  total: number;
  savedBytes: number;
  failures: SweepBatchResult[];
};

export type SweepOutcome = SweepProgress & { stopped: boolean };

export type SweepOptions = {
  pendingIds: number[];
  batchSize: number;
  /** Process one batch. Rejecting fails that batch only; the sweep continues. */
  generate: (ids: number[]) => Promise<SweepBatchResult[]>;
  onProgress?: (progress: SweepProgress) => void;
  /** Checked between batches, never mid-batch — stopping must not orphan uploads. */
  shouldStop?: () => boolean;
  /** Keeps the failure list from growing without bound on a bad run. */
  maxFailuresKept?: number;
};

const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_MAX_FAILURES_KEPT = 10;

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'That batch failed';
}

export async function runRenditionSweep(options: SweepOptions): Promise<SweepOutcome> {
  const queue = [...(options.pendingIds || [])];
  const total = queue.length;
  const batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE);
  const maxFailuresKept = Math.max(1, Number(options.maxFailuresKept) || DEFAULT_MAX_FAILURES_KEPT);

  let done = 0;
  let savedBytes = 0;
  let stopped = false;
  const failures: SweepBatchResult[] = [];

  while (queue.length) {
    if (options.shouldStop?.()) {
      stopped = true;
      break;
    }

    const batch = queue.splice(0, batchSize);
    let results: SweepBatchResult[];

    try {
      const raw = await options.generate(batch);
      results = Array.isArray(raw) ? raw : [];
      // An endpoint that answers without mentioning an image must not let that
      // image silently count as finished.
      const answered = new Set(results.map((item) => item.id));
      for (const id of batch) {
        if (!answered.has(id)) results.push({ id, ok: false, error: 'No answer for this image' });
      }
    } catch (err) {
      results = batch.map((id) => ({ id, ok: false, error: errorText(err) }));
    }

    for (const result of results) {
      if (result.ok) {
        done += 1;
        const original = Number(result.originalBytes) || 0;
        const copy = Number(result.copyBytes) || 0;
        // Copies of an already-lean original can weigh more; that is not a saving.
        if (original > copy) savedBytes += original - copy;
      } else if (failures.length < maxFailuresKept) {
        failures.push(result);
      }
    }

    options.onProgress?.({ done, total, savedBytes, failures: [...failures] });
  }

  return { done, total, savedBytes, failures, stopped };
}
