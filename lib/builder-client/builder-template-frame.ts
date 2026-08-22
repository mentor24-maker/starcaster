/**
 * Frame and body — what a template owns, and what the page owns.
 *
 * THE MODEL
 * A template is a FRAME, not a photocopy of a page. The frame is the shared
 * furniture around the content: the contact strip, the menu banner, the
 * footer. The body is the page's own work. Switching a template swaps the
 * frame and leaves the body alone — not because a dialog stopped it, but
 * because the body was never the template's to touch.
 *
 * The LAMP shape this mirrors: header.php / footer.php wrap the page, and the
 * page's own content sits between them.
 *
 * WHAT COUNTS AS FRAME
 * A section linked to a saved section (`canonical: true` + `savedSectionId`).
 * That is a deliberate choice by the operator, 2026-08-14: canonical sections
 * ALREADY are the shared-furniture mechanism -- they propagate from one master
 * to every page that uses them -- so deriving the frame from them needs no new
 * marker, no new UI, and nothing to keep in sync. It is also exactly what
 * templates become in stage 4, when they stop storing section copies and
 * start referencing saved sections directly.
 *
 * Everything else is body.
 *
 * WHERE THE BODY GOES
 * There is no explicit slot marker. The template's own non-canonical sections
 * mark the position: the page's body is inserted where the template's body
 * was, so the frame that led it stays leading and the frame that followed it
 * stays trailing. A template that is all frame puts the body at the end.
 *
 * THE BUG THIS REPLACES
 * Applying a template used to assign its layoutSections over the page's,
 * wholesale. On 2026-08-14 that cost the Delray home page 35 sections. PR #231
 * stopped the bleeding by refusing to touch a page that already had content;
 * this makes the operation do the right thing instead of nothing.
 */

export type FrameSection = {
  id?: string;
  canonical?: boolean;
  savedSectionId?: string;
  title?: string;
  modules?: unknown[];
  [key: string]: unknown;
};

/** A saved section master, as the editor holds it. */
export type SavedSectionLike<S extends FrameSection = FrameSection> = {
  id: string;
  name?: string;
  section: S;
};

export type TemplateFrameResult<S extends FrameSection> = {
  /** The page's new section list: template frame with the page's body inside. */
  sections: S[];
  /** How many of the page's own sections were carried through untouched. */
  keptBody: number;
  /** Frame sections the template brings. */
  frameAdded: number;
  /** Frame sections the page had that the template does not, and so are dropped. */
  frameRemoved: number;
  /** Names of the dropped frame sections, for telling the operator what changed. */
  frameRemovedNames: string[];
};

/** A section is frame when it is a live link to a saved section. */
export function isFrameSection(section: FrameSection | null | undefined): boolean {
  if (!section || typeof section !== 'object') return false;
  return section.canonical === true && Boolean(section.savedSectionId);
}

/** The page's own work: everything that is not a link to a saved section. */
export function bodySectionsOf<S extends FrameSection>(sections: readonly S[] | null | undefined): S[] {
  if (!Array.isArray(sections)) return [];
  return sections.filter((section) => !isFrameSection(section));
}

export function frameSectionsOf<S extends FrameSection>(sections: readonly S[] | null | undefined): S[] {
  if (!Array.isArray(sections)) return [];
  return sections.filter((section) => isFrameSection(section));
}

function sectionLabel(section: FrameSection): string {
  const title = typeof section?.title === 'string' ? section.title.trim() : '';
  return title || 'Untitled section';
}

/* ------------------------------------------------------------------ stage 4
 * Templates hold a REFERENCE to each frame section, not a copy of it.
 *
 * A template used to store the whole Contact Strip inside itself. The page
 * instances it created stayed current, because saving the master propagates to
 * every page carrying that savedSectionId — but the copy sitting in the
 * template did not, and nothing ever told anyone. Apply a six-week-old
 * template and it stamped a six-week-old header onto the page, correct again
 * only after the next unrelated edit to the master.
 *
 * Two sources of truth for one header, with no way to see they had diverged.
 * Storing a reference removes the second one.
 */

/**
 * Strip a frame section down to what identifies it. Body sections are returned
 * untouched — they are the template's own design, and their position is what
 * tells applyTemplateFrame where the page's body belongs.
 */
export function toTemplateFrameReference<S extends FrameSection>(section: S): S {
  if (!isFrameSection(section)) return section;
  return {
    id: section.id,
    title: section.title,
    canonical: true,
    savedSectionId: section.savedSectionId
  } as unknown as S;
}

/** Every frame section in a template becomes a reference. */
export function toTemplateReferences<S extends FrameSection>(sections: readonly S[] | null | undefined): S[] {
  if (!Array.isArray(sections)) return [];
  return sections.map((section) => toTemplateFrameReference(section));
}

/**
 * True when a frame section carries no content of its own — a pure reference.
 *
 * An EMPTY modules array counts. Writing a reference drops `modules` entirely,
 * but the server normalises every section on the way in and hands it back with
 * `modules: []` — verified against a real round trip. Testing only for the
 * absent key would classify every stored reference as a copy, and a reference
 * whose master had been deleted would then render as an empty band instead of
 * being dropped.
 */
export function isFrameReference(section: FrameSection): boolean {
  if (!isFrameSection(section)) return false;
  return !Array.isArray(section.modules) || section.modules.length === 0;
}

