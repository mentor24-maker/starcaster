import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { createDefaultBackgroundSettings, normalizeBackgroundSettings } from "@/lib/builder-template";

/**
 * Video is offered per surface, not everywhere. This component is the chrome
 * worn by button backgrounds, module backgrounds, poll pods and the email
 * path, and none of those can render a <video> — so the gating prop is what
 * stops the operator being handed an option that does nothing where he clicked
 * it. These hold the gate open on one side and shut on the other.
 */
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

describe("where Video is offered", () => {
  it("is absent by default — every existing caller keeps its five modes", () => {
    expect(html()).not.toContain('value="video"');
    expect(html({ horizontal: true })).not.toContain('value="video"');
  });

  it("appears in the stacked layout when the surface opts in", () => {
    expect(html({ allowVideo: true })).toContain('value="video"');
  });

  it("appears in the horizontal layout when the surface opts in", () => {
    expect(html({ allowVideo: true, horizontal: true })).toContain('value="video"');
  });

  it("still offers the other four modes alongside it", () => {
    const markup = html({ allowVideo: true });
    for (const mode of ["none", "color", "gradient", "image", "style"]) {
      expect(markup).toContain(`value="${mode}"`);
    }
  });
});

describe("the Video panel", () => {
  const videoBackground = normalizeBackgroundSettings({
    mode: "video",
    videoUrl: "/assets/clip.mp4",
    posterUrl: "/assets/still.jpg"
  });

  it("renders its controls once a video background is set", () => {
    const markup = html({ allowVideo: true, background: videoBackground });

    expect(markup).toContain("Choose Video");
    expect(markup).toContain("Choose Poster");
    expect(markup).toContain("Speed");
    expect(markup).toContain("Play On Phones");
  });

  it("renders the same controls in both layouts, so they cannot drift", () => {
    const stacked = html({ allowVideo: true, background: videoBackground });
    const horizontal = html({ allowVideo: true, horizontal: true, background: videoBackground });

    for (const control of ["Choose Video", "Choose Poster", "Speed", "Blur", "Play On Phones"]) {
      expect(stacked).toContain(control);
      expect(horizontal).toContain(control);
    }
  });

  it("warns when there is no poster, because that is what phones will show", () => {
    const markup = html({
      allowVideo: true,
      background: normalizeBackgroundSettings({ mode: "video", videoUrl: "/assets/clip.mp4" })
    });

    expect(markup).toContain("Without a poster image");
  });

  it("drops the warning once a poster is chosen", () => {
    expect(html({ allowVideo: true, background: videoBackground })).not.toContain(
      "Without a poster image"
    );
  });

  it("shows nothing video-related while the mode is something else", () => {
    const markup = html({
      allowVideo: true,
      background: normalizeBackgroundSettings({ mode: "color", color: "#ffffff" })
    });

    expect(markup).not.toContain("Choose Video");
    expect(markup).not.toContain("Play On Phones");
  });
});
