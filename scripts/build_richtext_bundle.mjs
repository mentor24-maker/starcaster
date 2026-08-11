import { build } from 'esbuild';
import { PORTABLE_BUILD_OPTIONS } from './esbuild-common.mjs';

await build({
  entryPoints: ['public/js/richtext-vendor-entry.js'],
  outfile: 'public/js/richtext-vendor.js',
  bundle: true,
  format: 'iife',
  globalName: 'TipTapBundle',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'none',
  ...PORTABLE_BUILD_OPTIONS,
});

console.log('Built public/js/richtext-vendor.js');
