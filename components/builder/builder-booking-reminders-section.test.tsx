// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingRemindersSection } from "./builder-booking-reminders-section";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * SC-914. The Booking Manager's Reminders section against a stand-in for
 * routes/bookingReminders.js that keeps what was saved, so "the screen shows
 * what saved" can fail here, and that lists a reminder that failed three times.
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

type Store = { settings: Record<string, unknown>; problems: unknown[]; patches: unknown[]; failRead?: boolean };

function stubApi(store: Store) {
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (String(url) !== "/api/booking/calendars/cal1/reminders") return json(404, { ok: false, error: { message: `unexpected ${url}` } });
    if (method === "GET") {
      if (store.failRead) return json(500, { ok: false, error: { message: 'column bookings.reminder_settings does not exist' } });
      return json(200, { ok: true, data: { settings: store.settings, problems: store.problems } });
    }
    const patch = JSON.parse(String(init?.body));
    store.patches.push(patch);
    store.settings = { ...patch, offsetsMinutes: [...patch.offsetsMinutes].sort((a: number, b: number) => b - a) };
    return json(200, { ok: true, data: store.settings });
  }));
}

const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<BookingRemindersSection calendarId="cal1" timeZone="America/Denver" projectId="p1" />));
  await settle();
  return container;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found as HTMLButtonElement;
}

describe("Booking Manager: Reminders", () => {
  it("shows the saved reminder times, adds one, saves, and shows what the server now holds", async () => {
    const store: Store = { settings: { enabled: true, offsetsMinutes: [1440, 60], notifyOwner: false }, problems: [], patches: [] };
    stubApi(store);
    const host = await mount();
    const selects = Array.from(host.querySelectorAll("select")) as HTMLSelectElement[];
    expect(selects.map((s) => s.value)).toEqual(["1440", "60"]);
    expect(selects[0].selectedOptions[0].textContent).toBe("1 day before");

    await act(async () => button(host, "Add Reminder").click());
    expect(host.querySelectorAll("select")).toHaveLength(3);
    expect(host.textContent).not.toContain("Add Reminder");

    const owner = Array.from(host.querySelectorAll("label")).find((l) => l.textContent?.includes("Also Remind the Site Owner"))!;
    await act(async () => (owner.querySelector("input") as HTMLInputElement).click());
    await act(async () => button(host, "Save Reminders").click());
    await settle();
    expect(store.patches).toEqual([{ enabled: true, offsetsMinutes: [1440, 60, 120], notifyOwner: true }]);
    expect((Array.from(host.querySelectorAll("select")) as HTMLSelectElement[]).map((s) => s.value)).toEqual(["1440", "120", "60"]);
    expect(host.textContent).toContain("Saved.");
    expect(host.textContent).toContain("Reminders Not Sent (0)");
    expect(host.textContent).toContain("None. A reminder that fails is tried again");
  });

  it("refuses to save reminders switched on with no times, before asking the server", async () => {
    const store: Store = { settings: { enabled: true, offsetsMinutes: [60], notifyOwner: false }, problems: [], patches: [] };
    stubApi(store);
    const host = await mount();
    await act(async () => (host.querySelector('[aria-label="Remove reminder 1"]') as HTMLButtonElement).click());
    await act(async () => button(host, "Save Reminders").click());
    expect(store.patches).toEqual([]);
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/at least one reminder time/);
  });

  it("names every reminder that failed three times: who, which meeting, why", async () => {
    stubApi({
      settings: { enabled: true, offsetsMinutes: [1440], notifyOwner: false },
      problems: [{
        id: "r1", bookingId: "b1", offsetMinutes: 1440, startsAt: "2026-12-02T16:30:00.000Z", recipient: "visitor",
        attempts: 3, error: "Resend refused the address", visitorName: "Pat", visitorEmail: "pat@example.com", bookingStatus: "booked",
      }],
      patches: [],
    });
    const host = await mount();
    expect(host.textContent).toContain("Reminders Not Sent (1)");
    expect(host.querySelector(".booking-manager-reminder-problems")?.textContent).toBe(
      "The 1 day before reminder to Pat (pat@example.com) for the meeting on Wed, Dec 2, 2026, 9:30 AM was not sent after 3 tries: Resend refused the address",
    );
  });

  it("says when the settings could not be read, never shows them as off", async () => {
    stubApi({ settings: {}, problems: [], patches: [], failRead: true });
    const host = await mount();
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/reminder_settings does not exist/);
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).toContain("Try Again");
  });
});
