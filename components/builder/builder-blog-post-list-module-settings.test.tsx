// @vitest-environment jsdom
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderBlogPostListModuleSettings } from "./builder-blog-post-list-module-settings";
import { createEmptyModule, normalizeBuilderModuleSettingsForType } from "@/lib/builder-template";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function renderPanel(settings: Record<string, string> = {}) {
  const m = {
    ...createEmptyModule("blog-post-list"),
    settings: normalizeBuilderModuleSettingsForType("blog-post-list", settings)
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<BuilderBlogPostListModuleSettings module={m as never} onUpdateModule={() => {}} />);
  });
}

/** The control that follows the "Posts Per Page" label. */
function postsPerPageSelect(): HTMLSelectElement {
  const label = Array.from(document.querySelectorAll("label, span, div"))
    .find((el) => el.childElementCount === 0 && (el.textContent ?? "").trim() === "Posts Per Page");
  if (!label) throw new Error("No Posts Per Page field in the panel");
  const field = label.closest(".builder-module-field") ?? label.parentElement!;
  const select = field.querySelector("select");
  if (!select) throw new Error("Posts Per Page has no <select>");
  return select;
}

/**
 * "Posts Per Page" offered five presets — 3, 6, 9, 12, 18 — so "show the
 * latest 14" could not be set at all (task 86bbzy7g0). The renderer already
 * accepted any whole number; only the panel was in the way. It is a number
 * field now, and these tests hold the two things that matter: a saved 14
 * is shown as 14 (the old select would have snapped it to a preset), and
 * a page that never chose still reads 9.
 */
describe("Post Feed settings panel: Posts Per Page", () => {
  it("shows a saved count of 14 as 14, not snapped to a preset", () => {
    renderPanel({ postsPerPage: "14" });
    expect(postsPerPageSelect().value).toBe("14");
  });

  it("offers every whole number from 1 to 50", () => {
    renderPanel({ postsPerPage: "14" });
    const values = Array.from(postsPerPageSelect().options).map((o) => o.value);
    expect(values).toEqual(Array.from({ length: 50 }, (_, i) => String(i + 1)));
  });

  it("still reads 9 on a module that never chose", () => {
    renderPanel();
    expect(postsPerPageSelect().value).toBe("9");
  });
});
