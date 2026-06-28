import { describe, expect, it } from "vitest";
import type { BuilderCellModuleRecord } from "@/lib/builder-template";
import {
  getSavedModulesForPaletteGroup,
  getStarterModulesForPaletteGroup,
  isSavedModuleOnlyPaletteGroup
} from "@/lib/builder-saved-module-palette";

describe("builder saved module palette", () => {
  it("exposes native confetti starter in special effects", () => {
    expect(isSavedModuleOnlyPaletteGroup("special-effects")).toBe(false);
    const starters = getStarterModulesForPaletteGroup("special-effects");
    expect(starters.some((item) => item.type === "confetti")).toBe(true);
  });

  it("still exposes starter modules for standard builder groups", () => {
    expect(getStarterModulesForPaletteGroup("heading").length).toBeGreaterThan(0);
  });

  it("returns saved modules whose class matches the active palette group", () => {
    const cellModules = [
      {
        id: "confetti-1",
        name: "Effect: Confetti - Large",
        moduleClass: "Special Effects",
        modules: [{ id: "m1", type: "confetti", column: "main", name: "Confetti", text: "", settings: {} }],
        createdAt: "",
        updatedAt: ""
      },
      {
        id: "normie-1",
        name: "Bouncing Normie - Game",
        moduleClass: "Special Effects",
        modules: [
          {
            id: "m2",
            type: "floating-image",
            column: "main",
            name: "Bouncing Normie",
            text: "",
            settings: { trigger: "game" }
          }
        ],
        createdAt: "",
        updatedAt: ""
      },
      {
        id: "heading-1",
        name: "Hero Heading",
        moduleClass: "Headings",
        modules: [{ id: "m3", type: "heading", column: "main", name: "", text: "Hello", settings: {} }],
        createdAt: "",
        updatedAt: ""
      }
    ] as BuilderCellModuleRecord[];

    const specialEffects = getSavedModulesForPaletteGroup(cellModules, "special-effects");

    expect(specialEffects.map((entry) => entry.id)).toEqual(["confetti-1", "normie-1"]);
  });
});
