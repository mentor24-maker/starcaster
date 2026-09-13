"use client";

/**
 * Harvest PDF — read a club's schedule flyer into weekly programs
 * (task 86bbztj0e). Lives on the Event Manager, shown only to a platform login:
 * every upload bills Alphire's model account, and the server refuses a tenant
 * admin session outright.
 *
 * Three steps, and nothing is written until the third:
 *   1. choose the file — it is read by /api/event-harvest/extract;
 *   2. review — every program found, editable, with a tick box; programs the
 *      calendar already has start unticked;
 *   3. create — venues first, then one weekly repeating event per kept row,
 *      through the ordinary /api/events route, reporting any row that failed.
 */

import { useMemo, useState } from "react";
import { readApiErrorMessage } from "@/lib/public-admin-session";
import { WEEKDAY_SHORT, isValidTimeZone } from "@/lib/event-recurrence";
import {
  HARVEST_DAY_ORDER,
  eventPayloadFor,
  mondayOf,
  rowProblems,
  rowsFromHarvest,
  venuesToCreate,
  type HarvestResult,
  type ReviewRow,
} from "@/lib/event-harvest";

type Category = { id: string; name: string; color: string; sortOrder: number };

type Props = {
  accent: string;
  categories: Category[];
  headers: () => Record<string, string>;
  onClose: () => void;
  /** Called after creating, so the manager reloads its table and venues. */
  onCreated: () => void;
};

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/gif";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("That file could not be opened."));
    reader.readAsDataURL(file);
  });
}

