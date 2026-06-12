import type {
  GameReminder,
  GameReminderCriterion,
  GameReminderCriterionValue,
  GameReminderNumericCriterion,
  GameReminderOperator
} from "@/lib/game-reminder";
import {
  formatReminderCriteriaSummary,
  formatReminderCriterionSummary,
  reminderCriteriaLogicLabel,
  reminderOperatorLabel
} from "@/lib/game-reminder";

export type PlayerReminderContext = {
  pollsTaken: number;
  loginCount: number;
  answeredPollIds: ReadonlySet<string>;
  isRegistered: boolean;
};

export type PlayerMatchedReminder = Pick<
  GameReminder,
  "id" | "name" | "displayType" | "appearance" | "messageHtml" | "metadata"
>;

export type ReminderMatchExplanation = {
  matched: boolean;
  reason: string;
};

function describeNumericComparison(
  subject: string,
  actual: number,
  operator: GameReminderOperator,
  target: number
): ReminderMatchExplanation {
  const matched = compareNumeric(actual, operator, target);
  const operatorLabel = reminderOperatorLabel(operator).toLowerCase();

  return {
    matched,
    reason: matched
      ? `${subject} is ${actual}; matches ${operatorLabel} ${target}.`
      : `${subject} is ${actual}; needs ${operatorLabel} ${target}.`
  };
}

function compareNumeric(actual: number, operator: GameReminderOperator, target: number): boolean {
  if (operator === "eq") {
    return actual === target;
  }

  if (operator === "lte") {
    return actual <= target;
  }

  return actual >= target;
}

function asNumericCriterion(value: GameReminderCriterionValue): GameReminderNumericCriterion {
  if ("operator" in value && "count" in value) {
    return value;
  }

  return { operator: "gte", count: 1 };
}

export function explainCriterionMatch(
  criterion: GameReminderCriterion,
  context: PlayerReminderContext
): ReminderMatchExplanation {
  switch (criterion.type) {
    case "polls_taken": {
      const numeric = asNumericCriterion(criterion.value);
      return describeNumericComparison("Polls taken", context.pollsTaken, numeric.operator, numeric.count);
    }
    case "logins": {
      const numeric = asNumericCriterion(criterion.value);
      return describeNumericComparison("Logins", context.loginCount, numeric.operator, numeric.count);
    }
    case "specific_poll": {
      const pollId = "pollId" in criterion.value ? criterion.value.pollId : "";

      if (!pollId) {
        return { matched: false, reason: "Reminder is missing a poll selection." };
      }

      const matched = context.answeredPollIds.has(pollId);
      return {
        matched,
        reason: matched
          ? `Player answered poll ${pollId}.`
          : `Player has not answered poll ${pollId}.`
      };
    }
    case "registered": {
      const registered = "registered" in criterion.value ? criterion.value.registered : false;
      const matched = context.isRegistered === registered;
      return {
        matched,
        reason: matched
          ? `Registered status is ${context.isRegistered ? "yes" : "no"} as required.`
          : `Registered status is ${context.isRegistered ? "yes" : "no"}; reminder requires ${registered ? "yes" : "no"}.`
      };
    }
    default:
      return { matched: false, reason: "Unknown reminder criterion type." };
  }
}

export function explainReminderMatch(reminder: GameReminder, context: PlayerReminderContext): ReminderMatchExplanation {
  if (!reminder.isActive) {
    return { matched: false, reason: "Reminder is inactive." };
  }

  if (!reminder.criteria.length) {
    return { matched: false, reason: "Reminder has no criteria." };
  }

  const explanations = reminder.criteria.map((criterion) => explainCriterionMatch(criterion, context));
  const matched =
    reminder.criteriaLogic === "or"
      ? explanations.some((explanation) => explanation.matched)
      : explanations.every((explanation) => explanation.matched);

  const logicLabel = reminderCriteriaLogicLabel(reminder.criteriaLogic);
  const summary = formatReminderCriteriaSummary(reminder);
  const detail = explanations
    .map((explanation, index) => {
      const label = formatReminderCriterionSummary(reminder.criteria[index] ?? { type: "polls_taken", value: { operator: "gte", count: 1 } });
      return `${label} — ${explanation.reason}`;
    })
    .join(" ");

  return {
    matched,
    reason: matched
      ? `${logicLabel} satisfied (${summary}). ${detail}`
      : `${logicLabel} not satisfied (${summary}). ${detail}`
  };
}

export function reminderMatchesContext(reminder: GameReminder, context: PlayerReminderContext): boolean {
  return explainReminderMatch(reminder, context).matched;
}

export function evaluatePlayerReminders(
  reminders: GameReminder[],
  context: PlayerReminderContext
): PlayerMatchedReminder[] {
  return reminders
    .filter((reminder) => reminderMatchesContext(reminder, context))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    )
    .map((reminder) => ({
      id: reminder.id,
      name: reminder.name,
      displayType: reminder.displayType,
      appearance: reminder.appearance,
      messageHtml: reminder.messageHtml,
      metadata: reminder.metadata
    }));
}
