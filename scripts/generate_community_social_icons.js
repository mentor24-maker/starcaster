const fs = require('fs');
const path = require('path');
const icons = require('simple-icons');

const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'community_assets', 'social_icons');

const SOCIAL_ICONS = [
  { slug: 'behance', icon: icons.siBehance },
  { slug: 'bluesky', icon: icons.siBluesky },
  { slug: 'buffer', icon: icons.siBuffer },
  { slug: 'discord', icon: icons.siDiscord },
  { slug: 'dribbble', icon: icons.siDribbble },
  { slug: 'facebook', icon: icons.siFacebook },
  { slug: 'github', icon: icons.siGithub },
  { slug: 'instagram', icon: icons.siInstagram },
  { slug: 'mastodon', icon: icons.siMastodon },
  { slug: 'medium', icon: icons.siMedium },
  { slug: 'messenger', icon: icons.siMessenger },
  { slug: 'pinterest', icon: icons.siPinterest },
  { slug: 'quora', icon: icons.siQuora },
  { slug: 'reddit', icon: icons.siReddit },
  { slug: 'rss', icon: icons.siRss },
  { slug: 'signal', icon: icons.siSignal },
  { slug: 'snapchat', icon: icons.siSnapchat },
  { slug: 'substack', icon: icons.siSubstack },
  { slug: 'telegram', icon: icons.siTelegram },
  { slug: 'threads', icon: icons.siThreads },
  { slug: 'tiktok', icon: icons.siTiktok },
  { slug: 'tumblr', icon: icons.siTumblr },
  { slug: 'twitch', icon: icons.siTwitch },
  { slug: 'whatsapp', icon: icons.siWhatsapp },
  { slug: 'x', icon: icons.siX },
  { slug: 'youtube', icon: icons.siYoutube }
];

const CUSTOM_ICONS = [
  {
    slug: 'linkedin',
    title: 'LinkedIn',
    hex: '0A66C2',
    svg: `<svg fill="#0A66C2" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>LinkedIn</title><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`
  },
  {
    slug: 'slack',
    title: 'Slack',
    hex: '4A154B',
    svg: `<svg fill="none" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Slack</title><path fill="#36C5F0" d="M6.35 14.2a2.35 2.35 0 1 1-2.35 2.35v-2.35h2.35Zm1.18 0a2.35 2.35 0 0 1 4.7 0v5.88a2.35 2.35 0 1 1-4.7 0V14.2Z"/><path fill="#2EB67D" d="M9.88 6.35A2.35 2.35 0 1 1 12.23 4v2.35H9.88Zm0 1.18a2.35 2.35 0 0 1 0 4.7H4a2.35 2.35 0 1 1 0-4.7h5.88Z"/><path fill="#ECB22E" d="M17.65 9.88A2.35 2.35 0 1 1 20 7.53v2.35h-2.35Zm-1.18 0a2.35 2.35 0 0 1-4.7 0V4a2.35 2.35 0 1 1 4.7 0v5.88Z"/><path fill="#E01E5A" d="M14.12 17.65A2.35 2.35 0 1 1 11.77 20v-2.35h2.35Zm0-1.18a2.35 2.35 0 1 1 0-4.7H20a2.35 2.35 0 1 1 0 4.7h-5.88Z"/></svg>`
  },
  {
    slug: 'web',
    title: 'Web',
    hex: '111827',
    svg: `<svg fill="none" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Web</title><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="#111827" stroke-width="2"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.25 2.45 3.38 5.45 3.38 9S14.25 18.55 12 21c-2.25-2.45-3.38-5.45-3.38-9S9.75 5.45 12 3Z" stroke="#111827" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`
  }
];

function formatSimpleIcon(entry) {
  const { icon } = entry;
  return `<svg fill="#${icon.hex}" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${icon.title}</title><path d="${icon.path}"/></svg>`;
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, `${content}\n`, 'utf8');
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];

for (const entry of SOCIAL_ICONS) {
  if (!entry.icon) {
    throw new Error(`Missing simple-icons entry for ${entry.slug}`);
  }

  const fileName = `${entry.slug}.svg`;
  writeFile(path.join(OUT_DIR, fileName), formatSimpleIcon(entry));
  manifest.push({
    slug: entry.slug,
    title: entry.icon.title,
    color: `#${entry.icon.hex}`,
    file: fileName,
    source: 'simple-icons'
  });
}

for (const entry of CUSTOM_ICONS) {
  const fileName = `${entry.slug}.svg`;
  writeFile(path.join(OUT_DIR, fileName), entry.svg);
  manifest.push({
    slug: entry.slug,
    title: entry.title,
    color: `#${entry.hex}`,
    file: fileName,
    source: 'starcaster'
  });
}

manifest.sort((a, b) => a.slug.localeCompare(b.slug));

writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifest, null, 2));

writeFile(
  path.join(OUT_DIR, 'README.md'),
  [
    '# Community Social Icons',
    '',
    'Shared Starcaster social SVG assets. Reference these from any project with `/images/community_assets/social_icons/<slug>.svg`.',
    '',
    'Most brand marks are generated from `simple-icons`; Starcaster-owned fallbacks are marked in `index.json`.',
    '',
    `Generated icons: ${manifest.map((item) => item.slug).join(', ')}.`
  ].join('\n')
);

console.log(`Generated ${manifest.length} social icons in ${path.relative(process.cwd(), OUT_DIR)}`);
