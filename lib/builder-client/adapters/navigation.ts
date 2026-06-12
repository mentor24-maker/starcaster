/**
 * Starcaster replacements for next/navigation hooks. The builder is
 * client-only on a static shell, so location is stable per mount.
 */

export function usePathname(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

export function useSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}
