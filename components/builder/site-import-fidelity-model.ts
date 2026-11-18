/**
 * What the Imports screen says about an import's difference report (SC-862),
 * as pure functions so the words are tested.
 *
 * The record mirrors lib/siteImportFidelityRun.js, which the build
 * (scripts/site_import_map.mjs --apply) writes as checkpoints.fidelity after
 * running scripts/site_import_fidelity.mjs as its last step.
 *
 * Three outcomes, and the screen keeps them apart: a report with every page
 * compared, a report that could not look at part of the import (CANNOT TELL,
 * never "no differences"), and no report at all, with the reason.
 */

export type FidelityTotal = { key: string; label: string; count: number };

export type FidelityCheckpoint = {
  at?: string;
  status: "done" | "cannot-tell" | "failed";
  reportUrl?: string;
  totals?: FidelityTotal[];
  cannotTell?: { path: string; reason: string }[];
  blindSections?: number;
  notes?: string[];
  error?: string;
};

export type FidelityView =
  | { kind: "none"; text: string }
  | { kind: "failed"; text: string }
  | {
      kind: "report";
      blind: boolean;
      reportUrl: string;
      counts: string;
      cannotTell: { path: string; reason: string }[];
      notes: string[];
      stale: boolean;
    };

type CheckpointBag = Record<string, unknown> | undefined;

export function fidelityCheckpointOf(checkpoints: CheckpointBag): FidelityCheckpoint | null {
  const value = checkpoints?.fidelity as FidelityCheckpoint | undefined;
  return value && typeof value === "object" && typeof value.status === "string" ? value : null;
}

/** "Text styling 26, Links 3" — only the categories that lost something. */
export function fidelityCounts(totals: FidelityTotal[] | undefined): string {
  const lost = (totals || []).filter((t) => t && Number(t.count) > 0);
  if (!lost.length) return "Nothing lost in the measured categories.";
  return lost.map((t) => `${t.label} ${t.count}`).join(", ");
}

function mapAtOf(checkpoints: CheckpointBag): string {
  const map = checkpoints?.map as { at?: unknown } | undefined;
  return map && typeof map.at === "string" ? map.at : "";
}

/**
 * What the panel shows. `null` when the import has no built pages yet — there
 * is nothing to compare, and the build controls already say so.
 */
export function fidelityView(checkpoints: CheckpointBag): FidelityView | null {
  const mapAt = mapAtOf(checkpoints);
  const cp = fidelityCheckpointOf(checkpoints);
  if (!mapAt && !cp) return null;
  if (!cp) {
    return {
      kind: "none",
      text: "No difference report for these pages: they were built before the build made one. The next Build Draft Pages makes it.",
    };
  }
  if (cp.status === "failed") {
    return {
      kind: "failed",
      text: `The difference report could not be made: ${cp.error || "the build did not say why"}. The pages themselves were built.`,
    };
  }
  const notes = [...(cp.notes || [])];
  if (cp.blindSections) {
    notes.push(`${cp.blindSections} section(s) could not be compared — CANNOT TELL, not "no differences".`);
  }
  return {
    kind: "report",
    blind: cp.status === "cannot-tell",
    reportUrl: cp.reportUrl || "",
    counts: fidelityCounts(cp.totals),
    cannotTell: cp.cannotTell || [],
    notes,
    // A build since the report means it describes pages that have changed.
    stale: Boolean(mapAt && cp.at && Date.parse(mapAt) > Date.parse(cp.at)),
  };
}
