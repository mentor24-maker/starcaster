'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { WpressWriter, readWpress, crc32, crcHex, HEADER_SIZE } = require('../../lib/wpressArchive.js');
const { streamWpressExport, phpSerialize, sqlString, mediaFileName } = require('../../lib/wpressExport.js');

/*
 * The .wpress is checked against the All-in-One WP Migration plugin's own
 * rules (v7.112 source). The end-to-end proof — a real import into WordPress
 * with the plugin — was run by hand in Docker; these hold the pieces of that
 * contract still so a later edit cannot quietly break one.
 */

async function collect(fn) {
  const chunks = [];
  const result = await fn((c) => { chunks.push(Buffer.from(c)); });
  return { buf: Buffer.concat(chunks), result };
}

test('CRC-32 is the crc32b PHP computes', () => {
  assert.equal(crcHex(crc32(Buffer.from('123456789'))), 'cbf43926');
  // Continuing from a previous value equals hashing the joined bytes.
  assert.equal(crc32(Buffer.from('6789'), crc32(Buffer.from('12345'))), crc32(Buffer.from('123456789')));
});

test('a file header is the plugin layout: name 255, size 14, mtime 12, path 4088, crc 8', async () => {
  const { buf } = await collect(async (write) => {
    const w = new WpressWriter(write);
    await w.addFile('package.json', '{"a":1}', 1700000000);
    await w.addFile('uploads/starcaster/a.jpg', Buffer.from([1, 2, 3]), 1700000000);
    await w.finish();
  });
  const text = (start, len) => buf.subarray(start, start + len).toString('utf8').replace(/\0+$/, '');
  assert.equal(HEADER_SIZE, 4377);
  assert.equal(text(0, 255), 'package.json');
  assert.equal(text(255, 14), '7');
  assert.equal(text(269, 12), '1700000000');
  // PHP dirname('package.json') is "." — the plugin's own root-file path.
  assert.equal(text(281, 4088), '.');
  assert.equal(text(4369, 8), crcHex(crc32(Buffer.from('{"a":1}'))));
  const second = HEADER_SIZE + 7;
  assert.equal(text(second, 255), 'a.jpg');
  assert.equal(text(second + 281, 4088), 'uploads/starcaster');

  const { entries } = readWpress(buf);
  assert.deepEqual(entries.map((e) => `${e.path}/${e.name}`), ['./package.json', 'uploads/starcaster/a.jpg']);
  // EOF: 255 NULs, the archive size before it, 4100 NULs, the archive CRC.
  const eof = buf.subarray(buf.length - HEADER_SIZE);
  assert.ok(eof.subarray(0, 255).every((b) => b === 0));
  assert.equal(Number(eof.subarray(255, 269).toString().replace(/\0+$/, '')), buf.length - HEADER_SIZE);
  assert.equal(eof.subarray(4369, 4377).toString(), crcHex(crc32(buf.subarray(0, buf.length - HEADER_SIZE))));
});

test('the reader refuses a damaged archive, as the plugin would', async () => {
  const { buf } = await collect(async (write) => {
    const w = new WpressWriter(write);
    await w.addFile('package.json', '{}');
    await w.finish();
  });
  const damaged = Buffer.from(buf);
  damaged[HEADER_SIZE] ^= 0xff;
  assert.throws(() => readWpress(damaged), /CRC mismatch/);
  assert.throws(() => readWpress(buf.subarray(0, buf.length - 10)), /EOF|cut short/);
});

test('PHP serialize counts BYTES, so accented text unserializes in WordPress', () => {
  assert.equal(phpSerialize('café'), 's:5:"café";');
  assert.equal(phpSerialize({ width: 10, sizes: {}, file: 'a/b.jpg' }), 'a:3:{s:5:"width";i:10;s:5:"sizes";a:0:{}s:4:"file";s:7:"a/b.jpg";}');
});

test('a SQL value stays on one line, so a ";" at a line end inside it cannot end the statement early', () => {
  assert.equal(sqlString("it's;\nnext"), "'it\\'s;\\nnext'");
  assert.equal(sqlString('a\\b'), "'a\\\\b'");
});

test('image file names are safe, unique per id, and keep a real extension', () => {
  assert.equal(mediaFileName(910003, 'https://x/y/1786560119594_National Junior-Tennis.JPG?w=2'), '910003-national-junior-tennis.jpg');
  assert.equal(mediaFileName(910004, 'https://x/y/noext', 'image/png'), '910004-noext.png');
});

function sitePages() {
  const header = {
    id: 'h', title: 'Header', layout: 'single', canonical: true, savedSectionId: 'ss',
    modules: [{ id: 'n', type: 'navigation', column: 'main', settings: { navItems: JSON.stringify([{ id: 'a', label: 'About', href: '/about' }]) } }],
  };
  return [
    { id: '1', name: 'Home', slug: '', isPublished: true, layoutSections: [header, {
      id: 'b', layout: 'single', modules: [
        { id: 'i', type: 'image', column: 'main', settings: { url: 'https://cdn.example.com/court.jpg', alt: 'Court' } },
        { id: 'g', type: 'image', column: 'main', settings: { url: 'https://cdn.example.com/missing.jpg' } },
        { id: 't', type: 'text', column: 'main', text: '<p><a href="https://cdn.example.com/court.jpg">full size</a></p>' },
      ],
    }] },
  ];
}

