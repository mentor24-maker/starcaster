// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingManagerModule } from "./builder-booking-manager-module";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * SC-910. The Booking Manager against a small in-memory stand-in for slice 1's
 * API (routes/booking.js): it keeps what was saved and answers every PATCH
 * with the stored calendar, so "the screen shows what saved" is something this
 * test can fail on. A second mount over the same store is the reload.
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

type Store = {
  calendar: Record<string, unknown> | null;
  bookings: Array<Record<string, unknown>>;
  patches: unknown[];
  google?: Record<string, unknown>;
  retries?: string[];
};

function makeStore(withCalendar = true): Store {
  return {
    calendar: withCalendar
      ? {
          id: "cal1",
          name: "Book a meeting",
          timeZone: "America/Denver",
          weeklyHours: { mon: [{ start: "09:00", end: "17:00" }], tue: [{ start: "09:00", end: "17:00" }] },
          blockedDates: [],
          meetingMinutes: 30,
          gapMinutes: 0,
          minNoticeMinutes: 240,
          daysAhead: 60,
          messaging: { heading: "", intro: "", confirmation: "" },
        }
      : null,
    bookings: [],
    patches: [],
  };
}

function stubApi(store: Store) {
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method || "GET";
    if (href === "/api/booking/calendars" && method === "GET") return json(200, { ok: true, data: store.calendar ? [store.calendar] : [] });
    if (href === "/api/booking/calendars" && method === "POST") {
      store.calendar = { ...makeStore().calendar!, id: "cal-new" };
      return json(200, { ok: true, data: store.calendar });
    }
    if (href.startsWith("/api/booking/calendars/") && href.includes("/bookings")) return json(200, { ok: true, data: store.bookings });
    if (href.startsWith("/api/booking/calendars/") && method === "PATCH") {
      const patch = JSON.parse(String(init?.body));
      store.patches.push(patch);
      store.calendar = { ...store.calendar!, ...patch };
      return json(200, { ok: true, data: store.calendar });
    }
    const cancel = href.match(/^\/api\/booking\/bookings\/([^/]+)\/cancel$/);
    if (cancel && method === "POST") {
      const b = store.bookings.find((x) => x.id === cancel[1]);
      if (!b) return json(404, { ok: false, error: { message: "That booking does not exist in this project" } });
      b.status = "cancelled";
      return json(200, { ok: true, data: b });
    }
    if (href === "/api/booking/google" && method === "GET") {
      return json(200, { ok: true, data: store.google || { configured: true, connected: false, accountLabel: "", needsAttention: false, lastError: "" } });
    }
    const retry = href.match(/^\/api\/booking\/bookings\/([^/]+)\/google-sync$/);
    if (retry && method === "POST") {
      (store.retries ||= []).push(retry[1]);
      const b = store.bookings.find((x) => x.id === retry[1])!;
      Object.assign(b, { meetLink: "https://meet.google.com/new-link-xyz", googleSyncStatus: "synced", googleSyncError: "" });
      return json(200, { ok: true, data: b });
    }
    return json(404, { ok: false, error: { message: `unexpected ${method} ${href}` } });
  }));
}

const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

async function mount(settings: Record<string, string> = {}) {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<BookingManagerModule settings={settings} projectId="p1" />));
  await settle();
  return container;
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found as HTMLButtonElement;
}

