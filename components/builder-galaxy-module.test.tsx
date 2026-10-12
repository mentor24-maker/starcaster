import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeBuilderModuleSettingsForType, normalizeLayoutSections, normalizeModuleType } from "@/lib/builder-template";
import { GALAXY_LINK_DEFAULTS, GALAXY_MOTION_DEFAULTS, GALAXY_POSE_DEFAULTS, GALAXY_SETTING_DEFAULTS } from "@/lib/galaxy-field";
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
    for (const key of ["glow", "opacity", "hazeStrength", "flareSize", "flareIntensity", "w1", "w2", "w3", "w4", "w5"]) {
      expect(filled[key], key).toBe(GALAXY_LOOK_DEFAULTS[key]);
    }
  });

  it("fills the link hotspot's numbers with the engine's own defaults (task 86bcgef6g)", () => {
    for (const [key, value] of Object.entries(GALAXY_LINK_DEFAULTS)) {
      expect(filled[key], key).toBe(value);
    }
  });

  it("never backfills a key whose ABSENCE means something", () => {
    // Empty colour = "follow the default" (the theme-colour reset); empty
    // poster = "no poster". A backfill would undo a reset on the next load.
    for (const key of ["c1", "c2", "c3", "c4", "c5", "haze", "posterUrl", "linkUrl", "linkLabel"]) {
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

  it("moves a page saved with the retired Converge intro to Unfurl (task 86bcd9qtc)", () => {
    expect(normalizeBuilderModuleSettingsForType("galaxy", { intro: "converge" }).intro).toBe("unfurl");
    expect(normalizeBuilderModuleSettingsForType("galaxy", { intro: "fade" }).intro).toBe("fade");
  });

  it("fills the resting pose face-on, and keeps one somebody set (task 86bcd9qtc)", () => {
    const filled = normalizeBuilderModuleSettingsForType("galaxy", {});
    for (const [key, value] of Object.entries(GALAXY_POSE_DEFAULTS)) expect(filled[key], key).toBe(value);
    const kept = normalizeBuilderModuleSettingsForType("galaxy", { viewAngle: "55", ovalDirection: "-30" });
    expect(kept.viewAngle).toBe("55");
    expect(kept.ovalDirection).toBe("-30");
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
    expect(norm({ placement: "inline", interaction: "spin" })).toBe("rotate");
  });

  it("In Place keeps Tilt with Cursor — a saved tilt reloads as tilt (task 86bcgjr0w)", () => {
    expect(norm({ placement: "inline", interaction: "tilt" })).toBe("tilt");
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

  it("no button In Place + none or tilt, and never one on a Window galaxy", () => {
    for (const settings of [
      { placement: "inline", interaction: "none" },
      { placement: "inline", interaction: "tilt" },
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

describe("the link hotspot (task 86bcgef6g)", () => {
  const withLink = { placement: "inline", interaction: "rotate", zIndex: "3", linkUrl: "/about", linkX: "25", linkY: "60", linkRadius: "120" };

  it("In Place with Link to: a circle at the percent centre, twice the radius across, one rung above the drag surface", () => {
    const html = renderToStaticMarkup(<GalaxyRuntime settings={withLink} />);

    expect(html).toMatch(/<a href="\/about"[^>]*data-galaxy-link="true"/);
    expect(html).toMatch(/left:25%;top:60%;width:240px;height:240px;z-index:4/);
    expect(html).toContain("border-radius:50%");
    expect(html).toContain('aria-label="/about"');
    // After the drag surface in the DOM, so it also wins at an equal rung.
    expect(html.indexOf("galaxy-drag-surface")).toBeLessThan(html.indexOf("data-galaxy-link"));
  });

  it("new tab opens with noopener, and a label replaces the URL as the accessible name", () => {
    const html = renderToStaticMarkup(<GalaxyRuntime settings={{ ...withLink, linkNewTab: "true", linkLabel: "About Dane" }} />);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('aria-label="About Dane"');
  });

  it("the builder gets the dashed-outline class; a published page never does", () => {
    expect(renderToStaticMarkup(<GalaxyRuntime settings={withLink} />)).toContain("galaxy-link-hotspot--builder");
    const live = renderToStaticMarkup(<GalaxyRuntime settings={withLink} liveSite />);
    expect(live).toContain('class="galaxy-link-hotspot"');
    expect(live).not.toContain("galaxy-link-hotspot--builder");
  });

  it("with Link to empty nothing new renders — the markup is byte-for-byte what it was", () => {
    const { linkUrl: _drop, ...rest } = withLink;
    const bare = { placement: "inline", interaction: "rotate", zIndex: "3" };
    expect(renderToStaticMarkup(<GalaxyRuntime settings={rest} />)).not.toContain("<a ");
    expect(renderToStaticMarkup(<GalaxyRuntime settings={{ ...rest, linkUrl: "" }} />)).toBe(renderToStaticMarkup(<GalaxyRuntime settings={bare} />));
  });

  it("Window Center renders no hotspot even with Link to set", () => {
    expect(renderToStaticMarkup(<GalaxyRuntime settings={{ ...withLink, placement: "window" }} />)).not.toContain("data-galaxy-link");
  });

  it("junk centre and radius render at the defaults, never NaN", () => {
    const html = renderToStaticMarkup(<GalaxyRuntime settings={{ ...withLink, linkX: "x", linkY: "", linkRadius: "huge" }} />);
    expect(html).toMatch(/left:50%;top:50%;width:160px;height:160px/);
    expect(html).not.toContain("NaN");
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
