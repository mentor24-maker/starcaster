import type { BackgroundSettings } from "./builder-template";
import { normalizeBuilderAssetUrl } from "./builder-asset-url";
import { getMediaKind, type AdminMediaKind } from "./admin-media-shared";

/**
 * Where a freshly uploaded file lands in a background's settings.
 *
 * One `onUploadImage` callback serves BOTH upload buttons the background
 * picker draws — "Upload Background" in image mode (`accept="image/*"`) and
 * "Upload Video" in video mode (`accept="video/*"`) — so the handler behind it
 * receives a file with no word about which button was clicked. Every existing
 * handler answers that by writing `imageUrl` and forcing `mode: "image"`,
 * which is right for one button and wrong for the other: uploading a video
 * turns the surface into an image background and drops the clip on the floor.
 * That is filed against the ROW panel as 86bbwe98a; this helper exists so the
 * CELL panel does not ship a second copy of it.
 *
 * The rule, in order:
 *
 *   1. The uploaded media's own `kind` decides, because the SERVER classified
 *      it — a real answer beats an inference every time.
 *   2. Failing that, the file extension, through the same `getMediaKind` the
 *      gallery uses.
 *   3. Failing both, the mode the operator is already standing in. He clicked
 *      an upload button inside the Video block; answering "image" there is a
 *      guess that silently discards his work, while answering "video" at worst
 *      leaves a url he can see and clear.
 *
 * Only then does it fall back to image, which is what every surface did
 * before this existed.
 */
/**
 * `getMediaKind` matches against ".mp4"-with-the-dot, and an upload's
 * `extension` is not guaranteed to carry one — so a bare "mp4" resolved to
 * NOTHING and quietly fell through to the mode fallback. Caught by the test
 * before it left this file. The path is read as a last resort, because a
 * gallery row written before the field existed has no extension at all.
 */
function mediaExtension(extension: string | undefined, path: string): string {
  const raw = (extension || path.split(".").pop() || "").toLowerCase().trim();
  if (!raw || raw.includes("/")) return "";
  return raw.startsWith(".") ? raw : `.${raw}`;
}

export function applyUploadedBackgroundMedia(
  current: BackgroundSettings,
  media: { path: string; kind?: AdminMediaKind | null; extension?: string; size?: number }
): BackgroundSettings {
  const url = normalizeBuilderAssetUrl(media.path);
  const kind =
    media.kind ??
    getMediaKind(mediaExtension(media.extension, media.path)) ??
    (current.mode === "video" ? "video" : current.mode === "image" ? "image" : null);

  if (kind === "video") {
    /*
     * The size travels WITH the url in a single write, for the same reason the
     * gallery picker does it that way: two updates could interleave and leave
     * one clip's bytes sitting under another clip's url, which is a confident,
     * specific, wrong number — worse than no number at all.
     */
    return {
      ...current,
      mode: "video",
      videoUrl: url,
      videoBytes: Number(media.size || 0) || 0
    };
  }

  return { ...current, mode: "image", imageUrl: url };
}
