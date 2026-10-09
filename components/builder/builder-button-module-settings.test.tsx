// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyModule, type BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderButtonModuleSettings } from "./builder-button-module-settings";

/**
 * The Button panel's Frame axis — the fill, the hover fill and the border.
 *
 * PR #183 (2026-08-09) folded Frame into Placement while rewriting the
 * spacing rows and dropped the Background picker in the merge. Nothing
 * failed: the import stayed, the update handler stayed, the renderer kept
 * reading every fill key, and a button built before August kept its colour.
 * The only symptom was a settings panel with no way to set the one thing a
 * button visibly is, found by the operator two months later (task
 * 86bcg65zu). These tests drive the real control in a DOM, so the picker
 * cannot be present in the source and absent from the screen again.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The Link picker lists the project's pages over the wire; nothing here is
// about links, so it gets an empty project and no network.
vi.mock("@/lib/builder-admin-fetch", () => ({
  builderAdminFetch: async () => ({ ok: true, json: async () => ({ ok: true, data: [] }) })
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

type Harness = {
  module: () => BuilderTemplateModule;
};

async function mount(
  settings: Record<string, string> = {},
  props: { compact?: boolean } = {}
): Promise<Harness> {
  let current: BuilderTemplateModule = {
    ...createEmptyModule("button"),
    text: "Read My Manifesto",
    settings: { ...settings }
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const paint = () =>
    root!.render(
      <BuilderButtonModuleSettings
        compact={props.compact}
        module={current}
        onUpdateModule={(updater) => {
          current = updater(current);
          paint();
        }}
      />
    );
  // Async so the Link picker's page fetch settles inside act, not after it.
  await act(async () => paint());
  return { module: () => current };
}

function click(el: Element | null | undefined, what: string) {
  if (!el) throw new Error(`Nothing to click for ${what}`);
  act(() => {
    (el as HTMLElement).click();
  });
}

/**
 * Every colour control on the panel shares the swatch class; the fill's is
 * the one titled for it. Selecting by class picked Text Color's white swatch
 * the first time this was written.
 */
function fillSwatch(): HTMLElement {
  const found = document.querySelector<HTMLElement>('button[title="Edit button background"]');
  if (!found) throw new Error("No Background swatch on the panel");
  return found;
}

function tabLabelled(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (tab) => (tab.textContent ?? "").trim() === label
  );
}

describe("Button settings — the Frame axis", () => {
  it("offers the fill under Frame, ahead of the hover fill and the border", async () => {
    await mount();
    const html = container!.innerHTML;
    const frame = html.indexOf(">Frame<");
    const background = html.indexOf(">Background<");
    const hover = html.indexOf(">Hover Fill<");
    const border = html.indexOf(">Border Style<");
    const radius = html.indexOf(">Radius<");
    expect(frame).toBeGreaterThan(-1);
    expect(background).toBeGreaterThan(frame);
    // D9: the fill resizes nothing but recolours everything; the border and
    // its radius are the last 2%, so they close the axis.
    expect(hover).toBeGreaterThan(background);
    expect(border).toBeGreaterThan(hover);
    expect(radius).toBeGreaterThan(border);
    // Placement keeps its own three concerns and nothing of the pill's.
    const placement = html.indexOf(">Placement<");
    expect(html.indexOf(">Alignment<")).toBeGreaterThan(placement);
    expect(html.indexOf(">V Padding<")).toBeGreaterThan(placement);
    expect(html.indexOf(">V Margin<")).toBeGreaterThan(placement);
    expect(frame).toBeGreaterThan(placement);
  });

  it("writes the fill keys the renderer reads when a mode is picked", async () => {
    const h = await mount();
    click(fillSwatch(), "the Background swatch");
    click(tabLabelled("Gradient"), "the Gradient tab");
    const s = h.module().settings;
    expect(s.buttonBackgroundMode).toBe("gradient");
    expect(s.buttonBackgroundColor).toBe("#214c71");
    expect(s.buttonBackgroundColor2).toBe("#eaf4ff");
  });

  it("shows the fill a saved page already carries", async () => {
    await mount({ buttonBackgroundMode: "color", buttonBackgroundColor: "#ff6600", buttonColor: "#ff6600" });
    expect(fillSwatch().getAttribute("style") ?? "").toContain("rgb(255, 102, 0)");
  });

  it("lets the hover fill go back to the theme, like Text Color", async () => {
    // Nothing else on the panel is set, so the only ✕ on screen is Hover Fill's.
    const h = await mount({ buttonHoverColor: "#123456" });
    const clear = document.querySelectorAll(".builder-nav-color-clear");
    expect(clear).toHaveLength(1);
    click(clear[0], "the Hover Fill reset");
    expect(h.module().settings.buttonHoverColor).toBe("");
    // And once cleared the row says so, rather than pre-filling a hex.
    expect(document.querySelectorAll(".builder-nav-color-hint").length).toBeGreaterThan(0);
  });

  it("keeps the fill in a table cell, where no gallery is wired", async () => {
    await mount({}, { compact: true });
    click(fillSwatch(), "the Background swatch");
    click(tabLabelled("Image"), "the Image tab");
    expect(document.querySelector('input[placeholder^="https://"]')).not.toBeNull();
    expect(container!.innerHTML).not.toContain("Choose From Gallery");
  });
});
