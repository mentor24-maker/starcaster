import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
import {
  builderBackgroundParallaxActive,
  builderBackgroundParallaxSpeed,
  builderVideoBackgroundPosition,
  builderVideoCrossfades,
  resolveBuilderVideoLoopFade
} from "@/lib/builder-template";
import { backgroundImageUrlFor } from "@/lib/image-renditions";
import { backgroundParallaxGeometry } from "@/lib/background-parallax";

/**
 * THE ONE BACKGROUND LAYER. Section rows use it today; the page background and
 * cell backgrounds are meant to use THIS component rather than grow copies of
 * it, because two implementations of "pause when off screen" or "honour reduce
 * motion" would drift apart silently and only one of them would ever get fixed.
 *
 * It was `BuilderVideoBackgroundLayer` until parallax shipped (2026-08-31,
 * 86bbqazxv). An IMAGE background is painted as CSS on the surface itself and
 * needed no element — until it had to translate, which CSS on the surface
 * cannot do. So the same argument that put page and cell backgrounds here put
 * images here: one layer that can move, used by image and video alike, rather
 * than a video parallax and an image parallax that only one person ever
 * remembers to fix. The <video> element's own class names and data attributes
 * are untouched by the rename, so every render contract written against them
 * still means exactly what it meant.
 *
 * What it deliberately does NOT do is render a poster. A video background
 * already reports its poster as an ordinary CSS background image
 * (`getBuilderBackgroundStyle`), which the surrounding surface has painted
 * before this component is reached. So "show the still instead" is expressed
 * here as rendering nothing at all, and the still is simply what was already
 * there. That is why the fallback cannot get out of step with the real thing.
 *
 * The IMAGE layer works the same way and for the same reason: the surface has
 * already painted the picture as an ordinary CSS background, so this layer
 * paints the identical picture ON TOP of it and translates that. Nothing is
 * stripped from the surface. That is what makes acceptance criterion 5 true
 * without a second code path — with JavaScript off, this component never
 * mounts and the static background underneath is simply what the visitor sees.
 */

/**
 * Phone width. Matches the breakpoint the generated builder stylesheet already
 * compacts cells at, so "this is a phone" means the same thing in the layout
 * and in the decision to spend someone's cell data on a video.
 */
export const BUILDER_VIDEO_MOBILE_MAX_WIDTH = 560;

/**
 * Blurring an element leaves a soft, semi-transparent rim about twice the blur
 * radius wide. Scaling up pushes that rim outside the section, which is
 * clipping it, so the operator sees blurred footage rather than a fogged edge.
 */
function blurCompensationScale(blur: number): number {
  return blur > 0 ? 1 + blur * 0.02 : 1;
}

/**
 * Exported because the parallax hook below needs the same answer, and the
 * ticket that added it said so in as many words: use this, do not write a
 * second one. Two readings of a media query is how "reduce motion" ends up
 * honoured by the video and ignored by the drift over it.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The three numbers the parallax layers read, written on the SECTION rather
 * than on each layer.
 *
 * One write per frame covers the whole stack — the leading video, the trailing
 * copy of a crossfade, and the image layer all inherit from the same custom
 * properties — and it survives React re-rendering, because React only writes
 * back the style properties it knows about from the style prop and leaves
 * imperatively-set custom properties alone. Writing the transform straight
 * onto each element instead would be clobbered by the next render of
 * `videoStyle`, which is exactly the kind of bug that shows up as "parallax
 * stops when you change a setting".
 */
const PARALLAX_VAR_TOP = "--builder-parallax-top";
const PARALLAX_VAR_HEIGHT = "--builder-parallax-height";
const PARALLAX_VAR_Y = "--builder-parallax-y";

/**
 * The one loop. Measures the section, asks the driver for the geometry, writes
 * three numbers, and does nothing else — every decision that is arithmetic
 * lives in `lib/builder-client/background-parallax.ts` where it can be unit
 * tested, because nothing in this repo tests CSS.
 *
 * requestAnimationFrame rather than a scroll listener: a scroll handler fires
 * out of step with painting, which reads as the background juddering a frame
 * behind the text. And it STOPS when the section leaves the screen, on the
 * same reasoning as the video layer's own pause — measuring and writing
 * styles sixty times a second for a band nobody is looking at is battery
 * spent on nothing, on every page that scrolls past it.
 */
