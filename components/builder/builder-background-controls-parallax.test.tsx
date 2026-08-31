import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { createDefaultBackgroundSettings } from "@/lib/builder-template";

/**
 * `BackgroundSettings` is ONE object worn by six surfaces — the page
 * background, a section, a column, a module, a BUTTON and the overlay-screen
 * dimmer — and parallax on a button is nonsense. So the field lives on the
 * type and the control is gated per surface, exactly as Video is.
 *
 * These hold that gate open on one side and shut on the other, and they hold
 * the second gate too: parallax means nothing on a colour or a gradient, which
 * have no picture to drift.
 */
const IMAGE = {
  ...createDefaultBackgroundSettings(),
  mode: "image" as const,
  imageUrl: "/images/x.png"
};

const VIDEO = {
  ...createDefaultBackgroundSettings(),
  mode: "video" as const,
  videoUrl: "/images/x.mp4"
};

function html(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <BuilderBackgroundControls
      label="Row Background"
      background={createDefaultBackgroundSettings()}
      onChange={() => {}}
      {...props}
    />
  );
}

describe("where Parallax is offered", () => {
  it("is absent by default, on every mode — a button never sees it", () => {
    for (const background of [IMAGE, VIDEO]) {
      expect(html({ background })).not.toContain("Parallax");
      expect(html({ background, horizontal: true })).not.toContain("Parallax");
    }
  });

  it("appears on an image background when the surface opts in", () => {
    expect(html({ allowParallax: true, background: IMAGE })).toContain("Parallax");
  });

  it("appears on a video background when the surface opts in", () => {
    expect(html({ allowParallax: true, background: VIDEO })).toContain("Parallax");
  });

  it("appears in BOTH layouts, so the two forms cannot drift apart", () => {
    // The mode dropdown drifted exactly this way once, and a third hand-written
    // copy had to be found in builder-section-controls.tsx and fixed separately.
    expect(html({ allowParallax: true, background: IMAGE })).toContain("Parallax");
    expect(html({ allowParallax: true, background: IMAGE, horizontal: true })).toContain("Parallax");
  });

  it("stays hidden on the modes that have no picture to drift", () => {
    for (const mode of ["none", "color", "gradient", "style"] as const) {
      const background = { ...createDefaultBackgroundSettings(), mode };
      expect(html({ allowParallax: true, background })).not.toContain("Parallax");
    }
  });

  it("is off, at the default speed, and its speed box is disabled until it is on", () => {
    const markup = html({ allowParallax: true, background: IMAGE });
    expect(markup).toContain('value="0.3"');
    expect(markup).toContain("disabled");
  });

  it("enables the speed box once parallax is on", () => {
    const markup = html({
      allowParallax: true,
      background: { ...IMAGE, parallax: true, parallaxSpeed: 0.5 }
    });
    expect(markup).toContain('value="0.5"');
    // The only `disabled` in this panel is the speed box, so its absence is
    // the assertion — a checked box with a dead speed control beside it is the
    // failure this pairs with the one above to rule out.
    expect(markup).not.toContain("disabled");
  });

  it("says out loud that it runs on phones, rather than being silently dead there", () => {
    // Acceptance criterion 6: if parallax were skipped on mobile the panel
    // would have to say so. It is not skipped, and the panel says that too —
    // a control whose behaviour on half the devices is undocumented is the
    // same problem one step quieter.
    expect(html({ allowParallax: true, background: IMAGE })).toContain("runs on phones");
  });
});
