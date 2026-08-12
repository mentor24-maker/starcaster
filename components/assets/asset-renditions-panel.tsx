import React, { useCallback, useEffect, useRef, useState } from 'react';
import { runRenditionSweep, type SweepBatchResult } from './rendition-sweep';

/**
 * "Some images could be smaller" — the scaled-copies sweep, on the Images page.
 *
 * A React island inside the frozen vanilla admin screens, mounted into
 * #assetRenditionsRoot by react-entry.js.
 *
 * WHY IT WORKS IN BATCHES
 * Building copies takes several seconds per image; the first full library sweep
 * ran for about a quarter of an hour. A serverless function is killed long
 * before that, so one request cannot do the job. The browser asks what is
 * outstanding, then walks the list a few images at a time. That also makes the
 * progress real rather than a spinner in front of a request about to be cut off.
 *
 * The panel renders nothing at all when there is no work — an empty maintenance
 * banner on every visit is noise.
 */

const STATUS_PATH = '/api/assets/renditions/status';
const GENERATE_PATH = '/api/assets/renditions/generate';

type SweepStatus = {
  storageReady: boolean;
  totalImages: number;
  pendingCount: number;
  pendingBytes: number;
  doneCount: number;
  batchSize: number;
  pendingIds: number[];
};

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, unknown>>;

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: { api?: AppApi } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

/** Calls go through App.api() so they carry the session and the X-Project-ID header. */
async function apiCall(path: string, options?: RequestInit): Promise<Record<string, unknown>> {
  const api = getAppApi();
  if (!api) throw new Error('The admin app is still loading — try again in a moment.');
  return api(path, options);
}

function unwrap(body: Record<string, unknown>): Record<string, unknown> {
  const data = body?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : body;
}

function readableSize(bytes: number): string {
  const value = Number(bytes) || 0;
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} bytes`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function AssetRenditionsPanel(): React.ReactElement | null {
  const [status, setStatus] = useState<SweepStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failures, setFailures] = useState<SweepBatchResult[]>([]);
  const [savedBytes, setSavedBytes] = useState(0);
  const [finishedMessage, setFinishedMessage] = useState('');

  // Lets the Stop button end the loop between batches without tearing down a
  // request that is already generating files.
  const stopRequested = useRef(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const loadStatus = useCallback(async () => {
    try {
      const body = await apiCall(STATUS_PATH);
      if (!mounted.current) return;
      setStatus(unwrap(body) as unknown as SweepStatus);
      setLoadError('');
    } catch (err) {
      if (!mounted.current) return;
      // A project with no images, or a database without the feature installed,
      // should leave the page looking normal rather than showing an error bar.
      setLoadError(err instanceof Error ? err.message : 'Could not check the image library');
      setStatus(null);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const runSweep = useCallback(async () => {
    if (!status || running) return;

    stopRequested.current = false;
    setRunning(true);
    setDone(0);
    setFailures([]);
    setSavedBytes(0);
    setFinishedMessage('');

    const outcome = await runRenditionSweep({
      pendingIds: status.pendingIds,
      batchSize: status.batchSize,
      shouldStop: () => stopRequested.current,
      generate: async (ids) => {
        const body = await apiCall(GENERATE_PATH, {
          method: 'POST',
          body: JSON.stringify({ ids }),
        });
        const payload = unwrap(body);
        return Array.isArray(payload.results) ? (payload.results as SweepBatchResult[]) : [];
      },
      onProgress: (progress) => {
        if (!mounted.current) return;
        setDone(progress.done);
        setSavedBytes(progress.savedBytes);
        setFailures(progress.failures);
      },
    });

    if (!mounted.current) return;
    setRunning(false);
    setFinishedMessage(
      outcome.stopped
        ? `Stopped. ${outcome.done} ${plural(outcome.done, 'image', 'images')} done — the rest are still waiting.`
        : `Finished. ${outcome.done} ${plural(outcome.done, 'image is', 'images are')} now smaller.`
    );
    await loadStatus();
  }, [status, running, loadStatus]);

  if (loadError) return null;
  if (!status) return null;

  const nothingToDo = status.pendingCount === 0;
  if (nothingToDo && !finishedMessage) return null;

  const total = status.pendingIds.length || status.pendingCount;
  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <section className="asset-renditions-panel">
      {nothingToDo ? (
        <p className="asset-renditions-summary">
          {finishedMessage} Every image in this project already has smaller copies.
        </p>
      ) : (
        <>
          <div className="asset-renditions-headline">
            <div>
              <strong>
                {status.pendingCount} {plural(status.pendingCount, 'image', 'images')} could be smaller
              </strong>
              <span className="asset-renditions-detail">
                {' '}— {readableSize(status.pendingBytes)} of full-size originals. Making smaller copies
                means visitors download a picture sized for where it sits, instead of the original every time.
              </span>
            </div>
            <div className="asset-renditions-actions">
              {running ? (
                <button type="button" className="btn" onClick={() => { stopRequested.current = true; }}>
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { void runSweep(); }}
                  disabled={!status.storageReady}
                  title={status.storageReady ? undefined : 'File storage is not configured'}
                >
                  Make smaller copies
                </button>
              )}
            </div>
          </div>

          {running || done > 0 ? (
            <div className="asset-renditions-progress">
              <div className="asset-renditions-progress-track">
                <div className="asset-renditions-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <p className="asset-renditions-detail">
                {done} of {total} done
                {savedBytes > 0 ? ` — ${readableSize(savedBytes)} lighter so far` : ''}
                {running ? '. This takes a few seconds per image; you can leave it running.' : ''}
              </p>
            </div>
          ) : null}

          {!status.storageReady ? (
            <p className="asset-renditions-detail">
              File storage is not set up, so copies cannot be saved yet.
            </p>
          ) : null}
        </>
      )}

      {finishedMessage && !nothingToDo ? (
        <p className="asset-renditions-detail">{finishedMessage}</p>
      ) : null}

      {failures.length ? (
        <details className="asset-renditions-failures">
          <summary>{failures.length} {plural(failures.length, 'image', 'images')} could not be done</summary>
          <ul>
            {failures.map((failure) => (
              <li key={failure.id}>
                #{failure.id} {failure.name ? `${failure.name} — ` : ''}
                {failure.error || 'Unknown problem'}
              </li>
            ))}
          </ul>
          <p className="asset-renditions-detail">
            These stay in the list and are tried again next time. A picture that cannot be
            downloaded is usually one hosted on someone else&apos;s website.
          </p>
        </details>
      ) : null}
    </section>
  );
}

export default AssetRenditionsPanel;
