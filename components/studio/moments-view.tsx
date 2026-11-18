import React, { useCallback, useEffect, useState } from 'react';

/**
 * Assets › Footage › a recording › Moments (Reel Spinner 2e, SC-830).
 *
 * What Reel Spinner thinks is worth sharing in one recording: its summary,
 * then each scored moment best first — score, reasons, the project it speaks
 * to, the quote, its length, and a link to watch it. Read-only; the one thing
 * it can ask for is a rescore, which only sets a flag the Mac Mini picks up.
 *
 * Every empty screen says WHY (CLAUDE.md landmine 17): not scored yet, scoring
 * failed and the reason, no notes switched on for Reel Spinner (with the way
 * to Assets › Context), or the notes could not be read. "Could not tell" is
 * never shown as "current".
 *
 * Server half: routes/studioMoments.js, lib/studioFootage.js momentsViewFor.
 */

export type Moment = {
  start_s: number;
  end_s: number;
  lengthS: number;
  score: number;
  reasons: string[];
  project: string;
  mood: string;
  quote: string;
};

export type NotesState = 'current' | 'stale' | 'unrecorded' | 'unknown' | 'not_scored';

/** GET /api/studio/sources/:id/moments — lib/studioFootage.js momentsViewFor. */
export type Moments = {
  sourceId: string;
  driveUrl: string | null;
  projectName: string;
  notesMissing: string;
  notesError: string;
  state: 'not_yet' | 'done' | 'failed';
  error: string;
  summary: string;
  moments: Moment[];
  model: string;
  scoredAt: string;
  notesState: NotesState;
  rescoreRequestedAt: string;
  canRescore: boolean;
};

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

type AppShape = {
  api?: Api;
  setActivePage?: (pageId: string) => void;
};

function getApp(): AppShape | null {
  return ((window as unknown as { App?: AppShape }).App) || null;
}

/** 12:34, or 1:02:03 past the hour. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "15 s", "1 min 5 s". */
export function lengthText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/**
 * The line that says whether these moments still match the notes Reel Spinner
 * reads. '' when they do (nothing to say) or when nothing was scored.
 */
export function notesLine(view: Pick<Moments, 'notesState' | 'notesError'>): string {
  switch (view.notesState) {
    case 'stale':
      return 'These moments were scored against older Reel Spinner notes than the ones switched on now.';
    case 'unrecorded':
      return 'This score does not record which notes it read, so whether the notes changed since cannot be told.';
    case 'unknown':
      return `Could not tell whether these moments match today's notes: ${view.notesError || 'the notes could not be read'}.`;
    default:
      return '';
  }
}

/**
 * The sentence shown instead of the list, or '' when there is a list to show.
 */
export function momentsSentence(view: Pick<Moments, 'state' | 'error' | 'moments'>): string {
  if (view.state === 'not_yet') return 'Not scored yet. Reel Spinner scores a recording on the Mac Mini after it is transcribed.';
  if (view.state === 'failed') return `Scoring failed: ${view.error || 'no reason was recorded'}`;
  if (!view.moments.length) return 'Scored, and nothing in this recording stood out as worth sharing.';
  return '';
}

function goToContext(event: React.MouseEvent<HTMLAnchorElement>): void {
  const app = getApp();
  if (typeof app?.setActivePage !== 'function') return;
  event.preventDefault();
  app.setActivePage('assetsContextPage');
}

