#!/usr/bin/env node
/**
 * Draws the Development Ecosystem diagram from docs/ecosystem/inventory.yaml.
 *
 *   node scripts/build_ecosystem_diagram.mjs [--out <dir>] [--links obsidian|web|none]
 *
 * Each object may carry `links:` in the inventory — `doc:` (a note in the
 * vault, e.g. doctrine/NODES.md) and/or `url:` (an ordinary web address).
 * --links picks the target: `obsidian` (default — the copy that lives in the
 * vault) opens the object's generated note (wiki/ecosystem/objects/<id>);
 * `web` prefers the inventory's url, falling back to its doc as an
 * obsidian:// link; `none` renders no links at all. In web mode an object
 * with NO link renders with a dashed outline — a missing page should look
 * missing, never present as a working link.
 *
 * Nobody positions a box by hand. Edit the inventory, re-run this, and the
 * picture follows. That is the whole reason the inventory exists — a drawing
 * is accurate exactly once, and has no way to complain when reality moves.
 *
 * --out defaults to ~/vault/wiki/ecosystem, where the vault expects it. It is
 * an ARGUMENT rather than a constant on purpose: a build running inside a git
 * worktree must be able to render somewhere harmless, or running the tests
 * would write into the operator's real vault as a side effect.
 *
 * Output is deterministic — same inventory in, byte-identical SVG out. No
 * timestamps, no generated ids, no iteration-order surprises. A generator
 * whose output churns makes every diff unreadable and every review a guess.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = path.join(ROOT, 'docs', 'ecosystem', 'inventory.yaml');
const DEFAULT_OUT = path.join(os.homedir(), 'vault', 'wiki', 'ecosystem');

// Columns, left to right. This is a NARRATIVE, not a filing cabinet: where you
// work, where it gets proved, where it ships, how the machines coordinate,
// what it all depends on. Grouping by `kind` instead would sort the system
// into a box of repos and a box of services, which explains nothing.
const LAYERS = [
  { id: 'workstations', label: 'Workstations' },
  { id: 'local-dev', label: 'Local development' },
  { id: 'production', label: 'Production' },
  { id: 'coordination', label: 'Coordination' },
  { id: 'external', label: 'External' },
];

const NODE_W = 210;
const NODE_H = 64;
const COL_GAP = 120;
const ROW_GAP = 34;
const MARGIN = 48;
const HEADER_H = 46;

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT_DIR = outArg !== -1 ? path.resolve(args[outArg + 1]) : DEFAULT_OUT;
const linksArg = args.indexOf('--links');
const LINK_MODE = linksArg !== -1 ? args[linksArg + 1] : 'obsidian';
if (!['obsidian', 'web', 'none'].includes(LINK_MODE)) {
  console.error(`[ecosystem] Unknown --links mode "${LINK_MODE}" — use obsidian, web or none.`);
  process.exit(1);
}

const VAULT_NAME = 'vault'; // the Obsidian vault is the ~/vault folder, and Obsidian names a vault after its folder

/** Obsidian deep link to a note, from a vault-relative path like doctrine/NODES.md. */
const obsidianUri = (docPath) =>
  `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(String(docPath).replace(/\.md$/, ''))}`;

