import type { BuilderTemplateModule, BuilderTemplateSection } from "@/lib/builder-template";
import { normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import {
  buildReminderCriteriaMetadata,
  createDefaultReminderCriterion,
  normalizeGameReminderAppearance,
  parseReminderCriteriaInput,
  type GameReminder,
  type GameReminderAppearance,
  type GameReminderCriteriaConfig,
  type GameReminderCriteriaLogic,
  type GameReminderCriterion
} from "@/lib/game-reminder";
import { normalizeModuleGameAudience } from "@/lib/module-game-audience";
import type { GameAudience } from "@/lib/game-audience";

export const REMINDER_APPEARANCE_SETTING_KEY = "appearance";
export const REMINDER_CRITERIA_LOGIC_SETTING_KEY = "criteriaLogic";
export const REMINDER_CRITERIA_JSON_SETTING_KEY = "reminderCriteriaJson";
export const REMINDER_RECORDS_JSON_SETTING_KEY = "reminderRecordsJson";

export type ReminderPollOrderLookup = Record<string, number>;

const NON_POLL_REMINDER_SORT_BASE = 9000;

export type BuilderReminderRecord = {
  id: string;
  name: string;
  messageHtml: string;
  appearance: GameReminderAppearance;
  gameAudience: GameAudience;
  isActive: boolean;
  sortOrder: number;
  criteriaLogic: GameReminderCriteriaLogic;
  criteria: GameReminderCriterion[];
  backgroundColor: string;
  borderColor: string;
  borderThickness: string;
  containerWidth: string;
  offsetX: string;
  offsetY: string;
  zIndex: string;
};

const LEGACY_MODULE_SETTING_KEYS = [
  REMINDER_APPEARANCE_SETTING_KEY,
  REMINDER_CRITERIA_LOGIC_SETTING_KEY,
  REMINDER_CRITERIA_JSON_SETTING_KEY,
  "gameAudience",
  "isActive",
  "sortOrder",
  "backgroundColor",
  "borderColor",
  "borderThickness",
  "containerWidth",
  "offsetX",
  "offsetY",
  "zIndex"
] as const;

export function buildReminderPollOrderLookup(
  polls: Array<{ id: string; orderIndex: number }>
): ReminderPollOrderLookup {
  return Object.fromEntries(polls.map((poll) => [poll.id, poll.orderIndex]));
}

export function resolveReminderQuestionNumber(
  record: Pick<BuilderReminderRecord, "criteria">,
  pollOrderById: ReminderPollOrderLookup = {}
): number | null {
  const specificPoll = record.criteria.find((criterion) => criterion.type === "specific_poll");

  if (specificPoll && "pollId" in specificPoll.value && specificPoll.value.pollId) {
    const orderIndex = pollOrderById[specificPoll.value.pollId];

    if (Number.isFinite(orderIndex) && orderIndex > 0) {
      return orderIndex;
    }
  }

  const pollsTaken = record.criteria.find((criterion) => criterion.type === "polls_taken");

  if (pollsTaken && "count" in pollsTaken.value) {
    const count = pollsTaken.value.count;

    if (Number.isFinite(count) && count > 0) {
      return count;
    }
  }

  return null;
}

export function formatReminderRecordPanelTitle(
  record: BuilderReminderRecord,
  pollOrderById: ReminderPollOrderLookup = {}
): string {
  const questionNumber = resolveReminderQuestionNumber(record, pollOrderById);
  const name = record.name.trim() || "Untitled Reminder";

  if (questionNumber == null) {
    return name;
  }

  return `Q${questionNumber} · ${name}`;
}

export function sortReminderRecordsByQuestionNumber(
  records: BuilderReminderRecord[],
  pollOrderById: ReminderPollOrderLookup = {}
): BuilderReminderRecord[] {
  return [...records]
    .map((record, index) => ({
      record,
      questionNumber: resolveReminderQuestionNumber(record, pollOrderById),
      index
    }))
    .sort((left, right) => {
      const leftKey = left.questionNumber ?? NON_POLL_REMINDER_SORT_BASE + left.index;
      const rightKey = right.questionNumber ?? NON_POLL_REMINDER_SORT_BASE + right.index;

      if (leftKey !== rightKey) {
        return leftKey - rightKey;
      }

      return left.record.name.localeCompare(right.record.name, undefined, { sensitivity: "base" });
    })
    .map((entry, index) => ({
      ...entry.record,
      sortOrder: entry.questionNumber ?? NON_POLL_REMINDER_SORT_BASE + index
    }));
}

export function collectReminderModulesFromLayout(sections: BuilderTemplateSection[]): BuilderTemplateModule[] {
  return sections.flatMap((section) => section.modules.filter((module) => module.type === "reminder"));
}

export function parseReminderCriteriaFromModuleSettings(settings: Record<string, string>): {
  config: ReturnType<typeof parseReminderCriteriaInput>["config"];
  error: string | null;
} {
  let parsedCriteria: unknown = [];

  try {
    parsedCriteria = JSON.parse(settings[REMINDER_CRITERIA_JSON_SETTING_KEY] ?? "[]");
  } catch {
    parsedCriteria = [];
  }

  return parseReminderCriteriaInput({
    criteriaLogic: settings[REMINDER_CRITERIA_LOGIC_SETTING_KEY],
    criteria: parsedCriteria
  });
}

export function parseReminderCriteriaFromRecord(record: Pick<BuilderReminderRecord, "criteriaLogic" | "criteria">): {
  config: GameReminderCriteriaConfig;
  error: string | null;
} {
  return parseReminderCriteriaInput({
    criteriaLogic: record.criteriaLogic,
    criteria: record.criteria
  });
}

function parseRecordCriteria(raw: unknown): GameReminderCriterion[] {
  const parsed = parseReminderCriteriaInput({
    criteriaLogic: "and",
    criteria: Array.isArray(raw) ? raw : []
  });

  return parsed.config.criteria.length > 0 ? parsed.config.criteria : [createDefaultReminderCriterion()];
}

function normalizeRecordSortOrder(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeReminderRecord(raw: unknown, fallbackIndex: number): BuilderReminderRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const entry = raw as Record<string, unknown>;
  const criteriaLogic =
    entry.criteriaLogic === "or" ? "or" : ("and" satisfies GameReminderCriteriaLogic);
  const criteria = parseRecordCriteria(entry.criteria);
  const { config } = parseReminderCriteriaInput({ criteriaLogic, criteria });

  const rawName = String(entry.name ?? "");
  const rawId = String(entry.id ?? `reminder-${fallbackIndex + 1}`).trim();

  return {
    id: rawId || `reminder-${fallbackIndex + 1}`,
    name: rawName.trim().length > 0 ? rawName : `Reminder ${fallbackIndex + 1}`,
    messageHtml: String(entry.messageHtml ?? ""),
    appearance: normalizeGameReminderAppearance(entry.appearance),
    gameAudience: normalizeModuleGameAudience(
      typeof entry.gameAudience === "string" ? entry.gameAudience : undefined
    ),
    isActive: entry.isActive !== false && entry.isActive !== "false",
    sortOrder: normalizeRecordSortOrder(entry.sortOrder, fallbackIndex),
    criteriaLogic: config.logic,
    criteria: config.criteria,
    backgroundColor: normalizeBuilderHexColor(String(entry.backgroundColor ?? "#ffffff")),
    borderColor: normalizeBuilderHexColor(String(entry.borderColor ?? "#4cbb17")),
    borderThickness: String(entry.borderThickness ?? "2"),
    containerWidth: String(entry.containerWidth ?? "520"),
    offsetX: String(entry.offsetX ?? "0"),
    offsetY: String(entry.offsetY ?? "0"),
    zIndex: String(entry.zIndex ?? "46")
  };
}

export function createSignupNudgeReminderRecord(id?: string): BuilderReminderRecord {
  const { config } = parseReminderCriteriaInput({
    criteriaLogic: "and",
    criteria: [
      { id: "polls-taken", type: "polls_taken", value: { operator: "gte", count: 1 } },
      { id: "not-registered", type: "registered", value: { registered: false } }
    ]
  });

  return {
    id: id ?? crypto.randomUUID(),
    name: "Signup Nudge",
    messageHtml: "<p>Create a free account to save your picks and earn points.</p>",
    appearance: "speech_bubble",
    gameAudience: "both",
    isActive: true,
    sortOrder: 0,
    criteriaLogic: config.logic,
    criteria: config.criteria,
    backgroundColor: "#ffffff",
    borderColor: "#4cbb17",
    borderThickness: "2",
    containerWidth: "520",
    offsetX: "0",
    offsetY: "0",
    zIndex: "46"
  };
}

export function createDefaultReminderRecord(): BuilderReminderRecord {
  const { config } = parseReminderCriteriaInput({
    criteriaLogic: "and",
    criteria: [createDefaultReminderCriterion()]
  });

  return {
    id: crypto.randomUUID(),
    name: "New Reminder",
    messageHtml: "<p></p>",
    appearance: "speech_bubble",
    gameAudience: "both",
    isActive: true,
    sortOrder: 0,
    criteriaLogic: config.logic,
    criteria: config.criteria,
    backgroundColor: "#ffffff",
    borderColor: "#4cbb17",
    borderThickness: "2",
    containerWidth: "520",
    offsetX: "0",
    offsetY: "0",
    zIndex: "46"
  };
}

function legacyModuleToReminderRecord(module: BuilderTemplateModule): BuilderReminderRecord {
  const { config } = parseReminderCriteriaFromModuleSettings(module.settings);

  return {
    id: module.id,
    name: module.name.trim() || "Reminder",
    messageHtml: module.text ?? "",
    appearance: normalizeGameReminderAppearance(module.settings[REMINDER_APPEARANCE_SETTING_KEY]),
    gameAudience: normalizeModuleGameAudience(module.settings.gameAudience),
    isActive: module.settings.isActive !== "false",
    sortOrder: normalizeRecordSortOrder(module.settings.sortOrder, 0),
    criteriaLogic: config.logic,
    criteria: config.criteria.length > 0 ? config.criteria : [createDefaultReminderCriterion()],
    backgroundColor: normalizeBuilderHexColor(module.settings.backgroundColor || "#ffffff"),
    borderColor: normalizeBuilderHexColor(module.settings.borderColor || "#4cbb17"),
    borderThickness: module.settings.borderThickness ?? "2",
    containerWidth: module.settings.containerWidth ?? "520",
    offsetX: module.settings.offsetX ?? "0",
    offsetY: module.settings.offsetY ?? "0",
    zIndex: module.settings.zIndex ?? "46"
  };
}

function hasLegacyReminderModuleFields(settings: Record<string, string>): boolean {
  return Boolean(
    settings[REMINDER_CRITERIA_JSON_SETTING_KEY]?.trim() ||
      settings[REMINDER_APPEARANCE_SETTING_KEY]?.trim() ||
      settings.gameAudience?.trim() ||
      settings.isActive?.trim() ||
      settings.sortOrder?.trim()
  );
}

export function parseReminderRecordsFromModule(module: BuilderTemplateModule): BuilderReminderRecord[] {
  const rawJson = module.settings[REMINDER_RECORDS_JSON_SETTING_KEY];

  if (rawJson?.trim()) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((entry, index) => normalizeReminderRecord(entry, index))
          .filter((record): record is BuilderReminderRecord => record !== null);
      }
    } catch {
      // Fall through to legacy migration.
    }
  }

  if (hasLegacyReminderModuleFields(module.settings) || module.text.trim() || module.name.trim()) {
    return [legacyModuleToReminderRecord(module)];
  }

  return [createSignupNudgeReminderRecord()];
}

