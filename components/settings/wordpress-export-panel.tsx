import React, { useCallback, useState } from 'react';

/**
 * Settings › Projects › (a project) › Import / Export: a way into Site Import,
 * and the Export to WordPress (Divi) download, as a .xml (WordPress Importer)
 * or a .wpress (All-in-One WP Migration; lib/wpressExport.js). One card in the right column
 * under Modules (Dane, 2026-10-05: "Put them in the right column below the
 * modules section.").
 *
 * A React island inside the frozen vanilla project-detail screen, mounted into
 * #wordpressExportReactRoot by react-entry.js. Opening a project for editing
 * makes it the session's active project (settings.js openProjectEditor), so
 * the same X-Project-ID header App.api sends is the project on screen.
 *
 * The card mounts once, while the page is still hidden, and the operator can
 * open a different project later — so a summary remembers which project it
 * was read for and is thrown away when that is no longer the one on screen.
 *
 * The converting is lib/wordpressExport.js; the route is routes/siteExport.js.
 */

const SUMMARY_PATH = '/api/site-export/wordpress/summary';
const DOWNLOAD_PATH = '/api/site-export/wordpress/download';

type ModuleNote = { where: string; module: string; type: string; reason: string };

export type ExportReport = {
  generatedAt: string;
  project: { name: string; slug: string };
  pages: Array<{ name: string; slug: string; status: string; sections: number; modules: number }>;
  pagesLeftOut: Array<{ name: string; slug: string; reason: string }>;
  posts: { exported: number; drafts: number };
  header: { sections: number; modules: number };
  footer: { sections: number; modules: number };
  menu: { items: number };
  images: number;
  notExported: ModuleNote[];
  changed: ModuleNote[];
  homePageSlug: string;
};

type Summary = { projectId: string; report: ExportReport; bytes: number };

export type ExportFormat = 'xml' | 'wpress';

function getApp(): any {
  return (window as unknown as { App?: any }).App;
}

function currentProjectId(): string {
  const app = getApp();
  return typeof app?.projectContext?.getSessionProjectId === 'function'
    ? String(app.projectContext.getSessionProjectId() || '').trim()
    : String(app?.state?.currentProjectId || '').trim();
}

/** The two headers App.api sends — the download is a file, not JSON, so it
 *  is fetched directly and needs them spelled out. */
