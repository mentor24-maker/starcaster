import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BuilderRichTextEditor } from '../builder-rich-text-editor';
import { uploadToBlob } from '../../lib/builder-client/media-blob-upload';
import {
  ACCEPT_ATTRIBUTE,
  checkContextFile,
  contextFileType,
  contextStoragePath,
  formatFileSize,
} from '../../lib/contextFileTypes.js';

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
 * Files (SC-809): Upload file, or drop files on the page. Each goes from the
 * browser straight to Vercel Blob through /api/context/blob-upload (so the
 * server's ~4.5MB request limit does not cap it), then is recorded with
 * POST /api/context as a kind 'file' entry. Which files are accepted is ONE
 * rule, lib/contextFileTypes.js, which the server applies again.
 * The agent read-out is SC-810.
 */

export const CONTEXT_PATH = '/api/context';
/** The app announces a project switch with this (see fonts-manager.tsx). */
export const PROJECT_SWITCH_EVENT = 'projectContext:session-changed';
export const EMPTY_TEXT = 'No context entries yet in this project';
export const UPLOAD_PATH = '/api/context/blob-upload';

export type ContextEntry = {
  id: string;
  title: string;
  kind: 'note' | 'file';
  bodyHtml: string;
  updatedAt: string;
  createdAt?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number | null;
};

type AppShape = {
  api?: (path: string, options?: RequestInit) => Promise<Record<string, any>>;
  projectContext?: { getSessionProjectId?: () => string };
  state?: { currentProjectId?: string };
  getSessionToken?: () => string;
};

function getApp(): AppShape | null {
  return ((window as unknown as { App?: AppShape }).App) || null;
}

const KIND_LABEL: Record<string, string> = { note: 'Note', file: 'File' };

/** "PDF", "Word", … for a file entry; "Note" for a note. */
export function kindLabel(entry: ContextEntry): string {
  if (entry.kind !== 'file') return KIND_LABEL[entry.kind] || entry.kind;
  return contextFileType(entry.fileName || entry.fileUrl || '')?.label || 'File';
}

/** The active project, and the sign-in, the same way App.api sends them. */
function uploadHeaders(app: AppShape | null): { projectId: string; headers: Record<string, string> } {
  const projectId = String(
    (typeof app?.projectContext?.getSessionProjectId === 'function'
      ? app.projectContext.getSessionProjectId()
      : app?.state?.currentProjectId) || ''
  ).trim();
  const headers: Record<string, string> = {};
  if (projectId) headers['X-Project-ID'] = projectId;
  const token = typeof app?.getSessionToken === 'function' ? String(app.getSessionToken() || '') : '';
  if (token) headers.Authorization = `Bearer ${token}`;
  return { projectId, headers };
}

export function formatUpdated(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

type Draft = { id: string | null; title: string; bodyHtml: string; fileName?: string };

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
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      setUploadError('');
      setUploading(null);
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
    setDraft({
      id: entry.id,
      title: entry.title,
      bodyHtml: entry.bodyHtml || '',
      fileName: entry.kind === 'file' ? (entry.fileName || entry.title) : undefined,
    });
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

  /**
   * One file: refuse it here if it is the wrong type or too big (before any
   * upload), else upload it straight to storage and record it. Files are taken
   * one after another, so each one's outcome is reported on its own.
   */
  const uploadFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    setUploadError('');
    setNotice('');
    const seq = requestSeq.current;
    const problems: string[] = [];
    const saved: string[] = [];
    for (const file of files) {
      const allowed = checkContextFile({ name: file.name, size: file.size });
      if (!allowed.ok || !allowed.type) {
        problems.push(files.length > 1 ? `${file.name}: ${allowed.message}` : String(allowed.message));
        continue;
      }
      const app = getApp();
      const { projectId, headers } = uploadHeaders(app);
      if (!projectId) {
        problems.push('No project is selected, so there is nowhere to store this file.');
        break;
      }
      setUploading({ name: file.name, percent: 0 });
      let url = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        url = await uploadToBlob(file, {
          pathname: pathnameFor(projectId, file),
          handleUploadUrl: UPLOAD_PATH,
          clientPayload: { size: file.size },
          headers,
          contentType: allowed.type.mime,
          onProgress: (percent) => {
            if (seq === requestSeq.current) setUploading({ name: file.name, percent: Math.round(percent) });
          },
        });
      } catch (err) {
        if (seq !== requestSeq.current) return;
        // eslint-disable-next-line no-await-in-loop
        const reason = await explainUploadFailure(pathnameFor(projectId, file), file, err);
        if (seq !== requestSeq.current) return;
        problems.push(`${file.name} was not uploaded: ${reason}`);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const body = await call(CONTEXT_PATH, {
          method: 'POST',
          body: JSON.stringify({ kind: 'file', file: { url, name: file.name, size: file.size } }),
        });
        if (seq !== requestSeq.current) return;
        if (!body?.ok) {
          problems.push(`${file.name} was uploaded but could not be added to the list: ${body?.error?.message || 'the server did not say why'}. The file is stored at ${url}`);
          continue;
        }
        saved.push(file.name);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        problems.push(`${file.name} was uploaded but could not be added to the list: ${err instanceof Error ? err.message : String(err)}. The file is stored at ${url}`);
      }
    }
    if (seq !== requestSeq.current) return;
    setUploading(null);
    if (problems.length) setUploadError(problems.join(' '));
    if (saved.length) {
      setNotice(saved.length === 1 ? `Uploaded "${saved[0]}".` : `Uploaded ${saved.length} files.`);
      await load();
    }
  };

  // One path per file per attempt, so the failure check asks about the same one.
  const pathsByFile = useRef(new WeakMap<File, string>());
  const pathnameFor = (projectId: string, file: File) => {
    const known = pathsByFile.current.get(file);
    if (known) return known;
    const made = contextStoragePath(projectId, file.name);
    pathsByFile.current.set(file, made);
    return made;
  };

  /**
   * The storage library answers every refused token with the same sentence,
   * "Failed to retrieve the client token", and drops the server's reason
   * (file storage not set up, wrong folder, wrong type). Ask the endpoint the
   * same question through App.api, which does keep the reason, and show that.
   */
  const explainUploadFailure = async (pathname: string, file: File, err: unknown): Promise<string> => {
    const said = err instanceof Error ? err.message : String(err);
    if (!/client token/i.test(said)) return said;
    try {
      const body = await call(UPLOAD_PATH, {
        method: 'POST',
        body: JSON.stringify({
          type: 'blob.generate-client-token',
          payload: { pathname, callbackUrl: UPLOAD_PATH, clientPayload: JSON.stringify({ size: file.size }), multipart: true },
        }),
      });
      if (body && body.ok === false && body.error?.message) return String(body.error.message);
    } catch (asked) {
      // App.api THROWS a structured refusal, with the server's message and a
      // status. Without a status the request itself died: fall back to the
      // library's own words rather than guess.
      const status = (asked as { status?: unknown } | null)?.status;
      if (typeof status === 'number' && asked instanceof Error && asked.message) return asked.message;
    }
    return said;
  };

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void uploadFiles(files);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(event.dataTransfer?.files || []));
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    if (!dragging) setDragging(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
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
      const file = body.data?.file as { removed?: boolean; error?: string } | null | undefined;
      if (file && file.removed === false) {
        setNotice(`Deleted "${entry.title}" from the list, but its stored file was left behind: ${file.error || 'the storage did not say why'}`);
      } else {
        setNotice(`Deleted "${entry.title}".`);
      }
      await load();
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setNotice(err instanceof Error ? err.message : `"${entry.title}" could not be deleted.`);
    }
  };

  return (
    <div
      className={`context-manager${dragging ? ' context-manager--dragging' : ''}`}
      ref={hostRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="context-manager-toolbar">
        <button type="button" className="btn btn-primary" onClick={startNew} disabled={Boolean(draft && !draft.id)}>
          New entry
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={Boolean(uploading)}
        >
          Upload file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="context-manager-file-input"
          data-testid="context-file-input"
          onChange={onPick}
          hidden
        />
        <span className="context-manager-hint">or drop files here: PDF, text, Markdown, CSV, JSON, Word, Excel or images, up to 50 MB</span>
      </div>

      {uploading ? (
        <p className="context-manager-notice" role="status">
          Uploading {uploading.name}… {uploading.percent ? `${uploading.percent}%` : ''}
        </p>
      ) : null}
      {uploadError ? <p className="context-manager-error" role="alert">{uploadError}</p> : null}
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
          {draft.fileName ? (
            <p className="context-manager-file-note">File: {draft.fileName}. The note below can say what it is for.</p>
          ) : null}
          {/* The editor's toolbar styles are scoped under .builder-react-root
              (src/css/_builder-react.css); without it the toolbar renders as
              raw form controls. Scoped to the editor only, so the rest of the
              page keeps the admin app's look. */}
          <div className="builder-react-root context-manager-body">
            <BuilderRichTextEditor
              value={draft.bodyHtml}
              onChange={(value) => setDraft((current) => (current ? { ...current, bodyHtml: value } : current))}
              placeholder={draft.fileName ? 'Optional: what this file is, and when agents should use it' : 'Write the reference material agents should read'}
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
              <th>Size</th>
              <th>Last updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} data-entry-id={entry.id}>
                <td className="context-manager-title">
                  {entry.kind === 'file' && entry.fileUrl ? (
                    <a href={entry.fileUrl} target="_blank" rel="noopener noreferrer" title={`Open ${entry.fileName || entry.title}`}>
                      {entry.title}
                    </a>
                  ) : entry.title}
                </td>
                <td>{kindLabel(entry)}</td>
                <td>{entry.kind === 'file' && entry.fileSize != null ? formatFileSize(entry.fileSize) : ''}</td>
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
