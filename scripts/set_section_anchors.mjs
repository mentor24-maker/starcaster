#!/usr/bin/env node
/**
 * Give sections of one page their anchor names, and republish THAT page only
 * (task SC-852).
 *
 * The section panel's "Anchor name" is the everyday way to do this. This tool
 * exists for the case the ticket names — Bayside's live menu links to
 * `/#about-us`, `/#services` and `/#contact-us`, and no section carried those
 * names — and for any page where names are set by matching the section's
 * title or text rather than by clicking through the Builder.
 *
 * WHAT IT DOES
 *   Reads the page, finds each section the `--set` lines name, and prints the
 *   plan. With `--apply` it writes the names (through the page store, so the
 *   write is a normal page save with a revision), reads the page back and
 *   checks every name landed, then — with `--publish` — publishes that ONE
 *   page by `pageIds` (CLAUDE.md landmine 16: an unnamed publish puts every
 *   pending draft live).
 *
 * A SECTION IS NAMED BY
 *   its id (`sec_abc=contact-us`), or by text the section must contain —
 *   its title or any module's text, case-insensitively — written
 *   `text:Contact Us=contact-us`. A text that matches no section, or more
 *   than one, stops the run: guessing which section a visitor lands on is the
 *   one thing this must not do.
 *
 * USAGE
 *   doppler run --project starcaster --config prd -- node scripts/set_section_anchors.mjs \
 *     --page 1571 --set "text:About Us=about-us" --set "text:Services=services" \
 *     --set "text:Contact Us=contact-us"                 # dry run: prints the plan
 *   … the same with --apply --publish                    # writes, verifies, publishes page 1571
 *
 *   --list   print every section of the page (id, title, first words) and stop.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
function values(name) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) if (args[i] === name) out.push(args[i + 1] || '');
  return out;
}

const pageId = String(values('--page')[0] || '').trim();
if (!/^\d+$/.test(pageId)) {
  console.error('--page <id> is required (the page\'s number, e.g. 1571).');
  process.exit(1);
}
const APPLY = flag('--apply');
const PUBLISH = flag('--publish');
if (PUBLISH && !APPLY) {
  console.error('--publish needs --apply: a dry run publishes nothing.');
  process.exit(1);
}

const { normalizeAnchorName } = require('./lib/builder-client/page-link.js');
const { sbQuery, tableConfig } = require('./lib/supabase.js');
const pagesStore = require('./lib/builderPagesStore.js');
const { publishPages } = require('./lib/builderPublishStore.js');

/** The stores return { ok, status, data } envelopes — never the row itself. */
function must(res, what) {
  if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || `status ${res?.status}`}`);
  return res.data;
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function sectionText(section) {
  const parts = [section.title || ''];
  for (const mod of section.modules || []) {
    parts.push(stripTags(mod.text), mod.name || '');
    for (const value of Object.values(mod.settings || {})) {
      if (typeof value === 'string' && value.length < 4000) parts.push(stripTags(value));
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const sectionsOf = (page) => (Array.isArray(page?.layoutSections) ? page.layoutSections : []);

async function main() {
  const owner = await sbQuery({
    method: 'GET',
    table: tableConfig().builderPages,
    query: `select=id,project_id,slug,name&id=eq.${encodeURIComponent(pageId)}`,
  });
  const row = owner.ok && Array.isArray(owner.data) ? owner.data[0] : null;
  if (!row) throw new Error(`page ${pageId}: could not be read (${owner.error || `status ${owner.status}`}).`);
  const scope = { projectId: String(row.project_id || '') };
  if (!scope.projectId) throw new Error(`page ${pageId} has no project — refusing to write an untenanted page.`);

  const page = must(await pagesStore.getPage(pageId, scope), `read page ${pageId}`);
  const sections = sectionsOf(page);
  console.log(`Page ${pageId} "${page.name || row.name}" (/${page.slug ?? row.slug}) in project ${scope.projectId}: ${sections.length} section(s).`);

  if (flag('--list')) {
    for (const section of sections) {
      const words = sectionText(section).slice(0, 90);
      console.log(`  ${section.id}${section.anchorName ? `  #${section.anchorName}` : ''}  ${words}`);
    }
    return;
  }

  const requests = values('--set');
  if (!requests.length) throw new Error('nothing to do: give at least one --set "<section id or text:…>=<name>".');

  const plan = new Map(); // section id → name
  for (const request of requests) {
    const at = request.lastIndexOf('=');
    const target = at === -1 ? '' : request.slice(0, at).trim();
    const name = normalizeAnchorName(at === -1 ? '' : request.slice(at + 1));
    if (!target || !name) throw new Error(`--set "${request}": expected "<section id or text:…>=<anchor name>".`);
    let matches;
    if (target.startsWith('text:')) {
      const needle = target.slice(5).trim().toLowerCase();
      matches = sections.filter((section) => sectionText(section).toLowerCase().includes(needle));
      // A heading match outranks a passing mention (a menu row mentions every label).
      const titled = matches.filter((section) => (section.modules || []).some((mod) => /^(heading|text)$/.test(mod.type) && /<h[1-6][^>]*>[^<]*/i.test(String(mod.text || '')) && stripTags(String(mod.text || '').match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || '').toLowerCase().includes(needle)));
      if (titled.length) matches = titled;
      matches = matches.filter((section) => !(section.modules || []).every((mod) => mod.type === 'navigation'));
    } else {
      matches = sections.filter((section) => String(section.id) === target);
    }
    if (matches.length !== 1) {
      throw new Error(`--set "${request}": ${matches.length} sections match (${matches.map((s) => s.id).join(', ') || 'none'}) — name it by id instead (--list shows them).`);
    }
    plan.set(String(matches[0].id), name);
  }

  const names = [...plan.values()];
  const dup = names.find((name, index) => names.indexOf(name) !== index);
  if (dup) throw new Error(`two sections would both be named "${dup}".`);
  for (const section of sections) {
    const keeps = normalizeAnchorName(section.anchorName || '');
    if (keeps && !plan.has(String(section.id)) && names.includes(keeps)) {
      throw new Error(`section ${section.id} is already named "${keeps}".`);
    }
  }

  for (const [id, name] of plan) {
    const section = sections.find((s) => String(s.id) === id);
    console.log(`  ${id}: ${section.anchorName ? `#${section.anchorName} → ` : ''}#${name}   (${sectionText(section).slice(0, 60)})`);
  }
  if (!APPLY) {
    console.log('\nDry run — nothing written. Add --apply (and --publish) to write.');
    return;
  }

  const next = sections.map((section) => (plan.has(String(section.id)) ? { ...section, anchorName: plan.get(String(section.id)) } : section));
  must(await pagesStore.updatePage(pageId, { ...page, layoutSections: next }, scope, {
    previous: page,
    reason: 'save',
    actor: 'set-section-anchors',
  }), `write page ${pageId}`);

  const after = sectionsOf(must(await pagesStore.getPage(pageId, scope), `read back page ${pageId}`));
  if (after.length !== sections.length) throw new Error(`read back ${after.length} sections, expected ${sections.length} — stop and look.`);
  for (const [id, name] of plan) {
    const landed = after.find((s) => String(s.id) === id);
    if (!landed || landed.anchorName !== name) throw new Error(`section ${id} reads back as "${landed?.anchorName ?? '(none)'}", expected "${name}".`);
  }
  console.log(`Wrote and read back ${plan.size} anchor name(s) on page ${pageId}.`);

  if (PUBLISH) {
    const result = must(await publishPages(scope.projectId, { pageIds: [pageId] }), `publish page ${pageId}`);
    console.log(`Published: ${result.published} page(s) (asked for page ${pageId} only).`);
    if (result.published !== 1) throw new Error(`expected to publish exactly page ${pageId}, published ${result.published}.`);
  }
}

main().catch((err) => {
  console.error(`set_section_anchors: ${err.message}`);
  process.exit(1);
});
