"use client";

/**
 * Page History — the per-page undo the Builder never had.
 *
 * Every layout-changing save banks the page's PREVIOUS state
 * (lib/builderPageRevisionsStore.js), so this list is the trail behind the
 * live page and restoring walks back down it. Restoring is itself a save, so
 * the state you restored FROM is banked too and an undo can be undone.
 *
 * The panel degrades rather than breaking when the migration has not been run:
 * the API answers HISTORY_UNAVAILABLE and we say so plainly instead of
 * rendering an empty list that reads as "nothing has ever happened here".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import {
  ALREADY_UNDONE_MESSAGE,
  confirmUndoMessage,
  describeUndoOutcome,
  fetchPropagationRunScope,
  performPropagationUndo,
} from "@/lib/propagation-undo";
import { BuilderCollapseIcon } from "./builder-collapse-icon";

export type BuilderPageRevision = {
  id: string;
  pageId: string;
  name: string;
  sectionCount: number;
  moduleCount: number;
  layoutBytes: number;
  reason: string;
  /** Who made the save that replaced this version. "" = recorded before the
   *  saved_by columns existed, or an unauthenticated write. */
  savedBy?: string;
  savedByName?: string;
  /** What the save that replaced this version did to it. "" = recorded before
   *  the change_summary column existed; the counts stand in for it. */
  changeSummary?: string;
  /** Shared across every revision one canonical-section push created. Present
   *  only on `reason: 'propagate'` rows recorded after that column shipped —
   *  its absence just means "restore this page alone" is the only option. */
  propagationRunId?: string;
  createdAt: string;
};

type BuilderPageHistoryProps = {
  pageId: string;
  pageName: string;
  onRestored: () => void;
};

/** What each save was doing, in the operator's words rather than the code's. */
const REASON_LABELS: Record<string, string> = {
  save: "Edited",
  propagate: "Shared section updated",
  revert: "Restored",
};

function formatWhen(iso: string): string {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";

  const minutesAgo = Math.round((Date.now() - when.getTime()) / 60000);
  const clock = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (minutesAgo < 1) return `Just now — ${clock}`;
  if (minutesAgo < 60) return `${minutesAgo} min ago — ${clock}`;
  const hoursAgo = Math.round(minutesAgo / 60);
  if (hoursAgo < 24) return `${hoursAgo} hr ago — ${clock}`;
  return clock;
}

/**
 * "Edited by Rich Kaplan", or just "Edited" when the row predates the author
 * columns. Never "Unknown" -- an em dash is honest, a fake name is not.
 */
function describeReason(revision: BuilderPageRevision): string {
  const label = REASON_LABELS[revision.reason] ?? "Edited";
  const who = (revision.savedByName ?? "").trim();
  return who ? `${label} by ${who}` : label;
}

