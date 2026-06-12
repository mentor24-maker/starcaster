/**
 * Drop-in replacement for next/link rendering a plain anchor.
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react';

type NextLinkCompatProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname?: string };
  prefetch?: boolean;
  children?: ReactNode;
};

export default function Link({ href, prefetch: _prefetch, children, ...rest }: NextLinkCompatProps) {
  const resolved = typeof href === 'string' ? href : href?.pathname ?? '#';
  return (
    <a href={resolved} {...rest}>
      {children}
    </a>
  );
}
