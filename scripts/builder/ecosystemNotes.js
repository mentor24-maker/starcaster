'use strict';

/**
 * Renders the vault notes for the Development Ecosystem: one stub note per
 * inventory object plus the map note that embeds the diagram.
 *
 * The contract that matters: a note is two regions. Everything from the top
 * of the file through END_MARK is GENERATED and rewritten on every run;
 * everything after END_MARK is PROSE and must survive every run, byte for
 * byte. mergeNote() enforces that split — and refuses to touch a file that
 * carries no marker at all, because a file we cannot split is a file we
 * could only clobber.
 */

const BEGIN_MARK = '<!-- ecosystem:generated:begin — this block is rewritten by scripts/build_ecosystem_notes.mjs; edit docs/ecosystem/inventory.yaml in the starcaster repo instead. -->';
const END_MARK = '<!-- ecosystem:generated:end -->';

/** Obsidian wikilink to another object's note, shown under its display name. */
const objLink = (obj) => `[[${obj.id}|${obj.name}]]`;

function yamlEscape(value) {
  const s = String(value);
  return /[:#\[\]{}&*!|>'"%@`,-]|^\s|\s$/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

/** The generated region of one object note (frontmatter through END_MARK). */
function renderObjectHead(obj, objects, relationships) {
  const byId = Object.fromEntries(objects.map((o) => [o.id, o]));
  const lines = [];
  lines.push('---');
  lines.push(`name: ${yamlEscape(obj.name)}`);
  lines.push(`kind: ${obj.kind}`);
  lines.push(`layer: ${obj.layer}`);
  lines.push('aliases:');
  lines.push(`  - ${yamlEscape(obj.name)}`);
  lines.push('---');
  lines.push('');
  lines.push(BEGIN_MARK);
  lines.push(`> ${obj.summary}`);
  lines.push('');

  const refs = [];
  if (obj.links?.doc) {
    const path = String(obj.links.doc).replace(/\.md$/, '');
    refs.push(`[[${path}|${path.split('/').pop()}]]`);
  }
  if (obj.links?.url) refs.push(`[${obj.links.url.replace(/^https:\/\/([^/]+).*/, '$1')}](${obj.links.url})`);
  if (refs.length) {
    lines.push(`**Reference:** ${refs.join(' · ')}`);
    lines.push('');
  }

  const out = relationships.filter((r) => r.from === obj.id && byId[r.to]);
  const into = relationships.filter((r) => r.to === obj.id && byId[r.from]);
  lines.push('## Connections');
  for (const r of out) lines.push(`- → ${objLink(byId[r.to])} — ${r.label}`);
  for (const r of into) lines.push(`- ← ${objLink(byId[r.from])} — ${r.label}`);
  if (!out.length && !into.length) lines.push('- (none recorded)');
  lines.push(END_MARK);
  return lines.join('\n');
}

/** The prose skeleton a brand-new note starts with. Never re-applied. */
const OBJECT_TAIL_TEMPLATE = '\n\n## What it is\n\n## How it works\n\n## Gotchas\n';

/** The generated region of the map note. */
function renderMapHead(objects, layerOrder) {
  const lines = [];
  lines.push('---');
  lines.push('name: Development Ecosystem');
  lines.push('aliases:');
  lines.push('  - Development Ecosystem');
  lines.push('---');
  lines.push('');
  lines.push(BEGIN_MARK);
  lines.push('> The machines, codebases, services, jobs, and agents that build and run StarCaster — drawn from `docs/ecosystem/inventory.yaml` in the starcaster repo. Not to be confused with the business ecosystem (`doctrine/ECOSYSTEM.md`).');
  lines.push('');
  lines.push('![[ecosystem.svg]]');
  lines.push('');
  for (const layer of layerOrder) {
    const objs = objects.filter((o) => o.layer === layer.id);
    if (!objs.length) continue;
    lines.push(`## ${layer.label}`);
    for (const o of objs) lines.push(`- ${objLink(o)} — ${o.summary}`);
    lines.push('');
  }
  lines.pop();
  lines.push(END_MARK);
  return lines.join('\n');
}

/**
 * Combine a freshly generated head with an existing note's prose.
 * Returns { content } or { refused: reason } — a refusal means the existing
 * file has no marker, so nothing safe can be done with it.
 */
function mergeNote(existing, head, tailTemplate) {
  if (existing == null) return { content: head + tailTemplate };
  const at = existing.indexOf(END_MARK);
  if (at === -1) {
    return { refused: 'no generated-region marker — refusing to rewrite a file that cannot be split into generated and prose regions' };
  }
  const tail = existing.slice(at + END_MARK.length);
  return { content: head + tail };
}

module.exports = { BEGIN_MARK, END_MARK, renderObjectHead, renderMapHead, mergeNote, OBJECT_TAIL_TEMPLATE };
