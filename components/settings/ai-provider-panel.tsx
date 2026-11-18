import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AI_KEYS_READING_EVENT, type AiKeyRow } from './ai-keys-panel';

/**
 * Settings › APIs › AI provider (AI switch 2, SC-844). Dane chose a Settings
 * screen on 2026-11-17: put the AI providers in order, switch any of them
 * off, and pick each one's models. The door in lib/aiClient.js reads the saved
 * row at most once a minute, so a change reaches the website and the Mac Mini
 * within about a minute with no redeploy.
 *
 * A React island inside the frozen vanilla Settings screen, mounted into
 * #aiProviderReactRoot by react-entry.js, right below the AI keys panel.
 *
 * NO KEY VALUE IS EVER TYPED INTO OR SHOWN HERE (docs/DOCTRINE.md §4.1). A
 * provider without a key names the SETTING to add, and an added service takes
 * the name of its key setting, never the key.
 *
 * The WORKS / OUT OF CREDIT reading beside each provider comes from the AI
 * keys panel's check (a paid one-token request per key), shared by event, so
 * this panel never sends probes of its own.
 */

const PATH = '/api/settings/ai-providers';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

export type ProviderRow = {
  id: string;
  label: string;
  enabled: boolean;
  fast: string;
  strong: string;
  defaultFast: string;
  defaultStrong: string;
  keyEnv: string;
  keySet: boolean;
  custom: boolean;
  baseUrl: string;
};

export type CustomProvider = { id?: string; label: string; baseUrl: string; keyEnv: string };

export type ScreenState = {
  status: string;
  source: 'settings' | 'AI_PROVIDER_ORDER' | 'default';
  fallbackReason: string;
  readError: string;
  updatedAt: string | null;
  customProviders: CustomProvider[];
  providers: ProviderRow[];
};

type Reading = { checkedAt: string; keys: AiKeyRow[] };

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: any }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

/** Move one row up (-1) or down (+1). Pure, so a test can pin it. */
export function moveRow<T>(rows: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= rows.length) return rows;
  const next = rows.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Which order the AI door is following right now, in words. */
export function sourceText(state: Pick<ScreenState, 'source' | 'fallbackReason'>): string {
  if (state.source === 'settings') return 'AI features follow the order saved on this screen.';
  const setting = state.source === 'AI_PROVIDER_ORDER'
    ? 'the AI_PROVIDER_ORDER setting'
    : 'the built-in order (Anthropic, then OpenAI, then Gemini)';
  return `AI features are following ${setting}, because ${state.fallbackReason || 'nothing has been saved here yet'}.`;
}

/**
 * The reading beside a provider. A missing key is named by its setting, so
 * Dane knows exactly what to add and where.
 */
export function readingFor(row: ProviderRow, reading: Reading | null): { verdict: string; detail: string } {
  if (!row.keySet) return { verdict: 'NOT SET', detail: `no key: add ${row.keyEnv} to Doppler production` };
  const key = reading?.keys.find((k) => k.provider === row.id);
  if (key) return { verdict: key.verdict, detail: key.reason };
  if (!reading) return { verdict: 'key set', detail: 'waiting for the AI keys check above' };
  return { verdict: 'key set', detail: 'the AI keys check above does not test this provider yet' };
}

/** What the screen sends: the rows in order, and the added services. */
export function payloadOf(rows: ProviderRow[], custom: CustomProvider[]): Record<string, unknown> {
  return {
    providers: rows.map((r) => ({ id: r.id, enabled: r.enabled, fast: r.fast.trim(), strong: r.strong.trim() })),
    customProviders: custom.map((c) => ({ id: c.id, label: c.label.trim(), baseUrl: c.baseUrl.trim(), keyEnv: c.keyEnv.trim() })),
  };
}

const VERDICT_COLOR: Record<string, string> = {
  WORKS: '#2e7d32',
  'OUT OF CREDIT': '#d32f2f',
  INVALID: '#d32f2f',
  'CANNOT TELL': '#b26a00',
  'NOT SET': 'var(--muted)',
};

const cell: React.CSSProperties = { padding: '0.5rem 0.5rem 0.5rem 0', verticalAlign: 'top', overflowWrap: 'anywhere' };
const smallInput: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };

