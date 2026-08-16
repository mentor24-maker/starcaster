/**
 * What actually changes on each page when a saved section is overwritten.
 *
 * The dialog already names the pages an overwrite will rewrite (PR #277) and
 * the message afterwards gives the tally with an Undo (PR #279). Naming a page
 * is enough to make someone hesitate; it is not enough to make them decide.
 * This is the missing half of the operator's 2026-07-21 request, the one that
 * followed 46 published Marinoff pages being rewritten by a routine styling
 * edit with no way to see it coming.
 *
 * WHAT IT COMPARES
 * `propagateCanonicalSection` (`lib/builderPagesStore.js`) rewrites every
 * following instance as:
 *
 *     { ...updatedSection, id: <the instance's own id>, savedSectionId, canonical: true }
 *
 * The instance keeps nothing but its id. So the "after" state is the SAME
 * content on every page, and the diff varies only because the "before" states
 * differ. That is not an object comparison of two arbitrary sections — it is
 * that one transformation, and this file models exactly it. In particular a
 * module's `canonicalLocked` flag does NOT save it here: that flag guards
 * module-level pushes, and a section fan-out replaces the whole row.
 *
 * WHY IT GROUPS
 * Pages that still match the old original all change in the identical way, so
 * listing 38 copies of the same three lines buries the two pages that had
 * drifted — and those two are the whole reason to look. Pages are grouped by
 * an exact fingerprint of their change list, and "no visible change" is a
 * first-class group rather than an absence.
 *
 * It is pure and reads only what the editor already holds in memory
 * (`GET /api/admin/pages` is a `select=*`), so there is no new endpoint and no
 * request between the click and the answer.
 */

import { modulePaletteItems } from "@/components/builder/builder-types";

/** Only the fields the diff reads — structural, so tests stay light. */
export type DiffModule = {
  id?: string;
  type?: string;
  column?: string;
  name?: string;
  text?: string;
  settings?: Record<string, string>;
};

export type DiffSection = {
  id?: string;
  savedSectionId?: string;
  canonical?: boolean;
  modules?: readonly DiffModule[];
  [key: string]: unknown;
};

export type DiffPage = {
  id?: string;
  name?: string;
  slug?: string;
  layoutSections?: readonly DiffSection[];
};

/**
 * One line in the dialog. `before`/`after` for a value that changed, `detail`
 * for a structural change (a module appearing, leaving, or moving).
 */
export type SectionChange = {
  kind: "module-added" | "module-removed" | "module-moved" | "text" | "setting";
  /** The left-hand phrase: "Text changed", "Button added". */
  label: string;
  before?: string;
  after?: string;
  detail?: string;
};

export type SectionDiffGroup = {
  /** Every page whose change list is exactly this one. */
  pageLabels: string[];
  pages: number;
  changes: SectionChange[];
  /** True for the group that changes in no way anyone can see. */
  unchanged: boolean;
};

export type SavedSectionDiff = {
  /** Pages holding at least one following copy — what the fan-out will touch. */
  pages: number;
  changedPages: number;
  unchangedPages: number;
  /** Changed groups first, largest first; the unchanged group always last. */
  groups: SectionDiffGroup[];
  /**
   * The page list this was computed from came back at the API's row cap, so
   * there may be pages past it that the diff cannot see — and which the
   * fan-out would still rewrite. Under-reporting silently is the exact failure
   * this feature exists to prevent, so it is surfaced rather than swallowed.
   */
  truncated: boolean;
};

export const EMPTY_SECTION_DIFF: SavedSectionDiff = {
  pages: 0,
  changedPages: 0,
  unchangedPages: 0,
  groups: [],
  truncated: false,
};

/**
 * `listPages` defaults to 1000 rows and `/api/builder/landing-pages` takes the
 * default, so a project past 1000 pages hands the editor a truncated list.
 * The fan-out itself asks for 5000, so it would reach pages the diff never saw.
 */
export const PAGE_LIST_LIMIT = 1000;

const EXCERPT_LENGTH = 64;
const VALUE_LENGTH = 48;

/** Fields the transformation forces, so a difference in them is not news. */
const IGNORED_SECTION_FIELDS = new Set(["id", "savedSectionId", "canonical", "modules"]);

/**
 * Keys whose camel-case reading is wrong or clumsy. Everything else is
 * humanized mechanically, which is honest: a made-up friendly name for a
 * setting the operator has never seen is worse than the setting's own name.
 */
