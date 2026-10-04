"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  createGalaxyProjection,
  createGalaxyView,
  dragGalaxyView,
  galaxyDisperseOpacity,
  galaxyIntroProgress,
  galaxyScrollDisperse,
  generateGalaxyField,
  projectGalaxyField,
  readDeviceTier,
  readGalaxyMotion,
  readGalaxySettings,
  resolveGalaxyInteraction,
  scaleGalaxyCount,
  stepGalaxyField,
  stepGalaxyView,
  stepGalaxyViewByKey,
  tiltGalaxyView,
  type GalaxyMix
} from "@/lib/galaxy-field";
import {
  assignGalaxyColours,
  buildGalaxySprites,
  drawGalaxyFrame,
  readGalaxyLook,
  type GalaxySpriteCanvas
} from "@/lib/galaxy-render";
import { proximityIsInline, proximityZIndex } from "@/lib/effect-placement";

export type GalaxyModuleSettings = Record<string, string>;

/**
 * The Galaxy module — a spiral of stars that slowly turns and twinkles.
 *
 * Every number lives elsewhere and is tested there: where each star sits and
 * how it moves in `lib/builder-client/galaxy-field.ts`, how a frame is painted
 * in `lib/builder-client/galaxy-render.ts`. This file owns only the canvas,
 * its size, and when frames are drawn. Read docs/GALAXY.md first.
 *
 * ONE PAINTER. `GalaxyCardPreview` and `GalaxyRuntime` both paint through
 * `drawGalaxyFrame` and nothing else in this file draws a star — a test reads
 * this file to hold that. TractorNav's card and page had separate drawing code
 * and disagreed on live sites for two months while the card looked right.
 */

/** The card is a still of this many stars: enough to read as a spiral, cheap enough for a panel of cards. */
export const GALAXY_CARD_STARS = 600;
const CARD_HEIGHT_PX = 180;

/** Frames further apart than this are treated as this far apart, so a stall never makes the galaxy jump. */
const MAX_FRAME_SECONDS = 0.05;

/**
 * The document event that restarts the intro on every galaxy on the page.
 * The Builder's "Replay intro" button dispatches it; nothing on a live page
 * does (Galaxy module 4/6).
 */
export const GALAXY_REPLAY_EVENT = "galaxy:replay";

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function readReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Retina is sharp at 2×; a phone pays for every pixel, so it stops at 1.5×. */
function cappedPixelRatio(): number {
  const raw = typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  const cap = typeof window !== "undefined" && window.innerWidth < 768 ? 1.5 : 2;
  return Math.max(1, Math.min(cap, raw || 1));
}