/** The table alone, so a test can assert what Dane actually sees. */
export function ProviderTable({ rows, reading, onChange }: {
  rows: ProviderRow[];
  reading: Reading | null;
  onChange: (rows: ProviderRow[]) => void;
}): React.ReactElement {
  const set = (i: number, patch: Partial<ProviderRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
          <th style={{ ...cell, width: '6.5rem' }}>Order</th>
          <th style={cell}>Provider</th>
          <th style={cell}>Right now</th>
          <th style={cell}>Fast Model</th>
          <th style={cell}>Strong Model</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const r = readingFor(row, reading);
          return (
            <tr key={row.id} data-ai-provider={row.id} style={{ borderBottom: '1px solid var(--border)', opacity: row.enabled ? 1 : 0.6 }}>
              <td style={cell}>
                <span className="ai-provider-order">
                  <button type="button" className="btn" aria-label={`Move ${row.label} up`} disabled={i === 0} onClick={() => onChange(moveRow(rows, i, -1))}>↑</button>
                  <button type="button" className="btn" aria-label={`Move ${row.label} down`} disabled={i === rows.length - 1} onClick={() => onChange(moveRow(rows, i, 1))}>↓</button>
                </span>
              </td>
              <td style={cell}>
                <label className="ai-provider-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={row.enabled}
                    aria-label={`Use ${row.label}`}
                    onChange={(e) => set(i, { enabled: e.target.checked })}
                  />
                  <strong>{row.label}</strong>
                </label>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  {row.enabled ? 'On' : 'Off'} · key setting {row.keyEnv}
                  {row.custom && row.baseUrl ? ` · ${row.baseUrl}` : ''}
                </div>
              </td>
              <td style={cell}>
                <strong style={{ color: VERDICT_COLOR[r.verdict] || 'inherit' }}>{r.verdict}</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{r.detail}</div>
              </td>
              <td style={cell}>
                <input type="text" className="ai-provider-model" style={smallInput} value={row.fast} placeholder={row.defaultFast} aria-label={`${row.label} fast model`} onChange={(e) => set(i, { fast: e.target.value })} />
              </td>
              <td style={cell}>
                <input type="text" className="ai-provider-model" style={smallInput} value={row.strong} placeholder={row.defaultStrong} aria-label={`${row.label} strong model`} onChange={(e) => set(i, { strong: e.target.value })} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const EMPTY_SERVICE = { label: '', baseUrl: '', keyEnv: '', fast: '', strong: '' };

export default function AiProviderPanel(): React.ReactElement {
  const hostRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<ScreenState | null>(null);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [custom, setCustom] = useState<CustomProvider[]>([]);
  const [reading, setReading] = useState<Reading | null>(
    () => (window as unknown as { __starcasterAiKeysReading?: Reading }).__starcasterAiKeysReading || null,
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(EMPTY_SERVICE);

  const take = useCallback((next: ScreenState) => {
    setState(next);
    setRows(next.providers || []);
    setCustom(next.customProviders || []);
  }, []);

  const load = useCallback(async () => {
    const api = getAppApi();
    if (!api) { setError('Admin app not ready.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api(PATH);
      take((res?.data || res) as ScreenState);
    } catch (err) {
      setError(`Could not read the AI provider settings: ${err instanceof Error ? err.message : 'no answer'}`);
    } finally {
      setBusy(false);
    }
  }, [take]);

  const save = useCallback(async (nextRows: ProviderRow[], nextCustom: CustomProvider[]) => {
    const api = getAppApi();
    if (!api) { setError('Admin app not ready.'); return false; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api(PATH, { method: 'PUT', body: JSON.stringify(payloadOf(nextRows, nextCustom)) });
      const data = (res?.data || res) as ScreenState & { saved?: boolean };
      take(data);
      // The server answers only after reading the row back, so this is what is stored.
      setNotice(data.saved ? 'Saved and read back. AI features follow this order within about a minute.' : '');
      return true;
    } catch (err) {
      setError(`Not saved: ${err instanceof Error ? err.message : 'no answer'}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [take]);

  // Read only when Settings › APIs is on screen; the vanilla shell mounts every
  // page at start-up, before sign-in (same reveal pattern as the AI keys panel).
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

  useEffect(() => {
    const onReading = (e: Event) => setReading((e as CustomEvent<Reading>).detail);
    window.addEventListener(AI_KEYS_READING_EVENT, onReading);
    return () => window.removeEventListener(AI_KEYS_READING_EVENT, onReading);
  }, []);

  const addService = async () => {
    const service: CustomProvider = { label: adding.label, baseUrl: adding.baseUrl, keyEnv: adding.keyEnv };
    const nextCustom = [...custom, service];
    // Its id is made from its name on the server; the row uses the same rule.
    const id = `custom-${adding.label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)}`;
    const nextRows = [...rows, {
      id, label: adding.label.trim(), enabled: false, fast: adding.fast, strong: adding.strong,
      defaultFast: '', defaultStrong: '', keyEnv: adding.keyEnv.trim(), keySet: false, custom: true, baseUrl: adding.baseUrl.trim(),
    }];
    if (await save(nextRows, nextCustom)) setAdding(EMPTY_SERVICE);
  };

  const removeService = (id: string) => {
    setCustom(custom.filter((c) => c.id !== id));
    setRows(rows.filter((r) => r.id !== id));
  };

  return (
    <section ref={hostRef} className="docs-panel ai-provider-panel" style={{ marginBottom: '1rem' }} data-ai-provider-panel>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>AI provider</h3>
        <button type="button" className="btn btn-save" disabled={busy || !state} onClick={() => { void save(rows, custom); }}>
          {busy ? 'Working…' : 'Save'}
        </button>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0.4rem 0 0.75rem' }}>
        Every AI feature tries these from the top and uses the first one switched on that can pay. It moves to the
        next only when one is out of credit or its key is refused. Changes reach the website and the Mac Mini
        within about a minute.
      </p>

      {state && (
        <p data-ai-provider-source style={{ fontSize: '0.85rem', margin: '0 0 0.75rem', color: state.source === 'settings' ? 'inherit' : '#b26a00' }}>
          {sourceText(state)}
        </p>
      )}
      {error && <p style={{ color: '#d32f2f' }}>{error}</p>}
      {notice && <p style={{ color: '#2e7d32' }}>{notice}</p>}
      {!state && !error && <p style={{ color: 'var(--muted)' }}>{busy ? 'Reading the AI provider settings…' : 'Not read yet.'}</p>}

      {state && <ProviderTable rows={rows} reading={reading} onChange={setRows} />}

      {state && custom.length > 0 && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
          {custom.map((c) => (
            <div key={c.id || c.label} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span>Added service <strong>{c.label}</strong> ({c.baseUrl}, key setting {c.keyEnv})</span>
              <button type="button" className="btn" onClick={() => removeService(String(c.id))}>Remove</button>
            </div>
          ))}
          <div style={{ color: 'var(--muted)' }}>A removal takes effect when you click Save.</div>
        </div>
      )}

      {state && (
        <details style={{ marginTop: '1rem' }}>
          <summary>Add an OpenAI-style service</summary>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            For any service that copies OpenAI&apos;s chat API. Put its key in Doppler production under a setting of its
            own, named AI_SERVICE_&lt;NAME&gt;_API_KEY (for Groq: AI_SERVICE_GROQ_API_KEY), and give that name here. Only
            names starting AI_SERVICE_ are accepted, so an added service can never be handed a key that belongs to
            something else. Never type the key itself on this screen. It is added switched off.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.5rem' }}>
            <label>Name<input type="text" style={smallInput} value={adding.label} placeholder="Groq" onChange={(e) => setAdding({ ...adding, label: e.target.value })} /></label>
            <label>Address<input type="text" style={smallInput} value={adding.baseUrl} placeholder="https://api.groq.com/openai/v1" onChange={(e) => setAdding({ ...adding, baseUrl: e.target.value })} /></label>
            <label>Key Setting Name<input type="text" style={smallInput} value={adding.keyEnv} placeholder="AI_SERVICE_GROQ_API_KEY" autoComplete="off" onChange={(e) => setAdding({ ...adding, keyEnv: e.target.value })} /></label>
            <label>Fast Model<input type="text" style={smallInput} value={adding.fast} onChange={(e) => setAdding({ ...adding, fast: e.target.value })} /></label>
            <label>Strong Model<input type="text" style={smallInput} value={adding.strong} onChange={(e) => setAdding({ ...adding, strong: e.target.value })} /></label>
          </div>
          <button type="button" className="btn" style={{ marginTop: '0.5rem' }} disabled={busy} onClick={() => { void addService(); }}>
            Add and save
          </button>
        </details>
      )}

      {state?.updatedAt && (
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.75rem' }}>
          Last saved {new Date(state.updatedAt).toLocaleString()}.
        </p>
      )}
    </section>
  );
}
