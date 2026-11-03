import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BuilderProjectDataPicker,
  pickerOptionValue,
  resolvePickerSelection,
  type BuilderPickerOption
} from "./builder-project-data-picker";

const OPTIONS: BuilderPickerOption[] = [
  { id: "p1", label: "Home", slug: "home", path: "/home" },
  { id: "p2", label: "Blog", slug: "blog", path: "/blog" }
];

describe("pickerOptionValue", () => {
  it("stores a PAGE by reference — its id, with today's address only as the fallback (86bcxmrw2)", () => {
    expect(pickerOptionValue(OPTIONS[0], "path")).toBe("page:p1|/home");
    expect(pickerOptionValue(OPTIONS[0], "slug")).toBe("page:p1|home");
    expect(pickerOptionValue(OPTIONS[0], "id")).toBe("p1");
  });

  it("posts and CRM forms keep the value they always wrote", () => {
    expect(pickerOptionValue(OPTIONS[0], "path", "posts")).toBe("/home");
    expect(pickerOptionValue(OPTIONS[0], "slug", "posts")).toBe("home");
    expect(pickerOptionValue(OPTIONS[0], "id", "crm-forms")).toBe("p1");
  });
});

describe("resolvePickerSelection — references", () => {
  it("selects the page by id even after its address changed", () => {
    const renamed = [{ ...OPTIONS[0], slug: "home-v2", path: "/home-v2" }, OPTIONS[1]];
    const state = resolvePickerSelection(renamed, "page:p1|/home", "path");
    expect(state.mode).toBe("option");
    expect(state.selected?.label).toBe("Home");
  });

  it("names a deleted page as missing, keeping its saved address", () => {
    expect(resolvePickerSelection(OPTIONS, "page:gone|/old", "path")).toEqual({ mode: "missing", fallback: "/old" });
  });
});

describe("resolvePickerSelection", () => {
  it("empty value selects the none row", () => {
    expect(resolvePickerSelection(OPTIONS, "", "path").mode).toBe("none");
  });

  it("a value matching an option selects it", () => {
    const state = resolvePickerSelection(OPTIONS, "/blog", "path");
    expect(state.mode).toBe("option");
    expect(state.selected?.id).toBe("p2");
  });

  it("a saved value matching no option is Custom mode — never broken", () => {
    expect(resolvePickerSelection(OPTIONS, "/hand-typed-thing", "path").mode).toBe("custom");
  });

  it("kind matters: a slug value does not match in path mode", () => {
    expect(resolvePickerSelection(OPTIONS, "blog", "path").mode).toBe("custom");
    expect(resolvePickerSelection(OPTIONS, "blog", "slug").mode).toBe("option");
  });
});

describe("BuilderProjectDataPicker (static render)", () => {
  it("renders the loading state before options arrive (effects don't run statically)", () => {
    const html = renderToStaticMarkup(
      <BuilderProjectDataPicker source="pages" valueKind="path" value="" onChange={() => {}} ariaLabel="Target Page" />
    );
    expect(html).toContain("Loading…");
    expect(html).toContain('aria-label="Target Page"');
  });
});
