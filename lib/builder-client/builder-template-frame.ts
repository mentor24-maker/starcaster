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
  [key: string]: unknown;
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
  templateSections: readonly S[] | null | undefined
): TemplateFrameResult<S> {
  const page = Array.isArray(pageSections) ? pageSections : [];
  const template = Array.isArray(templateSections) ? templateSections : [];

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
