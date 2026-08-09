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
import { BuilderModuleField, BuilderModuleFieldStrip } from "@/components/builder/builder-module-field";
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
import {
  BuilderThemeColorField,
  type BuilderThemePalette
} from "./builder-theme-color-field";

type BuilderReminderModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  richTextGallery?: RichTextGalleryBinding;
  themeColors?: BuilderThemePalette;
};

type BuilderReminderRecordEditorProps = {
  record: BuilderReminderRecord;
  pollOptions: ReminderPollOption[];
  onChange: (record: BuilderReminderRecord) => void;
  richTextGallery?: RichTextGalleryBinding;
  themeColors?: BuilderThemePalette;
};

const OFFSET_INPUT_STYLE = { width: "9ch" } as const;

function BuilderReminderRecordEditor({
  record,
  pollOptions,
  onChange,
  richTextGallery,
  themeColors = []
}: BuilderReminderRecordEditorProps) {
  const { config } = useMemo(() => parseReminderCriteriaFromRecord(record), [record]);
  const criteria = config.criteria.length > 0 ? config.criteria : [createDefaultReminderCriterion()];
  const isSpeechBubble = record.appearance === "speech_bubble";

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
      {/* Content */}
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Name" width="text-md">
          <input
            type="text"
            value={record.name}
            onChange={(event) => updateRecord({ name: event.target.value })}
            placeholder="Signup Nudge"
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Message" width="full">
          <BuilderRichTextEditor
            enableEmojiPicker
            value={record.messageHtml}
            onChange={(messageHtml) => updateRecord({ messageHtml })}
            {...richTextGallery}
          />
        </BuilderModuleField>
      </BuilderModuleFieldStrip>

      {/* Layout */}
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="X Offset" width="num">
          <input
            type="number"
            style={OFFSET_INPUT_STYLE}
            value={record.offsetX}
            onChange={(event) =>
              updateRecord({ offsetX: normalizeSignedOffsetValue(event.target.value, "0") })
            }
          />
        </BuilderModuleField>
        <BuilderModuleField label="Y Offset" width="num">
          <input
            type="number"
            style={OFFSET_INPUT_STYLE}
            value={record.offsetY}
            onChange={(event) =>
              updateRecord({ offsetY: normalizeSignedOffsetValue(event.target.value, "0") })
            }
          />
        </BuilderModuleField>
        <BuilderModuleField label="Z-Index" width="num">
          <input
            max={999999}
            min={-999}
            step={1}
            style={OFFSET_INPUT_STYLE}
            type="number"
            value={record.zIndex}
            onChange={(event) => updateRecord({ zIndex: event.target.value })}
          />
        </BuilderModuleField>
        {isSpeechBubble ? (
          <BuilderModuleField label="Width" width="num">
            <BuilderNumberSelectControl
              fallback="520"
              max={900}
              min={200}
              step={10}
              value={record.containerWidth}
              onChange={(containerWidth) => updateRecord({ containerWidth })}
            />
          </BuilderModuleField>
        ) : null}
      </BuilderModuleFieldStrip>
      <span className="builder-module-offset-hint">
        Positive X moves right; positive Y moves up. Higher Z-Index stacks in front (above polls and floating
        images).
      </span>

      {/* Style */}
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Appearance" width="select-md">
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
        </BuilderModuleField>
        {isSpeechBubble ? (
          <>
            <BuilderModuleField label="Background" width="color">
              <BuilderThemeColorField
                dialogLabel="Background color"
                fallback="#ffffff"
                themeColors={themeColors}
                value={normalizeBuilderHexColor(record.backgroundColor)}
                onChange={(backgroundColor) =>
                  updateRecord({ backgroundColor: normalizeBuilderHexColor(backgroundColor) })
                }
              />
            </BuilderModuleField>
            <BuilderModuleField label="Border Color" width="color">
              <BuilderThemeColorField
                dialogLabel="Border color"
                fallback="#9ed4ee"
                themeColors={themeColors}
                value={normalizeBuilderHexColor(record.borderColor)}
                onChange={(borderColor) =>
                  updateRecord({ borderColor: normalizeBuilderHexColor(borderColor) })
                }
              />
            </BuilderModuleField>
            <BuilderModuleField label="Border" width="num">
              <BuilderNumberSelectControl
                fallback="2"
                max={24}
                min={0}
                value={record.borderThickness}
                onChange={(borderThickness) => updateRecord({ borderThickness })}
              />
            </BuilderModuleField>
          </>
        ) : null}
      </BuilderModuleFieldStrip>

      {/* Behavior — bespoke editors keep their own chrome */}
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
      <BuilderModuleFieldStrip>
        <BuilderModuleField label="Active" width="auto">
          <label className="admin-game-reminder-active-toggle">
            <input
              checked={record.isActive}
              onChange={(event) => updateRecord({ isActive: event.target.checked })}
              type="checkbox"
            />
            <span>Show when criteria match</span>
          </label>
        </BuilderModuleField>
      </BuilderModuleFieldStrip>
    </div>
  );
}

export function BuilderReminderModuleSettings({
  module,
  onUpdateModule,
  richTextGallery,
  themeColors = []
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
                  themeColors={themeColors}
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
