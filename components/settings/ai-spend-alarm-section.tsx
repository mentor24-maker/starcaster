import React, { useCallback, useEffect, useState } from 'react';

/**
 * Settings › AI Quota, "Spending alarm" (AI Quota 4/5, task 86bcvj7zm).
 *
 * On Oct 28-30, 2026 the Anthropic account drained two nights running and the
 * first sign was an empty balance. This is where Dane sets the two limits the
 * hourly check (lib/aiSpendAlarm.js) holds today's spend against, and sees what
 * the last check read — including when it could NOT read, which is never shown
 * as $0.
 */

const ALARM_PATH = '/api/ai-quota/alarm';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

export type AlarmKind = 'over-limit' | 'spike' | 'unreadable';

export type LastCheck = {
  at?: string;
  source?: 'bill' | 'meter' | null;
  fallbackWhy?: string;
  day?: string;
  todayUsd?: number | null;
  averageUsd?: number | null;
  topSpender?: string;
  dailyLimitUsd?: number;
  spikeMultiple?: number;
  unreadableWhy?: string;
  active?: Partial<Record<AlarmKind, boolean>>;
};

export type Alarm =
  | { status: 'owner-only' }
  | { status: 'error'; message: string }
  | {
    status: 'ok';
    exists: boolean;
    dailyLimitUsd: number;
    spikeMultiple: number;
    alertEmail: string;
    defaultEmail: string;
    lastCheckAt: string | null;
    lastCheck: LastCheck;
  };

function money(value: number | null | undefined): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** What the last scheduled check saw, in one or two sentences. */
export function LastCheckLine({ alarm }: { alarm: Extract<Alarm, { status: 'ok' }> }): React.ReactElement {
  const check = alarm.lastCheck || {};
  if (!alarm.lastCheckAt) {
    return (
      <p className="ai-quota-warn">
        Not checked yet. The check runs every hour, at 37 minutes past; the first result appears here after it runs.
      </p>
    );
  }
  if (check.todayUsd === null || check.todayUsd === undefined) {
    return (
      <div className="ai-quota-alert" role="alert">
        <strong>The last check ({when(alarm.lastCheckAt)}) could not read the spend.</strong> {check.unreadableWhy}
      </div>
    );
  }
  const source = check.source === 'bill'
    ? 'Anthropic’s bill'
    : 'Starcaster’s estimate (Anthropic’s bill is not connected, and the estimate does not see the Mac Mini)';
  const firing = (['over-limit', 'spike'] as AlarmKind[]).filter((k) => check.active?.[k]);
  // Quote the limits the check judged against, not ones saved since.
  const limit = check.dailyLimitUsd ?? alarm.dailyLimitUsd;
  const multiple = check.spikeMultiple ?? alarm.spikeMultiple;
  return (
    <>
      <p className="ai-alarm-last">
        Last checked {when(alarm.lastCheckAt)}: today (UTC) so far <strong>{money(check.todayUsd)}</strong>,
        a normal day over the last 7 is {money(check.averageUsd)}. Read from {source}.
        {check.fallbackWhy ? ` ${check.fallbackWhy}` : ''}
      </p>
      {firing.length > 0 && (
        <div className="ai-quota-alert" role="alert">
          <strong>
            {firing.includes('over-limit') ? `Over the ${money(limit)} limit today.` : ''}
            {firing.includes('spike') ? ` More than ${multiple}× a normal day.` : ''}
          </strong>
          {check.topSpender ? ` Most of it is ${check.topSpender}.` : ''} The alert goes to the bus and by email, repeating at most every 6 hours.
        </div>
      )}
    </>
  );
}

type FormValues = { dailyLimitUsd: string; spikeMultiple: string; alertEmail: string };