function MomentItem({ moment, driveUrl }: { moment: Moment; driveUrl: string | null }): React.ReactElement {
  const at = clock(moment.start_s);
  return (
    <li className="studio-moment" data-testid="studio-moment">
      <div className="studio-moment-head">
        <span className="studio-moment-score" aria-label={`Score ${moment.score} out of 100`}>{moment.score}</span>
        <span className="studio-moment-when">
          {`${at}–${clock(moment.end_s)} · ${lengthText(moment.lengthS)}`}
          {moment.project ? ` · ${moment.project}` : ''}
        </span>
        {driveUrl ? (
          <span className="studio-moment-watch">
            {/* Drive's player takes no start time in its address, so the
                moment's start is said beside the link instead of promised. */}
            <a href={driveUrl} target="_blank" rel="noopener" title="Opens the recording in Google Drive (new tab)">
              Watch in Drive
            </a>
            {` starts at ${at}`}
          </span>
        ) : (
          <span className="studio-moment-watch">Not from Drive, so there is nothing to play it in</span>
        )}
      </div>
      {moment.quote ? <blockquote className="studio-moment-quote">{moment.quote}</blockquote> : null}
      {moment.reasons.length ? (
        <ul className="studio-moment-reasons">
          {moment.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
        </ul>
      ) : null}
    </li>
  );
}

export default function MomentsView({ sourceId }: { sourceId: string }): React.ReactElement {
  const [view, setView] = useState<Moments | null>(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setError('');
    setAskError('');
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return undefined;
    }
    (async () => {
      try {
        const body = await api(`/api/studio/sources/${encodeURIComponent(sourceId)}/moments`);
        if (cancelled) return;
        if (!body?.ok) setError(body?.error?.message || 'The moments could not be read.');
        else setView(body.data as Moments);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The moments could not be read.');
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId]);

  const rescore = useCallback(async () => {
    const api = getApp()?.api;
    if (typeof api !== 'function') return;
    setAsking(true);
    setAskError('');
    try {
      const body = await api(`/api/studio/sources/${encodeURIComponent(sourceId)}/moments/rescore`, { method: 'POST' });
      const at = String(body?.data?.rescoreRequestedAt || '');
      if (!body?.ok || !at) setAskError(body?.error?.message || 'The request to score again was not saved.');
      else setView((v) => (v ? { ...v, rescoreRequestedAt: at } : v));
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'The request to score again was not saved.');
    } finally {
      setAsking(false);
    }
  }, [sourceId]);

  if (error) return <p className="studio-footage-error" role="alert">{`Moments not shown: ${error}`}</p>;
  if (!view) return <p className="studio-footage-empty">Loading the moments…</p>;

  const sentence = momentsSentence(view);
  const line = notesLine(view);
  const offerRescore = view.canRescore && (view.state === 'failed' || view.notesState === 'stale' || view.notesState === 'unrecorded');

  return (
    <div className="studio-moments" data-testid="studio-moments">
      {view.notesMissing ? (
        <p className="studio-moments-note" data-testid="studio-moments-no-notes">
          {`${view.notesMissing} Reel Spinner scores against those notes, so switch one on in `}
          <a href="#assetsContextPage" onClick={goToContext}>Assets › Context</a>.
        </p>
      ) : null}
      {view.state === 'done' && view.summary ? (
        <p className="studio-moments-summary" data-testid="studio-moments-summary">{view.summary}</p>
      ) : null}
      {line ? <p className="studio-moments-note" data-testid="studio-moments-notes-line">{line}</p> : null}
      {view.rescoreRequestedAt ? (
        <p className="studio-moments-note" data-testid="studio-moments-waiting">
          Asked to score again — waiting for the Mac Mini.
        </p>
      ) : null}
      {offerRescore && !view.rescoreRequestedAt ? (
        <p>
          <button
            type="button"
            className="btn"
            data-testid="studio-moments-rescore"
            disabled={asking}
            onClick={rescore}
          >
            {asking ? 'Asking…' : 'Score again'}
          </button>
        </p>
      ) : null}
      {askError ? <p className="studio-footage-error" role="alert">{`Not asked to score again: ${askError}`}</p> : null}
      {sentence ? (
        <p className="studio-footage-empty" data-testid="studio-moments-empty">{sentence}</p>
      ) : (
        <ol className="studio-moments-list" data-ui-no-sideways="scored moments">
          {view.moments.map((moment, i) => <MomentItem key={`${moment.start_s}-${i}`} moment={moment} driveUrl={view.driveUrl} />)}
        </ol>
      )}
    </div>
  );
}
