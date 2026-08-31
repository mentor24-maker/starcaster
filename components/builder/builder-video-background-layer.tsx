import { useCallback, useEffect, useRef, useState } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
import {
  builderVideoBackgroundPosition,
  builderVideoCrossfades,
  resolveBuilderVideoLoopFade
} from "@/lib/builder-template";

/**
 * The one video-background layer. Section rows use it today; the page
 * background and cell backgrounds are meant to use THIS component rather than
 * grow copies of it, because two implementations of "pause when off screen" or
 * "honour reduce motion" would drift apart silently and only one of them would
 * ever get fixed.
 *
 * What it deliberately does NOT do is render a poster. A video background
 * already reports its poster as an ordinary CSS background image
 * (`getBuilderBackgroundStyle`), which the surrounding surface has painted
 * before this component is reached. So "show the still instead" is expressed
 * here as rendering nothing at all, and the still is simply what was already
 * there. That is why the fallback cannot get out of step with the real thing.
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

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isPhoneWidth(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(`(max-width: ${BUILDER_VIDEO_MOBILE_MAX_WIDTH}px)`).matches;
}

/**
 * Watch both media queries and answer the only question the layer cares about:
 * may this video play at all? Re-answered when either query changes, so
 * switching Reduce Motion on, or narrowing the window to phone width, swaps to
 * the still while the operator watches rather than on the next reload.
 */
function useVideoPlaybackAllowed(playOnMobile: boolean): boolean {
  const [allowed, setAllowed] = useState<boolean>(() => !prefersReducedMotion() && (playOnMobile || !isPhoneWidth()));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const phoneQuery = window.matchMedia(`(max-width: ${BUILDER_VIDEO_MOBILE_MAX_WIDTH}px)`);

    const update = () => {
      setAllowed(!motionQuery.matches && (playOnMobile || !phoneQuery.matches));
    };

    update();
    motionQuery.addEventListener("change", update);
    phoneQuery.addEventListener("change", update);

    return () => {
      motionQuery.removeEventListener("change", update);
      phoneQuery.removeEventListener("change", update);
    };
  }, [playOnMobile]);

  return allowed;
}

type BuilderVideoBackgroundLayerProps = {
  background: BackgroundSettings;
  /** Marks which surface mounted it, for the render contracts and for CSS. */
  surface?: "section" | "page" | "cell";
};

export function BuilderVideoBackgroundLayer({
  background,
  surface = "section"
}: BuilderVideoBackgroundLayerProps) {
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

  const playbackAllowed = useVideoPlaybackAllowed(background.videoPlayOnMobile === true);
  const crossfades = builderVideoCrossfades(background);

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

  // Nothing to play, or not allowed to. Render nothing and let the poster the
  // surrounding surface already painted stand as the answer. The crossfade
  // does not get an exemption here: two elements nobody may see is worse than
  // one.
  if (!videoUrl || !playbackAllowed) {
    return null;
  }

  const requestedFade = resolveBuilderVideoLoopFade(background, 0);

  function videoStyle(isLead: boolean) {
    return {
      objectPosition: builderVideoBackgroundPosition(background),
      ...(crossfades
        ? {
            opacity: isLead ? 1 : 0,
            transition: `opacity ${requestedFade}s linear`
          }
        : {}),
      ...(blur > 0
        ? {
            filter: `blur(${blur}px)`,
            transform: `scale(${blurCompensationScale(blur)})`
          }
        : {})
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
