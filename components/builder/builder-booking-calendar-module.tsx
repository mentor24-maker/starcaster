"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { resolveSessionProjectId } from "@/lib/adapters/starcaster-app";
import {
  addMonths,
  bookableMonthRange,
  bookingMonthGrid,
  compareMonths,
  formatDayHeading,
  formatMonthHeading,
  formatSlotTime,
  groupSlotsByDay,
  monthOfKey,
  noTimesMessage,
  parseVisitorCalendarData,
  timeZoneLabel,
  visitorTimeZone,
  type VisitorCalendarData,
  type VisitorSlot,
} from "@/lib/booking-calendar";
import { BuilderOnlyNote } from "./builder-only-note";

/**
 * The booking calendar visitors use on a live site (SC-911, slice 3 of the
 * booking calendar). Pick a day, pick a free time shown on the visitor's own
 * clock with the zone named, fill a short form, book. The server
 * (routes/bookingPublic.js) checks the time is still free, saves the booking
 * and files the visitor in the project's CRM.
 *
 * Settings: `calendarId` (empty = the project's first calendar, the one the
 * Booking Manager opens on), `heading` (empty = the calendar's own heading
 * from the Booking Manager), `accentColor` (empty = the theme's primary
 * colour), `weekStartsOn` ("0" Sunday, "1" Monday).
 *
 * On a LIVE page nothing here is addressed to the builder (landmine 16): a
 * project with no calendar renders nothing at all, and a calendar with no
 * free time says so in visitor words. In the Builder the same states explain
 * themselves inside BuilderOnlyNote, and the Book button is held back so
 * trying the module out never files a real booking.
 */

type Props = {
  settings: Record<string, string>;
  projectId?: string;
  liveSite?: boolean;
  themePalette?: { primaryColor?: string };
};

type Load =
  | { state: "loading" }
  | { state: "ready"; data: VisitorCalendarData }
  | { state: "none" }
  | { state: "error"; message: string };

type Step = "pick" | "form" | "done";

const WEEKDAYS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function readError(body: unknown, fallback: string): string {
  const err = (body as { error?: { message?: string } | string } | null)?.error;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object" && err.message) return err.message;
  return fallback;
}

