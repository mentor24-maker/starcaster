"use client";

import { useEffect, useRef } from "react";
import {
  activeRingIndex,
  proximityIsInline,
  proximityZIndex,
  computeRingSizes,
  DEFAULT_PROXIMITY_EFFECT,
  normalizeProximityFalloff,
  normalizeProximityReach,
  proximityIsContinuous,
  proximityValue,
  ringOpacity
} from "@/lib/proximity-effects";

export type TractorNavSettings = Record<string, string>;

/**
 * The proximity-effect module — a dot that answers the cursor.
 *
 * All the geometry lives in `lib/builder-client/proximity-effects.ts` and is
 * unit-tested there. This file owns only the DOM and the stylesheet: which
 * elements exist for each preset, and what a 0-to-1 number does to them.
 *
 * ── The bug this rewrite fixes ──────────────────────────────────────────
 *
 * From the day it was added (2026-06-21) until now, the runtime laid its rings
 * out as FLEX SIBLINGS — ten circles in a 670px-wide horizontal row, with the
 * dot inside the fourth one. Not concentric at all. The card preview in this
 * same file drew them correctly, which is exactly why nobody caught it: the
 * Builder's module card showed the right picture while every real page showed
 * a row. Published tenant sites render through `builder-bundle.js`, so this
 * was live, not a preview-only glitch.
 *
 * The tell was in the stylesheet: `.znav-ring` set `display: flex;
 * align-items: center; justify-content: center` — instructions for centring
 * your CHILDREN, which only mean something if each ring contains the next.
 * The port to React flattened the nesting into `sizes.map()` and kept the
 * styling that no longer had anything to centre.
 *
 * Every ring is now absolutely positioned and centred on the same point, which
 * is what makes them concentric and what makes one shared centre correct for
 * the distance measurement.
 *
 * ── Why the pointer is tracked on the document ──────────────────────────
 *
 * The old code bound `mousemove` to its own root. The module's default
 * `z-index` is -9999, so on any real page the content sitting above it
 * swallows the pointer and the handler never fires — the effect was dead on
 * arrival even where the layout happened to look acceptable. One passive
 * document-level listener, coalesced to a single write per frame, is both
 * correct and cheaper.
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * How large Swell grows the dot at full proximity.
 *
 * A constant rather than a setting on purpose: four times is big enough to
 * read as a response and small enough that it cannot swallow the page, and
 * one fewer control is one fewer thing to explain. It becomes a setting the
 * first time somebody actually wants a different number.
 */
const SWELL_MAX_SCALE = 4;

/** Shared reading of the settings bag, so preview and runtime cannot drift. */
function readSettings(settings: TractorNavSettings) {
  const effect = settings.effect || DEFAULT_PROXIMITY_EFFECT;
  const dotSize = clamp(parseInt(settings.dotSize || "10"), 2, 100);
  const outerSize = clamp(parseInt(settings.outerSize || "600"), 50, 1400);
  return {
    effect,
    color: settings.color || "#0000ff",
    dotHoverColor: settings.dotHoverColor || "#ffffff",
    dotSize,
    outerSize,
    ringCount: clamp(parseInt(settings.ringCount || "10"), 1, 30),
    sizingMode: settings.sizingMode || "linear",
    ringStep: clamp(parseInt(settings.ringStep || "10"), 2, 200),
    curve: clamp(parseFloat(settings.curve || "2"), 1, 5),
    innerOpacity: clamp(parseInt(settings.innerOpacity || "90"), 0, 100),
    opacityStep: clamp(parseInt(settings.opacityStep || "10"), 0, 50),
    transition: clamp(parseInt(settings.transition || "0"), 0, 500),
    reach: normalizeProximityReach(settings.reach),
    falloff: normalizeProximityFalloff(settings.falloff)
  };
}

/**
 * The blur that gives Glow its fuzzy edge, and the padding that pays for it.
 *
 * A Gaussian blur of radius r leaves the half-opacity contour on the original
 * edge and eats r inward from full opacity, so a disc that is not grown by r
 * hands back a core smaller than the shape asked for. Proportional to the
 * disc, so the softness reads the same at every size.
 */
