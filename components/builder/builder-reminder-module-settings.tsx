"use client";

import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import { useEffect, useMemo, useState } from "react";
import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { normalizeSignedOffsetValue } from "@/lib/builder-template";
import { normalizeBuilderHexColor } from "@/lib/builder-hex-color";
import { AdminGameAudienceField } from "@/components/admin-game-audience-field";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import { BuilderNumberSelectControl } from "@/components/builder/builder-inline-number-select";
import { BuilderSettingRow } from "@/components/builder/builder-setting-row";
import { BuilderCellPanelHeader } from "@/components/builder/builder-cell-panel-header";
import { ReminderCriteriaEditor, type ReminderPollOption } from "@/components/reminder-criteria-editor";
import {
  GAME_REMINDER_APPEARANCES,
  createDefaultReminderCriterion,
  parseReminderCriteriaInput,
  reminderAppearanceLabel,
  type GameReminderAppearance,
  type GameReminderCriteriaLogic,
  type GameReminderCriterion
} from "@/lib/game-reminder";
import {
  buildReminderPollOrderLookup,
  createDefaultReminderRecord,
  formatReminderRecordPanelTitle,
  parseReminderCriteriaFromRecord,
  parseReminderRecordsFromModule,
  serializeReminderRecords,
  sortReminderRecordsByQuestionNumber,
  type BuilderReminderRecord
} from "@/lib/builder-reminder-module";
import { readAdminJson } from "@/lib/admin-fetch";

type BuilderReminderModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  richTextGallery?: RichTextGalleryBinding;
};

type BuilderReminderRecordEditorProps = {
  record: BuilderReminderRecord;
  pollOptions: ReminderPollOption[];
  onChange: (record: BuilderReminderRecord) => void;
  richTextGallery?: RichTextGalleryBinding;
};

