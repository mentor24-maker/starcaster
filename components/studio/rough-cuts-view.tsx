import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clock, lengthText } from './moments-view';

/**
 * Assets › Footage › Rough cuts (Reel Spinner 4c, SC-835).
 *
 * Dane's approval point: every rough cut the Mac Mini made, newest recording
 * first, each with a link to watch it in Drive and three buttons — Approve,
 * Skip, Send back (which needs a note saying what to change). Nothing goes
 * further without his yes: the Mini only finishes an edit he approved.
 *
 * The screen writes only the verdict, his note and the YouTube text
 * (POST /api/studio/rough-cuts/:id/review → lib/videoEditsStore.js
 * reviewEdit, which refuses a step out of order).
 *
 * THE YOUTUBE TEXT (Reel Spinner 6a, SC-839). Each card carries the title,
 * description and tags the Mac Mini wrote, in boxes he can change. Save
 * writes what he changed; Approve sends what he changed WITH the verdict, so
 * what goes to YouTube is what was in the boxes. Only the boxes he changed are
 * sent: a box he left alone keeps whatever the database holds, which may be
 * text the Mini wrote after the screen was opened. The Mini only ever writes
 * into an EMPTY box, so a word he typed is never overwritten. After every verdict the list
 * is read again from the database, so what is shown is what was saved — the
 * same picture a reload gives.
 *
 * Every empty screen says WHY (CLAUDE.md landmine 17): the Mini has not made
 * any, it is still making some, or nothing is waiting for you.
 *
 * Server half: routes/studioRoughCuts.js, lib/studioRoughCuts.js.
 */

export type Group = 'waiting' | 'approved' | 'skipped' | 'sent_back';

export type RoughCut = {
  id: string;
  sourceId: string;
  recordingName: string;
  recordedAt: string;
  recordingLengthS: number | null;
  kind: 'full' | 'short';
  momentIndex: number | null;
  status: string;
  group: Group;
  lengthS: number;
  savedS: number | null;
  moment: { startS: number; endS: number; score: number; reasons: string[]; quote: string } | null;
  watchUrl: string | null;
  /** The track under it, read-only (SC-837 picks it; lib/studioMusicShelf.js names it). */
  music: { trackId: string; label: string };
  daneNote: string;
  recutCount: number;
  recutProblem?: string;
  /** The YouTube text (6a). `missing` says why a box is empty, '' when all three are written. */
  youtube?: YoutubeText;
  /** On YouTube (6c): its page in YouTube Studio, where he makes it public. '' otherwise. */
  youtubeUrl?: string;
  /** Not uploaded (6c): the reason, starting "Not uploaded to YouTube: ". '' otherwise. */
  uploadProblem?: string;
  updatedAt: string;
};

export type YoutubeText = { title: string; description: string; tags: string[]; missing: string };

/** YouTube's own limits; lib/videoEditsStore.js reviewEdit holds the same two. */
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 5000;

/** The statuses whose text he may still change here (the store refuses uploading and on_youtube). */
const TEXT_EDITABLE = ['review', 'approved', 'finished'];

/** "tennis, delray beach ,, kids" → ["tennis", "delray beach", "kids"]. */
export function tagsFromText(value: string): string[] {
  return value.split(',').map((t) => t.trim()).filter(Boolean);
}

export type TextChange = { youtubeTitle?: string; youtubeDescription?: string; youtubeTags?: string[] };

/** Only the boxes that differ from what was loaded. */
export function changedText(
  loaded: YoutubeText | undefined,
  boxes: { title: string; description: string; tags: string },
): TextChange {
  const was = loaded || { title: '', description: '', tags: [], missing: '' };
  const out: TextChange = {};
  if (boxes.title.trim() !== was.title.trim()) out.youtubeTitle = boxes.title.trim();
  if (boxes.description.trim() !== was.description.trim()) out.youtubeDescription = boxes.description.trim();
  const tags = tagsFromText(boxes.tags);
  if (JSON.stringify(tags) !== JSON.stringify(was.tags)) out.youtubeTags = tags;
  return out;
}

