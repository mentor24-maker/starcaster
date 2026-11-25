"use client";

/**
 * Booking Manager (`admin-booking-manager`), slice 2 of the booking calendar
 * (SC-910). The operator's one screen for the calendar visitors book from:
 *
 *   Availability  weekly hours (several ranges a day), days off, blocked
 *                 dates, the time zone
 *   Meeting       title, length, gap between meetings, minimum notice, how
 *                 many days ahead
 *   Messaging     what visitors read, plus the email wording slices 4 and 6
 *                 (SC-912, SC-914) will send; stored now
 *   Bookings      upcoming and past, a Cancel button, and each row linked to
 *                 its CRM contact by id (landmine 19)
 *
 * It reads and writes ONLY through slice 1's API (routes/booking.js). Every
 * save answers with what the database now holds, and the screen shows THAT,
 * never what was typed (landmine 15). Each section saves on its own, so a
 * half-finished change in one section never rides along with another's save.
 *
 * Pure logic lives in lib/builder-client/booking-manager.ts, which is tested.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import { readApiErrorMessage } from "@/lib/public-admin-session";
import {
  BOOKING_DAY_KEYS,
  BOOKING_DAY_LABELS,
  BOOKING_NUMBER_RANGES,
  MIN_NOTICE_CHOICES,
  addBlockedDate,
  addDayWindow,
  bookingContactHref,
  bookingEmailNote,
  dayWindowProblem,
  emptyBookingsMessage,
  formatBookingTime,
  knownTimeZones,
  minutesLabel,
  normalizeCalendar,
  removeBlockedDate,
  removeDayWindow,
  setDayOpen,
  splitBookings,
  updateDayWindow,
  wholeNumberOrProblem,
  type Booking,
  type BookingCalendar,
  type BookingMessaging,
  type BookingMessagingKey,
  type BookingWeeklyHours,
} from "@/lib/booking-manager";

type Props = {
  settings: Record<string, string>;
  projectId?: string;
};

type SectionKey = "availability" | "meeting" | "messaging";
type SectionState = { saving: boolean; message: string; error: string };
const IDLE: SectionState = { saving: false, message: "", error: "" };

function headersFor(projectId?: string): Record<string, string> {
  const headers = starcasterScopedHeaders();
  if (projectId) headers["X-Project-ID"] = projectId;
  return headers;
}

async function bookingApi<T>(path: string, projectId: string | undefined, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/booking${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...headersFor(projectId),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.ok === false) {
    throw new Error(readApiErrorMessage(body, `The booking calendar did not answer (${res.status}).`));
  }
  return body.data as T;
}

const MESSAGING_FIELDS: Array<{ key: BookingMessagingKey; label: string; hint: string; multiline: boolean; group: "page" | "email" }> = [
  { key: "heading", label: "Heading", hint: "Shown above the calendar. Leave empty for none.", multiline: false, group: "page" },
  { key: "intro", label: "Intro Text", hint: "A sentence or two above the calendar.", multiline: true, group: "page" },
  { key: "confirmation", label: "Confirmation Message", hint: "What the visitor sees once their booking is made.", multiline: true, group: "page" },
  { key: "confirmationEmailSubject", label: "Confirmation Email Subject", hint: "", multiline: false, group: "email" },
  { key: "confirmationEmailBody", label: "Confirmation Email Text", hint: "", multiline: true, group: "email" },
  { key: "reminderEmailSubject", label: "Reminder Email Subject", hint: "", multiline: false, group: "email" },
  { key: "reminderEmailBody", label: "Reminder Email Text", hint: "", multiline: true, group: "email" },
];

export function BookingManagerModule({ settings, projectId }: Props) {
  const showTitle = settings.showTitle !== "false";
  const panelTitle = settings.panelTitle || "Booking Manager";
  const contactsPageUrl = settings.contactsPageUrl || "/admin-contact-manager";
  const uid = useId();

  const [calendars, setCalendars] = useState<BookingCalendar[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);

  // The saved calendar (what the database holds) and the drafts being edited.
  const [saved, setSaved] = useState<BookingCalendar | null>(null);
  const [hours, setHours] = useState<BookingWeeklyHours | null>(null);
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [newBlockedDate, setNewBlockedDate] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [meeting, setMeeting] = useState({ name: "", meetingMinutes: "", gapMinutes: "", minNoticeMinutes: "", daysAhead: "" });
  const [messaging, setMessaging] = useState<BookingMessaging | null>(null);
  const [sections, setSections] = useState<Record<SectionKey, SectionState>>({ availability: IDLE, meeting: IDLE, messaging: IDLE });

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState("");
  const [confirmCancelId, setConfirmCancelId] = useState("");
  const [cancellingId, setCancellingId] = useState("");
  const [bookingsNote, setBookingsNote] = useState("");

  const zones = useMemo(() => knownTimeZones(), []);

  /** Lay a calendar the server sent over every draft. */
  const adopt = useCallback((calendar: BookingCalendar) => {
    setSaved(calendar);
    setHours(calendar.weeklyHours);
    setBlockedDates(calendar.blockedDates);
    setTimeZone(calendar.timeZone);
    setMeeting({
      name: calendar.name,
      meetingMinutes: String(calendar.meetingMinutes),
      gapMinutes: String(calendar.gapMinutes),
      minNoticeMinutes: String(calendar.minNoticeMinutes),
      daysAhead: String(calendar.daysAhead),
    });
    setMessaging(calendar.messaging);
  }, []);

  const loadCalendars = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const list = await bookingApi<unknown[]>("/calendars", projectId);
      const parsed = (Array.isArray(list) ? list : []).map(normalizeCalendar).filter((c): c is BookingCalendar => Boolean(c));
      setCalendars(parsed);
      const keep = parsed.find((c) => c.id === calendarId) || parsed[0] || null;
      setCalendarId(keep?.id || "");
      if (keep) adopt(keep);
      else setSaved(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The booking calendar could not be read.");
    } finally {
      setLoading(false);
    }
    // calendarId is read once per load on purpose: choosing another calendar
    // adopts it directly rather than reloading every calendar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, adopt]);

  const loadBookings = useCallback(async (id: string) => {
    if (!id) { setBookings([]); return; }
    setBookingsLoading(true);
    setBookingsError("");
    try {
      const list = await bookingApi<Booking[]>(`/calendars/${encodeURIComponent(id)}/bookings?limit=500`, projectId);
      setBookings(Array.isArray(list) ? list : []);
    } catch (error) {
      setBookingsError(error instanceof Error ? error.message : "The bookings could not be read.");
    } finally {
      setBookingsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadCalendars(); }, [loadCalendars]);
  useEffect(() => { void loadBookings(calendarId); }, [calendarId, loadBookings]);

  function chooseCalendar(id: string) {
    const found = calendars.find((c) => c.id === id);
    if (!found) return;
    setCalendarId(id);
    adopt(found);
    setSections({ availability: IDLE, meeting: IDLE, messaging: IDLE });
  }

  async function createCalendar() {
    setCreating(true);
    setLoadError("");
    try {
      const made = normalizeCalendar(await bookingApi<unknown>("/calendars", projectId, { method: "POST", body: "{}" }));
      if (!made) throw new Error("The calendar was created but could not be read back.");
      setCalendars((prev) => [...prev, made]);
      setCalendarId(made.id);
      adopt(made);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The booking calendar could not be created.");
    } finally {
      setCreating(false);
    }
  }

  function setSection(key: SectionKey, next: Partial<SectionState>) {
    setSections((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }));
  }

  /** PATCH some settings; the answer is the database's, and it replaces every draft. */
  async function save(key: SectionKey, patch: Record<string, unknown>) {
    if (!saved) return;
    setSection(key, { saving: true, message: "", error: "" });
    try {
      const now = normalizeCalendar(
        await bookingApi<unknown>(`/calendars/${encodeURIComponent(saved.id)}`, projectId, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
      );
      if (!now) throw new Error("The settings were saved but could not be read back.");
      setCalendars((prev) => prev.map((c) => (c.id === now.id ? now : c)));
      adopt(now);
      setSection(key, { saving: false, message: "Saved.", error: "" });
    } catch (error) {
      setSection(key, { saving: false, message: "", error: error instanceof Error ? error.message : "Could not save." });
    }
  }

  const hourProblems = hours ? BOOKING_DAY_KEYS.map((d) => [d, dayWindowProblem(hours[d])] as const).filter(([, p]) => p) : [];

  function saveAvailability() {
    if (!hours) return;
    if (hourProblems.length) {
      setSection("availability", { error: `Fix ${BOOKING_DAY_LABELS[hourProblems[0][0]]} first: ${hourProblems[0][1]}` });
      return;
    }
    if (!timeZone.trim()) {
      setSection("availability", { error: "Choose a time zone." });
      return;
    }
    void save("availability", { weeklyHours: hours, blockedDates, timeZone: timeZone.trim() });
  }

  function saveMeeting() {
    const patch: Record<string, unknown> = {};
    const name = meeting.name.trim();
    if (!name) { setSection("meeting", { error: "Give the meeting a title." }); return; }
    patch.name = name;
    for (const key of ["meetingMinutes", "gapMinutes", "daysAhead"] as const) {
      const range = BOOKING_NUMBER_RANGES[key];
      const parsed = wholeNumberOrProblem(meeting[key], range.label, range.min, range.max);
      if ("problem" in parsed) { setSection("meeting", { error: parsed.problem }); return; }
      patch[key] = parsed.value;
    }
    patch.minNoticeMinutes = Number(meeting.minNoticeMinutes);
    void save("meeting", patch);
  }

  function saveMessaging() {
    if (!messaging) return;
    void save("messaging", { messaging });
  }

  async function cancelBooking(id: string) {
    setCancellingId(id);
    setBookingsNote("");
    setBookingsError("");
    try {
      await bookingApi<Booking>(`/bookings/${encodeURIComponent(id)}/cancel`, projectId, { method: "POST", body: "{}" });
      setBookingsNote("Booking cancelled. Its time is free for visitors to book again.");
    } catch (error) {
      setBookingsError(error instanceof Error ? error.message : "The booking could not be cancelled.");
    } finally {
      setCancellingId("");
      setConfirmCancelId("");
      // Read the list back rather than editing it in place: what shows is what saved.
      await loadBookings(calendarId);
    }
  }

  const status = (key: SectionKey) => {
    const s = sections[key];
    if (s.error) return <p className="booking-manager-error" role="alert">{s.error}</p>;
    if (s.message) return <p className="booking-manager-saved" role="status">{s.message}</p>;
    return null;
  };

  const heading = showTitle ? <h3 className="booking-manager-title">{panelTitle}</h3> : null;

  if (loading) {
    return <div className="booking-manager">{heading}<p className="booking-manager-empty">Loading the booking calendar…</p></div>;
  }

  if (loadError && !saved) {
    return (
      <div className="booking-manager">
        {heading}
        <p className="booking-manager-error" role="alert">{loadError}</p>
        <button type="button" className="booking-manager-btn" onClick={() => void loadCalendars()}>Try Again</button>
      </div>
    );
  }

  if (!saved || !hours || !messaging) {
    return (
      <div className="booking-manager">
        {heading}
        <p className="booking-manager-empty">
          No booking calendar yet: this project has never had one. Create it to set your opening hours, meeting length and wording.
        </p>
        <button type="button" className="booking-manager-btn booking-manager-btn-primary" disabled={creating} onClick={() => void createCalendar()}>
          {creating ? "Creating…" : "Create Booking Calendar"}
        </button>
      </div>
    );
  }

  const { upcoming, past } = splitBookings(bookings, Date.now());
  const noticeListed = MIN_NOTICE_CHOICES.some((c) => String(c.minutes) === meeting.minNoticeMinutes);

  const bookingRows = (list: Booking[], which: "upcoming" | "past") => {
    if (!list.length) {
      return <p className="booking-manager-empty">{emptyBookingsMessage(saved, which, bookings.length)}</p>;
    }
    return (
      <ul className="booking-manager-bookings">
        {list.map((b) => {
          const href = bookingContactHref(contactsPageUrl, b.crmContactId);
          const cancelled = b.status === "cancelled";
          return (
            <li key={b.id} className={`booking-manager-booking${cancelled ? " is-cancelled" : ""}`}>
              <div className="booking-manager-booking-when">
                {formatBookingTime(b.startsAt, b.endsAt, saved.timeZone)}
                {cancelled ? <span className="booking-manager-badge">Cancelled</span> : null}
              </div>
              <div className="booking-manager-booking-who">
                <span className="booking-manager-booking-name">{b.visitorName}</span>
                <span className="booking-manager-booking-email">{b.visitorEmail}</span>
                {b.visitorPhone ? <span className="booking-manager-booking-email">{b.visitorPhone}</span> : null}
              </div>
              {b.visitorNote ? <div className="booking-manager-booking-note">{b.visitorNote}</div> : null}
              {bookingEmailNote(b) ? (
                <div className="booking-manager-booking-email-failed" role="note">{bookingEmailNote(b)}</div>
              ) : null}
              <div className="booking-manager-booking-actions">
                {href ? (
                  <a className="booking-manager-link" href={href}>Open CRM Contact</a>
                ) : (
                  <span className="booking-manager-muted">Not linked to a CRM contact</span>
                )}
                {which === "upcoming" && !cancelled ? (
                  confirmCancelId === b.id ? (
                    <span className="booking-manager-confirm">
                      Cancel this booking?
                      <button type="button" className="booking-manager-btn booking-manager-btn-danger" disabled={cancellingId === b.id} onClick={() => void cancelBooking(b.id)}>
                        {cancellingId === b.id ? "Cancelling…" : "Yes, Cancel It"}
                      </button>
                      <button type="button" className="booking-manager-btn" disabled={cancellingId === b.id} onClick={() => setConfirmCancelId("")}>Keep It</button>
                    </span>
                  ) : (
                    <button type="button" className="booking-manager-btn" onClick={() => setConfirmCancelId(b.id)}>Cancel Booking</button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="booking-manager">
      {heading}
      {loadError ? <p className="booking-manager-error" role="alert">{loadError}</p> : null}

      {calendars.length > 1 ? (
        <div className="booking-manager-field">
          <label htmlFor={`${uid}-calendar`}>Calendar</label>
          <select id={`${uid}-calendar`} value={calendarId} onChange={(e) => chooseCalendar(e.target.value)}>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name || "Untitled calendar"}</option>)}
          </select>
        </div>
      ) : null}

      <section className="booking-manager-section" aria-labelledby={`${uid}-availability`}>
        <h4 id={`${uid}-availability`} className="booking-manager-section-title">Availability</h4>
        <div className="booking-manager-field">
          <label htmlFor={`${uid}-tz`}>Time Zone</label>
          <input
            id={`${uid}-tz`}
            type="text"
            list={`${uid}-zones`}
            value={timeZone}
            placeholder="America/Denver"
            onChange={(e) => setTimeZone(e.target.value)}
          />
          <datalist id={`${uid}-zones`}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
        </div>
        <p className="booking-manager-hint">Opening hours are in this time zone. Visitors see the times in their own.</p>

        <div className="booking-manager-days">
          {BOOKING_DAY_KEYS.map((day) => {
            const windows = hours[day];
            const open = windows.length > 0;
            const problem = dayWindowProblem(windows);
            return (
              <div key={day} className={`booking-manager-day${open ? "" : " is-off"}`}>
                <label className="booking-manager-day-toggle">
                  <input type="checkbox" checked={open} onChange={(e) => setHours(setDayOpen(hours, day, e.target.checked))} />
                  <span>{BOOKING_DAY_LABELS[day]}</span>
                </label>
                <div className="booking-manager-day-windows">
                  {open ? (
                    windows.map((w, i) => (
                      <span key={i} className="booking-manager-window">
                        <input
                          type="time"
                          aria-label={`${BOOKING_DAY_LABELS[day]} range ${i + 1} start`}
                          value={w.start}
                          onChange={(e) => setHours(updateDayWindow(hours, day, i, { start: e.target.value }))}
                        />
                        <span>to</span>
                        <input
                          type="time"
                          aria-label={`${BOOKING_DAY_LABELS[day]} range ${i + 1} end`}
                          value={w.end}
                          onChange={(e) => setHours(updateDayWindow(hours, day, i, { end: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="booking-manager-icon-btn"
                          aria-label={`Remove ${BOOKING_DAY_LABELS[day]} range ${i + 1}`}
                          onClick={() => setHours(removeDayWindow(hours, day, i))}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="booking-manager-muted">Day off</span>
                  )}
                  {open && windows.length < 6 ? (
                    <button type="button" className="booking-manager-btn booking-manager-btn-small" onClick={() => setHours(addDayWindow(hours, day))}>
                      Add Hours
                    </button>
                  ) : null}
                  {problem ? <span className="booking-manager-error-inline" role="alert">{problem}</span> : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="booking-manager-blocked">
          <div className="booking-manager-field">
            <label htmlFor={`${uid}-blocked`}>Block a Date</label>
            <input id={`${uid}-blocked`} type="date" value={newBlockedDate} onChange={(e) => setNewBlockedDate(e.target.value)} />
            <button
              type="button"
              className="booking-manager-btn"
              disabled={!newBlockedDate}
              onClick={() => { setBlockedDates(addBlockedDate(blockedDates, newBlockedDate)); setNewBlockedDate(""); }}
            >
              Block Date
            </button>
          </div>
          {blockedDates.length ? (
            <ul className="booking-manager-blocked-list">
              {blockedDates.map((d) => (
                <li key={d} className="booking-manager-chip">
                  {d}
                  <button type="button" className="booking-manager-icon-btn" aria-label={`Unblock ${d}`} onClick={() => setBlockedDates(removeBlockedDate(blockedDates, d))}>×</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="booking-manager-hint">No dates blocked. Block a holiday or a day away and nobody can book it, even on an open weekday.</p>
          )}
        </div>
        <div className="booking-manager-actions">
          <button type="button" className="booking-manager-btn booking-manager-btn-primary" disabled={sections.availability.saving} onClick={saveAvailability}>
            {sections.availability.saving ? "Saving…" : "Save Availability"}
          </button>
          {status("availability")}
        </div>
      </section>

      <section className="booking-manager-section" aria-labelledby={`${uid}-meeting`}>
        <h4 id={`${uid}-meeting`} className="booking-manager-section-title">Meeting</h4>
        <div className="booking-manager-grid">
          <label htmlFor={`${uid}-name`}>Meeting Title</label>
          <input id={`${uid}-name`} type="text" value={meeting.name} onChange={(e) => setMeeting({ ...meeting, name: e.target.value })} />
          <label htmlFor={`${uid}-length`}>Length (Minutes)</label>
          <input id={`${uid}-length`} type="number" min={5} max={480} step={5} value={meeting.meetingMinutes} onChange={(e) => setMeeting({ ...meeting, meetingMinutes: e.target.value })} />
          <label htmlFor={`${uid}-gap`}>Gap Between (Minutes)</label>
          <input id={`${uid}-gap`} type="number" min={0} max={240} step={5} value={meeting.gapMinutes} onChange={(e) => setMeeting({ ...meeting, gapMinutes: e.target.value })} />
          <label htmlFor={`${uid}-notice`}>Minimum Notice</label>
          <select id={`${uid}-notice`} value={meeting.minNoticeMinutes} onChange={(e) => setMeeting({ ...meeting, minNoticeMinutes: e.target.value })}>
            {!noticeListed ? <option value={meeting.minNoticeMinutes}>{minutesLabel(Number(meeting.minNoticeMinutes))}</option> : null}
            {MIN_NOTICE_CHOICES.map((c) => <option key={c.minutes} value={String(c.minutes)}>{c.label}</option>)}
          </select>
          <label htmlFor={`${uid}-ahead`}>Days Ahead</label>
          <input id={`${uid}-ahead`} type="number" min={1} max={365} value={meeting.daysAhead} onChange={(e) => setMeeting({ ...meeting, daysAhead: e.target.value })} />
        </div>
        <p className="booking-manager-hint">
          Minimum notice stops last-minute bookings; Days Ahead is how far into the future visitors may book.
        </p>
        <div className="booking-manager-actions">
          <button type="button" className="booking-manager-btn booking-manager-btn-primary" disabled={sections.meeting.saving} onClick={saveMeeting}>
            {sections.meeting.saving ? "Saving…" : "Save Meeting"}
          </button>
          {status("meeting")}
        </div>
      </section>

      <section className="booking-manager-section" aria-labelledby={`${uid}-messaging`}>
        <h4 id={`${uid}-messaging`} className="booking-manager-section-title">Messaging</h4>
        {/* ONE grid for every messaging field, so the email rows share the
            label and control tracks of the rows above them (UI_RULES W0). */}
        <div className="booking-manager-grid">
          {MESSAGING_FIELDS.map((f, i) => (
            <FieldPair
              key={f.key}
              id={`${uid}-msg-${f.key}`}
              label={f.label}
              hint={f.hint}
              multiline={f.multiline}
              value={messaging[f.key]}
              onChange={(value) => setMessaging({ ...messaging, [f.key]: value })}
              noteBefore={
                f.group === "email" && MESSAGING_FIELDS[i - 1]?.group !== "email"
                  ? "The confirmation email goes to the visitor when they book, with an add-to-calendar file and a link to cancel or move the meeting. Leave these blank to use plain default wording. Reminder emails start sending in a later update."
                  : ""
              }
            />
          ))}
        </div>
        <div className="booking-manager-actions">
          <button type="button" className="booking-manager-btn booking-manager-btn-primary" disabled={sections.messaging.saving} onClick={saveMessaging}>
            {sections.messaging.saving ? "Saving…" : "Save Messaging"}
          </button>
          {status("messaging")}
        </div>
      </section>

      <section className="booking-manager-section" aria-labelledby={`${uid}-bookings`}>
        <h4 id={`${uid}-bookings`} className="booking-manager-section-title">Bookings</h4>
        {bookingsError ? <p className="booking-manager-error" role="alert">{bookingsError}</p> : null}
        {bookingsNote ? <p className="booking-manager-saved" role="status">{bookingsNote}</p> : null}
        {bookingsLoading && !bookings.length ? (
          <p className="booking-manager-empty">Loading bookings…</p>
        ) : bookingsError && !bookings.length ? null : (
          <>
            <h5 className="booking-manager-subtitle">Upcoming ({upcoming.length})</h5>
            {bookingRows(upcoming, "upcoming")}
            <h5 className="booking-manager-subtitle">Past and Cancelled ({past.length})</h5>
            {bookingRows(past, "past")}
          </>
        )}
      </section>
    </div>
  );
}

function FieldPair({
  id,
  label,
  hint,
  multiline,
  value,
  onChange,
  noteBefore = "",
}: {
  noteBefore?: string;
  id: string;
  label: string;
  hint: string;
  multiline: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      {noteBefore ? <p className="booking-manager-hint booking-manager-grid-note">{noteBefore}</p> : null}
      <label htmlFor={id}>{label}</label>
      <span className="booking-manager-control">
        {multiline ? (
          <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
        )}
        {hint ? <span className="booking-manager-hint">{hint}</span> : null}
      </span>
    </>
  );
}
