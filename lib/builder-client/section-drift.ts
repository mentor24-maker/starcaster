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
 * `id`, `savedSectionId`, `canonical` and `canonicalSourceHash` are what a
 * push always overwrites (`propagateCanonicalSection`,
 * lib/canonicalPropagation.js) — a difference in exactly those four fields is
 * not drift, it is provenance. Everything else is content, and content that
 * differs from the master is the whole signal.
 *
 * ------------------------------------------------------- the copy's lineage
 *
 * Comparing against the master alone answers the question WRONG in one
 * situation, and it is the situation a half-failed push creates.
 *
 * A push writes the master's new content to every following page. If one
 * page's write FAILS, the master has still been saved — so on the retry the
 * "before" this compares against IS the new content, and the clean copy that
 * simply never got written now differs from it. It reads as a hand edit. The
 * page is skipped, the editor offers "Overwrite anyway?", and taking that
 * offer flattens the real hand edit sitting beside it — the one the first
 * push deliberately spared (task 86bbwe530).
 *
 * So a copy carries its own lineage: `canonicalSourceHash`, a hash of the
 * content the last push actually wrote into it. A copy whose content still
 * hashes to its own stamp was not hand-edited, whatever the master says now.
 *
 * THE STAMP CAN ONLY EVER CLEAR DRIFT, NEVER CREATE IT. The content
 * comparison runs first and a copy matching its master is clean full stop;
 * only then may the stamp rescue a copy that differs. That ordering is not a
 * style choice — it is what makes a missing, stale or unreproducible stamp
 * cost nothing: the answer falls straight back to the comparison this file
 * has always made. A stamp that could ASSERT drift would, the first time
 * normalization moved a field, report every copy on every page as
 * hand-edited and arm a force-overwrite banner across the whole site.
 *
 * THE STAMP IS THE PROPAGATION READING, AND ONLY THAT. `hasSectionDrifted`
 * answers one question — "may a push overwrite this copy?" — and five callers
 * ask it. A caller deciding whether to REPLACE a copy's content is asking a
 * different question, "does this copy already match the master?", and the
 * stamp is the wrong answer to it: a copy a failed push never reached is not
 * a hand edit, so this returns false, while the copy is plainly stale.
 * `handleToggleSectionCanonical` (components/admin-builder-editor.tsx) shared
 * the first answer and, from round 1 of this task, marked a stale copy as
 * Following with the old content still on the page. That call site now asks
 * `relinkReading` below. Anything else that replaces content must too.
 *
 * A copy is stamped by the push that writes it, so copies converge as blocks
 * get saved — exactly the "read both, write one" discipline the `canonical`
 * flag itself uses (lib/canonicalPropagation.js). Until a copy has been
 * through one successful push it carries no stamp and behaves as it always
 * did.
 *
 * This file has a hand-ported CommonJS twin, lib/builder/document.js, so the
 * server (plain Node, cannot require TypeScript) and the browser bundle agree
 * on what "drifted" means. Keep the two in sync by hand — see that file's
 * copy of these functions. The shared fixture hash in both test suites is
 * what fails when they drift apart.
 */

/** Only the fields the comparison touches — structural, so fixtures stay light. */
export type DriftableSection = {
  id?: string;
  savedSectionId?: string;
  canonical?: boolean;
  /** Hash of the content the last push wrote here. See the header. */
  canonicalSourceHash?: string;
  [key: string]: unknown;
};

/** The field a copy records its lineage in. Named once, read everywhere. */
export const SECTION_LINEAGE_FIELD = "canonicalSourceHash";

/** Strip what a push always overwrites, leaving only comparable content. */
export function getSectionContent(section: DriftableSection | null | undefined): Record<string, unknown> {
  if (!section || typeof section !== "object") return {};
  const { id, savedSectionId, canonical, canonicalSourceHash, ...content } = section;
  return content;
}