function useBackgroundParallax(
  anchor: { current: HTMLElement | null },
  speed: number,
  enabled: boolean
): void {
  useEffect(() => {
    const node = anchor.current;
    if (!enabled || !node || typeof window === "undefined") return;

    // The layer is absolutely positioned against its section, so the section
    // is its offset parent — but `parentElement` is the honest question here:
    // this layer is always a direct child of the surface that mounted it.
    const section = node.parentElement;
    if (!section) return;

    let frame: number | null = null;
    let visible = true;

    const paint = () => {
      const rect = section.getBoundingClientRect();
      const geometry = backgroundParallaxGeometry({
        sectionTop: rect.top,
        sectionHeight: rect.height,
        viewportHeight: window.innerHeight,
        speed
      });
      section.style.setProperty(PARALLAX_VAR_TOP, `${geometry.inset}px`);
      section.style.setProperty(PARALLAX_VAR_HEIGHT, `${geometry.height}px`);
      section.style.setProperty(PARALLAX_VAR_Y, `${geometry.offset}px`);
    };

    const tick = () => {
      paint();
      frame = visible ? window.requestAnimationFrame(tick) : null;
    };

    // Painted once BEFORE the first frame is asked for. Without this the layer
    // renders one frame at its untranslated size — a visible jump on a section
    // the visitor has already scrolled to, which is every section reached by a
    // link with a #fragment in it.
    paint();
    frame = window.requestAnimationFrame(tick);

    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (!entry) return;
              visible = entry.isIntersecting;
              if (visible && frame === null) {
                paint();
                frame = window.requestAnimationFrame(tick);
              }
            },
            { threshold: 0 }
          )
        : null;
    observer?.observe(section);

    return () => {
      visible = false;
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      // Cleared, not left at their last value: a section that stops
      // parallaxing — the operator turns it off, or switches the mode — would
      // otherwise keep a stale offset and render permanently nudged.
      section.style.removeProperty(PARALLAX_VAR_TOP);
      section.style.removeProperty(PARALLAX_VAR_HEIGHT);
      section.style.removeProperty(PARALLAX_VAR_Y);
    };
  }, [anchor, enabled, speed]);
}

/**
 * The layer's size and position while it is parallaxing.
 *
 * `bottom: auto` is not tidying. The stylesheet gives every layer `inset: 0`,
 * so bottom is pinned to the section's own bottom edge; with an explicit
 * height as well the box is over-constrained, and leaving it to the
 * over-constraint rules to pick a winner is the kind of thing that behaves
 * differently the day someone changes the stylesheet.
 */
function parallaxBoxStyle(active: boolean): CSSProperties {
  if (!active) return {};
  return {
    top: `var(${PARALLAX_VAR_TOP}, 0px)`,
    bottom: "auto",
    height: `var(${PARALLAX_VAR_HEIGHT}, 100%)`,
    willChange: "transform"
  };
}

/** The translate, composed with whatever transform the layer already wanted. */
function parallaxTransform(active: boolean, existing: string): string {
  if (!active) return existing;
  const translate = `translate3d(0, var(${PARALLAX_VAR_Y}, 0px), 0)`;
  return existing ? `${translate} ${existing}` : translate;
}

function isPhoneWidth(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(`(max-width: ${BUILDER_VIDEO_MOBILE_MAX_WIDTH}px)`).matches;
}

/**
 * Reduce Motion, live. Split out of `useVideoPlaybackAllowed` when parallax
 * arrived, because the drift has to honour the same answer the video does and
 * a second reading of the same media query is precisely how one of them ends
 * up honoured and the other quietly not.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

/**
 * May this video play at all? Re-answered when either condition changes, so
 * switching Reduce Motion on, or narrowing the window to phone width, swaps to
 * the still while the operator watches rather than on the next reload.
 */
function useVideoPlaybackAllowed(playOnMobile: boolean, reducedMotion: boolean): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(isPhoneWidth);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(`(max-width: ${BUILDER_VIDEO_MOBILE_MAX_WIDTH}px)`);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return !reducedMotion && (playOnMobile || !isPhone);
}

