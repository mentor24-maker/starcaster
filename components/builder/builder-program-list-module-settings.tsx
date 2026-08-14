import { Fragment, useState } from "react";
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
import { parseProgramFlyerText } from "@/lib/builder-program-flyer-text";
import { BuilderNumberSelectControl } from "./builder-inline-number-select";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { BuilderThemeColorControlWithDefault, type BuilderThemePalette } from "./builder-theme-color-field";

type BuilderProgramListModuleSettingsProps = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  themeColors?: BuilderThemePalette;
};

const DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

/**
 * The Programs panel.
 *
 * Two shapes, and picking the wrong one is what made the first version
 * unusable (operator, 2026-08-13: *"the back-end form is a nightmare"*).
 *
 * - The **left column** is a lattice column (W0): `BuilderModuleFieldStrip`
 *   pairs inside `.builder-schema-panel-column`, which the CSS flattens with
 *   `display: contents` so one grid measures every label and every control in
 *   the column at once.
 * - The **program blocks** are an item manager on its own lattice (L6a), the
 *   `.builder-card-editor` shape Feature Cards established. Fields are DIRECT
 *   children of the `data-lattice-pairs="2"` grid, tagged `--a` / `--b` /
 *   `--wide`. Wrapping them in strips — which the first version did — gives
 *   every pair its own flex row, and the column stagger W0 exists to prevent
 *   comes straight back.
 * - **Repeating rows within a program** (sessions, price bands) are titled
 *   column grids (L6): one header row, many short rows. Repeating the labels
 *   "Day / From / To / Coach" on every session is exactly what L6 converts
 *   into column titles.
 *
 * Every field carries a real label. The first version used empty labels and
 * labels that appeared only on the first row of a repeat, which put the whole
 * grid out of phase — a label cell with nothing in it still occupies a cell.
 */
