/**
 * What the "Preview build" / "Build draft pages" panel on Builder › Site
 * Import shows (task 86bcz9wcx), as pure functions so the words are tested.
 *
 * The record shapes mirror lib/siteImportBuild.js (the server and worker
 * side) and the --result-file written by scripts/site_import_map.mjs:
 *   checkpoints.build         the latest request and how it went
 *   checkpoints.buildPreview  the latest successful preview
 */

export type BuildResultPage = {
  path: string;
  slug: string;
  name: string;
  action: "create" | "update";
  modules?: number;
  placeholders?: number;
};

export type BuildResult = {
  ok?: boolean;
  mode?: "preview" | "apply";
  pages?: BuildResultPage[];
  theme?:
    | { skipped: true }
    | { name: string; palette?: Record<string, string>; notes?: string[]; makesDefault?: boolean; skipped?: false }
    | null;
  warnings?: string[];
  refresh?: string;
  applied?: {
    created: number;
    updated: number;
    pages: number;
    theme?: { name: string; madeDefault: boolean } | null;
  } | null;
  error?: string;
};

export type BuildRequest = {
  mode: "preview" | "apply";
  noTheme?: boolean;
  status: "queued" | "running" | "done" | "failed";
  requestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: BuildResult | null;
  error?: string;
};

export type BuildPreview = { at?: string; noTheme?: boolean; result?: BuildResult | null };

type CheckpointBag = Record<string, unknown> | undefined;

export function buildRequestOf(checkpoints: CheckpointBag): BuildRequest | null {
  const value = checkpoints?.build as BuildRequest | undefined;
  return value && typeof value === "object" && typeof value.status === "string" ? value : null;
}

export function buildPreviewOf(checkpoints: CheckpointBag): BuildPreview | null {
  const value = checkpoints?.buildPreview as BuildPreview | undefined;
  return value && typeof value === "object" ? value : null;
}

export function buildIsActive(request: BuildRequest | null): boolean {
  return Boolean(request && (request.status === "queued" || request.status === "running"));
}

function atOf(checkpoints: CheckpointBag, key: string): string {
  const value = checkpoints?.[key] as { at?: unknown } | undefined;
  return value && typeof value === "object" && typeof value.at === "string" ? value.at : "";
}

/**
 * Whether the preview still describes what a build would do. The server
 * decides for real (a fingerprint in lib/siteImportBuild.js); this mirrors it
 * so the button is greyed out with a reason instead of failing on click.
 */
export function previewIsCurrent(checkpoints: CheckpointBag): boolean {
  const preview = buildPreviewOf(checkpoints);
  if (!preview?.at) return false;
  const mapAt = atOf(checkpoints, "map");
  const irAt = atOf(checkpoints, "normalize");
  if (mapAt && mapAt > preview.at) return false;
  if (irAt && irAt > preview.at) return false;
  return true;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The status line: Queued → Building → Built (N draft pages), or why it failed. */
export function buildStatusLine(request: BuildRequest | null): { text: string; tone: "waiting" | "running" | "done" | "failed" } | null {
  if (!request) return null;
  const preview = request.mode === "preview";
  if (request.status === "queued") {
    return {
      text: preview
        ? "Preview queued — waiting for the import worker on the Mac Mini, which checks every 5 minutes."
        : "Build queued — waiting for the import worker on the Mac Mini, which checks every 5 minutes.",
      tone: "waiting",
    };
  }
  if (request.status === "running") {
    return {
      text: preview
        ? "Previewing — the import worker is working out what the build would do. Nothing is being changed."
        : "Building — the import worker is making the draft pages now. Nothing is published.",
      tone: "running",
    };
  }
  if (request.status === "failed") {
    const what = preview ? "The preview" : "The build";
    return { text: `${what} failed: ${request.error || "the worker did not say why"}`, tone: "failed" };
  }
  if (preview) return { text: "Preview ready — read it below, then press Build Draft Pages.", tone: "done" };
  const applied = request.result?.applied;
  if (!applied) return { text: "Built. Nothing was published.", tone: "done" };
  const parts = [];
  if (applied.created) parts.push(`${applied.created} new`);
  if (applied.updated) parts.push(`${applied.updated} updated`);
  return {
    text: `Built ${plural(applied.pages, "draft page")}${parts.length ? ` (${parts.join(", ")})` : ""}. Nothing was published.`,
    tone: "done",
  };
}

export type PreviewSummary = {
  headline: string;
  pages: BuildResultPage[];
  theme:
    | { kind: "skipped" }
    | { kind: "none" }
    | { kind: "theme"; name: string; swatches: Array<{ role: string; hex: string }>; notes: string[]; makesDefault: boolean };
  warnings: string[];
  refresh: string;
};

/** The preview, in the words the panel shows. */
export function summarizePreview(result: BuildResult | null | undefined): PreviewSummary | null {
  if (!result || !Array.isArray(result.pages)) return null;
  const pages = result.pages;
  const creates = pages.filter((p) => p.action !== "update").length;
  const updates = pages.length - creates;
  const parts = [];
  if (creates) parts.push(`create ${plural(creates, "page")}`);
  if (updates) parts.push(`update ${plural(updates, "page")} an earlier import built`);
  const headline = parts.length
    ? `The build will ${parts.join(" and ")}, all as drafts.`
    : "The build found no pages to make from this import.";
  const t = result.theme;
  let theme: PreviewSummary["theme"];
  if (!t) theme = { kind: "none" };
  else if ("skipped" in t && t.skipped) theme = { kind: "skipped" };
  else {
    const named = t as { name: string; palette?: Record<string, string>; notes?: string[]; makesDefault?: boolean };
    theme = {
      kind: "theme",
      name: named.name,
      swatches: Object.entries(named.palette ?? {})
        .filter(([, hex]) => typeof hex === "string" && hex)
        .map(([role, hex]) => ({ role, hex })),
      notes: Array.isArray(named.notes) ? named.notes : [],
      makesDefault: named.makesDefault !== false,
    };
  }
  return {
    headline,
    pages,
    theme,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    refresh: typeof result.refresh === "string" ? result.refresh : "",
  };
}

/** Why "Build draft pages" is greyed out, or null when it may be pressed. */
export function buildDisabledReason(checkpoints: CheckpointBag): string | null {
  const request = buildRequestOf(checkpoints);
  if (buildIsActive(request)) return "Wait for the step in progress to finish.";
  if (!buildPreviewOf(checkpoints)) return "Press Preview Build first.";
  if (!previewIsCurrent(checkpoints)) {
    return "This import changed since the preview (it was copied again, or pages were built). Press Preview Build again.";
  }
  return null;
}
