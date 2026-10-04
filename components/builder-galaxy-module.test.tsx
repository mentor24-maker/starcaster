import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeBuilderModuleSettingsForType, normalizeLayoutSections, normalizeModuleType } from "@/lib/builder-template";
import { GALAXY_MOTION_DEFAULTS, GALAXY_SETTING_DEFAULTS } from "@/lib/galaxy-field";
import { GALAXY_LOOK_DEFAULTS, matchGalaxyPreset } from "@/lib/galaxy-render";
import { searchModulePalette, type ModuleSearchHit } from "@/lib/builder-module-search";
import { modulePaletteGroups, modulePaletteItems } from "@/components/builder/builder-types";
import { GalaxyRuntime } from "./builder-galaxy-module";

/**
 * Galaxy module 2/6 (task 86bc7f5hg) — the parts of the module a test can
 * hold still. The motion itself is checked in a real browser by the galaxy
 * contracts in scripts/ui/render-contracts.mjs.
 */

describe("galaxy is registered on both sides (landmine 1)", () => {
  it("survives normalizeModuleType instead of being coerced to text", () => {
    expect(normalizeModuleType("galaxy")).toBe("galaxy");
  });

  it("a saved page reloads its galaxy as a galaxy", () => {
    const [section] = normalizeLayoutSections([
      {
        id: "s1",
        title: "",
        layout: "single",
        modules: [{ id: "m1", type: "galaxy", column: "main", text: "", settings: { particleCount: "3000" } }]
      }
    ]);

    expect(section.modules[0].type).toBe("galaxy");
    expect(section.modules[0].settings.particleCount).toBe("3000");
  });
});

describe("the galaxy normalizer block (DOCTRINE §5.27)", () => {
  const filled = normalizeBuilderModuleSettingsForType("galaxy", {});

  it("fills every engine number with the engine's own default", () => {
    for (const [key, value] of Object.entries(GALAXY_SETTING_DEFAULTS)) {
      expect(filled[key], key).toBe(value);
    }
  });

  it("fills the look numbers with the renderer's own defaults", () => {
    for (const key of ["glow", "opacity", "hazeStrength", "w1", "w2", "w3", "w4", "w5"]) {
      expect(filled[key], key).toBe(GALAXY_LOOK_DEFAULTS[key]);
    }
  });

  it("never backfills a key whose ABSENCE means something", () => {
    // Empty colour = "follow the default" (the theme-colour reset); empty
    // poster = "no poster". A backfill would undo a reset on the next load.
    for (const key of ["c1", "c2", "c3", "c4", "c5", "haze", "posterUrl"]) {
      expect(filled[key], key).toBeUndefined();
    }
  });
});

describe("the intro and scroll settings in the normalizer (task 86bc7f5hj)", () => {
  it("fills all five with the engine's own defaults", () => {
    const filled = normalizeBuilderModuleSettingsForType("galaxy", {});
    for (const [key, value] of Object.entries(GALAXY_MOTION_DEFAULTS)) {
      expect(filled[key], key).toBe(value);
    }
  });

  it("keeps an intro switched off and a scroll switched off — a backfill must not switch them back on", () => {
    const kept = normalizeBuilderModuleSettingsForType("galaxy", { intro: "none", scrollDisperse: "false" });
    expect(kept.intro).toBe("none");
    expect(kept.scrollDisperse).toBe("false");
  });
});

describe("interaction follows the placement (task 86bc7f5hh)", () => {
  const norm = (settings: Record<string, string>) => normalizeBuilderModuleSettingsForType("galaxy", settings).interaction;

  it("an absent interaction becomes the placement's default", () => {
    expect(norm({ placement: "inline" })).toBe("rotate");
    expect(norm({ placement: "window" })).toBe("tilt");
    expect(norm({})).toBe("tilt");
  });

  it("a mismatched one is rewritten to that default — the key stays", () => {
    expect(norm({ placement: "window", interaction: "rotate" })).toBe("tilt");
    expect(norm({ placement: "inline", interaction: "tilt" })).toBe("rotate");
  });

  it("None survives either placement", () => {
    expect(norm({ placement: "inline", interaction: "none" })).toBe("none");
    expect(norm({ placement: "window", interaction: "none" })).toBe("none");
  });
});

