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
import { type BlockUsage } from "./shared-block-usage";

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
  // EXACT, not trimmed. The comparison has to be against the string that will
  // actually be stored, or the guard reports "no change" while the write moves
  // the value: a copy titled "  Header  " under the name "Header" was left
  // alone here, the master was written with "Header", and `hasSectionDrifted`
  // — which compares content verbatim — then read the copy as hand-edited the
  // instant it relinked. Same shape for a title past SAVED_SECTION_NAME_MAX,
  // where the stamp truncates and the untouched copy does not.
  return String(section?.title ?? "") !== title;
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
 * The row name a push FROM a page leaves on the master.
 *
 * The page's own title becomes the master's name — that push is the one path
 * that has ever moved the stamped title — and an untitled section keeps the
 * name the master already has, because a push must never blank it.
 *
 * It lives here rather than inline at the call site because TWO places need
 * the same answer: the push itself, and the dialog that warns about it before
 * the write. Those were the same expression written twice, and the dialog's
 * copy is exactly what went stale.
 */
export function savedSectionNameAfterPush(
  section: TitledSection | null | undefined,
  currentName: string | null | undefined
): string {
  return savedSectionTitleFor(section?.title) || String(currentName ?? "").trim();
}

/**
 * The extra line for the impact dialog when a save also moves the name.
 *
 * Takes the master's CURRENT ROW NAME and the name it is about to carry —
 * never a stamped content title. That distinction is the whole correctness of
 * this function. The row name is the thing a save renames; on the ~550 legacy
 * masters whose `name` and `section.title` still disagree, comparing the
 * stamps asked whether "Menu Banner" was becoming "Menu Banner", answered no,
 * and stayed silent while the row name went from "2a - Header" to
 * "Menu Banner" — the reported bug again, reached through the other door.
 *
 * `drifted` is the count from `driftedFollowingPages`: those copies are
 * skipped by the fan-out, so they keep their old stamp. Stating the reach
 * without it put two different counts in one dialog, directly under the
 * drift-aware sentence from `describePushImpact`.
 *
 * `null` when nothing moves or the rename reaches no page — the dialogs
 * already return null in those cases, and a rename nobody else sees is not
 * worth a sentence.
 */
export function describeSavedSectionRename(
  previousName: string | null | undefined,
  nextName: string | null | undefined,
  usage: BlockUsage | null | undefined,
  drifted = 0
): string | null {
  const previous = String(previousName ?? "").trim();
  const next = savedSectionTitleFor(nextName);
  if (!next || previous === next) return null;

  const pages = usage?.pages ?? 0;
  const willRename = Math.max(0, pages - Math.max(0, drifted));
  if (willRename < 1) return null;

  const reach = willRename === 1 ? "1 page" : `${willRename} pages`;
  return previous
    ? `This also renames it on ${reach} — they currently show "${previous}", and will show "${next}".`
    : `This also renames it on ${reach}, which will show "${next}".`;
}

/** The shape this needs off a stored master — everything else rides along. */
export type StoredMasterSection = Record<string, unknown> & {
  background?: unknown;
  modules?: unknown;
};

/**
 * The page's own copy of a section, after that copy has been pushed over its
 * master (`overwriteCanonicalFromSection`, components/admin-builder-editor.tsx).
 *
 * It takes the master's content AS THE SERVER STORED IT, keeping only this
 * copy's own `id`. Relinking used to mean setting `savedSectionId` and
 * `canonical` on the copy and nothing more — so the copy went on holding the
 * client-side object it was pushed from, while the master held the server's
 * normalised version of it. `hasSectionDrifted` (./section-drift) compares
 * content verbatim, so the copy read as hand-edited THE INSTANT it relinked,
 * and every later fan-out skipped the page. Two ways that bit:
 *
 *   - the title. An untitled page section pushed up named the master from the
 *     master's own row name, leaving the copy's title empty and the master's
 *     set — and the same for a title that only differed by padding or by the
 *     {@link SAVED_SECTION_NAME_MAX} truncation.
 *   - every other field. The save route normalises a section on write, filling
 *     in some forty defaults the client never sent, so the two differed even
 *     when the titles matched exactly.
 *
 * Taking the stored master wholesale answers both, and cannot be reopened by
 * a new default appearing in the normaliser. It is the same move
 * `handleToggleSectionCanonical` already makes when it reverts a copy to its
 * master — including the fresh `background` and `modules` copies, so the
 * page's draft never shares mutable objects with the saved-sections list.
 */
export function relinkPushedSection<M extends StoredMasterSection>(
  section: { id?: string } | null | undefined,
  storedMasterSection: M,
  savedSectionId: string
): M & { id?: string; savedSectionId: string; canonical: true } {
  const master = (storedMasterSection ?? {}) as M;
  const background = master.background;
  const modules = master.modules;
  return {
    ...master,
    ...(background && typeof background === "object" ? { background: { ...(background as object) } } : {}),
    ...(Array.isArray(modules)
      ? {
          modules: modules.map((module) => ({
            ...(module as object),
            settings: { ...((module as { settings?: object })?.settings ?? {}) },
          })),
        }
      : {}),
    id: section?.id,
    savedSectionId,
    canonical: true,
  };
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
