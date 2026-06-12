import { describe, expect, it } from "vitest";
import { evaluatePlayerReminders, explainReminderMatch, reminderMatchesContext, type PlayerReminderContext } from "@/lib/game-reminder-eval";
import type { GameReminder } from "@/lib/game-reminder";

function buildReminder(overrides: Partial<GameReminder> = {}): GameReminder {
  const criterionType = overrides.criterionType ?? "polls_taken";
  const criterionValue = overrides.criterionValue ?? { operator: "gte" as const, count: 5 };
  const criteria =
    overrides.criteria ??
    [
      {
        id: "criterion-1",
        type: criterionType,
        value: criterionValue
      }
    ];

  return {
    id: "reminder-1",
    name: "Test reminder",
    displayType: "popup",
    appearance: "speech_bubble",
    messageHtml: "<p>Hello</p>",
    criteriaLogic: overrides.criteriaLogic ?? "and",
    criteria,
    criterionType,
    criterionValue,
    audience: "both",
    isActive: true,
    sortOrder: 0,
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const baseContext: PlayerReminderContext = {
  pollsTaken: 5,
  loginCount: 2,
  answeredPollIds: new Set(["poll-a"]),
  isRegistered: true
};

describe("reminderMatchesContext", () => {
  it("matches polls taken with gte", () => {
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "polls_taken", criterionValue: { operator: "gte", count: 5 } }),
        baseContext
      )
    ).toBe(true);
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "polls_taken", criterionValue: { operator: "gte", count: 6 } }),
        baseContext
      )
    ).toBe(false);
  });

  it("matches polls taken with eq", () => {
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "polls_taken", criterionValue: { operator: "eq", count: 5 } }),
        baseContext
      )
    ).toBe(true);
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "polls_taken", criterionValue: { operator: "eq", count: 4 } }),
        baseContext
      )
    ).toBe(false);
  });

  it("matches logins", () => {
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "logins", criterionValue: { operator: "eq", count: 2 } }),
        baseContext
      )
    ).toBe(true);
  });

  it("matches specific poll", () => {
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "specific_poll", criterionValue: { pollId: "poll-a" } }),
        baseContext
      )
    ).toBe(true);
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "specific_poll", criterionValue: { pollId: "poll-b" } }),
        baseContext
      )
    ).toBe(false);
  });

  it("matches registered status", () => {
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "registered", criterionValue: { registered: true } }),
        baseContext
      )
    ).toBe(true);
    expect(
      reminderMatchesContext(
        buildReminder({ criterionType: "registered", criterionValue: { registered: false } }),
        { ...baseContext, isRegistered: false }
      )
    ).toBe(true);
  });

  it("matches when all AND criteria pass", () => {
    expect(
      reminderMatchesContext(
        buildReminder({
          criteriaLogic: "and",
          criteria: [
            { id: "a", type: "polls_taken", value: { operator: "gte", count: 5 } },
            { id: "b", type: "logins", value: { operator: "eq", count: 0 } }
          ]
        }),
        { ...baseContext, pollsTaken: 5, loginCount: 0 }
      )
    ).toBe(true);

    expect(
      reminderMatchesContext(
        buildReminder({
          criteriaLogic: "and",
          criteria: [
            { id: "a", type: "polls_taken", value: { operator: "gte", count: 5 } },
            { id: "b", type: "logins", value: { operator: "eq", count: 0 } }
          ]
        }),
        { ...baseContext, pollsTaken: 5, loginCount: 1 }
      )
    ).toBe(false);
  });

  it("matches when any OR criterion passes", () => {
    expect(
      reminderMatchesContext(
        buildReminder({
          criteriaLogic: "or",
          criteria: [
            { id: "a", type: "polls_taken", value: { operator: "eq", count: 10 } },
            { id: "b", type: "logins", value: { operator: "eq", count: 2 } }
          ]
        }),
        baseContext
      )
    ).toBe(true);

    expect(
      reminderMatchesContext(
        buildReminder({
          criteriaLogic: "or",
          criteria: [
            { id: "a", type: "polls_taken", value: { operator: "eq", count: 10 } },
            { id: "b", type: "logins", value: { operator: "eq", count: 0 } }
          ]
        }),
        baseContext
      )
    ).toBe(false);
  });
});

describe("evaluatePlayerReminders", () => {
  it("returns matched reminders sorted by sort order", () => {
    const reminders = [
      buildReminder({ id: "b", name: "Second", sortOrder: 2 }),
      buildReminder({ id: "a", name: "First", sortOrder: 1, criterionValue: { operator: "eq", count: 5 } })
    ];

    const matched = evaluatePlayerReminders(reminders, baseContext);

    expect(matched.map((reminder) => reminder.id)).toEqual(["a", "b"]);
  });
});

describe("explainReminderMatch", () => {
  it("explains an exact polls-taken miss", () => {
    const explanation = explainReminderMatch(
      buildReminder({ criterionType: "polls_taken", criterionValue: { operator: "eq", count: 5 } }),
      { ...baseContext, pollsTaken: 6 }
    );

    expect(explanation.matched).toBe(false);
    expect(explanation.reason).toContain("Polls taken is 6");
    expect(explanation.reason).toContain("exactly 5");
  });
});