const SECTION_FIELD_LABELS: Record<string, string> = {
  title: "Section title",
  layout: "Column layout",
  widthMode: "Width mode",
  widthPercent: "Width %",
  joinWithPrevious: "Joined to the row above",
  isPrivate: "Private",
  locked: "Locked",
  mobileHidden: "Hidden on mobile",
  desktopHidden: "Hidden on desktop",
  mobileLayout: "Mobile layout",
  equalColumnHeights: "Equal column heights",
  columnGap: "Column gap",
  overlayScreen: "Overlay screen",
};

function humanizeKey(key: string): string {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function sectionFieldLabel(key: string): string {
  return SECTION_FIELD_LABELS[key] ?? humanizeKey(key);
}

function truncate(value: string, limit: number): string {
  const text = value.trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * Rich text is stored as HTML, and an operator comparing two paragraphs should
 * not have to read tags to do it. Entities are decoded by hand rather than
 * through the DOM: this runs in tests and in a server bundle too.
 */
export function plainTextExcerpt(html: unknown, limit = EXCERPT_LENGTH): string {
  const text = String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(text, limit);
}

const MODULE_TYPE_LABELS = new Map<string, string>();
for (const item of modulePaletteItems) {
  if (!MODULE_TYPE_LABELS.has(item.type)) MODULE_TYPE_LABELS.set(item.type, item.label);
}

function moduleTypeLabel(module: DiffModule | undefined): string {
  const type = String(module?.type ?? "").trim();
  if (!type) return "Module";
  return MODULE_TYPE_LABELS.get(type) ?? humanizeKey(type);
}

/**
 * A scrap of content so "Text module removed" says WHICH one. Falls back
 * through the places different module types keep their visible words, then to
 * the module's own name, and finally to nothing — an empty scrap is fine, a
 * wrong one is not.
 */
export function moduleExcerpt(module: DiffModule | undefined): string {
  if (!module) return "";
  const fromText = plainTextExcerpt(module.text);
  if (fromText) return fromText;

  const settings = module.settings ?? {};
  for (const key of ["text", "headline", "title", "label", "buttonText", "caption", "html"]) {
    const candidate = plainTextExcerpt(settings[key]);
    if (candidate) return candidate;
  }

  for (const key of ["imageUrl", "src", "url", "href"]) {
    const raw = String(settings[key] ?? "").trim();
    if (!raw) continue;
    const file = raw.split(/[?#]/)[0].split("/").filter(Boolean).pop();
    if (file) return truncate(file, EXCERPT_LENGTH);
  }

  return truncate(String(module.name ?? "").trim(), EXCERPT_LENGTH);
}

function moduleLabel(module: DiffModule | undefined): string {
  const type = moduleTypeLabel(module);
  const name = String(module?.name ?? "").trim();
  return name ? `${type} “${name}”` : type;
}

/**
 * The scrap shown UNDER "Primary CTA added". The type is already in the label,
 * so repeating it there reads as a stutter — this is the content only, and
 * nothing at all when the module has none to show.
 */
function withExcerpt(module: DiffModule | undefined): string {
  const excerpt = moduleExcerpt(module);
  if (excerpt) return `“${excerpt}”`;
  const name = String(module?.name ?? "").trim();
  return name ? `“${name}”` : "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeBackground(value: Record<string, unknown>): string {
  const mode = String(value.mode ?? "").trim() || "none";
  if (mode === "none") return "none";
  if (mode === "color") return `colour ${String(value.color ?? "").trim() || "unset"}`;
  if (mode === "gradient") {
    return `gradient ${String(value.color ?? "").trim()} → ${String(value.color2 ?? "").trim()}`;
  }
  if (mode === "image") {
    const url = String(value.imageUrl ?? "").trim();
    const file = url.split(/[?#]/)[0].split("/").filter(Boolean).pop();
    return `image ${file || "unset"}`;
  }
  if (mode === "style") return `style ${String(value.styleKey ?? "").trim() || "unset"}`;
  return mode;
}

/** One short readable rendering of any value a section field can hold. */
export function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "empty";
    if (text === "true") return "on";
    if (text === "false") return "off";
    return truncate(text, VALUE_LENGTH);
  }
  if (isPlainRecord(value)) {
    if ("mode" in value) return describeBackground(value);
    if ("background" in value && isPlainRecord(value.background)) {
      return `${describeBackground(value.background)} at ${formatValue(value.opacity)}`;
    }
    return truncate(String(JSON.stringify(value)), VALUE_LENGTH);
  }
  return truncate(String(JSON.stringify(value)), VALUE_LENGTH);
}

/**
 * Fields keyed by column rather than holding one value. Named explicitly: a
 * "does it look like a map" guess also catches `overlayScreen`, and reporting
 * that as "Overlay screen (column background)" is nonsense.
 */
function isPerColumnField(key: string): boolean {
  return key.startsWith("cell") || key === "columnWidths";
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) {
    // "" and undefined both mean "not set" for the string-typed settings the
    // builder stores, and an older row simply not carrying a field is not a
    // change the operator should be shown.
    const left = a === undefined || a === null ? "" : a;
    const right = b === undefined || b === null ? "" : b;
    return left === right;
  }
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

/**
 * Compare two `Record<string, string>` maps (cell padding, column widths,
 * module settings) key by key, so the line reads "Cell padding top (column b):
 * 0 → 24" instead of two walls of JSON.
 */
function compareRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  label: (key: string) => string,
  push: (change: SectionChange) => void
) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    if (sameValue(before[key], after[key])) continue;
    push({
      kind: "setting",
      label: label(key),
      before: formatValue(before[key]),
      after: formatValue(after[key]),
    });
  }
}

function compareSectionSettings(before: DiffSection, after: DiffSection, push: (c: SectionChange) => void) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    if (IGNORED_SECTION_FIELDS.has(key)) continue;
    const left = before[key];
    const right = after[key];
    if (sameValue(left, right)) continue;

    // A per-column map: name the column rather than dumping the whole object.
    if (isPerColumnField(key) && (isPlainRecord(left) || isPlainRecord(right))) {
      compareRecords(
        isPlainRecord(left) ? left : {},
        isPlainRecord(right) ? right : {},
        (column) => `${sectionFieldLabel(key)} (column ${column})`,
        push
      );
      continue;
    }

    push({ kind: "setting", label: sectionFieldLabel(key), before: formatValue(left), after: formatValue(right) });
  }
}

