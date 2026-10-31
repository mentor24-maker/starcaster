import React, { useCallback, useState } from 'react';

/**
 * Settings › AI Quota, "What Anthropic actually billed" (AI Quota 2/5, task
 * 86bcvj7v0).
 *
 * Starcaster's meter only counts calls the website makes itself. On Oct 28-30,
 * 2026 the Mini spent about $35 the meter never saw. Anthropic's bill cannot
 * miss anything, so this section puts it beside the meter, and when the bill is
 * well above the meter it says so in one plain sentence — that sentence is the
 * reason the section exists.
 *
 * Never shows $0 for "could not tell": no key reads "Not connected", a failed
 * read says it failed and why.
 */

const BILLED_PATH = '/api/observe/ai-billed';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

export type BilledDay = { day: string; costUsd: number; finished: boolean };
export type BilledKey = {
  apiKeyId: string;
  name: string;
  tokens: number;
  estimatedUsd: number;
  unpricedModels: string[];
  models: Record<string, number>;
};
export type Comparison = {
  meterUsd: number;
  billedUsd: number;
  unseenUsd: number;
  alarm: boolean;
  meterCalls: number;
  meterUnpricedCalls: number;
  meterTruncated: boolean;
};

export type Billed =
  | { status: 'not-connected' }
  | { status: 'owner-only' }
  | { status: 'error'; message: string }
  | {
    status: 'ok';
    startingAt: string;
    finishedUntil: string;
    byDay: BilledDay[];
    byModel: { model: string; costUsd: number }[];
    totalUsd: number;
    finishedUsd: number;
    byKey: BilledKey[] | null;
    byKeyError: string;
    comparison: Comparison | null;
    comparisonError: string;
    readAt: string;
    cached: boolean;
  };

/** Cents matter — same rule as the rest of the page. */
function money(value: number): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function compactTokens(value: number): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The meter-versus-bill line, and the warning when the bill runs well ahead. */
function MeterVersusBill({ comparison, error }: { comparison: Comparison | null; error: string }) {
  if (!comparison) {
    return (
      <p className="ai-quota-warn">
        The bill was read, but Starcaster’s own meter could not be — so the two cannot be compared. {error}
      </p>
    );
  }
  return (
    <>
      <p className="ai-billed-compare">
        Finished days: Starcaster’s meter saw <strong>{money(comparison.meterUsd)}</strong>; Anthropic
        billed <strong>{money(comparison.billedUsd)}</strong>.
      </p>
      {comparison.alarm && (
        <div className="ai-quota-alert" role="alert">
          <strong>{money(comparison.unseenUsd)} was spent by something Starcaster cannot see.</strong>{' '}
          The bill is more than 20% above what the meter counted — look at “By API key” below to see
          which key spent it.
        </div>
      )}
      {comparison.meterTruncated && (
        <p className="ai-quota-warn">
          The meter held more calls than could be read, so its figure is a floor and the gap may be smaller.
        </p>
      )}
    </>
  );
}

/** One bar per day, anchored to the baseline. Today is lighter: its bill is still filling in. */
function DailyBars({ days }: { days: BilledDay[] }) {
  const max = Math.max(...days.map((d) => d.costUsd), 0);
  return (
    <figure className="ai-billed-chart" aria-label="Dollars billed by Anthropic each day">
      <div className="ai-billed-scale">{money(max)}</div>
      <div className="ai-billed-bars">
        {days.map((d) => (
          <div
            key={d.day}
            className="ai-billed-slot"
            title={`${shortDay(d.day)}: ${money(d.costUsd)}${d.finished ? '' : ' so far (today — still filling in)'}`}
          >
            <div
              className={`ai-billed-bar${d.finished ? '' : ' is-partial'}`}
              style={{ height: max > 0 ? `${Math.max(2, (d.costUsd / max) * 100)}%` : '2px' }}
            />
          </div>
        ))}
      </div>
      <figcaption className="ai-billed-axis">
        <span>{days.length ? shortDay(days[0].day) : ''}</span>
        <span>{days.length ? shortDay(days[days.length - 1].day) : ''}</span>
      </figcaption>
    </figure>
  );
}

