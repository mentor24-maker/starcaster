'use strict';

const fs = require('fs');
const path = require('path');
const icons = require('simple-icons');

const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'community_assets', 'social_icons');

// All icons sourced from simple-icons (simpleicons.org) — CC0 licensed.
// Add entries here; re-run this script to regenerate SVGs + index.json.
const SOCIAL_ICONS = [
  // ── Social networks ──────────────────────────────────────────────────────
  { slug: 'facebook',    icon: icons.siFacebook },
  { slug: 'instagram',   icon: icons.siInstagram },
  { slug: 'threads',     icon: icons.siThreads },
  { slug: 'x',           icon: icons.siX },
  { slug: 'bluesky',     icon: icons.siBluesky },
  { slug: 'mastodon',    icon: icons.siMastodon },
  { slug: 'pinterest',   icon: icons.siPinterest },
  { slug: 'tumblr',      icon: icons.siTumblr },
  { slug: 'snapchat',    icon: icons.siSnapchat },
  { slug: 'tiktok',      icon: icons.siTiktok },
  { slug: 'reddit',      icon: icons.siReddit },
  { slug: 'quora',       icon: icons.siQuora },
  { slug: 'vk',          icon: icons.siVk },
  { slug: 'wechat',      icon: icons.siWechat },
  { slug: 'line',        icon: icons.siLine },
  { slug: 'flipboard',   icon: icons.siFlipboard },
  // ── Messaging / communities ───────────────────────────────────────────────
  { slug: 'messenger',   icon: icons.siMessenger },
  { slug: 'whatsapp',    icon: icons.siWhatsapp },
  { slug: 'telegram',    icon: icons.siTelegram },
  { slug: 'signal',      icon: icons.siSignal },
  { slug: 'discord',     icon: icons.siDiscord },
  // ── Video platforms ───────────────────────────────────────────────────────
  { slug: 'youtube',     icon: icons.siYoutube },
  { slug: 'twitch',      icon: icons.siTwitch },
  { slug: 'kick',        icon: icons.siKick },
  { slug: 'vimeo',       icon: icons.siVimeo },
  { slug: 'rumble',      icon: icons.siRumble },
  // ── Audio / music / podcasts ──────────────────────────────────────────────
  { slug: 'spotify',     icon: icons.siSpotify },
  { slug: 'soundcloud',  icon: icons.siSoundcloud },
  { slug: 'bandcamp',    icon: icons.siBandcamp },
  { slug: 'mixcloud',    icon: icons.siMixcloud },
  { slug: 'applepodcasts', icon: icons.siApplepodcasts },
  { slug: 'podcastindex', icon: icons.siPodcastindex },
  // ── Creator / monetization ────────────────────────────────────────────────
  { slug: 'patreon',     icon: icons.siPatreon },
  { slug: 'kofi',        icon: icons.siKofi },
  { slug: 'buymeacoffee', icon: icons.siBuymeacoffee },
  { slug: 'substack',    icon: icons.siSubstack },
  { slug: 'medium',      icon: icons.siMedium },
  { slug: 'ghost',       icon: icons.siGhost },
  { slug: 'wordpress',   icon: icons.siWordpress },
  { slug: 'hashnode',    icon: icons.siHashnode },
  { slug: 'devto',       icon: icons.siDevdotto },
  { slug: 'kickstarter', icon: icons.siKickstarter },
  // ── Design / portfolio ────────────────────────────────────────────────────
  { slug: 'behance',     icon: icons.siBehance },
  { slug: 'dribbble',    icon: icons.siDribbble },
  { slug: 'figma',       icon: icons.siFigma },
  { slug: 'notion',      icon: icons.siNotion },
  { slug: 'miro',        icon: icons.siMiro },
  // ── Developer / code ─────────────────────────────────────────────────────
  { slug: 'github',      icon: icons.siGithub },
  { slug: 'gitlab',      icon: icons.siGitlab },
  { slug: 'bitbucket',   icon: icons.siBitbucket },
  { slug: 'stackoverflow', icon: icons.siStackoverflow },
  { slug: 'replit',      icon: icons.siReplit },
  // ── Professional ─────────────────────────────────────────────────────────
  { slug: 'xing',        icon: icons.siXing },
  { slug: 'wellfound',   icon: icons.siWellfound },
  { slug: 'crunchbase',  icon: icons.siCrunchbase },
  { slug: 'producthunt', icon: icons.siProducthunt },
  { slug: 'goodreads',   icon: icons.siGoodreads },
  { slug: 'letterboxd',  icon: icons.siLetterboxd },
  { slug: 'strava',      icon: icons.siStrava },
  // ── Commerce / platforms ──────────────────────────────────────────────────
  { slug: 'etsy',        icon: icons.siEtsy },
  { slug: 'shopify',     icon: icons.siShopify },
  { slug: 'paypal',      icon: icons.siPaypal },
  // ── Big tech (commonly linked) ────────────────────────────────────────────
  { slug: 'apple',       icon: icons.siApple },
  { slug: 'google',      icon: icons.siGoogle },
  { slug: 'gmail',       icon: icons.siGmail },
  // ── Discovery / curation ─────────────────────────────────────────────────
  { slug: 'linktree',    icon: icons.siLinktree },
  { slug: 'buffer',      icon: icons.siBuffer },
  { slug: 'rss',         icon: icons.siRss },
  { slug: 'clubhouse',   icon: icons.siClubhouse },
];

// Icons that need a hand-crafted SVG (no simple-icons entry, or color variant).
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
  },
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
const missingIcons = [];

for (const entry of SOCIAL_ICONS) {
  if (!entry.icon) {
    missingIcons.push(entry.slug);
    console.warn(`  ⚠  Missing simple-icons entry for "${entry.slug}" — skipped`);
    continue;
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
    'Shared Starcaster social SVG assets. Reference from any project with `/images/community_assets/social_icons/<slug>.svg`.',
    '',
    'Most brand marks are generated from `simple-icons` (simpleicons.org, CC0); Starcaster-owned fallbacks are marked in `index.json`.',
    '',
    '## Icons',
    '',
    manifest.map((item) => `- **${item.slug}** — ${item.title}`).join('\n'),
  ].join('\n')
);

if (missingIcons.length > 0) {
  console.log(`\nSkipped (not found in simple-icons): ${missingIcons.join(', ')}`);
}
console.log(`\nGenerated ${manifest.length} social icons in ${path.relative(process.cwd(), OUT_DIR)}`);
