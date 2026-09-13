import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderBackgroundControls } from "./builder-background-controls";
import { createDefaultBackgroundSettings, normalizeBackgroundSettings } from "@/lib/builder-template";
import { rememberAssetByteSize } from "@/lib/background-video-size";

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

/**
 * THE FILE SIZE ADVICE.
 *
 * A background video autoplays before anything else on the page finishes, and
 * the gallery shows the operator a name and a thumbnail — never a weight. So
 * he can pick a 34MB clip for a client's hero section with nothing anywhere
 * telling him what he just did.
 *
 * These mount the real panel and read what it actually renders, because the
 * threshold arithmetic is already covered next door in
 * `lib/builder-client/background-video-size.test.ts` and passing that proves
 * only that a pure function is right — not that a single character of it
 * reaches a screen. The two halves fail independently: a correct notice that
 * the panel never asks for renders nothing at all, and that is the bug worth
 * catching here.
 */
describe("the background video's file size", () => {
  const MB = 1000 * 1000;

  function panelWithVideo(path: string, videoBytes?: number) {
    return html({
      allowVideo: true,
      background: normalizeBackgroundSettings({
        mode: "video",
        videoUrl: path,
        posterUrl: "/assets/still.jpg",
        ...(videoBytes === undefined ? {} : { videoBytes })
      })
    });
  }

  it("warns in plain words, naming the real size, when the video is over 10MB", () => {
    const markup = panelWithVideo("/assets/heavy-hero.mp4", 34 * MB);

    expect(markup).toContain("This video is 34 MB.");
    expect(markup).toContain("Visitors on phone data will wait several seconds for it.");
    expect(markup).toContain("Under 10MB is a comfortable size for a background.");
    expect(markup).toContain('data-oversized="true"');
  });

  it("shows the size but no warning when the video is a comfortable size", () => {
    const markup = panelWithVideo("/assets/light-hero.mp4", 4 * MB);

    expect(markup).toContain("4.0 MB");
    expect(markup).not.toContain("Visitors on phone data");
    expect(markup).toContain('data-oversized="false"');
  });

  it("says nothing at all when the size is unknown", () => {
    const markup = panelWithVideo("/assets/typed-in-by-hand.mp4");

    expect(markup).not.toContain("builder-video-background-size");
    expect(markup).not.toContain("Visitors on phone data");
  });

  /*
   * Advice, not a gate. Nothing about an oversized video may disable a
   * control or change what is stored — the operator overrules this whenever
   * he has a reason to, and a warning that quietly took the controls away
   * would be a much worse bug than the one it is warning about.
   */
  it("disables nothing and changes no other control when it warns", () => {
    const warned = panelWithVideo("/assets/heavy-hero-2.mp4", 50 * MB);
    const quiet = panelWithVideo("/assets/no-size-known.mp4");

    expect(warned).not.toContain("disabled");
    for (const control of ["Choose Video", "Choose Poster", "Speed", "Blur", "Play On Phones"]) {
      expect(warned).toContain(control);
      expect(quiet).toContain(control);
    }
  });

  it("names the size in both layouts, so the two forms cannot drift", () => {
    const background = normalizeBackgroundSettings({
      mode: "video",
      videoUrl: "/assets/heavy-hero-3.mp4",
      posterUrl: "/assets/still.jpg",
      videoBytes: 34 * MB
    });

    expect(html({ allowVideo: true, background })).toContain("This video is 34 MB.");
    expect(html({ allowVideo: true, horizontal: true, background })).toContain("This video is 34 MB.");
  });

  /*
   * The stored size is what makes this survive a reload — a page built in
   * March has to still say its hero video is 34MB. Without it the number
   * exists only in the session that picked the file, which is the difference
   * between a warning and a flash.
   */
  it("reads the size stored on the page, with no gallery opened at all", () => {
    expect(panelWithVideo("/assets/never-in-any-gallery.mp4", 34 * MB)).toContain("This video is 34 MB.");
  });

  /*
   * The fallback, for every page that predates the stored field: nothing is
   * on the row, but this session has loaded the gallery, so the size is known.
   */
  it("falls back to the gallery's size for a page saved before the field existed", () => {
    rememberAssetByteSize("/assets/legacy-hero.mp4", 34 * MB);
    expect(panelWithVideo("/assets/legacy-hero.mp4")).toContain("This video is 34 MB.");
  });
});
