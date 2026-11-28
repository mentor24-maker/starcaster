import React, { useCallback, useEffect, useState } from 'react';
import { PROJECT_EDITOR_OPENED_EVENT } from './project-share-panel';

/**
 * Settings › Projects › (a project) › Email (SC-928): which addresses on the
 * project's domain StarCaster receives, where each one forwards, whether it is
 * on, and what arrived recently. The receiving itself is SC-926's webhook
 * (routes/inboundEmail.js); this card only manages its routes.
 *
 * A React island inside the frozen vanilla project-detail screen, mounted into
 * #inboundEmailReactRoot by react-entry.js, directly above Share with. Like
 * that card it learns which project is open from PROJECT_EDITOR_OPENED_EVENT
 * and falls back to the session project.
 *
 * Every write answers with the stored list (routes/inboundEmailSettings.js),
 * and the card shows that answer, never what it sent.
 */

export type InboundDelivery = {
  id: string;
  receivedAt: string;
  from: string;
  subject: string;
  outcome: string;
  error: string;
  attempts: number;
};

export type InboundRoute = {
  id: string;
  address: string;
  forwardTo: string;
  enabled: boolean;
  lastArrivalAt: string;
  deliveries: InboundDelivery[];
};

export type InboundState = {
  routes: InboundRoute[];
  domains: string[];
  canEdit: boolean;
};

export const EMPTY_STATE: InboundState = { routes: [], domains: [], canEdit: false };

function getApp(): any {
  return (window as unknown as { App?: any }).App;
}

function sessionProjectId(): string {
  const app = getApp();
  return typeof app?.projectContext?.getSessionProjectId === 'function'
    ? String(app.projectContext.getSessionProjectId() || '').trim()
    : String(app?.state?.currentProjectId || '').trim();
}

function text(v: unknown): string {
  return String(v ?? '').trim();
}

/** The server's answer, read defensively; a missing `canEdit` is read-only. */
export function readInboundState(body: any): InboundState {
  const data = body?.data ?? body ?? {};
  const routes: InboundRoute[] = Array.isArray(data.routes)
    ? data.routes.map((r: any) => ({
      id: text(r?.id),
      address: text(r?.address),
      forwardTo: text(r?.forwardTo),
      enabled: r?.enabled === true,
      lastArrivalAt: text(r?.lastArrivalAt),
      deliveries: Array.isArray(r?.deliveries)
        ? r.deliveries.map((d: any) => ({
          id: text(d?.id),
          receivedAt: text(d?.receivedAt),
          from: text(d?.from),
          subject: text(d?.subject),
          outcome: text(d?.outcome),
          error: text(d?.error),
          attempts: Number(d?.attempts) || 1,
        }))
        : [],
    })).filter((r: InboundRoute) => r.id)
    : [];
  const domains = Array.isArray(data.domains) ? data.domains.map(text).filter(Boolean) : [];
  return { routes, domains, canEdit: data.canEdit === true };
}

export function summaryLine(state: InboundState): string {
  const n = state.routes.length;
  if (!n) return 'Receives no email';
  const on = state.routes.filter((r) => r.enabled).length;
  const word = n === 1 ? 'address' : 'addresses';
  return on === n ? `${n} ${word}` : `${n} ${word}, ${n - on} switched off`;
}

/** One delivery's result in plain words, with the reason when it did not forward. */
export function outcomeLabel(d: InboundDelivery): string {
  const why = d.error ? `: ${d.error}` : '';
  switch (d.outcome) {
    case 'forwarded': return d.error ? `Forwarded (${d.error})` : 'Forwarded';
    case 'refused': return `Refused${why}`;
    case 'failed': return `Failed${why}${d.attempts > 1 ? ` (attempt ${d.attempts})` : ''}`;
    case 'no_route': return `Not forwarded${why}`;
    case 'received': return 'Being forwarded now';
    default: return d.outcome || 'Unknown';
  }
}

