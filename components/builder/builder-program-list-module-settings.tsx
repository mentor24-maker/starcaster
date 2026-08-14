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

  // The paste box. The operator's objection to this panel on 2026-08-13 was
  // that filling eleven fields per program is the wrong shape of work when
  // the content already exists as text on a flyer.
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
    const skipped = ignored.length > 0 ? ` Skipped ${ignored.length} footer line${ignored.length === 1 ? "" : "s"}.` : "";
    setFlyerNote(`Added ${program.title || "a program"} — ${found.join(", ")}.${skipped} Check it below.`);
  };

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

  // Empty color settings follow the site theme; the swatch previews the
  // same theme color the renderer resolves to, with the factory color as
  // the no-theme fallback.
  const themeHex = (label: string) => themeColors.find((color) => color.label === label)?.hex || "";
  const accentDefault = themeHex("Primary") || "#4f9c3a";
  const headingDefault = themeHex("Accent") || "#14265c";
  // Not a theme color — see the renderer. A swatch that previews a color
  // the renderer will not use is worse than no swatch at all.
  const borderDefault = "#dce3ef";

  return (
    <div className="builder-cards-panel">
      {/* LEFT — settings that apply to every program in the module.
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
          {/* One number for the club, not one per program: on all fifteen
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
              placeholder="All programs carry a 24-hour cancellation policy."
              onChange={(event) => set("policyNote", event.target.value)}
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

      {/* RIGHT — the programs themselves. */}
      <div className="builder-cards-panel-items">
        <div className="builder-cards-panel-heading">Programs</div>

        {/* Paste first, type second. The flyer's words already exist
            somewhere; retyping them into eleven boxes is the work this
            removes. Nothing is sent anywhere — the text is read here, by
            rules, so it cannot turn $27.50 into $2750. */}
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="Paste A Flyer" width="full">
            <textarea
              rows={4}
              value={flyerText}
              placeholder={"Paste the flyer's text here — name, coach, level, days and times, prices.\nThe address and phone footer is ignored."}
              onChange={(event) => {
                setFlyerText(event.target.value);
                if (flyerNote) setFlyerNote("");
              }}
            />
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
        <BuilderModuleFieldStrip>
          <BuilderModuleField label="" width="full">
            <button
              type="button"
              className="secondary-button"
              onClick={addFromFlyerText}
              disabled={flyerText.trim().length === 0}
            >
              Read it and add a program
            </button>
          </BuilderModuleField>
        </BuilderModuleFieldStrip>
        {flyerNote ? (
          <p className="builder-program-paste-note" role="status">
            {flyerNote}
          </p>
        ) : null}
        <div className="builder-cards-panel-fields" data-lattice-pairs="2">
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

                {/* Sessions. A coach sits here rather than on the program
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
          Add a program
        </button>
      </div>
    </div>
  );
}