export function AlarmView({ alarm, onSave, saving, message }: {
  alarm: Alarm;
  onSave: (values: FormValues) => void;
  saving: boolean;
  message: { ok: boolean; text: string } | null;
}): React.ReactElement {
  const ready = alarm.status === 'ok' ? alarm : null;
  const [values, setValues] = useState<FormValues>({ dailyLimitUsd: '', spikeMultiple: '', alertEmail: '' });
  useEffect(() => {
    if (!ready) return;
    setValues({
      dailyLimitUsd: String(ready.dailyLimitUsd),
      spikeMultiple: String(ready.spikeMultiple),
      alertEmail: ready.alertEmail,
    });
  }, [ready?.dailyLimitUsd, ready?.spikeMultiple, ready?.alertEmail]);

  if (alarm.status === 'owner-only') {
    return <p className="ai-quota-empty">The spending alarm guards the whole account’s bill, so only the platform owner can set it.</p>;
  }
  if (alarm.status === 'error') {
    return (
      <div className="ai-quota-alert" role="alert">
        <strong>The spending alarm’s settings could not be read, so the alarm is not running.</strong> {alarm.message}
      </div>
    );
  }
  const set = (key: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [key]: e.target.value });
  return (
    <div className="ai-alarm">
      <p className="ai-quota-note">
        Every hour, today’s AI spend is checked against these two limits. When either is passed, one line goes to the
        bus and an email goes to the address below — at most once every 6 hours while it lasts, and a short
        “back to normal” line once it clears.{ready && !ready.exists ? ' Not saved yet — the defaults below are in force.' : ''}
      </p>
      <form
        className="ai-alarm-form"
        onSubmit={(e) => { e.preventDefault(); onSave(values); }}
      >
        <label className="field">
          <span>Daily limit ($)</span>
          <input type="number" min="0.01" step="0.01" value={values.dailyLimitUsd} onChange={set('dailyLimitUsd')} required />
        </label>
        <label className="field">
          <span>Spike multiple (×)</span>
          <input type="number" min="1" step="0.5" value={values.spikeMultiple} onChange={set('spikeMultiple')} required />
        </label>
        <label className="field">
          <span>Email alerts to</span>
          <input type="email" value={values.alertEmail} placeholder={ready?.defaultEmail || 'your email'} onChange={set('alertEmail')} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </form>
      <p className="ai-quota-footer">
        Spike: today is more than this many times the average of the last 7 days. Not judged while those days averaged
        $0. Days are UTC, the same days Anthropic bills by. A blank email means yours.
      </p>
      {message && (
        <p className={message.ok ? 'ai-alarm-saved' : 'ai-quota-warn'} role="status">{message.text}</p>
      )}
      {ready && <LastCheckLine alarm={ready} />}
    </div>
  );
}

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: { api?: AppApi } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

export function useAlarm(): [Alarm | null, () => void, (v: FormValues) => void, boolean, { ok: boolean; text: string } | null] {
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    const api = getAppApi();
    if (!api) return setAlarm({ status: 'error', message: 'Admin app not ready.' });
    api(ALARM_PATH)
      .then((res) => setAlarm((res?.data || res) as Alarm))
      .catch((err) => setAlarm({ status: 'error', message: err instanceof Error ? err.message : 'The read failed.' }));
  }, []);
  const save = useCallback((values: FormValues) => {
    const api = getAppApi();
    if (!api) return setMessage({ ok: false, text: 'Admin app not ready.' });
    setSaving(true);
    setMessage(null);
    api(ALARM_PATH, {
      method: 'PUT',
      body: JSON.stringify({
        dailyLimitUsd: Number(values.dailyLimitUsd),
        spikeMultiple: Number(values.spikeMultiple),
        alertEmail: values.alertEmail,
      }),
    })
      .then((res) => {
        const saved = (res?.data || res) as Alarm;
        setAlarm(saved);
        // Say what was SAVED, read back from the database — not what was typed.
        if (saved.status === 'ok') {
          setMessage({ ok: true, text: `Saved: alert above ${money(saved.dailyLimitUsd)} a day or ${saved.spikeMultiple}× a normal day, by email to ${saved.alertEmail || saved.defaultEmail}.` });
        }
      })
      .catch((err) => setMessage({ ok: false, text: `Not saved. ${err instanceof Error ? err.message : ''}` }))
      .finally(() => setSaving(false));
  }, []);
  return [alarm, load, save, saving, message];
}

export default function AlarmSection({ alarm, onSave, saving, message }: {
  alarm: Alarm | null;
  onSave: (values: FormValues) => void;
  saving: boolean;
  message: { ok: boolean; text: string } | null;
}): React.ReactElement {
  return (
    <section className="ai-quota ai-alarm-section">
      <h3>Spending alarm</h3>
      {alarm
        ? <AlarmView alarm={alarm} onSave={onSave} saving={saving} message={message} />
        : <p className="ai-quota-empty">Reading the alarm’s settings…</p>}
    </section>
  );
}
