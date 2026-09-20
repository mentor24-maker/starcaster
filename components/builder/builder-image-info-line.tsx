import { useEffect, useState, type CSSProperties } from "react";
import { BuilderBodyPortal } from "./builder-body-portal";

/**
 * The file name an image address points at: its last path segment, decoded,
 * without a query string or hash. A Vercel Blob address is a long host plus a
 * folder path, and the name at the end is the only part that tells one slide
 * from another (Delray, 2026-09-14, task 86bc0n59x).
 */
export function imageFileNameFromUrl(url: string): string {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return "";
  }
  const path = trimmed.split(/[?#]/)[0].replace(/\/+$/, "");
  const segment = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

type Measurement =
  | { state: "loading" }
  | { state: "loaded"; width: number; height: number }
  | { state: "failed" };

/**
 * One line under an image field: the file name, which opens the picture in a
 * pop-up, and its size in pixels. Editor-only — nothing here reaches a
 * published page. An address that will not load says so rather than showing
 * a blank, because an empty line and a broken image look the same otherwise.
 */
export function BuilderImageInfoLine({
  url,
  className = "",
  thumbnail = false,
  style
}: {
  url: string;
  className?: string;
  /**
   * Show a thumbnail of the picture with the name and size directly under it
   * (Dane, 2026-09-14, task 86bc0p5f9). The thumbnail opens the same pop-up.
   */
  thumbnail?: boolean;
  style?: CSSProperties;
}) {
  const src = String(url || "").trim();
  const [measurement, setMeasurement] = useState<Measurement>({ state: "loading" });
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!src) {
      return;
    }
    let cancelled = false;
    setMeasurement({ state: "loading" });
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setMeasurement({ state: "loaded", width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setMeasurement({ state: "failed" });
      }
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  if (!src) {
    // A thumbnail slot that silently stays blank reads as a broken picture,
    // so it says why it is empty. The plain line has nothing to describe.
    return thumbnail ? (
      <div className={`builder-image-thumb is-empty ${className}`.trim()} style={style}>
        No image chosen yet
      </div>
    ) : null;
  }

  const name = imageFileNameFromUrl(src) || src;
  const detail =
    measurement.state === "loaded"
      ? `${measurement.width} × ${measurement.height}`
      : measurement.state === "failed"
        ? "could not load this image"
        : "measuring…";

  const line = (
    <div className={thumbnail ? "builder-image-info-line" : `builder-image-info-line ${className}`.trim()}>
      <button
        type="button"
        className="builder-image-info-name"
        onClick={() => setIsOpen(true)}
        title="View this image"
      >
        {name}
      </button>
      <span
        className={`builder-image-info-size${measurement.state === "failed" ? " is-error" : ""}`}
      >
        {detail}
      </span>
    </div>
  );

  return (
    <>
      {thumbnail ? (
        <div className={`builder-image-thumb ${className}`.trim()} style={style}>
          {measurement.state === "failed" ? null : (
            <button
              type="button"
              className="builder-image-thumb-button"
              onClick={() => setIsOpen(true)}
              title="View this image"
              aria-label={`View ${name}`}
            >
              <img src={src} alt="" className="builder-image-thumb-image" />
            </button>
          )}
          {line}
        </div>
      ) : (
        line
      )}
      {isOpen ? (
        <BuilderBodyPortal>
          <div
            className="builder-gallery-overlay builder-image-info-overlay"
            onClick={() => setIsOpen(false)}
            role="presentation"
          >
            <div
              className="builder-image-info-dialog"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={`Image: ${name}`}
            >
              <div className="builder-image-info-dialog-header">
                <span className="builder-image-info-dialog-title">
                  {name}
                  {measurement.state === "loaded" ? ` · ${detail}` : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close image"
                >
                  Close
                </button>
              </div>
              <img src={src} alt={name} className="builder-image-info-dialog-image" />
            </div>
          </div>
        </BuilderBodyPortal>
      ) : null}
    </>
  );
}
