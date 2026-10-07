'use strict';

/**
 * Export a StarCaster site as a .wpress file — the backup format of the
 * All-in-One WP Migration plugin — from the same site description the .xml
 * export uses (lib/wordpressExport.js buildWordPressSite).
 *
 * WHAT IS INSIDE
 *   uploads/starcaster/<id>-<name>   every image the site uses, downloaded here
 *   database.sql                     posts, postmeta, terms, term_taxonomy,
 *                                    term_relationships, termmeta, comments,
 *                                    commentmeta — plus three settings
 *   package.json                     what the plugin reads first: site address,
 *                                    theme (Divi), plugin version
 *
 * WHAT IMPORTING IT DOES — read from the plugin's source (v7.112), because it
 * decides what this file is allowed to carry:
 *   - It runs database.sql as written, after swapping the SERVMASK_PREFIX_
 *     placeholder for the site's own table prefix. Each table in the file is
 *     DROPPED and recreated; a table NOT in the file is left alone.
 *   - So this file carries only content tables. The receiving site keeps its
 *     users, passwords, plugins and settings — nobody is locked out of the
 *     site they just imported into. Its existing pages, posts, menus and
 *     comments ARE replaced; that is what importing any .wpress does, and the
 *     card says so before the download.
 *   - It rewrites the old site address (package.json SiteURL / HomeURL /
 *     WordPress.UploadsURL) to the new one everywhere in the database. Image
 *     addresses are therefore written as <SiteURL>/wp-content/uploads/... and
 *     land correct on whatever domain the file is imported into.
 *   - It switches the active theme to package.json Template / Stylesheet.
 *
 * Post and term ids are written exactly, so the Theme Builder's links between
 * its posts and the Divi Menu module's menu id hold — which the .xml cannot
 * promise, because the WordPress Importer renumbers terms.
 */

const path = require('node:path');
const { buildWordPressSite, ID } = require('./wordpressExport');
const { WpressWriter } = require('./wpressArchive');

const PREFIX = 'SERVMASK_PREFIX_';
// The plugin version written into package.json — the one whose source this
// was built against. The plugin reads it for compatibility notices only.
const AI1WM_VERSION = '7.112';
const WP_VERSION = '6.8';
const MEDIA_FOLDER = 'starcaster';
const IMAGE_FETCH_TIMEOUT_MS = 20000;
const IMAGE_FETCH_CONCURRENCY = 8;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

/* ---------------------------------------------------------------- SQL */

function sqlString(value) {
  return `'${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z')
    .replace(/'/g, "\\'")}'`;
}

function sqlValue(value) {
  return typeof value === 'number' ? String(Math.trunc(value)) : sqlString(value);
}

// One row per statement, one statement per line: the plugin reads the file a
// line at a time and runs a statement when a line ends in ";". Every newline
// inside a value is escaped above, so no value can end a statement early.
function insert(table, columns, values) {
  return `INSERT INTO \`${PREFIX}${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${values.map(sqlValue).join(', ')});\n`;
}

const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci';