export function BuilderProgramListModuleSettings({
  module,
  onUpdateModule,
  themeColors = []
}: BuilderProgramListModuleSettingsProps) {
  // keepUntitled: the editor shows the row "Add a program" just created,
  // before it has a name. The renderer still drops nameless programs.
  const programs = parsePrograms(module.settings.programs, { keepUntitled: true });

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

  const withProgram = (id: string, change: (program: Program) => Partial<Program>) => {
    const program = programs.find((entry) => entry.id === id);
    if (program) updateProgram(id, change(program));
  };

  const updateSession = (programId: string, sessionId: string, updates: Partial<ProgramSession>) =>
    withProgram(programId, (program) => ({
      sessions: program.sessions.map((session) =>
        session.id === sessionId ? { ...session, ...updates } : session
      )
    }));

  const addSession = (programId: string) =>
    withProgram(programId, (program) => ({ sessions: [...program.sessions, createProgramSession()] }));

  const removeSession = (programId: string, sessionId: string) =>
    withProgram(programId, (program) => ({
      sessions: program.sessions.filter((session) => session.id !== sessionId)
    }));

  const updatePrice = (programId: string, priceId: string, updates: Partial<ProgramPrice>) =>
    withProgram(programId, (program) => ({
      pricing: program.pricing.map((price) => (price.id === priceId ? { ...price, ...updates } : price))
    }));

  const addPrice = (programId: string) =>
    withProgram(programId, (program) => ({ pricing: [...program.pricing, createProgramPrice()] }));

  const removePrice = (programId: string, priceId: string) =>
    withProgram(programId, (program) => ({
      pricing: program.pricing.filter((price) => price.id !== priceId)
    }));

  const [flyerText, setFlyerText] = useState("");
  const [flyerNote, setFlyerNote] = useState("");

  const addFromFlyerText = () => {
    const { program, ignored } = parseProgramFlyerText(flyerText);

    if (!program) {
      setFlyerNote("Nothing readable in that text. Check it has a name and at least one day or price.");
      return;
    }

    persist([...programs, program]);
    setFlyerText("");

    // Say what was read AND what was thrown away. A tool that silently drops
    // half its input is one nobody can trust the second time.
    const found = [
      `${program.sessions.length} session${program.sessions.length === 1 ? "" : "s"}`,
      `${program.pricing.length} price${program.pricing.length === 1 ? "" : "s"}`
    ];
    if (program.bullets.length > 0) found.push(`${program.bullets.length} points`);
    const skipped =
      ignored.length > 0
        ? ` Skipped ${ignored.length} footer line${ignored.length === 1 ? "" : "s"}.`
        : "";
    setFlyerNote(`Added ${program.title || "a program"} — ${found.join(", ")}.${skipped} Check it below.`);
  };

  // Empty color settings follow the site theme; the swatch previews the same
  // theme color the renderer resolves to.
  const themeHex = (label: string) => themeColors.find((color) => color.label === label)?.hex || "";
  const accentDefault = themeHex("Primary") || "#4f9c3a";
  const headingDefault = themeHex("Accent") || "#14265c";
  // Not a theme color — see the renderer. A swatch that previews a color the
  // renderer will not use is worse than no swatch at all.
  const borderDefault = "#dce3ef";

  return (
    <div className="builder-cards-panel">
      <div className="builder-cards-panel-settings builder-schema-panel-column">
        <div className="builder-schema-group-title">Layout</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Corner Radius" width="num">
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
              aria-label="Show the level chip"
            >
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderModuleField>
          <BuilderModuleField label="Coach Column" width="select-sm">
            <select
              value={module.settings.showInstructorColumn === "false" ? "false" : "true"}
              onChange={(event) => set("showInstructorColumn", event.target.value)}
              aria-label="Show the coach column"
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
              aria-label="Show the reserve line"
            >
              <option value="true">Show</option>
              <option value="false">Hide</option>
            </select>
          </BuilderModuleField>
          <BuilderModuleField label="Reserve Label" width="select-md">
            <input
              type="text"
              value={module.settings.reserveLabel ?? "Reserve"}
              placeholder="Reserve"
              onChange={(event) => set("reserveLabel", event.target.value)}
              aria-label="Reserve label"
            />
          </BuilderModuleField>
          {/* One number for the club, not one per program: on all fifteen
              source flyers it was the same pro shop line. */}
          <BuilderModuleField label="Phone Number" width="select-md">
            <input
              type="tel"
              value={module.settings.reservePhone ?? ""}
              placeholder="(561) 243-7360"
              onChange={(event) => set("reservePhone", event.target.value)}
              aria-label="Reserve phone number"
            />
          </BuilderModuleField>
          {/* Stated once under the whole list. On the flyers this was a shield
              graphic repeated on every one; it is a policy, and policies are
              text. */}
          <BuilderModuleField label="Policy Note" width="full">
            <input
              type="text"
              value={module.settings.policyNote ?? ""}
              placeholder="All programs carry a 24-hour cancellation policy."
              onChange={(event) => set("policyNote", event.target.value)}
              aria-label="Policy note"
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>

        <div className="builder-schema-group-title">Colors</div>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Accent" width="color">
            <BuilderThemeColorControlWithDefault
              value={module.settings.accentColor ?? ""}
              defaultColor={accentDefault}
              themeColors={themeColors}
              dialogLabel="Accent color"
              onChange={(accentColor) => set("accentColor", accentColor)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Headings" width="color">
            <BuilderThemeColorControlWithDefault
              value={module.settings.headingColor ?? ""}
              defaultColor={headingDefault}
              themeColors={themeColors}
              dialogLabel="Heading color"
              onChange={(headingColor) => set("headingColor", headingColor)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Card" width="color">
            <BuilderThemeColorControlWithDefault
              value={module.settings.cardBackground ?? ""}
              defaultColor="#ffffff"
              themeColors={themeColors}
              dialogLabel="Card color"
              onChange={(cardBackground) => set("cardBackground", cardBackground)}
            />
          </BuilderModuleField>
          <BuilderModuleField label="Border" width="color">
            <BuilderThemeColorControlWithDefault
              value={module.settings.cardBorderColor ?? ""}
              defaultColor={borderDefault}
              themeColors={themeColors}
              dialogLabel="Border color"
              onChange={(cardBorderColor) => set("cardBorderColor", cardBorderColor)}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
      </div>

      <div className="builder-cards-panel-items">
        <div className="builder-cards-panel-heading">Programs</div>

        {/* Fields are DIRECT children of this grid — no strips. A strip inside
            an item manager becomes its own flex row, which is what staggered
            the first version. --a is the left pair, --b the right, --wide
            spans both. */}
        <div className="builder-cards-panel-fields" data-lattice-pairs="2">
          {/* Paste first, type second. The flyer's words already exist
              somewhere; retyping them into eleven boxes is the work this
              removes. Nothing is sent anywhere — rules read the text here, so
              it cannot turn $27.50 into $2750. */}
          <BuilderModuleField label="Paste A Flyer" width="full" className="builder-card-field--wide">
            <textarea
              rows={4}
              value={flyerText}
              placeholder={"Paste the flyer's text — name, coach, level, days and times, prices.\nThe address and phone footer is ignored."}
              onChange={(event) => {
                setFlyerText(event.target.value);
                if (flyerNote) setFlyerNote("");
              }}
              aria-label="Paste a flyer's text"
            />
          </BuilderModuleField>
          <BuilderModuleField label="Read The Flyer" width="full" className="builder-card-field--wide">
            <button
              type="button"
              className="secondary-button"
              onClick={addFromFlyerText}
              disabled={flyerText.trim().length === 0}
            >
              Read it and add a program
            </button>
          </BuilderModuleField>
          {flyerNote ? (
            <div className="builder-program-block" role="status">
              <p className="builder-program-paste-note">{flyerNote}</p>
            </div>
          ) : null}

          {programs.map((program, index) => {
            const programName = program.title || `Program ${index + 1}`;

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
                      title="Delete program"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <BuilderModuleField label="Name" width="text-md" className="builder-card-field--a">
                  <input
                    type="text"
                    value={program.title}
                    placeholder="Beginners"
                    onChange={(event) => updateProgram(program.id, { title: event.target.value })}
                    aria-label={`${programName} name`}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Level" width="text-md" className="builder-card-field--b">
                  <input
                    type="text"
                    value={program.levelBadge ?? ""}
                    placeholder="3.0 - 3.5 Players"
                    onChange={(event) => updateProgram(program.id, { levelBadge: event.target.value })}
                    aria-label={`${programName} level`}
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Subtitle" width="full" className="builder-card-field--wide">
                  <input
                    type="text"
                    value={program.subtitle ?? ""}
                    placeholder="with Glenn Muller"
                    onChange={(event) => updateProgram(program.id, { subtitle: event.target.value })}
                    aria-label={`${programName} subtitle`}
                  />
                </BuilderModuleField>

                {/* L6: repeating rows become a titled-column grid. Printing
                    "Day / From / To / Coach" beside every session is exactly
                    what column titles replace. */}
                <div className="builder-program-block">
                  <div className="builder-program-block-title">Sessions</div>
                  <div className="builder-item-grid builder-item-grid--sessions">
                    <span className="builder-item-grid-header">Day</span>
                    <span className="builder-item-grid-header">From</span>
                    <span className="builder-item-grid-header">To</span>
                    <span className="builder-item-grid-header">Coach</span>
                    <span className="builder-item-grid-header">Action</span>
                    {program.sessions.map((session, sessionIndex) => (
                      <Fragment key={session.id}>
                        <select
                          value={DAY_OPTIONS.includes(session.day) ? session.day : ""}
                          onChange={(event) =>
                            updateSession(program.id, session.id, { day: event.target.value })
                          }
                          aria-label={`${programName} session ${sessionIndex + 1} day`}
                        >
                          <option value="">Choose…</option>
                          {DAY_OPTIONS.map((day) => (
                            <option key={day} value={day}>
                              {day}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={session.startTime}
                          placeholder="6:00 PM"
                          onChange={(event) =>
                            updateSession(program.id, session.id, { startTime: event.target.value })
                          }
                          aria-label={`${programName} session ${sessionIndex + 1} start time`}
                        />
                        <input
                          type="text"
                          value={session.endTime}
                          placeholder="7:00 PM"
                          onChange={(event) =>
                            updateSession(program.id, session.id, { endTime: event.target.value })
                          }
                          aria-label={`${programName} session ${sessionIndex + 1} end time`}
                        />
                        <input
                          type="text"
                          value={session.instructor ?? ""}
                          placeholder="Optional"
                          onChange={(event) =>
                            updateSession(program.id, session.id, { instructor: event.target.value })
                          }
                          aria-label={`${programName} session ${sessionIndex + 1} coach`}
                        />
                        <div className="builder-item-grid-actions">
                          <button
                            type="button"
                            className="builder-icon-button builder-icon-button-danger"
                            onClick={() => removeSession(program.id, session.id)}
                            aria-label={`Delete ${programName} session ${sessionIndex + 1}`}
                            title="Delete session"
                          >
                            ✕
                          </button>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => addSession(program.id)}
                  >
                    Add a session
                  </button>
                </div>

                {/* Pricing is a list because both mixers charge members $20
                    and non-members $25, while the clinics charge one price to
                    everyone. */}
                <div className="builder-program-block">
                  <div className="builder-program-block-title">Prices</div>
                  <div className="builder-item-grid builder-item-grid--prices">
                    <span className="builder-item-grid-header">Amount</span>
                    <span className="builder-item-grid-header">Applies To</span>
                    <span className="builder-item-grid-header">Action</span>
                    {program.pricing.map((price, priceIndex) => (
                      <Fragment key={price.id}>
                        <input
                          type="text"
                          value={price.amount}
                          placeholder="$27.50"
                          onChange={(event) =>
                            updatePrice(program.id, price.id, { amount: event.target.value })
                          }
                          aria-label={`${programName} price ${priceIndex + 1} amount`}
                        />
                        <input
                          type="text"
                          value={price.appliesTo}
                          placeholder="members & non-members"
                          onChange={(event) =>
                            updatePrice(program.id, price.id, { appliesTo: event.target.value })
                          }
                          aria-label={`${programName} price ${priceIndex + 1} applies to`}
                        />
                        <div className="builder-item-grid-actions">
                          <button
                            type="button"
                            className="builder-icon-button builder-icon-button-danger"
                            onClick={() => removePrice(program.id, price.id)}
                            aria-label={`Delete ${programName} price ${priceIndex + 1}`}
                            title="Delete price"
                          >
                            ✕
                          </button>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => addPrice(program.id)}
                  >
                    Add a price
                  </button>
                </div>

                {/* One point per line. Four short bullets are quicker to edit
                    as text than as four rows with their own buttons. */}
                <BuilderModuleField label="Points" width="full" className="builder-card-field--wide">
                  <textarea
                    rows={4}
                    value={bulletsToText(program.bullets)}
                    placeholder={"Progressive mixed doubles\nWinners move up, losers move down"}
                    onChange={(event) =>
                      updateProgram(program.id, { bullets: bulletsFromText(event.target.value) })
                    }
                    aria-label={`${programName} points`}
                  />
                </BuilderModuleField>
              </Fragment>
            );
          })}
        </div>
        <button type="button" className="secondary-button" onClick={addProgram}>
          Add a program
        </button>
      </div>
    </div>
  );
}
