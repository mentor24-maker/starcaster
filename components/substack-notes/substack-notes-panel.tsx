import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Engage › Substack Notes — where Dane feeds the Substack Notes agent: ideas
 * for Notes of his own, other people's Notes to reply to, restack or like,
 * and the account-wide settings. Substack Notes 2/7 (task 86bcet6g7).
 *
 * A React island in the frozen vanilla app, mounted into
 * #substackNotesReactRoot by react-entry.js. Data: /api/engage/substack-notes
 * (routes/substackNotes.js over lib/substackNotesStore.js, slice 1/7).
 * Nothing here posts; everything added waits as an `idea`.
 *
 * DRAFTS AND APPROVAL (3/7, task 86bcet6pa). An idea or a reply row has
 * "Write a draft"; the AI's words land on the Approvals tab in an editable
 * box, beside Approve / Reject / Write another. A restack or a like has no
 * words, so it is on Approvals from the moment it is added, with just Approve
 * and Reject. Approve sends the box's text and the SERVER checks it against
 * the account's rules (link setting, words to avoid, length), so an edit
 * cannot approve something the rules forbid; its refusal is shown as said.
 *
 * The shape is components/youtube-outreach/youtube-outreach-panel.tsx's on
 * purpose: the server owns every rule and this screen shows its sentence when
 * it refuses; it (re)loads when its page is SHOWN and when the project is
 * SWITCHED, and drops a reply that lands after a newer request or a switch.
 *
 * POSTED (6/7, task 86bcet7qr). The Mini's posting worker
 * (workers/youtube-outreach/adapters/substack.js) takes approved items. An
 * approved row says why it is still waiting, in the worker's words ("waiting
 * for tomorrow's allowance"); the Posted tab lists what went out, when, the
 * link and the screenshot, what failed and why, and any row the worker could
 * not prove either way as "check this one by hand" — it is never retried.
 *
 * EMPTY IS ALWAYS EXPLAINED (CLAUDE.md landmine 17): "no ideas yet", "no
 * Notes to engage with yet", "no topics yet", "nothing saved yet", and a read
 * that fails names WHICH read failed.
 */

const ITEMS_PATH = '/api/engage/substack-notes/items';
const SETTINGS_PATH = '/api/engage/substack-notes/settings';

/** The window event public/js/projectContext.js emits on every project switch. */
export const PROJECT_SWITCH_EVENT = 'projectContext:session-changed';

export type NoteItem = {
  id: string;
  accountKey: string;
  kind: string;
  source: string;
  ideaText: string;
  contentUrl: string;
  contentTitle: string;
  targetUrl: string;
  targetText: string;
  draftText: string;
  finalText: string;
  status: string;
  postedUrl: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  screenshotUrl?: string;
  postedAt?: string | null;
  postingStartedAt?: string | null;
  postNote?: string;
  waitReason?: string;
  waitCheckedAt?: string | null;
  needsHandCheck?: boolean;
};

