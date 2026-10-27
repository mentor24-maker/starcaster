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
 * Favourites (N), where N is every font this person has starred. The stars
 * live on the server, per person (PUT/DELETE /api/fonts/:id/favorite); which
 * view is showing is remembered in this browser only. Favourites is the list
 * the search, category and tag filters then narrow, so Favourites + Display
 * shows only starred display fonts, and the count line says "2 of 3 favourite
 * fonts" rather than counting the whole library.
 *
 * FINDING A FONT IN HUNDREDS (7/7, task 86bchyd4v): a search box over the
 * family name and tags, category buttons, and a Sample text box whose words
 * replace every row's sample line, at a size the slider sets. A filter that
 * matches nothing names the filter ("No display fonts match 'orbit'").
 *
 * ONLY ROWS ON SCREEN DOWNLOAD THEIR FONT. A browser fetches a font file for
 * any element in the page that is set in it, scrolled into view or not, so a
 * 300-row table would fetch 300 fonts on open. The @font-face rules are
 * therefore written only for rows that have come within reach of the screen
 * (IntersectionObserver); a row never seen has no rule, so nothing to fetch.
 *
 * The search box, the category buttons and the Tag box all apply at once: a
 * font is listed only if it passes every one of them.
 *
 * USED BY SITES (6/7) IS READ ON DEMAND. Each row asks
 * GET /api/fonts/:id/usage only when its "Show sites" button is pressed. One
 * answer reads every published page it may list, so asking for every row on
 * screen load would make the screen slower the more sites and fonts there are.
 *
 * TAGS (Font Library 5/7, task 86bchyd4k). Every tag is a chip; clicking one
 * filters the list to fonts carrying it, and the Tag box above the table takes
 * several ("sci-fi, wide" = must have both). A project's own fonts also get an
 * × per chip and a "+ tag" box; shared-library fonts get neither, because the
 * server refuses to change them (routes/fonts.js) and offering a button that
 * always fails is worse than not offering it. The AI's tags arrive on upload.
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

export const NOT_USED_SENTENCE = 'Not used on any published page yet.';

export type FontUsagePage = { id: string; name: string; slug: string; url: string };
export type FontUsageSite = { projectId: string; name: string; url: string; pages: FontUsagePage[] };
export type FontUsage = { sites: FontUsageSite[]; totalPages: number; truncated: boolean };

/** "Strands (3 pages)" */
export function siteUsageLabel(site: FontUsageSite): string {
  const n = site.pages.length;
  return `${site.name} (${n} ${n === 1 ? 'page' : 'pages'})`;
}

/**
 * "Sci-Fi,  wide , sci-fi" → ["sci-fi", "wide"]: trimmed, lowercased, inner
 * spaces collapsed, duplicates dropped — what lib/fontsStore.js cleanTags
 * stores, so a typed filter matches the saved tag.
 */
export function parseTagList(text: string): string[] {
  const out: string[] = [];
  for (const part of String(text || '').split(',')) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, ' ');
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Fonts carrying EVERY one of these tags; no tags means every font. */
export function filterByTags<T extends { tags: string[] }>(fonts: T[], tags: string[]): T[] {
  if (!tags.length) return fonts;
  return fonts.filter((f) => tags.every((t) => (f.tags || []).includes(t)));
}

export function noTagMatchSentence(tags: string[]): string {
  return `No fonts tagged '${tags.join(', ')}'.`;
}

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

/** Each row's sample line when neither the Sample box nor the font says otherwise. */
export const DEFAULT_SAMPLE = 'The quick brown fox jumps over the lazy dog';

export const SAMPLE_SIZE_MIN = 16;
export const SAMPLE_SIZE_MAX = 72;
export const SAMPLE_SIZE_DEFAULT = 32;

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
  previewText?: string;
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

/** The category buttons above the table, in the order the ticket names them. */
export const FILTER_CATEGORIES: { value: string; label: string; noun: string }[] = [
  { value: '', label: 'All', noun: '' },
  { value: 'sans', label: 'Sans', noun: 'sans-serif' },
  { value: 'serif', label: 'Serif', noun: 'serif' },
  { value: 'display', label: 'Display', noun: 'display' },
  { value: 'monospace', label: 'Monospace', noun: 'monospace' },
  { value: 'handwriting', label: 'Handwriting', noun: 'handwriting' },
];