// WordPress's own definitions (wp-admin/includes/schema.php), index length 191.
const TABLES = {
  posts: `ID bigint(20) unsigned NOT NULL auto_increment,
  post_author bigint(20) unsigned NOT NULL default '0',
  post_date datetime NOT NULL default '0000-00-00 00:00:00',
  post_date_gmt datetime NOT NULL default '0000-00-00 00:00:00',
  post_content longtext NOT NULL,
  post_title text NOT NULL,
  post_excerpt text NOT NULL,
  post_status varchar(20) NOT NULL default 'publish',
  comment_status varchar(20) NOT NULL default 'open',
  ping_status varchar(20) NOT NULL default 'open',
  post_password varchar(255) NOT NULL default '',
  post_name varchar(200) NOT NULL default '',
  to_ping text NOT NULL,
  pinged text NOT NULL,
  post_modified datetime NOT NULL default '0000-00-00 00:00:00',
  post_modified_gmt datetime NOT NULL default '0000-00-00 00:00:00',
  post_content_filtered longtext NOT NULL,
  post_parent bigint(20) unsigned NOT NULL default '0',
  guid varchar(255) NOT NULL default '',
  menu_order int(11) NOT NULL default '0',
  post_type varchar(20) NOT NULL default 'post',
  post_mime_type varchar(100) NOT NULL default '',
  comment_count bigint(20) NOT NULL default '0',
  PRIMARY KEY  (ID),
  KEY post_name (post_name(191)),
  KEY type_status_date (post_type,post_status,post_date,ID),
  KEY post_parent (post_parent),
  KEY post_author (post_author),
  KEY type_status_author (post_type,post_status,post_author)`,
  postmeta: `meta_id bigint(20) unsigned NOT NULL auto_increment,
  post_id bigint(20) unsigned NOT NULL default '0',
  meta_key varchar(255) default NULL,
  meta_value longtext,
  PRIMARY KEY  (meta_id),
  KEY post_id (post_id),
  KEY meta_key (meta_key(191))`,
  terms: `term_id bigint(20) unsigned NOT NULL auto_increment,
  name varchar(200) NOT NULL default '',
  slug varchar(200) NOT NULL default '',
  term_group bigint(10) NOT NULL default 0,
  PRIMARY KEY  (term_id),
  KEY slug (slug(191)),
  KEY name (name(191))`,
  term_taxonomy: `term_taxonomy_id bigint(20) unsigned NOT NULL auto_increment,
  term_id bigint(20) unsigned NOT NULL default 0,
  taxonomy varchar(32) NOT NULL default '',
  description longtext NOT NULL,
  parent bigint(20) unsigned NOT NULL default 0,
  count bigint(20) NOT NULL default 0,
  PRIMARY KEY  (term_taxonomy_id),
  UNIQUE KEY term_id_taxonomy (term_id,taxonomy),
  KEY taxonomy (taxonomy)`,
  term_relationships: `object_id bigint(20) unsigned NOT NULL default 0,
  term_taxonomy_id bigint(20) unsigned NOT NULL default 0,
  term_order int(11) NOT NULL default 0,
  PRIMARY KEY  (object_id,term_taxonomy_id),
  KEY term_taxonomy_id (term_taxonomy_id)`,
  termmeta: `meta_id bigint(20) unsigned NOT NULL auto_increment,
  term_id bigint(20) unsigned NOT NULL default '0',
  meta_key varchar(255) default NULL,
  meta_value longtext,
  PRIMARY KEY  (meta_id),
  KEY term_id (term_id),
  KEY meta_key (meta_key(191))`,
  comments: `comment_ID bigint(20) unsigned NOT NULL auto_increment,
  comment_post_ID bigint(20) unsigned NOT NULL default '0',
  comment_author tinytext NOT NULL,
  comment_author_email varchar(100) NOT NULL default '',
  comment_author_url varchar(200) NOT NULL default '',
  comment_author_IP varchar(100) NOT NULL default '',
  comment_date datetime NOT NULL default '0000-00-00 00:00:00',
  comment_date_gmt datetime NOT NULL default '0000-00-00 00:00:00',
  comment_content text NOT NULL,
  comment_karma int(11) NOT NULL default '0',
  comment_approved varchar(20) NOT NULL default '1',
  comment_agent varchar(255) NOT NULL default '',
  comment_type varchar(20) NOT NULL default 'comment',
  comment_parent bigint(20) unsigned NOT NULL default '0',
  user_id bigint(20) unsigned NOT NULL default '0',
  PRIMARY KEY  (comment_ID),
  KEY comment_post_ID (comment_post_ID),
  KEY comment_approved_date_gmt (comment_approved,comment_date_gmt),
  KEY comment_date_gmt (comment_date_gmt),
  KEY comment_parent (comment_parent),
  KEY comment_author_email (comment_author_email(10))`,
  commentmeta: `meta_id bigint(20) unsigned NOT NULL auto_increment,
  comment_id bigint(20) unsigned NOT NULL default '0',
  meta_key varchar(255) default NULL,
  meta_value longtext,
  PRIMARY KEY  (meta_id),
  KEY comment_id (comment_id),
  KEY meta_key (meta_key(191))`,
};

