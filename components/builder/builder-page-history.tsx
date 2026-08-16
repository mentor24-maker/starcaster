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

import { useCallback, useEffect, useState } from "react";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
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
  const [message, setMessage] = useState<string | null>(null);

  const loadRevisions = useCallback(async () => {
    if (!pageId) { setRevisions([]); return; }
    setIsLoading(true);
    setError(null);
    try {
      const response = await builderAdminFetch(`/api/admin/pages/${pageId}/revisions`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        revisions?: BuilderPageRevision[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not load this page's history.");
      }
      setRevisions(Array.isArray(body.revisions) ? body.revisions : []);
    } catch (e) {
      setRevisions([]);
      setError(e instanceof Error ? e.message : "Could not load this page's history.");
    } finally {
      setIsLoading(false);
    }
  }, [pageId]);

  // Only fetch once the panel is actually open — history is 25 rows of
  // metadata per page and there is no reason to pay for it on every page click.
  useEffect(() => {
    if (collapsed) return;
    void loadRevisions();
  }, [collapsed, loadRevisions]);

  // A different page was selected: drop what we are showing so the previous
  // page's history can never be restored onto this one.
  useEffect(() => {
    setRevisions([]);
    setMessage(null);
    setError(null);
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
      setMessage(`Restored to the version from ${formatWhen(revision.createdAt)}.`);
      await loadRevisions();
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore that version.");
    } finally {
      setRestoringId("");
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
            groupByDay(revisions).map((group) => (
            <div className="builder-page-history-day" key={group.day}>
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
                  <button
                    className="btn btn-ghost builder-page-history-restore"
                    disabled={Boolean(restoringId)}
                    onClick={() => void restoreRevision(revision)}
                    type="button"
                  >
                    {restoringId === revision.id ? "Restoring..." : "Restore"}
                  </button>
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