function glowBlur(outerSize: number): number {
  return Math.max(4, Math.round(outerSize / 12));
}

/** Every preset's elements, sized off one centre. `prox` is the 0-to-1 dial. */
function EffectLayers({
  s,
  staticProx
}: {
  s: ReturnType<typeof readSettings>;
  staticProx?: number;
}) {
  const { r, g, b } = hexToRgb(s.color);
  /*
   * Centring, WITHOUT a transform.
   *
   * The obvious version of this object carried `transform: translate(-50%,
   * -50%)` and it silently broke two presets: an inline style beats any class
   * rule, so the stylesheet's `scale(var(--znav-prox))` and Spotlight's
   * cursor offset were both overridden and never ran. Glow still appeared to
   * grow — its blurred edge fades in with opacity, which reads as growth —
   * and Spotlight rendered pixel-identical to Glow. Nothing errored.
   *
   * So the rule is: whoever ANIMATES the transform owns the whole transform.
   * Rings do not animate theirs and keep it inline; the light layers take
   * theirs from the stylesheet, translate included.
   */
  const centred = {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    boxSizing: "border-box" as const
  };

  if (s.effect === "rings") {
    const sizes = computeRingSizes(s);
    return (
      <>
        {sizes.map((size: number, i: number) => (
          <div
            key={i}
            className="znav-ring"
            data-ring-index={i}
            style={{
              ...centred,
              transform: "translate(-50%, -50%)",
              width: size,
              height: size,
              border: `1px solid rgba(${r},${g},${b},${(
                ringOpacity({ index: i, count: sizes.length, ...s }) * 0.6
              ).toFixed(3)})`,
              ["--znav-hover-bg" as string]: `rgba(${r},${g},${b},${ringOpacity({
                index: i,
                count: sizes.length,
                ...s
              }).toFixed(3)})`
            }}
          />
        ))}
      </>
    );
  }

  if (s.effect === "glow" || s.effect === "spotlight") {
    const blur = glowBlur(s.outerSize);
    return (
      <div
        className={s.effect === "glow" ? "znav-glow" : "znav-glow znav-spotlight"}
        style={{
          ...centred,
          width: s.outerSize + blur * 2,
          height: s.outerSize + blur * 2,
          borderRadius: "50%",
          background: `rgb(${r},${g},${b})`,
          filter: `blur(${blur}px)`,
          // The card is a still, so it sets the whole transform itself rather
          // than leaning on a custom property no pointer will ever move.
          ...(staticProx === undefined
            ? {}
            : { opacity: staticProx, transform: `translate(-50%, -50%) scale(${staticProx})` })
        }}
      />
    );
  }

  return null;
}

// ── Card preview: static, not position:fixed ─────────────────

/**
 * The module card in the Builder. Shows the chosen preset frozen partway
 * through its curve, because a preset drawn at rest is an empty box — Glow at
 * proximity 0 is genuinely nothing, and a card showing nothing is how the ring
 * bug hid for two months.
 */
export function TractorNavCardPreview({ settings }: { settings: TractorNavSettings }) {
  const s = readSettings(settings);
  const { r, g, b } = hexToRgb(s.color);
  const sizes = computeRingSizes(s);
  const outerPx = s.effect === "rings" ? sizes[0] : s.outerSize;
  const CARD_PROX = 0.7;
  const dotScale = s.effect === "swell" ? 1 + CARD_PROX * (SWELL_MAX_SCALE - 1) : 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        padding: "12px 0",
        minHeight: Math.min(outerPx + 24, 120)
      }}
    >
      <div style={{ position: "relative", width: outerPx, height: outerPx }}>
        <EffectLayers s={s} staticProx={CARD_PROX} />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: s.dotSize,
            height: s.dotSize,
            borderRadius: "50%",
            background: `rgb(${r},${g},${b})`,
            transform: `translate(-50%, -50%) scale(${dotScale})`
          }}
        />
      </div>
    </div>
  );
}

// ── Full runtime: position:fixed, interactive ─────────────────

