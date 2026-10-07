import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Engage › YouTube Outreach — the list of videos the outreach agent should
 * comment on, each with its own comment settings, plus the account-wide
 * safety limits. YouTube outreach 2/7 (task 86bcda63z).
 *
 * A React island in the frozen vanilla app, mounted into
 * #youtubeOutreachReactRoot by react-entry.js. Data: /api/youtube-outreach
 * (routes/youtubeOutreach.js over lib/youtubeOutreachStore.js, slice 1/7).
 * Nothing here drafts or posts a comment; later slices read what this saves.
 *
 * The server owns every rule. This screen sends what the form says and shows
 * the server's own sentence when it refuses — it does not keep a second copy
 * of the validation that could disagree with the first. The one thing it does
 * shape is the fields that only apply in one mode (the comment to reply to,
 * the link, the repeat schedule): those are sent blank when their mode is off,
 * because the store refuses a value for a mode that is not selected rather
 * than silently dropping it.
 *
 * It (re)loads whenever its page is SHOWN and whenever the project is
 * SWITCHED, and drops a reply that lands after a newer request — the same
 * reasoning as components/studio/footage-panel.tsx, where the show-hook alone
 * left one client's list on screen under another client's name.
 *
 * A SAVE is held to the same rule: account settings saved under one project
 * and answered after a switch are dropped, or the old client's limits would
 * sit in the new client's form and the next Save would write them there.
 *
 * EMPTY IS ALWAYS EXPLAINED (CLAUDE.md landmine 17): "no targets yet", "the
 * list could not be read", "the account settings could not be read" and
 * "these limits have not been saved yet" are each said in words — and a read
 * that fails names WHICH read, so a broken settings row never reads as a
 * broken list.
 */

const TARGETS_PATH = '/api/youtube-outreach/targets';
const SETTINGS_PATH = '/api/youtube-outreach/settings';

/** The window event public/js/projectContext.js emits on every project switch. */
export const PROJECT_SWITCH_EVENT = 'projectContext:session-changed';

/**
 * The store accepts only a full link, but people paste "youtu.be/…" and
 * "youtube.com/watch?v=…" without the https://. Add it rather than refuse.
 */