function createTable(name) {
  return `\nDROP TABLE IF EXISTS \`${PREFIX}${name}\`;\nCREATE TABLE \`${PREFIX}${name}\` (\n  ${TABLES[name]}\n) ${TABLE_OPTIONS};\n\n`;
}

/* A setting written as insert-or-update, so it works whether or not the
 * receiving site already has the row (wp_options.option_name is unique). */
function setOption(name, value) {
  return `INSERT INTO \`${PREFIX}options\` (\`option_name\`, \`option_value\`, \`autoload\`) VALUES (${sqlString(name)}, ${sqlString(value)}, 'yes') ON DUPLICATE KEY UPDATE \`option_value\` = VALUES(\`option_value\`);\n`;
}

/* ---------------------------------------------------------------- PHP serialize */

/** PHP serialize() for the shapes WordPress meta needs: string, int, bool, array/object. */
function phpSerialize(value) {
  if (value === null || value === undefined) return 'N;';
  if (typeof value === 'boolean') return `b:${value ? 1 : 0};`;
  if (typeof value === 'number' && Number.isInteger(value)) return `i:${value};`;
  if (typeof value === 'number') return `d:${value};`;
  if (typeof value === 'string') return `s:${Buffer.byteLength(value, 'utf8')}:"${value}";`;
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  return `a:${entries.length}:{${entries.map(([k, v]) => (
    (typeof k === 'number' || /^(0|[1-9]\d*)$/.test(k) ? `i:${k};` : phpSerialize(String(k))) + phpSerialize(v)
  )).join('')}}`;
}

/* ---------------------------------------------------------------- dates */

function mysqlDate(value) {
  const d = value instanceof Date ? value : new Date(value || 0);
  const safe = Number.isNaN(d.getTime()) ? new Date(0) : d;
  return safe.toISOString().replace('T', ' ').slice(0, 19);
}

/* ---------------------------------------------------------------- images */

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
};
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** A file name WordPress will serve: lowercase ascii, dashes, the id in front so two "logo.png"s never collide. */
function mediaFileName(id, url, contentType) {
  const base = decodeURIComponent(String(url).split('?')[0].split('#')[0].split('/').pop() || 'image');
  let ext = path.extname(base).slice(1).toLowerCase();
  if (!MIME_BY_EXT[ext]) ext = EXT_BY_MIME[String(contentType || '').split(';')[0].trim()] || ext || 'jpg';
  const stem = path.basename(base, path.extname(base))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/^\d{10,}_/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
  return `${id}-${stem}.${ext}`;
}

async function defaultFetchImage(url) {
  try {
    return await fetchImageOnce(url);
  } catch (err) {
    // One retry: a single slow response out of four hundred was enough to
    // lose an image on the first trial run.
    if (/larger than/.test(String(err?.message))) throw err;
    return fetchImageOnce(url);
  }
}

