/** Page id → the page's CURRENT slug. See page-link.js. */
export type PageAddressMap = Record<string, string> | Map<string, string>;

export declare const PAGE_LINK_PREFIX: "page:";
export declare function isPageLink(value: unknown): boolean;
export declare function parsePageLink(value: unknown): { pageId: string; fallback: string } | null;
export declare function makePageLink(pageId: unknown, fallback: unknown): string;
export declare function addressForSlug(slug: unknown, fallback: unknown): string;
export declare function resolvePageLink(
  value: unknown,
  addresses?: PageAddressMap | null
): { href: string; pageId: string; missing: boolean };
export declare function pageLinkHref(value: unknown, addresses?: PageAddressMap | null): string;
export declare function resolvePageLinksInSettings<T extends Record<string, unknown> | null | undefined>(
  settings: T,
  addresses?: PageAddressMap | null
): T;
export declare function collectPageLinkIds(value: unknown): Set<string>;
export declare function buildPageAddressMap(pages: unknown): Record<string, string>;