/** Case-insensitive match on the family name and, where a font has them, its tags. */
export function filterFonts(fonts: FontRow[], query: string, category: string): FontRow[] {
  const q = query.trim().toLowerCase();
  return fonts.filter((f) => {
    if (category && f.category !== category) return false;
    if (!q) return true;
    if (String(f.family || '').toLowerCase().includes(q)) return true;
    return (f.tags || []).some((t) => String(t).toLowerCase().includes(q));
  });
}

/**
 * Why the table is empty when the library is not: every filter in force,
 * named — and, on the Favourites view, that it was the favourites searched
 * ("No favourite display fonts match 'orbit'.").
 */
export function noMatchSentence(query: string, category: string, tags: string[] = [], favourites = false): string {
  const q = query.trim();
  if (tags.length && !q && !category && !favourites) return noTagMatchSentence(tags);
  const noun = FILTER_CATEGORIES.find((c) => c.value === category)?.noun || category;
  let fonts = noun ? `${noun} fonts` : 'fonts';
  if (favourites) fonts = `favourite ${fonts}`;
  if (tags.length) fonts += ` tagged '${tags.join(', ')}'`;
  if (q) return `No ${fonts} match '${q}'.`;
  if (tags.length) return `No ${fonts}.`;
  return `No ${fonts} in the library yet.`;
}

/** The count beside Clear: what is listed, out of the list it was filtered from. */
export function countLine(shown: number, of: number, favourites: boolean): string {
  const noun = `${favourites ? 'favourite ' : ''}${of === 1 ? 'font' : 'fonts'}`;
  return shown === of ? `${of} ${noun}` : `${shown} of ${of} ${noun}`;
}

