/**
 * Has a following copy of a shared section been edited directly, so it no
 * longer matches its master?
 *
 * A copy is either "Following" (still linked, takes every master push) or
 * "Independent" (unlinked on purpose) — but nothing has ever told those two
 * apart from a THIRD case: still marked Following, yet quietly hand-edited on
 * one page while `canonical` stayed true. A push cannot tell that copy from
 * an ordinary one and flattens both — which is what cost the Delray home page
 * 35 sections on 2026-07-21.
 *
 * `id`, `savedSectionId` and `canonical` are what a push always overwrites
 * (`propagateCanonicalSection`, lib/builderPagesStore.js) — a difference in
 * exactly those three fields is not drift, it is provenance. Everything else
 * is content, and content that differs from the master is the whole signal.
 *
 * This file has a hand-ported CommonJS twin, lib/builder/document.js, so the
 * server (plain Node, cannot require TypeScript) and the browser bundle agree
 * on what "drifted" means. Keep the two in sync by hand — see that file's
 * copy of these two functions.
 */

/** Only the fields the comparison touches — structural, so fixtures stay light. */
export type DriftableSection = {
  id?: string;
  savedSectionId?: string;
  canonical?: boolean;
  [key: string]: unknown;
};

/** Strip what a push always overwrites, leaving only comparable content. */
export function getSectionContent(section: DriftableSection | null | undefined): Record<string, unknown> {
  if (!section || typeof section !== "object") return {};
  const { id, savedSectionId, canonical, ...content } = section;
  return content;
}

/**
 * True when `instance`'s content no longer matches `master`'s — i.e. this
 * copy was edited directly rather than through the master. Fails OPEN on
 * purpose, same reasoning as `isStaleEdit` (lib/builderPagesStore.js): a
 * missing instance or master reads as "cannot compare" and proceeds as an
 * ordinary push, rather than "assume drifted" silently skipping pages a
 * caller never asked to protect.
 */
export function hasSectionDrifted(
  instance: DriftableSection | null | undefined,
  master: DriftableSection | null | undefined
): boolean {
  if (!instance || !master) return false;
  return JSON.stringify(getSectionContent(instance)) !== JSON.stringify(getSectionContent(master));
}
