import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Settings › APIs › AI keys — which AI key the website uses, which ACCOUNT each
 * one bills, and whether it works right now (ticket 86bcvhfht).
 *
 * A React island inside the frozen vanilla Settings screen, mounted into
 * #aiKeysReactRoot by react-entry.js (same pattern as the AI spend panel).
 *
 * WHY THE ACCOUNT COLUMN IS THE POINT. On 2026-10-30 Dane bought Anthropic
 * credit in one account while the website's key billed another, and the AI
 * features stayed down. A "works / does not work" light would not have helped;
 * what was missing was WHICH account to top up. So the account comes from the
 * provider's own reply (lib/aiKeys.js), never from a setting someone typed.
 *
 * Keys are never shown — a fingerprint tells two apart and reveals neither.
 */

const AI_KEYS_PATH = '/api/settings/ai-keys';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

export type AiKeyRow = {
  id: string;
  provider: string;
  place: string;
  job: string;
  source: string;
  fingerprint: string;
  verdict: 'WORKS' | 'OUT OF CREDIT' | 'INVALID' | 'CANNOT TELL' | 'NOT SET';
  reason: string;
  account: string;
  accountLabel: string;
};

type Reading = { checkedAt: string; keys: AiKeyRow[] };

const PROVIDER_LABEL: Record<string, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', gemini: 'Google Gemini' };

const VERDICT_COLOR: Record<string, string> = {
  WORKS: '#2e7d32',
  'OUT OF CREDIT': '#d32f2f',
  INVALID: '#d32f2f',
  'CANNOT TELL': '#b26a00',
  'NOT SET': 'var(--muted)',
};

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: any }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

/** Why the account cell is empty, in words — an empty cell reads as broken. */
export function accountText(row: AiKeyRow): string {
  if (row.accountLabel) return row.accountLabel;
  if (row.verdict === 'NOT SET') return '—';
  if (row.provider === 'gemini') return 'Google does not say which project a key bills';
  return `${PROVIDER_LABEL[row.provider] || row.provider} did not name the account in its reply`;
}

/** The table alone, pure, so a test can assert what Dane actually sees. */
export function AiKeysTable({ keys }: { keys: AiKeyRow[] }): React.ReactElement {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
          <th style={{ padding: '0.4rem 0.5rem 0.4rem 0' }}>Key</th>
          <th style={{ padding: '0.4rem 0.5rem 0.4rem 0' }}>Bills account</th>
          <th style={{ padding: '0.4rem 0' }}>Right now</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((row) => (
          <tr key={row.id} style={{ borderBottom: '1px solid var(--border)', verticalAlign: 'top' }} data-ai-key={row.id}>
            <td style={{ padding: '0.5rem 0.5rem 0.5rem 0', overflowWrap: 'anywhere' }}>
              <strong>{PROVIDER_LABEL[row.provider] || row.provider}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                {row.fingerprint ? `key ${row.fingerprint}` : 'no key'}
                {row.source ? ` · from ${row.source}` : ''}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Used by {row.job}</div>
            </td>
            <td style={{ padding: '0.5rem 0.5rem 0.5rem 0', overflowWrap: 'anywhere' }}>{accountText(row)}</td>
            <td style={{ padding: '0.5rem 0', overflowWrap: 'anywhere' }}>
              <strong style={{ color: VERDICT_COLOR[row.verdict] || 'inherit' }}>{row.verdict}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{row.reason}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AiKeysPanel(): React.ReactElement {
  const hostRef = useRef<HTMLElement | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const api = getAppApi();
    if (!api) {
      setError('Admin app not ready.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api(AI_KEYS_PATH);
      if (res && res.ok === false) {
        setError(String(res?.error?.message || 'Could not check the AI keys.'));
      } else {
        setReading((res?.data || res) as Reading);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the AI keys.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Check only when Settings › APIs is actually on screen. The vanilla shell
  // mounts every page at start-up (before sign-in) and toggles a class to show
  // one, so loading on mount answered "Not authenticated" — and, signed in,
  // would send paid probes on every admin page load anywhere. Same reveal
  // pattern as the Connections panel.
  useEffect(() => {
    const section = hostRef.current?.closest('.app-page');
    if (!section) return undefined;
    if (!section.classList.contains('hidden')) void load();
    let wasHidden = section.classList.contains('hidden');
    const observer = new MutationObserver(() => {
      const hidden = section.classList.contains('hidden');
      if (wasHidden && !hidden) void load();
      wasHidden = hidden;
    });
    observer.observe(section, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [load]);

  return (
    <section ref={hostRef} className="docs-panel" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>AI keys</h3>
        <button type="button" className="btn" onClick={() => { void load(); }} disabled={loading}>
          {loading ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0.4rem 0 0.75rem' }}>
        Each key the website uses, the account it bills, and whether that account will serve a request right now.
        Credit only helps if it is added to the account shown here.
      </p>

      {error && (
        <p style={{ color: '#d32f2f' }}>
          <strong>Could not check the AI keys.</strong> {error}
        </p>
      )}

      {!error && !reading && (
        <p style={{ color: 'var(--muted)' }}>{loading ? 'Checking each key with a one-word request…' : 'Not checked yet.'}</p>
      )}

      {reading && <AiKeysTable keys={reading.keys} />}

      <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
        The Mac Mini&apos;s OpenClaw key is not on this server. The Mini checks it, with these keys, every ten
        minutes (<code>npm run ai-keys</code>) and posts to the bus the moment one runs out of credit or is refused.
        {reading?.checkedAt ? ` Checked ${new Date(reading.checkedAt).toLocaleString()}.` : ''}
      </p>
    </section>
  );
}
