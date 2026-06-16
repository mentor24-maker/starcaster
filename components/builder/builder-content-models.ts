/**
 * Content Display Models — client-side registry.
 *
 * These constants mirror lib/contentDisplayModels.js so the Builder UI can
 * present model options without a round-trip.  The actual extraction logic
 * lives server-side; add new models there first, then add the descriptor here.
 */

export type ContentDisplayModel = {
  id: string;
  name: string;
  description: string;
};

export const CONTENT_DISPLAY_MODELS: ContentDisplayModel[] = [
  {
    id: "duda-alternating-2col",
    name: "Alternating Two-Column Blocks",
    description:
      "Extracts alternating image-left/text-right and text-left/image-right content "
      + "blocks from DudaMobile flex-grid pages. Maps each block to a template section.",
  },
];

export function getContentDisplayModel(id: string): ContentDisplayModel | undefined {
  return CONTENT_DISPLAY_MODELS.find((m) => m.id === id);
}