export function serializeReminderRecords(
  records: BuilderReminderRecord[],
  pollOrderById: ReminderPollOrderLookup = {}
): string {
  const sortedRecords = sortReminderRecordsByQuestionNumber(records, pollOrderById);

  return JSON.stringify(
    sortedRecords.map((record) => {
      const { config } = parseReminderCriteriaInput({
        criteriaLogic: record.criteriaLogic,
        criteria: record.criteria
      });

      return {
        id: record.id,
        name: record.name,
        messageHtml: record.messageHtml,
        appearance: record.appearance,
        gameAudience: record.gameAudience,
        isActive: record.isActive,
        sortOrder: record.sortOrder,
        criteriaLogic: config.logic,
        criteria: config.criteria.map((criterion) => ({
          id: criterion.id,
          type: criterion.type,
          value: criterion.value
        })),
        backgroundColor: normalizeBuilderHexColor(record.backgroundColor),
        borderColor: normalizeBuilderHexColor(record.borderColor),
        borderThickness: record.borderThickness,
        containerWidth: record.containerWidth,
        offsetX: record.offsetX,
        offsetY: record.offsetY,
        zIndex: record.zIndex
      };
    })
  );
}

export function normalizeReminderModuleSettings(
  settings: Record<string, string>,
  module?: Pick<BuilderTemplateModule, "id" | "name" | "text">
): Record<string, string> {
  const nextSettings = { ...settings };
  const records = module
    ? parseReminderRecordsFromModule({ id: module.id, name: module.name, text: module.text, type: "reminder", column: "", settings: nextSettings })
    : parseReminderRecordsFromModule({
        id: "reminder-module",
        name: "",
        text: "",
        type: "reminder",
        column: "",
        settings: nextSettings
      });

  nextSettings[REMINDER_RECORDS_JSON_SETTING_KEY] = serializeReminderRecords(records);

  for (const key of LEGACY_MODULE_SETTING_KEYS) {
    delete nextSettings[key];
  }

  return nextSettings;
}