export function BuilderEventHarvest({ accent, categories, headers, onClose, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<HarvestResult | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [weekStart, setWeekStart] = useState("");
  // Filled from the zone the club's events already use. Never the reviewer's
  // own zone: Dane reviews in Mountain time, Delray runs on Eastern.
  const [timeZone, setTimeZone] = useState("");
  const [status, setStatus] = useState("published");
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState("");
  const [outcome, setOutcome] = useState<{ created: number; failed: string[] } | null>(null);

  async function readFlyer() {
    if (!file) { setError("Choose the schedule file first."); return; }
    setReading(true);
    setError("");
    setOutcome(null);
    try {
      const fileBase64 = await readAsBase64(file);
      const res = await fetch("/api/event-harvest/extract", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ fileBase64, mimeType: file.type, fileName: file.name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(readApiErrorMessage(body, `The schedule could not be read (${res.status}).`));
      const data = (body?.data ?? body) as HarvestResult & { timeZone?: string };
      setTimeZone(data.timeZone || "");
      setResult(data);
      setRows(rowsFromHarvest(data));
      setWeekStart(data.weekStart ? mondayOf(data.weekStart) : mondayOf(new Date().toISOString().slice(0, 10)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The schedule could not be read.");
    } finally {
      setReading(false);
    }
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const kept = rows.filter((r) => r.include);
  const problems = useMemo(() => rowProblems(rows), [rows]);
  const venueNames = useMemo(() => {
    const names = new Set<string>();
    for (const v of result?.venues || []) names.add(v.name);
    for (const c of categories) names.add(c.name);
    return Array.from(names);
  }, [result, categories]);

  async function createEvents() {
    if (!result) return;
    if (!kept.length) { setError("Tick at least one program to create."); return; }
    if (problems.length) { setError(problems[0].message); return; }
    if (!isValidTimeZone(timeZone)) { setError("Enter a real time zone, such as America/New_York."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) { setError("Choose the week the schedule starts."); return; }

    setCreating(true);
    setError("");
    const failed: string[] = [];
    const createdKeys = new Set<string>();
    const post = async (url: string, payload: unknown) => {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(readApiErrorMessage(body, `failed (${res.status})`));
      return body?.data ?? body?.category ?? body?.event ?? body;
    };

    // Venue name → category id: the project's own first, then any created now.
    const idByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    let order = categories.reduce((max, c) => Math.max(max, c.sortOrder), 0);
    for (const venue of venuesToCreate(rows, result.venues)) {
      if (idByName.has(venue.name.toLowerCase())) continue;
      setProgress(`Adding venue ${venue.name}…`);
      try {
        order += 1;
        const made = await post("/api/event-categories", { name: venue.name, color: venue.color, sortOrder: order });
        if (made?.id) idByName.set(venue.name.toLowerCase(), made.id);
      } catch (err) {
        failed.push(`Venue "${venue.name}": ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    for (const [index, row] of kept.entries()) {
      setProgress(`Creating ${index + 1} of ${kept.length}: ${row.title}`);
      try {
        await post("/api/events", eventPayloadFor(row, {
          weekStart,
          timeZone,
          status,
          categoryId: idByName.get(row.venue.toLowerCase()) || "",
        }));
        createdKeys.add(row.key);
      } catch (err) {
        failed.push(`${row.title}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    setCreating(false);
    setProgress("");
    setOutcome({ created: createdKeys.size, failed });
    if (createdKeys.size) {
      // Created rows leave the table, so a second press cannot duplicate them;
      // rows that failed stay, ticked, to fix and retry. Tracked by row key —
      // two programs can share a name ("Intro to WWO" at 8:30 and at 9:00).
      setRows((list) => list.filter((r) => !createdKeys.has(r.key)));
      onCreated();
    }
  }

  return (
    <div className="builder-event-harvest">
      <div className="builder-event-harvest-head">
        <h3 className="builder-event-manager-form-title">Harvest PDF</h3>
        <button type="button" className="btn btn-ghost tiny-btn" onClick={onClose} disabled={reading || creating}>Close</button>
      </div>
      <p className="builder-event-manager-hint">
        Upload a weekly schedule (PDF or image). It is read by AI, then shown here for you to check —
        nothing is added to the calendar until you press Create. Each upload costs a few cents.
      </p>

      <div className="builder-event-harvest-upload">
        <input
          type="file"
          accept={ACCEPT}
          aria-label="Schedule file"
          disabled={reading || creating}
          onChange={(e) => { setFile(e.target.files?.[0] || null); setError(""); }}
        />
        <button
          type="button"
          className="btn tiny-btn"
          disabled={!file || reading || creating}
          onClick={readFlyer}
          style={{ background: accent, borderColor: accent }}
        >
          {reading ? "Reading…" : result ? "Read again" : "Read schedule"}
        </button>
        {reading ? <span className="builder-event-manager-hint">This usually takes under a minute.</span> : null}
      </div>

      {error ? <div className="builder-event-manager-error" role="alert">{error}</div> : null}

      {outcome ? (
        <div className={outcome.failed.length ? "builder-event-manager-error" : "builder-event-manager-notice"} role="status">
          Created {outcome.created} program{outcome.created === 1 ? "" : "s"}.
          {outcome.failed.length ? (
            <ul className="builder-event-harvest-failures">
              {outcome.failed.map((f) => <li key={f}>{f}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <>
          <p className="builder-event-manager-hint">
            Read {result.lineCount} line{result.lineCount === 1 ? "" : "s"} as {result.series.length} weekly
            program{result.series.length === 1 ? "" : "s"}.
            {result.dropped ? ` ${result.dropped} line${result.dropped === 1 ? "" : "s"} could not be read and ${result.dropped === 1 ? "was" : "were"} left out — check them against the flyer.` : ""}
            {rows.some((r) => r.existingEventId) ? " Programs already on the calendar are unticked." : ""}
          </p>

          <div className="builder-event-manager-field-row builder-event-harvest-options">
            <div className="builder-event-manager-field">
              <label className="builder-event-manager-label" htmlFor="harvest-week">Week starting</label>
              <input id="harvest-week" type="date" className="builder-event-manager-input" value={weekStart}
                onChange={(e) => setWeekStart(e.target.value ? mondayOf(e.target.value) : "")} />
            </div>
            <div className="builder-event-manager-field">
              <label className="builder-event-manager-label" htmlFor="harvest-zone">Time zone</label>
              <input id="harvest-zone" className="builder-event-manager-input" value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)} placeholder="America/New_York"
                aria-invalid={!isValidTimeZone(timeZone)} />
              {!isValidTimeZone(timeZone) ? (
                <span className="builder-event-harvest-exists">
                  {timeZone ? "Not a time zone name." : "This site has no events with a time zone yet — enter the club's, e.g. America/New_York."}
                </span>
              ) : null}
            </div>
            <div className="builder-event-manager-field">
              <label className="builder-event-manager-label" htmlFor="harvest-status">Create as</label>
              <select id="harvest-status" className="builder-event-manager-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>

          {rows.length ? (
            <div className="builder-admin-data-table-wrap">
              <table className="builder-admin-data-table builder-event-harvest-table">
                <thead>
                  <tr className="builder-admin-data-table-header-row">
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Keep every program"
                        checked={rows.length > 0 && rows.every((r) => r.include)}
                        onChange={(e) => setRows((list) => list.map((r) => ({ ...r, include: e.target.checked })))}
                      />
                    </th>
                    <th>Program</th>
                    <th>Instructor</th>
                    <th>Days</th>
                    <th>Starts</th>
                    <th>Ends</th>
                    <th>Venue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className={row.include ? "" : "is-skipped"}>
                      <td>
                        <input type="checkbox" aria-label={`Keep ${row.title}`} checked={row.include}
                          onChange={(e) => updateRow(row.key, { include: e.target.checked })} />
                      </td>
                      <td>
                        <input className="builder-event-manager-input" aria-label="Program" value={row.title}
                          onChange={(e) => updateRow(row.key, { title: e.target.value })} />
                        {row.existingEventId ? <span className="builder-event-harvest-exists">Already on the calendar</span> : null}
                      </td>
                      <td>
                        <input className="builder-event-manager-input" aria-label="Instructor" value={row.instructor}
                          onChange={(e) => updateRow(row.key, { instructor: e.target.value })} />
                      </td>
                      <td>
                        <div className="builder-event-harvest-days" role="group" aria-label={`Days for ${row.title}`}>
                          {HARVEST_DAY_ORDER.map((day) => {
                            const on = row.weekdays.includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                aria-pressed={on}
                                className={`builder-event-harvest-day${on ? " is-on" : ""}`}
                                style={on ? { background: accent, borderColor: accent } : undefined}
                                onClick={() => updateRow(row.key, {
                                  weekdays: on ? row.weekdays.filter((d) => d !== day) : [...row.weekdays, day].sort((a, b) => a - b),
                                })}
                              >
                                {WEEKDAY_SHORT[day].slice(0, 2)}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <input type="time" className="builder-event-manager-input" aria-label="Starts" value={row.startTime}
                          onChange={(e) => updateRow(row.key, { startTime: e.target.value })} />
                      </td>
                      <td>
                        <input type="time" className="builder-event-manager-input" aria-label="Ends" value={row.endTime}
                          onChange={(e) => updateRow(row.key, { endTime: e.target.value })} />
                      </td>
                      <td>
                        <select className="builder-event-manager-input" aria-label="Venue" value={row.venue}
                          onChange={(e) => updateRow(row.key, { venue: e.target.value })}>
                          <option value="">No venue</option>
                          {venueNames.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="builder-event-manager-hint">Nothing left to create from this schedule.</p>
          )}

          {rows.length ? (
            <div className="builder-event-manager-form-actions">
              {progress ? <span className="builder-event-manager-hint" aria-live="polite">{progress}</span> : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={creating || !kept.length}
                onClick={createEvents}
                style={{ background: accent, borderColor: accent }}
              >
                {creating ? "Creating…" : `Create ${kept.length} program${kept.length === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
