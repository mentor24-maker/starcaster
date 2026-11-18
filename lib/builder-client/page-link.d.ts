/** Page id → the page's CURRENT slug. See page-link.js. */
export type PageAddressMap = Record<string, string> | Map<string, string>;

export declare const PAGE_LINK_PREFIX: "page:";
export declare function isPageLink(value: unknown): boolean;
export declare function parsePageLink(value: unknown): { pageId: string; sectionId: string; fallback: string } | null;
export declare function makePageLink(pageId: unknown, fallback: unknown, sectionId?: unknown): string;
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
export declare function resolvePageLinksInJsonText(text: string, addresses?: PageAddressMap | null): string;
export declare const PAGE_LINK_ATTR: "data-page-link";
export declare function resolvePageLinksInHtml(html: string, addresses?: PageAddressMap | null): string;
export declare function collectPageLinkIds(value: unknown): Set<string>;
export declare function buildPageAddressMap(pages: unknown): Record<string, string>;
export declare const ANCHOR_NAME_MAX: number;
export declare function normalizeAnchorName(value: unknown): string;
export declare function sectionAnchorKey(pageId: unknown, sectionId: unknown): string;
export declare function sectionsOfLayout(layout: unknown): unknown[];
export declare function addSectionAnchors(map: Record<string, string>, pageId: unknown, layout: unknown): Record<string, string>;
export declare function listSectionAnchors(layout: unknown): Array<{ sectionId: string; anchorName: string; title: string }>;
export declare function mentionsSectionLink(value: unknown): boolean;
