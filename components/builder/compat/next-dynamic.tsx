/**
 * Drop-in replacement for next/dynamic backed by React.lazy. The builder
 * bundle is client-only, so the ssr option is ignored.
 */
import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';

type DynamicOptions = {
  ssr?: boolean;
  loading?: () => ReactNode;
};

export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  options?: DynamicOptions
) {
  const Lazy = lazy(async () => {
    const mod = await loader();
    return typeof mod === 'object' && mod !== null && 'default' in mod
      ? (mod as { default: ComponentType<P> })
      : { default: mod as ComponentType<P> };
  });

  const LazyAny = Lazy as unknown as ComponentType<P>;

  function DynamicComponent(props: P) {
    return (
      <Suspense fallback={options?.loading ? options.loading() : null}>
        <LazyAny {...props} />
      </Suspense>
    );
  }

  return DynamicComponent;
}