export type NotesSettings = {
  accountKey: string;
  substackUrl: string;
  youtubeChannelId: string;
  maxActionsPerDay: number | null;
  minMinutesBetween: number | null;
  jitterMinutes: number | null;
  activeStartHour: number | null;
  activeEndHour: number | null;
  timeZone: string;
  voice: string;
  topics: string[];
  avoidWords: string[];
  linkPolicy: string;
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

/**
 * The store names fields the way the code does ("targetUrl must be…"). Say the
 * label Dane sees on this screen instead; the rest of the sentence is the
 * server's own.
 */
const FIELD_WORDS: Array<[RegExp, string]> = [
  [/\btargetUrl\b/g, 'The link'],
  [/\bideaText\b/g, 'The idea'],
  [/\bsubstackUrl\b/g, 'Substack address'],
  [/\byoutubeChannelId\b/g, 'YouTube channel'],
  [/\bmaxActionsPerDay\b/g, 'Most actions per day'],
  [/\bminMinutesBetween\b/g, 'Shortest gap'],
  [/\bjitterMinutes\b/g, 'Random extra'],
  [/\bactiveStartHour\b/g, 'Active from'],
  [/\bactiveEndHour\b/g, 'Active until'],
  [/\btimeZone\b/g, 'Time zone'],
  [/\bavoidWords\b/g, 'Words to avoid'],
  [/\blinkPolicy\b/g, 'Links'],
  [/\btargetText\b/g, 'Their Note'],
];

export function plainError(message: string): string {
  return FIELD_WORDS.reduce((text, [pattern, words]) => text.replace(pattern, words), message);
}

function errorText(err: unknown, fallback: string): string {
  return plainError(err instanceof Error && err.message ? err.message : fallback);
}

/** People paste "substack.com/@name/note/c-1" without the https://. Add it rather than refuse. */
export function withScheme(link: string): string {
  const trimmed = link.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

type Option = { value: string; label: string };

export const ENGAGE_OPTIONS: Option[] = [
  { value: 'reply', label: 'Reply' },
  { value: 'restack', label: 'Restack' },
  { value: 'like', label: 'Like' },
];

export const LINK_OPTIONS: Option[] = [
  { value: 'never', label: 'Never' },
  { value: 'if_natural', label: 'Only if it fits naturally' },
  { value: 'allowed', label: 'Allowed' },
];

export const SOURCE_LABELS: Record<string, string> = {
  jotted: 'Jotted',
  topic: 'From a topic',
  new_content: 'New content',
  target: 'Someone else\'s Note',
};

export const STATUS_LABELS: Record<string, string> = {
  idea: 'Waiting to be drafted',
  draft: 'Draft waiting for approval',
  approved: 'Approved — waiting to post',
  rejected: 'Rejected',
  posting: 'Posting…',
  posted: 'Posted',
  failed: 'Failed to post',
};

/** A restack or a like has no words, so it waits for approval rather than a draft. */
export function statusLabel(item: Pick<NoteItem, 'kind' | 'status'>): string {
  if (item.status === 'idea' && (item.kind === 'restack' || item.kind === 'like')) return 'Waiting for approval';
  return STATUS_LABELS[item.status] || item.status;
}

/**
 * The words an item will post (or would have), for its Ideas / Engage row.
 * Once a Note or reply leaves `idea`, its row is the only place left on the
 * screen that can show them — an approved item leaves Approvals — so without
 * this line Dane's edit was invisible after a reload. Restacks and likes have
 * no words, so they get nothing.
 */
export function wordsLine(item: Pick<NoteItem, 'kind' | 'status' | 'draftText' | 'finalText'>): string {
  if (item.kind !== 'note' && item.kind !== 'reply') return '';
  const final = item.finalText || item.draftText;
  switch (item.status) {
    case 'draft': return item.draftText ? `Draft: ${item.draftText}` : '';
    case 'rejected': return item.draftText ? `Rejected draft: ${item.draftText}` : '';
    case 'approved':
    case 'posting':
    case 'failed': return final ? `Will post: ${final}` : '';
    case 'posted': return final ? `Posted: ${final}` : '';
    default: return '';
  }
}

export function labelFor(options: Option[], value: string): string {
  return options.find((o) => o.value === value)?.label || value || '—';
}

function shortDate(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const KIND_LABELS: Record<string, string> = {
  note: 'Note',
  reply: 'Reply',
  restack: 'Restack',
  like: 'Like',
};

/** On the Approvals tab: a drafted Note or reply, or a restack/like not yet decided. */
export function awaitsApproval(item: Pick<NoteItem, 'kind' | 'status'>): boolean {
  return item.kind === 'note' || item.kind === 'reply' ? item.status === 'draft' : item.status === 'idea';
}

/** What an item on Approvals came from, in a line. */
export function cameFrom(item: NoteItem): string {
  if (item.kind === 'note') {
    if (item.source === 'new_content') return `New content: ${item.contentTitle || item.contentUrl}`;
    return `${SOURCE_LABELS[item.source] || item.source} idea: ${item.ideaText}`;
  }
  return item.targetUrl;
}

// ── What the Mini did ──────────────────────────────────────────────────────

/** "Oct 8, 3:42 PM" in the viewer's own time, or '' when there is no time. */
export function whenText(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Everything the worker has taken: on the Posted tab, newest first. */
export function postedItems(items: NoteItem[]): NoteItem[] {
  const at = (i: NoteItem) => Date.parse(i.postedAt || i.postingStartedAt || i.updatedAt || '') || 0;
  return items
    .filter((i) => i.status === 'posting' || i.status === 'posted' || i.status === 'failed')
    .sort((a, b) => at(b) - at(a));
}

/** The status line on a Posted row. A `posting` row is either live work or a hand check. */
export function postedStatusText(item: Pick<NoteItem, 'kind' | 'status' | 'postedAt' | 'needsHandCheck'>): string {
  const what = KIND_LABELS[item.kind] || item.kind;
  if (item.status === 'posted') {
    const verb = item.kind === 'like' ? 'Liked' : item.kind === 'restack' ? 'Restacked' : `${what} posted`;
    return `${verb} ${whenText(item.postedAt)}`.trim();
  }
  if (item.status === 'failed') return `${what} failed`;
  if (item.needsHandCheck) return `${what}: check this one by hand — it will not be tried again`;
  return `${what}: being done now…`;
}

/** Under an approved item's status: why it has not gone out yet. */
export function waitLine(item: Pick<NoteItem, 'status' | 'waitReason' | 'waitCheckedAt'>): string {
  if (item.status !== 'approved') return '';
  if (!item.waitReason) return 'The Mini takes it at its next pass. If a limit holds it, the reason shows here.';
  const checked = whenText(item.waitCheckedAt);
  return checked ? `${item.waitReason} (checked ${checked})` : item.waitReason;
}

/** Ideas are Notes of his own; everything aimed at someone else's Note is on the Engage tab. */
export function splitItems(items: NoteItem[]): { ideas: NoteItem[]; engage: NoteItem[] } {
  return {
    ideas: items.filter((i) => i.kind === 'note'),
    engage: items.filter((i) => i.kind !== 'note'),
  };
}

// ── Settings form ──────────────────────────────────────────────────────────

export type SettingsForm = {
  substackUrl: string;
  youtubeChannelId: string;
  maxActionsPerDay: string;
  minMinutesBetween: string;
  jitterMinutes: string;
  activeStartHour: string;
  activeEndHour: string;
  timeZone: string;
  voice: string;
  topics: string;
  avoidWords: string;
  linkPolicy: string;
};

function numberText(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

export function settingsToForm(settings: NotesSettings): SettingsForm {
  return {
    substackUrl: settings.substackUrl || '',
    youtubeChannelId: settings.youtubeChannelId || '',
    maxActionsPerDay: numberText(settings.maxActionsPerDay),
    minMinutesBetween: numberText(settings.minMinutesBetween),
    jitterMinutes: numberText(settings.jitterMinutes),
    activeStartHour: numberText(settings.activeStartHour),
    activeEndHour: numberText(settings.activeEndHour),
    timeZone: settings.timeZone || '',
    voice: settings.voice || '',
    topics: (settings.topics || []).join('\n'),
    avoidWords: (settings.avoidWords || []).join('\n'),
    linkPolicy: settings.linkPolicy || 'if_natural',
  };
}

/** One entry per line, blanks dropped. Topics can carry commas, so only lines split. */
export function splitLines(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

export function settingsPatchFromForm(form: SettingsForm): Record<string, unknown> {
  return {
    substackUrl: withScheme(form.substackUrl),
    youtubeChannelId: form.youtubeChannelId.trim(),
    maxActionsPerDay: form.maxActionsPerDay.trim(),
    minMinutesBetween: form.minMinutesBetween.trim(),
    jitterMinutes: form.jitterMinutes.trim(),
    activeStartHour: form.activeStartHour.trim(),
    activeEndHour: form.activeEndHour.trim(),
    timeZone: form.timeZone.trim(),
    voice: form.voice,
    topics: splitLines(form.topics),
    avoidWords: splitLines(form.avoidWords),
    linkPolicy: form.linkPolicy,
  };
}

// ── Small form pieces ──────────────────────────────────────────────────────

/**
 * One label/field pair on the settings grid. Every pair sits on the same two
 * tracks (_substack-notes.css) — W0 by construction, as on YouTube Outreach.
 */
function Field({ label, htmlFor, help, children }: {
  label: string;
  htmlFor: string;
  help?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="substack-notes-field">
      <label className="substack-notes-field-label" htmlFor={htmlFor}>{label}</label>
      <div className="substack-notes-field-control">
        {children}
        {help ? <p className="substack-notes-field-help">{help}</p> : null}
      </div>
    </div>
  );
}

function SettingsEditor({ settings, busy, error, onSave }: {
  settings: NotesSettings;
  busy: boolean;
  error: string;
  onSave: (form: SettingsForm) => void;
}): React.ReactElement {
  const [form, setForm] = useState<SettingsForm>(() => settingsToForm(settings));
  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="substack-notes-card substack-notes-settings"
      aria-label="Substack Notes settings"
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
    >
      <p className="substack-notes-card-note">
        {settings.saved
          ? 'These settings apply to everything the Notes agent does for this account.'
          : 'Nothing has been saved for this account yet — these are the starting settings. Save to keep them.'}
      </p>
      <div className="substack-notes-form">
        <Field label="Substack address" htmlFor="sn-substack-url" help="Your publication, for example https://daneofearth.substack.com">
          <input id="sn-substack-url" type="text" inputMode="url" placeholder="https://" value={form.substackUrl} onChange={(e) => set('substackUrl', e.target.value)} />
        </Field>
        <Field label="YouTube channel" htmlFor="sn-youtube-channel" help="The channel id: starts with UC, 24 characters. Optional.">
          <input id="sn-youtube-channel" type="text" value={form.youtubeChannelId} onChange={(e) => set('youtubeChannelId', e.target.value)} />
        </Field>
        <Field label="Most actions per day" htmlFor="sn-max-per-day" help="Notes, replies, restacks and likes all count.">
          <input id="sn-max-per-day" type="number" min={0} max={50} value={form.maxActionsPerDay} onChange={(e) => set('maxActionsPerDay', e.target.value)} />
        </Field>
        <Field label="Shortest gap (minutes)" htmlFor="sn-min-gap" help="The least time between two actions.">
          <input id="sn-min-gap" type="number" min={0} max={1440} value={form.minMinutesBetween} onChange={(e) => set('minMinutesBetween', e.target.value)} />
        </Field>
        <Field label="Random extra (minutes)" htmlFor="sn-jitter" help="Up to this much is added to each gap, so actions do not arrive like clockwork.">
          <input id="sn-jitter" type="number" min={0} max={1440} value={form.jitterMinutes} onChange={(e) => set('jitterMinutes', e.target.value)} />
        </Field>
        <Field label="Active from (hour)" htmlFor="sn-start-hour" help="0–23, on a 24-hour clock.">
          <input id="sn-start-hour" type="number" min={0} max={23} value={form.activeStartHour} onChange={(e) => set('activeStartHour', e.target.value)} />
        </Field>
        <Field label="Active until (hour)" htmlFor="sn-end-hour" help="1–24. Must be later than the start.">
          <input id="sn-end-hour" type="number" min={1} max={24} value={form.activeEndHour} onChange={(e) => set('activeEndHour', e.target.value)} />
        </Field>
        <Field label="Time zone" htmlFor="sn-time-zone" help="For example America/Denver. Blank uses this project's own time zone.">
          <input id="sn-time-zone" type="text" value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)} />
        </Field>
        <Field label="Voice" htmlFor="sn-voice" help="How the Notes should sound, in your own words.">
          <textarea id="sn-voice" rows={4} value={form.voice} onChange={(e) => set('voice', e.target.value)} />
        </Field>
        <Field label="Topics" htmlFor="sn-topics" help="One per line. They appear on the Ideas tab, ready to use.">
          <textarea id="sn-topics" rows={4} value={form.topics} onChange={(e) => set('topics', e.target.value)} />
        </Field>
        <Field label="Words to avoid" htmlFor="sn-avoid-words" help="One per line.">
          <textarea id="sn-avoid-words" rows={3} value={form.avoidWords} onChange={(e) => set('avoidWords', e.target.value)} />
        </Field>
        <Field label="Links" htmlFor="sn-link-policy" help="Whether a Note or reply may include a link to your work.">
          <select id="sn-link-policy" value={form.linkPolicy} onChange={(e) => set('linkPolicy', e.target.value)}>
            {LINK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      </div>
      {error ? <p className="substack-notes-error" role="alert">{error}</p> : null}
      <div className="substack-notes-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

// ── Row editing ────────────────────────────────────────────────────────────

/** The words on a row, edited in place. Save sends them; the server answers. */
function TextEditor({ id, label, initial, busy, onSave, onCancel }: {
  id: string;
  label: string;
  initial: string;
  busy: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [text, setText] = useState(initial);
  return (
    <form className="substack-notes-row-editor" onSubmit={(e) => { e.preventDefault(); onSave(text); }}>
      <label className="substack-notes-sr-only" htmlFor={id}>{label}</label>
      <textarea id={id} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="substack-notes-actions">
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

// ── One item on the Approvals tab ──────────────────────────────────────────

function ApprovalCard({ item, busy, error, onApprove, onReject, onRedraft }: {
  item: NoteItem;
  busy: boolean;
  error: string;
  onApprove: (text?: string) => void;
  onReject: () => void;
  onRedraft: () => void;
}): React.ReactElement {
  const hasWords = item.kind === 'note' || item.kind === 'reply';
  const [text, setText] = useState(item.draftText);
  const boxId = `sn-draft-${item.id}`;
  const kind = KIND_LABELS[item.kind] || item.kind;

  return (
    <article className="substack-notes-card substack-notes-approval" data-item-id={item.id} aria-label={`${kind} waiting for approval`}>
      <h3 className="substack-notes-card-title">{kind}</h3>
      <p className="substack-notes-card-note">
        <strong>From: </strong>
        {item.kind === 'note' ? (
          <span className="substack-notes-text">{cameFrom(item)}</span>
        ) : (
          <a href={item.targetUrl} target="_blank" rel="noopener noreferrer" className="substack-notes-link">{item.targetUrl}</a>
        )}
      </p>
      {item.kind === 'reply' && item.targetText ? (
        <p className="substack-notes-card-note substack-notes-text"><strong>Their Note: </strong>{item.targetText}</p>
      ) : null}
      {hasWords ? (
        <>
          <label className="substack-notes-add-label" htmlFor={boxId}>{kind}</label>
          <textarea id={boxId} className="substack-notes-draft-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="substack-notes-field-help">{`${text.trim().length} characters`}</p>
        </>
      ) : (
        <p className="substack-notes-card-note">{`No words — a ${kind.toLowerCase()} is just the click.`}</p>
      )}
      {error ? <p className="substack-notes-error" role="alert">{error}</p> : null}
      <div className="substack-notes-actions">
        {hasWords ? <button type="button" className="btn" disabled={busy} onClick={onRedraft}>Write another</button> : null}
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onReject}>Reject</button>
        <button type="button" className="btn btn-primary" disabled={busy || (hasWords && !text.trim())} onClick={() => onApprove(hasWords ? text : undefined)}>
          {busy ? 'Working…' : 'Approve'}
        </button>
      </div>
    </article>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────

type Tab = 'ideas' | 'engage' | 'approvals' | 'posted' | 'settings';

function PostedRow({ item }: { item: NoteItem }): React.ReactElement {
  const handCheck = item.status === 'posting' && Boolean(item.needsHandCheck);
  const words = item.finalText || item.draftText;
  const linkLabel = item.kind === 'like' || item.kind === 'restack' ? 'Open the Note' : 'View on Substack';
  return (
    <li className={`substack-notes-posted-row is-${handCheck ? 'hand-check' : item.status}`} data-item-id={item.id}>
      {item.screenshotUrl ? (
        <a className="substack-notes-posted-shot" href={item.screenshotUrl} target="_blank" rel="noopener noreferrer">
          <img src={item.screenshotUrl} alt={`Screenshot of the ${(KIND_LABELS[item.kind] || item.kind).toLowerCase()} on Substack`} loading="lazy" />
        </a>
      ) : null}
      <div className="substack-notes-posted-body">
        <p className="substack-notes-posted-status">{postedStatusText(item)}</p>
        {words ? <p className="substack-notes-text">{words}</p> : null}
        {item.kind !== 'note' && item.targetUrl ? (
          <p className="substack-notes-card-note">
            {'On '}
            <a href={item.targetUrl} target="_blank" rel="noopener noreferrer" className="substack-notes-link">{item.targetUrl}</a>
          </p>
        ) : null}
        {item.error ? <p className="substack-notes-error">{item.error}</p> : null}
        {handCheck && !item.error ? (
          <p className="substack-notes-error">
            The Mini stopped part-way through this. Open Substack and see whether it happened before doing it again.
          </p>
        ) : null}
        {item.postNote ? <p className="substack-notes-card-note">{item.postNote}</p> : null}
        {item.postedUrl || (handCheck && item.targetUrl) ? (
          <div className="substack-notes-actions">
            <a className="btn" href={item.postedUrl || item.targetUrl} target="_blank" rel="noopener noreferrer">{linkLabel}</a>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function SubstackNotesPanel(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  // Bumped on every project switch; a write started under one project checks
  // it before showing its reply, so the old client's row never lands here.
  const projectEpoch = useRef(0);
  const [items, setItems] = useState<NoteItem[] | null>(null);
  const [settings, setSettings] = useState<NotesSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('ideas');
  const [ideaText, setIdeaText] = useState('');
  const [noteUrl, setNoteUrl] = useState('');
  const [engageKind, setEngageKind] = useState('reply');
  const [replyText, setReplyText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [rowBusy, setRowBusy] = useState('');
  const [editingId, setEditingId] = useState('');
  // Which field the open row editor writes: the idea, or the pasted text of their Note.
  const [editingField, setEditingField] = useState<'ideaText' | 'targetText'>('ideaText');
  const [editError, setEditError] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string }>({ id: '', message: '' });
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    const [list, saved] = await Promise.allSettled([api(ITEMS_PATH), api(SETTINGS_PATH)]);
    if (seq !== requestSeq.current) return;
    const problems: string[] = [];
    if (list.status === 'fulfilled') {
      setItems(Array.isArray(list.value?.data) ? (list.value.data as NoteItem[]) : []);
    } else {
      setItems(null);
      problems.push(`The ideas and Notes could not be read: ${errorText(list.reason, 'unknown error')}`);
    }
    if (saved.status === 'fulfilled') {
      setSettings((saved.value?.data as NotesSettings) || null);
    } else {
      setSettings(null);
      problems.push(`The settings could not be read: ${errorText(saved.reason, 'unknown error')}`);
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

  // A project switch: drop the old client's rows at once and read the new one's.
  useEffect(() => {
    const onSwitch = () => {
      requestSeq.current += 1;
      projectEpoch.current += 1;
      setItems(null);
      setSettings(null);
      setError('');
      setNotice('');
      setAddError('');
      setLoading(false);
      setEditingId('');
      setRowError({ id: '', message: '' });
      // Half-typed words belong to the old client; Add must not file them here.
      setIdeaText('');
      setNoteUrl('');
      setReplyText('');
      const page = hostRef.current?.closest('.app-page');
      if (!page || !page.classList.contains('hidden')) void load();
    };
    window.addEventListener(PROJECT_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROJECT_SWITCH_EVENT, onSwitch);
  }, [load]);

  /** POST one item; true when the server saved it. */
  const createItem = async (body: Record<string, unknown>, done: string): Promise<boolean> => {
    const api = getApi();
    if (!api) return false;
    const epoch = projectEpoch.current;
    setAdding(true);
    setAddError('');
    setNotice('');
    try {
      const reply = await api(ITEMS_PATH, { method: 'POST', body: JSON.stringify(body) });
      if (epoch !== projectEpoch.current) return false;
      const made = reply?.data as NoteItem;
      setItems((list) => [made, ...(list || [])]);
      setNotice(done);
      return true;
    } catch (err) {
      if (epoch !== projectEpoch.current) return false;
      setAddError(`Not added: ${errorText(err, 'unknown error')}`);
      return false;
    } finally {
      setAdding(false);
    }
  };

  const addIdea = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = ideaText.trim();
    if (!text) return;
    if (await createItem({ kind: 'note', source: 'jotted', ideaText: text }, 'Idea added.')) setIdeaText('');
  };

  const addTopicIdea = (topic: string) => {
    void createItem({ kind: 'note', source: 'topic', ideaText: topic }, `Added an idea from the topic "${topic}".`);
  };

  const addEngage = async (event: React.FormEvent) => {
    event.preventDefault();
    const link = noteUrl.trim();
    if (!link) return;
    const body: Record<string, unknown> = { kind: engageKind, source: 'target', targetUrl: withScheme(link) };
    if (engageKind === 'reply' && replyText.trim()) body.ideaText = replyText.trim();
    const label = labelFor(ENGAGE_OPTIONS, engageKind);
    if (await createItem(body, `${label} added.`)) {
      setNoteUrl('');
      setReplyText('');
    }
  };

  const startEdit = (item: NoteItem, field: 'ideaText' | 'targetText') => {
    setEditError('');
    setEditingField(field);
    setEditingId(item.id);
  };

  const replaceItem = (next: NoteItem) => setItems((list) => (list || []).map((i) => (i.id === next.id ? next : i)));

  /** "Write a draft" and "Write another": the server writes, checks and saves it, or says why not. */
  const writeDraft = async (item: NoteItem) => {
    const api = getApi();
    if (!api) return;
    const epoch = projectEpoch.current;
    setRowBusy(item.id);
    setRowError({ id: '', message: '' });
    setNotice('');
    try {
      const reply = await api(`${ITEMS_PATH}/${encodeURIComponent(item.id)}/draft`, { method: 'POST', body: '{}' });
      if (epoch !== projectEpoch.current) return;
      replaceItem(reply?.data as NoteItem);
      setNotice(`A draft ${item.kind === 'reply' ? 'reply' : 'Note'} is waiting on the Approvals tab.`);
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setRowError({ id: item.id, message: `No draft written: ${errorText(err, 'unknown error')}` });
    } finally {
      setRowBusy('');
    }
  };

  /** Approve / Reject on the Approvals tab — each answered by the server, never assumed. */
  const decide = async (item: NoteItem, action: 'approve' | 'reject', text?: string) => {
    const api = getApi();
    if (!api) return;
    const epoch = projectEpoch.current;
    setRowBusy(item.id);
    setRowError({ id: '', message: '' });
    setNotice('');
    try {
      const reply = await api(`${ITEMS_PATH}/${encodeURIComponent(item.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'approve' && text !== undefined ? { text } : {}),
      });
      if (epoch !== projectEpoch.current) return;
      replaceItem(reply?.data as NoteItem);
      setNotice(action === 'approve'
        ? 'Approved. The Mini does it within its limits; the Posted tab shows when it has.'
        : 'Rejected. It stays on its row, marked rejected.');
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      const said = errorText(err, 'unknown error');
      const lead = action === 'approve' ? 'Not approved' : 'Not rejected';
      // The server's rule refusal already opens "Not approved:" — do not say it twice.
      setRowError({ id: item.id, message: said.startsWith(lead) ? said : `${lead}: ${said}` });
    } finally {
      setRowBusy('');
    }
  };

  const saveText = async (item: NoteItem, text: string) => {
    const api = getApi();
    if (!api) return;
    const epoch = projectEpoch.current;
    setRowBusy(item.id);
    setEditError('');
    try {
      const reply = await api(`${ITEMS_PATH}/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ [editingField]: text }),
      });
      if (epoch !== projectEpoch.current) return;
      replaceItem(reply?.data as NoteItem);
      setEditingId('');
      setNotice('Saved.');
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setEditError(`Not saved: ${errorText(err, 'unknown error')}`);
    } finally {
      setRowBusy('');
    }
  };

  const removeItem = async (item: NoteItem, what: string) => {
    const api = getApi();
    if (!api) return;
    if (!window.confirm(`Delete this ${what}? It cannot be brought back.`)) return;
    const epoch = projectEpoch.current;
    setRowBusy(item.id);
    setError('');
    try {
      await api(`${ITEMS_PATH}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (epoch !== projectEpoch.current) return;
      setItems((list) => (list || []).filter((i) => i.id !== item.id));
      if (editingId === item.id) setEditingId('');
      setNotice(`Deleted the ${what}.`);
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setError(`The ${what} was not deleted: ${errorText(err, 'unknown error')}`);
    } finally {
      setRowBusy('');
    }
  };

  const saveSettings = async (form: SettingsForm) => {
    const api = getApi();
    if (!api) return;
    const epoch = projectEpoch.current;
    setSettingsBusy(true);
    setSettingsError('');
    setNotice('');
    try {
      const reply = await api(SETTINGS_PATH, { method: 'PUT', body: JSON.stringify(settingsPatchFromForm(form)) });
      // Answered after a switch: these are the OLD project's settings.
      if (epoch !== projectEpoch.current) return;
      setSettings(reply.data as NotesSettings);
      setNotice('Settings saved.');
    } catch (err) {
      if (epoch !== projectEpoch.current) return;
      setSettingsError(`Not saved: ${errorText(err, 'unknown error')}`);
    } finally {
      setSettingsBusy(false);
    }
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setAddError('');
    setEditingId('');
    setRowError({ id: '', message: '' });
  };

  const { ideas, engage } = splitItems(items || []);
  const waiting = (items || []).filter(awaitsApproval);
  const posted = postedItems(items || []);
  const topics = settings?.topics || [];

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      className={`btn${tab === value ? ' btn-primary' : ''}`}
      aria-selected={tab === value}
      onClick={() => switchTab(value)}
    >
      {label}
    </button>
  );

  return (
    <div ref={hostRef} className="substack-notes-panel">
      <p className="substack-notes-signin" data-signin-state="unknown">
        Mini's Substack sign-in: not checked yet — nothing reads it until the hourly sign-in check is built.
      </p>

      <div className="substack-notes-toolbar">
        <div className="substack-notes-tabs" role="tablist" aria-label="Substack Notes">
          {tabButton('ideas', ideas.length ? `Ideas (${ideas.length})` : 'Ideas')}
          {tabButton('engage', engage.length ? `Engage (${engage.length})` : 'Engage')}
          {tabButton('approvals', waiting.length ? `Approvals (${waiting.length})` : 'Approvals')}
          {tabButton('posted', posted.length ? `Posted (${posted.length})` : 'Posted')}
          {tabButton('settings', 'Settings')}
        </div>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="substack-notes-error" role="alert">{error}</p> : null}
      {notice ? <p className="substack-notes-notice" role="status">{notice}</p> : null}

      {tab === 'ideas' ? (
        <div className="substack-notes-tabpanel" role="tabpanel" aria-label="Ideas">
          <form className="substack-notes-add" onSubmit={addIdea}>
            <label className="substack-notes-add-label" htmlFor="sn-idea">Jot an idea for a Note</label>
            <textarea id="sn-idea" rows={2} value={ideaText} onChange={(e) => setIdeaText(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={adding || !ideaText.trim()}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>
          {addError ? <p className="substack-notes-error" role="alert">{addError}</p> : null}

          <section className="substack-notes-card substack-notes-topics" aria-label="Topics">
            <h3 className="substack-notes-card-title">Topics</h3>
            {settings && !topics.length ? (
              <p className="substack-notes-card-note">No topics yet. Add some on the Settings tab, one per line.</p>
            ) : null}
            {!settings ? <p className="substack-notes-card-note">The topics live in the settings, which have not been read.</p> : null}
            {topics.length ? (
              <ul className="substack-notes-topic-list">
                {topics.map((topic) => (
                  <li key={topic}>
                    <span className="substack-notes-topic">{topic}</span>
                    <button type="button" className="btn" disabled={adding} onClick={() => addTopicIdea(topic)}>Use this topic</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {items && !ideas.length ? (
            <p className="substack-notes-empty">No ideas yet. Type one above and click Add.</p>
          ) : null}
          {ideas.length ? (
            <div className="table-wrap substack-notes-table-wrap">
              <table className="substack-notes-table">
                <thead>
                  <tr>
                    <th scope="col">Idea</th>
                    <th scope="col">Where from</th>
                    <th scope="col">Added</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ideas.map((item) => {
                    const busy = rowBusy === item.id;
                    const editing = editingId === item.id;
                    return (
                      <tr key={item.id} data-item-id={item.id}>
                        <td className="substack-notes-text-cell">
                          {editing ? (
                            <>
                              <TextEditor
                                id={`sn-edit-${item.id}`}
                                label="Edit the idea"
                                initial={item.ideaText}
                                busy={busy}
                                onSave={(text) => void saveText(item, text)}
                                onCancel={() => setEditingId('')}
                              />
                              {editError ? <p className="substack-notes-error" role="alert">{editError}</p> : null}
                            </>
                          ) : (
                            <>
                              <span className="substack-notes-text">{item.ideaText || item.contentTitle || item.contentUrl}</span>
                              {wordsLine(item) ? <span className="substack-notes-text substack-notes-words">{wordsLine(item)}</span> : null}
                            </>
                          )}
                        </td>
                        <td>{SOURCE_LABELS[item.source] || item.source}</td>
                        <td>{shortDate(item.createdAt)}</td>
                        <td>
                          {statusLabel(item)}
                          {waitLine(item) ? <span className="substack-notes-text substack-notes-wait">{waitLine(item)}</span> : null}
                        </td>
                        <td className="actions-col">
                          <div className="table-actions-row">
                            {item.status === 'idea' ? (
                              <button type="button" className="btn" disabled={busy || editing} onClick={() => void writeDraft(item)}>
                                {busy ? 'Writing…' : 'Write a draft'}
                              </button>
                            ) : null}
                            <button type="button" className="btn" disabled={busy || editing} onClick={() => startEdit(item, 'ideaText')}>Edit</button>
                            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void removeItem(item, 'idea')}>Delete</button>
                          </div>
                          {rowError.id === item.id ? <p className="substack-notes-error" role="alert">{rowError.message}</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'engage' ? (
        <div className="substack-notes-tabpanel" role="tabpanel" aria-label="Engage">
          <form className="substack-notes-card substack-notes-engage-add" onSubmit={addEngage}>
            <div className="substack-notes-form">
              <Field label="Substack Note link" htmlFor="sn-note-url" help="The address of one Note — it ends /note/c- and a number.">
                <input
                  id="sn-note-url"
                  type="text"
                  inputMode="url"
                  placeholder="https://substack.com/@name/note/c-…"
                  value={noteUrl}
                  onChange={(e) => setNoteUrl(e.target.value)}
                />
              </Field>
              <Field label="What to do" htmlFor="sn-engage-reply">
                <div className="substack-notes-choices" role="radiogroup" aria-label="What to do">
                  {ENGAGE_OPTIONS.map((o) => (
                    <label key={o.value} className="substack-notes-choice">
                      <input
                        id={`sn-engage-${o.value}`}
                        type="radio"
                        name="sn-engage-kind"
                        value={o.value}
                        checked={engageKind === o.value}
                        onChange={() => setEngageKind(o.value)}
                      />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              </Field>
              {engageKind === 'reply' ? (
                <Field label="What I want to say, roughly" htmlFor="sn-reply-text" help="Optional. The agent writes the reply from this.">
                  <textarea id="sn-reply-text" rows={3} value={replyText} onChange={(e) => setReplyText(e.target.value)} />
                </Field>
              ) : null}
            </div>
            {addError ? <p className="substack-notes-error" role="alert">{addError}</p> : null}
            <div className="substack-notes-actions">
              <button type="submit" className="btn btn-primary" disabled={adding || !noteUrl.trim()}>
                {adding ? 'Adding…' : 'Add'}
              </button>
            </div>
          </form>

          {items && !engage.length ? (
            <p className="substack-notes-empty">No Notes to engage with yet. Paste a Substack Note link above.</p>
          ) : null}
          {engage.length ? (
            <div className="table-wrap substack-notes-table-wrap">
              <table className="substack-notes-table">
                <thead>
                  <tr>
                    <th scope="col">Note</th>
                    <th scope="col">Action</th>
                    <th scope="col">What to say</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {engage.map((item) => {
                    const busy = rowBusy === item.id;
                    const editing = editingId === item.id;
                    const action = labelFor(ENGAGE_OPTIONS, item.kind);
                    return (
                      <tr key={item.id} data-item-id={item.id}>
                        <td className="substack-notes-link-cell">
                          <a href={item.targetUrl} target="_blank" rel="noopener noreferrer" className="substack-notes-link">{item.targetUrl}</a>
                        </td>
                        <td>{action}</td>
                        <td className="substack-notes-text-cell">
                          {editing ? (
                            <>
                              <TextEditor
                                id={`sn-edit-${item.id}`}
                                label={editingField === 'targetText' ? 'Their Note, pasted' : 'What I want to say, roughly'}
                                initial={editingField === 'targetText' ? item.targetText : item.ideaText}
                                busy={busy}
                                onSave={(text) => void saveText(item, text)}
                                onCancel={() => setEditingId('')}
                              />
                              {editError ? <p className="substack-notes-error" role="alert">{editError}</p> : null}
                            </>
                          ) : item.kind === 'reply' ? (
                            <>
                              <span className="substack-notes-text">{item.ideaText || 'Nothing given — the agent will decide.'}</span>
                              <span className="substack-notes-text substack-notes-their-note">
                                {item.targetText
                                  ? `Their Note: ${item.targetText}`
                                  : 'Their Note: not read yet — Write a draft reads it from Substack, or paste it.'}
                              </span>
                              {wordsLine(item) ? <span className="substack-notes-text substack-notes-words">{wordsLine(item)}</span> : null}
                            </>
                          ) : (
                            <span className="substack-notes-text">No words — a {action.toLowerCase()} is just the click.</span>
                          )}
                        </td>
                        <td>
                          {statusLabel(item)}
                          {waitLine(item) ? <span className="substack-notes-text substack-notes-wait">{waitLine(item)}</span> : null}
                        </td>
                        <td className="actions-col">
                          <div className="table-actions-row">
                            {item.kind === 'reply' && item.status === 'idea' ? (
                              <button type="button" className="btn" disabled={busy || editing} onClick={() => void writeDraft(item)}>
                                {busy ? 'Writing…' : 'Write a draft'}
                              </button>
                            ) : null}
                            {item.kind === 'reply' ? (
                              <>
                                <button type="button" className="btn" disabled={busy || editing} onClick={() => startEdit(item, 'ideaText')}>Edit</button>
                                <button type="button" className="btn" disabled={busy || editing} onClick={() => startEdit(item, 'targetText')}>Paste their Note</button>
                              </>
                            ) : null}
                            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void removeItem(item, action.toLowerCase())}>Delete</button>
                          </div>
                          {rowError.id === item.id ? <p className="substack-notes-error" role="alert">{rowError.message}</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'approvals' ? (
        <div className="substack-notes-tabpanel substack-notes-approvals" role="tabpanel" aria-label="Approvals">
          {items && !waiting.length ? (
            <p className="substack-notes-empty">Nothing waiting for approval. Click Write a draft on an idea, or add a Note to engage with.</p>
          ) : null}
          {!items ? <p className="substack-notes-empty">{loading ? 'Loading…' : 'The list has not been read, so nothing can be shown. Click Refresh.'}</p> : null}
          {waiting.map((item) => (
            <ApprovalCard
              key={`${item.id}:${item.updatedAt}`}
              item={item}
              busy={rowBusy === item.id}
              error={rowError.id === item.id ? rowError.message : ''}
              onApprove={(text) => void decide(item, 'approve', text)}
              onReject={() => void decide(item, 'reject')}
              onRedraft={() => void writeDraft(item)}
            />
          ))}
        </div>
      ) : null}

      {tab === 'posted' ? (
        <div className="substack-notes-tabpanel substack-notes-posted" role="tabpanel" aria-label="Posted">
          {items && !posted.length ? (
            <p className="substack-notes-empty">Nothing has been posted yet. Approved Notes, replies, restacks and likes appear here once the Mini has done them.</p>
          ) : null}
          {!items ? <p className="substack-notes-empty">{loading ? 'Loading…' : 'The list has not been read, so nothing can be shown. Click Refresh.'}</p> : null}
          {posted.length ? (
            <ul className="substack-notes-posted-list">
              {posted.map((item) => <PostedRow key={item.id} item={item} />)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="substack-notes-tabpanel" role="tabpanel" aria-label="Settings">
          {settings ? (
            <SettingsEditor
              key={settings.updatedAt || 'unsaved'}
              settings={settings}
              busy={settingsBusy}
              error={settingsError}
              onSave={(form) => void saveSettings(form)}
            />
          ) : (
            <p className="substack-notes-empty">{loading ? 'Loading the settings…' : 'The settings have not been read, so there is nothing to edit. Click Refresh.'}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
