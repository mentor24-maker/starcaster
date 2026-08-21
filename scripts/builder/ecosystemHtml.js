'use strict';

/**
 * Renders the standalone Development Ecosystem page — one self-contained HTML
 * file for anyone without the vault: a future teammate, or Dane on his phone.
 *
 * The page is the hand-built "Ecosystem Explorer" prototype of 2026-08-20,
 * made reproducible: the inventory's objects and relationships ride in as
 * JSON, the web-mode SVG from build_ecosystem_diagram.mjs is inlined, and a
 * detail panel renders each object's story (kind, summary, links, connections
 * both ways) without leaving the page.
 *
 * Rules this file lives by:
 *   - NO external requests. No fonts, no scripts, no stylesheets, no images
 *     from anywhere. The file must open with the wifi off.
 *   - Light/dark aware through prefers-color-scheme, matching the SVG's own
 *     palettes so the diagram and the page never disagree.
 *   - Deterministic: same inventory + same SVG in, byte-identical HTML out.
 *     No timestamps, no generated ids.
 *   - Read-only. No editing, no auth, no server.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Embedding JSON inside <script> is safe only if the text can never close
 * the tag early. `</script>` inside a summary would do exactly that, so the
 * angle brackets are escaped as unicode — still valid JSON, still the same
 * string once parsed.
 */
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

// Same narrative order as the diagram and the notes — but shown BOTTOM-UP in
// the stacked view, because that is how Dane asked to read it: work is made,
// proved, coordinated, shipped. External is a pillar beside the stack, not a
// rung: every layer leans on it.
const STACK = [
  { layer: 'production', title: 'Production', cap: "Where it ships — the live platform and every client's site." },
  { layer: 'coordination', title: 'Coordination', cap: 'How it runs itself — task boards, scheduled jobs, and AI agents around the clock.' },
  { layer: 'local-dev', title: 'Local development', cap: 'Where it is proved — a full local copy of the platform, so production is never the test bench.' },
  { layer: 'workstations', title: 'Workstations', cap: 'Where the work is made — the machines and the four codebases.' },
];
const JOINTS = ['deployed live', 'reviewed and merged', 'proved locally'];
const PILLAR = { layer: 'external', title: 'External', cap: 'What everything stands on — every layer leans on these.' };

const KIND_LABEL = {
  machine: 'machine', repo: 'codebase', runtime: 'container engine', service: 'service',
  datastore: 'database', job: 'scheduled job', surface: 'task board', secrets: 'credential store',
  external: 'external service', agent: 'AI agent',
};
const KINDS = Object.keys(KIND_LABEL);

// The SVG's web-mode palettes, verbatim (scripts/build_ecosystem_diagram.mjs),
// so a chip in the stacked view is the same colour as its box in the schematic.
const LIGHT = {
  bg: '#ffffff', panel: '#f6f7f9', stroke: '#d3d8de', fg: '#1c2128', muted: '#6a737d', link: '#2f6fb5',
  machine: '#2f6fb5', repo: '#4a7f45', runtime: '#8a5cb8', service: '#c07a1e', datastore: '#1f7a86',
  job: '#b5502f', surface: '#7a5ea8', secrets: '#a3822a', external: '#5a6472', agent: '#9c3f74',
};
const DARK = {
  bg: '#14171c', panel: '#1c2027', stroke: '#333b45', fg: '#e6eaef', muted: '#9aa4b0', link: '#6fa8e8',
  machine: '#6fa8e8', repo: '#8fc487', runtime: '#c09ce8', service: '#ecb464', datastore: '#5fc0cc',
  job: '#ee9070', surface: '#b49ce0', secrets: '#dcc06a', external: '#9aa4b0', agent: '#e084b4',
};
// Page tokens are prefixed `--ui-` on purpose: the inlined SVG declares its
// own `--bg`, `--fg`, `--machine`… on `:root, svg`, and a shared name would
// let whichever stylesheet came last win.
const tokens = (p) => Object.entries(p).map(([k, v]) => `--ui-${k}:${v};`).join(' ');

