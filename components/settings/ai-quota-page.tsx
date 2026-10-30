import React, { useCallback, useEffect, useRef, useState } from 'react';
import BilledSection, { useBilled } from './ai-billed-section';

/**
 * Settings › AI Quota — the one home for what AI costs (task 86bcvj7k9).
 *
 * A React island inside the frozen vanilla shell, mounted into
 * #aiQuotaReactRoot by react-entry.js. It took over the Observe spend panel;
 * Observe keeps a one-line summary that links here.
 *
 * WHY IT EXISTS: on Oct 28-30, 2026 the Mac Mini's AI browser spent about $35
 * overnight and nothing in Starcaster showed it — the spend panel saw only the
 * website's calls, and had no price for the model doing the spending. So this
 * page leads with what its total does NOT count: an incomplete total says so
 * above the number, and "Everything that uses AI" names every job, including
 * the ones no meter can see yet.
 */

const QUOTA_PATH = '/api/observe/ai-quota';
const WINDOW_DAYS = 30;

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

type FeatureRow = {
  feature: string;
  calls: number;
  tokens: number;
  costUsd: number;
  fullyPriced: boolean;
  models: Record<string, number>;
};

type ModelRow = {
  provider: string;
  model: string;
  calls: number;
  tokens: number;
  costUsd: number;
  fullyPriced: boolean;
};

type UnpricedRow = { provider: string; model: string; calls: number; tokens: number; reason: string };

type RecentTotal = { costUsd: number; calls: number; unpricedCalls: number; covered: boolean };

type UsageWindow = { calls: number; costUsd: number; unpricedCalls: number };

/** A Mini job's OpenClaw calls, from the meter rows (AI Quota 3/5). */
export type JobUsage = {
  calls: number;
  failedCalls: number;
  unpricedCalls: number;
  costUsd: number;
  last24h: UsageWindow;
  last7d: UsageWindow;
};

export type AiJob = {
  id: string;
  name: string;
  machine: string;
  runner: string;
  cadence: string;
  model: string;
  metered: boolean;
  meterNote: string;
  usage?: JobUsage | null;
};

export type AiQuota = {
  since: string;
  totalUsd: number;
  totalTokens: number;
  pricedCalls: number;
  unpricedCalls: number;
  complete: boolean;
  truncated: boolean;
  byFeature: FeatureRow[];
  byModel: ModelRow[];
  unpriced: UnpricedRow[];
  recent: { last24h: RecentTotal; last7d: RecentTotal };
  jobs: AiJob[];
  ratesChecked: string;
};

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: any }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

/** Cents matter here — never round a spend figure up to whole dollars. */
export function money(value: number): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function compactTokens(value: number): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** A cost that is missing some calls says so in the figure itself. */
function cost(value: number, fullyPriced: boolean): string {
  return fullyPriced ? money(value) : `${money(value)} + unpriced`;
}

/**
 * A window's cost. Calls OpenClaw sent no token counts for are counted but
 * cannot be priced, so they read "cost unknown" — never as $0.
 */
export function windowCost(w: UsageWindow): string {
  if (w.calls > 0 && w.unpricedCalls === w.calls) return 'cost unknown';
  // One sign-in check costs a fraction of a cent; "$0.00" would read as free.
  if (w.costUsd > 0 && w.costUsd < 0.005) return w.unpricedCalls === 0 ? 'under $0.01' : 'under $0.01 + unpriced';
  return cost(w.costUsd, w.unpricedCalls === 0);
}

/** The meter column for one job: its calls and cost, or why there are none. */
export function MeterCell({ job }: { job: AiJob }): React.ReactElement {
  const usage = job.usage;
  if (!usage) return <>{job.meterNote}</>;
  return (
    <>
      <div>
        {usage.last24h.calls} today · {usage.last7d.calls} this week
      </div>
      <div className="muted">
        {windowCost(usage.last7d)} this week
        {usage.failedCalls > 0 && ` · ${usage.failedCalls} failed in ${WINDOW_DAYS} days`}
      </div>
    </>
  );
}

function TotalTile({ label, total }: { label: string; total: RecentTotal }) {
  return (
    <div className="ai-quota-tile">
      <div className="ai-quota-tile-value">
        {total.covered ? cost(total.costUsd, total.unpricedCalls === 0) : 'not read'}
      </div>
      <div className="ai-quota-tile-label">
        {label} · {total.calls} call{total.calls === 1 ? '' : 's'}
      </div>
    </div>
  );
}

