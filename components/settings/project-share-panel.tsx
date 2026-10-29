import React, { useCallback, useEffect, useState } from 'react';

/**
 * Settings › Projects › (a project) › Share with: which of this project's
 * Builder libraries other projects may see, and which projects. Two checkbox
 * lists; every ticked type is shared with every ticked project (Dane's design,
 * 2026-10-28, task 86bcu6thw). Nothing is copied here — the receiving project
 * imports its own copy from each library (separate tickets).
 *
 * A React island inside the frozen vanilla project-detail screen, mounted into
 * #projectShareReactRoot by react-entry.js, directly above Import / Export.
 * The island mounts once while the page is hidden, so it learns which project
 * is open from PROJECT_EDITOR_OPENED_EVENT (settings.js openProjectEditor) and
 * falls back to the session project, which opening the editor also sets.
 *
 * Every answer — the load and the save — comes from the server
 * (routes/projectShares.js), and the panel shows what the server says is
 * stored, never what it sent. `canEdit` is decided there too, by the same rule
 * the save enforces.
 */

export const PROJECT_EDITOR_OPENED_EVENT = 'starcaster:project-editor-opened';

export const SHARE_TYPES = [
  { type: 'saved_sections', label: 'Saved sections' },
  { type: 'page_templates', label: 'Page templates' },
  { type: 'themes', label: 'Themes' },
] as const;

export type ShareProject = { id: string; name: string };

export type ShareState = {
  types: string[];
  targets: string[];
  projects: ShareProject[];
  canEdit: boolean;
};

function getApp(): any {
  return (window as unknown as { App?: any }).App;
}

function sessionProjectId(): string {
  const app = getApp();
  return typeof app?.projectContext?.getSessionProjectId === 'function'
    ? String(app.projectContext.getSessionProjectId() || '').trim()
    : String(app?.state?.currentProjectId || '').trim();
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v || '').trim()).filter(Boolean) : [];
}

/** The server's answer, read defensively — a missing field is an empty list,
 *  and a missing `canEdit` is read-only, never editable. */
export function readShareState(body: any): ShareState {
  const data = body?.data ?? body ?? {};
  const projects = Array.isArray(data.projects)
    ? data.projects
      .map((p: any) => ({ id: String(p?.id || '').trim(), name: String(p?.name || '').trim() }))
      .filter((p: ShareProject) => p.id)
    : [];
  return { types: textList(data.types), targets: textList(data.targets), projects, canEdit: data.canEdit === true };
}

/** The collapsed header's one line. Only targets that are still one of the
 *  caller's projects are counted, so the line agrees with the ticks below it. */
