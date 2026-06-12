import { describe, expect, it } from "vitest";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  collectEvaluableRemindersFromLayout,
  createSignupNudgeReminderRecord,
  formatReminderRecordPanelTitle,
  parseReminderRecordsFromModule,
  REMINDER_RECORDS_JSON_SETTING_KEY,
  resolveReminderQuestionNumber,
  serializeReminderRecords,
  sortReminderRecordsByQuestionNumber
} from "@/lib/builder-reminder-module";

function buildReminderModule(
  overrides: Partial<BuilderTemplateModule> = {}
): BuilderTemplateModule {
  return {
    id: "module-reminders",
    type: "reminder",
    column: "main",
    name: "Reminders",
    text: "",
    settings: {},
    ...overrides
  };
}

describe("parseReminderRecordsFromModule", () => {
  it("reads records from reminderRecordsJson", () => {
    const record = createSignupNudgeReminderRecord("record-a");
    const reminderModule = buildReminderModule({
      settings: {
        [REMINDER_RECORDS_JSON_SETTING_KEY]: serializeReminderRecords([record])
      }
    });

    const records = parseReminderRecordsFromModule(reminderModule);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("record-a");
    expect(records[0]?.name).toBe("Signup Nudge");
  });

  it("preserves interior spaces in reminder names", () => {
    const record = createSignupNudgeReminderRecord("record-spaces");
    record.name = "Signup Nudge";
    const reminderModule = buildReminderModule({
      settings: {
        [REMINDER_RECORDS_JSON_SETTING_KEY]: serializeReminderRecords([record])
      }
    });

    const records = parseReminderRecordsFromModule(reminderModule);
    expect(records[0]?.name).toBe("Signup Nudge");
  });

  it("keeps a trailing space while the name is being edited", () => {
    const record = createSignupNudgeReminderRecord("record-spaces");
    record.name = "Signup ";
    const reminderModule = buildReminderModule({
      settings: {
        [REMINDER_RECORDS_JSON_SETTING_KEY]: serializeReminderRecords([record])
      }
    });

    const records = parseReminderRecordsFromModule(reminderModule);
    expect(records[0]?.name).toBe("Signup ");
  });

  it("migrates legacy flat module settings into one record", () => {
    const reminderModule = buildReminderModule({
      id: "legacy-module-id",
      name: "Poll Five Nudge",
      text: "<p>Take poll five!</p>",
      settings: {
        appearance: "speech_bubble",
        gameAudience: "both",
        isActive: "true",
        sortOrder: "2",
        criteriaLogic: "and",
        reminderCriteriaJson: JSON.stringify([
          { id: "poll-five", type: "specific_poll", value: { pollId: "poll-5" } }
        ])
      }
    });

    const records = parseReminderRecordsFromModule(reminderModule);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("legacy-module-id");
    expect(records[0]?.name).toBe("Poll Five Nudge");
    expect(records[0]?.messageHtml).toBe("<p>Take poll five!</p>");
    expect(records[0]?.criteria[0]?.type).toBe("specific_poll");
  });
});

describe("resolveReminderQuestionNumber", () => {
  it("uses poll order_index for specific poll criteria", () => {
    const record = createSignupNudgeReminderRecord("record-a");
    record.criteria = [{ id: "poll-five", type: "specific_poll", value: { pollId: "poll-uuid-5" } }];

    expect(
      resolveReminderQuestionNumber(record, {
        "poll-uuid-5": 5
      })
    ).toBe(5);
  });

  it("uses polls-taken count when no specific poll is set", () => {
    const record = createSignupNudgeReminderRecord("record-a");
    record.criteria = [{ id: "count", type: "polls_taken", value: { operator: "gte", count: 10 } }];

    expect(resolveReminderQuestionNumber(record)).toBe(10);
  });
});

describe("sortReminderRecordsByQuestionNumber", () => {
  it("orders records by question number ascending", () => {
    const pollTen = createSignupNudgeReminderRecord("record-10");
    pollTen.name = "10Polls";
    pollTen.criteria = [{ id: "c", type: "polls_taken", value: { operator: "gte", count: 10 } }];

    const pollFive = createSignupNudgeReminderRecord("record-5");
    pollFive.name = "Signup Nudge";
    pollFive.criteria = [{ id: "c", type: "polls_taken", value: { operator: "gte", count: 1 } }];

    const sorted = sortReminderRecordsByQuestionNumber([pollTen, pollFive]);
    expect(sorted.map((record) => record.name)).toEqual(["Signup Nudge", "10Polls"]);
    expect(formatReminderRecordPanelTitle(sorted[1]!)).toBe("Q10 · 10Polls");
  });
});

describe("collectEvaluableRemindersFromLayout", () => {
  it("flattens multiple records from one module", () => {
    const reminderModule = buildReminderModule({
      settings: {
        [REMINDER_RECORDS_JSON_SETTING_KEY]: serializeReminderRecords([
          createSignupNudgeReminderRecord("record-a"),
          {
            ...createSignupNudgeReminderRecord("record-b"),
            name: "Poll Five",
            criteria: [
              { id: "poll-five", type: "specific_poll", value: { pollId: "poll-5" } }
            ],
            sortOrder: 1
          }
        ])
      }
    });

    const reminders = collectEvaluableRemindersFromLayout([
      {
        id: "section-1",
        layout: "single",
        modules: [reminderModule],
        columns: {},
        background: { mode: "color", color: "#ffffff" },
        settings: {}
      }
    ]);

    expect(reminders).toHaveLength(2);
    expect(reminders.map((reminder) => reminder.id)).toEqual(["record-a", "record-b"]);
  });
});
