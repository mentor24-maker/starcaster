import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Assets › Footage — every video file the Studio pipeline has catalogued,
 * grouped by recording session, newest session first (Studio Phase 1 · 8/8).
 *
 * A React island in the frozen vanilla app, mounted into #studioFootageReactRoot
 * by react-entry.js. Read-only: the pipeline on the Mac Mini writes the
 * catalog, this screen only shows it. Data: GET /api/studio/footage.
 *
 * It (re)loads whenever its page is SHOWN, and whenever the project is
 * SWITCHED (the window event `projectContext:session-changed`). The island
 * mounts on DOMContentLoaded, before a project is necessarily chosen, and a
 * project switch neither reloads nor hides the page — so the show-hook alone
 * left the first client's footage on screen under the second's name (review
 * round 1, task 86bbjv68z). A reply that lands after a newer request was sent
 * is dropped, so a slow read for the old project cannot overwrite the new one.
 *
 * EMPTY IS ALWAYS EXPLAINED (CLAUDE.md landmine 17). "No footage yet", "no
 * file matches these filters" and "the read failed" are three different
 * screens, each saying which it is. The same goes for transcripts (Studio
 * Phase 2 · 5 of 6, 86bcdek0e): every file says which of its transcript
 * states it is in, in a sentence, and only a finished one has a button.
 */

const FOOTAGE_PATH = '/api/studio/footage';

type SourceRow = {
  id: string;
  lane: string;
  layerRole: string;
  durationS: number | null;
  width: number | null;
  height: number | null;
  state: string;
  date: string;
  dateSource: 'recorded' | 'session' | 'added' | 'none';
  hasDriveFile: boolean;
  /** The name it had in Drive; '' when not known (lib/studioFootage.js). */
  fileName: string;
  /** Drive's own player for the ORIGINAL; null when there is no Drive file. */
  driveUrl: string | null;
  /** lib/studioFootage.js transcriptStateFor. */
  transcript: TranscriptState;
};

type TranscriptState = {
  state: 'done' | 'failed' | 'no_audio' | 'plate' | 'not_yet' | 'unknown';
  reason: string;
};

type Segment = { start: number; end: number; text: string };

type Transcript = {
  sourceId: string;
  state: string;
  language: string;
  segments: Segment[];
};

type SessionGroup = {
  id: string;
  title: string;
  recordedAt: string;
  state: string;
  sources: SourceRow[];
};

type Footage = {
  totalSources: number;
  shownSources: number;
  undated: number;
  newestAddedAt: string;
  stateCounts: Record<string, number>;
  lanes: { lane: string; count: number }[];
  sessions: SessionGroup[];
  truncated: boolean;
  readLimit: number;
  /** Why the transcript states could not be read; '' when they were. */
  transcriptsError?: string;
};

type AppShape = {
  api?: (path: string, options?: RequestInit) => Promise<Record<string, any>>;
  getSessionToken?: () => string;
  projectContext?: { getSessionProjectId?: () => string };
  state?: { currentProjectId?: string };
};

function getApp(): AppShape | null {
  return ((window as unknown as { App?: AppShape }).App) || null;
}

/**
 * The same two headers App.api() sends. Thumbnails are images, so they are
 * fetched as blobs rather than JSON through App.api — and a bare <img src>
 * would carry neither the session (a bearer token here, not only a cookie)
 * nor the project, and would answer for whichever project the server
 * remembered instead of the one on screen.
 */