/**
 * Turn a template's frame reference back into a live section, from the CURRENT
 * master.
 *
 * Falls back to the section as stored when the master cannot be found, which
 * is what makes this safe for the templates that already exist: they still
 * carry full copies, and nothing has to be migrated. A reference whose master
 * has been deleted resolves to null and is dropped rather than rendering an
 * empty band.
 */
export function resolveFrameSection<S extends FrameSection>(
  section: S,
  savedSections: readonly SavedSectionLike<S>[] | null | undefined,
  makeId: () => string
): S | null {
  if (!isFrameSection(section)) return section;

  const masters = Array.isArray(savedSections) ? savedSections : [];
  const master = masters.find((candidate) => candidate.id === section.savedSectionId);

  if (!master?.section) {
    // No master. An old-style template still has its copy; a pure reference
    // has nothing to show, so it goes rather than leaving a blank band.
    return isFrameReference(section) ? null : section;
  }

  // Master module ids are kept deliberately: that is how local drift is
  // detected later (see insertSavedSection's canonical branch).
  const modules = Array.isArray(master.section.modules)
    ? (master.section.modules as unknown[]).map((module) => ({
        ...(module as Record<string, unknown>),
        settings: { ...((module as { settings?: Record<string, unknown> }).settings ?? {}) }
      }))
    : [];

  return {
    ...master.section,
    id: section.id ?? makeId(),
    savedSectionId: section.savedSectionId,
    canonical: true,
    modules
  } as unknown as S;
}

/**
 * Resolve every frame reference in a template against the live masters.
 * Body sections pass through untouched.
 */
export function resolveTemplateSections<S extends FrameSection>(
  templateSections: readonly S[] | null | undefined,
  savedSections: readonly SavedSectionLike<S>[] | null | undefined,
  makeId: () => string
): S[] {
  if (!Array.isArray(templateSections)) return [];
  return templateSections
    .map((section) => resolveFrameSection(section, savedSections, makeId))
    .filter((section): section is S => section !== null);
}

/**
 * Put the page's body inside the template's frame.
 *
 * The page's body is never read from the template and never rewritten, so this
 * cannot lose content no matter what the template contains. A template with no
 * frame at all returns the page's body unchanged, which is the correct
 * behaviour for the built-in stub templates that carry no sections.
 */
export function applyTemplateFrame<S extends FrameSection>(
  pageSections: readonly S[] | null | undefined,
  templateSections: readonly S[] | null | undefined,
  options?: {
    /** Live masters. Given these, frame references resolve to current content. */
    savedSections?: readonly SavedSectionLike<S>[] | null;
    makeId?: () => string;
  }
): TemplateFrameResult<S> {
  const page = Array.isArray(pageSections) ? pageSections : [];
  const rawTemplate = Array.isArray(templateSections) ? templateSections : [];

  // Resolve the frame from the CURRENT masters, so applying a template never
  // stamps a stale header. Without savedSections this is a no-op and the
  // template's stored sections are used as they are.
  const makeId = options?.makeId ?? (() => `section-${Math.random().toString(36).slice(2, 10)}`);
  const template = options?.savedSections
    ? resolveTemplateSections(rawTemplate, options.savedSections, makeId)
    : rawTemplate;

  const body = bodySectionsOf(page);
  const pageFrame = frameSectionsOf(page);

  // The template's own body marks where the page's body belongs. Frame before
  // that point leads; everything frame-ish from that point on trails. A
  // template that is entirely frame puts the body last.
  const firstBodyIndex = template.findIndex((section) => !isFrameSection(section));
  const lead =
    firstBodyIndex === -1
      ? frameSectionsOf(template)
      : frameSectionsOf(template.slice(0, firstBodyIndex));
  const trail = firstBodyIndex === -1 ? [] : frameSectionsOf(template.slice(firstBodyIndex));

  const incomingFrame = [...lead, ...trail];
  const incomingIds = new Set(
    incomingFrame.map((section) => String(section.savedSectionId ?? ''))
  );
  const dropped = pageFrame.filter(
    (section) => !incomingIds.has(String(section.savedSectionId ?? ''))
  );

  return {
    sections: [...lead, ...body, ...trail],
    keptBody: body.length,
    frameAdded: incomingFrame.length,
    frameRemoved: dropped.length,
    frameRemovedNames: dropped.map(sectionLabel),
  };
}

/**
 * What to tell the operator BEFORE anything is written.
 *
 * Deliberately leads with what is kept. The fear this control has earned is
 * "will it eat my page again", and the first line has to answer that.
 */
export function describeTemplateFrameChange(
  templateName: string,
  result: TemplateFrameResult<FrameSection>
): string {
  const lines: string[] = [];
  const body = result.keptBody;

  lines.push(
    `Switch this page to the "${templateName}" template?`,
    '',
    body === 1
      ? 'Your 1 content section is kept exactly as it is.'
      : `Your ${body} content sections are kept exactly as they are.`
  );

  if (result.frameAdded) {
    lines.push(
      result.frameAdded === 1
        ? 'The template brings 1 shared section (header/footer furniture).'
        : `The template brings ${result.frameAdded} shared sections (header/footer furniture).`
    );
  } else {
    lines.push('This template carries no shared sections, so only the page tag changes.');
  }

  if (result.frameRemoved) {
    lines.push(
      '',
      result.frameRemoved === 1
        ? 'This shared section is not in the new template and will be removed:'
        : 'These shared sections are not in the new template and will be removed:',
      ...result.frameRemovedNames.map((name) => `  · ${name}`),
      '',
      'They are saved sections, so you can add them back at any time.'
    );
  }

  return lines.join('\n');
}
