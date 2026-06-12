/**
 * Client-safe subset of normie's lib/load-poll-category-catalog.
 * The catalog loader there is server-only (supabase-admin); the builder
 * UI only needs the sort helper. Category data comes from /api/polls
 * via lib/builder-client/poll-category-catalog-client.ts.
 */
export function sortPollCategoryNames(names: readonly string[]): string[] {
  return [...names].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  );
}
