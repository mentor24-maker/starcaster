/**
 * Starcaster replacement for normie's lib/site-url.
 * Client-side only: derives the site origin from the current window.
 */

export function getSiteUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

/** Base URL used inside auth emails; server bundles override via SITE_URL. */
export function getAuthEmailSiteUrl(): string {
  if (typeof process !== 'undefined' && process.env?.SITE_URL) {
    return process.env.SITE_URL.replace(/\/+$/, '');
  }
  return getSiteUrl();
}

export function toAbsoluteSiteUrl(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  const base = getSiteUrl().replace(/\/+$/, '');
  return `${base}${text.startsWith('/') ? '' : '/'}${text}`;
}