function requestHeaders(): Record<string, string> {
  const app = getApp();
  const headers: Record<string, string> = {};
  const projectId = typeof app?.projectContext?.getSessionProjectId === 'function'
    ? String(app.projectContext.getSessionProjectId() || '').trim()
    : String(app?.state?.currentProjectId || '').trim();
  if (projectId) headers['X-Project-ID'] = projectId;
  const token = typeof app?.getSessionToken === 'function' ? String(app.getSessionToken() || '').trim() : '';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

const LANE_LABELS: Record<string, string> = {
  unknown: 'Not known yet',
  iphone: 'iPhone',
  ipad: 'iPad',
  macbook: 'MacBook',
};

function laneLabel(lane: string): string {
  if (LANE_LABELS[lane]) return LANE_LABELS[lane];
  return lane.charAt(0).toUpperCase() + lane.slice(1);
}

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A segment's start as m:ss (h:mm:ss past an hour) — floored, so 0:59.9 is 0:59. */
export function timestamp(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function shortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fullDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** Which clock a file's date came from, said out loud (lib/studioFootage.js). */
const DATE_SOURCE_NOTE: Record<SourceRow['dateSource'], string> = {
  recorded: '',
  session: 'session date — this file has not been read for its own yet',
  added: 'date added to the catalog — no recording date known yet',
  none: '',
};

/** A picked calendar day as the first/last instant of that day, locally. */
function dayBoundary(day: string, end: boolean): string {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return '';
  const at = end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  return at.toISOString();
}

/** The window event public/js/projectContext.js emits on every project switch. */
export const PROJECT_SWITCH_EVENT = 'projectContext:session-changed';

/**
 * The file's preview, fetched only when its row scrolls into view. Anything
 * short of an image — no Drive file, no preview drawn yet, Drive unreachable —
 * shows the placeholder, never a broken-image icon.
 *
 * `attempt` is the panel's load generation. A preview that has not arrived is
 * asked for again each time it changes, which is what makes Refresh work:
 * docs/STUDIO.md tells the operator a Drive preview takes a few minutes after
 * an upload, so "wait, then Refresh" has to re-ask. Without it the failure was
 * remembered for the life of the row and Refresh sent no request at all. A
 * preview already on screen is kept, not fetched again.
 */
function Thumbnail({ source, attempt }: { source: SourceRow; attempt: number }): React.ReactElement {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);
  const loaded = url !== '';

  // The object URL lives exactly as long as it is the one on screen.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    if (!source.hasDriveFile || loaded) return undefined;
    const el = holder.current;
    if (!el) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/studio/sources/${encodeURIComponent(source.id)}/thumbnail`, {
          headers: requestHeaders(),
        });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('image/')) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        setUrl(URL.createObjectURL(blob));
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    if (typeof IntersectionObserver === 'undefined') {
      void load();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [source.id, source.hasDriveFile, attempt, loaded]);

  const showPlaceholderText = failed || !source.hasDriveFile;
  return (
    <div className="studio-footage-thumb" ref={holder}>
      {url ? (
        <img src={url} alt="" onError={() => { setUrl(''); setFailed(true); }} />
      ) : (
        <span className="studio-footage-thumb-placeholder" data-testid="studio-thumb-placeholder">
          {showPlaceholderText ? 'No preview yet' : ''}
        </span>
      )}
    </div>
  );
}

/**
 * Opens the original in Drive's player, in a new tab (task 86bcdejzy). The
 * small editing copy sits on the Mac Mini's disk, which the website cannot
 * reach, so Drive is the only place this screen can play a file from. A file
 * with no Drive copy gets plain content, never a link that goes nowhere.
 */
function DriveLink({ source, label, children }: {
  source: SourceRow;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  if (!source.driveUrl) return <>{children}</>;
  return (
    <a
      className="studio-footage-play"
      href={source.driveUrl}
      target="_blank"
      rel="noopener"
      aria-label={label}
      title={label}
    >
      {children}
    </a>
  );
}

/** The File column: the name, as a link when Drive can play it, or the reason it cannot. */
function FileCell({ source }: { source: SourceRow }): React.ReactElement {
  const name = source.fileName || (source.driveUrl ? 'Open in Drive' : 'Unnamed file');
  if (!source.driveUrl) {
    return (
      <>
        <span className="studio-footage-file-name">{name}</span>
        <span className="studio-footage-file-note"> · not from Drive</span>
      </>
    );
  }
  return (
    <DriveLink source={source} label={`Watch ${source.fileName || 'this file'} in Google Drive (opens a new tab)`}>
      <span className="studio-footage-file-name">{name}</span>
    </DriveLink>
  );
}

/**
 * The sentence a file's transcript state reads as. "Not transcribed yet" never
 * claims a job is running: the queue lives on the Mac Mini, out of the
 * website's sight (lib/studioFootage.js transcriptStateFor).
 */
export function transcriptSentence(t: TranscriptState | undefined): string {
  switch (t?.state) {
    case 'done': return 'Transcribed';
    case 'failed': return `Transcription failed: ${t.reason || 'no reason was recorded'}`;
    case 'no_audio': return 'No transcript: this file has no sound';
    case 'plate': return 'Not transcribed: files from Plates never are';
    case 'not_yet': return 'Not transcribed yet';
    default: return 'Could not read whether this was transcribed';
  }
}

function TranscriptCell({ source, open, onOpen }: {
  source: SourceRow;
  open: boolean;
  onOpen: () => void;
}): React.ReactElement {
  const t = source.transcript;
  if (t?.state === 'done') {
    return (
      <button
        type="button"
        className="btn studio-footage-transcript-open"
        data-testid="studio-transcript-open"
        aria-expanded={open}
        onClick={onOpen}
      >
        {open ? 'Hide transcript' : 'Transcript'}
      </button>
    );
  }
  const sentence = transcriptSentence(t);
  return (
    <span className="studio-footage-transcript-state" title={t?.state === 'failed' ? sentence : undefined}>
      {sentence}
    </span>
  );
}

/**
 * What was said in one file, a line per segment, each starting with its time.
 * An hour is ~1,000 lines, so the list scrolls inside its own box and wraps
 * every line — it never makes the page taller than the screen or wider than it
 * (docs/UI_RULES.md T0).
 */
function TranscriptView({ source, onClose }: { source: SourceRow; onClose: () => void }): React.ReactElement {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setTranscript(null);
    setError('');
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return undefined;
    }
    (async () => {
      try {
        const body = await api(`/api/studio/sources/${encodeURIComponent(source.id)}/transcript`);
        if (cancelled) return;
        if (!body?.ok) setError(body?.error?.message || 'The transcript could not be read.');
        else setTranscript(body.data as Transcript);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The transcript could not be read.');
      }
    })();
    return () => { cancelled = true; };
  }, [source.id]);

  const name = source.fileName || 'this file';
  return (
    <div className="studio-footage-transcript" role="region" aria-label={`Transcript of ${name}`}>
      <div className="studio-footage-transcript-head">
        <h4>{`Transcript of ${name}`}</h4>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      {error ? <p className="studio-footage-error" role="alert">{`Transcript not shown: ${error}`}</p> : null}
      {!error && !transcript ? <p className="studio-footage-empty">Loading the transcript…</p> : null}
      {transcript && !transcript.segments.length ? (
        <p className="studio-footage-empty">This transcript is finished but has no lines in it — nothing was heard as speech.</p>
      ) : null}
      {transcript && transcript.segments.length ? (
        <ol
          className="studio-footage-transcript-lines"
          data-testid="studio-transcript-lines"
          data-ui-no-sideways="transcript lines"
        >
          {transcript.segments.map((segment, i) => (
            <li key={i}>
              <span className="studio-footage-transcript-time">{timestamp(segment.start)}</span>
              <span className="studio-footage-transcript-text">{segment.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function stateSummary(counts: Record<string, number>): string {
  const order = ['ready', 'proxied', 'probed', 'downloaded', 'downloading', 'new', 'failed'];
  const keys = Object.keys(counts).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });
  return keys.map((k) => `${counts[k]} ${k}`).join(' · ');
}

export default function FootagePanel(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<Footage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lane, setLane] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [openTranscript, setOpenTranscript] = useState('');
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const params = new URLSearchParams();
    if (lane) params.set('lane', lane);
    const from = dayBoundary(fromDay, false);
    const to = dayBoundary(toDay, true);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const body = await api(`${FOOTAGE_PATH}${query ? `?${query}` : ''}`);
      if (seq !== requestSeq.current) return;
      if (!body?.ok) {
        setError(body?.error?.message || 'The footage list could not be read.');
        setData(null);
      } else {
        setError('');
        setData(body.data as Footage);
        setAttempt((n) => n + 1);
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : 'The footage list could not be read.');
      setData(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [lane, fromDay, toDay]);

  // Load each time the page is shown, and whenever a filter changes while it is.
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

  // A project switch: drop the old client's rows at once, and read the new
  // client's now if the page is on screen (the show-hook covers it otherwise).
  // The device filter names the old client's devices, so it goes too.
  useEffect(() => {
    const onSwitch = () => {
      requestSeq.current += 1;
      setData(null);
      setOpenTranscript('');
      setError('');
      setLoading(false);
      if (lane) { setLane(''); return; } // the lane change re-runs load via the show effect
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    };
    window.addEventListener(PROJECT_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, onSwitch);
  }, [load, lane]);

  const sessions = useMemo(() => {
    const all = data?.sessions || [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((s) => s.title.toLowerCase().includes(needle));
  }, [data, search]);

  const filtered = Boolean(lane || fromDay || toDay || search.trim());
  const anyStandInDate = sessions.some((s) => s.sources.some((f) => DATE_SOURCE_NOTE[f.dateSource]));
  const shownFiles = sessions.reduce((n, s) => n + s.sources.length, 0);

  let empty: string = '';
  if (data && !sessions.length) {
    if (!data.totalSources) {
      empty = 'No footage yet. Files appear here once the Studio pipeline has picked them up from '
        + 'the Studio Inbox or Plates folder on Google Drive. See docs/STUDIO.md for how to tell whether it is running.';
    } else {
      const parts: string[] = [];
      if (lane) parts.push(`device "${laneLabel(lane)}"`);
      if (fromDay || toDay) parts.push(`dates ${fromDay || '…'} to ${toDay || '…'}`);
      if (search.trim()) parts.push(`session name containing "${search.trim()}"`);
      empty = `None of the ${data.totalSources} file(s) in the catalog match ${parts.join(', ') || 'these filters'}.`;
      if ((fromDay || toDay) && data.undated) {
        empty += ` ${data.undated} file(s) have no date at all, so a date filter always leaves them out.`;
      }
    }
  }

  return (
    <div ref={hostRef} className="studio-footage-panel">
      <div className="studio-footage-filters" role="group" aria-label="Filter footage">
        <label className="studio-footage-filter">
          <span>Session</span>
          <input
            type="search"
            value={search}
            placeholder="Search session names"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="studio-footage-filter">
          <span>Device</span>
          <select value={lane} onChange={(e) => setLane(e.target.value)}>
            <option value="">All devices</option>
            {(data?.lanes || []).map((l) => (
              <option key={l.lane} value={l.lane}>{`${laneLabel(l.lane)} (${l.count})`}</option>
            ))}
            {lane && !(data?.lanes || []).some((l) => l.lane === lane) ? (
              <option value={lane}>{laneLabel(lane)}</option>
            ) : null}
          </select>
        </label>
        <label className="studio-footage-filter">
          <span>From</span>
          <input type="date" value={fromDay} max={toDay || undefined} onChange={(e) => setFromDay(e.target.value)} />
        </label>
        <label className="studio-footage-filter">
          <span>To</span>
          <input type="date" value={toDay} min={fromDay || undefined} onChange={(e) => setToDay(e.target.value)} />
        </label>
        <div className="studio-footage-filter-actions">
          <button
            type="button"
            className="btn"
            disabled={!filtered}
            onClick={() => { setLane(''); setFromDay(''); setToDay(''); setSearch(''); }}
          >
            Clear filters
          </button>
          <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? <p className="studio-footage-error" role="alert">{error}</p> : null}

      {data ? (
        <p className="studio-footage-summary">
          {filtered
            ? `Showing ${shownFiles} of ${data.totalSources} file(s) in ${sessions.length} session(s).`
            : `${data.totalSources} file(s) in ${sessions.length} session(s).`}
          {/* These two count the WHOLE catalog, not what the filters left, so
              they say so (landmine 17: two counts of one thing say what each counts). */}
          {data.newestAddedAt ? ` Whole catalog: newest file added ${fullDate(data.newestAddedAt)}.` : ''}
          {Object.keys(data.stateCounts).length
            ? ` ${data.newestAddedAt ? 'Stages' : 'Whole catalog stages'}: ${stateSummary(data.stateCounts)}.`
            : ''}
          {data.truncated ? ` Only the newest ${data.readLimit} rows were read, so these counts are a minimum.` : ''}
          {anyStandInDate ? ' A date marked * is not the file\'s own recording date yet — hover it to see which date it is.' : ''}
          {data.transcriptsError ? ` Transcript status could not be read: ${data.transcriptsError}` : ''}
        </p>
      ) : null}

      {empty ? <p className="studio-footage-empty">{empty}</p> : null}

      {sessions.map((session) => (
        <section key={session.id || 'no-session'} className="studio-footage-session">
          {/* A div, not <header>: the app styles every <header> as its black
              site banner, which swallowed this heading whole (DOCTRINE 5.28). */}
          <div className="studio-footage-session-head">
            <h3>{session.title}</h3>
            <span className="studio-footage-session-meta">
              {session.recordedAt ? shortDate(session.recordedAt) : 'No session date'}
              {` · ${session.sources.length} file(s)`}
              {session.state ? ` · ${session.state}` : ''}
            </span>
          </div>
          <div className="table-wrap studio-footage-table-wrap">
            <table className="studio-footage-table">
              <thead>
                <tr>
                  <th scope="col">Preview</th>
                  <th scope="col">File</th>
                  <th scope="col">Device</th>
                  <th scope="col">Role</th>
                  <th scope="col">Length</th>
                  <th scope="col">Size</th>
                  <th scope="col">Recorded</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Transcript</th>
                </tr>
              </thead>
              <tbody>
                {session.sources.map((source) => {
                  const note = DATE_SOURCE_NOTE[source.dateSource];
                  return (
                    <tr key={source.id}>
                      <td className="studio-footage-thumb-cell">
                        <DriveLink
                          source={source}
                          label={`Watch ${source.fileName || 'this file'} in Google Drive (opens a new tab)`}
                        >
                          <Thumbnail source={source} attempt={attempt} />
                        </DriveLink>
                      </td>
                      <td className="studio-footage-file-cell"><FileCell source={source} /></td>
                      <td>{laneLabel(source.lane)}</td>
                      <td>{source.layerRole}</td>
                      <td>{duration(source.durationS)}</td>
                      <td>{source.width && source.height ? `${source.width}×${source.height}` : '—'}</td>
                      <td title={[fullDate(source.date), note].filter(Boolean).join(' — ') || undefined}>
                        {shortDate(source.date) || '—'}
                        {note ? <span className="studio-footage-date-note"> *</span> : null}
                      </td>
                      <td>{source.state}</td>
                      <td className="studio-footage-transcript-cell">
                        <TranscriptCell
                          source={source}
                          open={openTranscript === source.id}
                          onOpen={() => setOpenTranscript((id) => (id === source.id ? '' : source.id))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {session.sources.filter((f) => f.id === openTranscript && f.transcript?.state === 'done').map((f) => (
            <TranscriptView key={f.id} source={f} onClose={() => setOpenTranscript('')} />
          ))}
        </section>
      ))}
    </div>
  );
}