/** The href an object's box should carry under the active link mode, or null. */
function resolveLink(obj) {
  if (LINK_MODE === 'none') return null;
  if (LINK_MODE === 'obsidian') {
    // Every object has a generated note (build_ecosystem_notes.mjs writes one
    // per inventory entry), so the vault copy's boxes always open the note.
    return obsidianUri(`wiki/ecosystem/objects/${obj.id}.md`);
  }
  const doc = obj.links?.doc ? obsidianUri(obj.links.doc) : null;
  return obj.links?.url ?? doc;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const round = (n) => Math.round(n * 100) / 100;

/** Wrap a display name to at most `max` lines of roughly `width` px. */
function wrap(text, width, max = 2) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length * 6.4 > width && line) { lines.push(line); line = w; } else { line = next; }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1].slice(0, -1)}…`;
    return kept;
  }
  return lines;
}

const doc = parseYaml(fs.readFileSync(INVENTORY, 'utf8'));
const objects = doc.objects ?? [];
const relationships = doc.relationships ?? [];

// ---------------------------------------------------------------- layout
const byLayer = new Map(LAYERS.map((l) => [l.id, []]));
for (const obj of objects) {
  if (!byLayer.has(obj.layer)) byLayer.set(obj.layer, []);
  byLayer.get(obj.layer).push(obj);           // inventory order == draw order
}

const maxRows = Math.max(...LAYERS.map((l) => (byLayer.get(l.id) ?? []).length));
const colHeight = (n) => n * NODE_H + (n - 1) * ROW_GAP;
const tallest = colHeight(maxRows);

const pos = new Map();
LAYERS.forEach((layer, col) => {
  const list = byLayer.get(layer.id) ?? [];
  // Centre each column against the tallest one. Layers are semantic, so they
  // cannot be rebalanced — but a short column left top-aligned drops a large
  // empty void into the picture, which reads as "something is missing".
  const offset = (tallest - colHeight(list.length)) / 2;
  list.forEach((obj, row) => {
    pos.set(obj.id, {
      col,
      row,
      x: MARGIN + col * (NODE_W + COL_GAP),
      y: MARGIN + HEADER_H + offset + row * (NODE_H + ROW_GAP),
      obj,
    });
  });
});
const WIDTH = MARGIN * 2 + LAYERS.length * NODE_W + (LAYERS.length - 1) * COL_GAP;
const HEIGHT = MARGIN * 2 + HEADER_H + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

// ---------------------------------------------------------------- edges
/** Anchor on the side of the node that faces the other node. */
function anchors(a, b) {
  if (a.col < b.col) return [{ x: a.x + NODE_W, y: a.y + NODE_H / 2 }, { x: b.x, y: b.y + NODE_H / 2 }, 1];
  if (a.col > b.col) return [{ x: a.x, y: a.y + NODE_H / 2 }, { x: b.x + NODE_W, y: b.y + NODE_H / 2 }, -1];
  // same column: leave and return on the right, bowing outward
  return [{ x: a.x + NODE_W, y: a.y + NODE_H / 2 }, { x: b.x + NODE_W, y: b.y + NODE_H / 2 }, 0];
}


/** Point on a cubic bezier at t. Used to slide a label along its own edge. */
function bezier(p1, c1, c2, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
    y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
  };
}

const overlaps = (a, b) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);

/**
 * Place each edge label somewhere along its own curve where it collides with
 * nothing already placed — not another label, not a node.
 *
 * Forty-one labels on one canvas WILL collide if each is dropped at its
 * midpoint; the first render produced unreadable overstrikes like
 * "db:refresh c  starts  wn (weekly". So each label gets a handful of
 * candidate positions along its curve, and takes the first free one. A label
 * with no free position is OMITTED and COUNTED — the count is printed, because
 * silently dropping information is how a diagram starts lying.
 */
function placeLabels(edges, nodeRects) {
  const placed = [...nodeRects];
  const out = [];
  let dropped = 0;
  const TS = [0.5, 0.62, 0.38, 0.72, 0.28, 0.82, 0.18];
  for (const e of edges) {
    const label = String(e.rel.label);
    const w = label.length * 5.1 + 10;
    let found = null;
    for (const t of TS) {
      const pt = bezier(e.p1, e.c1, e.c2, e.p2, t);
      const rect = { x1: pt.x - w / 2, y1: pt.y - 8, x2: pt.x + w / 2, y2: pt.y + 6 };
      if (!placed.some((r) => overlaps(rect, r))) { found = { pt, w, rect }; break; }
    }
    if (!found) { dropped += 1; continue; }
    placed.push(found.rect);
    out.push({ ...e, label, labelAt: found.pt, labelW: found.w });
  }
  return { labelled: out, dropped };
}

const edges = [];
for (const rel of relationships) {
  const a = pos.get(rel.from);
  const b = pos.get(rel.to);
  if (!a || !b) continue;                      // validator already rejects these
  const [p1, p2, dir] = anchors(a, b);
  let c1;
  let c2;
  if (dir === 0) {
    const bow = 46 + Math.abs(a.row - b.row) * 8;
    const cx = Math.max(p1.x, p2.x) + bow;
    c1 = { x: cx, y: p1.y };
    c2 = { x: cx, y: p2.y };
  } else {
    const dx = (p2.x - p1.x) * 0.5;
    c1 = { x: p1.x + dx, y: p1.y };
    c2 = { x: p2.x - dx, y: p2.y };
  }
  const d = `M ${round(p1.x)} ${round(p1.y)} C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`;
  edges.push({ rel, d, p1, c1, c2, p2, backward: dir === -1 });
}

const nodeRects = [...pos.values()].map((p) => ({ x1: p.x - 3, y1: p.y - 3, x2: p.x + NODE_W + 3, y2: p.y + NODE_H + 3 }));
const { labelled, dropped } = placeLabels(edges, nodeRects);

// ---------------------------------------------------------------- render
const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${esc(doc.meta?.title ?? 'Development Ecosystem')}">`);
parts.push(`<title>${esc(doc.meta?.title ?? 'Development Ecosystem')}</title>`);
parts.push(`<!-- GENERATED by scripts/build_ecosystem_diagram.mjs from docs/ecosystem/inventory.yaml. Do not hand-edit: the next run overwrites it. Edit the inventory. -->`);

