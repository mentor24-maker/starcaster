/**
 * Uploading a VIDEO from the browser.
 *
 * Videos cannot take the base64 route (`POST /api/assets/import-image`): it
 * refuses anything that is not an image and tops out around 7MB. They go
 * straight to Vercel Blob instead (`/api/assets/blob-upload` hands the browser
 * a token), and the file is then recorded as an asset with `POST /api/assets`.
 *
 * This lived only inside the tenant Media Manager module. The Builder's own
 * upload adapter (`builder-admin-fetch.ts`) never learned it, so Upload Video in
 * Row Background sent every clip to import-image and failed with "import-image
 * only accepts image files" (task 86bbwe98a). One copy here, used by both.
 */

/** The base64 upload path tops out around 7MB. */
export const MEDIA_DIRECT_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;

export function isVideoFile(file: { type?: string; name?: string }): boolean {
  return /^video\//i.test(String(file.type || "")) || /\.(mp4|mov|m4v|webm|ogg)$/i.test(String(file.name || ""));
}

type BlobClient = { upload: (...args: unknown[]) => Promise<{ url: string }> };

let mediaBlobClientPromise: Promise<BlobClient> | null = null;

export function getMediaBlobClient(): Promise<BlobClient> {
  // Loaded from a CDN at runtime rather than bundled — the same technique
  // public/js/assets.js uses, and what lets a tenant page upload video without
  // the builder bundle carrying the SDK.
  if (!mediaBlobClientPromise) {
    // The specifier is built at runtime so TypeScript does not try to resolve
    // a URL import at compile time, and esbuild leaves it as a dynamic import
    // for the browser to fetch.
    const cdn = "https://esm.sh/@vercel/blob/client?bundle";
    mediaBlobClientPromise = new Function("u", "return import(u)")(cdn) as Promise<BlobClient>;
  }
  return mediaBlobClientPromise;
}

/** Put one file in Blob and return its public url. */
export async function uploadFileToBlob(file: File, assetType: "Video" | "Image"): Promise<string> {
  const { upload } = await getMediaBlobClient();
  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/api/assets/blob-upload",
    multipart: true,
    clientPayload: JSON.stringify({ fileName: file.name, assetType, assetName: file.name })
  });
  const url = String(blob?.url || "");
  if (!url) throw new Error(`Storage accepted ${file.name} but returned no address for it.`);
  return url;
}
