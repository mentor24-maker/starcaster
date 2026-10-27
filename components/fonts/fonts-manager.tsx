import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Assets › Fonts — every font in the library, each name drawn in its own
 * lettering, with an Add Font form (Font Library 2/7, task 86bchyd41).
 *
 * A React island in the frozen vanilla app, mounted into #assetsFontsReactRoot
 * by react-entry.js, exactly like Footage. Data: /api/fonts (routes/fonts.js,
 * Font Library 1/7) — the shared library plus this project's own uploads.
 *
 * DRAWN FROM ITS OWN FILE. Each font is loaded through an @font-face rule
 * under a private name (`scfl-<id>`), never under its family name: a family
 * the operator happens to have installed would otherwise be drawn from his
 * own computer, and the row would look right while the uploaded file was
 * broken.
 *
 * THE LICENCE IS THE SERVER'S CALL. "Other / not sure" is sent like any other
 * choice and the server refuses it with lib/fontLicence.js's message, shown in
 * the form. Refusing it here would mean a second copy of that sentence, and
 * two copies of a rule drift.
 *
 * EMPTY IS ALWAYS EXPLAINED (CLAUDE.md landmine 17): an empty library, a read
 * that failed, and a library still loading are three different sentences.
 *
 * FAVOURITES (Font Library 8, task 86bchydpv). Each person stars fonts with
 * the ☆ at the start of a row; the switch above the table shows All fonts or
 * Favourites (N). The stars live on the server, per person
 * (PUT/DELETE /api/fonts/:id/favorite); which view is showing is remembered in
 * this browser only.
 *
 * Not here yet, by design: search and filters (7/7), tag editing (5/7), which
 * sites use a font (6/7 fills the Used by Sites column). When they land they
 * filter `shown`, which is already the Favourites-or-All list.
 */

const FONTS_PATH = '/api/fonts';

/** routes/fonts.js answers PROJECT_REQUIRED without one; the app announces a switch with this. */
export const PROJECT_SWITCH_EVENT = 'projectContext:session-changed';

/**
 * lib/fontUploadBody.js MAX_FILE_BYTES. Checked here as well because a body
 * over Vercel's 4.5 MB limit is refused before the server's own check can
 * run, with a bare error page instead of a sentence.
 */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export const EMPTY_LIBRARY_SENTENCE =
  'No fonts in the library yet. Add one, or ask CC to run the starter-pack import (Font Library 4/7).';

export const NO_FAVOURITES_SENTENCE =
  'You have no favourite fonts yet. Click the ☆ beside a font to add it.';

/** Where this browser remembers whether the Fonts screen shows All or Favourites. */
export const VIEW_STORAGE_KEY = 'starcaster.fonts.view';

export type FontsView = 'all' | 'favorites';

export function readStoredView(): FontsView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'favorites' ? 'favorites' : 'all';
  } catch {
    return 'all';
  }
}

function storeView(view: FontsView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Private browsing can refuse storage; the switch still works for this visit.
  }
}

/** The three licences lib/fontLicence.js accepts, plus the one it exists to refuse. */
export const LICENCE_OPTIONS: { value: string; label: string; short: string; url: string }[] = [
  { value: 'OFL-1.1', label: 'SIL Open Font License', short: 'OFL', url: 'https://openfontlicense.org/' },
  { value: 'Apache-2.0', label: 'Apache License 2.0', short: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  { value: 'public-domain', label: 'Public domain', short: 'Public domain', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  { value: 'other', label: 'Other / not sure', short: 'Other', url: '' },
];

/** lib/fontLicence.js CATEGORIES, in that order. */
export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans-serif' },
  { value: 'display', label: 'Display' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'handwriting', label: 'Handwriting' },
];

export type FontStyleFile = {
  weight: number;
  style: string;
  url: string;
  format: string;
};

export type FontRow = {
  id: string;
  family: string;
  category: string;
  styles: FontStyleFile[];
  licence: string;
  licenceText: string;
  sourceUrl: string;
  sourceName: string;
  tags: string[];
  visibility: 'platform' | 'project';
  /** Starred by the signed-in person (GET /api/fonts, Font Library 8). */
  isFavorite?: boolean;
};

type AppShape = {
  api?: (path: string, options?: RequestInit) => Promise<Record<string, any>>;
};

function getApp(): AppShape | null {
  return ((window as unknown as { App?: AppShape }).App) || null;
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

/** "Regular, Bold, Italic" — lightest first, upright before italic. */
export function stylesSentence(styles: FontStyleFile[]): string {
  const sorted = [...(styles || [])].sort((a, b) => (
    (a.weight - b.weight) || (a.style === 'italic' ? 1 : 0) - (b.style === 'italic' ? 1 : 0)
  ));
  const names = sorted.map((s) => {
    const weight = WEIGHT_NAMES[s.weight] || String(s.weight);
    if (s.style !== 'italic') return weight;
    return s.weight === 400 ? 'Italic' : `${weight} Italic`;
  });
  return names.length ? names.join(', ') : 'No files';
}

export function licenceInfo(licence: string): { short: string; url: string } {
  const found = LICENCE_OPTIONS.find((o) => o.value === licence);
  return found ? { short: found.short, url: found.url } : { short: licence || '—', url: '' };
}

export function categoryLabel(category: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === category)?.label || category || '—';
}

const CSS_FORMATS: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
};