/** The data the page needs, and nothing it does not (no probes, no notes). */
function pageData(doc) {
  const objects = (doc.objects ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    kind: o.kind,
    layer: o.layer,
    summary: o.summary,
    host: o.host ?? null,
    links: o.links ? { doc: o.links.doc ?? null, url: o.links.url ?? null } : null,
    detail: o.detail ?? null,
  }));
  const relationships = (doc.relationships ?? []).map((r) => ({ from: r.from, to: r.to, label: r.label }));
  return { title: doc.meta?.title ?? 'Development Ecosystem', objects, relationships };
}

const CSS = `
  :root { ${tokens(LIGHT)} color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { ${tokens(DARK)} } }

  * { box-sizing: border-box; }
  [hidden] { display: none !important; }  /* .stackview's display:flex would otherwise beat the hidden attribute */
  html, body { margin: 0; }
  body {
    background: var(--ui-bg); color: var(--ui-fg);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 1.5rem 1.25rem 3rem;
  }
  .wrap { max-width: 1560px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  h1 { font-weight: 700; font-size: 1.9rem; line-height: 1.15; margin: 0 0 .3rem; }
  .lede { color: var(--ui-muted); margin: 0; max-width: 62ch; }

  .tabs { display: flex; gap: .5rem; }
  .tabs button {
    font: 600 .9rem/1 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: .6rem 1.1rem; border-radius: 999px; cursor: pointer;
    border: 1.5px solid var(--ui-stroke); background: var(--ui-panel); color: var(--ui-fg);
  }
  .tabs button[aria-pressed="true"] { background: var(--ui-fg); color: var(--ui-bg); border-color: var(--ui-fg); }
  .tabs button:focus-visible, .chip:focus-visible, .conn button:focus-visible { outline: 2px solid var(--ui-link); outline-offset: 2px; }

  .layout { display: flex; gap: 1.25rem; align-items: flex-start; }
  .main { flex: 1 1 0; min-width: 0; }

  /* ---------- stacked view ---------- */
  .stackview { display: flex; gap: 1.25rem; align-items: stretch; }
  .stack { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
  .band, .pillar { background: var(--ui-panel); border: 1px solid var(--ui-stroke); border-radius: 12px; padding: 1rem 1.25rem 1.15rem; }
  .band h2, .pillar h2 { margin: 0 0 .15rem; font: 600 .8rem/1.3 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: .1em; text-transform: uppercase; }
  .cap { margin: 0 0 .8rem; font-size: .85rem; color: var(--ui-muted); }
  .chips { display: flex; flex-wrap: wrap; gap: .55rem; }
  .chip {
    display: flex; align-items: center; gap: .55rem; text-align: left;
    background: var(--ui-bg); border: 1.5px solid var(--ui-stroke); border-radius: 8px;
    padding: .5rem .8rem .5rem .5rem; cursor: pointer; color: var(--ui-fg);
    font: 600 .85rem/1.2 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .chip .bar { width: 4px; height: 22px; border-radius: 2px; flex: none; background: currentColor; }
  .chip .chip-name { color: var(--ui-fg); }  /* the kind colour is for the bar; the name stays legible */
  .chip:hover { border-color: var(--ui-muted); }
  .chip[aria-pressed="true"] { border-color: var(--ui-fg); box-shadow: 0 0 0 1px var(--ui-fg); }
  .chip.undoc { border-style: dashed; }
  .chip.undoc .chip-name { color: var(--ui-muted); }
  .joint { display: flex; align-items: center; gap: .6rem; padding: .35rem 0 .35rem 1.4rem; color: var(--ui-muted); }
  .joint svg { flex: none; }
  .joint span { font-size: .78rem; letter-spacing: .06em; text-transform: uppercase; }
  .pillar { flex: 0 0 208px; display: flex; flex-direction: column; }
  .pillar .chips { flex-direction: column; align-items: stretch; }
  .pillar .note { margin-top: auto; padding-top: 1rem; font-size: .78rem; color: var(--ui-muted); }

  /* ---------- schematic view: the diagram scrolls inside its own frame ---------- */
  .stage { border: 1px solid var(--ui-stroke); border-radius: 12px; overflow-x: auto; background: var(--ui-bg); max-width: 100%; }
  .stage svg { display: block; min-width: 1200px; width: 100%; height: auto; }
  .stage .node { cursor: pointer; }
  .stage .node.is-selected .node-box { stroke: var(--ui-fg); stroke-width: 2.5; }
  .hint { font-size: .85rem; color: var(--ui-muted); margin: .6rem 0 0; }

  /* ---------- detail panel ---------- */
  .panel {
    flex: 0 0 350px; position: sticky; top: 1rem; min-width: 0;
    background: var(--ui-panel); border: 1px solid var(--ui-stroke); border-radius: 12px;
    padding: 1.25rem 1.25rem 1.35rem; min-height: 200px; overflow-wrap: anywhere;
  }
  .panel .empty { color: var(--ui-muted); font-size: .9rem; }
  .kindchip { display: inline-flex; align-items: center; gap: .45rem; font: 600 .7rem/1 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: .1em; text-transform: uppercase; margin-bottom: .6rem; }
  .kindchip .dot { width: 10px; height: 10px; border-radius: 3px; background: currentColor; }
  .panel h3 { font-size: 1.35rem; margin: 0 0 .5rem; }
  .panel .summary { font-size: .92rem; margin: 0 0 1rem; }
  .panel .links { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1.1rem; }
  .panel .open {
    display: inline-block; padding: .5rem .9rem; border-radius: 8px;
    background: var(--ui-link); color: var(--ui-bg); font-weight: 600; font-size: .85rem; text-decoration: none;
  }
  .panel .open:hover { filter: brightness(1.12); }
  .panel .docref, .panel .nodoc { display: inline-block; padding: .5rem .9rem; border-radius: 8px; border: 1.5px dashed var(--ui-stroke); color: var(--ui-muted); font-size: .82rem; }
  .panel .docref code { font-size: .8rem; color: var(--ui-fg); }
  .panel h4 { margin: .9rem 0 .4rem; font: 600 .72rem/1.3 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: var(--ui-muted); }
  .conn { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
  .conn li { font-size: .85rem; color: var(--ui-muted); }
  .conn button, .facts button { background: none; border: none; padding: 0; cursor: pointer; color: var(--ui-link); font: 600 .85rem/1.4 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .conn button:hover, .facts button:hover { text-decoration: underline; }
  .facts { margin: 0; font-size: .82rem; display: grid; grid-template-columns: max-content 1fr; gap: .25rem .7rem; }
  .facts dt { color: var(--ui-muted); }
  .facts dd { margin: 0; }

  ${KINDS.map((k) => `.kind-${k} { color: var(--ui-${k}); }`).join('\n  ')}

  @media (max-width: 980px) {
    body { padding: 1rem .9rem 2.5rem; }
    /* Stretch, not flex-start: a column item left to size itself grows to the
       diagram's min-width and drags the whole page sideways on a phone. */
    .layout { flex-direction: column; align-items: stretch; }
    .main { width: 100%; }
    .panel { position: static; flex: none; width: 100%; }
    .stackview { flex-direction: column; }
    .pillar { flex: none; }
  }
`;

