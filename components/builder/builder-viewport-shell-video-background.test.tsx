import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderViewportShellLayout } from "./builder-viewport-shell-layout";
import { getShellBackgroundLayers } from "./builder-utils";
import { createDefaultBackgroundSettings, type BackgroundSettings } from "@/lib/builder-template";

/**
 * A page can sit on a video the way a row can. Two things had to be true for
 * that, and both are asserted here rather than described: the layer is mounted
 * by the component that OWNS the page background (this one, not the preview it
 * wraps), and the poster the surface already paints is untouched, because that
 * still is the whole of the phone / reduced-motion fallback.
 */
function background(overrides: Partial<BackgroundSettings>): BackgroundSettings {
  return { ...createDefaultBackgroundSettings(), ...overrides } as BackgroundSettings;
}

const VIDEO = background({
  mode: "video",
  videoUrl: "/api/admin/media-file/clip.mp4",
  posterUrl: "/api/admin/media-file/poster.jpg"
});

function shell(pageBackground: BackgroundSettings) {
  return renderToStaticMarkup(
    <BuilderViewportShellLayout pageBackground={pageBackground}>
      <p>page content</p>
    </BuilderViewportShellLayout>
  );
}

describe("what getShellBackgroundLayers reports for a page video", () => {
  it("reports the clip AND the poster, so the fallback is the surface's own background", () => {
    const layers = getShellBackgroundLayers(VIDEO, undefined);
    expect(layers.video?.videoUrl).toBe("/api/admin/media-file/clip.mp4");
    expect(String(layers.inlineBackground?.backgroundImage)).toContain("poster.jpg");
  });

  it("still reports the clip when no poster has been chosen — there is no CSS answer then", () => {
    const layers = getShellBackgroundLayers(background({ mode: "video", videoUrl: "/clip.mp4" }), undefined);
    expect(layers.video?.videoUrl).toBe("/clip.mp4");
    expect(layers.inlineBackground).toBeUndefined();
    expect(layers.backdrop).toBeUndefined();
  });

  it("reports no video for a half-filled setting — mode video with no clip picked yet", () => {
    expect(getShellBackgroundLayers(background({ mode: "video" }), undefined).video).toBeUndefined();
  });

  it("reports no video for every other mode", () => {
    for (const mode of ["none", "color", "gradient", "image", "style"] as const) {
      expect(getShellBackgroundLayers(background({ mode }), undefined).video).toBeUndefined();
    }
  });
});

describe("the page video layer", () => {
  it("is mounted by the viewport shell, marked as the page surface", () => {
    const markup = shell(VIDEO);
    expect(markup).toContain('data-builder-video-background="page"');
    expect(markup).toContain("builder-preview-video-background-page");
    expect(markup).toContain('src="/api/admin/media-file/clip.mp4"');
  });

  it("keeps the poster painted on the shell itself, which is the phone fallback", () => {
    expect(shell(VIDEO)).toContain("poster.jpg");
  });

  it("cannot swallow a click or be read out — it is decoration behind the page", () => {
    const markup = shell(VIDEO);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('tabindex="-1"');
  });

  it("marks the shell so the layer's geometry has something to hang on", () => {
    expect(shell(VIDEO)).toContain("has-shell-background-video");
    expect(shell(background({ mode: "color", color: "#123456" }))).not.toContain(
      "has-shell-background-video"
    );
  });

  it("is absent for a page with no video, which is every page that exists today", () => {
    const markup = shell(background({ mode: "color", color: "#123456" }));
    expect(markup).not.toContain("builder-preview-video-background");
    expect(markup).toContain("page content");
  });
});
