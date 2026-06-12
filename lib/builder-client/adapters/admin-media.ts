/**
 * Starcaster replacement for normie's lib/admin-media.
 * The normie original adds node:fs directory listing for its API route;
 * the builder UI only needs the shared types/helpers.
 */
export type { AdminMediaItem, AdminMediaKind } from '../admin-media-shared';
export {
  GALLERY_FILTER_EXTENSIONS,
  GALLERY_IMAGE_EXTENSIONS,
  GALLERY_VIDEO_EXTENSIONS,
  getMediaKind
} from '../admin-media-shared';
