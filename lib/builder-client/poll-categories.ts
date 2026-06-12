export type PollCategorySeed = {
  id?: string;
  name: string;
  slug: string;
};

const POLL_CATEGORY_ALIASES: Record<string, string> = {
  "future-and-past": "Future / Power",
  random: "Random"
};

export function slugifyPollCategory(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePollCategoryKey(value: string) {
  return slugifyPollCategory(value);
}

/** Case-insensitive equality for poll category labels (URL params, DB rows, preferences). */
export function pollCategoriesEqual(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();

  if (!a || !b) {
    return false;
  }

  if (a.toLowerCase() === b.toLowerCase()) {
    return true;
  }

  return slugifyPollCategory(a) === slugifyPollCategory(b);
}

/** True when a poll category slug matches any preferred slug (case-insensitive). */
export function pollCategorySlugMatchesAny(
  pollCategorySlug: string | null | undefined,
  preferredSlugs: readonly string[]
): boolean {
  const pollSlug = slugifyPollCategory(String(pollCategorySlug ?? ""));

  if (!pollSlug) {
    return false;
  }

  return preferredSlugs.some((preferred) => slugifyPollCategory(preferred) === pollSlug);
}

export function resolvePollCategoryName(
  param: string | null | undefined,
  catalog: readonly PollCategorySeed[] = []
): string | null {
  const raw = param?.trim();

  if (!raw) {
    return null;
  }

  const normalized = normalizePollCategoryKey(raw);
  const aliasName = POLL_CATEGORY_ALIASES[normalized];

  if (aliasName) {
    return aliasName;
  }

  for (const category of catalog) {
    if (
      category.slug === normalized ||
      pollCategoriesEqual(category.name, raw) ||
      normalizePollCategoryKey(category.name) === normalized
    ) {
      return category.name;
    }
  }

  return formatPollCategoryDisplayName(raw);
}

export function buildPollsNextRequestUrl(
  categoryParam: string | null | undefined,
  startPollId?: string | null
) {
  const params = new URLSearchParams();
  const categoryRaw = categoryParam?.trim();

  if (categoryRaw) {
    params.set("category", categoryRaw);
  }

  const startRaw = startPollId?.trim();

  if (startRaw) {
    params.set("startPoll", startRaw);
  }

  const qs = params.toString();
  return qs ? `/api/polls/next?${qs}` : "/api/polls/next";
}

/** Home page URL filtered to a poll category (see `PollExperience` `category` query param). */
export function buildPublicPollCategoryPath(category: Pick<PollCategorySeed, "slug">): string {
  const params = new URLSearchParams();
  params.set("category", category.slug);
  return `/?${params.toString()}`;
}

/** Home page URL that opens a specific published poll as the current question (`startPoll` only). */
export function buildPublicPollViewPath(poll: { id: string }): string {
  const params = new URLSearchParams();
  params.set("startPoll", poll.id);
  return `/?${params.toString()}`;
}

export function stripStartPollFromBrowserUrl(): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (!url.searchParams.has("startPoll")) {
    return;
  }

  url.searchParams.delete("startPoll");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next);
}

/** Human-readable category label for UI (Title Case; slug segments become words). */
export function formatPollCategoryDisplayName(nameOrSlug: string): string {
  const trimmed = nameOrSlug.trim();

  if (!trimmed) {
    return "";
  }

  if (/[-/]/.test(trimmed) && /^[a-z0-9/-]+$/.test(trimmed)) {
    return trimmed
      .split(/[-/]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  if (/&/.test(trimmed)) {
    return trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  if (/^[a-z0-9]+$/.test(trimmed)) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }

  return trimmed;
}

export function getPollCategoryMeta(
  param: string | null | undefined,
  catalog: readonly PollCategorySeed[] = []
): PollCategorySeed | null {
  const raw = param?.trim();

  if (!raw) {
    return null;
  }

  const normalized = normalizePollCategoryKey(raw);

  for (const category of catalog) {
    if (
      category.slug === normalized ||
      pollCategoriesEqual(category.name, raw) ||
      normalizePollCategoryKey(category.name) === normalized
    ) {
      return category;
    }
  }

  const aliasName = POLL_CATEGORY_ALIASES[normalized];

  if (aliasName) {
    return {
      name: aliasName,
      slug: slugifyPollCategory(aliasName)
    };
  }

  const name = formatPollCategoryDisplayName(raw);

  if (!name) {
    return null;
  }

  return {
    name,
    slug: slugifyPollCategory(name)
  };
}

export function sortPollCategorySeeds(categories: readonly PollCategorySeed[]): PollCategorySeed[] {
  return [...categories].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}