const JS = `
const byId = Object.fromEntries(DATA.objects.map(o => [o.id, o]));
const outEdges = {}, inEdges = {};
for (const r of DATA.relationships) {
  (outEdges[r.from] ??= []).push(r);
  (inEdges[r.to] ??= []).push(r);
}
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const hasLink = o => !!(o.links && (o.links.url || o.links.doc));

function chipHtml(o) {
  return '<button class="chip kind-' + esc(o.kind) + (hasLink(o) ? '' : ' undoc') + '" data-id="' + esc(o.id) + '" aria-pressed="false">' +
    '<span class="bar"></span><span class="chip-name">' + esc(o.name) + '</span></button>';
}

function renderStack() {
  const arrow = '<svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><path d="M7 16 V4 M2.5 8.5 L7 3.5 L11.5 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let html = '<div class="stack">';
  STACK.forEach((band, i) => {
    const objs = DATA.objects.filter(o => o.layer === band.layer);
    html += '<section class="band"><h2 class="kind-' + esc(band.accent) + '">' + esc(band.title) + '</h2>' +
      '<p class="cap">' + esc(band.cap) + '</p><div class="chips">' + objs.map(chipHtml).join('') + '</div></section>';
    if (i < STACK.length - 1) html += '<div class="joint">' + arrow + '<span>' + esc(JOINTS[i]) + '</span></div>';
  });
  html += '</div>';
  const ext = DATA.objects.filter(o => o.layer === PILLAR.layer);
  html += '<section class="pillar"><h2 class="kind-external">' + esc(PILLAR.title) + '</h2>' +
    '<p class="cap">' + esc(PILLAR.cap) + '</p>' +
    '<div class="chips">' + ext.map(chipHtml).join('') + '</div>' +
    '<div class="note">Read the stack bottom-up: work is made, proved, coordinated, and shipped.</div></section>';
  document.getElementById('view-stack').innerHTML = html;
}

function connLine(rel, otherId) {
  const other = byId[otherId];
  if (!other) return '';
  return '<li><button data-id="' + esc(otherId) + '">' + esc(other.name) + '</button> — ' + esc(rel.label) + '</li>';
}

function factValue(v) {
  if (Array.isArray(v)) return v.map(factValue).join(', ');
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => k + ': ' + factValue(x)).join('; ');
  return String(v);
}

function renderPanel(id) {
  const o = byId[id];
  if (!o) return;
  const url = o.links && o.links.url;
  const doc = o.links && o.links.doc;
  // Obsidian is not assumed here, so a vault note is named rather than linked;
  // a web address gets a real button.
  let links = '';
  if (url) links += '<a class="open" href="' + esc(url) + '" target="_blank" rel="noopener">Open ' + esc(url.replace(/^https?:\\/\\/([^/]+).*/, '$1')) + ' ↗</a>';
  if (doc) links += '<span class="docref">Vault note: <code>' + esc(doc.replace(/\\.md$/, '')) + '</code></span>';
  if (!url && !doc) links = '<span class="nodoc">No documentation yet — this box renders dashed until it has some.</span>';
  const outs = (outEdges[id] ?? []).map(r => connLine(r, r.to)).join('');
  const ins = (inEdges[id] ?? []).map(r => connLine(r, r.from)).join('');
  const facts = [];
  if (o.host && byId[o.host]) facts.push(['runs on', '<button data-id="' + esc(o.host) + '">' + esc(byId[o.host].name) + '</button>']);
  for (const [k, v] of Object.entries(o.detail ?? {})) facts.push([k.replace(/_/g, ' '), esc(factValue(v))]);
  document.getElementById('panel').innerHTML =
    '<span class="kindchip kind-' + esc(o.kind) + '"><span class="dot"></span>' + esc(KIND_LABEL[o.kind] ?? o.kind) + '</span>' +
    '<h3>' + esc(o.name) + '</h3>' +
    '<p class="summary">' + esc(o.summary) + '</p>' +
    '<div class="links">' + links + '</div>' +
    (outs ? '<h4>It reaches out to</h4><ul class="conn">' + outs + '</ul>' : '') +
    (ins ? '<h4>Reached by</h4><ul class="conn">' + ins + '</ul>' : '') +
    (facts.length ? '<h4>Details</h4><dl class="facts">' + facts.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>' : '');
}

function select(id) {
  if (!byId[id]) return;
  renderPanel(id);
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.id === id ? 'true' : 'false'));
  document.querySelectorAll('#stage .node').forEach(n => n.classList.toggle('is-selected', n.id === 'node-' + id));
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
}

document.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-id]');
  if (chip) { select(chip.dataset.id); return; }
  // The diagram's boxes are links (the SVG also ships on its own); here a
  // click reveals the detail panel instead of leaving the page.
  const a = e.target.closest('#stage a');
  const node = e.target.closest('#stage .node');
  if (a) e.preventDefault();
  if (node && node.id.startsWith('node-')) select(node.id.slice(5));
});

function setView(view) {
  document.getElementById('view-stack').hidden = view !== 'stack';
  document.getElementById('view-map').hidden = view !== 'map';
  document.getElementById('tab-stack').setAttribute('aria-pressed', String(view === 'stack'));
  document.getElementById('tab-map').setAttribute('aria-pressed', String(view === 'map'));
}
document.getElementById('tab-stack').addEventListener('click', () => setView('stack'));
document.getElementById('tab-map').addEventListener('click', () => setView('map'));

renderStack();
if (location.hash.length > 1) select(decodeURIComponent(location.hash.slice(1)));
`;

