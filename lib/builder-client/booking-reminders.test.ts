import { describe, expect, it } from "vitest";
import {
  MAX_REMINDERS,
  addReminderOffset,
  choicesForRow,
  normalizeReminderSettings,
  reminderLabel,
  reminderProblemText,
  reminderSettingsProblem,
} from "./booking-reminders";

describe("booking reminders: the Booking Manager's helpers", () => {
  it("labels reminder times in words", () => {
    expect(reminderLabel(1440)).toBe("1 day before");
    expect(reminderLabel(2880)).toBe("2 days before");
    expect(reminderLabel(60)).toBe("1 hour before");
    expect(reminderLabel(10080)).toBe("1 week before");
    expect(reminderLabel(30)).toBe("30 minutes before");
  });

  it("reads what the server sent, falling back to the defaults", () => {
    expect(normalizeReminderSettings(null)).toEqual({ enabled: true, offsetsMinutes: [1440, 60], notifyOwner: false });
    expect(normalizeReminderSettings({ enabled: false, offsetsMinutes: [120, "x"], notifyOwner: true }))
      .toEqual({ enabled: false, offsetsMinutes: [120], notifyOwner: true });
  });

  it("adds the most common unused time, and never more than the limit", () => {
    expect(addReminderOffset([])).toEqual([1440]);
    expect(addReminderOffset([1440])).toEqual([1440, 60]);
    const full = addReminderOffset(addReminderOffset(addReminderOffset([])));
    expect(full).toHaveLength(MAX_REMINDERS);
    expect(addReminderOffset(full)).toBe(full);
  });

  it("offers each row only the times no other row has", () => {
    const list = choicesForRow([1440, 60], 1);
    expect(list).not.toContain(1440);
    expect(list).toContain(60);
    // A saved time that is not in the standard list is kept and shown.
    expect(choicesForRow([90], 0)).toContain(90);
  });

  it("says what is wrong before saving", () => {
    expect(reminderSettingsProblem({ enabled: true, offsetsMinutes: [], notifyOwner: false })).toMatch(/at least one/);
    expect(reminderSettingsProblem({ enabled: false, offsetsMinutes: [], notifyOwner: false })).toBe("");
    expect(reminderSettingsProblem({ enabled: true, offsetsMinutes: [60, 60], notifyOwner: false })).toMatch(/twice/);
  });

  it("explains a failed reminder: who, which meeting, which reminder, why", () => {
    const text = reminderProblemText({
      id: "r1", bookingId: "b1", offsetMinutes: 1440, startsAt: "2026-12-02T16:30:00.000Z", recipient: "visitor",
      attempts: 3, error: "Resend refused the address", visitorName: "Pat", visitorEmail: "pat@example.com", bookingStatus: "booked",
    }, "America/Denver");
    expect(text).toBe(
      "The 1 day before reminder to Pat (pat@example.com) for the meeting on Wed, Dec 2, 2026, 9:30 AM was not sent after 3 tries: Resend refused the address",
    );
    const owner = reminderProblemText({
      id: "r2", bookingId: "b1", offsetMinutes: 60, startsAt: "2026-12-02T16:30:00.000Z", recipient: "owner",
      attempts: 3, error: "", visitorName: "Pat", visitorEmail: "pat@example.com", bookingStatus: "booked",
    }, "America/Denver");
    expect(owner).toMatch(/to the site owner .* the mail service did not say why$/);
  });
});
