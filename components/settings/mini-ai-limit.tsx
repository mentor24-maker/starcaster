import React, { useCallback, useEffect, useState } from 'react';

/**
 * The Mini's daily limit on background AI (AI Quota 5/5, task 86bcvj7zw):
 * today's reading, shown on Settings › AI Quota under the limit's own field and
 * — only once the limit has stopped something — at the top of Engage ›
 * Outreach, where Dane looks when a check comes back empty.
 *
 * The reading comes from GET /api/ai-quota/mini-limit (lib/miniAiLimit.js),
 * which counts the same per-request rows the AI Quota page totals. A reading
 * that could not be taken says so; it is never drawn as "0 used".
 */

export const MINI_LIMIT_PATH = '/api/ai-quota/mini-limit';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

export type MiniLimit =
  | { status: 'error'; message: string }
  | {
    status: 'ok';
    day: string;
    limit: number;
    used: number;
    reached: boolean;
    reachedAt: string | null;
    resetsAt: string;
    sentence: string;
    limitSource?: string;
    byJob?: Record<string, number>;
  };

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: { api?: AppApi } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

/** Read today's limit; `reload` reads it again. */
export function useMiniLimit(): [MiniLimit | null, () => void] {
  const [reading, setReading] = useState<MiniLimit | null>(null);
  const reload = useCallback(() => {
    const api = getAppApi();
    if (!api) return setReading({ status: 'error', message: 'Admin app not ready.' });
    api(MINI_LIMIT_PATH)
      .then((res) => setReading((res?.data || res) as MiniLimit))
      .catch((err) => setReading({ status: 'error', message: err instanceof Error ? err.message : 'The read failed.' }));
  }, []);
  return [reading, reload];
}

function jobs(byJob: Record<string, number> | undefined): string {
  const rows = Object.entries(byJob || {}).sort((a, b) => b[1] - a[1]);
  return rows.map(([job, n]) => `${job.replace(/^starcaster:/, '')} ${n}`).join(', ');
}

/** Today's reading, for the AI Quota page. */
export function MiniLimitLine({ reading }: { reading: MiniLimit | null }): React.ReactElement {
  if (!reading) return <p className="ai-quota-empty">Reading today’s count of the Mini’s AI requests…</p>;
  if (reading.status === 'error') {
    return (
      <div className="ai-quota-alert" role="alert">
        <strong>Today’s count of the Mini’s AI requests could not be read.</strong> {reading.message} While it
        cannot be read, the Mini’s background jobs do not run.
      </div>
    );
  }
  if (reading.reached) {
    return (
      <div className="ai-quota-alert" role="alert">
        <strong>{reading.sentence}</strong>
        {reading.used ? ` Today so far: ${jobs(reading.byJob)}.` : ''}
      </div>
    );
  }
  return (
    <p className="ai-alarm-last">
      Today (Mountain time) the Mini has made <strong>{reading.used}</strong> of its {reading.limit} AI requests
      {reading.limitSource && reading.limitSource !== 'saved' ? ` (the ${reading.limitSource} limit)` : ''}.
      {reading.used ? ` By job: ${jobs(reading.byJob)}.` : ''}
    </p>
  );
}

/**
 * The Outreach screen's notice: drawn only when the limit has stopped the
 * Mini's checks, or when it cannot tell — never as a standing "all fine" line.
 * `version` changes each time the screen re-reads, so this re-reads with it.
 */
export function MiniLimitBanner({ version }: { version?: string }): React.ReactElement | null {
  const [reading, reload] = useMiniLimit();
  useEffect(() => { reload(); }, [reload, version]);
  if (!reading) return null;
  if (reading.status === 'error') {
    return (
      <p className="outreach-wizard-error" role="alert">
        {`The Mini’s AI limit could not be read, so its background checks are not running: ${reading.message}`}
      </p>
    );
  }
  if (!reading.reached) return null;
  return (
    <p className="outreach-wizard-error" role="alert">
      {`${reading.sentence} Change the limit on Settings › AI Quota.`}
    </p>
  );
}
