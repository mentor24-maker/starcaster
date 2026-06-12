import type { PollCategorySeed } from "@/lib/poll-categories";

export function parsePollCategoriesApiResponse(json: unknown): PollCategorySeed[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return [];
  }

  const categories = (json as { data?: { categories?: unknown } }).data?.categories;
  if (!Array.isArray(categories)) {
    return [];
  }

  return categories.filter(
    (entry): entry is PollCategorySeed =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as PollCategorySeed).name === "string" &&
      typeof (entry as PollCategorySeed).slug === "string" &&
      (entry as PollCategorySeed).name.trim().length > 0
  );
}

let cachedCatalog: PollCategorySeed[] | null = null;
let inflightRequest: Promise<PollCategorySeed[]> | null = null;

export function getCachedPollCategoryCatalog(): PollCategorySeed[] | null {
  return cachedCatalog;
}

export function clearPollCategoryCatalogCache(): void {
  cachedCatalog = null;
  inflightRequest = null;
}

/** Fetches the full poll category catalog (shared cache; never falls back to seed-only list). */
export async function fetchPollCategoryCatalog(): Promise<PollCategorySeed[]> {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  if (!inflightRequest) {
    inflightRequest = (async () => {
      const response = await fetch("/api/polls/categories", { cache: "no-store" });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to load poll categories."
        );
      }

      const categories = parsePollCategoriesApiResponse(payload);
      if (categories.length === 0) {
        throw new Error("Poll category catalog was empty.");
      }

      cachedCatalog = categories;
      return categories;
    })().finally(() => {
      inflightRequest = null;
    });
  }

  return inflightRequest;
}