// Colours are declared once as custom properties and redefined for dark mode,
// so the diagram is legible on Obsidian's white and dark themes alike.
parts.push(`<style>
  :root, svg {
    --bg:#ffffff; --panel:#f6f7f9; --stroke:#d3d8de; --fg:#1c2128; --muted:#6a737d;
    --edge:#b6bec7; --edge-back:#cfa8a8;
    --machine:#2f6fb5; --repo:#4a7f45; --runtime:#8a5cb8; --service:#c07a1e;
    --datastore:#1f7a86; --job:#b5502f; --surface:#7a5ea8; --secrets:#a3822a;
    --external:#5a6472; --agent:#9c3f74;
  }
  @media (prefers-color-scheme: dark) {
    :root, svg {
      --bg:#14171c; --panel:#1c2027; --stroke:#333b45; --fg:#e6eaef; --muted:#9aa4b0;
      --edge:#414b57; --edge-back:#6d4a4a;
      --machine:#6fa8e8; --repo:#8fc487; --runtime:#c09ce8; --service:#ecb464;
      --datastore:#5fc0cc; --job:#ee9070; --surface:#b49ce0; --secrets:#dcc06a;
      --external:#9aa4b0; --agent:#e084b4;
    }
  }
  .bg{fill:var(--bg)}
  .layer-label{fill:var(--muted);font:600 13px ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.06em;text-transform:uppercase}
  .layer-rule{stroke:var(--stroke);stroke-width:1}
  .node-box{fill:var(--panel);stroke:var(--stroke);stroke-width:1.5}
  .node-name{fill:var(--fg);font:600 13px ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif}
  .node-kind{font:500 10px ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.08em;text-transform:uppercase}
  .edge{fill:none;stroke:var(--edge);stroke-width:1.4}
  .edge-back{stroke:var(--edge-back);stroke-dasharray:5 4}
  .edge-label{fill:var(--muted);font:400 9.5px ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif}
  .edge-label-bg{fill:var(--bg)}
  a{cursor:pointer}
  a:hover .node-box, a:focus .node-box{stroke:var(--fg)}
  .node-unlinked .node-box{stroke-dasharray:6 4}
</style>`);

parts.push(`<rect class="bg" x="0" y="0" width="${WIDTH}" height="${HEIGHT}"/>`);
parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--edge)"/></marker></defs>`);