/** GET /api/studio/rough-cuts — lib/studioRoughCuts.js roughCutsView. */
export type RoughCuts = {
  edits: RoughCut[];
  counts: Record<Group | 'making', number>;
  truncated: boolean;
  /** The waiting cuts are read on their own; true only if THAT read hit the limit. */
  waitingTruncated?: boolean;
  readLimit: number;
  momentsError: string;
};

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApp(): { api?: Api } | null {
  return ((window as unknown as { App?: { api?: Api } }).App) || null;
}

export const ROUGH_CUTS_PATH = '/api/studio/rough-cuts';

/** The same event footage-panel.tsx listens for (PROJECT_SWITCH_EVENT there). */
const PROJECT_SWITCH = 'projectContext:session-changed';

export const GROUPS: { id: Group; label: (n: number) => string }[] = [
  { id: 'waiting', label: (n) => `${n} waiting for you` },
  { id: 'approved', label: (n) => `${n} approved` },
  { id: 'skipped', label: (n) => `${n} skipped` },
  { id: 'sent_back', label: (n) => `${n} sent back` },
];

/** What the Mini has done since he approved it; '' while it just sits approved. */
const AFTER_APPROVAL: Record<string, string> = {
  // The finished file waits on the Mac Mini for the YouTube upload (6c).
  finished: 'finished, waiting to upload',
  uploading: 'uploading to YouTube',
  on_youtube: 'on YouTube (private)',
};

/**
 * The sentence shown instead of the list, or '' when there is a list to show.
 * Names the reason the list is empty, never just "nothing here".
 */
export function emptySentence(view: Pick<RoughCuts, 'counts'>, group: Group): string {
  const c = view.counts;
  const made = c.waiting + c.approved + c.skipped + c.sent_back;
  if (!made) {
    return c.making
      ? `No rough cuts yet: the Mac Mini is making ${c.making}. Each one appears here once it is uploaded to Drive.`
      : 'No rough cuts yet: the Mac Mini has not made any. It makes them once a recording\'s moments are scored.';
  }
  if (c[group]) return '';
  switch (group) {
    case 'waiting':
      return c.making
        ? `Nothing waiting for you. The Mac Mini is making ${c.making} more.`
        : 'Nothing waiting for you: every rough cut has your answer.';
    case 'approved': return 'Nothing approved yet.';
    case 'skipped': return 'Nothing skipped.';
    default: return 'Nothing sent back.';
  }
}

export function editTitle(edit: Pick<RoughCut, 'kind' | 'moment'>): string {
  if (edit.kind === 'full') return 'Full edit';
  return edit.moment ? `Short from ${clock(edit.moment.startS)}` : 'Short';
}

export function lengthLine(edit: Pick<RoughCut, 'lengthS' | 'savedS'>): string {
  const saved = edit.savedS === null
    ? 'time saved not known (the recording\'s length was not read)'
    : `${lengthText(edit.savedS)} taken out`;
  return `${lengthText(edit.lengthS)} long · ${saved}`;
}

/** What has happened to it, for anything no longer waiting. */
export function verdictLine(
  edit: Pick<RoughCut, 'status' | 'group' | 'daneNote'> & Partial<Pick<RoughCut, 'recutCount' | 'recutProblem' | 'uploadProblem'>>,
): string {
  if (edit.group === 'waiting') return edit.recutProblem ? edit.recutProblem.charAt(0).toUpperCase() + edit.recutProblem.slice(1) : (edit.recutCount && edit.daneNote ? `Re-cut from your note: "${edit.daneNote}"` : '');
  if (edit.group === 'approved') {
    if (edit.uploadProblem) return `Approved — ${edit.uploadProblem.charAt(0).toLowerCase()}${edit.uploadProblem.slice(1).replace(/\.$/, '')}.`;
    const after = AFTER_APPROVAL[edit.status];
    return after ? `Approved — ${after}.` : 'Approved — the Mac Mini will finish it.';
  }
  if (edit.group === 'skipped') return 'Skipped — it will not be finished.';
  if (edit.group === 'sent_back') return edit.daneNote ? `Sent back: "${edit.daneNote}"` : 'Sent back.';
  return '';
}

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

