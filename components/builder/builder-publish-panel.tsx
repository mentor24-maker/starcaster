"use client";

/**
 * Publish — the moment drafts become what visitors see.
 *
 * THE CONTRACT (operator, 2026-08-16)
 *   Draft resolves live      — you change a theme or a header and see it
 *                              immediately.
 *   Published materializes   — the built row is a snapshot of the resolved
 *                              result, frozen until you publish again.
 *
 * This panel is the only place that second half is visible, which makes the
 * COUNT its real job. Publishing is now a step, and a step you can forget is
 * worse than no step at all: without a number in front of him the operator
 * edits all afternoon and the site silently stays where it was this morning.
 * So the headline is the count, in words, before any button.
 *
 * IT LOOPS, IT DOES NOT WAIT.
 * POST /api/builder/publish writes one BATCH and answers with how many remain.
 * This keeps calling until `done`, showing progress as it goes. That shape is
 * load-bearing rather than cosmetic: propagateCanonicalSection was one long
 * loop inside a serverless function and on 2026-07-22 it was killed when the
 * response went out, leaving 30 pages updated and 20 stale. A batch that dies
 * costs that batch; pressing Publish again picks up exactly where it stopped.
 */

import { useCallback, useEffect, useState } from "react";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import { BuilderCollapseIcon } from "./builder-collapse-icon";

type PendingPage = { id: string; slug: string; name: string };

export type PublishStatus = {
  pending: number;
  total: number;
  pages: PendingPage[];
};

type BuilderPublishPanelProps = {
  /** Bumped by the editor after a save, so the count reflects what just changed. */
  refreshKey?: number;
  onPublished?: () => void;
};

async function publishFetch(path: string, init: RequestInit = {}) {
  return fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...starcasterScopedHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...((init.headers as Record<string, string>) ?? {})
    }
  });
}

export function describePending(status: PublishStatus | null): string {
  if (!status) return "";
  if (status.pending === 0) {
    return status.total === 0
      ? "There are no pages to publish yet."
      : "Everything is published. The live site matches your drafts.";
  }
  if (status.pending === 1) return "1 page has changes that are not live yet.";
  return `${status.pending} pages have changes that are not live yet.`;
}

export function BuilderPublishPanel({ refreshKey = 0, onPublished }: BuilderPublishPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [progress, setProgress] = useState<{ published: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await publishFetch("/api/builder/publish/status");
      const body = (await response.json().catch(() => ({}))) as {
        data?: PublishStatus;
        error?: { message?: string } | string;
      };
      if (!response.ok) {
        const message = typeof body.error === "string" ? body.error : body.error?.message;
        throw new Error(message ?? "Could not read what is waiting to publish.");
      }
      setStatus(body.data ?? null);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Could not read what is waiting to publish.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus, refreshKey]);

  async function publish() {
    if (!status || status.pending === 0) return;

    setIsPublishing(true);
    setError(null);
    setMessage(null);
    setProgress({ published: 0, total: status.pending });

    let buildId: string | undefined;
    let published = 0;

    try {
      // Keep asking for another batch until the server says it is done. Each
      // answer is authoritative about what is left, so this holds no state the
      // server could disagree with.
      for (let guard = 0; guard < 500; guard += 1) {
        const response = await publishFetch("/api/builder/publish", {
          method: "POST",
          body: JSON.stringify(buildId ? { buildId } : {})
        });
        const body = (await response.json().catch(() => ({}))) as {
          data?: { buildId: string; published: number; remaining: number; done: boolean };
          error?: { message?: string } | string;
        };
        if (!response.ok || !body.data) {
          const message = typeof body.error === "string" ? body.error : body.error?.message;
          throw new Error(message ?? "Publishing stopped part way.");
        }

        buildId = body.data.buildId;
        published += body.data.published;
        setProgress({ published, total: published + body.data.remaining });
        if (body.data.done) break;
      }

      setMessage(
        published === 1
          ? "Published 1 page. It is live now."
          : `Published ${published} pages. They are live now.`
      );
      onPublished?.();
    } catch (e) {
      // Whatever was written before the failure is live and complete; only the
      // pages not yet reached are still on their previous version.
      setError(
        (e instanceof Error ? e.message : "Publishing stopped part way.") +
        ` ${published} page${published === 1 ? "" : "s"} went live before it stopped — press Publish again to finish the rest.`
      );
    } finally {
      setIsPublishing(false);
      await loadStatus();
    }
  }

  const pending = status?.pending ?? 0;
  const hasPending = pending > 0;

  return (
    <div className="builder-toolbar-shell builder-publish-shell">
      <div className="builder-pages-crud-heading-layout">
        <div className="builder-pages-crud-heading-primary">
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand Publish" : "Collapse Publish"}
            className="builder-panel-toggle"
            onClick={() => setCollapsed((current) => !current)}
            type="button"
          >
            {/* Label and count are ONE flex child: the toggle spreads its
                children apart, so a loose badge drifts into the middle of the
                header instead of reading as part of the title. */}
            <span className="builder-publish-label-group">
              <span className="panel-label">Publish</span>
              {hasPending ? <span className="builder-publish-count">{pending}</span> : null}
            </span>
            <span className="builder-panel-toggle-icon"><BuilderCollapseIcon expanded={!collapsed} /></span>
          </button>
        </div>
        <div className="builder-pages-crud-heading-actions">
          <button
            className="submit-button admin-blog-add-button builder-panel-heading-button"
            disabled={isLoading || isPublishing}
            onClick={() => void loadStatus()}
            type="button"
          >
            {isLoading ? "Checking..." : "Check"}
          </button>
          <button
            className="submit-button admin-blog-add-button builder-panel-heading-button"
            disabled={!hasPending || isPublishing || isLoading}
            onClick={() => void publish()}
            title={hasPending ? `Publish ${pending} page(s)` : "Nothing to publish"}
            type="button"
          >
            {isPublishing ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>

      {!collapsed ? (
        <div className="builder-publish-body">
          <p className={`builder-publish-headline${hasPending ? " is-pending" : ""}`}>
            {isLoading && !status ? "Checking what is waiting…" : describePending(status)}
          </p>

          {error ? <p className="builder-publish-error">{error}</p> : null}
          {message ? <p className="builder-publish-message">{message}</p> : null}

          {isPublishing && progress ? (
            <p className="builder-publish-progress">
              Publishing {progress.published} of {progress.total}…
            </p>
          ) : null}

          {hasPending && status ? (
            <>
              <p className="builder-publish-note">
                Publishing takes a snapshot of these pages as they are now. Your drafts are
                untouched, and anything you have not published stays exactly as it is on the
                live site.
              </p>
              <ul className="builder-publish-list">
                {status.pages.map((page) => (
                  <li className="builder-publish-row" key={page.id}>
                    <span className="builder-publish-page-name">{page.name || "Untitled page"}</span>
                    <span className="builder-publish-page-slug">/{page.slug}</span>
                  </li>
                ))}
                {status.pending > status.pages.length ? (
                  <li className="builder-publish-row builder-publish-more">
                    …and {status.pending - status.pages.length} more
                  </li>
                ) : null}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