function BuilderReminderRecordEditor({
  record,
  pollOptions,
  onChange,
  richTextGallery
}: BuilderReminderRecordEditorProps) {
  const { config } = useMemo(() => parseReminderCriteriaFromRecord(record), [record]);
  const criteria = config.criteria.length > 0 ? config.criteria : [createDefaultReminderCriterion()];

  function updateRecord(updates: Partial<BuilderReminderRecord>) {
    onChange({ ...record, ...updates });
  }

  function updateCriteriaConfig(nextLogic: GameReminderCriteriaLogic, nextCriteria: GameReminderCriterion[]) {
    const parsed = parseReminderCriteriaInput({
      criteriaLogic: nextLogic,
      criteria: nextCriteria
    });

    if (parsed.error) {
      return;
    }

    updateRecord({
      criteriaLogic: parsed.config.logic,
      criteria: parsed.config.criteria
    });
  }

  return (
    <div className="builder-reminder-record-settings admin-game-reminder-editor">
      <BuilderSettingRow fullWidth label="Name">
        <input
          type="text"
          value={record.name}
          onChange={(event) => updateRecord({ name: event.target.value })}
          placeholder="Signup Nudge"
        />
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="X Offset">
        <div className="builder-setting-value-stack">
          <input
            type="number"
            value={record.offsetX}
            onChange={(event) =>
              updateRecord({ offsetX: normalizeSignedOffsetValue(event.target.value, "0") })
            }
          />
          <span className="builder-module-offset-hint">Positive moves right; negative moves left.</span>
        </div>
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Y Offset">
        <div className="builder-setting-value-stack">
          <input
            type="number"
            value={record.offsetY}
            onChange={(event) =>
              updateRecord({ offsetY: normalizeSignedOffsetValue(event.target.value, "0") })
            }
          />
          <span className="builder-module-offset-hint">Positive moves up; negative moves down.</span>
        </div>
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Z-Index">
        <div className="builder-setting-value-stack">
          <input
            max={999999}
            min={-999}
            step={1}
            type="number"
            value={record.zIndex}
            onChange={(event) => updateRecord({ zIndex: event.target.value })}
          />
          <span className="builder-module-offset-hint">
            Higher values stack in front (above polls and floating images). Lower values stack behind.
          </span>
        </div>
      </BuilderSettingRow>
      {record.appearance === "speech_bubble" ? (
        <BuilderSettingRow fullWidth label="Background Color">
          <div className="builder-setting-value-stack">
            <input
              type="color"
              value={normalizeBuilderHexColor(record.backgroundColor)}
              onChange={(event) =>
                updateRecord({ backgroundColor: normalizeBuilderHexColor(event.target.value) })
              }
            />
            <span className="builder-module-offset-hint">
              Fills the bubble body and the pointer diamond (same color on both).
            </span>
          </div>
        </BuilderSettingRow>
      ) : null}
      {record.appearance === "speech_bubble" ? (
        <>
          <BuilderSettingRow fullWidth label="Border Color">
            <input
              type="color"
              value={normalizeBuilderHexColor(record.borderColor)}
              onChange={(event) =>
                updateRecord({ borderColor: normalizeBuilderHexColor(event.target.value) })
              }
            />
          </BuilderSettingRow>
          <BuilderSettingRow fullWidth label="Border Size">
            <BuilderNumberSelectControl
              fallback="2"
              max={24}
              min={0}
              value={record.borderThickness}
              onChange={(borderThickness) => updateRecord({ borderThickness })}
            />
          </BuilderSettingRow>
          <BuilderSettingRow fullWidth label="Container Width">
            <BuilderNumberSelectControl
              fallback="520"
              max={900}
              min={200}
              step={10}
              value={record.containerWidth}
              onChange={(containerWidth) => updateRecord({ containerWidth })}
            />
          </BuilderSettingRow>
        </>
      ) : null}
      <BuilderSettingRow fullWidth label="Appearance">
        <select
          value={record.appearance}
          onChange={(event) =>
            updateRecord({ appearance: event.target.value as GameReminderAppearance })
          }
        >
          {GAME_REMINDER_APPEARANCES.map((appearance) => (
            <option key={appearance} value={appearance}>
              {reminderAppearanceLabel(appearance)}
            </option>
          ))}
        </select>
      </BuilderSettingRow>
      <AdminGameAudienceField
        value={record.gameAudience}
        onChange={(gameAudience) => updateRecord({ gameAudience })}
      />
      <ReminderCriteriaEditor
        criteria={criteria}
        criteriaLogic={record.criteriaLogic}
        pollOptions={pollOptions}
        onCriteriaChange={(nextCriteria) => updateCriteriaConfig(record.criteriaLogic, nextCriteria)}
        onCriteriaLogicChange={(logic) => updateCriteriaConfig(logic, criteria)}
      />
      <BuilderSettingRow fullWidth label="Active">
        <label className="admin-game-reminder-active-toggle">
          <input
            checked={record.isActive}
            onChange={(event) => updateRecord({ isActive: event.target.checked })}
            type="checkbox"
          />
          <span>Show when criteria match</span>
        </label>
      </BuilderSettingRow>
      <BuilderSettingRow fullWidth label="Message">
        <BuilderRichTextEditor
          enableEmojiPicker
          value={record.messageHtml}
          onChange={(messageHtml) => updateRecord({ messageHtml })}
          {...richTextGallery}
        />
      </BuilderSettingRow>
    </div>
  );
}