type Verdict = ({ status: 'approved' | 'skipped' | 'sent_back' } | { status?: undefined }) & { daneNote?: string } & TextChange;

function RoughCutItem({ edit, momentsError, onVerdict }: {
  edit: RoughCut;
  momentsError: string;
  onVerdict: (edit: RoughCut, verdict: Verdict) => Promise<string>;
}): React.ReactElement {
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const yt = edit.youtube;
  const [title, setTitle] = useState(yt?.title || '');
  const [description, setDescription] = useState(yt?.description || '');
  const [tags, setTags] = useState((yt?.tags || []).join(', '));
  // A fresh read (after a save, or the Mini writing) refills the boxes.
  const loadedTitle = yt?.title || '';
  const loadedDescription = yt?.description || '';
  const loadedTags = (yt?.tags || []).join(', ');
  useEffect(() => {
    setTitle(loadedTitle);
    setDescription(loadedDescription);
    setTags(loadedTags);
  }, [loadedTitle, loadedDescription, loadedTags]);
  const boxes = { title, description, tags };
  const changes = changedText(yt, boxes);
  const changed = Object.keys(changes).length > 0;
  const textEditable = TEXT_EDITABLE.includes(edit.status);

  const give = async (verdict: Verdict) => {
    setBusy(true);
    setProblem('');
    const failed = await onVerdict(edit, verdict);
    setBusy(false);
    if (failed) setProblem(failed);
  };

  const sendBack = (event: React.FormEvent) => {
    event.preventDefault();
    if (!note.trim()) {
      setProblem('Say what to change before sending it back.');
      return;
    }
    void give({ status: 'sent_back', daneNote: note.trim() });
  };

  const date = shortDate(edit.recordedAt);
  const verdict = verdictLine(edit);
  return (
    <li className="studio-roughcut" data-testid="studio-roughcut" data-edit-id={edit.id}>
      <div className="studio-moment-head">
        {edit.moment ? (
          <span className="studio-moment-score" aria-label={`Score ${edit.moment.score} out of 100`}>{edit.moment.score}</span>
        ) : null}
        <strong>{editTitle(edit)}</strong>
        <span className="studio-roughcut-of">{`${edit.recordingName}${date ? ` · ${date}` : ''}`}</span>
      </div>
      <p className="studio-roughcut-line">
        {lengthLine(edit)}
        {edit.recutCount ? ` · recut ${edit.recutCount} time${edit.recutCount === 1 ? '' : 's'}` : ''}
        {' · '}
        {edit.watchUrl ? (
          <a href={edit.watchUrl} target="_blank" rel="noopener" title="Opens the rough cut in Google Drive (new tab)">
            Watch in Drive
          </a>
        ) : (
          <span>No rough cut file was recorded for it</span>
        )}
      </p>
      <p className="studio-roughcut-line" data-testid="studio-roughcut-music">{`Music: ${edit.music?.label || 'No music picked'}`}</p>
      {edit.kind === 'short' && !edit.moment ? (
        <p className="studio-moments-note">
          {momentsError
            ? `Its score could not be read: ${momentsError}`
            : 'The moment it was cut from is no longer in the recording\'s scores (it may have been scored again).'}
        </p>
      ) : null}
      {edit.moment?.quote ? <blockquote className="studio-moment-quote">{edit.moment.quote}</blockquote> : null}
      {edit.moment?.reasons.length ? (
        <ul className="studio-moment-reasons">
          {edit.moment.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
        </ul>
      ) : null}
      {verdict ? <p className="studio-roughcut-verdict" data-testid="studio-roughcut-verdict">{verdict}</p> : null}
      {edit.youtubeUrl ? (
        <p className="studio-roughcut-line" data-testid="studio-roughcut-on-youtube">
          <a href={edit.youtubeUrl} target="_blank" rel="noopener" title="Opens the video in YouTube Studio (new tab), where you can make it public">
            Open in YouTube Studio
          </a>
          {' · it is Private until you make it public there'}
        </p>
      ) : null}
      <div className="studio-roughcut-youtube" data-testid="studio-roughcut-youtube">
        {yt?.missing ? <p className="studio-moments-note" data-testid="studio-roughcut-youtube-missing">{yt.missing}</p> : null}
        <label className="studio-footage-filter" htmlFor={`roughcut-title-${edit.id}`}>
          <span>YouTube Title</span>
          <span className="studio-roughcut-count">{`${title.trim().length} / ${TITLE_MAX}`}</span>
        </label>
        <input
          id={`roughcut-title-${edit.id}`}
          data-testid="studio-roughcut-title"
          type="text"
          maxLength={TITLE_MAX}
          value={title}
          readOnly={!textEditable}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="studio-footage-filter" htmlFor={`roughcut-description-${edit.id}`}>
          <span>Description</span>
          <span className="studio-roughcut-count">{`${description.trim().length} / ${DESCRIPTION_MAX}`}</span>
        </label>
        <textarea
          id={`roughcut-description-${edit.id}`}
          data-testid="studio-roughcut-description"
          rows={8}
          maxLength={DESCRIPTION_MAX}
          value={description}
          readOnly={!textEditable}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="studio-footage-filter" htmlFor={`roughcut-tags-${edit.id}`}>
          <span>Tags</span>
          <span className="studio-roughcut-count">Separated by Commas</span>
        </label>
        <input
          id={`roughcut-tags-${edit.id}`}
          data-testid="studio-roughcut-tags"
          type="text"
          value={tags}
          readOnly={!textEditable}
          onChange={(e) => setTags(e.target.value)}
        />
        {textEditable && edit.status !== 'review' ? (
          <div className="studio-roughcut-actions">
            <button type="button" className="btn btn-save" disabled={busy || !changed} onClick={() => void give({ ...changes })}>
              Save text
            </button>
          </div>
        ) : null}
      </div>
      {edit.status === 'review' && !sendingBack ? (
        <div className="studio-roughcut-actions">
          <button type="button" className="btn btn-save" disabled={busy || !changed} onClick={() => void give({ ...changes })}>
            Save text
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void give({ status: 'approved', ...changes })}>
            Approve
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void give({ status: 'skipped' })}>
            Skip
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => { setSendingBack(true); setProblem(''); }}>
            Send back
          </button>
        </div>
      ) : null}
      {edit.status === 'review' && sendingBack ? (
        <form className="studio-roughcut-sendback" onSubmit={sendBack} aria-label="Send this rough cut back">
          <label className="studio-footage-filter" htmlFor={`roughcut-note-${edit.id}`}>
            <span>What to Change</span>
          </label>
          <textarea
            id={`roughcut-note-${edit.id}`}
            data-testid="studio-roughcut-note"
            rows={3}
            value={note}
            placeholder="e.g. start at the second sentence, and cut the bit about the weather"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="studio-roughcut-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>Send back</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setSendingBack(false); setProblem(''); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {problem ? <p className="studio-footage-error" role="alert">{problem}</p> : null}
    </li>
  );
}