async function runExport(overrides = {}) {
  const fetched = [];
  const { buf, result } = await collect((write) => streamWpressExport({
    project: { name: 'Club', siteUrl: 'https://club.example.com' },
    pages: sitePages(),
    posts: [{ id: 'p', title: 'News', slug: 'news', status: 'published', body: '<p>x</p>', tags: ['Junior Tennis'] }],
    now: '2026-10-06T00:00:00Z',
    ...overrides,
  }, write, {
    fetchImage: async (url) => {
      fetched.push(url);
      if (url.includes('missing')) throw new Error('HTTP 404');
      return { data: Buffer.from(`image:${url}`), contentType: 'image/jpeg' };
    },
  }));
  const { entries } = readWpress(buf);
  const file = (name) => entries.find((e) => e.name === name);
  return { result, entries, fetched, sql: file('database.sql').data.toString('utf8'), pkg: JSON.parse(file('package.json').data.toString('utf8')) };
}

test('package.json is the FIRST entry — the plugin refuses the file otherwise', async () => {
  const { entries } = await runExport();
  assert.equal(entries[0].name, 'package.json');
  assert.equal(entries[entries.length - 1].name, 'database.sql');
});

test('package.json names the old site and the uploads address with its trailing slash', async () => {
  const { pkg } = await runExport();
  assert.equal(pkg.SiteURL, 'https://club.example.com');
  assert.equal(pkg.HomeURL, 'https://club.example.com');
  assert.equal(pkg.WordPress.UploadsURL, 'https://club.example.com/wp-content/uploads/');
  assert.equal(pkg.Template, 'Divi');
});

test('only content tables are replaced — users and settings on the receiving site survive', async () => {
  const { sql } = await runExport();
  const dropped = [...sql.matchAll(/DROP TABLE IF EXISTS `SERVMASK_PREFIX_(\w+)`/g)].map((m) => m[1]);
  assert.deepEqual(dropped.sort(), ['commentmeta', 'comments', 'postmeta', 'posts', 'term_relationships', 'term_taxonomy', 'termmeta', 'terms']);
  assert.ok(!/SERVMASK_PREFIX_users|SERVMASK_PREFIX_usermeta/.test(sql));
  assert.ok(!/DROP TABLE[^;]*options/.test(sql));
});

test('images are packed, addresses point at the new uploads folder, and a failed one stays where it was', async () => {
  const { sql, entries, result } = await runExport();
  const uploads = entries.filter((e) => e.path === 'uploads/starcaster').map((e) => e.name);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0], /^\d+-court\.jpg$/);
  const local = `https://club.example.com/wp-content/uploads/starcaster/${uploads[0]}`;
  // The image module AND the full-size link both moved.
  assert.equal(sql.split(local).length - 1 >= 3, true, 'image src, link href and attachment guid');
  assert.ok(!sql.includes('cdn.example.com/court.jpg'));
  assert.ok(!sql.includes('uploads//'));
  // The 404 image keeps its old address and gets no Media Library row.
  assert.ok(sql.includes('https://cdn.example.com/missing.jpg'));
  assert.equal(result.images.failed.length, 1);
  assert.equal((sql.match(/'attachment'/g) || []).length, 1);
  assert.match(sql, /'_wp_attached_file', 'starcaster\/\d+-court\.jpg'/);
});

test('home page, permalinks and the Divi menu are set by the file', async () => {
  const { sql } = await runExport();
  assert.match(sql, /'show_on_front', 'page'/);
  assert.match(sql, /'page_on_front', '901000'/);
  assert.match(sql, /'permalink_structure', '\/%postname%\/'/);
  assert.match(sql, /\[et_pb_menu menu_id="9001"/);
  assert.match(sql, /INSERT INTO `SERVMASK_PREFIX_terms` \(`term_id`, `name`, `slug`, `term_group`\) VALUES \(9001, 'Main Menu', 'main-menu', 0\)/);
  // Uncategorized stays term 1, which default_category points at.
  assert.match(sql, /VALUES \(1, 'Uncategorized', 'uncategorized', 0\)/);
});

test('every statement is one line ending in ";" — how the plugin splits the file', async () => {
  const { sql } = await runExport();
  for (const line of sql.split('\n').filter((l) => l.startsWith('INSERT'))) {
    assert.ok(line.endsWith(';'), line.slice(0, 80));
  }
});

test('no site address means no .wpress — the plugin needs one to rewrite links', async () => {
  await assert.rejects(
    streamWpressExport({ project: {}, pages: sitePages(), posts: [] }, () => {}),
    /site address/,
  );
});