export function AiQuotaView({ data }: { data: AiQuota }): React.ReactElement {
  const allCalls = data.pricedCalls + data.unpricedCalls;
  const last30: RecentTotal = {
    costUsd: data.totalUsd, calls: allCalls, unpricedCalls: data.unpricedCalls, covered: true,
  };
  const websiteJobs = data.jobs.filter((job) => job.id.startsWith('website:'));
  const unseen = data.jobs.filter((job) => !job.metered && job.meterNote === 'not metered yet');

  return (
    <div className="ai-quota">
      {!data.complete && (
        <div className="ai-quota-alert" role="alert">
          <strong>These totals are incomplete.</strong> {data.unpricedCalls} of {allCalls} calls
          could not be priced, so real spend is <em>higher</em> than the figures below.
          <ul>
            {data.unpriced.map((row) => (
              <li key={`${row.provider}:${row.model}`}>
                <strong>{row.provider}</strong> / {row.model} — {row.calls} call{row.calls === 1 ? '' : 's'},{' '}
                {compactTokens(row.tokens)} tokens. {row.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.truncated && (
        <p className="ai-quota-warn">
          Row limit reached — the last {WINDOW_DAYS} days hold more calls than were read, so the
          30-day figure is a floor, not a total.
        </p>
      )}

      <div className="ai-quota-tiles">
        <TotalTile label="Today (last 24 hours)" total={data.recent.last24h} />
        <TotalTile label="Last 7 days" total={data.recent.last7d} />
        <TotalTile label={`Last ${WINDOW_DAYS} days`} total={last30} />
      </div>

      {unseen.length > 0 && (
        <p className="ai-quota-note">
          Website calls only. {unseen.length} job{unseen.length === 1 ? '' : 's'} on the Mac Mini also
          use AI and are <strong>not in these totals</strong> — see “Everything that uses AI” below.
        </p>
      )}

      <h3>By feature</h3>
      {data.byFeature.length === 0 ? (
        <p className="ai-quota-empty">
          The website made no AI calls in the last {WINDOW_DAYS} days. Metering started when the
          token logger shipped — spend before that was never recorded.
        </p>
      ) : (
        <div className="table-wrap"><table className="ai-quota-table">
          <thead>
            <tr><th>Feature</th><th>Model</th><th className="num">Calls</th><th className="num">Tokens</th><th className="num">Cost</th></tr>
          </thead>
          <tbody>
            {data.byFeature.map((row) => (
              <tr key={row.feature}>
                <td>{row.feature}</td>
                <td className="muted">{Object.keys(row.models).join(', ')}</td>
                <td className="num">{row.calls}</td>
                <td className="num">{compactTokens(row.tokens)}</td>
                <td className="num">{cost(row.costUsd, row.fullyPriced)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <h3>By model</h3>
      {data.byModel.length === 0 ? (
        <p className="ai-quota-empty">No model was called — by the website or through OpenClaw — in the last {WINDOW_DAYS} days.</p>
      ) : (
        <div className="table-wrap"><table className="ai-quota-table">
          <thead>
            <tr><th>Model</th><th>Provider</th><th className="num">Calls</th><th className="num">Tokens</th><th className="num">Cost</th></tr>
          </thead>
          <tbody>
            {data.byModel.map((row) => (
              <tr key={`${row.provider}:${row.model}`}>
                <td>{row.model}</td>
                <td className="muted">{row.provider}</td>
                <td className="num">{row.calls}</td>
                <td className="num">{compactTokens(row.tokens)}</td>
                <td className="num">{row.fullyPriced ? money(row.costUsd) : 'incomplete — no price'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <h3>Everything that uses AI</h3>
      <div className="table-wrap"><table className="ai-quota-table">
        <thead>
          <tr><th>Job</th><th>Runs on</th><th>How often</th><th>Model</th><th>Starcaster’s meter</th></tr>
        </thead>
        <tbody>
          {data.jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.name}</td>
              <td>{job.machine}<div className="muted">{job.runner}</div></td>
              <td>{job.cadence}</td>
              <td className="muted">{job.model}</td>
              <td className={job.metered ? 'ai-quota-metered' : 'ai-quota-unmetered'}><MeterCell job={job} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {websiteJobs.length === 0 && (
        <p className="ai-quota-empty">
          No website features are listed because none called a model in the last {WINDOW_DAYS} days —
          each appears here the first time it runs.
        </p>
      )}

      <p className="ai-quota-footer">
        Estimated from list prices in <code>lib/aiPricing.js</code> (Anthropic rates checked{' '}
        {data.ratesChecked}). Cached tokens are charged at the higher cache-write rate because the meter
        records only their sum, so this estimate errs high rather than low. It does not include Claude
        Code, Claude.ai subscriptions, or anything billed outside the direct API — the provider’s
        invoice is the authoritative number.
      </p>
    </div>
  );
}

/**
 * Run `load` each time the screen holding `hostRef` is shown — not once at app
 * start, when the visitor may not be signed in yet and nobody is looking.
 * Same shape as the Footage panel's show-hook.
 */
export function useLoadWhenShown(hostRef: React.RefObject<HTMLElement | null>, load: () => void) {
  useEffect(() => {
    const page = hostRef.current?.closest('.app-page');
    const visible = () => !page || !page.classList.contains('hidden');
    if (visible()) load();
    if (!page || typeof MutationObserver === 'undefined') return undefined;
    let wasVisible = visible();
    const observer = new MutationObserver(() => {
      const now = visible();
      if (now && !wasVisible) load();
      wasVisible = now;
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [hostRef, load]);
}

export default function AiQuotaPage(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<AiQuota | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const api = getAppApi();
    if (!api) {
      setError('Admin app not ready.');
      return;
    }
    setError('');
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    api(`${QUOTA_PATH}?since=${encodeURIComponent(since)}`)
      .then((res) => {
        if (res && res.ok === false) setError(String(res?.error?.message || 'Could not load AI spend.'));
        else setData((res?.data || res) as AiQuota);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load AI spend.'));
  }, []);

  // Anthropic's bill loads on its own, so a slow read there never holds up
  // the meter's figures (AI Quota 2/5).
  const [billed, loadBilled] = useBilled();
  const loadAll = useCallback(() => {
    load();
    loadBilled();
  }, [load, loadBilled]);

  useLoadWhenShown(hostRef, loadAll);

  let body: React.ReactElement;
  if (error) {
    body = (
      <div className="ai-quota-alert" role="alert">
        <strong>AI spend could not be read.</strong> {error}
      </div>
    );
  } else if (!data) {
    body = <p className="ai-quota-empty">Loading AI spend…</p>;
  } else {
    body = <AiQuotaView data={data} />;
  }
  return (
    <div ref={hostRef}>
      <BilledSection data={billed} />
      {body}
    </div>
  );
}