export default function RoughCutsView(): React.ReactElement {
  const [view, setView] = useState<RoughCuts | null>(null);
  const [error, setError] = useState('');
  const [group, setGroup] = useState<Group>('waiting');
  const [done, setDone] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (): Promise<boolean> => {
    const api = getApp()?.api;
    if (typeof api !== 'function') {
      setError('The admin app is still loading — try again in a moment.');
      return false;
    }
    const mine = ++seq.current;
    try {
      const body = await api(ROUGH_CUTS_PATH);
      if (mine !== seq.current) return false;
      if (!body?.ok) {
        setError(body?.error?.message || 'The rough cuts could not be read.');
        return false;
      }
      setError('');
      setView(body.data as RoughCuts);
      return true;
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : 'The rough cuts could not be read.');
      return false;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onSwitch = () => {
      seq.current += 1;
      setView(null);
      setDone('');
      void load();
    };
    window.addEventListener(PROJECT_SWITCH, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH, onSwitch);
  }, [load]);

  /** '' when saved; otherwise what went wrong, shown on that rough cut. */
  const onVerdict = useCallback(async (edit: RoughCut, verdict: Verdict): Promise<string> => {
    const api = getApp()?.api;
    if (typeof api !== 'function') return 'The admin app is still loading — try again in a moment.';
    try {
      const body = await api(`${ROUGH_CUTS_PATH}/${encodeURIComponent(edit.id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verdict),
      });
      if (!body?.ok || (verdict.status && body?.data?.status !== verdict.status)) {
        // Read the list again: a refusal (409, someone else's answer landed
        // first) means the buttons shown are stale.
        void load();
        return `Not saved: ${body?.error?.message || 'the server did not confirm it'}`;
      }
    } catch (err) {
      void load();
      return `Not saved: ${err instanceof Error ? err.message : 'the request failed'}`;
    }
    const word = verdict.status === 'approved' ? 'Approved'
      : verdict.status === 'skipped' ? 'Skipped'
        : verdict.status === 'sent_back' ? 'Sent back' : 'YouTube text saved';
    setDone(`${word}: ${editTitle(edit)} of ${edit.recordingName}.`);
    // Read the list again, so the screen shows what the database now holds.
    if (!(await load())) setDone((d) => `${d} The list could not be read again — Refresh to see it.`);
    return '';
  }, [load]);

  if (error && !view) return <p className="studio-footage-error" role="alert">{`Rough cuts not shown: ${error}`}</p>;
  if (!view) return <p className="studio-footage-empty">Loading the rough cuts…</p>;

  const shown = view.edits.filter((e) => e.group === group);
  const sentence = emptySentence(view, group);

  return (
    <div className="studio-roughcuts" data-testid="studio-roughcuts">
      <div className="studio-roughcuts-counts" role="group" aria-label="Show rough cuts">
        {GROUPS.map((g, i) => (
          <React.Fragment key={g.id}>
            {i ? <span aria-hidden="true">·</span> : null}
            <button
              type="button"
              className="studio-roughcuts-count"
              aria-pressed={group === g.id}
              data-testid={`studio-roughcuts-${g.id}`}
              onClick={() => setGroup(g.id)}
            >
              {g.label(view.counts[g.id] || 0)}
            </button>
          </React.Fragment>
        ))}
        <button type="button" className="btn studio-roughcuts-refresh" onClick={() => void load()}>Refresh</button>
      </div>
      {view.truncated ? (
        <p className="studio-moments-note">{view.waitingTruncated
          ? `More than ${view.readLimit} rough cuts are waiting for you; only ${view.readLimit} are shown, so these counts are a minimum.`
          : `Only ${view.readLimit} of the answered rough cuts were read, so those counts are a minimum. Every rough cut waiting for you is shown.`}</p>
      ) : null}
      {error ? <p className="studio-footage-error" role="alert">{error}</p> : null}
      {done ? <p className="studio-moments-note" role="status" data-testid="studio-roughcuts-done">{done}</p> : null}
      {sentence ? (
        <p className="studio-footage-empty" data-testid="studio-roughcuts-empty">{sentence}</p>
      ) : (
        <ol className="studio-moments-list" data-ui-no-sideways="rough cuts">
          {shown.map((edit) => (
            <RoughCutItem key={edit.id} edit={edit} momentsError={view.momentsError} onVerdict={onVerdict} />
          ))}
        </ol>
      )}
    </div>
  );
}