export function reminderRecordToEvaluable(moduleId: string, record: BuilderReminderRecord): GameReminder {
  const { config } = parseReminderCriteriaFromRecord(record);
  const primaryCriterion = config.criteria[0];
  const now = new Date(0).toISOString();
  const recordSettings: Record<string, string> = {
    backgroundColor: record.backgroundColor,
    borderColor: record.borderColor,
    borderThickness: record.borderThickness,
    containerWidth: record.containerWidth,
    offsetX: record.offsetX,
    offsetY: record.offsetY,
    zIndex: record.zIndex
  };

  return {
    id: record.id,
    name: record.name.trim() || "Reminder",
    displayType: record.appearance === "strip" ? "inline" : "popup",
    appearance: record.appearance,
    messageHtml: record.messageHtml,
    criteriaLogic: config.logic,
    criteria: config.criteria,
    criterionType: primaryCriterion?.type ?? "polls_taken",
    criterionValue: primaryCriterion?.value ?? { operator: "gte", count: 1 },
    audience: record.gameAudience,
    isActive: record.isActive,
    sortOrder: record.sortOrder,
    metadata: {
      ...buildReminderModuleMetadata(recordSettings, config),
      moduleId
    },
    createdAt: now,
    updatedAt: now
  };
}

/** @deprecated Use {@link collectEvaluableRemindersFromLayout}. */
export function builderReminderModuleToEvaluable(module: BuilderTemplateModule): GameReminder[] {
  return parseReminderRecordsFromModule(module).map((record) => reminderRecordToEvaluable(module.id, record));
}