function labelled(host: HTMLElement, label: string): HTMLInputElement {
  const l = Array.from(host.querySelectorAll("label")).find((x) => x.textContent?.trim() === label);
  const id = l?.getAttribute("for");
  const el = id ? (host.querySelector(`[id="${id}"]`) as HTMLInputElement | null) : null;
  if (!el) throw new Error(`no field labelled "${label}"`);
  return el;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

describe("Booking Manager", () => {
  it("saves meeting settings and shows them again after a reload", async () => {
    const store = makeStore();
    stubApi(store);
    let host = await mount();
    await act(async () => setValue(labelled(host, "Length (Minutes)"), "45"));
    await act(async () => setValue(labelled(host, "Meeting Title"), "Strategy call"));
    await click(button(host, "Save Meeting"));
    expect(host.textContent).toContain("Saved.");
    expect(store.patches[0]).toMatchObject({ name: "Strategy call", meetingMinutes: 45 });

    host = await mount();
    expect(labelled(host, "Length (Minutes)").value).toBe("45");
    expect(labelled(host, "Meeting Title").value).toBe("Strategy call");
  });

  it("turns a day off and blocks a single date, both saved", async () => {
    const store = makeStore();
    stubApi(store);
    let host = await mount();
    const monday = Array.from(host.querySelectorAll<HTMLLabelElement>(".booking-manager-day-toggle"))
      .find((l) => l.textContent?.includes("Monday"))!.querySelector("input")!;
    await click(monday);
    await act(async () => setValue(labelled(host, "Block a Date"), "2026-12-25"));
    await click(button(host, "Block Date"));
    await click(button(host, "Save Availability"));
    const saved = store.patches[0] as { weeklyHours: Record<string, unknown[]>; blockedDates: string[] };
    expect(saved.weeklyHours.mon).toEqual([]);
    expect(saved.weeklyHours.tue).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(saved.blockedDates).toEqual(["2026-12-25"]);

    host = await mount();
    expect(host.textContent).toContain("2026-12-25");
    const mondayAfter = Array.from(host.querySelectorAll<HTMLLabelElement>(".booking-manager-day-toggle"))
      .find((l) => l.textContent?.includes("Monday"))!.querySelector("input")!;
    expect(mondayAfter.checked).toBe(false);
  });

  it("says why the bookings list is empty", async () => {
    stubApi(makeStore());
    const host = await mount();
    expect(host.textContent).toContain("No bookings yet: nobody has booked a time on this calendar.");
  });

  it("cancels a booking from the list, and links the visitor's CRM contact by id", async () => {
    const store = makeStore();
    const start = new Date(Date.now() + 3 * 86400000);
    store.bookings = [{
      id: "b1", calendarId: "cal1", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 1800000).toISOString(),
      visitorName: "Ada Lovelace", visitorEmail: "ada@example.test", crmContactId: "contact-7", status: "booked",
    }];
    stubApi(store);
    const host = await mount({ contactsPageUrl: "/people" });
    const link = host.querySelector<HTMLAnchorElement>(".booking-manager-link")!;
    expect(link.getAttribute("href")).toBe("/people?contact=contact-7");
    await click(button(host, "Cancel Booking"));
    await click(button(host, "Yes, Cancel It"));
    expect(store.bookings[0].status).toBe("cancelled");
    expect(host.textContent).toContain("Its time is free for visitors to book again.");
    expect(host.textContent).toContain("Upcoming (0)");
    expect(host.querySelector(".booking-manager-booking.is-cancelled")).not.toBeNull();
  });

  it("offers to create the calendar when the project has none", async () => {
    const store = makeStore(false);
    stubApi(store);
    const host = await mount();
    expect(host.textContent).toContain("No booking calendar yet");
    await click(button(host, "Create Booking Calendar"));
    expect(store.calendar?.id).toBe("cal-new");
    expect(host.textContent).toContain("Save Availability");
  });
});

describe("Booking Manager — Google Calendar (SC-913)", () => {
  it("names the connected Google account and offers Disconnect, not Connect", async () => {
    const store = makeStore();
    store.google = { configured: true, connected: true, accountLabel: "owner@gmail.example", needsAttention: false, lastError: "" };
    stubApi(store);
    const el = await mount();
    expect(el.querySelector("[data-google-status]")?.textContent).toBe("Connected as owner@gmail.example.");
    const labels = Array.from(el.querySelectorAll(".booking-manager-google button")).map((b) => b.textContent);
    expect(labels).toEqual(["Disconnect"]);
  });

  it("offers Connect when nothing is connected", async () => {
    stubApi(makeStore());
    const el = await mount();
    const button = Array.from(el.querySelectorAll(".booking-manager-google button")).find((b) => b.textContent === "Connect Google Calendar");
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a booking's Meet link, and \"No Meet link yet\" with a Retry that fixes it", async () => {
    const store = makeStore();
    const soon = Date.now() + 86400000;
    store.bookings = [
      { id: "b1", calendarId: "cal1", status: "booked", visitorName: "Pat", visitorEmail: "pat@example.com", startsAt: new Date(soon).toISOString(), endsAt: new Date(soon + 1800000).toISOString(), crmContactId: null, meetLink: "https://meet.google.com/abc-defg-hij", googleSyncStatus: "synced" },
      { id: "b2", calendarId: "cal1", status: "booked", visitorName: "Sam", visitorEmail: "sam@example.com", startsAt: new Date(soon + 7200000).toISOString(), endsAt: new Date(soon + 9000000).toISOString(), crmContactId: null, meetLink: "", googleSyncStatus: "failed", googleSyncError: "Google could not be reached" },
    ];
    stubApi(store);
    const el = await mount();
    const link = el.querySelector(".booking-manager-booking-meet a") as HTMLAnchorElement;
    expect(link.href).toBe("https://meet.google.com/abc-defg-hij");
    const missing = el.querySelector(".booking-manager-booking-meet.is-missing")!;
    expect(missing.textContent).toContain("No Meet link yet: Google could not be reached");
    await act(async () => (missing.querySelector("button") as HTMLButtonElement).click());
    await settle();
    expect(store.retries).toEqual(["b2"]);
    expect(el.querySelector(".booking-manager-booking-meet.is-missing")).toBeNull();
    expect(el.querySelectorAll(".booking-manager-booking-meet a").length).toBe(2);
  });
});