export function BuilderReminderModuleSettings({
  module,
  onUpdateModule,
  richTextGallery
}: BuilderReminderModuleSettingsProps) {
  const [pollOptions, setPollOptions] = useState<ReminderPollOption[]>([]);
  const [collapsedRecords, setCollapsedRecords] = useState<Record<string, boolean>>({});

  const records = useMemo(() => parseReminderRecordsFromModule(module), [module]);
  const pollOrderById = useMemo(() => buildReminderPollOrderLookup(pollOptions), [pollOptions]);
  const displayRecords = useMemo(
    () => sortReminderRecordsByQuestionNumber(records, pollOrderById),
    [pollOrderById, records]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPolls() {
      try {
        const response = await builderAdminFetch("/api/admin/polls", { cache: "no-store" });
        const data = await readAdminJson<{
          polls?: Array<{ id: string; question: string; order_index?: number; is_published?: boolean }>;
        }>(response, "Failed to load polls.");

        if (!cancelled) {
          setPollOptions(
            (data.polls ?? []).map((poll, index) => ({
              id: poll.id,
              question: poll.question,
              orderIndex:
                typeof poll.order_index === "number" && Number.isFinite(poll.order_index) && poll.order_index > 0
                  ? poll.order_index
                  : index + 1,
              isPublished: poll.is_published
            }))
          );
        }
      } catch {
        if (!cancelled) {
          setPollOptions([]);
        }
      }
    }

    void loadPolls();

    return () => {
      cancelled = true;
    };
  }, []);

  function isRecordCollapsed(id: string) {
    return collapsedRecords[id] ?? true;
  }

  function toggleRecord(id: string) {
    setCollapsedRecords((current) => ({ ...current, [id]: !isRecordCollapsed(id) }));
  }

  function persist(nextRecords: BuilderReminderRecord[]) {
    onUpdateModule((current) => ({
      ...current,
      name: current.name.trim() || "Reminders",
      text: "",
      settings: {
        ...current.settings,
        reminderRecordsJson: serializeReminderRecords(nextRecords, pollOrderById)
      }
    }));
  }

  function updateRecord(id: string, nextRecord: BuilderReminderRecord) {
    persist(records.map((record) => (record.id === id ? nextRecord : record)));
  }

  function removeRecord(id: string) {
    if (records.length <= 1) {
      return;
    }

    persist(records.filter((record) => record.id !== id));
    setCollapsedRecords((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function cloneRecord(id: string) {
    const source = records.find((record) => record.id === id);
    if (!source) {
      return;
    }

    const cloneId = crypto.randomUUID();
    persist([
      ...records,
      {
        ...source,
        id: cloneId,
        name: source.name.trim() ? `${source.name.trim()} Copy` : "Reminder Copy"
      }
    ]);
    setCollapsedRecords((current) => ({ ...current, [cloneId]: false }));
  }

  function addRecord() {
    const nextRecord = createDefaultReminderRecord();
    persist([...records, nextRecord]);
    setCollapsedRecords((current) => ({ ...current, [nextRecord.id]: false }));
  }

  return (
    <div className="builder-reminder-module-settings admin-game-reminder-editor">
      <p className="builder-reminder-module-intro">
        Add one Reminders module per page. Each reminder has its own trigger, audience, and message. The list sorts
        automatically by question number (poll order or polls-taken count).
      </p>

      <div className="builder-reminder-module-records">
        {displayRecords.map((record) => {
          const panelTitle = formatReminderRecordPanelTitle(record, pollOrderById);
          const isCollapsed = isRecordCollapsed(record.id);

          return (
            <div key={record.id} className="builder-reminder-record-card builder-cell-panel">
              <BuilderCellPanelHeader
                headingActions={
                  <>
                    <button
                      aria-label={`Clone ${panelTitle}`}
                      className="builder-icon-button"
                      onClick={() => cloneRecord(record.id)}
                      title="Clone Reminder"
                      type="button"
                    >
                      ⧉
                    </button>
                    {records.length > 1 ? (
                      <button
                        aria-label={`Delete ${panelTitle}`}
                        className="builder-icon-button builder-icon-button-danger"
                        onClick={() => removeRecord(record.id)}
                        title="Delete Reminder"
                        type="button"
                      >
                        ✕
                      </button>
                    ) : null}
                  </>
                }
                isCollapsed={isCollapsed}
                onToggle={() => toggleRecord(record.id)}
                title={panelTitle}
              />
              {!isCollapsed ? (
                <BuilderReminderRecordEditor
                  pollOptions={pollOptions}
                  record={record}
                  richTextGallery={richTextGallery}
                  onChange={(nextRecord) => updateRecord(record.id, nextRecord)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="builder-reminder-module-actions">
        <button className="secondary-button builder-reminder-add-button" onClick={addRecord} type="button">
          Add Reminder
        </button>
      </div>
    </div>
  );
}