export function formatWhen(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

type RouteDraft = { address: string; forwardTo: string };

type ViewProps = {
  state: InboundState;
  open: boolean;
  busy?: boolean;
  loadError?: string;
  error?: string;
  message?: string;
  draft: RouteDraft;
  editingId?: string;
  editDraft?: RouteDraft;
  logOpenId?: string;
  onToggleOpen?: () => void;
  onDraft?: (d: RouteDraft) => void;
  onAdd?: () => void;
  onStartEdit?: (r: InboundRoute) => void;
  onEditDraft?: (d: RouteDraft) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onToggleEnabled?: (r: InboundRoute) => void;
  onDelete?: (r: InboundRoute) => void;
  onToggleLog?: (id: string) => void;
};

function RouteLog({ route }: { route: InboundRoute }) {
  if (!route.deliveries.length) {
    return <p className="meta">No email has arrived for {route.address} yet.</p>;
  }
  return (
    <ul className="inbound-email-log">
      {route.deliveries.map((d) => (
        <li key={d.id} className={`inbound-email-log-item inbound-email-outcome-${d.outcome}`}>
          <span className="meta">{formatWhen(d.receivedAt)}</span>
          <span className="inbound-email-log-from">{d.from || '(no sender)'}</span>
          <span className="inbound-email-log-subject">{d.subject || '(no subject)'}</span>
          <span className="inbound-email-log-outcome">{outcomeLabel(d)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The card, from props alone, so every sentence on it is testable without a browser. */
export function InboundEmailView(props: ViewProps) {
  const { state, open, busy, loadError, error, message, draft, editingId, editDraft, logOpenId } = props;
  const summary = loadError ? 'Could not read email settings' : summaryLine(state);
  const locked = !state.canEdit || Boolean(busy);

  return (
    <div className="card project-share-card inbound-email-card">
      <button type="button" className="project-share-toggle" aria-expanded={open} onClick={props.onToggleOpen}>
        <span className="project-details-section-heading project-share-heading">Email</span>
        <span className="meta project-share-summary">{summary}</span>
        <span className="project-share-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && loadError && (
        <div className="project-share-body">
          <p className="meta project-share-error" role="alert">{loadError}</p>
        </div>
      )}

      {open && !loadError && (
        <div className="project-share-body">
          <p className="meta">
            Email sent to these addresses is forwarded to the inbox beside each one. StarCaster keeps who sent it and the subject, never the message itself.
          </p>
          {!state.canEdit && <p className="meta">Only a project owner or admin can change these.</p>}

          {state.routes.length === 0 ? (
            <p className="meta inbound-email-empty">This project receives no email yet. Add an address to start.</p>
          ) : (
            <ul className="inbound-email-routes">
              {state.routes.map((r) => {
                const editing = editingId === r.id && editDraft;
                return (
                  <li key={r.id} className={`inbound-email-route${r.enabled ? '' : ' is-off'}`} data-route-address={r.address}>
                    {editing ? (
                      <div className="inbound-email-form">
                        <label>
                          <span className="module-toggle-label">Address</span>
                          <input
                            type="email"
                            value={editDraft.address}
                            aria-label="Address"
                            onChange={(e) => props.onEditDraft?.({ ...editDraft, address: e.target.value })}
                          />
                        </label>
                        <label>
                          <span className="module-toggle-label">Forwards to</span>
                          <input
                            type="email"
                            value={editDraft.forwardTo}
                            aria-label="Forwards to"
                            onChange={(e) => props.onEditDraft?.({ ...editDraft, forwardTo: e.target.value })}
                          />
                        </label>
                        <div className="project-share-actions">
                          <button type="button" className="btn btn-save" disabled={busy} onClick={props.onSaveEdit}>Save</button>
                          <button type="button" className="btn btn-ghost" disabled={busy} onClick={props.onCancelEdit}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="inbound-email-route-head">
                          <span className="inbound-email-address">{r.address}</span>
                          <span className="inbound-email-state">{r.enabled ? 'On' : 'Off'}</span>
                        </div>
                        <div className="meta inbound-email-forward">Forwards to {r.forwardTo}</div>
                        <div className="meta">
                          {r.lastArrivalAt ? `Last email arrived ${formatWhen(r.lastArrivalAt)}` : 'No email has arrived yet'}
                        </div>
                        <div className="inbound-email-route-actions">
                          <label className="toggle-switch" title={r.enabled ? 'Switch off' : 'Switch on'}>
                            <input
                              type="checkbox"
                              checked={r.enabled}
                              disabled={locked}
                              aria-label={`Receive email for ${r.address}`}
                              onChange={() => props.onToggleEnabled?.(r)}
                            />
                            <span className="toggle-track"></span>
                          </label>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => props.onToggleLog?.(r.id)}>
                            {logOpenId === r.id ? 'Hide recent email' : 'Recent email'}
                          </button>
                          {state.canEdit && (
                            <>
                              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => props.onStartEdit?.(r)}>Edit</button>
                              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => props.onDelete?.(r)}>Delete</button>
                            </>
                          )}
                        </div>
                        {logOpenId === r.id && <RouteLog route={r} />}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {state.canEdit && (
            <div className="inbound-email-form inbound-email-add">
              <span className="module-toggle-label">Add an address</span>
              {state.domains.length === 0 ? (
                <p className="meta">This project has no domain set, so it cannot receive email. Set its Custom Domain first.</p>
              ) : (
                <>
                  <label>
                    <span className="meta">Address on {state.domains.join(' or ')}</span>
                    <input
                      type="email"
                      value={draft.address}
                      placeholder={`hello@${state.domains[0]}`}
                      aria-label="New address"
                      onChange={(e) => props.onDraft?.({ ...draft, address: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="meta">Forwards to</span>
                    <input
                      type="email"
                      value={draft.forwardTo}
                      placeholder="you@gmail.com"
                      aria-label="New forward-to address"
                      onChange={(e) => props.onDraft?.({ ...draft, forwardTo: e.target.value })}
                    />
                  </label>
                  <div className="project-share-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !draft.address.trim() || !draft.forwardTo.trim()}
                      onClick={props.onAdd}
                    >
                      {busy ? 'Saving…' : 'Add address'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {message && <p className="meta" role="status">{message}</p>}
          {error && <p className="meta project-share-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

const NO_DRAFT: RouteDraft = { address: '', forwardTo: '' };

export default function InboundEmailPanel() {
  const [projectId, setProjectId] = useState(() => sessionProjectId());
  const [opened, setOpened] = useState(0);
  const [state, setState] = useState<InboundState>(EMPTY_STATE);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<RouteDraft>(NO_DRAFT);
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState<RouteDraft>(NO_DRAFT);
  const [logOpenId, setLogOpenId] = useState('');

  useEffect(() => {
    const onOpened = (event: Event) => {
      const id = text((event as CustomEvent)?.detail?.projectId);
      if (!id) return;
      setProjectId(id);
      setOpened((n) => n + 1);
    };
    document.addEventListener(PROJECT_EDITOR_OPENED_EVENT, onOpened);
    return () => document.removeEventListener(PROJECT_EDITOR_OPENED_EVENT, onOpened);
  }, []);

  const base = `/api/projects/${encodeURIComponent(projectId)}/inbound-email`;

  const load = useCallback(async () => {
    const app = getApp();
    if (!projectId) return;
    if (typeof app?.api !== 'function') {
      setLoadError('The admin app has not finished loading. Reload the page and try again.');
      return;
    }
    setLoadError('');
    try {
      setState(readInboundState(await app.api(base)));
    } catch (err) {
      setState(EMPTY_STATE);
      setLoadError(`Could not read this project's email settings: ${(err as Error)?.message || 'unknown error'}`);
    }
  }, [projectId, base]);

  useEffect(() => {
    setOpen(false);
    setError('');
    setMessage('');
    setDraft(NO_DRAFT);
    setEditingId('');
    setLogOpenId('');
    setState(EMPTY_STATE);
    void load();
  }, [projectId, opened, load]);

  const write = useCallback(async (path: string, init: { method: string; body?: unknown }, done: string) => {
    const app = getApp();
    if (typeof app?.api !== 'function' || !projectId) return false;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = await app.api(path, {
        method: init.method,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      setState(readInboundState(body));
      setMessage(done);
      return true;
    } catch (err) {
      setError(`Not saved: ${(err as Error)?.message || 'unknown error'}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  return (
    <InboundEmailView
      state={state}
      open={open}
      busy={busy}
      loadError={loadError}
      error={error}
      message={message}
      draft={draft}
      editingId={editingId}
      editDraft={editDraft}
      logOpenId={logOpenId}
      onToggleOpen={() => setOpen((v) => !v)}
      onDraft={setDraft}
      onAdd={async () => {
        const ok = await write(`${base}/routes`, { method: 'POST', body: { address: draft.address, forwardTo: draft.forwardTo } }, `Added ${draft.address.trim()}.`);
        if (ok) setDraft(NO_DRAFT);
      }}
      onStartEdit={(r) => { setEditingId(r.id); setEditDraft({ address: r.address, forwardTo: r.forwardTo }); }}
      onEditDraft={setEditDraft}
      onCancelEdit={() => setEditingId('')}
      onSaveEdit={async () => {
        const ok = await write(`${base}/routes/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: { address: editDraft.address, forwardTo: editDraft.forwardTo } }, 'Saved.');
        if (ok) setEditingId('');
      }}
      onToggleEnabled={(r) => {
        void write(`${base}/routes/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: { enabled: !r.enabled } }, r.enabled ? `${r.address} is switched off: its email is no longer forwarded.` : `${r.address} is switched on.`);
      }}
      onDelete={(r) => {
        if (!window.confirm(`Stop receiving email for ${r.address} and delete it? Email sent there afterwards is not forwarded.`)) return;
        void write(`${base}/routes/${encodeURIComponent(r.id)}`, { method: 'DELETE' }, `Deleted ${r.address}.`);
      }}
      onToggleLog={(id) => setLogOpenId((cur) => (cur === id ? '' : id))}
    />
  );
}
