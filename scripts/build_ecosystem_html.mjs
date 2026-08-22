#!/usr/bin/env node
/**
 * Builds the standalone Development Ecosystem page — one self-contained HTML
 * file for anyone without the vault (a future teammate, Dane on his phone).
 *
 *   node scripts/build_ecosystem_html.mjs [--out <dir>]
 *
 * Writes <out>/ecosystem.html. --out defaults to ~/vault/wiki/ecosystem like
 * the other two generators, and is an ARGUMENT for the same reason: tests and
 * CI must be able to render somewhere harmless instead of into the real vault.
 *
 * The page embeds the inventory as JSON and the diagram as inline SVG. The
 * diagram comes from build_ecosystem_diagram.mjs in `--links web` mode,
 * rendered fresh into a temp folder — one source of truth for the drawing,
 * and this script never has to know how boxes are laid out. The temp folder
 * is removed afterwards whether or not the build succeeds.
 *
 * Self-contained means self-contained: no fonts, scripts or styles fetched
 * from anywhere. The test (scripts/builder/ecosystemHtml.test.js) fails on
 * any external reference, and on any byte that differs between two runs.
 *
 * Generating the file is the deliverable. Publishing it is Dane's call.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { load as parseYaml } from 'js-yaml';

const require = createRequire(import.meta.url);
const { renderPage } = require('./builder/ecosystemHtml.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = path.join(ROOT, 'docs', 'ecosystem', 'inventory.yaml');
const DIAGRAM = path.join(ROOT, 'scripts', 'build_ecosystem_diagram.mjs');
const DEFAULT_OUT = path.join(os.homedir(), 'vault', 'wiki', 'ecosystem');

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT_DIR = outArg !== -1 ? path.resolve(args[outArg + 1]) : DEFAULT_OUT;

const doc = parseYaml(fs.readFileSync(INVENTORY, 'utf8'));

// A fresh web-mode render, never the vault's copy: the vault's ecosystem.svg
// is obsidian-mode (no stylesheet, obsidian:// links) and may be stale.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-html-'));
let svg;
try {
  execFileSync(process.execPath, [DIAGRAM, '--out', tmp, '--links', 'web'], { stdio: ['ignore', 'ignore', 'inherit'] });
  svg = fs.readFileSync(path.join(tmp, 'ecosystem.svg'), 'utf8');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const html = renderPage(doc, svg);

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'ecosystem.html');
fs.writeFileSync(outFile, html);

console.log(`[ecosystem-html] Wrote ${outFile} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
console.log(`[ecosystem-html] ${(doc.objects ?? []).length} object(s), ${(doc.relationships ?? []).length} connection(s); self-contained, no external requests`);