/**
 * The whole page. `svgMarkup` is the web-mode diagram from
 * build_ecosystem_diagram.mjs; it is inlined so its boxes are live DOM the
 * click handler can read. An <img> would be a picture with no ids.
 */
function renderPage(doc, svgMarkup) {
  if (!svgMarkup || !/<svg[\s>]/.test(svgMarkup)) {
    throw new Error('renderPage needs the web-mode diagram markup (run build_ecosystem_diagram.mjs --links web)');
  }
  if (/<style[\s>]/.test(svgMarkup) === false) {
    // Vault-mode SVG has no stylesheet and no .node-box class — the page's
    // selection highlight and theme would silently not apply.
    throw new Error('renderPage was given a vault-mode diagram; the page needs --links web');
  }
  const data = pageData(doc);
  const stack = STACK.map((b) => ({ ...b, accent: accentFor(b.layer) }));
  const objectCount = data.objects.length;
  const edgeCount = data.relationships.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(data.title)}</title>
<!-- GENERATED by scripts/build_ecosystem_html.mjs (starcaster repo) from docs/ecosystem/inventory.yaml. Do not hand-edit: the next run overwrites it. Edit the inventory. -->
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>${esc(data.title)}</h1>
      <p class="lede">The machines, codebases, services, jobs and agents that build and run StarCaster — ${objectCount} objects, ${edgeCount} connections. Click any box to see what it is and what it connects to, then follow the connections.</p>
    </div>
    <div class="tabs" role="group" aria-label="View">
      <button id="tab-stack" aria-pressed="true">Stacked view</button>
      <button id="tab-map" aria-pressed="false">Full schematic</button>
    </div>
  </header>

  <div class="layout">
    <div class="main">
      <div id="view-stack" class="stackview"></div>
      <div id="view-map" hidden>
        <div class="stage" id="stage">${svgMarkup.trim()}</div>
        <p class="hint">The map is wide — scroll it sideways if your window is narrow. Hover a line to read its label.</p>
      </div>
    </div>
    <aside class="panel" id="panel" aria-live="polite">
      <div class="empty">Nothing selected yet.<br><br>Click any box — in either view — and its story appears here: what it is, what it talks to, and where its documentation lives.</div>
    </aside>
  </div>
</div>

<script>
const DATA = ${jsonForScript(data)};
const STACK = ${jsonForScript(stack)};
const JOINTS = ${jsonForScript(JOINTS)};
const PILLAR = ${jsonForScript(PILLAR)};
const KIND_LABEL = ${jsonForScript(KIND_LABEL)};
${JS}</script>
</body>
</html>
`;
}

/** Each band is tinted with the kind colour of what mostly lives there. */
function accentFor(layer) {
  return { production: 'service', coordination: 'agent', 'local-dev': 'runtime', workstations: 'machine', external: 'external' }[layer] ?? 'external';
}

module.exports = { renderPage, pageData, STACK, PILLAR, KIND_LABEL };
