import { Fragment } from "react";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import {
  parsePrograms,
  serializePrograms,
  createProgram,
  createProgramSession,
  createProgramPrice,
  bulletsToText,
  bulletsFromText,
  type Program,
  type ProgramSession,
  type ProgramPrice
} from "@/lib/builder-program-list";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderThemeColorControlWithDefault, type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderProgramListModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

/* Days are a dropdown rather than free text because they drive nothing but
   are read by everyone: "Tues", "TUESDAY" and "Tue." across fifteen flyers
   would make the timetable column look ragged for no gain. A club running
   something on an irregular date can still type it — "Custom" opens the
   field. */
const DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

export function BuilderProgramListModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: BuilderProgramListModuleSettingsProps) {
  const programs = parsePrograms(module.settings.programs);

  const set = (key: string, value: string) =>
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));

  const persist = (next: Program[]) => set("programs", serializePrograms(next));

  const updateProgram = (id: string, updates: Partial<Program>) =>
    persist(programs.map((program) => (program.id === id ? { ...program, ...updates } : program)));

  const removeProgram = (id: string) => persist(programs.filter((program) => program.id !== id));

  const moveProgram = (id: string, direction: -1 | 1) => {
    const index = programs.findIndex((program) => program.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= programs.length) return;
    const next = [...programs];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persist(next);
  };

  const addProgram = () => persist([...programs, createProgram()]);

  const updateSession = (programId: string, sessionId: string, updates: Partial<ProgramSession>) => {
    const program = programs.find((entry) => entry.id === programId);
    if (!program) return;
    updateProgram(programId, {
      sessions: program.sessions.map((session) =>
        session.id === sessionId ? { ...session, ...updates } : session
      )
    });
  };

  const addSession = (programId: string) => {
    const program = programs.find((entry) => entry.id === programId);
    if (!program) return;
    updateProgram(programId, { sessions: [...program.sessions, createProgramSession()] });
  };

  const removeSession = (programId: string, sessionId: string) => {
    const program = programs.find((entry) => entry.id === programId);
    if (!program) return;
    updateProgram(programId, {
      sessions: program.sessions.filter((session) => session.id !== sessionId)
    });
  };

  const updatePrice = (programId: string, priceId: string, updates: Partial<ProgramPrice>) => {
    const program = programs.find((entry) => entry.id === programId);
    if (!program) return;
    updateProgram(programId, {
      pricing: program.pricing.map((price) => (price.id === priceId ? { ...price, ...updates } : price))
    });
  };

  const addPrice = (programId: string) => {
    const program = programs.find((entry) => entry.id === programId);
    if (!program) return;
    updateProgram(programId, { pricing: [...program.pricing, createProgramPrice()] });
  };

  const removePrice = (programId: string, priceId: string) => {
    const program = programs.find((entry) => entry.id === programId);
    if (!program) return;
    updateProgram(programId, { pricing: program.pricing.filter((price) => price.id !== priceId) });
  };

  // Empty colour settings follow the site theme; the swatch previews the
  // same theme colour the renderer resolves to, with the factory colour as
  // the no-theme fallback.
  const themeHex = (label: string) => themeColors.find((color) => color.label === label)?.hex || "";
  const accentDefault = themeHex("Primary") || "#4f9c3a";
  const headingDefault = themeHex("Accent") || "#14265c";
  const borderDefault = themeHex("Secondary") || "#dce3ef";

  return (
    <div className="builder-cards-panel">
      {/* LEFT — settings that apply to every programme in the module.
          `builder-schema-panel-column` is borrowed from the schema
          generator so a field strip stacks one control per row inside a
          narrow column (W0) instead of running off the edge. */}
      <div className="builder-cards-panel-settings builder-schema-panel-column">
        <div className="builder-schema-group-title">Layout</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Radius" width="num">
            <BuilderNumberSelectControl
              value={module.settings.cardRadius ?? "10"}
              min={0}
              max={48}
              step={2}
              fallback="10"
              onChange={(cardRadius) => set("cardRadius", cardRadius)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Level Chip" width="select-sm">
            <select
              value={module.settings.showLevelBadge === "false" ? "false" : "true"}
              onChange={(event) => set("showLevelBadge", event.target.value)}
            >
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderModuleField>
          <BuilderModuleField label="Coach Column" width="select-sm">
            <select
              value={module.settings.showInstructorColumn === "false" ? "false" : "true"}
              onChange={(event) => set("showInstructorColumn", event.target.value)}
            >
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderModuleField>
        </BuilderModuleFieldStrip>

        <div className="builder-schema-group-title">Booking</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Reserve Line" width="select-sm">
            <select
              value={module.settings.showReserve === "false" ? "false" : "true"}
              onChange={(event) => set("showReserve", event.target.value)}
            >
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderModuleField>
          <BuilderModuleField label="Label" width="select-md">
            <input
              type="text"
              value={module.settings.reserveLabel ?? "Reserve"}
              placeholder="Reserve"
              onChange={(event) => set("reserveLabel", event.target.value)}
            />
          </BuilderModuleField>
          {/* One number for the club, not one per programme: on all fifteen
              source flyers it was the same pro shop line. */}
          <BuilderModuleField label="Phone" width="select-md">
            <input
              type="tel"
              value={module.settings.reservePhone ?? ""}
              placeholder="(561) 243-7360"
              onChange={(event) => set("reservePhone", event.target.value)}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>

        {/* Stated once under the whole list. On the flyers this was a shield
            graphic repeated on every one; it is a policy, and policies are
            text. */}
        <div className="builder-schema-group-title">Footnote</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Policy Note" width="full">
            <input
              type="text"
              value={module.settings.policyNote ?? ""}
              placeholder="All programmes carry a 24-hour cancellation policy."
              onChange={(event) => set("policyNote", event.target.value)}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>

        <div className="builder-schema-group-title">Colours</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Accent" width="color">
            <BuilderThemeColorControlWithDefault
              value={module.settings.accentColor ?? ""}
              defaultColor={accentDefault}
              themeColors={themeColors}
              dialogLabel="Accent colour"
              onChange={(accentColor) => set("accentColor", accentColor)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Headings" width="color">
            <BuilderThemeColorControlWithDefault
              value={module.settings.headingColor ?? ""}
              defaultColor={headingDefault}
              themeColors={themeColors}
              dialogLabel="Heading colour"
              onChange={(headingColor) => set("headingColor", headingColor)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Card" width="color">
            <BuilderThemeColorControlWithDefault
              value={module.settings.cardBackground ?? ""}
              defaultColor="#ffffff"
              themeColors={themeColors}
              dialogLabel="Card colour"
              onChange={(cardBackground) => set("cardBackground", cardBackground)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Border" width="color">
            <BuilderThemeColorControlWithDefault
              value={module.settings.cardBorderColor ?? ""}
              defaultColor={borderDefault}
              themeColors={themeColors}
              dialogLabel="Border colour"
              onChange={(cardBorderColor) => set("cardBorderColor", cardBorderColor)}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
      </div>

      {/* RIGHT — the programmes themselves. */}
      <div className="builder-cards-panel-items">
        <div className="builder-cards-panel-heading">Programmes</div>
        <div className="builder-cards-panel-fields" data-lattice-pairs="2">
          {programs.map((program, index) => {
            const programName = program.title || `Programme ${index + 1}`;

            return (
              <Fragment key={program.id}>
                <div className="builder-card-editor-head">
                  <span className="builder-card-editor-name">{programName}</span>
                  <div className="builder-item-grid-actions">
                    <button
                      type="button"
                      className="builder-icon-button"
                      onClick={() => moveProgram(program.id, -1)}
                      aria-label={`Move ${programName} up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="builder-icon-button"
                      onClick={() => moveProgram(program.id, 1)}
                      aria-label={`Move ${programName} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="builder-icon-button builder-icon-button-danger"
                      onClick={() => removeProgram(program.id)}
                      aria-label={`Delete ${programName}`}
                      title="Delete programme"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="Name" width="full">
                    <input
                      type="text"
                      value={program.title}
                      placeholder="Beginners"
                      onChange={(event) => updateProgram(program.id, { title: event.target.value })}
                    />
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>
                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="Subtitle" width="full">
                    <input
                      type="text"
                      value={program.subtitle ?? ""}
                      placeholder="with Glenn Muller"
                      onChange={(event) => updateProgram(program.id, { subtitle: event.target.value })}
                    />
                  </BuilderModuleField>
                  <BuilderModuleField label="Level" width="select-md">
                    <input
                      type="text"
                      value={program.levelBadge ?? ""}
                      placeholder="3.0 - 3.5 Players"
                      onChange={(event) => updateProgram(program.id, { levelBadge: event.target.value })}
                    />
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>

                {/* Sessions. A coach sits here rather than on the programme
                    because it genuinely varies within one — Back to Basics
                    runs with a different coach on Tuesday and Thursday. */}
                {program.sessions.map((session, sessionIndex) => (
                  <BuilderModuleFieldStrip key={session.id}>
                    <BuilderModuleField label={sessionIndex === 0 ? "Day" : ""} width="select-md">
                      <select
                        value={DAY_OPTIONS.includes(session.day) ? session.day : ""}
                        onChange={(event) =>
                          updateSession(program.id, session.id, { day: event.target.value })
                        }
                      >
                        <option value="">Choose…</option>
                        {DAY_OPTIONS.map((day) => (
                          <option key={day} value={day}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </BuilderModuleField>
                    <BuilderModuleField label={sessionIndex === 0 ? "From" : ""} width="select-sm">
                      <input
                        type="text"
                        value={session.startTime}
                        placeholder="6:00 PM"
                        onChange={(event) =>
                          updateSession(program.id, session.id, { startTime: event.target.value })
                        }
                      />
                    </BuilderModuleField>
                    <BuilderModuleField label={sessionIndex === 0 ? "To" : ""} width="select-sm">
                      <input
                        type="text"
                        value={session.endTime}
                        placeholder="7:00 PM"
                        onChange={(event) =>
                          updateSession(program.id, session.id, { endTime: event.target.value })
                        }
                      />
                    </BuilderModuleField>
                    <BuilderModuleField label={sessionIndex === 0 ? "Coach" : ""} width="select-md">
                      <input
                        type="text"
                        value={session.instructor ?? ""}
                        placeholder="Optional"
                        onChange={(event) =>
                          updateSession(program.id, session.id, { instructor: event.target.value })
                        }
                      />
                    </BuilderModuleField>
                    <BuilderModuleField label={sessionIndex === 0 ? " " : ""} width="num">
                      <button
                        type="button"
                        className="builder-icon-button builder-icon-button-danger"
                        onClick={() => removeSession(program.id, session.id)}
                        aria-label={`Delete session ${sessionIndex + 1} of ${programName}`}
                        title="Delete session"
                      >
                        ✕
                      </button>
                    </BuilderModuleField>
                  </BuilderModuleFieldStrip>
                ))}
                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="" width="full">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => addSession(program.id)}
                    >
                      Add a session
                    </button>
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>

                {/* Pricing is a list because both mixers charge members $20
                    and non-members $25, while the clinics charge one price
                    to everyone. */}
                {program.pricing.map((price, priceIndex) => (
                  <BuilderModuleFieldStrip key={price.id}>
                    <BuilderModuleField label={priceIndex === 0 ? "Price" : ""} width="select-sm">
                      <input
                        type="text"
                        value={price.amount}
                        placeholder="$27.50"
                        onChange={(event) =>
                          updatePrice(program.id, price.id, { amount: event.target.value })
                        }
                      />
                    </BuilderModuleField>
                    <BuilderModuleField label={priceIndex === 0 ? "Applies To" : ""} width="full">
                      <input
                        type="text"
                        value={price.appliesTo}
                        placeholder="members & non-members"
                        onChange={(event) =>
                          updatePrice(program.id, price.id, { appliesTo: event.target.value })
                        }
                      />
                    </BuilderModuleField>
                    <BuilderModuleField label={priceIndex === 0 ? " " : ""} width="num">
                      <button
                        type="button"
                        className="builder-icon-button builder-icon-button-danger"
                        onClick={() => removePrice(program.id, price.id)}
                        aria-label={`Delete price ${priceIndex + 1} of ${programName}`}
                        title="Delete price"
                      >
                        ✕
                      </button>
                    </BuilderModuleField>
                  </BuilderModuleFieldStrip>
                ))}
                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="" width="full">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => addPrice(program.id)}
                    >
                      Add a price
                    </button>
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>

                {/* One point per line. Four short bullets are quicker to edit
                    as text than as four rows with their own arrow buttons. */}
                <BuilderModuleFieldStrip>
                  <BuilderModuleField label="Points" width="full">
                    <textarea
                      rows={4}
                      value={bulletsToText(program.bullets)}
                      placeholder={"Progressive mixed doubles\nWinners move up, losers move down"}
                      onChange={(event) =>
                        updateProgram(program.id, { bullets: bulletsFromText(event.target.value) })
                      }
                    />
                  </BuilderModuleField>
                </BuilderModuleFieldStrip>
              </Fragment>
            );
          })}
        </div>
        <button type="button" className="secondary-button" onClick={addProgram}>
          Add a programme
        </button>
      </div>
    </div>
  );
}