function requestHeaders(): Record<string, string> {
  const app = getApp();
  const headers: Record<string, string> = {};
  const projectId = currentProjectId();
  if (projectId) headers['X-Project-ID'] = projectId;
  const token = typeof app?.getSessionToken === 'function' ? String(app.getSessionToken() || '').trim() : '';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function filenameFrom(disposition: string | null, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(String(disposition || ''));
  return match ? match[1] : fallback;
}

function NoteList({ title, notes }: { title: string; notes: ModuleNote[] }) {
  if (!notes.length) return null;
  return (
    <div className="wp-export-notes">
      <p className="wp-export-subheading">{title}</p>
      <ul>
        {notes.map((n, i) => (
          <li key={`${n.where}-${n.module}-${i}`}>
            <strong>{n.where}</strong> — {n.module}: {n.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the file will hold. Pure, so the wording is testable without a
 *  browser (wordpress-export-panel.test.tsx). */
export function ExportSummary({ report, bytes, format = 'xml' }: { report: ExportReport; bytes: number; format?: ExportFormat }) {
  const publishedPages = report.pages.filter((p) => p.status === 'publish').length;
  const draftPages = report.pages.length - publishedPages;
  return (
    <div className="wp-export-summary">
      <ul className="wp-export-counts">
        <li>
          {plural(report.pages.length, 'page')}
          {draftPages ? ` (${draftPages} as drafts, because they are unpublished here)` : ''}
        </li>
        <li>
          {plural(report.posts.exported, 'blog post')}
          {report.posts.drafts ? `, plus ${plural(report.posts.drafts, 'draft')}` : ''}
        </li>
        <li>{plural(report.images, 'image')}</li>
        <li>
          {report.header.sections
            ? `Header: ${plural(report.header.sections, 'section')}`
            : 'No header — this site has no shared header section'}
          {' · '}
          {report.footer.sections
            ? `Footer: ${plural(report.footer.sections, 'section')}`
            : 'no shared footer section'}
        </li>
        <li>{report.menu.items ? `Main menu: ${plural(report.menu.items, 'link')}` : 'No menu found on this site'}</li>
        {format === 'xml' ? (
          <li>File size: {formatSize(bytes)}</li>
        ) : (
          <li>
            File size: much larger than the .xml — the .wpress carries all {plural(report.images, 'image')} inside
            it, so expect tens of megabytes and a few minutes to prepare
          </li>
        )}
      </ul>

      {report.pagesLeftOut.length > 0 && (
        <p className="meta">
          Left out on purpose: {report.pagesLeftOut.map((p) => `${p.name} (${p.reason})`).join(', ')}.
        </p>
      )}

      <NoteList title="Changed on the way" notes={report.changed} />
      <NoteList title="Not exported — these have no Divi equivalent and need rebuilding by hand" notes={report.notExported} />
      {!report.notExported.length && (
        <p className="meta">Every module on every page has a Divi equivalent — nothing is left behind.</p>
      )}
    </div>
  );
}

/** The steps for whichever file was chosen. Pure, so it is testable. */
export function HowToLoad({ format, homePageSlug }: { format: ExportFormat; homePageSlug: string }) {
  const homeName = homePageSlug === 'home' ? 'Home' : 'your home page';
  if (format === 'wpress') {
    return (
      <details className="wp-export-howto">
        <summary>How to load the .wpress file into WordPress</summary>
        <ol>
          <li>Install the <strong>Divi</strong> theme (Appearance → Themes) <em>before</em> importing. The file switches the site to Divi but cannot carry the theme itself.</li>
          <li>Install the <strong>All-in-One WP Migration</strong> plugin (Plugins → Add New Plugin, search for it, Install, Activate).</li>
          <li>Go to <strong>All-in-One WP Migration → Import</strong>, choose <strong>Import From → File</strong> and pick the downloaded .wpress.</li>
          <li>Click <strong>Proceed</strong>. This <strong>replaces the site&apos;s pages, posts, menus and comments</strong> with this project&apos;s. WordPress logins and settings are kept, so you stay signed in.</li>
          <li>When it finishes, go to <strong>Settings → Permalinks</strong> and click <strong>Save Changes</strong> once, so links like /about work straight away.</li>
          <li>Open <strong>Divi → Theme Builder</strong> and check the default website template shows &ldquo;StarCaster Header&rdquo; and &ldquo;StarCaster Footer&rdquo;.</li>
        </ol>
        <p className="meta">
          The home page ({homeName}), the main menu and Post-name links are already set by the file — no other settings to change.
          If WordPress says the file is too big, the web host&apos;s upload limit is lower than the file; ask the host to raise it, or use the .xml instead.
        </p>
      </details>
    );
  }
  return (
    <details className="wp-export-howto">
      <summary>How to load the .xml file into WordPress</summary>
      <ol>
        <li>Install the <strong>Divi</strong> theme and activate it (Appearance → Themes) <em>before</em> importing — WordPress skips the Divi parts of the file otherwise.</li>
        <li>Go to <strong>Tools → Import → WordPress</strong>. If it says &ldquo;Install Now&rdquo;, click it, then &ldquo;Run Importer&rdquo;.</li>
        <li>Choose the downloaded file and click <strong>Upload file and import</strong>.</li>
        <li>Pick which WordPress user the content belongs to, and tick <strong>Download and import file attachments</strong> — that box is what brings the images across.</li>
        <li>Go to <strong>Appearance → Menus</strong>, choose &ldquo;Main Menu&rdquo;, tick <strong>Primary Menu</strong> and save.</li>
        <li>Go to <strong>Settings → Reading</strong>, choose &ldquo;A static page&rdquo; and set the homepage to <strong>{homeName}</strong>.</li>
        <li>Go to <strong>Settings → Permalinks</strong> and choose &ldquo;Post name&rdquo;, so links like /about keep working.</li>
        <li>Open <strong>Divi → Theme Builder</strong> and check the default website template shows &ldquo;StarCaster Header&rdquo; and &ldquo;StarCaster Footer&rdquo;. If it does not, add them from the Divi Library, where copies are saved under the same names.</li>
      </ol>
    </details>
  );
}

export default function WordPressExportPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState('');
  const [format, setFormat] = useState<ExportFormat>('xml');
  const [received, setReceived] = useState(0);

  // A summary for a project that is no longer on screen is not shown.
  const visible = summary && summary.projectId === currentProjectId() ? summary : null;

  const check = useCallback(async () => {
    const app = getApp();
    if (typeof app?.api !== 'function') {
      setError('The admin app has not finished loading. Reload the page and try again.');
      return;
    }
    const projectId = currentProjectId();
    setChecking(true);
    setError('');
    setDownloaded('');
    try {
      const body = await app.api(SUMMARY_PATH);
      const data = body?.data ?? body;
      if (!data?.report) throw new Error('The server answered without an export summary.');
      setSummary({ projectId, report: data.report, bytes: Number(data.bytes) || 0 });
    } catch (err) {
      setSummary(null);
      setError(`Could not read this project's site: ${(err as Error)?.message || 'unknown error'}`);
    } finally {
      setChecking(false);
    }
  }, []);

  const download = useCallback(async () => {
    setDownloading(true);
    setError('');
    setDownloaded('');
    setReceived(0);
    try {
      const res = await fetch(`${DOWNLOAD_PATH}?format=${format}`, { headers: requestHeaders(), credentials: 'include' });
      if (!res.ok) {
        let message = `the server answered ${res.status}`;
        try {
          const body = await res.json();
          message = body?.error?.message || message;
        } catch { /* not JSON — keep the status */ }
        throw new Error(message);
      }
      // Read it piece by piece so a .wpress, which takes minutes, can show
      // how far it has got rather than sitting on "Preparing file…".
      const parts: BlobPart[] = [];
      if (res.body) {
        const reader = res.body.getReader();
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          total += value.length;
          setReceived(total);
        }
      } else {
        parts.push(await res.blob());
      }
      const blob = new Blob(parts);
      const name = filenameFrom(res.headers.get('content-disposition'), `wordpress-divi-export.${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDownloaded(name);
    } catch (err) {
      setError(`The download did not finish: ${(err as Error)?.message || 'unknown error'}`);
    } finally {
      setDownloading(false);
    }
  }, [format]);

  const report = visible?.report;

  // Site Import is its own screen (Builder › Site Import); it works on the
  // active project, which opening this project for editing already set.
  const openSiteImport = useCallback(() => {
    const app = getApp();
    if (typeof app?.builder?.openSiteImportPage === 'function') app.builder.openSiteImportPage();
    else if (typeof app?.setActivePage === 'function') app.setActivePage('builderSiteImportPage');
    else setError('The admin app has not finished loading. Reload the page and try again.');
  }, []);

  return (
    <div className="card wp-export-card">
      <h3 className="project-details-section-heading">Import / Export</h3>

      <div className="import-export-part">
        <p className="import-export-part-title module-toggle-label">Import a website</p>
        <p className="meta">
          Bring an existing website — WordPress or any other — into this project&apos;s Builder as draft pages.
        </p>
        <div className="wp-export-actions">
          <button type="button" className="btn" onClick={openSiteImport}>Open Site Import</button>
        </div>
      </div>

      <div className="import-export-part">
        <p className="import-export-part-title module-toggle-label">Export to WordPress (Divi)</p>
        <p className="meta">
          Download this project&apos;s website as one file that WordPress can import. Pages are rebuilt
          with the Divi page builder, the header and footer go into Divi&apos;s Theme Builder, and blog
          posts, images and the main menu come along.
        </p>

        <fieldset className="wp-export-formats" disabled={downloading}>
          <legend className="meta">File type</legend>
          <label>
            <input type="radio" name="wpExportFormat" value="xml" checked={format === 'xml'} onChange={() => setFormat('xml')} />
            <span><strong>.xml</strong> — for WordPress&apos;s built-in importer (Tools → Import). Adds to the site; images are fetched during the import.</span>
          </label>
          <label>
            <input type="radio" name="wpExportFormat" value="wpress" checked={format === 'wpress'} onChange={() => setFormat('wpress')} />
            <span><strong>.wpress</strong> — for the All-in-One WP Migration plugin. Replaces the site&apos;s pages and posts, carries every image inside the file, and sets the home page, menu and links for you.</span>
          </label>
        </fieldset>

        <div className="wp-export-actions">
          <button type="button" className="btn" onClick={check} disabled={checking || downloading}>
            {checking ? 'Checking…' : report ? 'Check again' : 'Check what will be exported'}
          </button>
          <button type="button" className="btn btn-primary" onClick={download} disabled={checking || downloading}>
            {downloading
              ? (received ? `Downloading… ${formatSize(received)}` : 'Preparing file…')
              : `Download .${format} file`}
          </button>
        </div>

        {error && <p className="meta wp-export-error" role="alert">{error}</p>}
        {downloaded && <p className="meta">Downloaded <strong>{downloaded}</strong>. The steps below load it into WordPress.</p>}

        {downloading && format === 'wpress' && (
          <p className="meta">Packing every image into the file — this takes a few minutes for a large site. Keep this page open.</p>
        )}
        {report && <ExportSummary report={report} bytes={visible?.bytes || 0} format={format} />}

        <HowToLoad format={format} homePageSlug={report?.homePageSlug || ''} />
      </div>
    </div>
  );
}
