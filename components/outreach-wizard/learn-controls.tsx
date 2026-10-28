import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The wizard's Learn stage — Outreach wizard 13/19 (task 86bcrmbpm).
 *
 * The plain-sentence lessons drafts on this channel are written with, made
 * from Dane's approvals, edits and rejection reasons (lib/outreachLessons.js).
 * Each lesson can be switched off, edited, deleted, and asked "why" — the
 * decisions it came from. He can add his own, for this channel or for all of
 * them, and ask for a fresh set with Refresh lessons. The score ("Approved
 * without edits, last 20: 6 of 20") is in the stage's sentence above.
 *
 * Data: GET/POST /api/outreach/lessons, POST /api/outreach/lessons/:id,
 * DELETE /api/outreach/lessons/:id, POST /api/outreach/lessons/refresh
 * (routes/outreach.js). Every change re-reads the list, so what is shown is
 * what was saved, never the screen's own guess. A read that fails says so and
 * why; an empty list says why it is empty.
 */

export const LESSONS_PATH = '/api/outreach/lessons';

export type LessonEvidence = { feedbackId: string; action: string; reasons: string[]; note: string; createdAt: string | null };

export type Lesson = {
  id: string;
  channel: string;
  text: string;
  enabled: boolean;
  source: 'suggested' | 'dane';
  edited: boolean;
  why: string;
  evidence: LessonEvidence[];
};

export type LearnScore = { unedited: number; counted: number; window: number; sentence: string };

export type LearnView = { channel: string; lessons: Lesson[]; score: LearnScore | null; scoreError: string };

const ACTION_WORDS: Record<string, string> = {
  rejected: 'Rejected',
  'approved-as-is': 'Approved as written',
  'approved-edited': 'Approved after your edit',
  'chose-option': 'Picked and approved as written',
};

type AppShape = { api?: (path: string, options?: RequestInit) => Promise<Record<string, any>> };

function getApi(): AppShape['api'] | null {
  const app = (window as unknown as { App?: AppShape }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** "Rejected (too salesy, too long) on Oct 20: “his note”" — one decision behind a lesson. */
export function evidenceLine(e: LessonEvidence): string {
  const action = ACTION_WORDS[e.action] || e.action;
  const reasons = e.action === 'rejected' ? (e.reasons.length ? ` (${e.reasons.join(', ')})` : ' (no reason given)') : '';
  const d = e.createdAt ? new Date(e.createdAt) : null;
  const when = d && !Number.isNaN(d.getTime()) ? ` on ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '';
  const note = e.note ? `: “${e.note}”` : '';
  return `${action}${reasons}${when}${note}`;
}

function LessonRow({ lesson, label, busy, onChange, onDelete }: {
  lesson: Lesson;
  label: string;
  busy: boolean;
  onChange: (id: string, body: { text?: string; enabled?: boolean }) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.text);
  const [showWhy, setShowWhy] = useState(false);
  const inputId = `outreach-lesson-${lesson.id}`;

  return (
    <li className={`outreach-lesson${lesson.enabled ? '' : ' outreach-lesson--off'}`} data-lesson={lesson.id}>
      <div className="outreach-lesson-main">
        <label className="outreach-lesson-switch">
          <input
            type="checkbox"
            checked={lesson.enabled}
            disabled={busy}
            onChange={(e) => void onChange(lesson.id, { enabled: e.target.checked })}
          />
          <span>{lesson.enabled ? 'On' : 'Off'}</span>
        </label>
        {editing ? (
          <form
            className="outreach-lesson-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void onChange(lesson.id, { text }).then((saved) => { if (saved) setEditing(false); });
            }}
          >
            <label htmlFor={inputId} className="outreach-learn-hidden-label">Lesson</label>
            <input id={inputId} type="text" className="outreach-lesson-input" value={text} maxLength={160} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>Save</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setText(lesson.text); setEditing(false); }}>Cancel</button>
          </form>
        ) : (
          <p className="outreach-lesson-text">{lesson.text}</p>
        )}
      </div>
      <div className="outreach-lesson-meta">
        <span className="outreach-wizard-muted">{label}</span>
        <button type="button" className="btn btn-ghost" aria-expanded={showWhy} onClick={() => setShowWhy((v) => !v)}>Why</button>
        {!editing ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>Edit</button> : null}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onDelete(lesson.id)}>Delete</button>
      </div>
      {showWhy ? (
        <div className="outreach-lesson-why">
          <p>{lesson.source === 'dane' ? lesson.why : `Suggested ${lesson.why}${lesson.edited ? ', then edited by you' : ''}.`}</p>
          {lesson.evidence.length ? (
            <ul>{lesson.evidence.map((e) => <li key={e.feedbackId}>{evidenceLine(e)}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function LearnControls({ channel, label, onChanged }: {
  channel: string;
  label: string;
  onChanged?: () => void;
}): React.ReactElement {
  const [view, setView] = useState<LearnView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [newText, setNewText] = useState('');
  const [newScope, setNewScope] = useState<'channel' | 'all'>('channel');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const mine = ++seq.current;
    try {
      const reply = await api(`${LESSONS_PATH}?channel=${encodeURIComponent(channel)}`);
      if (mine !== seq.current) return;
      setView((reply?.data as LearnView) || null);
      setError('');
    } catch (err) {
      if (mine !== seq.current) return;
      setView(null);
      setError(`The lessons could not be read: ${errorText(err, 'unknown error')}`);
    }
  }, [channel]);

  useEffect(() => {
    setView(null);
    setNotice('');
    void load();
  }, [load]);

  /** Send one change; on success re-read the list and say `done`. */
  const send = async (what: string, path: string, init: RequestInit, done: string): Promise<boolean> => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return false;
    }
    setBusy(what);
    setError('');
    setNotice('');
    try {
      const reply = await api(path, init);
      await load();
      setNotice(done);
      onChanged?.();
      return reply?.ok !== false;
    } catch (err) {
      setError(`${what} did not work: ${errorText(err, 'unknown error')}`);
      return false;
    } finally {
      setBusy('');
    }
  };

  const change = (id: string, body: { text?: string; enabled?: boolean }) => send(
    'The change',
    `${LESSONS_PATH}/${encodeURIComponent(id)}`,
    { method: 'POST', body: JSON.stringify(body) },
    body.enabled === false ? 'Switched off. New drafts will not follow it.' : body.enabled ? 'Switched on.' : 'Lesson saved.',
  );

  const remove = async (id: string) => {
    await send('Deleting', `${LESSONS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Lesson deleted.');
  };

  const add = async () => {
    const saved = await send(
      'Adding the lesson',
      LESSONS_PATH,
      { method: 'POST', body: JSON.stringify({ channel: newScope === 'all' ? 'all' : channel, text: newText }) },
      'Lesson added.',
    );
    if (saved) setNewText('');
  };

  const refresh = async () => {
    const api = getApi();
    if (!api) return;
    setBusy('refresh');
    setError('');
    setNotice('');
    try {
      const reply = await api(`${LESSONS_PATH}/refresh`, { method: 'POST', body: JSON.stringify({ channel }) });
      const data = (reply?.data || {}) as { added?: number; replaced?: number; note?: string };
      await load();
      setNotice(data.note || `${data.added || 0} lesson${data.added === 1 ? '' : 's'} suggested from your recent decisions${data.replaced ? `, in place of ${data.replaced} older suggestion${data.replaced === 1 ? '' : 's'}` : ''}.`);
      onChanged?.();
    } catch (err) {
      setError(`Refresh lessons did not work: ${errorText(err, 'unknown error')}`);
    } finally {
      setBusy('');
    }
  };

  const lessons = view?.lessons || [];
  const on = lessons.filter((l) => l.enabled).length;

  return (
    <div className="outreach-learn" data-learn={channel}>
      {/* The score is in the stage's own sentence above (lib/outreachOverview.js),
          so it is not repeated here; only a score that could not be read is. */}
      {view && !view.score && view.scoreError ? <p className="outreach-wizard-error" role="alert">{view.scoreError}</p> : null}
      {view && !lessons.length ? (
        <p className="outreach-wizard-muted">
          {`No lessons for ${label} yet. Lessons are suggested from your approvals, edits and rejection reasons — click Refresh lessons, or add your own below.`}
        </p>
      ) : null}
      {view && lessons.length && !on ? (
        <p className="outreach-wizard-muted">{`Every lesson is switched off, so ${label} drafts are written from the canon alone.`}</p>
      ) : null}
      {lessons.length ? (
        <ul className="outreach-lessons">
          {lessons.map((l) => (
            <LessonRow
              key={`${l.id}:${l.text}`}
              lesson={l}
              label={l.channel === 'all' ? 'All channels' : `${label} only`}
              busy={!!busy}
              onChange={change}
              onDelete={remove}
            />
          ))}
        </ul>
      ) : null}
      <form className="outreach-wizard-connect-form" onSubmit={(e) => { e.preventDefault(); if (newText.trim()) void add(); }}>
        <label htmlFor={`outreach-new-lesson-${channel}`}>Add my own lesson</label>
        <input
          id={`outreach-new-lesson-${channel}`}
          type="text"
          className="outreach-lesson-input"
          maxLength={160}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <label htmlFor={`outreach-new-lesson-scope-${channel}`} className="outreach-learn-hidden-label">Applies to</label>
        <select id={`outreach-new-lesson-scope-${channel}`} className="outreach-lesson-scope" value={newScope} onChange={(e) => setNewScope(e.target.value === 'all' ? 'all' : 'channel')}>
          <option value="channel">{`${label} only`}</option>
          <option value="all">All channels</option>
        </select>
        <button type="submit" className="btn" disabled={!!busy || !newText.trim()}>Add Lesson</button>
      </form>
      <div className="outreach-wizard-stage-actions">
        <button type="button" className="btn" disabled={!!busy} onClick={() => void refresh()}>
          {busy === 'refresh' ? 'Reading your decisions…' : 'Refresh Lessons'}
        </button>
      </div>
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
    </div>
  );
}
