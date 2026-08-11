/**
 * Shared esbuild settings for every bundle this repo builds.
 *
 * WHY THIS EXISTS — `--preserve-symlinks`
 *
 * esbuild writes each bundled module's path into the output as a comment:
 *
 *     // node_modules/orderedmap/dist/index.js
 *
 * By default it resolves symlinks to their real location first. A worktree
 * whose `node_modules` is a SYMLINK to the main checkout therefore emits
 *
 *     // ../../../node_modules/orderedmap/dist/index.js
 *
 * Same code, different bytes, different content hash. Since `?v=` cache
 * busters ARE that hash (see pin_asset_versions.cjs), a bundle built in a
 * symlinked worktree pins a version no clean build can reproduce — CI's
 * "Asset pins match a clean build" step fails on artifacts the change never
 * touched. That cost a round trip on PR #149 (2026-08-10) and was misdiagnosed
 * as dependency drift first; the dependency tree was fine.
 *
 * `--preserve-symlinks` makes the emitted path relative to the worktree
 * either way, so the build is a function of the SOURCE rather than of how
 * this particular folder happens to reach its dependencies. Verified on
 * 2026-08-10: byte-identical to the previous output on a real `node_modules`
 * (so no pins churned when this landed), and byte-identical between a real
 * and a symlinked tree.
 *
 * `scripts/check_build_paths.cjs` enforces the outcome rather than the flag —
 * it fails if any built artifact contains a module path that escapes the
 * repo, which catches a new build script that forgets to import this.
 */

/** esbuild CLI flags — spread into an `npx esbuild` argument list. */
export const PORTABLE_BUILD_ARGS = ['--preserve-symlinks'];

/** Same settings for esbuild's JS API (`build({ ... })`). */
export const PORTABLE_BUILD_OPTIONS = { preserveSymlinks: true };
