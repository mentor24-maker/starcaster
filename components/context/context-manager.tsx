import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BuilderRichTextEditor } from '../builder-rich-text-editor';

/**
 * Assets › Context (ticket SC-808, slice 1 of 3): written reference material a
 * project keeps for agent sessions to read. A table of entries (title, kind,
 * last updated, Edit, Delete) and an editor (title + the Builder's rich-text
 * editor) for new and existing ones.
 *
 * Mounted on #assetsContextReactRoot by builder-react-entry.tsx (the bundle
 * that already carries the rich-text editor), not react-entry.js like Fonts.
 * Data: /api/context (routes/context.js, lib/contextStore.js), sent through
 * App.api so the active project travels with every request.
 *
 * File uploads are SC-809; the agent read-out is SC-810.
 */

export const CONTEXT_PATH = '/api/context';
/** The app announces a project switch with this (see fonts-manager.tsx). */
export const PROJECT_SWITCH_EVENT = 'projectContext:session-changed';
export const EMPTY_TEXT = 'No context entries yet in this project';

export type ContextEntry = {
  id: string;
  title: string;
  kind: 'note' | 'file';
  bodyHtml: string;
  updatedAt: string;
  createdAt?: string;
};

type AppShape = {
  api?: (path: string, options?: RequestInit) => Promise<Record<string, any>>;
};

function getApp(): AppShape | null {
  return ((window as unknown as { App?: AppShape }).App) || null;
}

const KIND_LABEL: Record<string, string> = { note: 'Note', file: 'File' };

export function formatUpdated(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

type Draft = { id: string | null; title: string; bodyHtml: string };

export default function ContextManager() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [entries, setEntries] = useState<ContextEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState('');
  const requestSeq = useRef(0);

  const call = useCallback(async (path: string, options?: RequestInit) => {
    const api = getApp()?.api;
    if (typeof api !== 'function') throw new Error('The admin app is still loading. Try again in a moment.');
    return api(path, options);
  }, []);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const body = await call(CONTEXT_PATH);
      if (seq !== requestSeq.current) return;
      if (!body?.ok) {
        setError(body?.error?.message || 'The context entries could not be read.');
        setEntries(null);
      } else {
        setError('');
        setEntries((body.data?.entries || []) as ContextEntry[]);
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : 'The context entries could not be read.');
      setEntries(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [call]);

  // Load each time the page is shown (the island mounts before a project is chosen).
  useEffect(() => {
    const page = hostRef.current?.closest('.app-page');
    const visible = () => !page || !page.classList.contains('hidden');
    if (visible()) void load();
    if (!page || typeof MutationObserver === 'undefined') return undefined;
    let wasVisible = visible();
    const observer = new MutationObserver(() => {
      const now = visible();
      if (now && !wasVisible) void load();
      wasVisible = now;
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [load]);

  // A project switch neither shows nor hides the page, so the old project's
  // entries would stay on screen under the new project's name.
  useEffect(() => {
    const onSwitch = () => {
      requestSeq.current += 1;
      setEntries(null);
      setError('');
      setNotice('');
      setDraft(null);
      setConfirmingDelete('');
      setLoading(false);
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    };
    window.addEventListener(PROJECT_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, onSwitch);
  }, [load]);

  const startNew = () => {
    setDraft({ id: null, title: '', bodyHtml: '' });
    setFormError('');
    setNotice('');
  };

  const startEdit = (entry: ContextEntry) => {
    setDraft({ id: entry.id, title: entry.title, bodyHtml: entry.bodyHtml || '' });
    setFormError('');
    setNotice('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || saving) return;
    const title = draft.title.trim();
    if (!title) {
      setFormError('An entry needs a title.');
      return;
    }
    setSaving(true);
    setFormError('');
    // A project switch while this is in flight bumps requestSeq; the answer
    // then belongs to the OLD project and must not report or reload here.
    const seq = requestSeq.current;
    try {
      const isNew = !draft.id;
      const body = await call(isNew ? CONTEXT_PATH : `${CONTEXT_PATH}/${encodeURIComponent(draft.id!)}`, {
        method: isNew ? 'POST' : 'PATCH',
        body: JSON.stringify({ title, bodyHtml: draft.bodyHtml }),
      });
      if (seq !== requestSeq.current) return;
      if (!body?.ok) {
        setFormError(body?.error?.message || 'The entry could not be saved.');
        return;
      }
      const saved = body.data?.entry as ContextEntry;
      setDraft(null);
      setNotice(`Saved "${saved?.title || title}".`);
      await load();
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setFormError(err instanceof Error ? err.message : 'The entry could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: ContextEntry) => {
    setConfirmingDelete('');
    const seq = requestSeq.current;
    try {
      const body = await call(`${CONTEXT_PATH}/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      if (seq !== requestSeq.current) return;
      if (!body?.ok) {
        setNotice(body?.error?.message || `"${entry.title}" could not be deleted.`);
        return;
      }
      if (draft?.id === entry.id) setDraft(null);
      setNotice(`Deleted "${entry.title}".`);
      await load();
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setNotice(err instanceof Error ? err.message : `"${entry.title}" could not be deleted.`);
    }
  };

  return (
    <div className="context-manager" ref={hostRef}>
      <div className="context-manager-toolbar">
        <button type="button" className="btn btn-primary" onClick={startNew} disabled={Boolean(draft && !draft.id)}>
          New entry
        </button>
      </div>

      {notice ? <p className="context-manager-notice" role="status">{notice}</p> : null}

      {draft ? (
        <form className="context-manager-editor" aria-label={draft.id ? 'Edit context entry' : 'New context entry'} onSubmit={save}>
          <label className="field">
            <span>Title</span>
            <input
              name="title"
              type="text"
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          {/* The editor's toolbar styles are scoped under .builder-react-root
              (src/css/_builder-react.css); without it the toolbar renders as
              raw form controls. Scoped to the editor only, so the rest of the
              page keeps the admin app's look. */}
          <div className="builder-react-root context-manager-body">
            <BuilderRichTextEditor
              value={draft.bodyHtml}
              onChange={(value) => setDraft((current) => (current ? { ...current, bodyHtml: value } : current))}
              placeholder="Write the reference material agents should read"
            />
          </div>
          {formError ? <p className="context-manager-error" role="alert">{formError}</p> : null}
          <div className="context-manager-actions">
            <button type="submit" className="btn btn-save" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
          </div>
        </form>
      ) : null}

      {error ? <p className="context-manager-error" role="alert">{error}</p> : null}

      {!error && entries && entries.length === 0 ? (
        <p className="context-manager-empty">{EMPTY_TEXT}</p>
      ) : null}

      {!error && !entries && loading ? <p className="context-manager-empty">Loading…</p> : null}

      {entries && entries.length > 0 ? (
        <div className="context-manager-table-wrap">
        <table className="context-manager-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Kind</th>
              <th>Last updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} data-entry-id={entry.id}>
                <td className="context-manager-title">{entry.title}</td>
                <td>{KIND_LABEL[entry.kind] || entry.kind}</td>
                <td>{formatUpdated(entry.updatedAt)}</td>
                <td className="context-manager-row-actions">
                  {confirmingDelete === entry.id ? (
                    <>
                      <span>Delete "{entry.title}"?</span>
                      <button type="button" className="btn context-manager-confirm-delete" onClick={() => void remove(entry)}>Yes, delete</button>
                      <button type="button" className="btn" onClick={() => setConfirmingDelete('')}>Keep</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn" onClick={() => startEdit(entry)}>Edit</button>
                      <button type="button" className="btn" onClick={() => setConfirmingDelete(entry.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
    </div>
  );
}
