export function safeText(value: unknown, max = 10000) {
  return String(value ?? "").trim().slice(0, max);
}

function decodeGalleryStorageSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Extract `/gallery/{storageName}` from absolute URLs (Supabase, site, media-file proxy). */
export function galleryAssetPathFromUrl(url: URL): string {
  const pathnamePatterns = [
    /^\/storage\/v1\/(?:object\/public|render\/image\/public)\/gallery\/(.+)$/i,
    /^\/api\/admin\/media-file\/gallery\/(.+)$/i
  ];

  for (const pattern of pathnamePatterns) {
    const match = url.pathname.match(pattern);

    if (match?.[1]) {
      return `/gallery/${decodeGalleryStorageSegment(match[1])}`;
    }
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const galleryIndex = parts.findIndex((part) => part === "gallery");

  if (galleryIndex >= 0) {
    const storageName = parts
      .slice(galleryIndex + 1)
      .map((part) => decodeGalleryStorageSegment(part))
      .join("/");

    if (storageName) {
      return `/gallery/${storageName}`;
    }
  }

  return "";
}

function isNormieSiteOrigin(origin: string) {
  return (
    origin === "http://localhost:3000" ||
    origin === "https://www.normie.one" ||
    origin === "https://normie.one"
  );
}

/** Normalize gallery/media paths without pulling rich-text sanitization into client bundles. */
export function normalizeBuilderAssetUrl(value: unknown): string {
  const text = safeText(value, 4000);

  if (!text) {
    return "";
  }

  if (text.startsWith("gallery/")) {
    return `/${text}`;
  }

  if (text.startsWith("api/admin/media-file/gallery/")) {
    return `/${text.replace("api/admin/media-file/gallery/", "gallery/")}`;
  }

  if (text.startsWith("/api/admin/media-file/gallery/")) {
    return text.replace("/api/admin/media-file/gallery/", "/gallery/");
  }

  try {
    const url = new URL(text);

    if (url.pathname === "/_next/image") {
      const nested = url.searchParams.get("url");
      return nested ? normalizeBuilderAssetUrl(nested) : "";
    }

    const galleryPath = galleryAssetPathFromUrl(url);

    if (galleryPath) {
      return galleryPath;
    }

    if (url.pathname.startsWith("/api/admin/media-file/gallery/")) {
      return url.pathname.replace("/api/admin/media-file/gallery/", "/gallery/") + url.search;
    }

    if (isNormieSiteOrigin(url.origin)) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    // Keep relative URLs and other non-URL strings as-is.
  }

  return text;
}

/**
 * URL for `<img src>` on the public site and builder preview (not admin-only proxies).
 * Gallery files → `/gallery/…` (local disk + Supabase). Other uploaded assets → `/media/…`.
 */
export function resolvePublicBuilderAssetUrl(value: unknown): string {
  const normalized = normalizeBuilderAssetUrl(value);

  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("/gallery/")) {
    return normalized;
  }

  if (normalized.startsWith("/api/admin/media-file/gallery/")) {
    return normalized.replace("/api/admin/media-file/gallery/", "/gallery/");
  }

  if (normalized.startsWith("/api/admin/media-file/")) {
    return normalized.replace("/api/admin/media-file/", "/media/");
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return normalized;
}