async function fetchImageOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length') || 0);
    if (length > MAX_IMAGE_BYTES) throw new Error(`larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_IMAGE_BYTES) throw new Error(`larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    return { data, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

// WordPress scales any upload larger than this down to it
// (big_image_size_threshold, since WordPress 5.3) — so doing the same here
// gives the site exactly what uploading the photos by hand would have, and
// keeps the file under a typical host's upload limit, which is the
// plugin's import limit too (wp_max_upload_size). Delray's originals came to
// 255 MB unscaled.
const BIG_IMAGE_THRESHOLD = 2560;
const SCALABLE = new Set(['jpg', 'jpeg', 'png', 'webp']);

// Photos saved as PNG were 145 of Delray's 218 MB. A PNG with no transparent
// pixels gains nothing over a JPEG and costs five to ten times the bytes, so
// one above this size goes in as a JPEG. Transparent PNGs (logos, cut-outs)
// stay PNG — a JPEG would paint their background in.
const OPAQUE_PNG_TO_JPEG_ABOVE = 300 * 1024;

/**
 * The image as it goes into the file: { data, ext, width, height, changed }.
 * Anything that cannot be read or made smaller goes in untouched — a picture
 * as uploaded beats no picture.
 */
async function prepareImage(data, ext) {
  let sharp;
  let meta;
  try {
    // sharp is a production dependency already (asset renditions); lazily
    // required so a test without native binaries can still run the rest.
    sharp = require('sharp');
    meta = await sharp(data).metadata();
  } catch {
    return { data, ext, width: 0, height: 0, changed: false };
  }
  const width = meta.width || 0;
  const height = meta.height || 0;
  const tooBig = Math.max(width, height) > BIG_IMAGE_THRESHOLD;
  const toJpeg = ext === 'png' && !meta.hasAlpha && data.length > OPAQUE_PNG_TO_JPEG_ABOVE;
  if (!SCALABLE.has(ext) || (!tooBig && !toJpeg)) return { data, ext, width, height, changed: false };
  try {
    let pipeline = sharp(data).rotate();
    if (tooBig) pipeline = pipeline.resize({ width: BIG_IMAGE_THRESHOLD, height: BIG_IMAGE_THRESHOLD, fit: 'inside', withoutEnlargement: true });
    const outExt = toJpeg ? 'jpg' : ext;
    pipeline = outExt === 'png' ? pipeline.png({ compressionLevel: 9 })
      : outExt === 'webp' ? pipeline.webp({ quality: 82 })
        : pipeline.jpeg({ quality: 82, mozjpeg: true });
    const { data: out, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (out.length >= data.length) return { data, ext, width, height, changed: false };
    return { data: out, ext: outExt, width: info.width, height: info.height, changed: true };
  } catch {
    return { data, ext, width, height, changed: false };
  }
}

/**
 * Fetch up to `limit` images at once but hand them over IN ORDER, so the
 * archive is deterministic and only a handful are ever held in memory.
 */
async function* fetchInOrder(items, fetchImage, limit) {
  const pending = new Map();
  let next = 0;
  const start = (i) => pending.set(i, fetchImage(items[i].url).then(
    (ok) => ({ ok }), (err) => ({ err })));
  while (next < Math.min(limit, items.length)) start(next++);
  for (let i = 0; i < items.length; i += 1) {
    const result = await pending.get(i);
    pending.delete(i);
    if (next < items.length) start(next++);
    yield { item: items[i], ...result };
  }
}

/* ---------------------------------------------------------------- database.sql */

function rewriteUrls(text, replacements) {
  let out = String(text ?? '');
  for (const [from, to] of replacements) out = out.split(from).join(to);
  return out;
}

/**
 * @param {object} site      buildWordPressSite(...).site
 * @param {Map<string, object>} packed  image URL → { id, file, mime, width, height, bytes, alt }
 * @param {string} uploadsUrl  <SiteURL>/wp-content/uploads/ (trailing slash)
 */
function buildDatabaseSql(site, packed, uploadsUrl) {
  const now = mysqlDate(site.now);
  // Longest first, so https://x/a.jpg is never rewritten inside https://x/a.jpg?w=2.
  const replacements = [...packed.entries()]
    .map(([url, img]) => [url, `${uploadsUrl}${MEDIA_FOLDER}/${img.file}`])
    .sort((a, b) => b[0].length - a[0].length);

  // Terms: every (taxonomy, slug) any record names, plus Uncategorized as
  // term 1 — WordPress's default_category option points there, and it is
  // gone once the terms table is replaced.
  const terms = new Map();
  const termKey = (domain, slug) => `${domain}\u0000${slug}`;
  terms.set(termKey('category', 'uncategorized'), { id: 1, taxonomy: 'category', slug: 'uncategorized', name: 'Uncategorized', count: 0 });
  let nextTermId = ID.menuTermId;
  const termFor = (c) => {
    const key = termKey(c.domain, c.nicename);
    if (!terms.has(key)) {
      // The menu keeps the id the Divi Menu module is pointed at.
      const id = c.domain === 'nav_menu' && c.nicename === 'main-menu' ? ID.menuTermId : (nextTermId += 1);
      terms.set(key, { id, taxonomy: c.domain, slug: c.nicename, name: c.name, count: 0 });
    }
    return terms.get(key);
  };

  const records = [
    ...site.frame, ...site.pages, ...site.posts, ...site.menu,
  ];

  let posts = '';
  let postmeta = '';
  let relationships = '';
  const postColumns = ['ID', 'post_author', 'post_date', 'post_date_gmt', 'post_content', 'post_title', 'post_excerpt',
    'post_status', 'comment_status', 'ping_status', 'post_password', 'post_name', 'to_ping', 'pinged',
    'post_modified', 'post_modified_gmt', 'post_content_filtered', 'post_parent', 'guid', 'menu_order',
    'post_type', 'post_mime_type', 'comment_count'];
  const addPost = (r, extra = {}) => {
    const date = mysqlDate(r.date);
    posts += insert('posts', postColumns, [
      r.id, 1, date, date, r.content || '', r.title || '', r.excerpt || '',
      r.status || 'publish', 'closed', 'closed', '', r.slug || '', '', '',
      now, now, '', r.parent || 0, extra.guid || `${site.siteUrl}/?p=${r.id}`, r.order || 0,
      r.type, extra.mime || '', 0,
    ]);
    for (const [key, value] of [...(r.metas || []), ...(extra.metas || [])]) {
      postmeta += insert('postmeta', ['post_id', 'meta_key', 'meta_value'], [r.id, key, value]);
    }
    for (const c of r.categories || []) {
      const term = termFor(c);
      term.count += r.status === 'publish' || r.type !== 'post' ? 1 : 0;
      relationships += insert('term_relationships', ['object_id', 'term_taxonomy_id', 'term_order'], [r.id, term.id, 0]);
    }
  };

  for (const r of records) {
    addPost({ ...r, content: rewriteUrls(r.content, replacements) });
  }

  // Attachments: only the images that are actually in the archive. One that
  // could not be downloaded keeps its StarCaster address in the content, and
  // still shows; it just has no Media Library entry.
  for (const r of site.attachments) {
    const img = packed.get(r.attachmentUrl);
    if (!img) continue;
    const relative = `${MEDIA_FOLDER}/${img.file}`;
    const metadata = { width: img.width, height: img.height, file: relative, filesize: img.bytes, sizes: {}, image_meta: {} };
    addPost({ ...r, metas: (r.metas || []) }, {
      guid: `${uploadsUrl}${relative}`,
      mime: img.mime,
      metas: [
        ['_wp_attached_file', relative],
        ['_wp_attachment_metadata', phpSerialize(metadata)],
      ],
    });
  }

  let termRows = '';
  let taxonomyRows = '';
  for (const t of terms.values()) {
    termRows += insert('terms', ['term_id', 'name', 'slug', 'term_group'], [t.id, t.name, t.slug, 0]);
    taxonomyRows += insert('term_taxonomy', ['term_taxonomy_id', 'term_id', 'taxonomy', 'description', 'parent', 'count'],
      [t.id, t.id, t.taxonomy, '', 0, t.count]);
  }

  // Settings — the three the .xml route leaves the operator to do by hand.
  let options = '';
  if (site.homePageId) {
    options += setOption('show_on_front', 'page');
    options += setOption('page_on_front', String(site.homePageId));
  }
  options += setOption('permalink_structure', '/%postname%/');
  // Emptied so WordPress rebuilds its address rules for the new permalinks.
  options += setOption('rewrite_rules', '');
  options += setOption('default_category', '1');

  return [
    '-- StarCaster site export for All-in-One WP Migration.\n',
    '-- Content tables only: users and settings on the receiving site are kept.\n',
    ...Object.keys(TABLES).map(createTable),
    posts, postmeta, termRows, taxonomyRows, relationships,
    options,
  ].join('');
}

function buildPackageJson(site, uploadsUrl) {
  return JSON.stringify({
    SiteURL: site.siteUrl,
    HomeURL: site.siteUrl,
    Plugin: { Version: AI1WM_VERSION },
    WordPress: { Version: WP_VERSION, UploadsURL: uploadsUrl },
    Database: { Version: '8.0', Charset: 'utf8mb4', Collate: 'utf8mb4_unicode_520_ci', Prefix: PREFIX },
    PHP: { Version: '8.2', System: 'Linux', Integer: 8 },
    Plugins: [],
    Template: 'Divi',
    Stylesheet: 'Divi',
    Uploads: '',
    UploadsURL: '',
    // Read by nothing in the plugin; says where the file came from.
    StarCaster: { project: site.project?.name || '', generatedAt: site.now.toISOString() },
  }, null, 2);
}

/* ---------------------------------------------------------------- entry point */

/**
 * Stream a .wpress for one site into `write`: package.json first (the plugin
 * insists), then the images, fetched a handful at a time and written as they
 * arrive, then the database last — only then is it known which images made it
 * into the file.
 *
 * @param {object} input       same as buildWordPressExport
 * @param {(chunk: Buffer) => (void|Promise<void>)} write
 * @param {{ fetchImage?: (url: string) => Promise<{data: Buffer, contentType: string}> }} [options]
 * @returns {Promise<{ report: object, images: { packed: number, scaled: number, failed: Array<{url: string, reason: string}> }, bytes: number }>}
 */
async function streamWpressExport(input, write, options = {}) {
  const { site, report } = buildWordPressSite(input);
  if (!site.siteUrl) throw new Error('A .wpress export needs the site address (the project\'s domain).');
  const fetchImage = options.fetchImage || defaultFetchImage;
  // With the trailing slash, as the plugin writes it (ai1wm_get_uploads_url is
  // trailingslashit) — without it the swap produced "uploads//starcaster".
  const uploadsUrl = `${site.siteUrl}/wp-content/uploads/`;
  const mtime = Math.floor(site.now.getTime() / 1000);

  // The Divi Menu module needs a menu chosen; in this file the menu's id is
  // known and kept, so point every Menu module at it.
  if (site.menu.length) {
    const point = (r) => ({ ...r, content: String(r.content || '').split('[et_pb_menu ').join(`[et_pb_menu menu_id="${ID.menuTermId}" `) });
    site.frame = site.frame.map(point);
    site.pages = site.pages.map(point);
  }

  const archive = new WpressWriter(write);
  // package.json FIRST: the plugin's upload check reads only the first header
  // and refuses the file ("Invalid file data") unless it names package.json
  // (functions.php ai1wm_is_filedata_supported). Found by a real import.
  await archive.addFile('package.json', buildPackageJson(site, uploadsUrl), mtime);
  const packed = new Map();
  const failed = [];
  let scaled = 0;
  for await (const { item, ok, err } of fetchInOrder(site.media, fetchImage, IMAGE_FETCH_CONCURRENCY)) {
    if (err) {
      failed.push({ url: item.url, reason: String(err?.message || err) });
      continue;
    }
    const original = mediaFileName(item.id, item.url, ok.contentType);
    const image = await prepareImage(ok.data, path.extname(original).slice(1));
    if (image.changed) scaled += 1;
    const file = `${original.slice(0, -path.extname(original).length)}.${image.ext}`;
    const ext = image.ext;
    await archive.addFile(`uploads/${MEDIA_FOLDER}/${file}`, image.data, mtime);
    packed.set(item.url, {
      id: item.id, file, mime: MIME_BY_EXT[ext] || 'image/jpeg', width: image.width, height: image.height, bytes: image.data.length, alt: item.alt,
    });
  }

  await archive.addFile('database.sql', buildDatabaseSql(site, packed, uploadsUrl), mtime);
  const { bytes } = await archive.finish();
  return { report, images: { packed: packed.size, scaled, failed }, bytes };
}

module.exports = {
  streamWpressExport,
  // exported for tests
  buildDatabaseSql,
  buildPackageJson,
  phpSerialize,
  sqlString,
  mediaFileName,
  PREFIX,
};
