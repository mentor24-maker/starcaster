"use client";

import { useEffect, useRef } from "react";

export type TractorNavSettings = Record<string, string>;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function computeRingSizes(s: {
  dotSize: number;
  ringCount: number;
  sizingMode: string;
  ringStep: number;
  outerSize: number;
  curve: number;
}): number[] {
  const sizes: number[] = [];
  if (s.sizingMode === "geometric") {
    const span = s.outerSize - s.dotSize;
    for (let i = 0; i < s.ringCount; i++) {
      const t = (s.ringCount - i) / s.ringCount;
      sizes.push(Math.round(s.dotSize + span * Math.pow(t, s.curve)));
    }
  } else {
    for (let i = s.ringCount; i >= 1; i--) {
      sizes.push(s.dotSize + i * s.ringStep);
    }
  }
  return sizes;
}

// ── Card preview: static, not position:fixed ─────────────────

export function TractorNavCardPreview({ settings }: { settings: TractorNavSettings }) {
  const color = settings.color || "#0000ff";
  const dotSize = clamp(parseInt(settings.dotSize || "10"), 2, 100);
  const ringCount = clamp(parseInt(settings.ringCount || "10"), 1, 30);
  const sizingMode = settings.sizingMode || "linear";
  const ringStep = clamp(parseInt(settings.ringStep || "10"), 2, 200);
  const outerSize = clamp(parseInt(settings.outerSize || "600"), 50, 1400);
  const curve = clamp(parseFloat(settings.curve || "2"), 1, 5);
  const innerOpacity = clamp(parseInt(settings.innerOpacity || "90"), 0, 100);
  const opacityStep = clamp(parseInt(settings.opacityStep || "10"), 0, 50);

  const { r, g, b } = hexToRgb(color);
  const sizes = computeRingSizes({ dotSize, ringCount, sizingMode, ringStep, outerSize, curve });
  const n = sizes.length;
  const outerPx = sizes[0];

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
        {sizes.map((size, i) => {
          const opacity = clamp(innerOpacity - (n - 1 - i) * opacityStep, 0, 100) / 100;
          const scale = size / outerPx;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: size,
                height: size,
                borderRadius: "50%",
                border: `1px solid rgba(${r},${g},${b},${(opacity * 0.6).toFixed(3)})`,
                transform: "translate(-50%, -50%)",
                boxSizing: "border-box"
              }}
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            background: `rgb(${r},${g},${b})`,
            transform: "translate(-50%, -50%)"
          }}
        />
      </div>
    </div>
  );
}

// ── Full runtime: position:fixed, interactive ─────────────────

export function TractorNavRuntime({ settings }: { settings: TractorNavSettings }) {
  const rootRef = useRef<HTMLDivElement>(null);

  const color        = settings.color        || "#0000ff";
  const dotHoverColor = settings.dotHoverColor || "#ffffff";
  const dotSize      = clamp(parseInt(settings.dotSize      || "10"),  2,   100);
  const ringCount    = clamp(parseInt(settings.ringCount    || "10"),  1,    30);
  const sizingMode   = settings.sizingMode   || "linear";
  const ringStep     = clamp(parseInt(settings.ringStep     || "10"),  2,   200);
  const outerSize    = clamp(parseInt(settings.outerSize    || "600"), 50, 1400);
  const curve        = clamp(parseFloat(settings.curve      || "2"),   1,     5);
  const innerOpacity = clamp(parseInt(settings.innerOpacity || "90"),  0,   100);
  const opacityStep  = clamp(parseInt(settings.opacityStep  || "10"),  0,    50);
  const transition   = clamp(parseInt(settings.transition   || "0"),   0,   500);
  const posX         = parseInt(settings.posX  || "0") || 0;
  const posY         = parseInt(settings.posY  || "0") || 0;
  const zIndex       = parseInt(settings.zIndex || "-9999");
  const dotUrl       = (settings.dotUrl   || "").trim();
  const dotNewTab    = settings.dotNewTab === "true";

  const { r, g, b } = hexToRgb(color);
  const sizes        = computeRingSizes({ dotSize, ringCount, sizingMode, ringStep, outerSize, curve });
  const n            = sizes.length;

  // Attach mousemove / mouseleave on the root div
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function onMove(e: MouseEvent) {
      const rings = root!.querySelectorAll<HTMLElement>(".znav-ring");
      const dot   = root!.querySelector<HTMLElement>(".znav-dot");
      if (!rings.length) return;

      const outerRect = rings[0].getBoundingClientRect();
      const cx = outerRect.left + outerRect.width  / 2;
      const cy = outerRect.top  + outerRect.height / 2;
      const dist = Math.sqrt((e.clientX - cx) ** 2 + (e.clientY - cy) ** 2);

      const dotRadius = dot ? parseFloat(dot.dataset.radius || "0") : 0;
      const onDot = !!dot && dist <= dotRadius;
      if (dot) dot.classList.toggle("znav-dot-hover", onDot);

      let activeRing: Element | null = null;
      if (!onDot) {
        const arr = Array.from(rings);
        for (let i = arr.length - 1; i >= 0; i--) {
          if (dist <= parseFloat((arr[i] as HTMLElement).dataset.radius || "0")) {
            activeRing = arr[i];
            break;
          }
        }
      }
      rings.forEach((ring) => ring.classList.toggle("znav-ring-active", ring === activeRing));
    }

    function onLeave() {
      root!.querySelectorAll(".znav-ring").forEach((r) => r.classList.remove("znav-ring-active"));
      root!.querySelector(".znav-dot")?.classList.remove("znav-dot-hover");
    }

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [dotSize]);

  const DotTag = dotUrl ? "a" : "div";

  return (
    <>
      <style>{`
        .znav-ring {
          border-radius: 50%;
          background: transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background ${transition}ms ease;
        }
        .znav-ring.znav-ring-active { background: var(--znav-hover-bg); }
        .znav-dot {
          border-radius: 50%;
          flex-shrink: 0;
          transition: background 150ms ease;
          display: block;
          text-decoration: none;
        }
        .znav-dot.znav-dot-hover { background: ${dotHoverColor} !important; }
        ${dotUrl ? ".znav-dot { cursor: pointer; }" : ""}
      `}</style>
      <div
        ref={rootRef}
        style={{
          position: "fixed",
          left: `calc(50vw + ${posX}px)`,
          top: `calc(50vh + ${-posY}px)`,
          transform: "translate(-50%, -50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex,
          cursor: "crosshair"
        }}
      >
        {sizes.map((size, i) => {
          const opacity = clamp(innerOpacity - (n - 1 - i) * opacityStep, 0, 100) / 100;
          return (
            <div
              key={i}
              className="znav-ring"
              data-radius={size / 2}
              style={{
                width: size,
                height: size,
                ["--znav-hover-bg" as string]: `rgba(${r},${g},${b},${opacity.toFixed(3)})`
              }}
            />
          );
        })}
        <DotTag
          className="znav-dot"
          data-radius={dotSize / 2}
          {...(dotUrl ? { href: dotUrl } : {})}
          {...(dotUrl && dotNewTab ? { target: "_blank", rel: "noopener" } : {})}
          style={{
            position: "absolute",
            width: dotSize,
            height: dotSize,
            background: `rgb(${r},${g},${b})`
          }}
        />
      </div>
    </>
  );
}
