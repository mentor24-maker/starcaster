#!/usr/bin/env node
/**
 * Writes the Development Ecosystem's vault notes from docs/ecosystem/inventory.yaml:
 * one stub note per object plus the map note that embeds the diagram.
 *
 *   node scripts/build_ecosystem_notes.mjs [--out <dir>]
 *
 * --out defaults to ~/vault/wiki/ecosystem. It is an ARGUMENT so tests and CI
 * can write somewhere harmless instead of into the operator's real vault.
 *
 * Each note is generated-head + hand-written tail, split by an explicit
 * marker. Re-running refreshes ONLY the generated region; prose after the
 * marker survives byte for byte, and a file with no marker is refused rather
 * than rewritten (see scripts/builder/ecosystemNotes.js and its test).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { load as parseYaml } from 'js-yaml';

const require = createRequire(import.meta.url);
const { renderObjectHead, renderMapHead, mergeNote, OBJECT_TAIL_TEMPLATE } = require('./builder/ecosystemNotes.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = path.join(ROOT, 'docs', 'ecosystem', 'inventory.yaml');
const DEFAULT_OUT = path.join(os.homedir(), 'vault', 'wiki', 'ecosystem');

// Same narrative order as the diagram (scripts/build_ecosystem_diagram.mjs).
const LAYERS = [
  { id: 'workstations', label: 'Workstations' },
  { id: 'local-dev', label: 'Local development' },
  { id: 'production', label: 'Production' },
  { id: 'coordination', label: 'Coordination' },
  { id: 'external', label: 'External' },
];

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT_DIR = outArg !== -1 ? path.resolve(args[outArg + 1]) : DEFAULT_OUT;
const OBJECTS_DIR = path.join(OUT_DIR, 'objects');

const doc = parseYaml(fs.readFileSync(INVENTORY, 'utf8'));
const objects = doc.objects ?? [];
const relationships = doc.relationships ?? [];

fs.mkdirSync(OBJECTS_DIR, { recursive: true });

let created = 0;
let refreshed = 0;
const refusals = [];

function writeNote(filePath, head, tailTemplate) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  const result = mergeNote(existing, head, tailTemplate);
  if (result.refused) {
    refusals.push(`${path.relative(OUT_DIR, filePath)}: ${result.refused}`);
    return;
  }
  if (existing === result.content) return;
  fs.writeFileSync(filePath, result.content);
  existing == null ? created++ : refreshed++;
}

for (const obj of objects) {
  writeNote(path.join(OBJECTS_DIR, `${obj.id}.md`), renderObjectHead(obj, objects, relationships), OBJECT_TAIL_TEMPLATE);
}
writeNote(path.join(OUT_DIR, 'Development Ecosystem.md'), renderMapHead(objects, LAYERS), '\n');

// A note for an object the inventory no longer knows is a question for a
// human, not a deletion — prose may live there. Name them; never remove them.
const ids = new Set(objects.map((o) => o.id));
const strays = fs.readdirSync(OBJECTS_DIR)
  .filter((f) => f.endsWith('.md') && !ids.has(f.replace(/\.md$/, '')))
  .map((f) => `objects/${f}`);

console.log(`[ecosystem-notes] ${objects.length} object note(s) + the map note in ${OUT_DIR}`);
console.log(`[ecosystem-notes] ${created} created, ${refreshed} refreshed, ${objects.length + 1 - created - refreshed} already current`);
for (const r of refusals) console.error(`[ecosystem-notes] REFUSED ${r}`);
for (const s of strays) console.error(`[ecosystem-notes] STRAY ${s} — its object is not in the inventory; review it by hand`);
if (refusals.length) process.exit(1);
