/**
 * Undoing a shared-section push — the ONE copy of the flow and its sentences.
 *
 * Two surfaces offer this undo: the save-time banner (admin-builder-editor)
 * and the durable row in Page History. They used to carry byte-identical
 * fetch + parsing + message code in both files, which is exactly how the
 * partial-failure wording ("Put back N pages, but M could not be restored…")
 * would eventually drift apart. It is doctrine copy — it lives here once.
 *
 * The confirm is built from a fresh GET, not from remembered counts:
 * retention pruning deletes old restore points, so months after a push the
 * honest promise is "N pages still have restore points", never the original
 * run size. The same GET reports whether the run was already undone, so a
 * button can say "Undone" instead of silently replaying old snapshots.
 */

import { builderAdminFetch } from "@/lib/builder-admin-fetch";

export type PropagationRunPage = { pageId: string; name: string };

export type PropagationRunScope = {
  /** Pages that still hold a restore point from this run — what undo touches NOW. */
  pages: PropagationRunPage[];
  /** True when a previous undo of this run has already banked revert revisions. */
  undone: boolean;
};

export type PropagationUndoOutcome = {
  restoredCount: number;
  failedNames: string[];
};

/** How many page names the confirm dialog lists before "and N more". */
const CONFIRM_NAME_CAP = 10;

export async function fetchPropagationRunScope(runId: string): Promise<PropagationRunScope> {
  const response = await builderAdminFetch(`/api/admin/propagation-runs/${runId}`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as {
    pages?: Array<{ pageId?: string; name?: string }>;
    undone?: boolean;
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not look up that update.");
  const pages = (Array.isArray(body.pages) ? body.pages : []).map((page) => ({
    pageId: String(page.pageId ?? ""),
    name: String(page.name ?? ""),
  }));
  return { pages, undone: body.undone === true };
}

/**
 * The confirm text, truthful by construction: it names exactly the pages the
 * GET says still have restore points, so "Undone. N pages are back" can never
 * promise more than the undo can deliver.
 */
export function confirmUndoMessage(scope: PropagationRunScope, sectionName?: string): string {
  const count = scope.pages.length;
  const names = scope.pages.map((page) => page.name.trim() || "(unnamed)");
  const listed = names.slice(0, CONFIRM_NAME_CAP).join(", ");
  const overflow = names.length - CONFIRM_NAME_CAP;
  const nameList = overflow > 0 ? `${listed}, and ${overflow} more` : listed;

  const heading = sectionName?.trim()
    ? `Undo the update to "${sectionName.trim()}"?`
    : "Undo this shared-section update?";

  return (
    `${heading}\n\n` +
    `${count} ${count === 1 ? "page still has" : "pages still have"} restore points from this update: ${nameList}.\n\n` +
    `${count === 1 ? "That page goes" : "Those pages go"} back to how ${count === 1 ? "it" : "they"} looked right before ` +
    "that update — the WHOLE page, not just the shared part. So anything edited " +
    `on ${count === 1 ? "that page" : "those pages"} since then is rolled back too.\n\n` +
    `${count === 1 ? "The page's" : "Each page's"} current version is saved to its own history first, so ` +
    "nothing is lost and this can itself be undone."
  );
}

/** Shown instead of a confirm when the GET reports the run was already undone. */
export const ALREADY_UNDONE_MESSAGE =
  "This update was already undone. To redo it, restore the pages you want from their own history.";

export async function performPropagationUndo(runId: string): Promise<PropagationUndoOutcome> {
  const response = await builderAdminFetch(`/api/admin/propagation-runs/${runId}/undo`, { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as {
    restored?: Array<{ name?: string }>;
    failed?: Array<{ name?: string }>;
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not undo that update.");
  return {
    restoredCount: body.restored?.length ?? 0,
    failedNames: (body.failed ?? []).map((page) => page.name || "(unnamed)"),
  };
}

/**
 * The sentence shown AFTER the undo. A partial undo NAMES its casualties —
 * a partial run reporting plain success is the PR #21 failure this whole
 * feature exists to stop happening quietly.
 */
export function describeUndoOutcome(outcome: PropagationUndoOutcome): {
  kind: "success" | "partial";
  text: string;
} {
  const restored = outcome.restoredCount;
  if (outcome.failedNames.length) {
    return {
      kind: "partial",
      text:
        `Put back ${restored} ${restored === 1 ? "page" : "pages"}, but ${outcome.failedNames.length} could not be restored: ` +
        `${outcome.failedNames.join(", ")}. Their history still holds the old version — ` +
        "restore those from the page itself.",
    };
  }
  return {
    kind: "success",
    text: `Undone. ${restored} ${restored === 1 ? "page is" : "pages are"} back to how they were.`,
  };
}
