#!/usr/bin/env node
/**
 * Validates docs/ecosystem/inventory.yaml — the source of truth the
 * Development Ecosystem diagram and its Obsidian pages are generated from.
 *
 * This is NOT the drift check. It does not ask whether the inventory matches
 * reality; it asks whether the file is internally coherent, so a generator
 * reading it cannot fail halfway through and leave half a diagram behind.
 *
 *   node scripts/check_ecosystem_inventory.mjs
 *
 * Exits non-zero and names every problem it found. It reports ALL failures
 * rather than the first, because fixing them one round-trip at a time is how
 * a check stops being run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'docs', 'ecosystem', 'inventory.yaml');

const KINDS = ['machine', 'repo', 'runtime', 'service', 'datastore', 'job', 'surface', 'secrets', 'external', 'agent'];
const LAYERS = ['workstations', 'local-dev', 'production', 'coordination', 'external'];
const REQUIRED = ['id', 'name', 'kind', 'layer', 'summary'];

const problems = [];
const fail = (msg) => problems.push(msg);

if (!fs.existsSync(FILE)) {
  console.error(`[ecosystem] Missing ${path.relative(ROOT, FILE)}`);
  process.exit(1);
}

let doc;
try {
  doc = parseYaml(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  console.error(`[ecosystem] ${path.relative(ROOT, FILE)} is not valid YAML:\n  ${err.message}`);
  process.exit(1);
}

const objects = doc?.objects ?? [];
const relationships = doc?.relationships ?? [];

if (!objects.length) fail('No objects. An empty inventory renders an empty diagram.');

const ids = new Set();
for (const [i, obj] of objects.entries()) {
  const where = obj?.id ? `object "${obj.id}"` : `object #${i + 1}`;
  for (const field of REQUIRED) {
    if (!obj?.[field]) fail(`${where}: missing required field "${field}"`);
  }
  if (obj?.id) {
    if (ids.has(obj.id)) fail(`${where}: duplicate id — ids become filenames, so two objects cannot share one`);
    ids.add(obj.id);
    if (!/^[a-z0-9-]+$/.test(obj.id)) fail(`${where}: id must be lower-case letters, digits and hyphens (it becomes a filename and an SVG element id)`);
  }
  if (obj?.kind && !KINDS.includes(obj.kind)) fail(`${where}: unknown kind "${obj.kind}" — expected one of ${KINDS.join(', ')}`);
  if (obj?.layer && !LAYERS.includes(obj.layer)) fail(`${where}: unknown layer "${obj.layer}" — expected one of ${LAYERS.join(', ')}`);
  if (obj?.summary && String(obj.summary).includes('\n')) fail(`${where}: summary must be ONE line — it is the tooltip and the diagram caption`);
  if (obj?.host && !objects.some((o) => o?.id === obj.host)) fail(`${where}: host "${obj.host}" is not an object in this file`);
}

for (const [i, rel] of relationships.entries()) {
  const where = `relationship #${i + 1}${rel?.from ? ` (${rel.from} -> ${rel.to})` : ''}`;
  if (!rel?.from) fail(`${where}: missing "from"`);
  if (!rel?.to) fail(`${where}: missing "to"`);
  if (!rel?.label) fail(`${where}: missing "label" — an unlabelled arrow tells a reader nothing`);
  if (rel?.from && !ids.has(rel.from)) fail(`${where}: "from" names "${rel.from}", which is not an object in this file`);
  if (rel?.to && !ids.has(rel.to)) fail(`${where}: "to" names "${rel.to}", which is not an object in this file`);
  if (rel?.from && rel?.from === rel?.to) fail(`${where}: points at itself`);
}

const connected = new Set();
for (const rel of relationships) { connected.add(rel?.from); connected.add(rel?.to); }
for (const obj of objects) {
  if (obj?.id && !connected.has(obj.id) && !obj.host) {
    fail(`object "${obj.id}": no relationships and no host — it would render as an island nobody can interpret`);
  }
}

if (problems.length) {
  console.error(`\n[ecosystem] ${problems.length} problem(s) in docs/ecosystem/inventory.yaml:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`[ecosystem] OK — ${objects.length} object(s), ${relationships.length} relationship(s), no dangling references.`);
