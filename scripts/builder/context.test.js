'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

/**
 * `npm run context` (SC-810): the rich-text conversion, finding the project
 * that was named, and the verdicts that keep "no entries" apart from "could
 * not read". lib/contextReadout.js is the whole of the logic; the script only
 * fetches rows and prints these.
 */

const readout = require('../../lib/contextReadout.js');
const { rowToEntry } = require('../../lib/contextStore.js');

const PROJECTS = [
  { id: 'proj_1', slug: 'izit-app', name: 'IZIT:APP' },
  { id: 'proj_2', slug: 'agora', name: 'AGORA' },
  { id: 'proj_3', slug: 'twin-a', name: 'Twin' },
  { id: 'proj_4', slug: 'twin-b', name: 'Twin' },
];

function entry(over = {}) {
  return rowToEntry({
    id: '11111111-2222-3333-4444-555555555555',
    project_id: 'proj_1',
    owner_user_id: 'u',
    title: 'Brand voice',
    kind: 'note',
    body_html: '<h2>Tone</h2><p>Warm &amp; <strong>direct</strong>.</p><ul><li>Short</li><li>Plain</li></ul>',
    file_url: '',
    file_name: '',
    file_type: '',
    file_size: null,
    created_at: '2026-11-15T20:00:00Z',
    updated_at: '2026-11-15T21:30:00Z',
    ...over,
  });
}

test('rich text becomes Markdown: headings, lists, emphasis and links kept, no tags left', () => {
  const html = '<h1>Pricing</h1><p>We are <strong>warm</strong> &amp; <em>direct</em>. See <a href="https://x.test/a">the site</a>.</p>'
    + '<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>'
    + '<ol><li><p>First</p></li><li>Second</li></ol>'
    + '<blockquote><p>A quote</p></blockquote><pre><code>a &lt; b\n</code></pre>'
    + '<p>line<br>break</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
  const text = readout.htmlToText(html);
  assert.equal(text, [
    '# Pricing',
    'We are **warm** & *direct*. See [the site](https://x.test/a).',
    '- One\n- Two\n  - Nested',
    '1. First\n2. Second',
    '> A quote',
    '```\na < b\n```',
    'line\nbreak',
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
  ].join('\n\n'));
  assert.doesNotMatch(text, /<[a-z/]/i);
});

test('empty and whitespace-only rich text is empty, not an error', () => {
  assert.equal(readout.htmlToText(''), '');
  assert.equal(readout.htmlToText(null), '');
  assert.equal(readout.htmlToText('<p> </p>'), '');
});

test('a project is found by id, slug or name; an unknown one names what was asked', () => {
  assert.equal(readout.resolveProject(PROJECTS, 'proj_2').project.slug, 'agora');
  assert.equal(readout.resolveProject(PROJECTS, 'IZIT-APP').project.id, 'proj_1');
  assert.equal(readout.resolveProject(PROJECTS, 'izit:app').project.id, 'proj_1');
  const missing = readout.resolveProject(PROJECTS, 'nosuchproject');
  assert.equal(missing.ok, false);
  assert.equal(missing.message, 'Could not find project nosuchproject.');
  assert.equal(readout.resolveProject(PROJECTS, 'nosuchproject', 'production').message,
    'Could not find project nosuchproject in production.');
  // An empty project list is "not found", never a match.
  assert.equal(readout.resolveProject([], 'agora').ok, false);
});

test('two projects sharing a name are refused by name, never answered with one of them', () => {
  const twin = readout.resolveProject(PROJECTS, 'twin');
  assert.equal(twin.ok, false);
  assert.match(twin.message, /More than one project is called twin: twin-a \(proj_3\), twin-b \(proj_4\)/);
  assert.equal(readout.resolveProject(PROJECTS, 'twin-b').project.id, 'proj_4');
  // Where it looked goes before the list, so the sentence still reads.
  assert.match(readout.resolveProject(PROJECTS, 'twin', 'production').message,
    /^More than one project is called twin in production: twin-a .*Name it by slug or id\.$/);
});

