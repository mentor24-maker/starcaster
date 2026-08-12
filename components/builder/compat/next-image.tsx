/**
 * Drop-in replacement for next/image so ported Builder components render
 * with a plain <img>. Optimization-only props are accepted and ignored.
 *
 * With one exception, and it matters: this component is the single place every
 * ported `<Image>` passes through — the slider, card grids, the gallery picker.
 * It used to discard `sizes` and hand the browser nothing but the original
 * file, which is why the Delray slider still pulled thirteen full-size
 * originals after every other module had been taught to use the scaled-down
 * copies (2026-08-12). Offering the copies here fixes every `<Image>` at once.
 *
 * An image with no copies renders exactly as before — `imageProps` returns just
 * a `src`, so nothing points at a file that was never generated.
 */
import type { CSSProperties, ImgHTMLAttributes } from 'react';
import { imageProps } from '@/lib/image-renditions';

type NextImageCompatProps = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  sizes?: string;
  unoptimized?: boolean;
  priority?: boolean;
};

export default function Image({
  fill,
  sizes,
  unoptimized: _unoptimized,
  priority: _priority,
  style,
  alt = '',
  ...rest
}: NextImageCompatProps) {
  const fillStyle: CSSProperties | undefined = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }
    : undefined;

  // `sizes` is the caller's own statement of how wide the slot is — the slider
  // says "280px" — so it is exactly the hint the browser needs, and passing it
  // through is what stops a 280px slot fetching a 1920px file.
  const responsive = imageProps(rest.src, { sizes });

  return <img alt={alt} loading="lazy" {...rest} {...responsive} style={{ ...fillStyle, ...style }} />;
}
