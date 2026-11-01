import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Settings › Projects › (a project) › Share with: which of this project's
 * Builder libraries other projects may see, and which projects. Two checkbox
 * lists; every ticked type is shared with every ticked project (Dane's design,
 * 2026-10-28, task 86bcu6thw). Nothing is copied here — the receiving project
 * imports its own copy from each library (separate tickets).
 *
 * Specific website pages are picked from a multi-select dropdown under the
 * types, and go to the same ticked projects (task 86bcw3m94). The receiving
 * project imports them from the Pages screen's "Shared by Project" button.
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
export type SharePage = { id: string; name: string; slug: string };

export type ShareState = {
  types: string[];
  targets: string[];
  pageIds: string[];
  projects: ShareProject[];
  /** This project's own pages: the only ones it can share. */
  pages: SharePage[];
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
  const pages = Array.isArray(data.pages)
    ? data.pages
      .map((p: any) => ({ id: String(p?.id || '').trim(), name: String(p?.name || '').trim(), slug: String(p?.slug || '').trim() }))
      .filter((p: SharePage) => p.id)
    : [];
  return {
    types: textList(data.types),
    targets: textList(data.targets),
    pageIds: textList(data.pageIds),
    projects,
    pages,
    canEdit: data.canEdit === true,
  };
}

function pageCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'page' : 'pages'}`;
}

/** The collapsed header's one line. Only targets that are still one of the
 *  caller's projects are counted, so the line agrees with the ticks below it;
 *  the same goes for pages that are still this project's. */
export function shareSummaryLine(types: string[], targetCount: number, pageCount = 0): string {
  const labels: string[] = SHARE_TYPES.filter((t) => types.includes(t.type)).map((t) => t.label);
  if (pageCount > 0) labels.push(pageCountLabel(pageCount));
  if (!labels.length || targetCount < 1) return 'Not shared with any project';
  return `${labels.join(', ')} → ${targetCount} ${targetCount === 1 ? 'project' : 'projects'}`;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** What the closed dropdown says: the one page by name, otherwise a count. */
export function pagePickerLabel(pages: SharePage[], selected: string[]): string {
  const picked = pages.filter((p) => selected.includes(p.id));
  if (picked.length === 0) return 'Choose pages';
  if (picked.length === 1) return picked[0].name || 'Untitled page';
  return `${pageCountLabel(picked.length)} selected`;
}

function pageAddress(page: SharePage): string {
  return page.slug ? `/${page.slug}` : '/ (home page)';
}

/**
 * The multi-select dropdown of this project's pages. Closed, it is one button
 * naming what is picked; open, a filter box over a checkbox per page. Starts
 * open only in tests, through `initiallyOpen`.
 */
export function SharePagePicker({
  pages,
  selected,
  disabled,
  initiallyOpen = false,
  onToggle,
}: {
  pages: SharePage[];
  selected: string[];
  disabled?: boolean;
  initiallyOpen?: boolean;
  onToggle?: (id: string) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [filter, setFilter] = useState('');
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (pages.length === 0) return <p className="meta">This project has no pages to share yet.</p>;

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? pages.filter((p) => p.name.toLowerCase().includes(needle) || p.slug.toLowerCase().includes(needle))
    : pages;

  return (
    <div className="project-share-pages" ref={root}>
      <button
        type="button"
        className="project-share-pages-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="project-share-pages-label">{pagePickerLabel(pages, selected)}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && !disabled && (
        <div className="project-share-pages-menu" role="listbox" aria-multiselectable="true" aria-label="Pages to share">
          {pages.length > 8 && (
            <input
              type="search"
              className="project-share-pages-filter"
              placeholder="Find a page"
              aria-label="Find a page"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          {shown.length === 0 ? (
            <p className="meta">No page matches "{filter.trim()}".</p>
          ) : (
            shown.map((p) => (
              <label key={p.id} className="project-share-option" role="option" aria-selected={selected.includes(p.id)}>
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => onToggle?.(p.id)} />
                <span>
                  {p.name || 'Untitled page'} <span className="meta">{pageAddress(p)}</span>
                </span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

type ViewProps = {
  saved: ShareState;
  types: string[];
  targets: string[];
  pageIds?: string[];
  open: boolean;
  /** Tests only: render the pages dropdown already open. */
  pagesOpen?: boolean;
  saving?: boolean;
  dirty?: boolean;
  message?: string;
  error?: string;
  /** The read itself failed: nothing below is known, so nothing is claimed. */
  loadError?: string;
  onToggleOpen?: () => void;
  onToggleType?: (type: string) => void;
  onToggleTarget?: (id: string) => void;
  onTogglePage?: (id: string) => void;
  onSave?: () => void;
};

/** The card, from props alone, so every sentence on it is testable without a
 *  browser (project-share-panel.test.tsx). */
export function ShareWithView(props: ViewProps) {
  const { saved, types, targets, open, saving, dirty, message, error, loadError } = props;
  const pageIds = props.pageIds ?? saved.pageIds;
  const savedTargetCount = saved.targets.filter((id) => saved.projects.some((p) => p.id === id)).length;
  const savedPageCount = saved.pageIds.filter((id) => saved.pages.some((p) => p.id === id)).length;
  // A failed read is not an empty answer. Showing EMPTY's sentences here told
  // an owner of thirteen projects "You have no other projects to share with"
  // and "Only a project owner can change sharing" (2026-10-30, task 86bcvk7uf).
  const summary = loadError ? 'Could not read sharing settings' : shareSummaryLine(saved.types, savedTargetCount, savedPageCount);
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

      {open && loadError && (
        <div className="project-share-body">
          <p className="meta project-share-error" role="alert">{loadError}</p>
        </div>
      )}

      {open && !loadError && (
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
              <div className="project-share-pages-row">
                <span className="module-toggle-label">Pages</span>
                <SharePagePicker
                  pages={saved.pages}
                  selected={pageIds}
                  disabled={locked}
                  initiallyOpen={props.pagesOpen}
                  onToggle={props.onTogglePage}
                />
              </div>
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

const EMPTY: ShareState = { types: [], targets: [], pageIds: [], projects: [], pages: [], canEdit: false };

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
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

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
    // Same for a page that has since been deleted from this project.
    setPageIds(next.pageIds.filter((id) => next.pages.some((p) => p.id === id)));
  }, []);

  const load = useCallback(async (id: string) => {
    const app = getApp();
    if (!id) return;
    if (typeof app?.api !== 'function') {
      setLoadError('The admin app has not finished loading. Reload the page and try again.');
      return;
    }
    setError('');
    setLoadError('');
    try {
      const body = await app.api(`/api/projects/${encodeURIComponent(id)}/shares`);
      apply(readShareState(body));
    } catch (err) {
      apply(EMPTY);
      setLoadError(`Could not read this project's sharing: ${(err as Error)?.message || 'unknown error'}`);
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
        body: JSON.stringify({ types, targetProjectIds: targets, pageIds }),
      });
      // Show what is stored, not what was sent.
      await load(projectId);
      setMessage('Saved.');
    } catch (err) {
      setError(`Sharing was not saved: ${(err as Error)?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }, [projectId, types, targets, pageIds, load]);

  const dirty = !sameSet(types, saved.types) || !sameSet(targets, saved.targets) || !sameSet(pageIds, saved.pageIds);

  return (
    <ShareWithView
      saved={saved}
      types={types}
      targets={targets}
      pageIds={pageIds}
      open={open}
      saving={saving}
      dirty={dirty}
      message={dirty ? '' : message}
      error={error}
      loadError={loadError}
      onToggleOpen={() => setOpen((v) => !v)}
      onToggleType={(type) => setTypes((list) => toggle(list, type))}
      onToggleTarget={(id) => setTargets((list) => toggle(list, id))}
      onTogglePage={(id) => setPageIds((list) => toggle(list, id))}
      onSave={save}
    />
  );
}
