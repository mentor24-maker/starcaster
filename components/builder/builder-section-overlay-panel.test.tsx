// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  BUILDER_VIDEO_DEFAULT_OVERLAY_TINT,
  createEmptySection,
  type BuilderTemplateSection
} from "@/lib/builder-template";
import { BuilderSectionControls } from "./builder-section-controls";

// React only flushes `act` quietly when the environment says it is a test
// one; without it every mount prints a warning that reads like a failure.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * THE OVERLAY GROUP IN THE ROW PANEL.
 *
 * Every section has stored an `overlayScreen` for months and the renderer has
 * painted it since 2026-08-31, but the React panel had no controls at all —
 * so the only overlay obtainable was the dark tint a video row seeds for
 * itself, and nobody could turn that off. These cover the two halves of
 * putting the editor back: the group RENDERS, and its picker writes to
 * `overlayScreen.background` rather than to the row's own background.
 *
 * The second half is the one worth mounting a real root for. A test that only
 * called the exported helper would pass just as happily with the picker wired
 * to `section.background` — which is the mistake actually available here,
 * since the two layers are the same `BackgroundSettings` type and neither the
 * compiler nor a static-markup snapshot can tell them apart.
 */
type Mounted = {
  select(label: string): HTMLSelectElement | undefined;
  choose(label: string, value: string): BuilderTemplateSection;
  labels(): string[];
};

function mount(section: BuilderTemplateSection): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let latest = section;

  act(() => {
    root.render(
      <BuilderSectionControls
        section={section}
        editorDevice="browser"
        onUpdateSection={(updater) => {
          latest = updater(latest);
        }}
      />
    );
  });

  function rowFor(label: string): Element | undefined {
    return [...host.querySelectorAll(".builder-module-field, .builder-setting-row")].find(
      (row) =>
        (row.querySelector(".builder-module-field-label, .builder-setting-label")?.textContent || "")
          .trim() === label
    );
  }

  return {
    select: (label) => rowFor(label)?.querySelector("select") ?? undefined,
    labels: () =>
      [...host.querySelectorAll(".builder-module-field-label, .builder-setting-label")].map((el) =>
        (el.textContent || "").trim()
      ),
    choose(label, value) {
      const select = rowFor(label)?.querySelector("select");
      if (!select) throw new Error(`no select labelled "${label}"`);
      act(() => {
        // React listens at the root, so the value has to be set through the
        // native setter it patched over — assigning `.value` directly is
        // swallowed and the handler never sees the change.
        Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          "value"
        )!.set!.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return latest;
    }
  };
}

/** A row whose overlay is already set, the way a saved page carries it. */
function sectionWithOverlay(overlayScreen: unknown): BuilderTemplateSection {
  return { ...createEmptySection(), overlayScreen } as BuilderTemplateSection;
}

describe("the Overlay group", () => {
  it("renders an Overlay Type picker offering the paintable modes", () => {
    const overlayType = mount(createEmptySection()).select("Overlay Type");

    expect(overlayType).toBeTruthy();
    for (const mode of ["none", "color", "gradient", "image", "style"]) {
      expect([...overlayType!.options].map((o) => o.value)).toContain(mode);
    }
  });

  it("does not offer Video — a screen over a video background is a second <video>", () => {
    const overlayType = mount(createEmptySection()).select("Overlay Type");

    expect([...overlayType!.options].map((o) => o.value)).not.toContain("video");
  });

  it("shows the row's own Row Background picker as well, unrelabelled", () => {
    expect(mount(createEmptySection()).labels()).toContain("Row Background");
  });
});

describe("the opacity control", () => {
  it("is hidden while the type is None — there is nothing for it to act on", () => {
    expect(mount(createEmptySection()).select("Opacity")).toBeUndefined();
  });

  it("appears once a type is chosen, showing the stored strength", () => {
    const panel = mount(sectionWithOverlay({ background: { mode: "color", color: "#123456" }, opacity: 40 }));

    expect(panel.select("Opacity")?.value).toBe("40");
  });

  it("writes the new strength without disturbing the overlay's background", () => {
    const panel = mount(sectionWithOverlay({ background: { mode: "color", color: "#123456" }, opacity: 40 }));
    const next = panel.choose("Opacity", "75");

    expect(next.overlayScreen?.opacity).toBe(75);
    expect(next.overlayScreen?.background.color).toBe("#123456");
  });
});

describe("what the picker writes to", () => {
  it("puts the chosen type on overlayScreen.background, NOT the row background", () => {
    const next = mount(createEmptySection()).choose("Overlay Type", "image");

    expect(next.overlayScreen?.background.mode).toBe("image");
    expect(next.background.mode).toBe("none");
  });

  it("keeps a strength the operator already set when the type changes", () => {
    const panel = mount(sectionWithOverlay({ background: { mode: "color", color: "#123456" }, opacity: 40 }));
    const next = panel.choose("Overlay Type", "gradient");

    expect(next.overlayScreen?.background.mode).toBe("gradient");
    expect(next.overlayScreen?.opacity).toBe(40);
  });

  it("survives a row saved before overlays existed, which carries none at all", () => {
    const bare = { ...createEmptySection() } as Record<string, unknown>;
    delete bare.overlayScreen;
    const panel = mount(bare as BuilderTemplateSection);

    expect(panel.select("Overlay Type")?.value).toBe("none");
    expect(panel.choose("Overlay Type", "color").overlayScreen?.background.mode).toBe("color");
  });
});

describe("a video row's seeded tint", () => {
  // The whole point of the panel: the seed was already being written and was
  // unreachable, so it could be neither adjusted nor turned off.
  const seeded = sectionWithOverlay({
    background: { mode: "color", color: BUILDER_VIDEO_DEFAULT_OVERLAY_TINT },
    opacity: 45
  });

  it("opens with the tint already filled in", () => {
    const panel = mount(seeded);

    expect(panel.select("Overlay Type")?.value).toBe("color");
    expect(panel.select("Opacity")?.value).toBe("45");
  });

  it("can be turned off", () => {
    expect(mount(seeded).choose("Overlay Type", "none").overlayScreen?.background.mode).toBe("none");
  });
});
