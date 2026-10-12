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

import { useCallback, useEffect, useRef, useState } from "react";
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
  /**
   * Bumped by the editor after a SUCCESSFUL Save Page: once the re-check this
   * triggers has answered, the Publish button is scrolled into view and takes
   * the focus, so the next step is one Enter away instead of a scroll hunt
   * (operator, 2026-10-11, task 86bcgmztg). Nothing moves when nothing is
   * waiting — a disabled button cannot take focus, and there is no next step.
   */
  focusRequestKey?: number;
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

/** Marks a button that was just handed the focus, so CSS can ring it. */
export const FOCUS_HANDOFF_ATTR = "data-builder-focus-handoff";

/**
 * Bring a button into view and give it the keyboard focus. One smooth scroll
 * and a focus that does not scroll again, so the page moves once rather than
 * jumping and then gliding. Exported for the editor's Close Builder hand-off.
 *
 * The focus must also be SEEN. Save Page is clicked with the mouse, and after
 * a mouse click the browser hides the focus ring, so Publish had the focus
 * with no outline and nothing told Dane that Enter would publish. So the
 * button asks for a visible ring (`focusVisible`, which Chrome and Firefox
 * honour) and carries a marker attribute that `_builder-react-overrides.css`
 * draws a ring from in every browser, until the focus moves on.
 */
export function revealAndFocus(element: HTMLElement | null): boolean {
  if (!element || !element.isConnected) return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  element.scrollIntoView?.({ block: "center", behavior: "smooth" });
  element.setAttribute(FOCUS_HANDOFF_ATTR, "");
  element.addEventListener("blur", () => element.removeAttribute(FOCUS_HANDOFF_ATTR), { once: true });
  element.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  return true;
}

export function BuilderPublishPanel({ refreshKey = 0, focusRequestKey = 0, onPublished }: BuilderPublishPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [progress, setProgress] = useState<{ published: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const publishButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusRequestRef = useRef(focusRequestKey);
  // Bumped only once a requested re-check has come back with work waiting;
  // the effect below runs after THAT render, when the button is enabled.
  const [focusPublishNonce, setFocusPublishNonce] = useState(0);

  const loadStatus = useCallback(async (): Promise<PublishStatus | null> => {
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
      return body.data ?? null;
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Could not read what is waiting to publish.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wait for the count before moving focus: until the re-check answers, the
    // Publish button is disabled and focusing it does nothing.
    const wantsFocus = focusRequestKey !== lastFocusRequestRef.current;
    lastFocusRequestRef.current = focusRequestKey;
    void loadStatus().then((loaded) => {
      if (wantsFocus && loaded && loaded.pending > 0) setFocusPublishNonce((current) => current + 1);
    });
  }, [loadStatus, refreshKey, focusRequestKey]);

  useEffect(() => {
    if (focusPublishNonce) revealAndFocus(publishButtonRef.current);
  }, [focusPublishNonce]);

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
          {/*
            Blue, not green. `admin-blog-add-button` is the GREEN face — "save
            this draft" — and every button in the Builder header wore it, so
            Publish was the same colour as Save Page and read as one more
            routine save. That is a large part of why the Publish step kept
            getting missed (operator, 2026-08-30, task 86bbq5jvz). Dropping the
            class leaves the base `.submit-button` blue: the primary action of
            the screen. Neither of these two saves a draft.
          */}
          <button
            className="submit-button builder-panel-heading-button"
            disabled={isLoading || isPublishing}
            onClick={() => void loadStatus()}
            type="button"
          >
            {isLoading ? "Checking..." : "Check"}
          </button>
          <button
            className="submit-button builder-panel-heading-button"
            disabled={!hasPending || isPublishing || isLoading}
            onClick={() => void publish()}
            ref={publishButtonRef}
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
