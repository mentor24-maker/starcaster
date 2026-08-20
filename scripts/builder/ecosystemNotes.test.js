'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { renderObjectHead, renderMapHead, mergeNote, END_MARK, OBJECT_TAIL_TEMPLATE } = require('./ecosystemNotes');

const objects = [
  { id: 'mac-mini', name: 'Mac Mini', kind: 'machine', layer: 'workstations', summary: 'The always-on machine.', links: { doc: 'doctrine/NODES.md', url: 'https://example.com/x' } },
  { id: 'github', name: 'GitHub', kind: 'external', layer: 'external', summary: 'Code host.' },
  { id: 'island', name: 'Island', kind: 'service', layer: 'production', summary: 'Connected to nothing.' },
];
const relationships = [
  { from: 'mac-mini', to: 'github', label: 'gh auth' },
];
const layers = [
  { id: 'workstations', label: 'Workstations' },
  { id: 'production', label: 'Production' },
  { id: 'external', label: 'External' },
];

test('object head carries frontmatter, summary, reference and wikilinked connections', () => {
  const head = renderObjectHead(objects[0], objects, relationships);
  assert.match(head, /name: Mac Mini/);
  assert.match(head, /> The always-on machine\./);
  assert.match(head, /\[\[doctrine\/NODES\|NODES\]\]/);
  assert.match(head, /- → \[\[github\|GitHub\]\] — gh auth/);
  assert.ok(head.endsWith(END_MARK));
});

test('incoming connections render on the target note', () => {
  const head = renderObjectHead(objects[1], objects, relationships);
  assert.match(head, /- ← \[\[mac-mini\|Mac Mini\]\] — gh auth/);
});

test('an object with no connections says so rather than rendering an empty section', () => {
  const head = renderObjectHead(objects[2], objects, relationships);
  assert.match(head, /- \(none recorded\)/);
});

test('a new note gets the prose skeleton exactly once', () => {
  const head = renderObjectHead(objects[0], objects, relationships);
  const { content } = mergeNote(null, head, OBJECT_TAIL_TEMPLATE);
  assert.ok(content.includes('## What it is'));
  assert.ok(content.endsWith('## Gotchas\n'));
});

test('re-running preserves hand-written prose byte for byte', () => {
  const head1 = renderObjectHead(objects[0], objects, relationships);
  const first = mergeNote(null, head1, OBJECT_TAIL_TEMPLATE).content;
  const withProse = first.replace('## What it is\n', '## What it is\nIt is the machine on the shelf.\n  odd   spacing kept too\n');
  const head2 = renderObjectHead({ ...objects[0], summary: 'A CHANGED summary.' }, objects, relationships);
  const { content } = mergeNote(withProse, head2, OBJECT_TAIL_TEMPLATE);
  assert.ok(content.includes('> A CHANGED summary.'), 'generated region must refresh');
  assert.ok(content.includes('It is the machine on the shelf.\n  odd   spacing kept too'), 'prose must survive');
  const tailOfOriginal = withProse.slice(withProse.indexOf(END_MARK) + END_MARK.length);
  assert.ok(content.endsWith(tailOfOriginal), 'everything after the marker must be untouched');
});

test('a file without the marker is refused, never rewritten', () => {
  const head = renderObjectHead(objects[0], objects, relationships);
  const result = mergeNote('# A hand-made note with no markers\nPrecious prose.', head, OBJECT_TAIL_TEMPLATE);
  assert.ok(result.refused);
  assert.strictEqual(result.content, undefined);
});

test('map head embeds the svg and links every object under its layer', () => {
  const head = renderMapHead(objects, layers);
  assert.match(head, /!\[\[ecosystem\.svg\]\]/);
  assert.match(head, /## Workstations\n- \[\[mac-mini\|Mac Mini\]\] — The always-on machine\./);
  assert.match(head, /## External\n- \[\[github\|GitHub\]\]/);
  assert.ok(head.endsWith(END_MARK));
});

test('map head inlines svg markup when given, instead of the flat embed', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="obsidian://x"><g id="node-mac-mini"></g></a></svg>\n';
  const head = renderMapHead(objects, layers, svg);
  assert.ok(head.includes('<g id="node-mac-mini">'), 'svg markup must be inlined');
  assert.ok(!head.includes('![[ecosystem.svg]]'), 'flat embed must be replaced');
});

test('rendering is deterministic', () => {
  const a = renderObjectHead(objects[0], objects, relationships) + renderMapHead(objects, layers);
  const b = renderObjectHead(objects[0], objects, relationships) + renderMapHead(objects, layers);
  assert.strictEqual(a, b);
});