/** What a row's sample line says: the Sample box, else the font's own line, else the pangram. */
export function sampleLine(font: { previewText?: string }, typed: string): string {
  if (typed.trim()) return typed;
  return (font.previewText || '').trim() || DEFAULT_SAMPLE;
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

function EditIcon(): React.ReactElement {
  // App.ACTION_ICONS.edit (public/js/core.js).
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The Used by Sites cell for one font. Reads nothing until asked; then one
 * line per site ("Strands (3 pages)") that opens to its live pages, each in a
 * new tab. A site with no web address of its own lists its pages unlinked and
 * says why, rather than linking somewhere they are not.
 */
function UsedBySitesCell({ font }: { font: FontRow }): React.ReactElement {
  const [usage, setUsage] = useState<FontUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = async () => {
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = await api(`${FONTS_PATH}/${encodeURIComponent(font.id)}/usage`);
      if (!body?.ok) {
        setError(body?.error?.message || `Could not read which sites use ${font.family}.`);
        return;
      }
      setUsage(body.data as FontUsage);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not read which sites use ${font.family}.`);
    } finally {
      setBusy(false);
    }
  };

  if (!usage) {
    return (
      <span className="fonts-manager-usage">
        <button type="button" className="btn tiny-btn" disabled={busy} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Show sites'}
        </button>
        {error ? <span className="fonts-manager-error" role="alert">{error}</span> : null}
      </span>
    );
  }
  if (!usage.sites.length) {
    return <span className="fonts-manager-usage fonts-manager-usage-none">{NOT_USED_SENTENCE}</span>;
  }
  return (
    <span className="fonts-manager-usage">
      {usage.sites.map((site) => (
        <details key={site.projectId} className="fonts-manager-usage-site">
          <summary>{siteUsageLabel(site)}</summary>
          {site.url ? null : <small className="fonts-manager-help">This site has no web address set, so its pages cannot be linked.</small>}
          <ul className="fonts-manager-usage-pages">
            {site.pages.map((page) => (
              <li key={page.id}>
                {page.url ? (
                  <a href={page.url} target="_blank" rel="noopener noreferrer">{page.name}</a>
                ) : page.name}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {usage.truncated ? (
        <small className="fonts-manager-help">Only the first 5,000 published pages were checked.</small>
      ) : null}
    </span>
  );
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

function AddFontForm({ onSaved, onCancel }: {
  onSaved: (font: FontRow, autoTagError?: string) => void;
  onCancel: () => void;
}): React.ReactElement {
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
      onSaved(body.data.font as FontRow, body.data.autoTagError || undefined);
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

function TagCell({ font, editable, busy, onFilter, onSave }: {
  font: FontRow;
  editable: boolean;
  busy: boolean;
  onFilter: (tag: string) => void;
  onSave: (tags: string[]) => Promise<boolean>;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const add = async () => {
    const typed = parseTagList(draft);
    if (!typed.length) return;
    const next = [...font.tags, ...typed.filter((t) => !font.tags.includes(t))];
    if (await onSave(next)) setDraft('');
  };
  return (
    <span className="fonts-manager-chips">
      {font.tags.map((t) => (
        <span key={t} className="fonts-manager-chip">
          <button
            type="button"
            className="fonts-manager-chip-filter"
            title={`Show only fonts tagged "${t}"`}
            onClick={() => onFilter(t)}
          >
            {t}
          </button>
          {editable ? (
            <button
              type="button"
              className="fonts-manager-chip-remove"
              aria-label={`Remove tag ${t} from ${font.family}`}
              title={`Remove "${t}"`}
              disabled={busy}
              onClick={() => void onSave(font.tags.filter((x) => x !== t))}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {!font.tags.length && !editable ? '—' : null}
      {editable ? (
        <input
          type="text"
          className="fonts-manager-tag-input"
          aria-label={`Add tags to ${font.family}`}
          placeholder="+ tag"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
        />
      ) : null}
    </span>
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sample, setSample] = useState('');
  const [sampleSize, setSampleSize] = useState(SAMPLE_SIZE_DEFAULT);
  const [editingSample, setEditingSample] = useState('');
  const [sampleDraft, setSampleDraft] = useState('');
  const [savingSample, setSavingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');
  // Font ids whose row has come near the screen. null = no IntersectionObserver
  // here, so every row counts as seen (and every font loads, as before).
  const [seen, setSeen] = useState<Set<string> | null>(() => (
    typeof IntersectionObserver === 'undefined' ? null : new Set()
  ));
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [tagFilter, setTagFilter] = useState('');
  const [savingTags, setSavingTags] = useState('');
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

  const filterTags = useMemo(() => parseTagList(tagFilter), [tagFilter]);
  const favorites = useMemo(() => (fonts || []).filter((f) => f.isFavorite), [fonts]);
  const favoriteCount = favorites.length;
  // Favourites picks the list; search, category and tags narrow whichever it picked.
  const base = useMemo(() => (view === 'favorites' ? favorites : (fonts || [])), [view, favorites, fonts]);
  const shown = useMemo(
    () => filterByTags(filterFonts(base, query, category), filterTags),
    [base, query, category, filterTags],
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

  // Watch the rows that are in the table now; each one that comes within
  // 300px of the screen joins `seen` for good (scrolling back costs nothing).
  useEffect(() => {
    if (seen === null || typeof IntersectionObserver === 'undefined') return undefined;
    const body = tbodyRef.current;
    if (!body) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const ids = entries
        .filter((e) => e.isIntersecting)
        .map((e) => (e.target as HTMLElement).dataset.fontId || '')
        .filter(Boolean);
      if (!ids.length) return;
      setSeen((prev) => {
        if (!prev) return prev;
        if (ids.every((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }, { rootMargin: '300px 0px' });
    body.querySelectorAll<HTMLElement>('tr[data-font-id]').forEach((row) => {
      if (!seen.has(row.dataset.fontId || '')) observer.observe(row);
    });
    return () => observer.disconnect();
  }, [shown, seen]);

  const faces = useMemo(
    () => fontFaceCss((fonts || []).filter((f) => seen === null || seen.has(f.id))),
    [fonts, seen],
  );

  const filtered = Boolean(query.trim() || category || tagFilter || sample || sampleSize !== SAMPLE_SIZE_DEFAULT);
  const clearFilters = () => {
    setTagFilter('');
    setQuery('');
    setCategory('');
    setSample('');
    setSampleSize(SAMPLE_SIZE_DEFAULT);
  };

  const startSampleEdit = (font: FontRow) => {
    setEditingSample(font.id);
    setSampleDraft(font.previewText || '');
    setSampleError('');
    setConfirmingDelete('');
  };

  const saveSample = async (font: FontRow) => {
    const api = getApp()?.api;
    if (typeof api !== 'function') return;
    setSavingSample(true);
    setSampleError('');
    try {
      const body = await api(`${FONTS_PATH}/${encodeURIComponent(font.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ previewText: sampleDraft.trim() }),
      });
      if (!body?.ok) {
        setSampleError(body?.error?.message || `The sample line for ${font.family} could not be saved.`);
        return;
      }
      const saved = body.data?.font as FontRow | undefined;
      const previewText = saved ? (saved.previewText || '') : sampleDraft.trim();
      setFonts((list) => (list || []).map((f) => (f.id === font.id ? { ...f, previewText } : f)));
      setEditingSample('');
      setNotice(`${font.family}'s sample line was saved.`);
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : `The sample line for ${font.family} could not be saved.`);
    } finally {
      setSavingSample(false);
    }
  };

  /** Save a project font's whole tag list; the row shows what the server stored. */
  const saveTags = async (font: FontRow, tags: string[]): Promise<boolean> => {
    const api = getApp()?.api;
    if (typeof api !== 'function') return false;
    setSavingTags(font.id);
    setNotice('');
    try {
      const body = await api(`${FONTS_PATH}/${encodeURIComponent(font.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags }),
      });
      if (!body?.ok) {
        setNotice(body?.error?.message || `The tags on ${font.family} could not be saved.`);
        return false;
      }
      const saved = body.data.font as FontRow;
      setFonts((list) => (list || []).map((f) => (f.id === saved.id ? { ...f, tags: saved.tags } : f)));
      return true;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `The tags on ${font.family} could not be saved.`);
      return false;
    } finally {
      setSavingTags('');
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
  else if (fonts && view === 'favorites' && !favoriteCount) status = favoritesError || NO_FAVOURITES_SENTENCE;
  // Nothing starred at all is said once, above — not again as "no match".
  const noneStarred = view === 'favorites' && !favoriteCount;

  return (
    <div ref={hostRef} className="fonts-manager">
      {faces ? <style data-fonts-manager-faces="">{faces}</style> : null}
      <div className="fonts-manager-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => { setAdding(true); setNotice(''); }} disabled={adding}>
          Add Font
        </button>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>Refresh</button>
        {fonts && fonts.length ? (
          <label className="fonts-manager-tag-filter">
            <span>Tag</span>
            <input
              type="text"
              name="tagFilter"
              value={tagFilter}
              placeholder="sci-fi, wide"
              title="Show only fonts carrying every tag typed here, separated by commas"
              onChange={(e) => setTagFilter(e.target.value)}
            />
            {tagFilter ? (
              <button type="button" className="btn tiny-btn" onClick={() => setTagFilter('')}>Clear</button>
            ) : null}
          </label>
        ) : null}
      </div>

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
            title={`The ${favoriteCount} ${favoriteCount === 1 ? 'font' : 'fonts'} you have starred`}
            onClick={() => chooseView('favorites')}
          >
            Favourites ({favoriteCount})
          </button>
        </div>
      ) : null}

      {fonts && fonts.length ? (
        <div className="fonts-manager-filters" role="search" aria-label="Find a font">
          <div className="fonts-manager-filter-grid">
            <label className="fonts-manager-field">
              <span>Search</span>
              <input
                type="search"
                name="fontSearch"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Font name or tag"
              />
            </label>
            <div className="fonts-manager-field" role="group" aria-label="Category">
              <span>Category</span>
              <span className="fonts-manager-category-buttons">
                {FILTER_CATEGORIES.map((c) => (
                  <button
                    key={c.value || 'all'}
                    type="button"
                    className={`btn tiny-btn${category === c.value ? ' btn-primary' : ''}`}
                    aria-pressed={category === c.value}
                    onClick={() => setCategory(c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </span>
            </div>
            <label className="fonts-manager-field">
              <span>Sample text</span>
              <input
                type="text"
                name="sampleText"
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                placeholder="Type your own words"
              />
            </label>
            <label className="fonts-manager-field">
              <span>Size</span>
              <span className="fonts-manager-size">
                <input
                  type="range"
                  name="sampleSize"
                  min={SAMPLE_SIZE_MIN}
                  max={SAMPLE_SIZE_MAX}
                  step={1}
                  value={sampleSize}
                  onChange={(e) => setSampleSize(Number(e.target.value) || SAMPLE_SIZE_DEFAULT)}
                />
                <output className="fonts-manager-size-value">{sampleSize}px</output>
              </span>
            </label>
          </div>
          <div className="fonts-manager-actions">
            <button type="button" className="btn" onClick={clearFilters} disabled={!filtered}>Clear</button>
            <span className="fonts-manager-count" role="status">
              {countLine(shown.length, base.length, view === 'favorites')}
            </span>
          </div>
        </div>
      ) : null}

      {adding ? (
        <AddFontForm
          onCancel={() => setAdding(false)}
          onSaved={(font, autoTagError) => {
            setAdding(false);
            setNotice(autoTagError
              ? `${font.family} was added to the library, but it could not be tagged automatically (${autoTagError}). Add its tags by hand.`
              : `${font.family} was added to the library.`);
            setFonts((list) => [...(list || []), font].sort((a, b) => a.family.localeCompare(b.family)));
          }}
        />
      ) : null}

      {notice ? <p className="fonts-manager-notice" role="status">{notice}</p> : null}
      {favoritesError && !noneStarred ? (
        <p className="fonts-manager-error" role="alert">{favoritesError}</p>
      ) : null}
      {status ? <p className={error ? 'fonts-manager-error' : 'fonts-manager-empty'} role={error ? 'alert' : undefined}>{status}</p> : null}

      {fonts && fonts.length && !shown.length && !noneStarred ? (
        <p className="fonts-manager-empty">{noMatchSentence(query, category, filterTags, view === 'favorites')}</p>
      ) : null}

      {fonts && fonts.length && shown.length ? (
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
                <th scope="col" title="The published pages of every Starcaster site that use this font, directly or through their theme.">Used by Sites</th>
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {shown.map((font) => {
                const licence = licenceInfo(font.licence);
                const shared = font.visibility === 'platform';
                const family = `"${previewFamily(font)}", var(--font-body, sans-serif)`;
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
                      <span className="fonts-manager-preview" style={{ fontFamily: family }}>
                        {font.family}
                      </span>
                      {editingSample === font.id ? (
                        <form
                          className="fonts-manager-sample-edit"
                          aria-label={`Sample line for ${font.family}`}
                          onSubmit={(e) => { e.preventDefault(); void saveSample(font); }}
                        >
                          <input
                            type="text"
                            name="previewText"
                            value={sampleDraft}
                            maxLength={300}
                            onChange={(e) => setSampleDraft(e.target.value)}
                            placeholder={DEFAULT_SAMPLE}
                          />
                          <button type="submit" className="btn btn-primary tiny-btn" disabled={savingSample}>
                            {savingSample ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" className="btn tiny-btn" disabled={savingSample} onClick={() => setEditingSample('')}>Cancel</button>
                          {sampleError ? <span className="fonts-manager-error" role="alert">{sampleError}</span> : null}
                        </form>
                      ) : (
                        <span className="fonts-manager-sample" style={{ fontFamily: family, fontSize: `${sampleSize}px` }}>
                          {sampleLine(font, sample)}
                        </span>
                      )}
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
                      <TagCell
                        font={font}
                        editable={!shared}
                        busy={savingTags === font.id}
                        onFilter={(t) => setTagFilter(t)}
                        onSave={(tags) => saveTags(font, tags)}
                      />
                    </td>
                    <td><UsedBySitesCell font={font} /></td>
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
                            className="tiny-btn icon-btn"
                            title={`Edit ${font.family}'s sample line`}
                            aria-label={`Edit ${font.family}'s sample line`}
                            onClick={() => startSampleEdit(font)}
                          >
                            <span className="icon-btn-glyph"><EditIcon /></span>
                          </button>
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
