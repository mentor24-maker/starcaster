/**
 * Does this copy follow its master? — the browser's copy of the one rule.
 *
 * Sync 7/7 collapsed two propagation engines into one, and with them two
 * spellings of the same fact. `canonical === true` is now the single answer at
 * both levels: a shared section's copy and a shared module's copy say it the
 * same way.
 *
 * Getting there without rewriting saved data on live tenant pages means the
 * READER still understands every spelling that has ever been stored, while
 * every WRITER emits only the new one. That is what these two functions are.
 *
 * THIS FILE HAS A SERVER TWIN: `followsMaster` / `markFollowing` in
 * `lib/canonicalPropagation.js`, hand-ported because plain Node cannot require
 * TypeScript — the same arrangement `section-drift.ts` has with
 * `lib/builder/document.js`. If you change the rule here, change it there, or
 * the badge on a module card and the push behind it will disagree about which
 * copies are following.
 *
 * WHY THE HISTORIC DEFAULT DIFFERS BY LEVEL, and why that must be preserved
 * rather than tidied away: inserting a saved SECTION has always offered
 * "linked" or "just a copy", so a section carrying provenance but no
 * `canonical` flag is the copy — it does not follow. A saved MODULE never had
 * an opt-in, only the `canonicalLocked` opt-out, so an unmarked module copy
 * DOES follow. Flip either default and copies on live client pages silently
 * change behaviour, which is the one failure mode nobody would see: a page
 * that quietly stopped following its master looks exactly like a page nobody
 * has edited.
 */

/** The two fields the rule reads, on either kind of copy. */
export type CanonicalFollowFlags = {
  canonical?: boolean;
  canonicalLocked?: boolean;
};

/** True when this copy of a shared MODULE takes updates from its master. */
export function moduleFollowsMaster(module: CanonicalFollowFlags | null | undefined): boolean {
  if (!module) return false;
  // The legacy opt-out outranks a stale `canonical: true` a push may have
  // stamped before the copy was locked.
  if (module.canonicalLocked === true) return false;
  if (typeof module.canonical === "boolean") return module.canonical;
  return true; // unmarked module copies have always followed
}

/** True when this copy of a shared SECTION takes updates from its master. */
export function sectionFollowsMaster(section: CanonicalFollowFlags | null | undefined): boolean {
  if (!section) return false;
  if (section.canonicalLocked === true) return false;
  if (typeof section.canonical === "boolean") return section.canonical;
  return false; // unmarked section copies have never followed
}

/**
 * Write the answer, in the one spelling.
 *
 * `canonicalLocked` is REMOVED rather than left behind agreeing: two fields
 * holding one fact is how they came to disagree, and the readers above give
 * the leftover field the last word.
 */
export function setFollowsMaster<T extends CanonicalFollowFlags>(copy: T, follows: boolean): T {
  const next = { ...copy, canonical: follows };
  delete next.canonicalLocked;
  return next;
}
