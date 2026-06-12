/** Headlines are placed within the top portion of the rotator (percent of container height). */
export const HEADLINE_ROTATOR_MAX_Y_PERCENT = 60;

export const HEADLINE_ROTATOR_DEFAULT_FONT_SIZE = "32";

/** Percent positions across the full rotator width; Y stays within {@link HEADLINE_ROTATOR_MAX_Y_PERCENT}. */
export const HEADLINE_ROTATOR_SKY_POSITIONS: ReadonlyArray<{ xAxis: string; yAxis: string }> = [
  { xAxis: "6", yAxis: "10" },
  { xAxis: "78", yAxis: "8" },
  { xAxis: "34", yAxis: "22" },
  { xAxis: "92", yAxis: "15" },
  { xAxis: "4", yAxis: "42" },
  { xAxis: "58", yAxis: "12" },
  { xAxis: "22", yAxis: "48" },
  { xAxis: "86", yAxis: "28" },
  { xAxis: "12", yAxis: "22" },
  { xAxis: "68", yAxis: "52" },
  { xAxis: "48", yAxis: "9" },
  { xAxis: "96", yAxis: "45" }
];

export const HEADLINE_ROTATOR_DEFAULT_MIN_HEIGHT = "480";

export type HeadlineRotatorEntry = {
  id: string;
  label: string;
  href: string;
  xAxis: string;
  yAxis: string;
  color: string;
  overlap: string;
};

export function getHeadlineRotatorSkyPosition(index: number): { xAxis: string; yAxis: string } {
  const slot = HEADLINE_ROTATOR_SKY_POSITIONS[index % HEADLINE_ROTATOR_SKY_POSITIONS.length];
  return { xAxis: slot.xAxis, yAxis: slot.yAxis };
}

export function usesDefaultHeadlineRotatorPosition(xAxis: string | undefined, yAxis: string | undefined): boolean {
  const x = (xAxis ?? "").trim() || "50";
  const y = (yAxis ?? "").trim() || "50";
  return x === "50" && y === "50";
}

function withClampedYAxis(entry: HeadlineRotatorEntry): HeadlineRotatorEntry {
  return { ...entry, yAxis: String(clampHeadlineRotatorYPercent(entry.yAxis)) };
}

export function normalizeHeadlineRotatorEntry(
  entry: HeadlineRotatorEntry,
  index: number
): HeadlineRotatorEntry {
  if (!usesDefaultHeadlineRotatorPosition(entry.xAxis, entry.yAxis)) {
    return withClampedYAxis(entry);
  }

  const position = getHeadlineRotatorSkyPosition(index);
  return withClampedYAxis({ ...entry, xAxis: position.xAxis, yAxis: position.yAxis });
}

function mapHeadlineRotatorRecord(
  record: Record<string, unknown>,
  index: number,
  fallbackColor: string
): HeadlineRotatorEntry {
  return normalizeHeadlineRotatorEntry(
    {
      id: String(record.id || `headline-${index + 1}`),
      label: String(record.label || ""),
      href: String(record.href || ""),
      xAxis: String(record.xAxis ?? "50"),
      yAxis: String(record.yAxis ?? "50"),
      color: String(record.color || fallbackColor),
      overlap: String(record.overlap ?? "0")
    },
    index
  );
}

export function parseHeadlineRotatorItemsForEditor(
  raw: string,
  fallbackColor: string
): HeadlineRotatorEntry[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item, index) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return mapHeadlineRotatorRecord(record, index, fallbackColor);
    });
  } catch {
    return [];
  }
}

export function parseHeadlineRotatorEntries(
  raw: string,
  fallbackColor: string
): HeadlineRotatorEntry[] {
  return parseHeadlineRotatorItemsForEditor(raw, fallbackColor).filter((entry) => entry.label.length > 0);
}

export function serializeHeadlineRotatorEntries(entries: HeadlineRotatorEntry[]): string {
  return JSON.stringify(entries);
}

export function normalizeHeadlineRotatorHeadlinesJson(
  raw: string,
  fallbackColor: string
): string {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) {
      return raw;
    }

    const normalized = parsed.map((item, index) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return mapHeadlineRotatorRecord(record, index, fallbackColor);
    });

    return serializeHeadlineRotatorEntries(normalized);
  } catch {
    return raw;
  }
}

export function clampHeadlineRotatorPercent(value: string | undefined, fallback = 50): number {
  return Math.min(Math.max(Number.parseFloat(value ?? "") || fallback, 0), 100);
}

export function clampHeadlineRotatorYPercent(value: string | undefined, fallback = 30): number {
  return Math.min(Math.max(Number.parseFloat(value ?? "") || fallback, 0), HEADLINE_ROTATOR_MAX_Y_PERCENT);
}

/** Edge-anchored X so labels can use the full width (not center-clamped). */
export function getHeadlineRotatorPositionStyle(
  xAxis: string | undefined,
  yAxis: string | undefined
): { left?: string; right?: string; top: string; transform: string } {
  const x = clampHeadlineRotatorPercent(xAxis);
  const y = clampHeadlineRotatorYPercent(yAxis);

  if (x <= 50) {
    return { left: `${x}%`, top: `${y}%`, transform: "translate(0, -50%)" };
  }

  return { right: `${100 - x}%`, top: `${y}%`, transform: "translate(0, -50%)" };
}

export function computeHeadlineRotatorFadeInDelay(fadeDuration: number, overlapMs: number): number {
  const overlap = Math.min(Math.max(overlapMs, 0), fadeDuration);
  return Math.max(fadeDuration - overlap, 0);
}

/** Wall-clock time until both outgoing and incoming fades have finished. */
export function computeHeadlineRotatorTransitionMs(fadeDuration: number, overlapMs: number): number {
  return computeHeadlineRotatorFadeInDelay(fadeDuration, overlapMs) + fadeDuration;
}

export function resolveHeadlineRotatorMinHeight(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return Number.parseInt(HEADLINE_ROTATOR_DEFAULT_MIN_HEIGHT, 10);
}
