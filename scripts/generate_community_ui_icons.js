'use strict';

/**
 * Copies Heroicons (MIT) outline + solid SVGs into
 * public/images/community_assets/ui_icons/{outline,solid}/
 * and writes an index.json manifest.
 *
 * Re-run after `npm install heroicons` to update.
 */

const fs = require('fs');
const path = require('path');

const HEROICONS_DIR = path.join(__dirname, '..', 'node_modules', 'heroicons', '24');
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'community_assets', 'ui_icons');

function slugToTitle(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const manifest = [];

for (const variant of ['outline', 'solid']) {
  const srcDir = path.join(HEROICONS_DIR, variant);
  const destDir = path.join(OUT_DIR, variant);

  fs.mkdirSync(destDir, { recursive: true });

  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.svg')).sort();

  for (const file of files) {
    const slug = file.replace(/\.svg$/, '');
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    manifest.push({
      slug,
      title: slugToTitle(slug),
      variant,
      file: `ui_icons/${variant}/${file}`,
      location: `/images/community_assets/ui_icons/${variant}/${file}`,
      source: 'heroicons',
    });
  }
}

manifest.sort((a, b) => a.slug.localeCompare(b.slug) || a.variant.localeCompare(b.variant));

fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

fs.writeFileSync(
  path.join(OUT_DIR, 'README.md'),
  [
    '# Community UI Icons',
    '',
    'Heroicons (heroicons.com) — MIT license.',
    'All icons are 24×24 SVGs using `stroke="currentColor"` (outline) or `fill="currentColor"` (solid).',
    'They inherit color from the surrounding CSS `color` property.',
    '',
    `Total: ${manifest.length} icons (${manifest.filter((i) => i.variant === 'outline').length} outline + ${manifest.filter((i) => i.variant === 'solid').length} solid)`,
    '',
    '## Usage',
    '```html',
    '<img src="/images/community_assets/ui_icons/outline/heart.svg" width="24" height="24" />',
    '```',
    '',
    '## Available icons',
    [...new Set(manifest.map((i) => i.slug))].map((s) => `- ${s}`).join('\n'),
  ].join('\n') + '\n',
  'utf8'
);

console.log(`Copied ${manifest.length} Heroicons SVGs to ${path.relative(process.cwd(), OUT_DIR)}`);