export function withScheme(link: string): string {
  const trimmed = link.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

export type Target = {
  id: string;
  accountKey: string;
  videoUrl: string;
  videoId: string;
  videoTitle: string;
  channelName: string;
  detailsError: string;
  objective: string;
  commentPlacement: string;
  replyToCommentId: string;
  messageTypes: string[];
  commentLength: string;
  linkPolicy: string;
  linkUrl: string;
  mentionPolicy: string;
  repeatMode: string;
  repeatEveryDays: number | null;
  repeatMaxTimes: number | null;
  repeatUntil: string | null;
  priority: string;
  notes: string;
  status: string;
  createdAt: string;
};

export type OutreachSettings = {
  accountKey: string;
  maxCommentsPerDay: number | null;
  minMinutesBetween: number | null;
  jitterMinutes: number | null;
  activeStartHour: number | null;
  activeEndHour: number | null;
  timeZone: string;
  oneCommentPerVideo: boolean;
  avoidChannels: string[];
  avoidWords: string[];
  voice: string;
  saved: boolean;
  updatedAt: string;
};

type AppShape = {
  api?: (path: string, options?: RequestInit) => Promise<Record<string, any>>;
};

function getApi(): AppShape['api'] | null {
  const app = (window as unknown as { App?: AppShape }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ── Plain-language labels for the choice lists (lib/youtubeOutreachStore.js CHOICES) ──

type Option = { value: string; label: string };

export const OBJECTIVE_OPTIONS: Option[] = [
  { value: 'join_conversation', label: 'Join the conversation' },
  { value: 'awareness', label: 'Raise awareness' },
  { value: 'drive_link', label: 'Send people to a link' },
  { value: 'appreciation', label: 'Show appreciation' },
  { value: 'answer_question', label: 'Answer a question' },
];

export const PLACEMENT_OPTIONS: Option[] = [
  { value: 'top_level', label: 'A new comment on the video' },
  { value: 'reply_top_comment', label: 'A reply to the top comment' },
  { value: 'reply_specific', label: 'A reply to one particular comment' },
];

export const MESSAGE_TYPE_OPTIONS: Option[] = [
  { value: 'insight', label: 'Share an insight' },
  { value: 'question', label: 'Ask a question' },
  { value: 'story', label: 'Tell a short story' },
  { value: 'appreciation', label: 'Show appreciation' },
  { value: 'mention_work', label: 'Mention our work' },
];

export const LENGTH_OPTIONS: Option[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
];

export const LINK_OPTIONS: Option[] = [
  { value: 'never', label: 'Never' },
  { value: 'if_natural', label: 'Only if it fits naturally' },
  { value: 'allowed', label: 'Allowed' },
];

export const MENTION_OPTIONS: Option[] = [
  { value: 'never', label: 'Never' },
  { value: 'subtle', label: 'In passing' },
  { value: 'open', label: 'Openly' },
];

export const REPEAT_OPTIONS: Option[] = [
  { value: 'once', label: 'Once' },
  { value: 'repeat', label: 'Again on a schedule' },
];

export const PRIORITY_OPTIONS: Option[] = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const STATUS_LABELS: Record<string, string> = { active: 'Active', paused: 'Paused', done: 'Done' };

export function labelFor(options: Option[], value: string): string {
  return options.find((o) => o.value === value)?.label || value || '—';
}

export function repeatSummary(target: Pick<Target, 'repeatMode' | 'repeatEveryDays' | 'repeatMaxTimes'>): string {
  if (target.repeatMode !== 'repeat') return 'One-off';
  const every = target.repeatEveryDays === 1 ? 'every day' : `every ${target.repeatEveryDays ?? '?'} days`;
  return `Repeats ${every}, up to ${target.repeatMaxTimes ?? '?'} times`;
}

// ── Forms: what the inputs hold, and what is sent ──────────────────────────

/** A target's settings as the edit form holds them — every number as text. */
export type TargetForm = {
  objective: string;
  commentPlacement: string;
  replyToCommentId: string;
  messageTypes: string[];
  commentLength: string;
  linkPolicy: string;
  linkUrl: string;
  mentionPolicy: string;
  repeatMode: string;
  repeatEveryDays: string;
  repeatMaxTimes: string;
  repeatUntil: string;
  priority: string;
  notes: string;
};

function numberText(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

export function targetToForm(target: Target): TargetForm {
  return {
    objective: target.objective,
    commentPlacement: target.commentPlacement,
    replyToCommentId: target.replyToCommentId || '',
    messageTypes: [...(target.messageTypes || [])],
    commentLength: target.commentLength,
    linkPolicy: target.linkPolicy,
    linkUrl: target.linkUrl || '',
    mentionPolicy: target.mentionPolicy,
    repeatMode: target.repeatMode,
    repeatEveryDays: numberText(target.repeatEveryDays),
    repeatMaxTimes: numberText(target.repeatMaxTimes),
    repeatUntil: target.repeatUntil || '',
    priority: target.priority,
    notes: target.notes || '',
  };
}

/**
 * The PATCH body for a target. Mode-only fields go blank when their mode is
 * off — the store refuses a reply-to comment on a top-level placement, and a
 * repeat schedule on a one-off, instead of quietly ignoring it. Numbers go as
 * the text typed; the server reads and bounds them and says so if it cannot.
 */
export function targetPatchFromForm(form: TargetForm): Record<string, unknown> {
  const repeating = form.repeatMode === 'repeat';
  return {
    objective: form.objective,
    commentPlacement: form.commentPlacement,
    replyToCommentId: form.commentPlacement === 'reply_specific' ? form.replyToCommentId.trim() : '',
    messageTypes: [...form.messageTypes],
    commentLength: form.commentLength,
    linkPolicy: form.linkPolicy,
    linkUrl: form.linkPolicy === 'never' ? '' : form.linkUrl.trim(),
    mentionPolicy: form.mentionPolicy,
    repeatMode: form.repeatMode,
    repeatEveryDays: repeating ? form.repeatEveryDays.trim() || null : null,
    repeatMaxTimes: repeating ? form.repeatMaxTimes.trim() || null : null,
    repeatUntil: repeating ? form.repeatUntil.trim() || null : null,
    priority: form.priority,
    notes: form.notes,
  };
}

export type SettingsForm = {
  maxCommentsPerDay: string;
  minMinutesBetween: string;
  jitterMinutes: string;
  activeStartHour: string;
  activeEndHour: string;
  timeZone: string;
  oneCommentPerVideo: boolean;
  avoidChannels: string;
  avoidWords: string;
  voice: string;
};

export function settingsToForm(settings: OutreachSettings): SettingsForm {
  return {
    maxCommentsPerDay: numberText(settings.maxCommentsPerDay),
    minMinutesBetween: numberText(settings.minMinutesBetween),
    jitterMinutes: numberText(settings.jitterMinutes),
    activeStartHour: numberText(settings.activeStartHour),
    activeEndHour: numberText(settings.activeEndHour),
    timeZone: settings.timeZone || '',
    oneCommentPerVideo: settings.oneCommentPerVideo !== false,
    avoidChannels: (settings.avoidChannels || []).join('\n'),
    avoidWords: (settings.avoidWords || []).join('\n'),
    voice: settings.voice || '',
  };
}

/** One entry per line (commas also split), blanks dropped. */
export function splitList(text: string): string[] {
  return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export function settingsPatchFromForm(form: SettingsForm): Record<string, unknown> {
  return {
    maxCommentsPerDay: form.maxCommentsPerDay.trim(),
    minMinutesBetween: form.minMinutesBetween.trim(),
    jitterMinutes: form.jitterMinutes.trim(),
    activeStartHour: form.activeStartHour.trim(),
    activeEndHour: form.activeEndHour.trim(),
    timeZone: form.timeZone.trim(),
    oneCommentPerVideo: form.oneCommentPerVideo,
    avoidChannels: splitList(form.avoidChannels),
    avoidWords: splitList(form.avoidWords),
    voice: form.voice,
  };
}

function thumbnailUrl(videoId: string): string {
  const safe = String(videoId || '').replace(/[^A-Za-z0-9_-]/g, '');
  return safe ? `https://i.ytimg.com/vi/${safe}/mqdefault.jpg` : '';
}

// ── Small form pieces ──────────────────────────────────────────────────────

/**
 * One label/field pair on the form grid. Every pair sits on the same two
 * tracks (_youtube-outreach.css), so every label is one width and every field
 * starts at one x — W0 by construction rather than by luck.
 */
function Field({ label, htmlFor, help, children }: {
  label: string;
  htmlFor: string;
  help?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="yt-outreach-field">
      <label className="yt-outreach-field-label" htmlFor={htmlFor}>{label}</label>
      <div className="yt-outreach-field-control">
        {children}
        {help ? <p className="yt-outreach-field-help">{help}</p> : null}
      </div>
    </div>
  );
}

function Select({ id, value, options, onChange }: {
  id: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── The target editor ──────────────────────────────────────────────────────

function TargetEditor({ target, busy, error, onSave, onCancel }: {
  target: Target;
  busy: boolean;
  error: string;
  onSave: (form: TargetForm) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [form, setForm] = useState<TargetForm>(() => targetToForm(target));
  const set = <K extends keyof TargetForm>(key: K, value: TargetForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleType = (type: string) => setForm((f) => ({
    ...f,
    messageTypes: f.messageTypes.includes(type) ? f.messageTypes.filter((t) => t !== type) : [...f.messageTypes, type],
  }));

  return (
    <form
      className="yt-outreach-card yt-outreach-editor"
      aria-label="Edit target video"
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
    >
      <h3 className="yt-outreach-card-title">
        {`Edit: ${target.videoTitle || target.videoUrl}`}
      </h3>
      <div className="yt-outreach-form">
        <Field label="What it is for" htmlFor="yto-objective">
          <Select id="yto-objective" value={form.objective} options={OBJECTIVE_OPTIONS} onChange={(v) => set('objective', v)} />
        </Field>
        <Field label="Where to comment" htmlFor="yto-placement">
          <Select id="yto-placement" value={form.commentPlacement} options={PLACEMENT_OPTIONS} onChange={(v) => set('commentPlacement', v)} />
        </Field>
        {form.commentPlacement === 'reply_specific' ? (
          <Field label="Comment to reply to" htmlFor="yto-reply-to" help="The comment's id, from the end of its link (…&lc=THIS_PART).">
            <input id="yto-reply-to" type="text" value={form.replyToCommentId} onChange={(e) => set('replyToCommentId', e.target.value)} />
          </Field>
        ) : null}
        <Field label="Kind of message" htmlFor="yto-type-insight" help="Pick at least one.">
          <div className="yt-outreach-checks" role="group" aria-label="Kind of message">
            {MESSAGE_TYPE_OPTIONS.map((o) => (
              <label key={o.value} className="yt-outreach-check">
                <input
                  id={`yto-type-${o.value}`}
                  type="checkbox"
                  checked={form.messageTypes.includes(o.value)}
                  onChange={() => toggleType(o.value)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Length" htmlFor="yto-length">
          <Select id="yto-length" value={form.commentLength} options={LENGTH_OPTIONS} onChange={(v) => set('commentLength', v)} />
        </Field>
        <Field label="Include a link" htmlFor="yto-link-policy">
          <Select id="yto-link-policy" value={form.linkPolicy} options={LINK_OPTIONS} onChange={(v) => set('linkPolicy', v)} />
        </Field>
        {form.linkPolicy !== 'never' ? (
          <Field label="Link to use" htmlFor="yto-link-url">
            <input id="yto-link-url" type="url" placeholder="https://" value={form.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} />
          </Field>
        ) : null}
        <Field label="Mention Dane of Earth" htmlFor="yto-mention">
          <Select id="yto-mention" value={form.mentionPolicy} options={MENTION_OPTIONS} onChange={(v) => set('mentionPolicy', v)} />
        </Field>
        <Field label="How often" htmlFor="yto-repeat">
          <Select id="yto-repeat" value={form.repeatMode} options={REPEAT_OPTIONS} onChange={(v) => set('repeatMode', v)} />
        </Field>
        {form.repeatMode === 'repeat' ? (
          <>
            <Field label="Every how many days" htmlFor="yto-every">
              <input id="yto-every" type="number" min={1} max={365} value={form.repeatEveryDays} onChange={(e) => set('repeatEveryDays', e.target.value)} />
            </Field>
            <Field label="At most how many times" htmlFor="yto-max-times">
              <input id="yto-max-times" type="number" min={1} max={100} value={form.repeatMaxTimes} onChange={(e) => set('repeatMaxTimes', e.target.value)} />
            </Field>
            <Field label="Stop after" htmlFor="yto-until" help="Optional. Leave blank to stop only when the count is reached.">
              <input id="yto-until" type="date" value={form.repeatUntil} onChange={(e) => set('repeatUntil', e.target.value)} />
            </Field>
          </>
        ) : null}
        <Field label="Priority" htmlFor="yto-priority">
          <Select id="yto-priority" value={form.priority} options={PRIORITY_OPTIONS} onChange={(v) => set('priority', v)} />
        </Field>
        <Field label="Notes for the agent" htmlFor="yto-notes">
          <textarea id="yto-notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      {error ? <p className="yt-outreach-error" role="alert">{error}</p> : null}
      <div className="yt-outreach-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

// ── Account settings ───────────────────────────────────────────────────────

function SettingsEditor({ settings, busy, error, onSave, onCancel }: {
  settings: OutreachSettings;
  busy: boolean;
  error: string;
  onSave: (form: SettingsForm) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [form, setForm] = useState<SettingsForm>(() => settingsToForm(settings));
  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="yt-outreach-card yt-outreach-settings"
      aria-label="Account settings"
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
    >
      <h3 className="yt-outreach-card-title">Account settings</h3>
      <p className="yt-outreach-card-note">
        {settings.saved
          ? 'These limits apply to every video on the list.'
          : 'Nothing has been saved for this account yet — these are the starting limits. Save to keep them.'}
      </p>
      <div className="yt-outreach-form">
        <Field label="Most comments per day" htmlFor="yto-max-per-day">
          <input id="yto-max-per-day" type="number" min={0} max={100} value={form.maxCommentsPerDay} onChange={(e) => set('maxCommentsPerDay', e.target.value)} />
        </Field>
        <Field label="Shortest gap (minutes)" htmlFor="yto-min-gap" help="The least time between two comments.">
          <input id="yto-min-gap" type="number" min={0} max={1440} value={form.minMinutesBetween} onChange={(e) => set('minMinutesBetween', e.target.value)} />
        </Field>
        <Field label="Random extra (minutes)" htmlFor="yto-jitter" help="Up to this much is added to each gap, so comments do not arrive like clockwork.">
          <input id="yto-jitter" type="number" min={0} max={1440} value={form.jitterMinutes} onChange={(e) => set('jitterMinutes', e.target.value)} />
        </Field>
        <Field label="Active from (hour)" htmlFor="yto-start-hour" help="0–23, on a 24-hour clock.">
          <input id="yto-start-hour" type="number" min={0} max={23} value={form.activeStartHour} onChange={(e) => set('activeStartHour', e.target.value)} />
        </Field>
        <Field label="Active until (hour)" htmlFor="yto-end-hour" help="1–24. Must be later than the start.">
          <input id="yto-end-hour" type="number" min={1} max={24} value={form.activeEndHour} onChange={(e) => set('activeEndHour', e.target.value)} />
        </Field>
        <Field label="Time zone" htmlFor="yto-time-zone" help="For example America/Denver. Blank uses this project's own time zone.">
          <input id="yto-time-zone" type="text" value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)} />
        </Field>
        <Field label="One comment per video" htmlFor="yto-one-per-video">
          <label className="yt-outreach-check">
            <input id="yto-one-per-video" type="checkbox" checked={form.oneCommentPerVideo} onChange={(e) => set('oneCommentPerVideo', e.target.checked)} />
            <span>Never comment on a video more than once, unless that video is set to repeat</span>
          </label>
        </Field>
        <Field label="Channels to avoid" htmlFor="yto-avoid-channels" help="One per line.">
          <textarea id="yto-avoid-channels" rows={3} value={form.avoidChannels} onChange={(e) => set('avoidChannels', e.target.value)} />
        </Field>
        <Field label="Words to avoid" htmlFor="yto-avoid-words" help="One per line.">
          <textarea id="yto-avoid-words" rows={3} value={form.avoidWords} onChange={(e) => set('avoidWords', e.target.value)} />
        </Field>
        <Field label="Voice" htmlFor="yto-voice" help="How the comments should sound, in your own words.">
          <textarea id="yto-voice" rows={4} value={form.voice} onChange={(e) => set('voice', e.target.value)} />
        </Field>
      </div>
      {error ? <p className="yt-outreach-error" role="alert">{error}</p> : null}
      <div className="yt-outreach-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Close</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────

export default function YoutubeOutreachPanel(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  // Bumped on every project switch. A save started under one project checks
  // it before showing its reply; requestSeq cannot serve, because a Refresh
  // pressed during the save would wrongly discard a reply that is still valid.
  const projectEpoch = useRef(0);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [settings, setSettings] = useState<OutreachSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [rowBusy, setRowBusy] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    // Read both, and say which one failed: a missing settings row must not
    // be reported as a missing list, or hide a list that read fine.
    const [list, limits] = await Promise.allSettled([api(TARGETS_PATH), api(SETTINGS_PATH)]);
    if (seq !== requestSeq.current) return;
    const problems: string[] = [];
    if (list.status === 'fulfilled') {
      setTargets(Array.isArray(list.value?.data) ? (list.value.data as Target[]) : []);
    } else {
      setTargets(null);
      problems.push(`The outreach list could not be read: ${errorText(list.reason, 'unknown error')}`);
    }
    if (limits.status === 'fulfilled') {
      setSettings((limits.value?.data as OutreachSettings) || null);
    } else {
      setSettings(null);
      setSettingsOpen(false);
      problems.push(`The account settings could not be read: ${errorText(limits.reason, 'unknown error')}`);
    }
    setError(problems.join(' '));
    setLoading(false);
  }, []);

  // Load each time the page is shown.
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

  // A project switch: drop the old client's list and any open editor at once,
  // and read the new client's now if the page is on screen.
  useEffect(() => {
    const onSwitch = () => {
      requestSeq.current += 1;
      projectEpoch.current += 1;
      setTargets(null);
      setSettings(null);
      setError('');
      setNotice('');
      setLoading(false);
      setEditingId('');
      setSettingsOpen(false);
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    };
    window.addEventListener(PROJECT_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, onSwitch);
  }, [load]);

  const replaceTarget = (next: Target) => {
    setTargets((list) => (list || []).map((t) => (t.id === next.id ? next : t)));
  };

  const addTarget = async (event: React.FormEvent) => {
    event.preventDefault();
    const api = getApi();
    const videoUrl = addUrl.trim();
    if (!api || !videoUrl) return;
    const link = withScheme(videoUrl);
    setAdding(true);
    setError('');
    setNotice('');
    try {
      const body = await api(TARGETS_PATH, { method: 'POST', body: JSON.stringify({ videoUrl: link }) });
      const created = body?.data as Target;
      setAddUrl('');
      setNotice(created?.detailsError
        ? `Added, but the title and channel could not be read: ${created.detailsError}`
        : `Added "${created?.videoTitle || videoUrl}".`);
      await load();
    } catch (err) {
      setError(`The video was not added: ${errorText(err, 'unknown error')}`);
    } finally {
      setAdding(false);
    }
  };

  const setStatus = async (target: Target, action: 'pause' | 'resume') => {
    const api = getApi();
    if (!api) return;
    setRowBusy(target.id);
    setError('');
    try {
      const body = await api(`${TARGETS_PATH}/${encodeURIComponent(target.id)}/${action}`, { method: 'POST' });
      replaceTarget(body.data as Target);
    } catch (err) {
      setError(`Could not ${action} "${target.videoTitle || target.videoUrl}": ${errorText(err, 'unknown error')}`);
    } finally {
      setRowBusy('');
    }
  };

  const removeTarget = async (target: Target) => {
    const api = getApi();
    if (!api) return;
    const name = target.videoTitle || target.videoUrl;
    if (!window.confirm(`Remove "${name}" from the outreach list? Its settings are deleted with it.`)) return;
    setRowBusy(target.id);
    setError('');
    try {
      await api(`${TARGETS_PATH}/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      setTargets((list) => (list || []).filter((t) => t.id !== target.id));
      if (editingId === target.id) setEditingId('');
      setNotice(`Removed "${name}".`);
    } catch (err) {
      setError(`"${name}" was not removed: ${errorText(err, 'unknown error')}`);
    } finally {
      setRowBusy('');
    }
  };

  const saveTarget = async (target: Target, form: TargetForm) => {
    const api = getApi();
    if (!api) return;
    setEditBusy(true);
    setEditError('');
    try {
      const body = await api(`${TARGETS_PATH}/${encodeURIComponent(target.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(targetPatchFromForm(form)),
      });
      replaceTarget(body.data as Target);
      setEditingId('');
      setNotice(`Saved "${target.videoTitle || target.videoUrl}".`);
    } catch (err) {
      setEditError(`Not saved: ${errorText(err, 'unknown error')}`);
    } finally {
      setEditBusy(false);
    }
  };

  const saveSettings = async (form: SettingsForm) => {
    const api = getApi();
    if (!api) return;
    const epoch = projectEpoch.current;
    setSettingsBusy(true);
    setSettingsError('');
    try {
      const body = await api(SETTINGS_PATH, { method: 'PUT', body: JSON.stringify(settingsPatchFromForm(form)) });
      // The project changed while this was in flight: the reply is the OLD
      // project's limits, and the switch has already loaded the new one's.
      if (epoch !== projectEpoch.current) return;
      setSettings(body.data as OutreachSettings);
      setSettingsOpen(false);
      setNotice('Account settings saved.');
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setSettingsError(`Not saved: ${errorText(err, 'unknown error')}`);
    } finally {
      setSettingsBusy(false);
    }
  };

  const editing = (targets || []).find((t) => t.id === editingId) || null;

  return (
    <div ref={hostRef} className="yt-outreach-panel">
      <div className="yt-outreach-toolbar">
        <form className="yt-outreach-add" onSubmit={addTarget}>
          <label className="yt-outreach-add-label" htmlFor="yto-add-url">YouTube link</label>
          <input
            id="yto-add-url"
            type="text"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={adding || !addUrl.trim()}>
            {adding ? 'Adding…' : 'Add'}
          </button>
        </form>
        <div className="yt-outreach-toolbar-actions">
          <button
            type="button"
            className="btn"
            disabled={!settings}
            aria-expanded={settingsOpen}
            onClick={() => { setSettingsError(''); setSettingsOpen((open) => !open); }}
          >
            Account settings
          </button>
          <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? <p className="yt-outreach-error" role="alert">{error}</p> : null}
      {notice ? <p className="yt-outreach-notice" role="status">{notice}</p> : null}

      {settingsOpen && settings ? (
        <SettingsEditor
          key={settings.updatedAt || 'unsaved'}
          settings={settings}
          busy={settingsBusy}
          error={settingsError}
          onSave={(form) => void saveSettings(form)}
          onCancel={() => setSettingsOpen(false)}
        />
      ) : null}

      {editing ? (
        <TargetEditor
          key={editing.id}
          target={editing}
          busy={editBusy}
          error={editError}
          onSave={(form) => void saveTarget(editing, form)}
          onCancel={() => setEditingId('')}
        />
      ) : null}

      {targets && !targets.length ? (
        <p className="yt-outreach-empty">No target videos yet. Paste a YouTube link above to add the first one.</p>
      ) : null}

      {targets && targets.length ? (
        <div className="table-wrap yt-outreach-table-wrap">
          <table className="yt-outreach-table">
            <thead>
              <tr>
                <th scope="col">Video</th>
                <th scope="col">Objective</th>
                <th scope="col">Length</th>
                <th scope="col">How often</th>
                <th scope="col">Priority</th>
                <th scope="col">Status</th>
                <th scope="col" className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => {
                const thumb = thumbnailUrl(target.videoId);
                const busy = rowBusy === target.id;
                return (
                  <tr key={target.id} data-target-id={target.id}>
                    <td>
                      <div className="yt-outreach-video">
                        {thumb ? <img className="yt-outreach-thumb" src={thumb} alt="" loading="lazy" /> : null}
                        <div className="yt-outreach-video-text">
                          <a href={target.videoUrl} target="_blank" rel="noopener noreferrer" className="yt-outreach-video-title">
                            {target.videoTitle || target.videoUrl}
                          </a>
                          <span className="yt-outreach-video-channel">
                            {target.channelName || (target.detailsError ? `Title not read: ${target.detailsError}` : 'Channel not known')}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>{labelFor(OBJECTIVE_OPTIONS, target.objective)}</td>
                    <td>{labelFor(LENGTH_OPTIONS, target.commentLength)}</td>
                    <td>{repeatSummary(target)}</td>
                    <td>{labelFor(PRIORITY_OPTIONS, target.priority)}</td>
                    <td>{STATUS_LABELS[target.status] || target.status}</td>
                    <td className="actions-col">
                      <div className="table-actions-row">
                        {target.status === 'paused' ? (
                          <button type="button" className="btn" disabled={busy} onClick={() => void setStatus(target, 'resume')}>Resume</button>
                        ) : target.status === 'active' ? (
                          <button type="button" className="btn" disabled={busy} onClick={() => void setStatus(target, 'pause')}>Pause</button>
                        ) : null}
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => { setEditError(''); setEditingId(target.id); }}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void removeTarget(target)}>Delete</button>
                      </div>
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