export function collectEvaluableRemindersFromLayout(sections: BuilderTemplateSection[]): GameReminder[] {
  const reminders = collectReminderModulesFromLayout(sections).flatMap((module) =>
    parseReminderRecordsFromModule(module).map((record) => reminderRecordToEvaluable(module.id, record))
  );

  return reminders.sort((left, right) => left.sortOrder - right.sortOrder);
}

export function buildReminderModuleMetadata(
  settings: Record<string, string>,
  config: GameReminderCriteriaConfig
): Record<string, unknown> {
  return {
    ...buildReminderCriteriaMetadata(config),
    backgroundColor: settings.backgroundColor ?? "#ffffff",
    borderColor: settings.borderColor ?? "#4cbb17",
    borderThickness: settings.borderThickness ?? "2",
    containerWidth: settings.containerWidth ?? "520",
    offsetX: settings.offsetX ?? "0",
    offsetY: settings.offsetY ?? "0",
    zIndex: settings.zIndex ?? "46"
  };
}

export function serializeReminderCriteriaToModuleSettings(
  config: ReturnType<typeof parseReminderCriteriaInput>["config"]
): Record<string, string> {
  return {
    [REMINDER_CRITERIA_LOGIC_SETTING_KEY]: config.logic,
    [REMINDER_CRITERIA_JSON_SETTING_KEY]: JSON.stringify(
      config.criteria.map((criterion) => ({
        id: criterion.id,
        type: criterion.type,
        value: criterion.value
      }))
    )
  };
}

export function defaultReminderModuleSettings(): Record<string, string> {
  return {
    [REMINDER_RECORDS_JSON_SETTING_KEY]: serializeReminderRecords([createSignupNudgeReminderRecord()])
  };
}