/**
 * Pair up the modules on either side.
 *
 * A canonical instance keeps the original's module ids — that is what the
 * Canonical checkbox is for — so ids match for anything that merely changed.
 * Whatever is left over is matched by type within the same column, in order,
 * which catches a module the operator rebuilt by hand (new id, same job).
 * What survives neither pass is genuinely added or removed.
 */
function pairModules(before: readonly DiffModule[], after: readonly DiffModule[]) {
  const pairs: Array<{ before: DiffModule; after: DiffModule }> = [];
  const unmatchedBefore = [...before];
  const unmatchedAfter = [...after];

  for (let i = unmatchedBefore.length - 1; i >= 0; i -= 1) {
    const id = String(unmatchedBefore[i]?.id ?? "").trim();
    if (!id) continue;
    const j = unmatchedAfter.findIndex((candidate) => String(candidate?.id ?? "").trim() === id);
    if (j < 0) continue;
    pairs.push({ before: unmatchedBefore[i], after: unmatchedAfter[j] });
    unmatchedBefore.splice(i, 1);
    unmatchedAfter.splice(j, 1);
  }

  for (let i = 0; i < unmatchedBefore.length; i += 1) {
    const candidate = unmatchedBefore[i];
    const j = unmatchedAfter.findIndex(
      (other) => other.type === candidate.type && String(other.column ?? "") === String(candidate.column ?? "")
    );
    if (j < 0) continue;
    pairs.push({ before: candidate, after: unmatchedAfter[j] });
    unmatchedBefore.splice(i, 1);
    unmatchedAfter.splice(j, 1);
    i -= 1;
  }

  return { pairs, removed: unmatchedBefore, added: unmatchedAfter };
}