test('an empty project says so; it is not the same text as a failed read', () => {
  const project = PROJECTS[1];
  assert.equal(readout.formatList([], project), 'No context entries in AGORA');
  assert.equal(readout.formatDump([], project), 'No context entries in AGORA');
  const missing = readout.describeReadFailure('ERROR:  relation "context_entries" does not exist', 'production');
  assert.equal(missing, 'The context entries table is not in production yet, so there is nothing to read. '
    + 'It is created by docs/SQL/context_entries_setup.sql.');
  const other = readout.describeReadFailure('connection refused', 'production');
  assert.equal(other, 'Could not read the context entries in production: connection refused');
  assert.doesNotMatch(missing + other, /No context entries/);
});

test('list prints one line per entry: id, title, kind, last updated (Mountain time)', () => {
  const rows = [
    entry(),
    entry({ id: 'b', title: 'Pricing', updated_at: '2026-11-14T01:05:00Z' }),
    entry({ id: 'c', title: 'Style guide', kind: 'file', body_html: '' }),
  ];
  const lines = readout.formatList(rows, PROJECTS[0]).split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '11111111-2222-3333-4444-555555555555\tBrand voice\tnote\t2026-11-15 14:30 MT');
  assert.equal(lines[1], 'b\tPricing\tnote\t2026-11-13 18:05 MT');
  assert.match(lines[2], /^c\tStyle guide\tfile\t/);
});

