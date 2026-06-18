'use strict';

/**
 * Copies lipis/flag-icons (MIT) 4×3 SVGs into
 * public/images/community_assets/icons/flags/
 * and writes an index.json manifest.
 *
 * Re-run after `npm install flag-icons` to update.
 */

const fs = require('fs');
const path = require('path');

const PKG_DIR = path.join(__dirname, '..', 'node_modules', 'flag-icons');
const FLAGS_SRC = path.join(PKG_DIR, 'flags', '4x3');
const COUNTRY_JSON = path.join(PKG_DIR, 'country.json');
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'community_assets', 'icons', 'flags');

const countries = JSON.parse(fs.readFileSync(COUNTRY_JSON, 'utf8'));

const byCode = {};
for (const c of countries) {
  byCode[c.code.toLowerCase()] = c;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(FLAGS_SRC).filter((f) => f.endsWith('.svg')).sort();
const manifest = [];

for (const file of files) {
  const code = file.replace(/\.svg$/, '');
  const meta = byCode[code];
  const name = meta ? meta.name : code.toUpperCase();
  const continent = meta ? meta.continent : 'Other';

  fs.copyFileSync(path.join(FLAGS_SRC, file), path.join(OUT_DIR, file));

  manifest.push({
    code,
    name,
    continent,
    file,
    location: `/images/community_assets/icons/flags/${file}`,
    source: 'flag-icons',
  });
}

manifest.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const continents = [...new Set(manifest.map((f) => f.continent).filter(Boolean))].sort();

fs.writeFileSync(
  path.join(OUT_DIR, 'README.md'),
  [
    '# Community Flags',
    '',
    'Country flags from [lipis/flag-icons](https://github.com/lipis/flag-icons) — MIT license.',
    'All flags are 4×3 SVGs named by ISO 3166-1 alpha-2 code.',
    '',
    `Total: ${manifest.length} flags`,
    '',
    '## Usage',
    '```html',
    '<img src="/images/community_assets/icons/flags/us.svg" width="40" height="30" />',
    '```',
    '',
    '## Continents',
    continents.map((c) => `- **${c}** — ${manifest.filter((f) => f.continent === c).length} flags`).join('\n'),
    '',
    '## All flags',
    manifest.map((f) => `- \`${f.code}\` — ${f.name} (${f.continent})`).join('\n'),
  ].join('\n') + '\n',
  'utf8'
);

console.log(`Copied ${manifest.length} flag SVGs to ${path.relative(process.cwd(), OUT_DIR)}`);
console.log(`Continents: ${continents.join(', ')}`);
