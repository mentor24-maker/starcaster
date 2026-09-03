/**
 * Publish a NAMED set of pages — the second half of "Save & Publish".
 *
 * Saving a saved section rewrites it on every page that follows it, but only
 * in those pages' DRAFTS: `lib/canonicalPropagation.js` never touches
 * `builder_published_pages`. Before this existed, the operator's next step was
 * to leave the saved-section manager, find the Publish panel and push the
 * whole site live — a step easy to forget, and one that publishes more than he
 * meant to when he remembers it.
 *
 * TWO THINGS ARE LOAD-BEARING HERE.
 *
 * It NAMES the pages. `POST /api/builder/publish` with no `pageIds` publishes
 * everything pending, newest draft first. Wiring a saved-section save to that
 * would put every unrelated half-finished draft in the project in front of
 * visitors, silently, as a side effect of a routine section edit. So an empty
 * list publishes nothing and returns immediately rather than falling through
 * to the whole site.
 *
 * It LOOPS, it does not wait. The route writes one BATCH and answers with what
 * remains — the same shape `builder-publish-panel.tsx` drives, and for the same
 * reason: a long loop inside a serverless function was killed when its response
 * went out on 2026-07-22, leaving 30 pages updated and 20 stale. A batch that
 * dies costs that batch.
 */

export type PublishBatchResponse = { ok: boolean; json: () => Promise<unknown> };

export type PublishPagesResult = {
  /** How many pages went live. Zero is a legitimate answer, not a failure. */
  published: number;
  /** Null when every batch succeeded; otherwise what stopped it, in plain words. */
  error: string | null;
};

/** How many round trips we will make before deciding the server is not converging. */
const BATCH_GUARD = 500;

function errorMessageFrom(body: unknown): string | null {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const error = record?.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return null;
}

/**
 * @param post      Sends one `POST /api/builder/publish` with the given body.
 * @param pageIds   Exactly the pages to publish. Empty publishes nothing.
 */
export async function publishNamedPages(
  post: (body: Record<string, unknown>) => Promise<PublishBatchResponse>,
  pageIds: readonly string[]
): Promise<PublishPagesResult> {
  const ids = pageIds.map((id) => String(id ?? '').trim()).filter(Boolean);
  if (!ids.length) return { published: 0, error: null };

  let buildId: string | undefined;
  let published = 0;

  for (let guard = 0; guard < BATCH_GUARD; guard += 1) {
    let body: unknown;
    try {
      const response = await post(buildId ? { pageIds: ids, buildId } : { pageIds: ids });
      body = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { published, error: errorMessageFrom(body) ?? 'Publishing stopped part way.' };
      }
    } catch (e) {
      return { published, error: e instanceof Error ? e.message : 'Publishing stopped part way.' };
    }

    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const data = record?.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : null;
    if (!data) return { published, error: errorMessageFrom(body) ?? 'Publishing stopped part way.' };

    buildId = typeof data.buildId === 'string' ? data.buildId : buildId;
    published += Number(data.published ?? 0) || 0;
    if (data.done === true) return { published, error: null };
  }

  // Never silently: falling out of the loop means the server kept saying
  // "not done" without making progress, and reporting that as a clean publish
  // would tell him the site is live when some of it is not.
  return { published, error: 'Publishing did not finish — some pages may still be drafts.' };
}