describe("the palette entry", () => {
  const groups = modulePaletteGroups.map((g) => ({ value: g.value, label: g.label, description: g.description }));
  const items = modulePaletteItems.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    group: item.group,
    groupLabel: modulePaletteGroups.find((g) => g.value === item.group)?.label ?? item.group
  }));
  const labels = (query: string) =>
    searchModulePalette(query, { groups, items }).map((hit: ModuleSearchHit) =>
      hit.kind === "item" ? hit.item.label : hit.kind === "group" ? hit.group.label : hit.saved.label
    );

  it("sits under Special Effects", () => {
    const entry = modulePaletteItems.find((item) => item.type === "galaxy");
    expect(entry?.group).toBe("special-effects");
    expect(entry?.label).toBe("Galaxy");
  });

  it("is found by searching for 'stars' or 'spiral'", () => {
    expect(labels("stars")).toContain("Galaxy");
    expect(labels("spiral")).toContain("Galaxy");
  });

  it("opens on the Astra preset", () => {
    const entry = modulePaletteItems.find((item) => item.type === "galaxy");
    expect(matchGalaxyPreset(entry?.settings ?? {})).toBe("astra");
  });
});

describe("the runtime's markup", () => {
  it("Window: a fixed full-window canvas, hidden from screen readers, taking no room in the column", () => {
    const html = renderToStaticMarkup(<GalaxyRuntime settings={{ placement: "window", zIndex: "-9999" }} />);

    expect(html).toContain("<canvas");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/position:fixed/);
    expect(html).toMatch(/z-index:-9999/);
    expect(html).toMatch(/height:0/);
  });

  it("In Place: a block of the Height setting, with a negative z-index lifted to 0", () => {
    const html = renderToStaticMarkup(<GalaxyRuntime settings={{ placement: "inline", height: "360", zIndex: "-9999" }} />);

    expect(html).toMatch(/height:360px/);
    expect(html).toMatch(/position:absolute/);
    expect(html).toMatch(/z-index:0/);
  });

  it("In Place + rotate: a labelled, focusable button over the canvas", () => {
    const html = renderToStaticMarkup(<GalaxyRuntime settings={{ placement: "inline", interaction: "rotate" }} />);

    expect(html).toContain('<button type="button" class="galaxy-drag-surface"');
    expect(html).toContain('aria-label="Drag or use the arrow keys to rotate the galaxy"');
  });

  it("In Place with no interaction stored still gets the button — rotate is its default", () => {
    const html = renderToStaticMarkup(<GalaxyRuntime settings={{ placement: "inline" }} />);
    expect(html).toContain("galaxy-drag-surface");
  });

  it("no button In Place + none, and never one on a Window galaxy", () => {
    for (const settings of [
      { placement: "inline", interaction: "none" },
      { placement: "window", interaction: "tilt" },
      { placement: "window", interaction: "rotate" }
    ]) {
      expect(renderToStaticMarkup(<GalaxyRuntime settings={settings} />), JSON.stringify(settings)).not.toContain("galaxy-drag-surface");
    }
  });

  it("never renders the builder note on a live site", () => {
    const html = renderToStaticMarkup(
      <GalaxyRuntime settings={{}} liveSite builderNote={() => <p>BUILDER NOTE</p>} />
    );
    expect(html).not.toContain("BUILDER NOTE");
  });
});

describe("one painter for the card and the page", () => {
  // TractorNav's card and runtime drew with separate code and disagreed on
  // live sites for two months while the card looked right. Both galaxy
  // components must reach the canvas only through drawGalaxyFrame.
  const source = readFileSync(path.join(__dirname, "builder-galaxy-module.tsx"), "utf8");
  const body = (name: string) => {
    const start = source.indexOf(`export function ${name}`);
    const next = source.indexOf("export function", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };

  it("both components call drawGalaxyFrame", () => {
    expect(body("GalaxyCardPreview")).toContain("drawGalaxyFrame(");
    expect(body("GalaxyRuntime")).toContain("drawGalaxyFrame(");
  });

  it("and nothing in the file paints a star any other way", () => {
    for (const call of ["drawImage(", ".arc(", "fillRect(", "createRadialGradient("]) {
      expect(source.includes(call), call).toBe(false);
    }
  });
});
