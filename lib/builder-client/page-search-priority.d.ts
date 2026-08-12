export type PageSearchPriorityValue = "pinned" | "boosted" | "normal" | "lowered" | "hidden";

export declare const PAGE_SEARCH_PRIORITIES: ReadonlyArray<{
  value: PageSearchPriorityValue;
  label: string;
  hint: string;
}>;
export declare const PAGE_SEARCH_PRIORITY_VALUES: readonly PageSearchPriorityValue[];
export declare const DEFAULT_PAGE_SEARCH_PRIORITY: PageSearchPriorityValue;
export declare function normalizePageSearchPriority(value: unknown): PageSearchPriorityValue;