test('get prints a note as readable text and a file with its name, type, size and address', () => {
  const note = readout.formatEntry(entry(), { project: PROJECTS[0] });
  assert.match(note, /^# Brand voice\n\nProject: IZIT:APP \(izit-app\)\nKind: note\n/);
  assert.match(note, /## Tone\n\nWarm & \*\*direct\*\*\.\n\n- Short\n- Plain$/);
  assert.doesNotMatch(note, /<[a-z/]/i);

  const file = readout.formatEntry(entry({
    kind: 'file', title: 'Style guide', body_html: '',
    file_url: 'https://a.public.blob.vercel-storage.com/x.pdf', file_name: 'guide.pdf',
    file_type: 'application/pdf', file_size: 204800,
  }), { savedPath: '/tmp/out/guide.pdf' });
  assert.match(file, /File: guide\.pdf\nType: application\/pdf\nSize: 200 KB\nDownload: https:\/\/a\.public\.blob\.vercel-storage\.com\/x\.pdf\nSaved to: \/tmp\/out\/guide\.pdf/);
  assert.doesNotMatch(file, /This note has no text/);
});

test('dump holds every note in full in one document, headings nested under each note', () => {
  const rows = [
    entry(),
    entry({ id: 'b', title: 'Pricing', body_html: '<h1>Rules</h1><ol><li>Never discount</li></ol>' }),
    entry({ id: 'c', title: 'Empty note', body_html: '' }),
    entry({ id: 'd', title: 'Style guide', kind: 'file', body_html: '', file_name: 'g.pdf', file_type: 'application/pdf', file_size: 10, file_url: 'https://u/g.pdf' }),
  ];
  const doc = readout.formatDump(rows, PROJECTS[0], { saved: { d: '/tmp/s/g.pdf' } });
  assert.match(doc, /^# Context for IZIT:APP \(izit-app\)\n\n3 notes, 1 file\./);
  assert.match(doc, /## Brand voice\n\nUpdated .* · id 11111111-2222-3333-4444-555555555555\n\n#### Tone\n\nWarm & \*\*direct\*\*\.\n\n- Short\n- Plain/);
  assert.match(doc, /## Pricing\n\n.*\n\n### Rules\n\n1\. Never discount/);
  assert.match(doc, /## Empty note\n\n.*\n\n\(This note has no text\.\)/);
  assert.match(doc, /## Files\n- \*\*Style guide\*\*: g\.pdf, application\/pdf, 10 bytes\. https:\/\/u\/g\.pdf\n {2}Saved to: \/tmp\/s\/g\.pdf/);
  // Only the four note/section titles sit at "##".
  assert.equal(doc.match(/^## /gm).length, 4);
});

test('saved files get a safe name kept unique by the entry id, and must land outside the repo', () => {
  assert.equal(readout.saveName({ id: 'abcdef12-xxxx', fileName: '../../etc/passwd' }), 'abcdef12_etc_passwd');
  assert.equal(readout.saveName({ id: 'abcdef12-xxxx', fileName: 'My Guide (v2).pdf' }), 'abcdef12_My_Guide_v2_.pdf');
  const repo = path.resolve(__dirname, '..', '..');
  assert.equal(readout.isInside(path.join(repo, 'tmp'), repo), true);
  assert.equal(readout.isInside(repo, repo), true);
  assert.equal(readout.isInside('/tmp/context-files', repo), false);
  assert.equal(readout.isInside(`${repo}-other`, repo), false);
});

test('dump shifts headings where they are made, never "#" lines inside code or text', () => {
  const html = '<h1>Real heading</h1><pre># not a heading\ncode</pre><p>Plain text</p>';
  const rows = [entry({ body_html: html })];
  const doc = readout.formatDump(rows, PROJECTS[0]);
  assert.match(doc, /\n### Real heading\n/);
  assert.match(doc, /```\n# not a heading\ncode\n```/);
  assert.doesNotMatch(doc, /### not a heading/);
  // get and dump agree about the code block.
  const one = readout.formatEntry(rows[0]);
  assert.match(one, /```\n# not a heading\ncode\n```/);
  // The shift is capped at six levels.
  assert.equal(readout.htmlToText('<h5>Deep</h5>', { headingShift: 2 }), '###### Deep');
});

// The command itself, run as an agent session runs it: through a pipe. A
// stand-in "docker" on PATH answers the two queries, so no database is needed.
function runContext(args, { projects, entries, readRule = null, local = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-test-'));
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify(projects));
  fs.writeFileSync(path.join(dir, 'entries.json'), JSON.stringify(entries));
  const fake = path.join(dir, 'docker');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
const sql = fs.readFileSync(0, 'utf8');
const vars = {};
const argv = process.argv.slice(2);
argv.forEach((a, i) => { if (a === '-v' && /^(pid|eid)=/.test(argv[i + 1])) { const [k, ...v] = argv[i + 1].split('='); vars[k] = v.join('='); } });
const read = (f) => JSON.parse(fs.readFileSync(${JSON.stringify(dir)} + '/' + f, 'utf8'));
if (/pg_policies/.test(sql)) { process.stdout.write(${JSON.stringify(JSON.stringify(readRule))}); process.exit(0); }
if (/app_projects/.test(sql)) { process.stdout.write(JSON.stringify(read('projects.json'))); process.exit(0); }
// Answer the way the real WHERE clause does, so a query that forgets the
// project filter is caught rather than echoed back.
let rows = read('entries.json');
if (/:'pid'/.test(sql)) rows = rows.filter((r) => r.project_id === vars.pid);
if (/:'eid'/.test(sql)) rows = rows.filter((r) => r.id === vars.eid);
process.stdout.write(JSON.stringify(rows));
`);
  fs.chmodSync(fake, 0o755);
  const script = path.resolve(__dirname, '..', 'context.mjs');
  const res = spawnSync(process.execPath, [script, ...args, ...(local ? ['--local'] : [])], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      PROD_DB_READONLY_URL: 'postgresql://reader:not-a-secret@db.example.test:5432/postgres',
    },
    maxBuffer: 1024 * 1024 * 64,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

test('a dump bigger than one pipe buffer arrives whole through a pipe', () => {
  const big = 'x'.repeat(120000);
  const rows = [{
    id: 'e1', project_id: 'proj_2', owner_user_id: 'u', title: 'Big note', kind: 'note',
    body_html: `<p>${big}</p><p>THE-LAST-LINE</p>`, file_url: '', file_name: '', file_type: '', file_size: null,
    created_at: '2026-11-15T20:00:00Z', updated_at: '2026-11-15T21:30:00Z',
  }];
  const res = runContext(['dump', '--project', 'agora'], { projects: PROJECTS, entries: rows });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.length > 120000, `only ${res.stdout.length} characters arrived`);
  assert.match(res.stdout, /THE-LAST-LINE\n$/);
});

test('the command: --help exits 0, an unknown project exits 1 naming it, an empty one exits 0', () => {
  const help = runContext(['--help'], { projects: PROJECTS, entries: [] });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
  const missing = runContext(['list', '--project', 'nosuchproject'], { projects: PROJECTS, entries: [] });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Could not find project nosuchproject in this machine's database\./);
  const empty = runContext(['list', '--project', 'agora'], { projects: PROJECTS, entries: [] });
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout, 'No context entries in AGORA\n');
});

test('--save leaves no folder behind when the project is not found', () => {
  const folder = path.join(os.tmpdir(), `context-save-${process.pid}-${Date.now()}`);
  const res = runContext(['dump', '--project', 'nosuchproject', '--save', folder], { projects: PROJECTS, entries: [] });
  assert.equal(res.status, 1);
  assert.equal(fs.existsSync(folder), false);
});

test('get needs --project, and never prints another project\'s entry', () => {
  const rows = [{
    id: 'e-agora', project_id: 'proj_2', owner_user_id: 'u', title: 'Agora rules', kind: 'note',
    body_html: '<p>Only for AGORA.</p>', file_url: '', file_name: '', file_type: '', file_size: null,
    created_at: '2026-11-15T20:00:00Z', updated_at: '2026-11-15T21:30:00Z',
  }];
  const bare = runContext(['get', '--id', 'e-agora'], { projects: PROJECTS, entries: rows });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /Which project is entry e-agora in\? Add --project/);
  assert.equal(bare.stdout, '');
  const wrong = runContext(['get', '--id', 'e-agora', '--project', 'izit-app'], { projects: PROJECTS, entries: rows });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /No context entry e-agora in IZIT:APP/);
  assert.doesNotMatch(wrong.stdout, /Only for AGORA/);
  const right = runContext(['get', '--id', 'e-agora', '--project', 'agora'], { projects: PROJECTS, entries: rows });
  assert.equal(right.status, 0, right.stderr);
  assert.match(right.stdout, /Only for AGORA\./);
});

test('a list item keeps a code block\'s line breaks and its paragraphs apart', () => {
  assert.equal(readout.htmlToText('<ul><li><pre>line1\nline2</pre></li></ul>'), '- ```\n  line1\n  line2\n  ```');
  assert.equal(readout.htmlToText('<ul><li><p>Rule one.</p><p>Exception: X.</p></li></ul>'), '- Rule one.\n\n  Exception: X.');
  assert.equal(readout.htmlToText('<ul><li>a<ul><li>b</li></ul></li><li><p>c</p></li></ul>'), '- a\n  - b\n- c');
});

// Production reads as starcaster_readonly under row-level security, where a
// login with no read rule sees zero rows and no error: every project would
// print "No context entries", exit 0 (review of PR #1017).
test('the setup SQL gives the read-only login a read rule on context_entries', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'SQL', 'context_entries_setup.sql'), 'utf8');
  assert.match(sql, /grant select on public\.context_entries to starcaster_readonly/);
  assert.match(sql, /create policy starcaster_readonly_select on public\.context_entries '\s*\|\| 'for select to starcaster_readonly using \(true\)/);
  // And the parsed schema agrees: the guarded block reads as a rule on this table.
  const { parseSchemaText } = require('./sqlSchemaFake.js');
  assert.ok(parseSchemaText(sql).readonlyReadable.has('context_entries'));
});

// The rule can be missing in production even after this PR: main's earlier
// copy of the setup file had none, and sql:unapplied cannot see policies. So
// the command checks before reading, and a missing rule is exit 2, never a
// quiet "No context entries" (review of PR #1017, round 3).
test('production: a missing read rule exits 2 and says to re-run the setup file', () => {
  const rows = [{
    id: 'e1', project_id: 'proj_2', owner_user_id: 'u', title: 'Agora rules', kind: 'note',
    body_html: '<p>Hello</p>', file_url: '', file_name: '', file_type: '', file_size: null,
    created_at: '2026-11-15T20:00:00Z', updated_at: '2026-11-15T21:30:00Z',
  }];
  for (const cmd of [['list', '--project', 'agora'], ['dump', '--project', 'agora'], ['get', '--id', 'e1', '--project', 'agora']]) {
    const missing = runContext(cmd, { projects: PROJECTS, entries: [], readRule: { table: true, rule: false }, local: false });
    assert.equal(missing.status, 2, `${cmd[0]}: ${missing.stderr}`);
    assert.match(missing.stderr, /The read rule is missing in production.*Run docs\/SQL\/context_entries_setup\.sql again/s);
    assert.doesNotMatch(missing.stdout, /No context entries/);
  }
  const noTable = runContext(['list', '--project', 'agora'], { projects: PROJECTS, entries: [], readRule: { table: false, rule: false }, local: false });
  assert.equal(noTable.status, 2);
  assert.match(noTable.stderr, /table is not in production yet/);
  const unclear = runContext(['list', '--project', 'agora'], { projects: PROJECTS, entries: [], readRule: null, local: false });
  assert.equal(unclear.status, 2);
  assert.match(unclear.stderr, /Could not tell whether the read-only login may read/);
  const ok = runContext(['list', '--project', 'agora'], { projects: PROJECTS, entries: rows, readRule: { table: true, rule: true }, local: false });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^e1\tAgora rules\tnote\t/);
});

test('--save refuses a folder inside the repo, including "..name" folders and other git working trees', () => {
  const repo = path.resolve(__dirname, '..', '..');
  assert.equal(readout.isInside(path.join(repo, '..ctx'), repo), true);
  assert.equal(readout.isInside(path.join(repo, '..'), repo), false);
  assert.equal(readout.isInside(path.join(repo, '..', 'elsewhere'), repo), false);
  const inRepo = runContext(['dump', '--project', 'agora', '--save', path.join(repo, '..ctx')], { projects: PROJECTS, entries: [] });
  assert.equal(inRepo.status, 1);
  assert.match(inRepo.stderr, /--save must be outside the repository/);
  // Some other git working tree (the main checkout, seen from a worktree).
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'context-git-'));
  spawnSync('git', ['init', '-q', other]);
  const inGit = runContext(['dump', '--project', 'agora', '--save', path.join(other, 'not-yet', 'files')], { projects: PROJECTS, entries: [] });
  assert.equal(inGit.status, 1);
  assert.match(inGit.stderr, /inside the git working tree at /);
  // A symlink out of tmp into the repo is resolved, not trusted.
  const link = path.join(os.tmpdir(), `context-link-${process.pid}-${Date.now()}`);
  fs.symlinkSync(repo, link);
  const viaLink = runContext(['dump', '--project', 'agora', '--save', path.join(link, 'files')], { projects: PROJECTS, entries: [] });
  fs.unlinkSync(link);
  fs.rmSync(other, { recursive: true, force: true });
  assert.equal(viaLink.status, 1);
  // Caught by the resolved path itself, not only by the git check behind it.
  assert.match(viaLink.stderr, /--save must be outside the repository[^\n]*: \S+\/files\n/);
  assert.doesNotMatch(viaLink.stderr, /git working tree/);
});

test('a file whose address is not this project\'s stored file is not fetched', () => {
  const folder = path.join(os.tmpdir(), `context-save-${process.pid}-${Date.now()}-url`);
  const rows = [{
    id: 'f1', project_id: 'proj_2', owner_user_id: 'u', title: 'Elsewhere', kind: 'file',
    body_html: '', file_url: 'http://127.0.0.1:9/secret', file_name: 'x.pdf', file_type: 'pdf', file_size: 10,
    created_at: '2026-11-15T20:00:00Z', updated_at: '2026-11-15T21:30:00Z',
  }];
  const res = runContext(['dump', '--project', 'agora', '--save', folder], { projects: PROJECTS, entries: rows });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not downloaded, because http:\/\/127\.0\.0\.1:9\/secret is not one of this project's stored context files/);
  assert.equal(fs.existsSync(folder), false);
});

test('an ordered list may start at 0, and inline code may hold a backtick', () => {
  assert.equal(readout.htmlToText('<ol start="0"><li>zero</li><li>one</li></ol>'), '0. zero\n1. one');
  assert.equal(readout.htmlToText('<ol><li>a</li></ol>'), '1. a');
  assert.equal(readout.htmlToText('<p><code>a`b</code></p>'), '``a`b``');
  assert.equal(readout.htmlToText('<p><code>`x</code></p>'), '`` `x ``');
  assert.equal(readout.htmlToText('<p><code>plain</code></p>'), '`plain`');
});