/** "Today", "Yesterday", or "Fri, Aug 8" — the heading a day's rows sit under. */
function describeDay(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "Earlier";
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((midnight(new Date()) - midnight(when)) / 86400000);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Split the flat list into day groups, order preserved.
 *
 * Retention keeps hourly milestones for a week and daily ones for a month, so
 * this list now spans days rather than the ninety minutes it used to. Without
 * headings, "3 hr ago" and a date from last Tuesday sit in one undifferentiated
 * column and the older entries read as noise.
 */
function groupByDay(revisions: BuilderPageRevision[]): Array<{ day: string; rows: BuilderPageRevision[] }> {
  const groups: Array<{ day: string; rows: BuilderPageRevision[] }> = [];
  for (const revision of revisions) {
    const day = describeDay(revision.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(revision);
    else groups.push({ day, rows: [revision] });
  }
  return groups;
}

function describeSize(revision: BuilderPageRevision): string {
  const sections = `${revision.sectionCount} section${revision.sectionCount === 1 ? "" : "s"}`;
  const modules = `${revision.moduleCount} module${revision.moduleCount === 1 ? "" : "s"}`;
  return `${sections} · ${modules}`;
}

export function BuilderPageHistory({ pageId, pageName, onRestored }: BuilderPageHistoryProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [revisions, setRevisions] = useState<BuilderPageRevision[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState("");
  const [undoingRunId, setUndoingRunId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  /** Runs the server says were already undone — keyed by runId, render-only. */
  const [undoneRuns, setUndoneRuns] = useState<Record<string, boolean>>({});

  // The page the panel is CURRENTLY for. A multi-page undo takes seconds, so
  // every async flow re-checks this ref after each await and bails if the
  // operator has moved on — otherwise page A's slow response repaints its
  // rows under page B's heading.
  const pageIdRef = useRef(pageId);

  /**
   * Load the page's history. Returns true when the list on screen is fresh,
   * false when it could not be refreshed (or the operator switched pages
   * mid-flight) — callers use that to word their summary honestly instead of
   * pointing at a stale list.
   *
   * Clears `error` (it may set its own) but never `message`: restore and undo
   * set their summary AFTER awaiting this, and it must not wipe them.
   */
  const loadRevisions = useCallback(async (): Promise<boolean> => {
    if (!pageId) { setRevisions([]); return true; }
    setIsLoading(true);
    setError(null);
    try {
      const response = await builderAdminFetch(`/api/admin/pages/${pageId}/revisions`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        revisions?: BuilderPageRevision[];
        error?: string;
      };
      if (pageIdRef.current !== pageId) return false;
      if (!response.ok) {
        throw new Error(body.error ?? "Could not load this page's history.");
      }
      const list = Array.isArray(body.revisions) ? body.revisions : [];
      setRevisions(list);

      // Ask the server which of the visible runs were already undone, so the
      // button can say "Undone" up front rather than only after a click. A
      // page rarely shows more than a run or two; failures here just leave
      // the button active — the click-time check below still guards the replay.
      const runIds = Array.from(
        new Set(list.map((revision) => revision.propagationRunId).filter(Boolean))
      ) as string[];
      if (runIds.length) {
        const entries = await Promise.all(
          runIds.map(async (runId) => {
            try {
              const scope = await fetchPropagationRunScope(runId);
              return [runId, scope.undone] as const;
            } catch {
              return [runId, false] as const;
            }
          })
        );
        if (pageIdRef.current !== pageId) return false;
        // Merge, never replace: a run this session just undid stays marked
        // even if its scope lookup fails here — un-marking it would revive a
        // live Undo button on an undone run, the replay this state exists to
        // prevent. (Page switches clear the map wholesale.)
        setUndoneRuns((current) => ({
          ...current,
          ...Object.fromEntries(entries.filter(([, undone]) => undone).map(([runId]) => [runId, true])),
        }));
      }
      return true;
    } catch (e) {
      if (pageIdRef.current !== pageId) return false;
      setRevisions([]);
      setError(e instanceof Error ? e.message : "Could not load this page's history.");
      return false;
    } finally {
      if (pageIdRef.current === pageId) setIsLoading(false);
    }
  }, [pageId]);

  // Only fetch once the panel is actually open — history is 25 rows of
  // metadata per page and there is no reason to pay for it on every page click.
  useEffect(() => {
    if (collapsed) return;
    void loadRevisions();
  }, [collapsed, loadRevisions]);

  // A different page was selected: drop what we are showing so the previous
  // page's history can never be restored onto this one — and release the busy
  // flags, or a still-running undo on the OLD page keeps the new page's
  // buttons disabled until it returns.
  useEffect(() => {
    pageIdRef.current = pageId;
    setRevisions([]);
    setMessage(null);
    setError(null);
    setRestoringId("");
    setUndoingRunId("");
    setUndoneRuns({});
  }, [pageId]);

  async function restoreRevision(revision: BuilderPageRevision) {
    const confirmed = window.confirm(
      `Restore "${pageName}" to how it looked on ${formatWhen(revision.createdAt)}?\n\n` +
        `That version has ${describeSize(revision)}.\n\n` +
        `The way the page looks right now is saved to this history first, so you can undo this.`
    );
    if (!confirmed) return;

    setRestoringId(revision.id);
    setError(null);
    setMessage(null);
    try {
      const response = await builderAdminFetch(`/api/admin/pages/${pageId}/revisions/${revision.id}/restore`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not restore that version.");
      }
      await loadRevisions();
      if (pageIdRef.current !== pageId) return;
      setMessage(`Restored to the version from ${formatWhen(revision.createdAt)}.`);
      onRestored();
    } catch (e) {
      if (pageIdRef.current !== pageId) return;
      setError(e instanceof Error ? e.message : "Could not restore that version.");
    } finally {
      if (pageIdRef.current === pageId) setRestoringId("");
    }
  }

  /**
   * A `propagate` row banks only THIS page's pre-update state, so Restore
   * (above) already undoes the update for this page alone. This is the wider
   * action: every page the same push touched, restored the same way each
   * page's own restore already works — this page's current version is
   * banked to its own history first, so this can itself be undone.
   *
   * This is the durable path to that undo. The save-time banner
   * (admin-builder-editor.tsx) offers the same action but only in the
   * session that made the save; once it is dismissed or the page reloads,
   * this row — reachable any time from Page History — is what is left.
   */
  async function undoPropagationRun(revision: BuilderPageRevision) {
    const runId = revision.propagationRunId;
    if (!runId) return;

    setUndoingRunId(runId);
    setError(null);
    setMessage(null);
    try {
      // Fresh truth before the confirm: which pages still hold restore points
      // (retention pruning may have eaten some), and whether this run was
      // already undone — a second undo would replay old snapshots over
      // everything edited since, which costs one page of recovery per page.
      const scope = await fetchPropagationRunScope(runId);
      if (pageIdRef.current !== pageId) return;

      if (scope.undone) {
        setUndoneRuns((current) => ({ ...current, [runId]: true }));
        setMessage(ALREADY_UNDONE_MESSAGE);
        return;
      }
      if (!scope.pages.length) {
        setError("That update has no restore points left to undo.");
        return;
      }

      if (!window.confirm(confirmUndoMessage(scope))) return;

      const outcome = await performPropagationUndo(runId);
      if (pageIdRef.current !== pageId) return;

      // Even a partial undo banked revert revisions, so the run now reads as
      // undone — the failures are handled per page, not by pressing Undo again.
      setUndoneRuns((current) => ({ ...current, [runId]: true }));

      const refreshed = await loadRevisions();
      if (pageIdRef.current !== pageId) return;

      // ONE summary wins — never a green "Undone" beside a red load error.
      // If the refresh failed, the outcome is folded into a single honest
      // sentence instead of pointing the operator at a silently stale list.
      const summary = describeUndoOutcome(outcome);
      if (summary.kind === "partial") {
        setError(refreshed ? summary.text : `${summary.text} This list also could not refresh — press Refresh.`);
      } else if (refreshed) {
        setMessage(summary.text);
      } else {
        setError(`${summary.text} But this list could not refresh — press Refresh to see it.`);
      }
      onRestored();
    } catch (e) {
      if (pageIdRef.current !== pageId) return;
      setError(e instanceof Error ? e.message : "Could not undo that update.");
    } finally {
      if (pageIdRef.current === pageId) setUndoingRunId("");
    }
  }

  if (!pageId) return null;

  return (
    <div className="builder-toolbar-shell builder-page-history-shell">
      {/*
        The toggle is a DIRECT child of the shell, exactly like Workspace and
        every other collapsible builder panel — so its arrow lands on the same
        right edge as theirs.

        It used to be wrapped in `builder-pages-crud-heading-layout`, which
        reserves a fixed 112px column (plus a 20px gap) for heading buttons
        whether or not any are rendered. Page History's only heading action was
        Refresh, and only while expanded, so collapsed the panel sat with 132px
        of empty reserved space and an arrow visibly indented from its
        neighbours. The operator spotted it immediately (2026-08-16).

        Refresh moved into the body, beside the text explaining the list, which
        is where it belongs anyway: it acts on the list, not on the panel.
      */}
      <button
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand Page History" : "Collapse Page History"}
        className="builder-panel-toggle"
        onClick={() => setCollapsed((current) => !current)}
        title={collapsed ? "Expand Page History" : "Collapse Page History"}
        type="button"
      >
        <span className="panel-label">Page History</span>
        <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!collapsed} /></span>
      </button>

      {!collapsed ? (
        <div className="builder-page-history-body">
          <div className="builder-page-history-intro-row">
            <p className="builder-page-history-intro">
              Every version this page has been in, newest first. Each line says what the
              next save did to it. Restoring saves the current version here first, so
              nothing is ever a one-way door.
            </p>
            <button
              className="submit-button admin-blog-add-button builder-panel-heading-button"
              disabled={isLoading}
              onClick={() => void loadRevisions()}
              type="button"
            >
              {isLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {error ? <p className="builder-page-history-error">{error}</p> : null}
          {message ? <p className="builder-page-history-message">{message}</p> : null}

          {!error && !isLoading && !revisions.length ? (
            <p className="builder-page-history-empty">
              No earlier versions yet. The next time you save a layout change, the version
              you are replacing is kept here.
            </p>
          ) : null}

          {revisions.length ? (
            // Key by position AND label: groupByDay only merges CONSECUTIVE
            // rows, so Today / Earlier / Today is legal and two groups may
            // share a label — a bare label key makes React fold them together
            // and drop rows from the one panel whose job is a complete trail.
            groupByDay(revisions).map((group, groupIndex) => (
            <div className="builder-page-history-day" key={`${groupIndex}-${group.day}`}>
              <h4 className="builder-page-history-day-heading">{group.day}</h4>
            <ul className="builder-page-history-list">
              {group.rows.map((revision) => (
                <li className="builder-page-history-row" key={revision.id}>
                  <div className="builder-page-history-when">
                    <span className="builder-page-history-time">{formatWhen(revision.createdAt)}</span>
                    <span className="builder-page-history-reason">
                      {describeReason(revision)}
                    </span>
                  </div>
                  <span className="builder-page-history-what">
                    {revision.changeSummary?.trim() ? (
                      <span className="builder-page-history-change">{revision.changeSummary}</span>
                    ) : null}
                    <span className="builder-page-history-size">{describeSize(revision)}</span>
                  </span>
                  <div className="builder-page-history-actions">
                    <button
                      className="btn btn-ghost builder-page-history-restore"
                      disabled={Boolean(restoringId) || Boolean(undoingRunId)}
                      onClick={() => void restoreRevision(revision)}
                      type="button"
                    >
                      {restoringId === revision.id ? "Restoring..." : "Restore"}
                    </button>
                    {revision.propagationRunId ? (
                      undoneRuns[revision.propagationRunId] ? (
                        // "Not undone" and "already undone" must be
                        // distinguishable at the button: a live button on an
                        // undone run replays old snapshots over everything
                        // edited since.
                        <button
                          className="btn btn-ghost builder-page-history-undo-run"
                          disabled
                          title="This update was already undone. To redo it, restore pages from their own history."
                          type="button"
                        >
                          Undone
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost builder-page-history-undo-run"
                          disabled={Boolean(restoringId) || Boolean(undoingRunId)}
                          onClick={() => void undoPropagationRun(revision)}
                          title="Undoes this update on every page it touched, not just this one"
                          type="button"
                        >
                          {undoingRunId === revision.propagationRunId ? "Undoing..." : "Undo This Update"}
                        </button>
                      )
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            </div>
            ))
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