// column headers
parts.push('<g class="layers">');
LAYERS.forEach((layer, col) => {
  const x = MARGIN + col * (NODE_W + COL_GAP);
  parts.push(`<text class="layer-label" x="${x}" y="${MARGIN + 14}">${esc(layer.label)}</text>`);
  parts.push(`<line class="layer-rule" x1="${x}" y1="${MARGIN + 26}" x2="${x + NODE_W}" y2="${MARGIN + 26}"/>`);
});
parts.push('</g>');

// edges first, so nodes sit on top of them
parts.push('<g class="edges">');
for (const e of edges) {
  // Every edge carries its label as a tooltip, whether or not the label could
  // be drawn — so no relationship is unreachable, even where the canvas is full.
  parts.push(`<path class="edge${e.backward ? ' edge-back' : ''}" d="${e.d}" marker-end="url(#arrow)"><title>${esc(e.rel.from)} → ${esc(e.rel.to)}: ${esc(e.rel.label)}</title></path>`);
}
parts.push('</g>');
parts.push('<g class="edge-labels">');
for (const e of labelled) {
  parts.push(`<g class="edge-label-group"><rect class="edge-label-bg" x="${round(e.labelAt.x - e.labelW / 2)}" y="${round(e.labelAt.y - 8)}" width="${round(e.labelW)}" height="14" rx="3"/><text class="edge-label" x="${round(e.labelAt.x)}" y="${round(e.labelAt.y + 3)}" text-anchor="middle">${esc(e.label)}</text></g>`);
}
parts.push('</g>');

// nodes
parts.push('<g class="nodes">');
for (const layer of LAYERS) {
  for (const obj of byLayer.get(layer.id) ?? []) {
    const p = pos.get(obj.id);
    const lines = wrap(obj.name, NODE_W - 24);
    const startY = p.y + (lines.length === 1 ? 27 : 21);
    const href = resolveLink(obj);
    // The link wraps the whole group, so the entire box is the click target.
    // http(s) links open a new tab; obsidian:// hands off to Obsidian in place.
    if (href) parts.push(`<a href="${esc(href)}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>`);
    parts.push(`<g id="node-${esc(obj.id)}" class="node node-${esc(obj.kind)}${href || LINK_MODE === 'none' ? '' : ' node-unlinked'}">`);
    parts.push(`<title>${esc(obj.summary)}</title>`);
    parts.push(`<rect class="node-box" x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8"/>`);
    parts.push(`<rect x="${p.x}" y="${p.y}" width="4" height="${NODE_H}" rx="2" fill="var(--${esc(obj.kind)})"/>`);
    lines.forEach((line, i) => {
      parts.push(`<text class="node-name" x="${p.x + 14}" y="${startY + i * 15}">${esc(line)}</text>`);
    });
    parts.push(`<text class="node-kind" x="${p.x + 14}" y="${p.y + NODE_H - 11}" fill="var(--${esc(obj.kind)})">${esc(obj.kind)}</text>`);
    parts.push('</g>');
    if (href) parts.push('</a>');
  }
}
parts.push('</g>');
parts.push('</svg>');

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'ecosystem.svg');
fs.writeFileSync(outFile, parts.join('\n') + '\n');

console.log(`[ecosystem] Wrote ${outFile}`);
console.log(`[ecosystem] ${objects.length} object(s), ${edges.length} edge(s), ${WIDTH}×${HEIGHT}`);
if (LINK_MODE !== 'none') {
  const unlinked = objects.filter((o) => !resolveLink(o)).map((o) => o.id);
  console.log(`[ecosystem] links: ${LINK_MODE} — ${objects.length - unlinked.length} linked, ${unlinked.length} without a link${unlinked.length ? ` (dashed): ${unlinked.join(', ')}` : ''}`);
}
if (dropped) {
  console.log(`[ecosystem] ${dropped} edge label(s) had no free space and were not drawn — they remain readable as tooltips.`);
}
