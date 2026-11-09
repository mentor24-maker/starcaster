/**
 * WHICH TEXT FOLLOWS THE THEME'S BASE SIZE (task 86bczr7x7).
 *
 * Builder › Themes "Base size (px)" sizes body copy — the Paragraph text
 * module (and the legacy one with no variant) and a blog post's body. It does
 * NOT size Intro Copy or Caption, which are deliberately larger / smaller than
 * body copy, nor Simple Text, which takes its section's size.
 *
 * The page applies that in `src/css/_builder-theme.css` by excluding those
 * three variant classes; the rich text editor applies it only where this says
 * so (`followsThemeBaseSize` on `BuilderRichTextEditor`). Two places, one list:
 * `text-body-size.test.ts` fails if the page rule's exclusions and this list
 * part ways, because the defect this exists against is the editor showing a
 * size the published page does not (review round 1 on PR #1001).
 */
export const TEXT_VARIANTS_WITH_OWN_SIZE = ["intro", "caption", "plain"] as const;

export function textModuleFollowsThemeBaseSize(settings: Record<string, string> | undefined): boolean {
  const variant = settings?.variant ?? "";
  return !(TEXT_VARIANTS_WITH_OWN_SIZE as readonly string[]).includes(variant);
}
