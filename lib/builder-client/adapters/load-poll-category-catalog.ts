/**
 * Client-safe poll-category-catalog helpers.
 * The full catalog loader is server-only; the builder UI only needs the sort helper. Category data comes from /api/polls
 * via lib/builder-client/poll-category-catalog-client.ts.
 */
export function sortPollCategoryNames(names: readonly string[]): string[] {
  return [...names].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  );
}
