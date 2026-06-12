"use client";

import {
  createDefaultReminderCriterion,
  GAME_REMINDER_CRITERIA_LOGIC_OPTIONS,
  GAME_REMINDER_CRITERION_TYPES,
  GAME_REMINDER_OPERATORS,
  reminderCriteriaLogicLabel,
  reminderCriterionTypeLabel,
  reminderOperatorLabel,
  type GameReminderCriteriaLogic,
  type GameReminderCriterion,
  type GameReminderCriterionType,
  type GameReminderOperator
} from "@/lib/game-reminder";
import { BuilderSettingRow } from "@/components/builder/builder-setting-row";

export type ReminderPollOption = {
  id: string;
  question: string;
  orderIndex: number;
  isPublished?: boolean;
};

function getDefaultCriterionValue(type: GameReminderCriterionType) {
  if (type === "specific_poll") {
    return { pollId: "" };
  }

  if (type === "registered") {
    return { registered: false };
  }

  return { operator: "gte" as GameReminderOperator, count: 1 };
}

function ReminderCriterionFields({
  criterion,
  pollOptions,
  onChange
}: {
  criterion: GameReminderCriterion;
  pollOptions: ReminderPollOption[];
  onChange: (next: GameReminderCriterion) => void;
}) {
  if (criterion.type === "polls_taken" || criterion.type === "logins") {
    const numeric =
      "operator" in criterion.value && "count" in criterion.value
        ? criterion.value
        : { operator: "gte" as GameReminderOperator, count: 1 };

    return (
      <>
        <BuilderSettingRow fullWidth label="Threshold">
          <select
            className="admin-game-reward-field-select"
            value={numeric.operator}
            onChange={(event) =>
              onChange({
                ...criterion,
                value: { ...numeric, operator: event.target.value as GameReminderOperator }
              })
            }
          >
            {GAME_REMINDER_OPERATORS.map((operator) => (
              <option key={operator} value={operator}>
                {reminderOperatorLabel(operator)}
              </option>
            ))}
          </select>
        </BuilderSettingRow>
        <BuilderSettingRow fullWidth label="Count">
          <input
            className="admin-game-reward-field-number"
            min="0"
            type="number"
            value={numeric.count}
            onChange={(event) =>
              onChange({
                ...criterion,
                value: { ...numeric, count: Math.max(0, Number(event.target.value) || 0) }
              })
            }
          />
        </BuilderSettingRow>
      </>
    );
  }

  if (criterion.type === "specific_poll") {
    const pollId = "pollId" in criterion.value ? criterion.value.pollId : "";

    return (
      <BuilderSettingRow fullWidth label="Poll">
        <select
          className="admin-game-reward-field-wide"
          value={pollId}
          onChange={(event) => onChange({ ...criterion, value: { pollId: event.target.value } })}
        >
          <option value="">Select a poll</option>
          {pollOptions.map((poll) => (
            <option key={poll.id} value={poll.id}>
              Q{poll.orderIndex} — {poll.question}
              {poll.isPublished ? "" : " (Draft)"}
            </option>
          ))}
        </select>
      </BuilderSettingRow>
    );
  }

  const registered = "registered" in criterion.value ? criterion.value.registered : false;

  return (
    <BuilderSettingRow fullWidth label="Registered">
      <select
        className="admin-game-reward-field-select"
        value={registered ? "yes" : "no"}
        onChange={(event) => onChange({ ...criterion, value: { registered: event.target.value === "yes" } })}
      >
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </BuilderSettingRow>
  );
}

type ReminderCriteriaEditorProps = {
  criteriaLogic: GameReminderCriteriaLogic;
  criteria: GameReminderCriterion[];
  pollOptions: ReminderPollOption[];
  disabled?: boolean;
  onCriteriaLogicChange: (logic: GameReminderCriteriaLogic) => void;
  onCriteriaChange: (criteria: GameReminderCriterion[]) => void;
};

export function ReminderCriteriaEditor({
  criteriaLogic,
  criteria,
  pollOptions,
  disabled = false,
  onCriteriaLogicChange,
  onCriteriaChange
}: ReminderCriteriaEditorProps) {
  function updateCriterion(index: number, nextCriterion: GameReminderCriterion) {
    onCriteriaChange(criteria.map((criterion, currentIndex) => (currentIndex === index ? nextCriterion : criterion)));
  }

  function addCriterion() {
    onCriteriaChange([...criteria, createDefaultReminderCriterion()]);
  }

  function removeCriterion(index: number) {
    if (criteria.length <= 1) {
      return;
    }

    onCriteriaChange(criteria.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <>
      <BuilderSettingRow fullWidth label="Match Logic">
        <select
          disabled={disabled}
          value={criteriaLogic}
          onChange={(event) => onCriteriaLogicChange(event.target.value as GameReminderCriteriaLogic)}
        >
          {GAME_REMINDER_CRITERIA_LOGIC_OPTIONS.map((logic) => (
            <option key={logic} value={logic}>
              {reminderCriteriaLogicLabel(logic)}
            </option>
          ))}
        </select>
      </BuilderSettingRow>
      <div className="admin-game-reminder-criteria-panel">
        <div className="admin-game-reminder-criteria-header">
          <span className="builder-setting-label">Criteria</span>
          <button className="secondary-button" disabled={disabled} onClick={addCriterion} type="button">
            Add Criterion
          </button>
        </div>
        <div className="admin-game-reminder-criteria-list">
          {criteria.map((criterion, index) => (
            <div className="admin-game-reminder-criterion-card" key={criterion.id}>
              <div className="admin-game-reminder-criterion-card-header">
                <span>Criterion {index + 1}</span>
                {index > 0 ? (
                  <span className="admin-game-reminder-criterion-joiner">
                    {criteriaLogic === "or" ? "OR" : "AND"}
                  </span>
                ) : null}
                <button
                  aria-label={`Remove criterion ${index + 1}`}
                  className="polls-icon-button polls-icon-button-danger admin-game-sublevel-remove"
                  disabled={disabled || criteria.length <= 1}
                  onClick={() => removeCriterion(index)}
                  title="Remove"
                  type="button"
                >
                  ×
                </button>
              </div>
              <BuilderSettingRow fullWidth label="Type">
                <select
                  className="admin-game-reward-field-select"
                  disabled={disabled}
                  value={criterion.type}
                  onChange={(event) => {
                    const nextType = event.target.value as GameReminderCriterionType;
                    updateCriterion(index, {
                      ...criterion,
                      type: nextType,
                      value: getDefaultCriterionValue(nextType)
                    });
                  }}
                >
                  {GAME_REMINDER_CRITERION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {reminderCriterionTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </BuilderSettingRow>
              <ReminderCriterionFields
                criterion={criterion}
                onChange={(nextCriterion) => updateCriterion(index, nextCriterion)}
                pollOptions={pollOptions}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
