import { useEffect, useRef, useState } from "react";
import type { BackgroundSettings } from "@/lib/builder-template";
import { builderVideoBackgroundPosition } from "@/lib/builder-template";

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  const videoUrl = background.videoUrl ?? "";
  const posterUrl = background.posterUrl ?? "";
  const speed = background.videoSpeed ?? 1;
  const shouldLoop = background.videoLoop !== false;
  const trimStart = background.videoTrimStart ?? 0;
  const trimEnd = background.videoTrimEnd ?? 0;
  const blur = background.videoBlur ?? 0;

  const playbackAllowed = useVideoPlaybackAllowed(background.videoPlayOnMobile === true);

  /*
   * The native `loop` attribute always restarts at zero, so it is only correct
   * when the clip is untrimmed. With a trim it would jump back past the start
   * point and play the part the operator cut off — so trimming takes the
   * manual path below instead, and the attribute stays off.
   */
  const isTrimmed = trimStart > 0 || trimEnd > 0;
  const useNativeLoop = shouldLoop && !isTrimmed;

  // Playback rate is not an attribute. It has to be set on the element, and it
  // is reset by a source change, so it is reapplied whenever either moves.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
  }, [speed, videoUrl, playbackAllowed]);

  // Seek to the trim point once the browser knows how long the clip is.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || trimStart <= 0) return;

    const seekToStart = () => {
      if (video.currentTime < trimStart) {
        video.currentTime = trimStart;
      }
    };

    if (video.readyState >= 1) {
      seekToStart();
    }
    video.addEventListener("loadedmetadata", seekToStart);
    return () => video.removeEventListener("loadedmetadata", seekToStart);
  }, [trimStart, videoUrl, playbackAllowed]);

  // The trim window: come back to the start at the out point, or stop there.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isTrimmed) return;

    const enforceWindow = () => {
      const end = trimEnd > 0 ? trimEnd : video.duration;
      if (!Number.isFinite(end) || video.currentTime < end) return;

      if (shouldLoop) {
        video.currentTime = trimStart;
        void video.play().catch(() => {
          // Autoplay can be refused; the poster underneath is the answer.
        });
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
  }, [isTrimmed, trimStart, trimEnd, shouldLoop, videoUrl, playbackAllowed]);

  /*
   * Pause while off screen. Not a setting and never will be: nobody would turn
   * it off, and decoding video nobody is looking at costs battery on every
   * device that scrolls past the section.
   */
  useEffect(() => {
    const video = videoRef.current;
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
    const video = videoRef.current;
    if (!video) return;

    if (isVisible) {
      void video.play().catch(() => {
        // A refused autoplay is not an error worth surfacing — the poster is
        // already painted behind this element and reads as intended.
      });
    } else {
      video.pause();
    }
  }, [isVisible, videoUrl, playbackAllowed]);

  // Nothing to play, or not allowed to. Render nothing and let the poster the
  // surrounding surface already painted stand as the answer.
  if (!videoUrl || !playbackAllowed) {
    return null;
  }

  return (
    <video
      aria-hidden="true"
      autoPlay
      className={`builder-preview-video-background builder-preview-video-background-${surface}`}
      data-builder-video-background={surface}
      loop={useNativeLoop}
      muted
      playsInline
      poster={posterUrl || undefined}
      preload="metadata"
      ref={videoRef}
      src={videoUrl}
      style={{
        objectPosition: builderVideoBackgroundPosition(background),
        ...(blur > 0
          ? {
              filter: `blur(${blur}px)`,
              transform: `scale(${blurCompensationScale(blur)})`
            }
          : {})
      }}
      tabIndex={-1}
    />
  );
}