/**
 * JSON with the keys in a fixed order, at every level.
 *
 * `JSON.stringify` writes keys in insertion order, and the stamp is compared
 * across a database round trip — where Postgres `jsonb` stores an object with
 * its keys REORDERED (shortest first, then bytewise) and hands them back that
 * way. So the same section, hashed before the write and after the read, gave
 * two different values and the stamp never matched again. Measured on the UI
 * fixture, 2026-09-14: `7de16ca664cf1592` going in, `9c1cb37c65d05058` coming
 * back, on a section whose content had not changed at all.
 *
 * It failed safe — an unmatched stamp just falls back to the master
 * comparison — which is exactly why it needed measuring rather than reasoning
 * about: the fix would have shipped doing nothing, and every test built on one
 * side of the round trip would have passed.
 *
 * Note this is the HASH's rule, not the comparison's: `hasSectionDrifted`
 * still compares two in-memory objects with plain `JSON.stringify`, where both
 * sides come from the same normalizer and order is not in question.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    // An undefined-valued key is omitted by JSON.stringify; omit it here too,
    // so a section carrying `x: undefined` hashes the same as one without it.
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(",")}}`;
}

/**
 * FNV-1a, 32 bits, run twice from different offsets and concatenated.
 *
 * Hand-rolled rather than imported because this has to give the same answer
 * in a browser bundle and in plain Node, and `node:crypto` exists in only one
 * of them. Two rounds because a 32-bit stamp collides at about one in four
 * billion and a collision here reads a hand edit as clean — which is the
 * damage the stamp exists to prevent.
 */
function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The stamp value for a section's content, provenance excluded. */
export function sectionContentHash(section: DriftableSection | null | undefined): string {
  const text = stableStringify(getSectionContent(section));
  return (
    fnv1a32(text, 0x811c9dc5).toString(16).padStart(8, "0")
    + fnv1a32(text, 0x9e3779b1).toString(16).padStart(8, "0")
  );
}

/** Record, on this copy, the content a push has just written into it. */
export function stampSectionLineage<S extends DriftableSection>(section: S): S {
  return { ...section, [SECTION_LINEAGE_FIELD]: sectionContentHash(section) };
}

/**
 * True when `instance`'s content no longer matches `master`'s AND the
 * instance's own lineage does not account for the difference — i.e. this copy
 * was edited directly rather than through the master.
 *
 * Fails OPEN on purpose, same reasoning as `isStaleEdit`
 * (lib/builderPagesStore.js): a missing instance or master reads as "cannot
 * compare" and proceeds as an ordinary push, rather than "assume drifted"
 * silently skipping pages a caller never asked to protect.
 */
export function hasSectionDrifted(
  instance: DriftableSection | null | undefined,
  master: DriftableSection | null | undefined
): boolean {
  if (!instance || !master) return false;
  if (sectionMatchesMaster(instance, master)) return false;
  // It differs from the master. The only thing that can clear it now is the
  // copy's own record of what the last push put here.
  const stamp = typeof instance[SECTION_LINEAGE_FIELD] === "string" ? String(instance[SECTION_LINEAGE_FIELD]) : "";
  if (stamp && sectionContentHash(instance) === stamp) return false;
  return true;
}

/**
 * True when this copy's content is already identical to the master's, once
 * provenance is stripped. No lineage stamp involved.
 *
 * THIS IS THE OTHER QUESTION, and it is the one a caller that REPLACES content
 * has to ask. `hasSectionDrifted` answers "may a push overwrite this copy?" —
 * and a copy a failed push never reached answers *no* to that while being a
 * perfectly stale copy. Ask it "does this already match?" and it says false
 * when the truth is "it does not match, but it is not your edit either".
 * Sharing the first answer with the relink toggle marked a stale copy as
 * Following while it still showed the old content (task 86bbwe530, round 1).
 */
export function sectionMatchesMaster(
  instance: DriftableSection | null | undefined,
  master: DriftableSection | null | undefined
): boolean {
  return JSON.stringify(getSectionContent(instance)) === JSON.stringify(getSectionContent(master));
}

/**
 * The three states a copy can be in relative to its master, for any caller
 * deciding whether to pull the original's content back in.
 *
 *   matches       — identical already. Flip the flag and change nothing.
 *   awaiting-push — differs, but the copy's own stamp says the difference is a
 *                   push that never reached it. Nothing of the operator's is
 *                   in here, so take the master's content WITHOUT asking.
 *   hand-edited   — differs and the stamp does not explain it. This is the
 *                   operator's work; ask before replacing it.
 *
 * The middle state is the whole point. Collapsing it into either neighbour is
 * a bug in opposite directions: fold it into `matches` and the relink leaves
 * stale content on the page under a "Following" label, fold it into
 * `hand-edited` and the operator is asked to rescue local changes that do not
 * exist.
 *
 * Fails OPEN, like `hasSectionDrifted`: nothing to compare reads as `matches`,
 * so a caller proceeds exactly as it did before any of this existed.
 */
export type RelinkReading = "matches" | "awaiting-push" | "hand-edited";

export function relinkReading(
  instance: DriftableSection | null | undefined,
  master: DriftableSection | null | undefined
): RelinkReading {
  if (!instance || !master) return "matches";
  if (sectionMatchesMaster(instance, master)) return "matches";
  return hasSectionDrifted(instance, master) ? "hand-edited" : "awaiting-push";
}
