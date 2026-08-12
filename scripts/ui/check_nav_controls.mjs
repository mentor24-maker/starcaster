/**
 * THE CONTROL SWEEP — does every setting on the Navigation panel actually
 * change the rendered page?
 *
 * WHY THIS EXISTS
 * Four separate reports in two days, all of the same shape: "I set this and
 * nothing happens." Menu background, text colour, cell padding, item gap.
 * Each was found by the operator, one at a time, and each took a round trip.
 * The causes were never the same twice — a hardcoded stylesheet fallback a
 * control could not reach, an `!important` in a breakpoint, a variable landing
 * on an element that did not hold the links, a colour losing a specificity
 * argument. No amount of reading the code catches all four. Measuring the
 * rendered result catches every one of them.
 *
 * HOW IT WORKS
 * For each control: render the menu twice, identical except for that one
 * setting, and diff the computed styles and geometry of every part of the
 * menu. A control that changes NOTHING is dead, and named. Anything else is
 * reported with what it moved, so a control that moves the wrong thing is
 * visible too.
 *
 * THE FIXTURE IS PART OF THE TEST. Two controls looked dead on the first run
 * because the sample menu had no link to the current page and only two
 * sub-items — the current-page colours had nothing to colour, and 3 columns
 * could not be told from 5. Widening the fixture cleared both. If something
 * reports dead, rule the fixture out before touching the code.
 *
 *   npm run check:nav-controls
 *
 * Not in CI — CI has no browsers — so run it after changing the panel, the
 * nav style helper, or any `.site-nav` CSS.
 */
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const { CONTROLS } = await import(path.join(ROOT, 'scripts/ui/nav-control-matrix.mjs'));

const F = process.env.NAV_MATRIX_OUT || path.join(os.tmpdir(), 'starcaster-nav-control-matrix');

// Render the fixture first, so the check can never measure a stale one.
execFileSync('npx', ['vitest', 'run', 'components/builder/nav-control-matrix.fixture.test.tsx'],
  { cwd: ROOT, stdio: 'ignore', env: { ...process.env, NAV_MATRIX_OUT: F } });

const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1400,height:900} });
await p.goto(`file://${F}.html`); await p.waitForTimeout(600);

// Force every dropdown and mega panel open so their controls are measurable.
await p.evaluate(() => {
  document.querySelectorAll('.site-nav-mega-panel[hidden]').forEach(el => el.removeAttribute('hidden'));
  const s = document.createElement('style');
  s.textContent = '.site-nav-dropdown-menu{display:flex !important}';
  document.head.appendChild(s);
});
await p.waitForTimeout(200);

const PROPS = ['display','gap','columnGap','rowGap','padding','margin','backgroundColor','backgroundImage','color',
 'border','borderRadius','boxShadow','textShadow','fontSize','fontWeight','fontStyle','letterSpacing','textTransform',
 'textDecorationLine','transform','minHeight','minWidth','width','opacity','justifyContent','alignItems','flexDirection',
 'gridTemplateColumns','textAlign','position','top','left'];
const SELECTORS = ['.site-nav','.site-nav-items','.site-nav-link','.site-nav-link-active','.site-nav-dropdown-menu',
 '.site-nav-dropdown-item','.site-nav-mega-panel','.site-nav-mega-grid','.site-nav-mega-link','.builder-preview-module',
 '.site-nav-dropdown-arrow'];

const snap = (id) => p.evaluate(({id,PROPS,SELECTORS}) => {
  const root=document.querySelector(`[data-variant="${id}"]`);
  if(!root) return {__missing:true};
  const out={};
  for(const sel of SELECTORS){
    const els=[...root.querySelectorAll(sel)];
    out[sel+'#count']=els.length;
    const el=els[0]; if(!el) continue;
    const cs=getComputedStyle(el);
    for(const prop of PROPS) out[sel+'.'+prop]=cs[prop];
    const r=el.getBoundingClientRect();
    out[sel+'@box']=[Math.round(r.width),Math.round(r.height),Math.round(r.left-root.getBoundingClientRect().left),Math.round(r.top-root.getBoundingClientRect().top)].join(',');
  }
  // Where every top-level item sits, which is what spacing controls move.
  const items=[...root.querySelectorAll('.site-nav-items > *')];
  out['__itemPositions']=items.map(e=>{const r=e.getBoundingClientRect();return Math.round(r.left)+':'+Math.round(r.width);}).join('|');
  out['__text']=(root.querySelector('.site-nav')?.innerText||'').replace(/\s+/g,' ').trim();
  return out;
}, {id,PROPS,SELECTORS});

const hoverSnap = async (id) => {
  const link = await p.$(`[data-variant="${id}"] .site-nav-link`);
  if (link) { await link.hover(); await p.waitForTimeout(80); }
  return snap(id);
};

const dead=[], live=[], broken=[];
for (const c of CONTROLS) {
  const a = c.hover ? await hoverSnap(`${c.id ?? c.key}::base`) : await snap(`${c.id ?? c.key}::base`);
  const z = c.hover ? await hoverSnap(`${c.id ?? c.key}::set`)  : await snap(`${c.id ?? c.key}::set`);
  if (a.__missing || z.__missing) { broken.push(c); continue; }
  const changed = Object.keys({...a,...z}).filter(k => String(a[k]) !== String(z[k]));
  if (changed.length === 0) dead.push({ ...c, });
  else live.push({ key:c.key, label:c.label, changed: changed.length, sample: changed.slice(0,2).join(', ') });
}

console.log('\n=== CONTROLS THAT CHANGE NOTHING ===');
if(!dead.length) console.log('  (none)');
for (const d of dead) console.log(`  DEAD  ${d.label.padEnd(22)} ${d.key} = ${d.value}${d.hover?'   [hover]':''}`);
console.log(`\n=== WORKING: ${live.length}/${CONTROLS.length} ===`);
for (const l of live) console.log(`  ok    ${l.label.padEnd(22)} ${String(l.changed).padStart(3)} props   e.g. ${l.sample}`);
if(broken.length) console.log('\n=== VARIANT MISSING ===', broken.map(b=>b.key).join(', '));
await b.close();

if (dead.length) {
  console.error(`\n[check:nav-controls] ${dead.length} control(s) change nothing on the page.`);
  console.error('Rule the fixture out first — see the note at the top of this file.\n');
  process.exit(1);
}
console.log(`\n[check:nav-controls] OK — all ${live.length} controls move the rendered page.\n`);