export function TractorNavRuntime({ settings }: { settings: TractorNavSettings }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const s = readSettings(settings);
  const { r, g, b } = hexToRgb(s.color);

  const posX = parseInt(settings.posX || "0") || 0;
  const posY = parseInt(settings.posY || "0") || 0;
  const inline = proximityIsInline(settings.placement);
  const zIndex = proximityZIndex(parseInt(settings.zIndex || "-9999"), settings.placement);
  const dotUrl = (settings.dotUrl || "").trim();
  const dotNewTab = settings.dotNewTab === "true";

  const sizes = computeRingSizes(s);
  const stageSize = s.effect === "rings" ? sizes[0] : s.outerSize;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Someone who has asked for less motion is asking for exactly this: a
    // static shape. Everything below only ever changes on pointer movement,
    // so simply not listening leaves the resting render in place.
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduced = false;
    }
    if (reduced) return;

    let pending = false;
    let lastX = 0;
    let lastY = 0;
    let seenPointer = false;

    function apply() {
      pending = false;
      const el = rootRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const distance = Math.hypot(lastX - cx, lastY - cy);

      if (proximityIsContinuous(s.effect)) {
        // The dot is the light's source, so the effect is at full once the
        // pointer is on it rather than only at its exact centre pixel.
        const value = seenPointer
          ? proximityValue({
              distance,
              coreRadius: s.dotSize / 2,
              reach: s.reach,
              falloff: s.falloff
            })
          : 0;
        el.style.setProperty("--znav-prox", value.toFixed(3));
        // Spotlight rides the cursor rather than sitting on the module, so it
        // needs the offset as well as the dial.
        el.style.setProperty("--znav-offset-x", `${(lastX - cx).toFixed(1)}px`);
        el.style.setProperty("--znav-offset-y", `${(lastY - cy).toFixed(1)}px`);
        return;
      }

      const active = seenPointer ? activeRingIndex(distance, sizes) : -1;
      const rings = el.querySelectorAll<HTMLElement>(".znav-ring");
      rings.forEach((ring, i) => ring.classList.toggle("znav-ring-active", i === active));
      const dot = el.querySelector<HTMLElement>(".znav-dot");
      if (dot) dot.classList.toggle("znav-dot-hover", distance <= s.dotSize / 2);
    }

    // mousemove fires far faster than the screen repaints, and each write
    // invalidates a blur. One write per frame, whatever the pointer does.
    function schedule() {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(apply);
    }

    function onMove(event: MouseEvent) {
      lastX = event.clientX;
      lastY = event.clientY;
      seenPointer = true;
      schedule();
    }

    function onLeave() {
      seenPointer = false;
      schedule();
    }

    // On the document, not the root: the module's default z-index is -9999,
    // so anything painted above it would otherwise eat every pointer event.
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    // Scrolling moves the module under a stationary cursor, so the distance
    // changes with no mousemove to report it.
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("scroll", schedule);
    };
  }, [s.effect, s.dotSize, s.reach, s.falloff, sizes.length, stageSize]);

  const DotTag = dotUrl ? "a" : "div";
  const dotScale =
    s.effect === "swell"
      ? `scale(calc(1 + var(--znav-prox, 0) * ${SWELL_MAX_SCALE - 1}))`
      : "";

  return (
    <>
      <style>{`
        .znav-stage { --znav-prox: 0; --znav-offset-x: 0px; --znav-offset-y: 0px; }
        .znav-ring {
          border-radius: 50%;
          background: transparent;
          transition: background ${s.transition}ms ease;
        }
        .znav-ring.znav-ring-active { background: var(--znav-hover-bg); }

        /* Grows out of nothing as the pointer closes, and its edge is blurred
           rather than exact — a mathematically perfect circle reads as a plate
           laid on the page, a blurred one reads as light. Same construction as
           the Explore link's halo on the login screen. */
        .znav-glow {
          opacity: var(--znav-prox);
          transform: translate(-50%, -50%) scale(var(--znav-prox));
          transition: opacity 0.12s linear, transform 0.12s linear;
          pointer-events: none;
        }
        /* Spotlight is the same body of light, but it rides the cursor instead
           of sitting on the module. */
        .znav-spotlight {
          transform:
            translate(-50%, -50%)
            translate(var(--znav-offset-x), var(--znav-offset-y))
            scale(var(--znav-prox));
        }

        .znav-dot {
          border-radius: 50%;
          flex-shrink: 0;
          transition: background 150ms ease, transform 0.12s linear;
          display: block;
          text-decoration: none;
        }
        .znav-dot.znav-dot-hover { background: ${s.dotHoverColor} !important; }
        ${dotUrl ? ".znav-dot { cursor: pointer; }" : ""}

        @media (prefers-reduced-motion: reduce) {
          .znav-ring, .znav-glow, .znav-dot { transition: none; }
        }
      `}</style>
      {/*
        * The anchor is what In Place measures its 50% against, and it is
        * stretched over the whole CELL rather than sitting at the module's
        * own line in the flow.
        *
        * Both were tried. A zero-height anchor puts the effect wherever the
        * module happens to sit in the column, which for the usual case — the
        * only module in the cell — is the very top, with half the light
        * hanging outside the cell above it. Stretching to the cell puts it in
        * the middle of the box the operator was looking at when they said
        * "centre of the cell", which is the thing they actually asked for.
        *
        * inset:0 with height:0 on the wrapper itself: absolutely positioned,
        * so it is out of flow and cannot push the page around — decoration
        * that changes the layout when you switch it on is worse than none —
        * and it resolves against the nearest positioned ancestor, which for
        * a builder page is the cell (every column carries position:relative).
        * If some future wrapper is positioned first, the effect falls back to
        * that wrapper's box, which is still local and still sensible.
        *
        * Rendered in both modes rather than conditionally, because a fixed
        * child is positioned against the viewport regardless of what wraps
        * it; one DOM shape keeps the two modes from drifting.
        */}
      <div
        className="znav-anchor"
        style={
          inline
            ? { position: "absolute", inset: 0, pointerEvents: "none" }
            : { position: "relative", width: "100%", height: 0 }
        }
      >
      <div
        ref={rootRef}
        className="znav-stage"
        style={{
          /*
           * Two placements, and the difference is which box the percentages
           * are measured against.
           *
           * WINDOW: position:fixed, so 50vw/50vh is the middle of the browser
           * window and the effect ignores the layout and does not scroll.
           * Note that a fixed element is only really fixed to the window if no
           * ancestor has a transform, filter or backdrop-filter — any of those
           * makes that ancestor the containing block instead. Every themed
           * column used to carry `backdrop-filter: blur(0px)` for exactly no
           * visual reason, which is what made these numbers unpredictable; see
           * --lp-backdrop in builder-utils.ts.
           *
           * IN PLACE: position:absolute against the zero-height anchor below,
           * which is the full width of the cell and sits at the module's own
           * point in the flow. So 50% across is the middle of the cell, 50%
           * down is where the module is, and the effect scrolls with the page.
           */
          position: inline ? "absolute" : "fixed",
          left: inline ? `calc(50% + ${posX}px)` : `calc(50vw + ${posX}px)`,
          top: inline ? `calc(50% + ${-posY}px)` : `calc(50vh + ${-posY}px)`,
          // The stage is the effect's own extent, and every layer is centred
          // inside it. That shared centre is what makes the rings concentric
          // and what the distance is measured from.
          width: stageSize,
          height: stageSize,
          transform: "translate(-50%, -50%)",
          zIndex,
          cursor: "crosshair"
        }}
      >
        <EffectLayers s={s} />
        <DotTag
          className="znav-dot"
          {...(dotUrl ? { href: dotUrl } : {})}
          {...(dotUrl && dotNewTab ? { target: "_blank", rel: "noopener" } : {})}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: s.dotSize,
            height: s.dotSize,
            background: `rgb(${r},${g},${b})`,
            transform: `translate(-50%, -50%) ${dotScale}`
          }}
        />
      </div>
      </div>
    </>
  );
}