type BuilderBackgroundLayerProps = {
  background: BackgroundSettings;
  /** Marks which surface mounted it, for the render contracts and for CSS. */
  surface?: "section" | "page" | "cell";
};

export function BuilderBackgroundLayer({
  background,
  surface = "section"
}: BuilderBackgroundLayerProps) {
  /*
   * TWO elements, because one video cannot dissolve into itself: seeking back
   * to the start is a single discontinuous jump with nothing to fade into.
   * The pair take turns — as the leading copy nears its out point, the
   * trailing one starts from the in point and fades up over it. Only `videoA`
   * is rendered when the fade is off, so a hard cut costs exactly what it did
   * before this existed.
   */
  const videoA = useRef<HTMLVideoElement | null>(null);
  const videoB = useRef<HTMLVideoElement | null>(null);
  const imageLayer = useRef<HTMLDivElement | null>(null);
  const [leadIsA, setLeadIsA] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  // Guards the handoff: `timeupdate` fires many times inside the fade window,
  // and without this every one of them would restart the dissolve.
  const handingOff = useRef(false);

  const videoUrl = background.videoUrl ?? "";
  const posterUrl = background.posterUrl ?? "";
  const speed = background.videoSpeed ?? 1;
  const shouldLoop = background.videoLoop !== false;
  const trimStart = background.videoTrimStart ?? 0;
  const trimEnd = background.videoTrimEnd ?? 0;
  const blur = background.videoBlur ?? 0;

  const reducedMotion = useReducedMotion();
  const playbackAllowed = useVideoPlaybackAllowed(background.videoPlayOnMobile === true, reducedMotion);
  const crossfades = builderVideoCrossfades(background);

  /*
   * PARALLAX. `builderBackgroundParallaxSpeed` returns the inert speed for
   * both "off" and "reduce motion", so those are one code path rather than two
   * — at the inert speed the overscan and the offset are both exactly zero and
   * the layer sits precisely where the surface's own CSS background already
   * is. `parallaxLive` still gates the loop as well, so a section that is not
   * parallaxing does not pay for a requestAnimationFrame that computes zero.
   *
   * An IMAGE parallax runs on PHONES, unlike the video itself. A translate is
   * cheap and costs no extra bytes, and the reason video falls back on a phone
   * — the megabytes — does not apply to moving a picture that has already
   * loaded. A VIDEO parallax does not run there unless Play On Phones is on,
   * because with it off there is no <video> element to translate and the still
   * is what the visitor sees. The panel says which is which, because a control
   * that is silently dead on half the devices is worse than one that is
   * honestly absent.
   */
  const parallaxLive = builderBackgroundParallaxActive(background) && !reducedMotion;
  const parallaxSpeed = builderBackgroundParallaxSpeed(background, reducedMotion);
  const parallaxAnchor = background.mode === "image" ? imageLayer : videoA;
  /*
   * IS THE ANCHOR ACTUALLY ON THE PAGE? The effect below reads `anchor.current`
   * and gives up when it is null — but a ref object is stable, so an element
   * that mounts LATER changes none of the effect's dependencies and the loop
   * never starts. That is a real window: a video is not rendered below phone
   * width unless Play On Phones is on, so loading a parallaxing video row in a
   * narrow window and then widening it inserted a <video> carrying every
   * parallax inline style with nothing writing the custom properties behind
   * them — every var() fell back and it sat perfectly still. Folding "is it
   * rendered" into the flag the effect already depends on is what turns the
   * mount into a dependency change. (Review of #481, 2026-08-31.)
   */
  const parallaxAnchorRendered =
    background.mode === "image"
      ? parallaxLive && Boolean(background.imageUrl)
      : Boolean(videoUrl) && playbackAllowed;
  useBackgroundParallax(parallaxAnchor, parallaxSpeed, parallaxLive && parallaxAnchorRendered);

  /*
   * The native `loop` attribute always restarts at zero, so it is only correct
   * when the clip is untrimmed. With a trim it would jump back past the start
   * point and play the part the operator cut off — and in crossfade mode it
   * would restart the leading copy underneath a dissolve that is already
   * running. Both cases take the manual path below instead.
   */
  const isTrimmed = trimStart > 0 || trimEnd > 0;
  const useNativeLoop = shouldLoop && !isTrimmed && !crossfades;

  /** The playing window of whichever element is asking. */
  const windowFor = useCallback(
    (video: HTMLVideoElement) => {
      const end = trimEnd > 0 ? trimEnd : video.duration;
      return Number.isFinite(end) ? Math.max(0, end - trimStart) : 0;
    },
    [trimEnd, trimStart]
  );

  const startAt = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) return;
      video.playbackRate = speed;
      if (trimStart > 0 || crossfades) {
        video.currentTime = trimStart;
      }
      void video.play().catch(() => {
        // A refused autoplay is not an error worth surfacing — the poster is
        // already painted behind this element and reads as intended.
      });
    },
    [crossfades, speed, trimStart]
  );

  // Playback rate is not an attribute. It has to be set on the element, and it
  // is reset by a source change, so it is reapplied whenever either moves.
  useEffect(() => {
    for (const ref of [videoA, videoB]) {
      if (ref.current) ref.current.playbackRate = speed;
    }
  }, [speed, videoUrl, playbackAllowed, crossfades]);

  // Seek the leading copy to the trim point once the browser knows the length.
  useEffect(() => {
    const video = videoA.current;
    if (!video || trimStart <= 0) return;

    const seekToStart = () => {
      if (video.currentTime < trimStart) video.currentTime = trimStart;
    };

    if (video.readyState >= 1) seekToStart();
    video.addEventListener("loadedmetadata", seekToStart);
    return () => video.removeEventListener("loadedmetadata", seekToStart);
  }, [trimStart, videoUrl, playbackAllowed]);

  /*
   * THE HANDOFF. Watches whichever copy is leading and, one fade-length before
   * its out point, starts the other from the in point and swaps which one is
   * opaque. The CSS transition does the dissolve; this only decides when.
   */
  useEffect(() => {
    if (!crossfades || !playbackAllowed) return;

    const lead = leadIsA ? videoA.current : videoB.current;
    const follower = leadIsA ? videoB.current : videoA.current;
    if (!lead || !follower) return;

    const onTime = () => {
      if (handingOff.current) return;

      const end = trimEnd > 0 ? trimEnd : lead.duration;
      if (!Number.isFinite(end)) return;

      const fade = resolveBuilderVideoLoopFade(background, windowFor(lead));
      if (fade <= 0) return;

      if (lead.currentTime < end - fade) return;

      handingOff.current = true;
      startAt(follower);
      setLeadIsA((current) => !current);

      // Rewind the outgoing copy only AFTER it has finished fading out —
      // seeking it while it is still visible is the very jump this replaces.
      window.setTimeout(() => {
        lead.pause();
        lead.currentTime = trimStart;
        handingOff.current = false;
      }, fade * 1000);
    };

    lead.addEventListener("timeupdate", onTime);
    lead.addEventListener("ended", onTime);
    return () => {
      lead.removeEventListener("timeupdate", onTime);
      lead.removeEventListener("ended", onTime);
    };
  }, [background, crossfades, leadIsA, playbackAllowed, startAt, trimEnd, trimStart, windowFor]);

  /*
   * The single-element trim window, for when there is no crossfade: come back
   * to the start at the out point, or stop there.
   */
  useEffect(() => {
    if (crossfades) return;
    const video = videoA.current;
    if (!video || !isTrimmed) return;

    const enforceWindow = () => {
      const end = trimEnd > 0 ? trimEnd : video.duration;
      if (!Number.isFinite(end) || video.currentTime < end) return;

      if (shouldLoop) {
        video.currentTime = trimStart;
        void video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    video.addEventListener("timeupdate", enforceWindow);
    video.addEventListener("ended", enforceWindow);
    return () => {
      video.removeEventListener("timeupdate", enforceWindow);
      video.removeEventListener("ended", enforceWindow);
    };
  }, [crossfades, isTrimmed, trimStart, trimEnd, shouldLoop, videoUrl, playbackAllowed]);

  /*
   * Pause while off screen. Not a setting and never will be: nobody would turn
   * it off, and decoding video nobody is looking at costs battery on every
   * device that scrolls past the section — twice over, once the clip is
   * running as a crossfading pair.
   */
  useEffect(() => {
    const video = videoA.current;
    if (!video || typeof IntersectionObserver !== "function") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, [videoUrl, playbackAllowed]);

  useEffect(() => {
    const lead = leadIsA ? videoA.current : videoB.current;
    if (!lead) return;

    if (isVisible) {
      void lead.play().catch(() => {
        // A refused autoplay is not an error worth surfacing — the poster is
        // already painted behind this element and reads as intended.
      });
    } else {
      videoA.current?.pause();
      videoB.current?.pause();
    }
  }, [isVisible, leadIsA, videoUrl, playbackAllowed]);

  /*
   * THE IMAGE LAYER, which exists only to parallax.
   *
   * An image background is a CSS background on the surface itself and always
   * has been; it needs no element to be a picture, only to MOVE. So this
   * branch renders nothing at all unless parallax is live, which is what makes
   * "parallax off" byte-identical to the day before this shipped — there is no
   * extra element, no extra stacking context, nothing to render differently.
   *
   * It paints the same picture the surface already painted, on top of it. That
   * looks like double work and is the point: with JavaScript off this
   * component never mounts, and what the visitor gets is the ordinary static
   * background that was always there (acceptance criterion 5). Nothing had to
   * be stripped from the surface, so there is no second code path to keep in
   * step.
   */
  if (background.mode === "image") {
    if (!parallaxLive || !background.imageUrl) {
      return null;
    }
    return (
      <div
        aria-hidden
        className={`builder-preview-image-background builder-preview-image-background-${surface}`}
        data-builder-image-background={surface}
        data-builder-parallax="on"
        ref={imageLayer}
        style={{
          // A CSS background cannot carry a srcset, so it takes the widest
          // copy instead — the same bargain getBuilderBackgroundStyle makes.
          backgroundImage: `url("${backgroundImageUrlFor(background.imageUrl)}")`,
          ...parallaxBoxStyle(true),
          transform: parallaxTransform(true, "")
        }}
      />
    );
  }

  // Nothing to play, or not allowed to. Render nothing and let the poster the
  // surrounding surface already painted stand as the answer. The crossfade
  // does not get an exemption here: two elements nobody may see is worse than
  // one.
  if (!videoUrl || !playbackAllowed) {
    return null;
  }

  const requestedFade = resolveBuilderVideoLoopFade(background, 0);

  function videoStyle(isLead: boolean): CSSProperties {
    /*
     * The blur compensation is a scale, and parallax is a translate, so the
     * two have to share one `transform` — a second transform property would
     * simply win and silently drop the other. Translate first: transforms
     * apply right to left, so scaling first and then translating keeps the
     * offset in real pixels rather than in scaled ones.
     */
    const scale = blur > 0 ? `scale(${blurCompensationScale(blur)})` : "";
    const transform = parallaxTransform(parallaxLive, scale);

    return {
      objectPosition: builderVideoBackgroundPosition(background),
      ...(crossfades
        ? {
            opacity: isLead ? 1 : 0,
            transition: `opacity ${requestedFade}s linear`
          }
        : {}),
      ...(blur > 0 ? { filter: `blur(${blur}px)` } : {}),
      ...(transform ? { transform } : {}),
      ...parallaxBoxStyle(parallaxLive)
    };
  }

  const shared = {
    "aria-hidden": true as const,
    className: `builder-preview-video-background builder-preview-video-background-${surface}`,
    loop: useNativeLoop,
    muted: true,
    playsInline: true,
    poster: posterUrl || undefined,
    preload: "metadata" as const,
    src: videoUrl,
    tabIndex: -1
  };

  return (
    <>
      <video
        {...shared}
        autoPlay
        data-builder-video-background={surface}
        data-builder-video-role="lead"
        ref={videoA}
        style={videoStyle(leadIsA)}
      />
      {crossfades ? (
        <video
          {...shared}
          data-builder-video-background={surface}
          data-builder-video-role="follow"
          ref={videoB}
          style={videoStyle(!leadIsA)}
        />
      ) : null}
    </>
  );
}