function compareModules(before: readonly DiffModule[], after: readonly DiffModule[], push: (c: SectionChange) => void) {
  const { pairs, removed, added } = pairModules(before, after);

  for (const module of removed) {
    push({ kind: "module-removed", label: `${moduleTypeLabel(module)} removed`, detail: withExcerpt(module) });
  }
  for (const module of added) {
    push({ kind: "module-added", label: `${moduleTypeLabel(module)} added`, detail: withExcerpt(module) });
  }

  // Reordering is reported once for the row, not once per module: three modules
  // sliding up because a fourth left above them is one thing that happened.
  const beforeOrder = pairs
    .slice()
    .sort((a, b) => before.indexOf(a.before) - before.indexOf(b.before))
    .map((pair) => pair.after);
  const afterOrder = pairs.slice().sort((a, b) => after.indexOf(a.after) - after.indexOf(b.after)).map((pair) => pair.after);
  const reordered = beforeOrder.some((module, index) => module !== afterOrder[index]);
  if (reordered) {
    push({
      kind: "module-moved",
      label: "Modules reordered",
      detail: afterOrder.map((module) => moduleTypeLabel(module)).join(" → "),
    });
  }

  for (const pair of pairs.sort((a, b) => after.indexOf(a.after) - after.indexOf(b.after))) {
    const name = moduleLabel(pair.after);

    if (String(pair.before.column ?? "") !== String(pair.after.column ?? "")) {
      push({
        kind: "module-moved",
        label: `${name} moved column`,
        before: String(pair.before.column ?? "") || "none",
        after: String(pair.after.column ?? "") || "none",
      });
    }

    if (pair.before.type !== pair.after.type) {
      push({
        kind: "setting",
        label: `${name} type`,
        before: moduleTypeLabel(pair.before),
        after: moduleTypeLabel(pair.after),
      });
    }

    if (!sameValue(pair.before.text, pair.after.text)) {
      push({
        kind: "text",
        label: `${name} text changed`,
        before: plainTextExcerpt(pair.before.text) || "empty",
        after: plainTextExcerpt(pair.after.text) || "empty",
      });
    }

    if (!sameValue(pair.before.name, pair.after.name)) {
      push({
        kind: "setting",
        label: `${moduleTypeLabel(pair.after)} name`,
        before: formatValue(pair.before.name),
        after: formatValue(pair.after.name),
      });
    }

    compareRecords(
      pair.before.settings ?? {},
      pair.after.settings ?? {},
      (key) => `${name}: ${humanizeKey(key)}`,
      push
    );
  }
}

/**
 * Every change one following instance takes on. `after` is the section as the
 * ORIGINAL will hold it; the id/provenance the fan-out forces back on are not
 * differences and are not reported.
 */
export function diffSectionInstance(before: DiffSection, after: DiffSection): SectionChange[] {
  const changes: SectionChange[] = [];
  const push = (change: SectionChange) => changes.push(change);
  // Content before frame. A module leaving, or a phone number changing, is what
  // the operator is deciding about; the row's padding is context. Listing the
  // padding first (it sorts alphabetically before everything) buried the line
  // that mattered under one that did not.
  compareModules(
    Array.isArray(before?.modules) ? before.modules : [],
    Array.isArray(after?.modules) ? after.modules : [],
    push
  );
  compareSectionSettings(before, after, push);
  return changes;
}

function labelFor(page: DiffPage): string {
  const name = String(page?.name ?? "").trim();
  if (name) return name;
  const slug = String(page?.slug ?? "").trim();
  return slug ? `/${slug}` : "Untitled page";
}

function fingerprint(changes: readonly SectionChange[]): string {
  return JSON.stringify(changes.map((c) => [c.kind, c.label, c.before ?? "", c.after ?? "", c.detail ?? ""]));
}

/**
 * The whole answer: what an overwrite of `savedSectionId` does to every page
 * that follows it, given the pages the editor already holds.
 *
 * `proposed` is the section content that will become the original — the same
 * object handed to the PATCH, minus the id/provenance the route re-attaches.
 */
