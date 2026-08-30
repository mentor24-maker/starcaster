/**
 * A saved section had TWO names, and renaming it only ever changed one.
 *
 * The manager row carries `name`. The content it stores carries its own
 * `section.title`, and that is the one every page card shows in bold. Nothing
 * kept them together: a rename in the manager wrote `name` alone, then
 * `propagateCanonicalSection` (lib/builderPagesStore.js) pushed the master's
 * content — stamped title included — back over every following page, so the
 * cards snapped straight back to the old name. Dane renamed the Delray site
 * header three times on 2026-08-29 and watched it revert three times. The only
 * thing that had ever moved the stamped title was a push FROM a page (unlock →
 * retitle → save to master), which nobody would guess.
 *
 * The rule this file encodes is that there is ONE name:
 *
 *   - Renaming the master restamps the content's title, so the fan-out that
 *     was undoing the rename now carries it (`applySavedSectionName`).
 *   - A following copy is DISPLAYED under the master's name, whatever title
 *     its own row happens to hold, so an old stamp can never contradict the
 *     manager on screen (`resolveSharedSectionTitle`).
 *   - A save that moves the name says how far that reaches, in the same
 *     dialog that already says how far the content reaches
 *     (`describeSavedSectionRename`).
 *
 * PURE BY CONSTRUCTION. Nothing here writes or fetches; the callers
 * (`saveSavedSection` in components/admin-builder-editor.tsx, `handleSave` in
 * components/builder/saved-section-editor-modal.tsx) own the PATCH. That is
 * deliberate — those are the only two places that PATCH a master, and keeping
 * the rule here rather than in routes/builder.js avoids a hand-ported CommonJS
 * twin of the kind `hasSectionDrifted` needs (./section-drift).
 */
import { describeUsage, type BlockUsage } from "./shared-block-usage";

/**
 * Matches `safeText(input.name, 255)` in lib/builderSavedSectionsStore.js and
 * `safeText(normalizedSection.title, 255)` in ./builder-template. Both ends
 * truncate at the same point, so a long name cannot make the two diverge again
 * through the back door.
 */
export const SAVED_SECTION_NAME_MAX = 255;

/** Only the field this touches — structural, so fixtures stay light. */
export type TitledSection = { title?: string };

/** The trimmed, truncated string a name becomes when stamped onto content. */
export function savedSectionTitleFor(name: string | null | undefined): string {
  return String(name ?? "").trim().slice(0, SAVED_SECTION_NAME_MAX);
}

/**
 * True when saving `section` under `name` would move the stamped title.
 *
 * Asked before the write so the impact dialog can mention the rename, and
 * asked again by {@link applySavedSectionName} so an unchanged title returns
 * the SAME object — a fresh copy with identical content would still count as a
 * write, and `hasSectionDrifted` compares content by value, so churn here is
 * free but pointless.
 */
export function savedSectionTitleChanges(
  section: TitledSection | null | undefined,
  name: string | null | undefined
): boolean {
  const title = savedSectionTitleFor(name);
  if (!title) return false;
  return String(section?.title ?? "").trim() !== title;
}

/**
 * Stamp the row's name onto the content, so a fan-out carries the rename.
 *
 * An empty name is left alone rather than blanking the title: the store
 * rejects an empty name anyway, and a helper that can erase a title on a
 * validation slip is a worse bug than the one it fixes.
 */
export function applySavedSectionName<T extends TitledSection>(
  section: T,
  name: string | null | undefined
): T {
  if (!section || typeof section !== "object") return section;
  if (!savedSectionTitleChanges(section, name)) return section;
  return { ...section, title: savedSectionTitleFor(name) };
}

/**
 * The extra line for the impact dialog when a save also moves the name.
 *
 * `null` when nothing moves or nothing follows — the dialogs already return
 * null in those cases, and a rename nobody else sees is not worth a sentence.
 */
export function describeSavedSectionRename(
  section: TitledSection | null | undefined,
  name: string | null | undefined,
  usage: BlockUsage | null | undefined
): string | null {
  if (!savedSectionTitleChanges(section, name)) return null;
  const pages = usage?.pages ?? 0;
  if (pages < 1) return null;

  const previous = String(section?.title ?? "").trim();
  const next = savedSectionTitleFor(name);
  return previous
    ? `This also renames it on ${describeUsage(usage)} — they currently show "${previous}", and will show "${next}".`
    : `This also renames it on ${describeUsage(usage)}, which will show "${next}".`;
}

export type SharedSectionTitleInput = {
  /** True when this copy still takes updates from a master (`canonical`). */
  isFollowing?: boolean;
  /** The master's name, when it could be resolved from the saved sections. */
  masterName?: string | null;
  /** The title stamped on this copy's own content. */
  title?: string | null;
  /** Shown when there is no name of any kind — e.g. "Section 3". */
  fallback: string;
};

/**
 * The ONE name a section card shows.
 *
 * A following copy is shown under its master's name. That is the display half
 * of the fix: the data may still hold a stale stamp — 550 production rows do,
 * and no migration is being run over them — but the card can no longer show a
 * name the manager disagrees with. Once a rename propagates, the two agree and
 * this returns the same string either way.
 *
 * A copy the master could not be resolved for falls back to its own stamp,
 * because a deleted master leaves the stamp as the only name there is.
 */
export function resolveSharedSectionTitle({
  isFollowing = false,
  masterName,
  title,
  fallback,
}: SharedSectionTitleInput): string {
  const master = String(masterName ?? "").trim();
  if (isFollowing && master) return master;

  const stamped = String(title ?? "").trim();
  // Legacy stamps from before the canonical chip existed ended in the literal
  // word "Canonical"; the card has always stripped it, and it must keep being
  // stripped in the one place that now decides the heading.
  const cleaned = isFollowing && stamped.endsWith("Canonical")
    ? stamped.slice(0, -"Canonical".length).trim()
    : stamped;
  return cleaned || fallback;
}
