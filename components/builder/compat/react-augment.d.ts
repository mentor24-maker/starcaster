/**
 * React 19 type features used by the ported Builder components, backfilled for
 * the React 18 type definitions starcaster builds against.
 */
import 'react';

declare module 'react' {
  interface HTMLAttributes<T> {
    /** React 19 supports the inert attribute natively. */
    inert?: boolean;
  }
}
