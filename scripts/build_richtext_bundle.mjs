import { build } from 'esbuild';

await build({
  entryPoints: ['public/js/richtext-vendor-entry.js'],
  outfile: 'public/js/richtext-vendor.js',
  bundle: true,
  format: 'iife',
  globalName: 'TipTapBundle',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'none',
});

console.log('Built public/js/richtext-vendor.js');
