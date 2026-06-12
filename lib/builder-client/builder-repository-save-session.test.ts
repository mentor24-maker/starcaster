import { describe, expect, it } from "vitest";
import {
  repositoryEditingSessionKeyFromFocus,
  repositoryEditingSessionKeyFromLocalState
} from "./builder-repository-save-session";

describe("repositoryEditingSessionKeyFromFocus", () => {
  it("builds keys per focus kind", () => {
    expect(
      repositoryEditingSessionKeyFromFocus({
        kind: "saved",
        cellModuleId: "cell-1",
        name: "Hero",
        moduleClass: "Marketing",
        modules: []
      })
    ).toBe("saved:cell-1");

    expect(
      repositoryEditingSessionKeyFromFocus({
        kind: "section",
        sectionId: "section-9",
        name: "Row",
        section: {
          id: "section-9",
          title: "",
          layout: "1",
          background: { mode: "color", color: "#ffffff", imageUrl: "", gradient: "" },
          cellBackgrounds: {},
          cellPadding: {},
          cellVerticalMargin: {},
          cellMobileHidden: {},
          cellDesktopHidden: {},
          cellBorderWidth: {},
          cellBorderColor: {},
          cellBorderRadius: {},
          cellBorderStyle: {},
          cellShadow: {},
          cellOpacity: {},
          cellHAlign: {},
          cellVAlign: {},
          modules: []
        }
      })
    ).toBe("section:section-9");
  });
});

describe("repositoryEditingSessionKeyFromLocalState", () => {
  it("prioritizes section then created then saved", () => {
    expect(
      repositoryEditingSessionKeyFromLocalState({
        editingSectionId: "s1",
        editingCreatedId: "c1",
        editingId: "m1"
      })
    ).toBe("section:s1");

    expect(
      repositoryEditingSessionKeyFromLocalState({
        editingSectionId: "",
        editingCreatedId: "c1",
        editingId: "m1"
      })
    ).toBe("created-open:c1");

    expect(
      repositoryEditingSessionKeyFromLocalState({
        editingSectionId: "",
        editingCreatedId: "",
        editingId: "m1"
      })
    ).toBe("saved:m1");
  });
});
