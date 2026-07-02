export function normalizeGalleryMediaTopic(value: unknown): string {
  return String(value ?? "").trim().slice(0, 255);
}

/** Builds sorted, de-duplicated Topic filter options from the currently loaded media. */
export function buildGalleryMediaTopicOptions(extraTopics: string[] = []): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const entry of extraTopics) {
    const label = normalizeGalleryMediaTopic(entry);

    if (!label || seen.has(label.toLowerCase())) {
      continue;
    }

    seen.add(label.toLowerCase());
    ordered.push(label);
  }

  return ordered.sort((a, b) => a.localeCompare(b));
}
