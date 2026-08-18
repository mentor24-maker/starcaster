import React, { useCallback, useEffect, useState } from 'react';

/**
 * Observe › AI spend — what the model calls have cost, by feature.
 *
 * A React island inside the frozen vanilla Observe screen, mounted into
 * #aiSpendReactRoot by react-entry.js (same pattern as the Invitations panel).
 *
 * WHY THE COMPLETENESS BANNER IS THE FIRST THING RENDERED
 * The operator uses this number to decide whether an AI feature is safe to
 * leave running, on a card that also buys his groceries. A dollar figure that
 * quietly excludes an unpriced provider would read as "this is what you spent"
 * when it is really "this is part of what you spent" — so when anything in the
 * window could not be priced, that is stated above the total, not below it.
 * lib/aiPricing.js refuses to price an unknown model rather than calling it $0;
 * this panel is the other half of that contract.
 */

const SPEND_PATH = '/api/observe/ai-spend';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

type FeatureRow = {
  feature: string;
  calls: number;
  tokens: number;
  costUsd: number;
  fullyPriced: boolean;
  models: Record<string, number>;
};

type UnpricedRow = {
  provider: string;
  model: string;
  calls: number;
  tokens: number;
  reason: string;
};

type Spend = {
  since: string;
  totalUsd: number;
  totalTokens: number;
  pricedCalls: number;
  unpricedCalls: number;
  complete: boolean;
  byFeature: FeatureRow[];
  byDay: { day: string; calls: number; tokens: number; costUsd: number }[];
  unpriced: UnpricedRow[];
  truncated: boolean;
};

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: any }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

/** Cents matter here — never round a spend figure up to whole dollars. */
function money(value: number): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function compactTokens(value: number): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function AiSpendPanel(): React.ReactElement {
  const [spend, setSpend] = useState<Spend | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = useCallback(async (windowDays: number) => {
    const api = getAppApi();
    if (!api) {
      setError('Admin app not ready.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const res = await api(`${SPEND_PATH}?since=${encodeURIComponent(since)}`);
      if (res && res.ok === false) {
        setError(String(res?.error?.message || 'Could not load AI spend.'));
      } else {
        setSpend((res?.data || res) as Spend);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load AI spend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(days); }, [load, days]);

  if (loading && !spend) {
    return <p style={{ color: 'var(--muted)', padding: '1rem' }}>Loading AI spend…</p>;
  }

  if (error) {
    return (
      <div style={{ padding: '1rem', color: '#d32f2f' }}>
        <strong>AI spend unavailable.</strong> {error}
      </div>
    );
  }

  const rows = spend?.byFeature || [];
  const hasNoData = !rows.length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>AI spend</h3>
        <span>
          <label htmlFor="aiSpendWindow" style={{ fontSize: '0.85rem', color: 'var(--muted)', marginRight: 6 }}>Window</label>
          <select
            id="aiSpendWindow"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ width: 'auto', display: 'inline-block', margin: 0 }}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </span>
      </div>

      {spend && !spend.complete && (
        <div
          style={{
            border: '1px solid #d32f2f', borderRadius: 'var(--radius-input)',
            padding: '0.6rem 0.8rem', marginBottom: '0.9rem', background: 'var(--bg-alt)',
          }}
        >
          <strong style={{ color: '#d32f2f' }}>This total is incomplete.</strong>{' '}
          {spend.unpricedCalls} of {spend.pricedCalls + spend.unpricedCalls} calls could not be
          priced, so real spend is <em>higher</em> than the figure below.
          <ul style={{ margin: '0.5rem 0 0 1rem' }}>
            {spend.unpriced.map((row) => (
              <li key={`${row.provider}:${row.model}`} style={{ fontSize: '0.85rem' }}>
                <strong>{row.provider}</strong> / {row.model} — {row.calls} call{row.calls === 1 ? '' : 's'},{' '}
                {compactTokens(row.tokens)} tokens. {row.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {spend?.truncated && (
        <p style={{ fontSize: '0.85rem', color: '#d32f2f' }}>
          Row limit reached — this window holds more calls than were read, so the total is a floor, not a total.
        </p>
      )}

      <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{money(spend?.totalUsd || 0)}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
            {spend?.complete ? 'estimated spend' : 'priced portion only'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{compactTokens(spend?.totalTokens || 0)}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>tokens</div>
        </div>
        <div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>{(spend?.pricedCalls || 0) + (spend?.unpricedCalls || 0)}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>model calls</div>
        </div>
      </div>

      {hasNoData ? (
        <p style={{ color: 'var(--muted)' }}>
          No AI calls recorded in this window. Metering started when the token logger shipped —
          spend before that was never recorded and cannot be backfilled.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '0.4rem 0' }}>Feature</th>
              <th style={{ padding: '0.4rem 0' }}>Model</th>
              <th style={{ padding: '0.4rem 0', textAlign: 'right' }}>Calls</th>
              <th style={{ padding: '0.4rem 0', textAlign: 'right' }}>Tokens</th>
              <th style={{ padding: '0.4rem 0', textAlign: 'right' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.feature} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.4rem 0' }}>{row.feature}</td>
                <td style={{ padding: '0.4rem 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  {Object.keys(row.models).join(', ')}
                </td>
                <td style={{ padding: '0.4rem 0', textAlign: 'right' }}>{row.calls}</td>
                <td style={{ padding: '0.4rem 0', textAlign: 'right' }}>{compactTokens(row.tokens)}</td>
                <td style={{ padding: '0.4rem 0', textAlign: 'right' }}>
                  {row.fullyPriced ? money(row.costUsd) : `${money(row.costUsd)} +?`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.9rem' }}>
        Estimated from list prices in <code>lib/aiPricing.js</code> (Anthropic rates checked 2026-08-17).
        Cached tokens are charged at the higher cache-write rate because the meter records only their
        sum, so this estimate errs high rather than low. It does not include Claude Code, Claude.ai
        subscriptions, or anything billed outside the direct API — check the provider invoice for the
        authoritative number.
      </p>
    </div>
  );
}
