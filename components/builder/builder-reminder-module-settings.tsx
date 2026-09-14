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
import { BuilderModuleField } from "@/components/builder/builder-module-field";
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

/**
 * Exported for `builder-reminder-module-settings.test.tsx` only. A record card
 * is collapsed until it is clicked, so static markup of the module component
 * contains no editor at all — which is the same reason `check_panels` measured
 * this panel as a single field for as long as it existed. There is no DOM test
 * library in this repo to click with, so the test renders the editor directly.
 */
export function BuilderReminderRecordEditor({
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
    /*
     * ONE LATTICE FOR THE WHOLE RECORD CARD (L6a, panel sweep 11/15).
     *
     * This was eight separate `BuilderModuleFieldStrip` flex rows plus two
     * legacy `BuilderSettingRow`s, each measuring its own label against its own
     * content. Measured at 1440 before the change: SEVEN label widths (81, 84,
     * 88, 95, 98, 103, 125, 130) and FIVE different x-positions for the first
     * field in the column (181, 184, 198, 203, 225). That is the exact shape
     * W0 was written against, in a panel nobody could see it in — the record
     * cards are collapsed by default and `check_panels` never opened one, so
     * the whole editor was measured as a single field (the module's Label)
     * from the day the check was written until this ticket.
     *
     * L6a's worked example is Feature Cards and its mechanism is W0's: the
     * CONTAINER is the grid, every wrapper below it is `display: contents`, and
     * two `max-content` tracks measure the longest label and the longest
     * control across the whole card at once. Carousel reused
     * `.builder-cards-panel-fields` rather than inventing a second pattern and
     * this does the same, so there is one place to fix if the shape moves.
     *
     * The `data-lattice-pairs="2"` declaration that makes any of it checkable
     * is on the LIST, not here — see `BuilderReminderModuleSettings` below.
     */
    <div className="builder-reminder-record-settings builder-cards-panel-fields admin-game-reminder-editor">
      {/* Content */}
      <BuilderModuleField label="Name" width="text-md" className="builder-card-field--a">
        <input
          type="text"
          value={record.name}
          onChange={(event) => updateRecord({ name: event.target.value })}
          placeholder="Signup Nudge"
        />
      </BuilderModuleField>
      <BuilderModuleField label="Message" width="full" className="builder-card-field--wide">
        <BuilderRichTextEditor
          enableEmojiPicker
          value={record.messageHtml}
          onChange={(messageHtml) => updateRecord({ messageHtml })}
          {...richTextGallery}
        />
      </BuilderModuleField>

      {/* Layout. The three offsets used to carry `style={{ width: "9ch" }}`,
          which is the one thing W0 forbids by name — and it was invisible to
          every gate, because `check_panels` measures a field's SLOT and the
          slot was whatever the flex row gave it. They take the shared track
          now, like every other control in the card. */}
      <BuilderModuleField label="X Offset" width="num" className="builder-card-field--a">
        <input
          type="number"
          value={record.offsetX}
          onChange={(event) =>
            updateRecord({ offsetX: normalizeSignedOffsetValue(event.target.value, "0") })
          }
        />
      </BuilderModuleField>
      <BuilderModuleField label="Y Offset" width="num" className="builder-card-field--b">
        <input
          type="number"
          value={record.offsetY}
          onChange={(event) =>
            updateRecord({ offsetY: normalizeSignedOffsetValue(event.target.value, "0") })
          }
        />
      </BuilderModuleField>
      <BuilderModuleField label="Z-Index" width="num" className="builder-card-field--a">
        <input
          max={999999}
          min={-999}
          step={1}
          type="number"
          value={record.zIndex}
          onChange={(event) => updateRecord({ zIndex: event.target.value })}
        />
      </BuilderModuleField>
      {isSpeechBubble ? (
        <BuilderModuleField label="Width" width="num" className="builder-card-field--b">
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
      <span className="builder-module-offset-hint">
        Positive X moves right; positive Y moves up. Higher Z-Index stacks in front (above polls and floating
        images).
      </span>

      {/* Style */}
      <BuilderModuleField label="Appearance" width="select-md" className="builder-card-field--a">
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
      {/* F13/C7: the player display has always honoured strip placement
          (resolveReminderStripPlacement) but nothing wrote it, so Builder
          strips were stuck at the top. Strip-only — a speech bubble is
          positioned by its offsets instead. */}
      {record.appearance === "strip" ? (
        <BuilderModuleField label="Placement" width="select-md" className="builder-card-field--b">
          <select
            value={record.stripPlacement === "bottom" ? "bottom" : "top"}
            onChange={(event) => updateRecord({ stripPlacement: event.target.value })}
          >
            <option value="top">Top of screen</option>
            <option value="bottom">Bottom of screen</option>
          </select>
        </BuilderModuleField>
      ) : null}
      {isSpeechBubble ? (
        <>
          <BuilderModuleField label="Background" width="color" className="builder-card-field--a">
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
          <BuilderModuleField label="Border Color" width="color" className="builder-card-field--b">
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
          <BuilderModuleField label="Border" width="num" className="builder-card-field--a">
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

      {/* Behavior. These two are `BuilderSettingRow`s from editors shared with
          the legacy admin screens, so they carry a different pair shape — they
          are flattened onto the same two tracks rather than left to size
          themselves, which is what the Trigger block needed in sweep 8/15 for
          the same reason: `.builder-setting-row-full`'s base rule sizes its
          tracks PROPORTIONALLY against the whole block (minmax(0,1fr)
          minmax(0,2fr)) instead of against their own content. */}
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
      {/* `check`, not `auto`: the control is a checkbox, so W0's stated
          exception applies — it keeps its natural size at the START of the
          slot rather than being stretched across it. The slot is `--wide`
          because the words beside the box ("Show when criteria match") do not
          fit a half-row track, and a wrapped toggle label is L2. */}
      <BuilderModuleField label="Active" width="check" className="builder-card-field--wide">
        <label className="admin-game-reminder-active-toggle">
          <input
            checked={record.isActive}
            onChange={(event) => updateRecord({ isActive: event.target.checked })}
            type="checkbox"
          />
          <span>Show when criteria match</span>
        </label>
      </BuilderModuleField>
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

      {/*
        THE DECLARATION IS ON THE LIST, AND THAT IS THE WHOLE POINT OF IT.

        `check_panels` measures each `[data-lattice-pairs]` element as one group
        and holds the pair-columns inside it to W0. Declared on each record card
        instead, every card would be its own group — and a group always agrees
        with itself, so the two cards could drift apart by any amount and the
        check would report a clean pass on both. That is exactly the blind spot
        the shared-lattice unit was added for (#432) one level down, and it is
        not theoretical here: before the tracks were shared, a speech-bubble
        record and a strip record measured right-hand label tracks of 130px and
        115px, eight pixels apart.

        On the list, every field in every card is bucketed by its label's x, and
        a card that stops lining up with its neighbour shows up as a third and
        fourth bucket against a declaration of two.
      */}
      <div className="builder-reminder-module-records" data-lattice-pairs="2">
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
