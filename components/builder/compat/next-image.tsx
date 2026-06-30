/**
 * Drop-in replacement for next/image so ported Builder components render
 * with a plain <img>. Optimization-only props are accepted and ignored.
 */
import type { CSSProperties, ImgHTMLAttributes } from 'react';

type NextImageCompatProps = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  sizes?: string;
  unoptimized?: boolean;
  priority?: boolean;
};

export default function Image({
  fill,
  sizes: _sizes,
  unoptimized: _unoptimized,
  priority: _priority,
  style,
  alt = '',
  ...rest
}: NextImageCompatProps) {
  const fillStyle: CSSProperties | undefined = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
    : undefined;
  return <img alt={alt} loading="lazy" {...rest} style={{ ...fillStyle, ...style }} />;
}
