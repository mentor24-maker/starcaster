'use strict';

/**
 * Copies unDraw illustrations (MIT license) into
 * public/images/community_assets/illustrations/
 * and writes an index.json manifest with broad categories.
 *
 * Re-run after `npm install undraw-svg` to update.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'node_modules', 'undraw-svg', 'svgs');
const MANIFEST_SRC = path.join(__dirname, '..', 'node_modules', 'undraw-svg', 'illustrations.json');
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'community_assets', 'illustrations');

// Map keywords → broad category (first match wins, longest list checked first)
const CATEGORY_MAP = [
  ['Technology',    [
    'mobile','app','website','web','server','cloud','computer','device','digital',
    'software','code','developer','programming','api','database','security',
    'artificial','ai','robot','tech','cyber','blockchain','crypto','bitcoin',
    'vr','ar','drone','smart','iot','machine','learning','neural','automation',
    'interface','keyboard','screen','laptop','tablet','gadget','hardware',
    'authentication','login','password','maintenance','dialog','dropdown','virtual',
    'windows','popup','menu','toggle','filter','wizard','modal','button','cursor',
    'select','checkbox','radio','settings','configure','update','install','debug',
    'deploy','pipeline','devops','terminal','dashboard','notification','alert',
    'monitor','log','error','warning','bug','test','qa','launch','build',
  ]],
  ['People',        [
    'avatar','person','people','girl','boy','man','woman','friends','family',
    'team','profile','character','selfie','portrait','human','crowd','couple',
    'colleague','employee','user','users','group','individual','child','kid',
    'baby','senior','teenager','adult','female','male','worker','customer',
  ]],
  ['Business',      [
    'business','work','office','meeting','startup','company','job','career',
    'productivity','management','project','tasks','task','process','workflow',
    'strategy','goal','feedback','progress','plan','pitch','investor','revenue',
    'growth','entrepreneur','freelance','remote','working','cooperation',
    'negotiation','presentation','interview','resume','hr','hiring',
    'referral','problem','conference','speaker','logistics','collaborate',
    'completing','focused','clearing','choose','agile','scrum','sprint',
    'deadline','milestone','roadmap','kpi','okr','budget','proposal','contract',
    'partner','client','stakeholder','solution','innovation','consulting','agency',
  ]],
  ['Social',        [
    'social','chat','messaging','email','communication','community','network',
    'share','post','comment','like','notification','notifications','message',
    'messages','voice','inbox','contact','follow','subscribe','mentions',
    'broadcast','conversation','discussion','connection','connected',
    'texting','newsfeed','respond','blogging','blog','forum','respond',
    'feedback','review','rating','testimonial','reply','thread',
  ]],
  ['Data',          [
    'data','analytics','chart','statistics','dashboard','graph','report',
    'finance','money','payment','investment','revenue','budget','accounting',
    'bank','tax','price','market','stock','trading','currency','wallet',
    'income','expense','forecast','insight','metrics','kpi','analysis',
  ]],
  ['Design',        [
    'design','creative','art','photo','photography','illustration','color',
    'typography','ux','ui','sketch','wireframe','palette','canvas','graphic',
    'logo','branding','prototype','figma','adobe','animation','motion','visual',
    'content','media','image','video','audio','music','streaming','podcast',
    'film','movie','camera','record','live','broadcast','creator','influencer',
  ]],
  ['Education',     [
    'education','learning','reading','research','school','student','knowledge',
    'book','study','training','course','lesson','classroom','teacher','professor',
    'degree','certificate','quiz','exam','notes','homework','library','science',
    'math','language','writing','essay','tutorial','online-learning','elearning',
  ]],
  ['Health',        [
    'health','medical','fitness','wellness','doctor','exercise','yoga','sport',
    'running','mental','hospital','medicine','patient','therapy','sleep',
    'diet','nutrition','mindfulness','meditation','bike','cycling','gym',
    'heartbeat','pulse','vaccine','laboratory','biology','chemistry',
  ]],
  ['Commerce',      [
    'shopping','ecommerce','store','product','delivery','order','cart','buy',
    'payment','subscription','shipping','package','gift','discount','sale',
    'marketplace','vendor','retail','inventory','purchase','checkout','wallet',
    'receipt','invoice','pricing','tier','plan','offer','deal',
  ]],
  ['Travel',        [
    'travel','location','map','city','vacation','adventure','destination',
    'transport','flight','car','road','trip','hotel','airport','train',
    'journey','explore','backpack','luggage','globe','world','international',
    'tourism','cruise','drive','navigate','compass','walking','walk',
  ]],
  ['Nature',        [
    'nature','environment','planet','tree','animal','outdoor','garden','climate',
    'forest','ocean','mountain','flower','leaf','green','eco','sustainability',
    'weather','season','spring','summer','autumn','winter','snow','rain','sky',
  ]],
  ['Celebration',   [
    'happy','celebration','success','winner','achievement','award','party','fun',
    'love','heart','birthday','holiday','congratulation','proud','joy','smile',
    'cheer','applause','star','trophy','medal','reward','bonus',
    'halloween','christmas','thanksgiving','festival','carnival','wedding',
    'anniversary','graduation','launch','milestone','excited','thrill',
  ]],
  ['Files & Docs',  [
    'files','file','folder','upload','download','document','storage','backup',
    'cloud-storage','sync','archive','pdf','spreadsheet','presentation','form',
    'checklist','list','clipboard','notebook','diary','journal','report',
  ]],
  ['Home & Life',   [
    'home','house','apartment','room','furniture','interior','kitchen','garden',
    'family','cooking','meal','food','coffee','tea','morning','evening',
    'night','day','personal','lifestyle','hobby','pet','cat','dog',
    'relax','rest','sleep','reading','tv','gaming','weekend',
    'eating','barbecue','fetch','absorbed','distraction','outdoor','leisure',
    'everyday','daily','routine','casual','comfortable','cozy','neighborhood',
  ]],
];

function slugToCategory(keywords, slug) {
  // Build candidate words from keywords + slug parts
  const candidates = [
    ...(keywords || []).map((k) => k.toLowerCase()),
    ...(slug || '').toLowerCase().split('-'),
  ];
  for (const [cat, terms] of CATEGORY_MAP) {
    // Exact match on keywords, OR prefix/substring match for compound slug words
    if (candidates.some((k) => terms.some((t) => k === t || k.startsWith(t) || t.startsWith(k)))) {
      return cat;
    }
  }
  return 'General';
}

function slugToTitle(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Build a lookup from slug → metadata
const meta = {};
if (fs.existsSync(MANIFEST_SRC)) {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_SRC, 'utf8'));
  for (const entry of raw) {
    if (entry.slug) {
      meta[entry.slug] = entry;
    }
  }
}

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.svg')).sort();
const manifest = [];
let copied = 0;

for (const file of files) {
  const slug = file.replace(/\.svg$/, '');
  const info = meta[slug] || {};
  const category = slugToCategory(info.keywords, slug);
  const title = info.title || slugToTitle(slug);

  fs.copyFileSync(path.join(SRC_DIR, file), path.join(OUT_DIR, file));
  copied++;

  manifest.push({
    slug,
    title,
    category,
    keywords: info.keywords || [],
    file: `illustrations/${file}`,
    location: `/images/community_assets/illustrations/${file}`,
    source: 'undraw',
  });
}

manifest.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// Count per category
const counts = {};
for (const item of manifest) {
  counts[item.category] = (counts[item.category] || 0) + 1;
}

fs.writeFileSync(
  path.join(OUT_DIR, 'README.md'),
  [
    '# Community Illustrations',
    '',
    'unDraw (undraw.co) — MIT license. Free to use in any project without attribution.',
    '',
    `Total: ${manifest.length} illustrations`,
    '',
    '## Categories',
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => `- **${cat}** — ${n}`)
      .join('\n'),
    '',
    '## Usage',
    '```html',
    '<img src="/images/community_assets/illustrations/remote-work.svg" width="400" />',
    '```',
  ].join('\n') + '\n',
  'utf8'
);

console.log(`Copied ${copied} unDraw illustrations to ${path.relative(process.cwd(), OUT_DIR)}`);
console.log('\nCategory breakdown:');
Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([cat,n]) => console.log(`  ${cat.padEnd(16)} ${n}`));
