/**
 * Admin media types and helpers for the Builder UI.
 * Only the shared types/helpers are needed client-side; directory listing is handled server-side.
 */
export type { AdminMediaItem, AdminMediaKind } from '../admin-media-shared';
export {
  GALLERY_FILTER_EXTENSIONS,
  GALLERY_IMAGE_EXTENSIONS,
  GALLERY_VIDEO_EXTENSIONS,
  getMediaKind
} from '../admin-media-shared';