export function shareSummaryLine(types: string[], targetCount: number): string {
  const labels = SHARE_TYPES.filter((t) => types.includes(t.type)).map((t) => t.label);
  if (!labels.length || targetCount < 1) return 'Not shared with any project';
  return `${labels.join(', ')} → ${targetCount} ${targetCount === 1 ? 'project' : 'projects'}`;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

type ViewProps = {
  saved: ShareState;
  types: string[];
  targets: string[];
  open: boolean;
  saving?: boolean;
  dirty?: boolean;
  message?: string;
  error?: string;
  onToggleOpen?: () => void;
  onToggleType?: (type: string) => void;
  onToggleTarget?: (id: string) => void;
  onSave?: () => void;
};

/** The card, from props alone, so every sentence on it is testable without a
 *  browser (project-share-panel.test.tsx). */
export function ShareWithView(props: ViewProps) {
  const { saved, types, targets, open, saving, dirty, message, error } = props;
  const savedTargetCount = saved.targets.filter((id) => saved.projects.some((p) => p.id === id)).length;
  const summary = shareSummaryLine(saved.types, savedTargetCount);
  const locked = !saved.canEdit || Boolean(saving);
  const noProjects = saved.projects.length === 0;

  return (
    <div className="card project-share-card">
      <button
        type="button"
        className="project-share-toggle"
        aria-expanded={open}
        onClick={props.onToggleOpen}
      >
        <span className="project-details-section-heading project-share-heading">Share with</span>
        <span className="meta project-share-summary">{summary}</span>
        <span className="project-share-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="project-share-body">
          {!saved.canEdit && <p className="meta">Only a project owner can change sharing.</p>}

          <div className="project-share-columns">
            <fieldset className="project-share-list" disabled={locked}>
              <legend className="module-toggle-label">What to share</legend>
              {SHARE_TYPES.map((t) => (
                <label key={t.type} className="project-share-option">
                  <input
                    type="checkbox"
                    checked={types.includes(t.type)}
                    onChange={() => props.onToggleType?.(t.type)}
                  />
                  <span>{t.label}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="project-share-list" disabled={locked || noProjects}>
              <legend className="module-toggle-label">Share with these projects</legend>
              {noProjects ? (
                <p className="meta">You have no other projects to share with.</p>
              ) : (
                saved.projects.map((p) => (
                  <label key={p.id} className="project-share-option">
                    <input
                      type="checkbox"
                      checked={targets.includes(p.id)}
                      onChange={() => props.onToggleTarget?.(p.id)}
                    />
                    <span>{p.name || p.id}</span>
                  </label>
                ))
              )}
            </fieldset>
          </div>

          <p className="meta">Shared items stay in this project. The other project sees them and can import its own copy.</p>

          {saved.canEdit && (
            <div className="project-share-actions">
              <button type="button" className="btn btn-primary" onClick={props.onSave} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              {message && <span className="meta">{message}</span>}
            </div>
          )}
          {error && <p className="meta project-share-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

const EMPTY: ShareState = { types: [], targets: [], projects: [], canEdit: false };

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

export default function ProjectSharePanel() {
  const [projectId, setProjectId] = useState(() => sessionProjectId());
  // Bumped on every open, so reopening the same project still re-reads it.
  const [opened, setOpened] = useState(0);
  const [saved, setSaved] = useState<ShareState>(EMPTY);
  const [types, setTypes] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onOpened = (event: Event) => {
      const id = String((event as CustomEvent)?.detail?.projectId || '').trim();
      if (!id) return;
      setProjectId(id);
      setOpened((n) => n + 1);
    };
    document.addEventListener(PROJECT_EDITOR_OPENED_EVENT, onOpened);
    return () => document.removeEventListener(PROJECT_EDITOR_OPENED_EVENT, onOpened);
  }, []);

  const apply = useCallback((next: ShareState) => {
    setSaved(next);
    setTypes(next.types);
    // A target that is no longer one of the caller's projects cannot be
    // shown as a tick, so it is not carried into the next save either.
    setTargets(next.targets.filter((id) => next.projects.some((p) => p.id === id)));
  }, []);

  const load = useCallback(async (id: string) => {
    const app = getApp();
    if (!id) return;
    if (typeof app?.api !== 'function') {
      setError('The admin app has not finished loading. Reload the page and try again.');
      return;
    }
    setError('');
    try {
      const body = await app.api(`/api/projects/${encodeURIComponent(id)}/shares`);
      apply(readShareState(body));
    } catch (err) {
      apply(EMPTY);
      setError(`Could not read this project's sharing: ${(err as Error)?.message || 'unknown error'}`);
    }
  }, [apply]);

  useEffect(() => {
    setMessage('');
    setOpen(false);
    apply(EMPTY);
    void load(projectId);
  }, [projectId, opened, load, apply]);

  const save = useCallback(async () => {
    const app = getApp();
    if (typeof app?.api !== 'function' || !projectId) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await app.api(`/api/projects/${encodeURIComponent(projectId)}/shares`, {
        method: 'PUT',
        body: JSON.stringify({ types, targetProjectIds: targets }),
      });
      // Show what is stored, not what was sent.
      await load(projectId);
      setMessage('Saved.');
    } catch (err) {
      setError(`Sharing was not saved: ${(err as Error)?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }, [projectId, types, targets, load]);

  const dirty = !sameSet(types, saved.types) || !sameSet(targets, saved.targets);

  return (
    <ShareWithView
      saved={saved}
      types={types}
      targets={targets}
      open={open}
      saving={saving}
      dirty={dirty}
      message={dirty ? '' : message}
      error={error}
      onToggleOpen={() => setOpen((v) => !v)}
      onToggleType={(type) => setTypes((list) => toggle(list, type))}
      onToggleTarget={(id) => setTargets((list) => toggle(list, id))}
      onSave={save}
    />
  );
}
