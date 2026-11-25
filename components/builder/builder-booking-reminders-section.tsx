"use client";

/**
 * The Booking Manager's Reminders section (SC-914, slice 6 of the booking
 * calendar): whether reminder emails go out, how long before each meeting,
 * whether the site owner gets one too, and the reminders that failed every
 * attempt.
 *
 * Its own endpoint (/api/booking/calendars/:id/reminders, routes/
 * bookingReminders.js) and its own save, like the manager's other sections:
 * the answer is what the database now holds, and the screen shows THAT.
 *
 * Pure logic: lib/builder-client/booking-reminders.ts, which is tested.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import { readApiErrorMessage } from "@/lib/public-admin-session";
import {
  MAX_REMINDERS,
  addReminderOffset,
  choicesForRow,
  normalizeReminderSettings,
  reminderLabel,
  reminderProblemText,
  reminderSettingsProblem,
  type ReminderProblem,
  type ReminderSettings,
} from "@/lib/booking-reminders";

type Props = {
  calendarId: string;
  timeZone: string;
  projectId?: string;
};

async function remindersApi<T>(calendarId: string, projectId: string | undefined, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...starcasterScopedHeaders() };
  if (projectId) headers["X-Project-ID"] = projectId;
  if (init.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/booking/calendars/${encodeURIComponent(calendarId)}/reminders`, {
    credentials: "include",
    ...init,
    headers,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.ok === false) {
    throw new Error(readApiErrorMessage(body, `The reminder settings did not answer (${res.status}).`));
  }
  return body.data as T;
}

export function BookingRemindersSection({ calendarId, timeZone, projectId }: Props) {
  const uid = useId();
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [problems, setProblems] = useState<ReminderProblem[]>([]);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await remindersApi<{ settings: unknown; problems: ReminderProblem[] }>(calendarId, projectId);
      setSettings(normalizeReminderSettings(data?.settings));
      setProblems(Array.isArray(data?.problems) ? data.problems : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "The reminder settings could not be read.");
    }
  }, [calendarId, projectId]);

  useEffect(() => {
    setSettings(null);
    setMessage("");
    setError("");
    void load();
  }, [load]);

  async function save() {
    if (!settings) return;
    const problem = reminderSettingsProblem(settings);
    if (problem) { setError(problem); setMessage(""); return; }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const now = await remindersApi<unknown>(calendarId, projectId, { method: "PATCH", body: JSON.stringify(settings) });
      setSettings(normalizeReminderSettings(now));
      setMessage("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const titleId = `${uid}-reminders`;
  const head = <h4 id={titleId} className="booking-manager-section-title">Reminders</h4>;

  if (loadError) {
    return (
      <section className="booking-manager-section" aria-labelledby={titleId}>
        {head}
        <p className="booking-manager-error" role="alert">{loadError}</p>
        <div className="booking-manager-actions">
          <button type="button" className="booking-manager-btn" onClick={() => void load()}>Try Again</button>
        </div>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="booking-manager-section" aria-labelledby={titleId}>
        {head}
        <p className="booking-manager-empty">Loading the reminder settings…</p>
      </section>
    );
  }

  const { offsetsMinutes } = settings;
  const setOffsets = (next: number[]) => setSettings({ ...settings, offsetsMinutes: next });

  return (
    <section className="booking-manager-section" aria-labelledby={titleId}>
      {head}
      <label className="booking-manager-day-toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
        />
        <span>Send Reminder Emails Before Each Meeting</span>
      </label>

      {settings.enabled ? (
        <>
          <div className="booking-manager-grid">
            {offsetsMinutes.map((minutes, i) => (
              <ReminderRow
                key={i}
                id={`${uid}-offset-${i}`}
                index={i}
                value={minutes}
                choices={choicesForRow(offsetsMinutes, i)}
                onChange={(value) => setOffsets(offsetsMinutes.map((m, j) => (j === i ? value : m)))}
                onRemove={() => setOffsets(offsetsMinutes.filter((_, j) => j !== i))}
              />
            ))}
          </div>
          {offsetsMinutes.length < MAX_REMINDERS ? (
            <div className="booking-manager-actions">
              <button type="button" className="booking-manager-btn booking-manager-btn-small" onClick={() => setOffsets(addReminderOffset(offsetsMinutes))}>
                Add Reminder
              </button>
            </div>
          ) : null}
          <label className="booking-manager-day-toggle">
            <input
              type="checkbox"
              checked={settings.notifyOwner}
              onChange={(e) => setSettings({ ...settings, notifyOwner: e.target.checked })}
            />
            <span>Also Remind the Site Owner</span>
          </label>
          <p className="booking-manager-hint">
            The visitor&apos;s reminder uses the Reminder Email wording under Messaging, shows the time in their own time zone,
            and carries their link to cancel or pick a new time. The site owner&apos;s goes to the Contact Alert Email on the Settings page.
            A reminder whose time had already passed when the meeting was booked is not sent.
          </p>
        </>
      ) : (
        <p className="booking-manager-hint">Reminders are off: visitors get their confirmation email and nothing more before the meeting.</p>
      )}

      <div className="booking-manager-actions">
        <button type="button" className="booking-manager-btn booking-manager-btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save Reminders"}
        </button>
        {error ? <p className="booking-manager-error" role="alert">{error}</p> : null}
        {message ? <p className="booking-manager-saved" role="status">{message}</p> : null}
      </div>

      <h5 className="booking-manager-subtitle">Reminders Not Sent ({problems.length})</h5>
      {problems.length ? (
        <ul className="booking-manager-reminder-problems">
          {problems.map((p) => (
            <li key={p.id} className="booking-manager-booking-email-failed" role="note">
              {reminderProblemText(p, timeZone)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="booking-manager-hint">
          None. A reminder that fails is tried again every five minutes; one that fails three times is listed here.
        </p>
      )}
    </section>
  );
}

function ReminderRow({
  id,
  index,
  value,
  choices,
  onChange,
  onRemove,
}: {
  id: string;
  index: number;
  value: number;
  choices: number[];
  onChange: (value: number) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <label htmlFor={id}>{`Reminder ${index + 1}`}</label>
      <span className="booking-manager-window">
        <select id={id} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
          {choices.map((m) => <option key={m} value={String(m)}>{reminderLabel(m)}</option>)}
        </select>
        <button type="button" className="booking-manager-icon-btn" aria-label={`Remove reminder ${index + 1}`} onClick={onRemove}>
          ×
        </button>
      </span>
    </>
  );
}