export function diffSavedSectionOverwrite(
  pages: readonly DiffPage[] | null | undefined,
  savedSectionId: string,
  proposed: DiffSection | null | undefined
): SavedSectionDiff {
  const id = String(savedSectionId ?? "").trim();
  if (!id || !proposed || !Array.isArray(pages)) return EMPTY_SECTION_DIFF;

  const byFingerprint = new Map<string, SectionDiffGroup>();
  let pageCount = 0;
  let changedPages = 0;
  let unchangedPages = 0;

  for (const page of pages) {
    const sections: readonly DiffSection[] = Array.isArray(page?.layoutSections) ? page.layoutSections : [];
    const instances = sections.filter(
      (s) => s?.canonical === true && String(s?.savedSectionId ?? "") === id
    );
    if (!instances.length) continue;

    pageCount += 1;

    const changes: SectionChange[] = [];
    instances.forEach((instance, index) => {
      // The fan-out's exact rewrite. Everything else on the instance goes.
      const after: DiffSection = { ...proposed, id: instance.id, savedSectionId: id, canonical: true };
      const instanceChanges = diffSectionInstance(instance, after);
      if (instances.length === 1) {
        changes.push(...instanceChanges);
        return;
      }
      // A page holding the same section twice: say which copy, or two identical
      // lines read as one change reported twice.
      changes.push(...instanceChanges.map((c) => ({ ...c, label: `Copy ${index + 1}: ${c.label}` })));
    });

    if (changes.length) changedPages += 1;
    else unchangedPages += 1;

    const key = fingerprint(changes);
    const group = byFingerprint.get(key);
    if (group) {
      group.pageLabels.push(labelFor(page));
      group.pages += 1;
      continue;
    }
    byFingerprint.set(key, {
      pageLabels: [labelFor(page)],
      pages: 1,
      changes,
      unchanged: changes.length === 0,
    });
  }

  const groups = [...byFingerprint.values()].sort((a, b) => {
    // The unchanged group is the noise this exists to push aside: always last.
    if (a.unchanged !== b.unchanged) return a.unchanged ? 1 : -1;
    // Then SMALLEST first. This is a warning, not a changelog, so it leads with
    // the worst case: a one-page group is a page that drifted and is about to
    // lose its local edits, while the big group is the change the operator just
    // made on purpose. Largest-first read well until it was drawn — the bulk
    // group filled the panel and pushed the one page that mattered out of
    // sight, which is precisely the burying this grouping exists to undo.
    if (a.pages !== b.pages) return a.pages - b.pages;
    return a.pageLabels[0].localeCompare(b.pageLabels[0]);
  });

  return {
    pages: pageCount,
    changedPages,
    unchangedPages,
    groups,
    truncated: pages.length >= PAGE_LIST_LIMIT,
  };
}

/** How many page names and change lines a group shows before it says "…and N more". */
export const GROUP_PAGE_PREVIEW = 8;
export const GROUP_CHANGE_PREVIEW = 10;

/**
 * Cap a list for display WITHOUT losing the count of what was dropped. A list
 * that silently stops at eight reads as "that is all of them", which is the
 * shape of every failure this feature exists to prevent.
 */
export function capList<T>(items: readonly T[] | null | undefined, limit: number): { shown: T[]; more: number } {
  const all = Array.isArray(items) ? items : [];
  const safeLimit = Math.max(0, limit);
  return { shown: all.slice(0, safeLimit), more: Math.max(0, all.length - safeLimit) };
}

/** "38 pages" / "1 page". */
export function describePageCount(count: number): string {
  const pages = Number(count) || 0;
  return pages === 1 ? '1 page' : `${pages} pages`;
}

/** The group's heading. */
export function describeGroupCount(group: SectionDiffGroup | null | undefined): string {
  return describePageCount(group?.pages ?? 0);
}

/** "no visible change" / "3 changes" — the group's verdict, beside the count. */
export function describeGroupVerdict(group: SectionDiffGroup | null | undefined): string {
  if (!group || group.unchanged) return 'no visible change';
  const count = group.changes.length;
  return count === 1 ? '1 change' : `${count} changes`;
}

/**
 * One sentence over the top of the groups. Deliberately says "no visible
 * change" out loud when that is the answer for every page — a fan-out that
 * changes nothing is a fact worth knowing before clicking, not a blank.
 */
export function describeSectionDiff(diff: SavedSectionDiff | null | undefined): string {
  const pages = diff?.pages ?? 0;
  if (pages < 1) return "No other page follows this section, so nothing else changes.";

  const changed = diff?.changedPages ?? 0;
  const unchanged = diff?.unchangedPages ?? 0;

  if (changed === 0) {
    return `All ${pages === 1 ? "1 page" : `${pages} pages`} already match — no visible change on any of them.`;
  }
  if (unchanged === 0) {
    return `${changed === 1 ? "1 page changes" : `${changed} pages change`}.`;
  }
  return `${changed === 1 ? "1 page changes" : `${changed} pages change`}; the other ${
    unchanged === 1 ? "1 has" : `${unchanged} have`
  } no visible change.`;
}