export function BookingCalendarModule({ settings, projectId = "", liveSite = false, themePalette }: Props) {
  const uid = useId();
  const calendarId = String(settings.calendarId ?? "").trim();
  const weekStartsOn: 0 | 1 = settings.weekStartsOn === "1" ? 1 : 0;
  const accent = settings.accentColor || themePalette?.primaryColor || "#0f4f8f";
  const project = projectId || resolveSessionProjectId();
  const zone = useMemo(() => visitorTimeZone(), []);

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [month, setMonth] = useState<{ year: number; month: number } | null>(null);
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState<VisitorSlot | null>(null);
  const [step, setStep] = useState<Step>("pick");
  const [form, setForm] = useState({ name: "", email: "", phone: "", note: "" });
  const [trap, setTrap] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    const params = new URLSearchParams();
    if (project) params.set("projectId", project);
    if (calendarId) params.set("calendarId", calendarId);
    fetch(`/api/public/booking/calendar?${params.toString()}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.status === 404 && (body as { error?: { code?: string } } | null)?.error?.code === "NO_CALENDAR") {
          setLoad({ state: "none" });
          return;
        }
        if (!response.ok) throw new Error(readError(body, `The booking calendar could not be loaded (${response.status}).`));
        const data = parseVisitorCalendarData((body as { data?: unknown } | null)?.data);
        if (!data) throw new Error("The booking calendar answered in a shape this page cannot read.");
        setLoad({ state: "ready", data });
      })
      .catch((error: Error) => {
        if (!cancelled) setLoad({ state: "error", message: error.message || "The booking calendar could not be loaded." });
      });
    return () => {
      cancelled = true;
    };
  }, [project, calendarId, reloadKey]);

  const byDay = useMemo(
    () => (load.state === "ready" ? groupSlotsByDay(load.data.slots, zone) : new Map<string, VisitorSlot[]>()),
    [load, zone]
  );
  const range = useMemo(() => bookableMonthRange(byDay), [byDay]);

  // Open on the month of the first free day, not "this month": on the 30th, a
  // calendar whose first opening is the 2nd would otherwise open on an empty month.
  useEffect(() => {
    if (range && !month) setMonth(range.first);
  }, [range, month]);

  if (load.state === "none") {
    if (liveSite) return null;
    return (
      <BuilderOnlyNote liveSite={liveSite}>
        This project has no booking calendar yet. Open the Booking Manager admin page and press Create to make one; this
        module then shows its free times.
      </BuilderOnlyNote>
    );
  }

  const data = load.state === "ready" ? load.data : null;
  const heading = settings.heading || data?.calendar.heading || "";
  const intro = data?.calendar.intro || "";
  const style = { "--booking-accent": accent } as CSSProperties;

  if (load.state === "loading") {
    return (
      <div className="builder-booking-calendar" style={style} aria-busy="true">
        {heading ? <h3 className="builder-booking-calendar-heading">{heading}</h3> : null}
        <p className="builder-booking-calendar-status">Loading available times…</p>
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <div className="builder-booking-calendar" style={style}>
        {heading ? <h3 className="builder-booking-calendar-heading">{heading}</h3> : null}
        <p className="builder-booking-calendar-status">Online booking is not available right now. Please try again later.</p>
        <BuilderOnlyNote liveSite={liveSite}>The booking calendar could not be read: {load.message}</BuilderOnlyNote>
      </div>
    );
  }

  const zoneLine = (
    <p className="builder-booking-calendar-zone">
      Times are shown in your time zone: <strong>{timeZoneLabel(zone)}</strong>
    </p>
  );

  if (step === "done") {
    return (
      <div className="builder-booking-calendar" style={style}>
        {heading ? <h3 className="builder-booking-calendar-heading">{heading}</h3> : null}
        <div className="builder-booking-calendar-done" role="status">
          <p className="builder-booking-calendar-done-message">{confirmation}</p>
          {slot ? (
            <p className="builder-booking-calendar-done-when">
              {formatDayHeading(day)} at {formatSlotTime(slot.startsAt, zone)}, {timeZoneLabel(zone, slot.startsAt)}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (!range || !month) {
    return (
      <div className="builder-booking-calendar" style={style}>
        {heading ? <h3 className="builder-booking-calendar-heading">{heading}</h3> : null}
        {intro ? <p className="builder-booking-calendar-intro">{intro}</p> : null}
        <p className="builder-booking-calendar-empty">{noTimesMessage(data?.days ?? 0)}</p>
        <BuilderOnlyNote liveSite={liveSite}>
          Opening hours, days off and how far ahead visitors may book are set on the Booking Manager admin page.
        </BuilderOnlyNote>
      </div>
    );
  }

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slot || !data || !liveSite) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch("/api/public/booking/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectId: project,
          calendarId: data.calendar.id,
          startsAt: slot.startsAt,
          ...form,
          _trap: trap,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = readError(body, "The booking could not be made. Please try again.");
        if (response.status === 409) {
          // Somebody else took it: send the visitor back to the times, refreshed.
          setSlot(null);
          setStep("pick");
          setReloadKey((n) => n + 1);
        }
        setFormError(message);
        return;
      }
      setConfirmation(String((body as { data?: { confirmation?: string } } | null)?.data?.confirmation || "You are booked."));
      setStep("done");
    } catch {
      setFormError("The booking could not be sent. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const weeks = bookingMonthGrid(month.year, month.month, byDay, weekStartsOn);
  const weekdays = weekStartsOn === 1 ? [...WEEKDAYS_SUN.slice(1), WEEKDAYS_SUN[0]] : WEEKDAYS_SUN;
  const canGoBack = compareMonths(month, range.first) > 0;
  const canGoForward = compareMonths(month, range.last) < 0;
  const times = day ? byDay.get(day) ?? [] : [];

  return (
    <div className="builder-booking-calendar" style={style}>
      {heading ? <h3 className="builder-booking-calendar-heading">{heading}</h3> : null}
      {intro ? <p className="builder-booking-calendar-intro">{intro}</p> : null}
      {zoneLine}
      {formError && step === "pick" ? <p className="builder-booking-calendar-error" role="alert">{formError}</p> : null}

      {step === "pick" ? (
        <div className="builder-booking-calendar-picker">
          <div className="builder-booking-calendar-month">
            <div className="builder-booking-calendar-month-bar">
              <button type="button" className="builder-booking-calendar-nav" aria-label="Previous month" disabled={!canGoBack} onClick={() => setMonth(addMonths(month, -1))}>
                ‹
              </button>
              <span className="builder-booking-calendar-month-name" id={`${uid}-month`}>{formatMonthHeading(month.year, month.month)}</span>
              <button type="button" className="builder-booking-calendar-nav" aria-label="Next month" disabled={!canGoForward} onClick={() => setMonth(addMonths(month, 1))}>
                ›
              </button>
            </div>
            <div className="builder-booking-calendar-grid" role="grid" aria-labelledby={`${uid}-month`}>
              {weekdays.map((name) => (
                <span key={name} className="builder-booking-calendar-weekday" role="columnheader">{name}</span>
              ))}
              {weeks.flat().map((cell) =>
                cell.inMonth ? (
                  <button
                    key={cell.key}
                    type="button"
                    role="gridcell"
                    className={`builder-booking-calendar-day${cell.bookable ? " is-bookable" : ""}${cell.key === day ? " is-selected" : ""}`}
                    data-day={cell.key}
                    disabled={!cell.bookable}
                    aria-pressed={cell.key === day}
                    aria-label={`${formatDayHeading(cell.key)}${cell.bookable ? ", times available" : ", no times"}`}
                    onClick={() => {
                      setDay(cell.key);
                      setFormError("");
                    }}
                  >
                    {cell.date.getDate()}
                  </button>
                ) : (
                  <span key={cell.key} className="builder-booking-calendar-day is-outside" aria-hidden="true" />
                )
              )}
            </div>
          </div>
          <div className="builder-booking-calendar-times">
            {day ? (
              <>
                <p className="builder-booking-calendar-times-heading">{formatDayHeading(day)}</p>
                <ul className="builder-booking-calendar-time-list">
                  {times.map((s) => (
                    <li key={s.startsAt}>
                      <button
                        type="button"
                        className="builder-booking-calendar-time"
                        onClick={() => {
                          setSlot(s);
                          setStep("form");
                          setFormError("");
                        }}
                      >
                        {formatSlotTime(s.startsAt, zone)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="builder-booking-calendar-hint">Choose a day to see the times.</p>
            )}
          </div>
        </div>
      ) : (
        <form className="builder-booking-calendar-form" onSubmit={(e) => void book(e)}>
          <p className="builder-booking-calendar-chosen">
            {formatDayHeading(day)} at <strong>{slot ? formatSlotTime(slot.startsAt, zone) : ""}</strong>
            {data?.calendar.meetingMinutes ? ` for ${data.calendar.meetingMinutes} minutes` : ""}{" "}
            <button type="button" className="builder-booking-calendar-change" onClick={() => setStep("pick")}>
              Change
            </button>
          </p>
          <label>
            <span>Name</span>
            <input name="name" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            <span>Phone (Optional)</span>
            <input name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label>
            <span>Note (Optional)</span>
            <textarea name="note" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          {/* Honeypot: hidden from people, filled in by bots. */}
          <input
            className="builder-booking-calendar-trap"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={trap}
            onChange={(e) => setTrap(e.target.value)}
          />
          {formError ? <p className="builder-booking-calendar-error" role="alert">{formError}</p> : null}
          <button type="submit" className="builder-booking-calendar-submit" disabled={submitting || !liveSite}>
            {submitting ? "Booking…" : "Book this time"}
          </button>
          <BuilderOnlyNote liveSite={liveSite}>
            Booking is switched off in the Builder so trying this out never files a real meeting. It works on the published page.
          </BuilderOnlyNote>
        </form>
      )}
    </div>
  );
}

/** The Builder's module card thumbnail: a still sample, no fetch. */
export function BookingCalendarSample({ settings }: { settings: Record<string, string> }) {
  const accent = settings.accentColor || "#0f4f8f";
  return (
    <div className="builder-module-preview-copy">
      <div style={{ fontWeight: 700, fontSize: 14, color: "#18324a", marginBottom: 6 }}>{settings.heading || "Book a meeting"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, fontSize: 10, maxWidth: 210 }}>
        {Array.from({ length: 14 }, (_, i) => (
          <span
            key={i}
            style={{
              textAlign: "center",
              padding: "3px 0",
              borderRadius: 4,
              background: i % 7 === 0 || i % 7 === 6 ? "#f1f5f9" : "#fff",
              border: `1px solid ${i % 7 === 0 || i % 7 === 6 ? "#e2e8f0" : accent}`,
              color: i % 7 === 0 || i % 7 === 6 ? "#94a3b8" : accent,
            }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#5b7489", marginTop: 6 }}>Pick a day, pick a time, book. Visitors land in the CRM.</div>
    </div>
  );
}