/** The private name a font is drawn under on this screen. */
export function previewFamily(font: { id: string }): string {
  return `scfl-${String(font.id).replace(/[^A-Za-z0-9_-]/g, '')}`;
}

/**
 * One @font-face rule per file, under the private name. A URL is written
 * inside url("…"), so a quote or newline in it would end the rule early —
 * such a file is left out rather than escaped into something else.
 */
export function fontFaceCss(fonts: FontRow[]): string {
  const rules: string[] = [];
  for (const font of fonts) {
    for (const s of font.styles || []) {
      const url = String(s.url || '');
      if (!/^https?:\/\//i.test(url) || /["'\\\n\r]/.test(url)) continue;
      const format = CSS_FORMATS[String(s.format || '').toLowerCase()];
      const weight = Number.isFinite(Number(s.weight)) ? Number(s.weight) : 400;
      const style = s.style === 'italic' ? 'italic' : 'normal';
      rules.push(
        `@font-face { font-family: "${previewFamily(font)}"; src: url("${url}")${format ? ` format("${format}")` : ''}; `
        + `font-weight: ${weight}; font-style: ${style}; font-display: swap; }`,
      );
    }
  }
  return rules.join('\n');
}

/** The file's bytes as base64, which is how lib/fontUploadBody.js takes them. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error(`${file.name} could not be read from your computer.`));
    reader.readAsDataURL(file);
  });
}

function TrashIcon(): React.ReactElement {
  // App.ACTION_ICONS.trash (public/js/core.js) — the standard row delete icon (UI_RULES T5).
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

type FormState = {
  family: string;
  category: string;
  licence: string;
  sourceUrl: string;
};

const EMPTY_FORM: FormState = { family: '', category: 'sans', licence: 'OFL-1.1', sourceUrl: '' };

function AddFontForm({ onSaved, onCancel }: { onSaved: (font: FontRow) => void; onCancel: () => void }): React.ReactElement {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const save = async () => {
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_UPLOAD_BYTES) {
      setError(`The files add up to more than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Upload fewer files at a time.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const encoded = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readAsBase64(f) })));
      const body = await api(FONTS_PATH, {
        method: 'POST',
        body: JSON.stringify({
          family: form.family.trim(),
          category: form.category,
          licence: form.licence,
          sourceUrl: form.sourceUrl.trim(),
          sourceName: 'Upload',
          files: encoded,
        }),
      });
      if (!body?.ok) {
        setError(body?.error?.message || 'The font could not be saved.');
        return;
      }
      onSaved(body.data.font as FontRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The font could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="fonts-manager-form"
      aria-label="Add a font"
      onSubmit={(e) => { e.preventDefault(); void save(); }}
    >
      <h3 className="fonts-manager-form-title">Add Font</h3>
      <div className="fonts-manager-form-grid">
        <label className="fonts-manager-field">
          <span>Family name</span>
          <input type="text" name="family" value={form.family} onChange={set('family')} placeholder="Orbitron" required />
        </label>
        <label className="fonts-manager-field">
          <span>Category</span>
          <select name="category" value={form.category} onChange={set('category')}>
            {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="fonts-manager-field">
          <span>Licence</span>
          <select name="licence" value={form.licence} onChange={set('licence')}>
            {LICENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="fonts-manager-field">
          <span>Source link</span>
          <input
            type="url"
            name="sourceUrl"
            value={form.sourceUrl}
            onChange={set('sourceUrl')}
            placeholder="https://fonts.google.com/specimen/Orbitron"
          />
        </label>
        <label className="fonts-manager-field">
          <span>Files</span>
          <span className="fonts-manager-control">
            <input
              type="file"
              name="files"
              multiple
              accept=".woff2,.woff,.ttf,.otf"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            <small className="fonts-manager-help">
              One file per weight and style (.woff2, .woff, .ttf or .otf). The weight is read from the file name — "-Bold", "-Italic".
            </small>
          </span>
        </label>
      </div>
      {error ? <p className="fonts-manager-error" role="alert">{error}</p> : null}
      <div className="fonts-manager-actions">
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

export default function FontsManager(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [fonts, setFonts] = useState<FontRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState('');
  const [deleting, setDeleting] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<FontsView>(readStoredView);
  const [favoritesError, setFavoritesError] = useState('');
  const [starring, setStarring] = useState('');
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const body = await api(FONTS_PATH);
      if (seq !== requestSeq.current) return;
      if (!body?.ok) {
        setError(body?.error?.message || 'The font library could not be read.');
        setFonts(null);
      } else {
        setError('');
        setFavoritesError(String(body.data?.favoritesError || ''));
        setFonts((body.data?.fonts || []) as FontRow[]);
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : 'The font library could not be read.');
      setFonts(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

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

  // A project switch neither shows nor hides the page, so the old client's
  // own fonts would stay on screen under the new client's name.
  useEffect(() => {
    const onSwitch = () => {
      requestSeq.current += 1;
      setFonts(null);
      setError('');
      setNotice('');
      setConfirmingDelete('');
      setLoading(false);
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    };
    window.addEventListener(PROJECT_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, onSwitch);
  }, [load]);

  const faces = useMemo(() => fontFaceCss(fonts || []), [fonts]);
  const favoriteCount = useMemo(() => (fonts || []).filter((f) => f.isFavorite).length, [fonts]);
  const shown = useMemo(
    () => (view === 'favorites' ? (fonts || []).filter((f) => f.isFavorite) : (fonts || [])),
    [fonts, view],
  );

  const chooseView = (next: FontsView) => {
    setView(next);
    storeView(next);
  };

  // The star shows what the SERVER answered, not what was clicked, so a
  // refused write never leaves a ★ that will be gone after a reload.
  const toggleFavorite = async (font: FontRow) => {
    const api = getApp()?.api;
    if (typeof api !== 'function') return;
    setStarring(font.id);
    setNotice('');
    try {
      const body = await api(`${FONTS_PATH}/${encodeURIComponent(font.id)}/favorite`, {
        method: font.isFavorite ? 'DELETE' : 'PUT',
      });
      if (!body?.ok) {
        setNotice(body?.error?.message || `${font.family} could not be ${font.isFavorite ? 'removed from' : 'added to'} your favourites.`);
        return;
      }
      const isFavorite = Boolean(body.data?.isFavorite);
      setFonts((list) => (list || []).map((f) => (f.id === font.id ? { ...f, isFavorite } : f)));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `${font.family} could not be changed.`);
    } finally {
      setStarring('');
    }
  };

  const remove = async (font: FontRow) => {
    const api = getApp()?.api;
    if (typeof api !== 'function') return;
    setDeleting(font.id);
    setNotice('');
    try {
      const body = await api(`${FONTS_PATH}/${encodeURIComponent(font.id)}`, { method: 'DELETE' });
      if (!body?.ok) {
        setNotice(body?.error?.message || `${font.family} could not be deleted.`);
        return;
      }
      const left = Array.isArray(body.data?.filesNotRemoved) ? body.data.filesNotRemoved.length : 0;
      setNotice(left
        ? `${font.family} was deleted, but ${left} of its files could not be removed from storage.`
        : `${font.family} was deleted.`);
      setFonts((list) => (list || []).filter((f) => f.id !== font.id));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `${font.family} could not be deleted.`);
    } finally {
      setDeleting('');
      setConfirmingDelete('');
    }
  };

  let status = '';
  if (error) status = error;
  else if (!fonts && loading) status = 'Reading the font library…';
  else if (fonts && !fonts.length) status = EMPTY_LIBRARY_SENTENCE;
  else if (fonts && view === 'favorites' && !shown.length) status = favoritesError || NO_FAVOURITES_SENTENCE;

  return (
    <div ref={hostRef} className="fonts-manager">
      {faces ? <style data-fonts-manager-faces="">{faces}</style> : null}
      <div className="fonts-manager-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => { setAdding(true); setNotice(''); }} disabled={adding}>
          Add Font
        </button>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>Refresh</button>
      </div>

      {adding ? (
        <AddFontForm
          onCancel={() => setAdding(false)}
          onSaved={(font) => {
            setAdding(false);
            setNotice(`${font.family} was added to the library.`);
            setFonts((list) => [...(list || []), font].sort((a, b) => a.family.localeCompare(b.family)));
          }}
        />
      ) : null}

      {fonts && fonts.length ? (
        <div className="fonts-manager-view-switch" role="group" aria-label="Which fonts to show">
          <button
            type="button"
            className={`btn${view === 'all' ? ' btn-primary' : ''}`}
            aria-pressed={view === 'all'}
            onClick={() => chooseView('all')}
          >
            All fonts
          </button>
          <button
            type="button"
            className={`btn${view === 'favorites' ? ' btn-primary' : ''}`}
            aria-pressed={view === 'favorites'}
            onClick={() => chooseView('favorites')}
          >
            Favourites ({favoriteCount})
          </button>
        </div>
      ) : null}

      {notice ? <p className="fonts-manager-notice" role="status">{notice}</p> : null}
      {favoritesError && !(view === 'favorites' && !shown.length) ? (
        <p className="fonts-manager-error" role="alert">{favoritesError}</p>
      ) : null}
      {status ? <p className={error ? 'fonts-manager-error' : 'fonts-manager-empty'} role={error ? 'alert' : undefined}>{status}</p> : null}

      {shown.length ? (
        <div className="table-wrap fonts-manager-table-wrap">
          <table className="fonts-manager-table">
            <thead>
              <tr>
                <th scope="col" className="fonts-manager-star-col" title="Favourite" aria-label="Favourite">★</th>
                <th scope="col">Font</th>
                <th scope="col">Category</th>
                <th scope="col">Styles</th>
                <th scope="col">Licence</th>
                <th scope="col">Source</th>
                <th scope="col">Tags</th>
                <th scope="col" title="Which sites use each font. Not tracked yet — Font Library 6/7 fills this in.">Used by Sites</th>
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((font) => {
                const licence = licenceInfo(font.licence);
                const shared = font.visibility === 'platform';
                return (
                  <tr key={font.id} data-font-id={font.id}>
                    <td className="fonts-manager-star-col">
                      <button
                        type="button"
                        className={`fonts-manager-star${font.isFavorite ? ' is-favorite' : ''}`}
                        aria-pressed={Boolean(font.isFavorite)}
                        aria-label={font.isFavorite ? `Remove ${font.family} from favourites` : `Add ${font.family} to favourites`}
                        title={font.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
                        disabled={starring === font.id}
                        onClick={() => void toggleFavorite(font)}
                      >
                        {font.isFavorite ? '★' : '☆'}
                      </button>
                    </td>
                    <td className="fonts-manager-name-cell">
                      <span className="fonts-manager-preview" style={{ fontFamily: `"${previewFamily(font)}", var(--font-body, sans-serif)` }}>
                        {font.family}
                      </span>
                      <span className="fonts-manager-scope">{shared ? 'Shared library' : 'This project'}</span>
                    </td>
                    <td>{categoryLabel(font.category)}</td>
                    <td>{stylesSentence(font.styles)}</td>
                    <td>
                      {licence.url ? (
                        <a href={licence.url} target="_blank" rel="noopener noreferrer" title={font.licence}>{licence.short}</a>
                      ) : licence.short}
                    </td>
                    <td>
                      {font.sourceUrl ? (
                        <a href={font.sourceUrl} target="_blank" rel="noopener noreferrer" className="fonts-manager-source">
                          {font.sourceName || font.sourceUrl}
                        </a>
                      ) : (font.sourceName || '—')}
                    </td>
                    <td>
                      {font.tags.length ? (
                        <span className="fonts-manager-chips">
                          {font.tags.map((t) => <span key={t} className="fonts-manager-chip">{t}</span>)}
                        </span>
                      ) : '—'}
                    </td>
                    <td />
                    <td className="actions-col">
                      {shared ? null : confirmingDelete === font.id ? (
                        <div className="table-actions-row fonts-manager-confirm">
                          <span>Delete {font.family}?</span>
                          <button type="button" className="btn btn-danger tiny-btn" disabled={deleting === font.id} onClick={() => void remove(font)}>
                            {deleting === font.id ? 'Deleting…' : 'Delete'}
                          </button>
                          <button type="button" className="btn tiny-btn" disabled={deleting === font.id} onClick={() => setConfirmingDelete('')}>Cancel</button>
                        </div>
                      ) : (
                        <div className="table-actions-row">
                          <button
                            type="button"
                            className="tiny-btn icon-btn icon-btn-danger"
                            title={`Delete ${font.family}`}
                            aria-label={`Delete ${font.family}`}
                            onClick={() => setConfirmingDelete(font.id)}
                          >
                            <span className="icon-btn-glyph"><TrashIcon /></span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