export function BilledView({ data }: { data: Billed }): React.ReactElement {
  if (data.status === 'owner-only') {
    return (
      <p className="ai-quota-empty">
        Anthropic’s bill covers every project on the account, so only the platform owner can see it.
      </p>
    );
  }
  if (data.status === 'not-connected') {
    return (
      <div className="ai-billed-not-connected">
        <p><strong>Not connected.</strong> Starcaster has no Anthropic Admin key, so it cannot read the bill.</p>
        <p className="ai-quota-empty">
          To connect: in the Anthropic Console open Settings › Admin keys and create one, then give it to
          CC, which stores it in Doppler as <code>ANTHROPIC_ADMIN_KEY</code> without displaying it.
        </p>
      </div>
    );
  }
  if (data.status === 'error') {
    return (
      <div className="ai-quota-alert" role="alert">
        <strong>Anthropic’s bill could not be read.</strong> {data.message}
      </div>
    );
  }

  return (
    <div className="ai-billed">
      <MeterVersusBill comparison={data.comparison} error={data.comparisonError} />

      <div className="ai-quota-tiles">
        <div className="ai-quota-tile">
          <div className="ai-quota-tile-value">{money(data.totalUsd)}</div>
          <div className="ai-quota-tile-label">Billed, last {data.byDay.length} days (incl. today so far)</div>
        </div>
      </div>

      {data.byDay.length > 0 && <DailyBars days={data.byDay} />}

      <details className="ai-billed-days">
        <summary>Every day as a table</summary>
        <div className="table-wrap"><table className="ai-quota-table">
          <thead><tr><th>Day (UTC)</th><th className="num">Billed</th></tr></thead>
          <tbody>
            {[...data.byDay].reverse().map((d) => (
              <tr key={d.day}>
                <td>{shortDay(d.day)}{d.finished ? '' : <span className="muted"> — today, so far</span>}</td>
                <td className="num">{money(d.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </details>

      <h4>By model</h4>
      {data.byModel.length === 0 ? (
        <p className="ai-quota-empty">Anthropic billed nothing in these {data.byDay.length} days.</p>
      ) : (
        <div className="table-wrap"><table className="ai-quota-table">
          <thead><tr><th>Model</th><th className="num">Billed</th></tr></thead>
          <tbody>
            {data.byModel.map((row) => (
              <tr key={row.model}><td>{row.model}</td><td className="num">{money(row.costUsd)}</td></tr>
            ))}
          </tbody>
        </table></div>
      )}

      <h4>By API key</h4>
      {data.byKey === null ? (
        <p className="ai-quota-warn">The split by key could not be read. {data.byKeyError}</p>
      ) : data.byKey.length === 0 ? (
        <p className="ai-quota-empty">No key made a call in these {data.byDay.length} days.</p>
      ) : (
        <div className="table-wrap"><table className="ai-quota-table">
          <thead>
            <tr><th>Key</th><th>Models</th><th className="num">Tokens</th><th className="num">Estimated</th></tr>
          </thead>
          <tbody>
            {data.byKey.map((row) => (
              <tr key={row.apiKeyId || 'none'}>
                <td>{row.name || 'Unnamed key'}{row.apiKeyId && <div className="muted">{row.apiKeyId}</div>}</td>
                <td className="muted">{Object.keys(row.models).join(', ')}</td>
                <td className="num">{compactTokens(row.tokens)}</td>
                <td className="num">
                  {money(row.estimatedUsd)}{row.unpricedModels.length > 0 ? ' + unpriced' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <p className="ai-quota-footer">
        Daily and per-model figures are Anthropic’s own bill, read {data.cached ? 'from a reading under 15 minutes old' : 'just now'}.
        Anthropic reports tokens per key but not dollars, so the per-key column is priced at list rates — an
        estimate. The meter comparison uses finished UTC days only, since today’s bill is still filling in.
      </p>
    </div>
  );
}

/** Loads on its own, so a slow Anthropic read never holds up the rest of the page. */
export function useBilled(): [Billed | null, () => void] {
  const [data, setData] = useState<Billed | null>(null);
  const load = useCallback(() => {
    const app = (window as unknown as { App?: { api?: AppApi } }).App;
    if (typeof app?.api !== 'function') {
      setData({ status: 'error', message: 'Admin app not ready.' });
      return;
    }
    app.api(BILLED_PATH)
      .then((res) => {
        if (res && res.ok === false) setData({ status: 'error', message: String(res?.error?.message || 'The read failed.') });
        else setData((res?.data || res) as Billed);
      })
      .catch((err) => setData({ status: 'error', message: err instanceof Error ? err.message : 'The read failed.' }));
  }, []);
  return [data, load];
}

export default function BilledSection({ data }: { data: Billed | null }): React.ReactElement {
  return (
    <section className="ai-quota ai-billed-section">
      <h3>What Anthropic actually billed</h3>
      {data ? <BilledView data={data} /> : <p className="ai-quota-empty">Reading Anthropic’s bill…</p>}
    </section>
  );
}