function makeSpriteCanvas(width: number, height: number): GalaxySpriteCanvas {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** A stable key for "the settings changed", so the effects below re-run on a change and never on a re-render. */
function settingsKey(settings: GalaxyModuleSettings): string {
  return JSON.stringify(settings ?? {});
}

// ── Card preview: one still frame ─────────────────────────────

export function GalaxyCardPreview({ settings }: { settings: GalaxyModuleSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const key = settingsKey(settings);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.clientWidth || 320;
    const height = CARD_HEIGHT_PX;
    const ratio = cappedPixelRatio();
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const stars = readGalaxySettings({ ...settings, particleCount: String(GALAXY_CARD_STARS) });
    const look = readGalaxyLook(settings);
    const field = generateGalaxyField(stars);
    const projection = projectGalaxyField(field, 0, 0, width, height, createGalaxyProjection(field.count));
    const colourOf = assignGalaxyColours(field.count, look.weights, stars.seed, Math.min(field.count, stars.flareStars));
    drawGalaxyFrame(ctx, { field, projection, colourOf, width, height }, look, buildGalaxySprites(look, ratio, makeSpriteCanvas));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="builder-galaxy-card" style={{ width: "100%", padding: "8px 0" }}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-galaxy-card="true"
        style={{ display: "block", width: "100%", height: CARD_HEIGHT_PX, borderRadius: 6 }}
      />
    </div>
  );
}

// ── Runtime: the animated page version ────────────────────────

export function GalaxyRuntime({
  settings,
  liveSite = false,
  builderNote
}: {
  settings: GalaxyModuleSettings;
  liveSite?: boolean;
  /**
   * Renders the "fewer stars than asked" note. Passed in by the page renderer
   * so the note goes through its `BuilderOnlyNote`, which renders nothing on a
   * published page; this component also never calls it when `liveSite` is set.
   */
  builderNote?: (shown: number, asked: number) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /*
   * The frame counter lives in a ref, not in the effect, so it keeps counting
   * up across a settings change. That is what proves a slider redraws the
   * canvas WITHOUT remounting it: a remount would start a new canvas at 0.
   */
  const frameRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /*
   * Where the visitor has turned the galaxy to. A ref for the same reason as
   * the frame counter: a settings change re-runs the effect below, and the
   * galaxy should stay where it was turned rather than snap back to face-on.
   */
  const viewRef = useRef(createGalaxyView());
  /*
   * When the intro started, on the frame clock. A ref for the same reason
   * again: a settings change re-runs the effect, and dragging a slider in the
   * Builder must not fly every star back out to the edges. Only a mount and
   * "Replay intro" set it.
   */
  const introStartRef = useRef<number | null>(null);
  const [reduced, setReduced] = useState(readReducedMotion);
  const [canvasFailed, setCanvasFailed] = useState(false);
  const [shortfall, setShortfall] = useState<{ shown: number; asked: number } | null>(null);

  const inline = proximityIsInline(settings.placement);
  const zIndex = proximityZIndex(Number.parseInt(settings.zIndex ?? "-9999", 10), settings.placement);
  const blockHeight = clampInt(settings.height, 480, 120, 2000);
  const posX = Number.parseInt(settings.posX ?? "0", 10) || 0;
  const posY = Number.parseInt(settings.posY ?? "0", 10) || 0;
  const posterUrl = (settings.posterUrl ?? "").trim();
  const showPoster = Boolean(posterUrl) && (reduced || canvasFailed);
  const key = settingsKey(settings);
  // `rotate` exists only In Place and `tilt` only in a Window; a stored value
  // the placement does not offer runs as that placement's default.
  const interaction = resolveGalaxyInteraction(inline, settings.interaction);
  const showDragSurface = inline && interaction === "rotate" && !showPoster;

  // Reduced motion is LISTENED for: a visitor who switches it on mid-visit
  // gets the still frame now, not on their next page load.
  useEffect(() => {
    let query: MediaQueryList | null = null;
    try {
      query = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const onChange = () => setReduced(query?.matches ?? false);
    query.addEventListener?.("change", onChange);
    return () => query?.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || showPoster) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCanvasFailed(true);
      return;
    }
    if (!canvas.hasAttribute("data-galaxy-frame")) canvas.setAttribute("data-galaxy-frame", "0");

    const stars = readGalaxySettings(settings);
    const look = readGalaxyLook(settings);
    const motion = readGalaxyMotion(settings);
    // What a frame is drawn with: the look, faded while the field disperses.
    // One object for the whole effect, rewritten in place — never one per frame.
    const drawnLook = { ...look };
    const mix: GalaxyMix = { converge: 1, disperse: 0 };
    const introRuns = !reduced && motion.intro === "converge";
    const scrollRuns = !reduced && motion.scrollDisperse;
    if (introStartRef.current === null) introStartRef.current = performance.now();
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const tier = readDeviceTier({
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemory: nav.deviceMemory,
      saveData: nav.connection?.saveData
    });

    let width = 0;
    let height = 0;
    let ratio = 0;
    let field = generateGalaxyField({ ...stars, particleCount: 0 });
    let projection = createGalaxyProjection(0);
    let colourOf: Uint8Array = new Uint8Array(0);
    let sprites = buildGalaxySprites(look, 1, makeSpriteCanvas);
    let raf = 0;
    let last = 0;
    let disposed = false;
    const view = viewRef.current;
    let shownYaw = "";
    let shownPitch = "";
    let shownConverge = "";
    let shownDisperse = "";
    // Set by the scroll listener, read once per frame: however many scroll
    // events arrive between two frames, the page is measured once.
    let scrollDirty = scrollRuns;
    // The newest cursor position, applied once per frame however many
    // mousemoves arrived since the last one.
    let pendingTilt: { x: number; y: number } | null = null;

    function regenerate(count: number) {
      field = generateGalaxyField({ ...stars, particleCount: count });
      projection = createGalaxyProjection(field.count);
      colourOf = assignGalaxyColours(field.count, look.weights, stars.seed, Math.min(field.count, stars.flareStars));
      canvas!.setAttribute("data-galaxy-count", String(field.count));
      setShortfall(field.count < stars.particleCount ? { shown: field.count, asked: stars.particleCount } : null);
    }

    /** Size the backing store to the CSS box × the capped pixel ratio; regenerate only if the star budget moved. */
    function measure() {
      const rect = canvas!.getBoundingClientRect();
      const nextRatio = cappedPixelRatio();
      const nextW = Math.max(1, rect.width);
      const nextH = Math.max(1, rect.height);
      if (nextW === width && nextH === height && nextRatio === ratio) return false;
      if (nextRatio !== ratio) sprites = buildGalaxySprites(look, nextRatio, makeSpriteCanvas);
      width = nextW;
      height = nextH;
      ratio = nextRatio;
      canvas!.width = Math.max(1, Math.round(width * ratio));
      canvas!.height = Math.max(1, Math.round(height * ratio));
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.scale(ratio, ratio);
      const count = scaleGalaxyCount(stars.particleCount, width * height, tier);
      if (count !== field.count) regenerate(count);
      return true;
    }

    /*
     * How far the page has carried the galaxy away, 0..1. In Place: how far
     * the block's top has gone above the top of the window, over Scroll
     * Distance — but never over more than the block's own height, or a
     * 480px block scrolled away under the default 800px would leave the
     * window still 40% visible (the acceptance criterion is that it is gone
     * BEFORE it leaves). Window: the page's own scroll from the top.
     */
    function readDisperse(): number {
      if (!scrollRuns) return 0;
      if (inline) {
        const rect = container!.getBoundingClientRect();
        const distance = rect.height > 0 ? Math.min(motion.scrollDistance, rect.height) : motion.scrollDistance;
        return galaxyScrollDisperse(-rect.top, distance);
      }
      return galaxyScrollDisperse(window.scrollY || document.documentElement.scrollTop || 0, motion.scrollDistance);
    }

    /** Where the intro and the scroll have got to, at `now` on the frame clock. */
    function updateMix(now: number) {
      mix.converge = introRuns
        ? galaxyIntroProgress((now - (introStartRef.current ?? now)) / 1000, motion.introDelay, motion.introDuration)
        : 1;
      if (scrollDirty) {
        scrollDirty = false;
        mix.disperse = readDisperse();
      }
      const fade = galaxyDisperseOpacity(mix.disperse);
      drawnLook.opacity = look.opacity * fade;
      drawnLook.hazeStrength = look.hazeStrength * fade;
    }

    function draw() {
      projectGalaxyField(field, view.yaw, view.pitch, width, height, projection, mix);
      drawGalaxyFrame(
        ctx!,
        { field, projection, colourOf, width, height, offsetX: posX, offsetY: posY, assembled: mix.converge },
        drawnLook,
        sprites
      );
      frameRef.current += 1;
      canvas!.setAttribute("data-galaxy-frame", String(frameRef.current));
      // The angle it was drawn at, for the browser checks and a console
      // readout — written only when it changes, so a still galaxy writes nothing.
      const yaw = view.yaw.toFixed(3);
      const pitch = view.pitch.toFixed(3);
      if (yaw !== shownYaw) canvas!.setAttribute("data-galaxy-yaw", (shownYaw = yaw));
      if (pitch !== shownPitch) canvas!.setAttribute("data-galaxy-pitch", (shownPitch = pitch));
      // The intro's progress and the scroll's, two decimals, for the same readers.
      const converge = mix.converge.toFixed(2);
      const disperse = mix.disperse.toFixed(2);
      if (converge !== shownConverge) canvas!.setAttribute("data-galaxy-converge", (shownConverge = converge));
      if (disperse !== shownDisperse) canvas!.setAttribute("data-galaxy-disperse", (shownDisperse = disperse));
    }

    function tick(now: number) {
      raf = 0;
      if (disposed) return;
      const dt = last ? Math.min(MAX_FRAME_SECONDS, (now - last) / 1000) : 0;
      last = now;
      stepGalaxyField(field, dt, stars);
      if (pendingTilt) {
        tiltGalaxyView(view, pendingTilt.x, pendingTilt.y, window.innerWidth, window.innerHeight);
        pendingTilt = null;
      }
      stepGalaxyView(view, dt);
      updateMix(now);
      draw();
      raf = window.requestAnimationFrame(tick);
    }

    function start() {
      if (raf || reduced || disposed || document.visibilityState === "hidden") return;
      last = 0;
      raf = window.requestAnimationFrame(tick);
    }

    function stop() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    }

    measure();
    // The first frame starts from wherever the clock and the page already
    // are: a page loaded half scrolled draws the galaxy half dispersed.
    updateMix(performance.now());
    // Reduced motion gets ONE frame and no loop. This goes through start(),
    // never a bare requestAnimationFrame: start() is where the reduced-motion
    // and hidden-tab guards live, and a direct call silently bypasses both.
    if (reduced) draw();
    else start();

    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (measure() && reduced) draw();
        })
      : null;
    observer?.observe(container);
    observer?.observe(canvas);
    const onResize = () => {
      scrollDirty = scrollRuns;
      if (measure() && reduced) draw();
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? stop() : start());
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", stop);
    window.addEventListener("focus", start);

    /*
     * Interaction. Nothing is listened for under reduced motion or when it is
     * "none": a still galaxy has no loop to ease toward a target, and a
     * listener with nothing to drive is cost for no one.
     *
     * ROTATE (In Place): the drag surface is a real <button>, so it is
     * focusable and announced. A drag captures the pointer, so releasing
     * outside the canvas still ends it; `touch-action: pan-y` in the CSS
     * leaves a vertical swipe to the page, and the browser cancels the
     * pointer when it takes the swipe over.
     *
     * TILT (Window): the canvas sits behind the page and never receives a
     * pointer (TractorNav trap 3), so the cursor is read from the document —
     * one passive listener, applied once per frame in `tick`.
     */
    const button = buttonRef.current;
    let dragId: number | null = null;
    let dragX = 0;
    let dragY = 0;
    const endDrag = () => {
      if (dragId !== null && button?.hasPointerCapture?.(dragId)) button.releasePointerCapture(dragId);
      dragId = null;
      button?.removeAttribute("data-galaxy-dragging");
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragId = event.pointerId;
      dragX = event.clientX;
      dragY = event.clientY;
      button?.setPointerCapture?.(event.pointerId);
      button?.setAttribute("data-galaxy-dragging", "true");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragId) return;
      dragGalaxyView(view, event.clientX - dragX, event.clientY - dragY);
      dragX = event.clientX;
      dragY = event.clientY;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (stepGalaxyViewByKey(view, event.key)) event.preventDefault();
    };
    const onTilt = (event: MouseEvent) => {
      pendingTilt = { x: event.clientX, y: event.clientY };
    };
    const rotating = !reduced && interaction === "rotate" && inline && button;
    const tilting = !reduced && interaction === "tilt" && !inline;
    if (rotating) {
      button.addEventListener("pointerdown", onPointerDown);
      button.addEventListener("pointermove", onPointerMove);
      button.addEventListener("pointerup", endDrag);
      button.addEventListener("pointercancel", endDrag);
      button.addEventListener("lostpointercapture", endDrag);
      button.addEventListener("keydown", onKeyDown);
      window.addEventListener("blur", endDrag);
    }
    if (tilting) document.addEventListener("mousemove", onTilt, { passive: true });

    /*
     * Intro and scroll. Under reduced motion neither listens: the mix stays
     * at "everything in place", and the one frame drawn above is the galaxy
     * assembled and still.
     */
    const onScroll = () => {
      scrollDirty = true;
    };
    const onReplay = () => {
      introStartRef.current = performance.now();
      // Draw the scattered field NOW rather than on the next frame, so
      // nothing — a person or a browser check — can read the finished intro
      // in the gap between the press and the restart.
      updateMix(introStartRef.current);
      draw();
      start();
    };
    if (scrollRuns) window.addEventListener("scroll", onScroll, { passive: true });
    if (introRuns) document.addEventListener(GALAXY_REPLAY_EVENT, onReplay);

    return () => {
      disposed = true;
      stop();
      if (rotating) {
        endDrag();
        button.removeEventListener("pointerdown", onPointerDown);
        button.removeEventListener("pointermove", onPointerMove);
        button.removeEventListener("pointerup", endDrag);
        button.removeEventListener("pointercancel", endDrag);
        button.removeEventListener("lostpointercapture", endDrag);
        button.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("blur", endDrag);
      }
      if (tilting) document.removeEventListener("mousemove", onTilt);
      if (scrollRuns) window.removeEventListener("scroll", onScroll);
      if (introRuns) document.removeEventListener(GALAXY_REPLAY_EVENT, onReplay);
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", stop);
      window.removeEventListener("focus", start);
    };
    // `settings` is read through `key`; the effect re-runs on a change of value, never on a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced, showPoster]);

  /*
   * Two placements, from effect-placement.ts exactly as TractorNav uses it.
   *
   * WINDOW: the canvas is position:fixed over the whole viewport at the
   * module's z-index (-9999 by default, so behind the page). The wrapper has
   * no height, so the module takes no room in its column.
   *
   * IN PLACE: a block of the Height setting filling its cell's width, in the
   * flow, scrolling with the page. A negative z-index is lifted to 0 there by
   * `proximityZIndex`, or the galaxy would hide behind its own cell.
   */
  const surfaceStyle = inline
    ? { position: "absolute" as const, inset: 0, width: "100%", height: "100%", display: "block", zIndex }
    : { position: "fixed" as const, inset: 0, width: "100vw", height: "100vh", display: "block", zIndex, pointerEvents: "none" as const };

  return (
    <>
      <div
        ref={containerRef}
        className={inline ? "builder-galaxy builder-galaxy--inline" : "builder-galaxy builder-galaxy--window"}
        style={inline ? { position: "relative", width: "100%", height: blockHeight } : { position: "relative", width: "100%", height: 0 }}
      >
        {showPoster ? (
          <img src={posterUrl} alt="" aria-hidden="true" data-galaxy-poster="true" style={{ ...surfaceStyle, objectFit: "cover" }} />
        ) : (
          <canvas ref={canvasRef} aria-hidden="true" style={surfaceStyle} />
        )}
        {showDragSurface ? (
          <button
            ref={buttonRef}
            type="button"
            className="galaxy-drag-surface"
            aria-label="Drag or use the arrow keys to rotate the galaxy"
            style={{ zIndex }}
          />
        ) : null}
      </div>
      {!liveSite && shortfall && builderNote ? builderNote(shortfall.shown, shortfall.asked) : null}
    </>
  );
}
