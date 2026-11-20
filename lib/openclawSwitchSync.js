'use strict';

/**
 * OpenClaw follows the AI provider switch (SC-874, OpenClaw keys 3).
 *
 * Dane, 2026-11-18: "We need to set up Openclaw so we can point it at any
 * active API in the system." Until this, OpenClaw on the Mini tried the models
 * written in lib/openclawModels.json, so changing the provider order on
 * Settings › APIs changed every AI feature on the website and nothing on the
 * Mini. scripts/openclaw_switch_sync.mjs runs on the relay's ten-minute wake,
 * reads the switch from production, and, when the order it names differs from
 * what OpenClaw is set to, rewrites OpenClaw's primary model and fallbacks and
 * restarts it. This file is the deciding half, with no disk, network or
 * launchd in it, so every rule below is tested directly.
 *
 * WHICH ORDER. Outreach's own order when SC-872's feature groups give it one
 * (`settings.groupOrders.outreach`), because outreach is what OpenClaw does;
 * the main order otherwise, exactly as the door in lib/aiClient.js decides for
 * an Outreach feature. Before SC-872 there are no groups, so it is the main
 * order.
 *
 * WHAT A PROVIDER BECOMES. lib/openclawProviderMap.json: one OpenClaw model and
 * one key name per provider. A switched-on provider OpenClaw cannot use (no
 * model for it, or no key for it in ~/.openclaw/.env) is left out of the order
 * AND reported, never silently skipped. When the switch leaves nothing usable,
 * OpenClaw keeps what it has: a working order beats an empty one.
 *
 * WHEN IT CANNOT TELL. An unreadable switch leaves OpenClaw untouched and says
 * CANNOT TELL; the bus hears of it once it has lasted over an hour, like the
 * AI key check (lib/aiKeys.js), so a passing blip is not an alarm and a check
 * that stays blind is not silent.
 */

const fs = require('node:fs');
const path = require('node:path');

const MAP_FILE = path.join(__dirname, 'openclawProviderMap.json');
const REPEAT_MS = 6 * 60 * 60 * 1000;
const BLIND_MS = 60 * 60 * 1000;
const OUTREACH_GROUP = 'outreach';

/** The committed map, checked: `{ providers: { id: { model, key } }, unsupported: { id: why } }`. */
function loadMap(file = MAP_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const providers = raw && typeof raw.providers === 'object' ? raw.providers : null;
  if (!providers) throw new Error('openclawProviderMap: "providers" is missing');
  for (const [id, p] of Object.entries(providers)) {
    if (!/^[a-z0-9-]+\/\S+$/.test(String(p?.model || ''))) throw new Error(`openclawProviderMap: ${id}'s model "${p?.model}" is not provider/model`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(String(p?.key || ''))) throw new Error(`openclawProviderMap: ${id} names no key`);
  }
  return { providers, unsupported: raw.unsupported && typeof raw.unsupported === 'object' ? raw.unsupported : {} };
}

function labelFor(id, settings, labels = {}) {
  if (labels[id]) return labels[id];
  const custom = (settings?.customProviders || []).find((c) => c.id === id);
  return custom?.label || id;
}

/**
 * The order OpenClaw should follow, from a normalised settings row
 * (lib/aiProviderSettingsStore.js `normaliseRow`). `{ entries, source, note? }`,
 * or null when nothing has been saved on Settings › APIs.
 */
function pickOrder(settings) {
  if (!settings || !settings.exists) return null;
  const main = Array.isArray(settings.providers) ? settings.providers : [];
  const group = settings.groupOrders && settings.groupOrders[OUTREACH_GROUP];
  const groupError = settings.groupErrors && settings.groupErrors[OUTREACH_GROUP];
  if (Array.isArray(group) && group.some((p) => p.enabled)) {
    return { entries: group, source: "Outreach's own order" };
  }
  let note;
  if (groupError) note = `Outreach's own order could not be read (${groupError}), so the main order is used`;
  else if (Array.isArray(group)) note = "Outreach's own order has nothing switched on, so the main order is used";
  if (!main.length) return null;
  return { entries: main, source: 'the main order', ...(note ? { note } : {}) };
}

/**
 * What OpenClaw should be set to.
 *
 *   readError   why the switch could not be read ('' when it was)
 *   settings    the normalised row, when it was read
 *   keysPresent Set of key NAMES that hold a value in ~/.openclaw/.env (never values)
 *
 * Returns one of:
 *   { verdict: 'CANNOT_TELL', why }
 *   { verdict: 'NOT_SAVED', why }                       nothing to follow: keep what it has
 *   { verdict: 'NO_USABLE', why, problems, source }      every switched-on provider is unusable: keep what it has
 *   { verdict: 'ORDER', primary, fallbacks, order, problems, source, note? }
 * `problems` is [{ id, provider, label, text }], one per switched-on provider left out.
 */
function planModels({ readError = '', settings = null, keysPresent = new Set(), map = loadMap(), labels = {} } = {}) {
  if (readError) return { verdict: 'CANNOT_TELL', why: `the AI switch could not be read: ${readError}` };
  const picked = pickOrder(settings);
  if (!picked) return { verdict: 'NOT_SAVED', why: 'nothing has been saved on Settings › APIs yet, so there is no order to follow' };

  const order = [];
  const problems = [];
  for (const entry of picked.entries) {
    if (!entry || !entry.enabled) continue;
    const label = labelFor(entry.id, settings, labels);
    const target = map.providers[entry.id];
    if (!target) {
      const why = map.unsupported[entry.id] || 'OpenClaw has no model listed for it in lib/openclawProviderMap.json';
      problems.push({ id: `no-model:${entry.id}`, provider: entry.id, label, text: `${label} is switched on for ${picked.source}, but OpenClaw cannot use it: ${why}.` });
      continue;
    }
    if (!keysPresent.has(target.key)) {
      problems.push({ id: `no-key:${entry.id}`, provider: entry.id, label, text: `${label} is switched on for ${picked.source}, but the Mini's OpenClaw has no ${target.key} in ~/.openclaw/.env, so it was left out. Running scripts/install_openclaw.sh on the Mini copies the key from Doppler prd, if Doppler has one.` });
      continue;
    }
    if (!order.includes(target.model)) order.push(target.model);
  }
  if (!order.length) {
    return { verdict: 'NO_USABLE', why: `no provider switched on for ${picked.source} can be used by OpenClaw, so it keeps the order it has`, problems, source: picked.source };
  }
  return {
    verdict: 'ORDER',
    primary: order[0],
    fallbacks: order.slice(1),
    order,
    problems,
    source: picked.source,
    ...(picked.note ? { note: picked.note } : {}),
  };
}

/** OpenClaw's configured models: `{ primary, fallbacks }` (empty when unset). */
function currentModels(config) {
  const m = config?.agents?.defaults?.model;
  return {
    primary: typeof m?.primary === 'string' ? m.primary : '',
    fallbacks: Array.isArray(m?.fallbacks) ? m.fallbacks.filter((x) => typeof x === 'string') : [],
  };
}

function hasAllowlist(config) {
  const allow = config?.agents?.defaults?.modelPolicy?.allow;
  return Array.isArray(allow) && allow.length > 0;
}

/**
 * Does OpenClaw need changing to follow `plan`? An allowlist counts as a
 * change, as it does for the installer: with one, a fallback not on it is
 * refused before the call is made.
 */
function needsChange(config, plan) {
  if (plan.verdict !== 'ORDER') return false;
  const have = currentModels(config);
  return have.primary !== plan.primary
    || JSON.stringify(have.fallbacks) !== JSON.stringify(plan.fallbacks)
    || hasAllowlist(config);
}

/** A copy of `config` set to the plan's models, everything else (OpenClaw's own additions included) kept. */
function withModels(config, plan) {
  const next = JSON.parse(JSON.stringify(config || {}));
  next.agents = next.agents && typeof next.agents === 'object' ? next.agents : {};
  next.agents.defaults = next.agents.defaults && typeof next.agents.defaults === 'object' ? next.agents.defaults : {};
  next.agents.defaults.model = { ...(next.agents.defaults.model || {}), primary: plan.primary, fallbacks: [...plan.fallbacks] };
  if (next.agents.defaults.modelPolicy && Array.isArray(next.agents.defaults.modelPolicy.allow)) {
    delete next.agents.defaults.modelPolicy.allow;
  }
  return next;
}

function describeModels(m) {
  if (!m.primary) return '(no model set)';
  return m.primary + (m.fallbacks.length ? ` (fallback ${m.fallbacks.join(', then ')})` : ' (no fallback)');
}

/**
 * What to say on the bus. Each problem posts when it first appears and every
 * six hours while it lasts, and once more when it clears. CANNOT TELL posts
 * only once it has lasted over an hour, and while blind nothing is cleared:
 * a switch that cannot be read says nothing about whether a key came back.
 *
 * `waiting` is set when a change is due but OpenClaw was busy, so it was put
 * off to the next wake. That is normal for a pass or two; put off for over an
 * hour it is a change that may never happen, and the bus hears of it.
 *
 * state: { open: { <id>: { text, postedAt } }, blindSince: iso | null, waitingSince: iso | null }
 * Returns { post: [text], cleared: [text], next }.
 */
function planAlarms({ plan, state = {}, now = Date.now(), waiting = '' }) {
  const open = { ...(state.open || {}) };
  const post = [];
  const cleared = [];
  let blindSince = state.blindSince || null;
  const waitingSince = waiting ? (state.waitingSince || new Date(now).toISOString()) : null;

  if (plan.verdict === 'CANNOT_TELL') {
    blindSince = blindSince || new Date(now).toISOString();
    if (now - Date.parse(blindSince) >= BLIND_MS) {
      const prev = open['cannot-tell'];
      if (!prev || now - Date.parse(prev.postedAt) >= REPEAT_MS) {
        const text = `CANNOT TELL whether OpenClaw on the Mini follows the AI switch, since ${blindSince}: ${plan.why}. OpenClaw keeps the order it has.`;
        post.push(text);
        open['cannot-tell'] = { text, postedAt: new Date(now).toISOString() };
      }
    }
    return { post, cleared, next: { open, blindSince, waitingSince: state.waitingSince || null } };
  }

  blindSince = null;
  const findings = [...(plan.problems || [])];
  if (waitingSince && now - Date.parse(waitingSince) >= BLIND_MS) {
    findings.push({ id: 'waiting', text: `OpenClaw on the Mini has not followed the AI switch since ${waitingSince}: ${waiting}.` });
  }
  if (plan.verdict === 'NO_USABLE') {
    findings.push({ id: 'no-usable', text: `OpenClaw on the Mini cannot follow the AI switch: ${plan.why}.` });
  }
  const seen = new Set();
  for (const f of findings) {
    seen.add(f.id);
    const prev = open[f.id];
    if (!prev || now - Date.parse(prev.postedAt) >= REPEAT_MS) {
      post.push(f.text);
      open[f.id] = { text: f.text, postedAt: new Date(now).toISOString() };
    }
  }
  for (const id of Object.keys(open)) {
    if (seen.has(id)) continue;
    if (id !== 'cannot-tell') cleared.push(`Cleared: ${open[id].text}`);
    else cleared.push('Cleared: the AI switch can be read again, and OpenClaw follows it.');
    delete open[id];
  }
  return { post, cleared, next: { open, blindSince, waitingSince } };
}

function renderMessage({ post, cleared, node, change }) {
  const lines = ['[OpenClaw follows the AI switch] ' + (node ? `on ${node}` : '')];
  if (change) lines.push(change);
  for (const t of post) lines.push(`- ${t}`);
  for (const t of cleared) lines.push(`- ${t}`);
  return lines.join('\n');
}

/** 0 in step (or changed), 1 a provider was left out or nothing is usable, 2 CANNOT TELL. */
function exitCode(plan) {
  if (plan.verdict === 'CANNOT_TELL') return 2;
  if (plan.verdict === 'NO_USABLE' || (plan.problems && plan.problems.length)) return 1;
  return 0;
}

/**
 * What the pass does with lib/nodeRoles.js's verdict on the openclaw role.
 *
 * Only 'other-node' is a quiet skip: another machine really does own it. A
 * machine that cannot tell which node it is ('unidentified') or a role nobody
 * registered ('unknown-role') is CANNOT TELL, exit 2, said out loud — the Mini
 * losing its ~/.alphire-node file must not read as "another machine follows
 * the switch" while nothing does (CLAUDE.md: a machine whose name is not
 * recognised does not quietly skip; it refuses out loud).
 */
function roleGate(role) {
  if (role && role.owned) return { run: true, exitCode: 0, lines: [] };
  if (role && role.verdict === 'other-node') {
    return { run: false, exitCode: 0, lines: [`not this machine's job — lib/nodeRoles.js gives openclaw to ${role.owner}.`] };
  }
  const message = String((role && role.message) || 'lib/nodeRoles.js gave no verdict on the openclaw role.');
  return {
    run: false,
    exitCode: 2,
    lines: ['CANNOT TELL whether this machine should follow the AI switch, so OpenClaw is left as it is.', ...message.split('\n')],
  };
}

/** Key NAMES holding a non-empty value in an env file's text. Values are never returned. */
function keyNamesIn(text) {
  const names = new Set();
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && m[2].trim().replace(/^(['"])(.*)\1$/, '$2')) names.add(m[1]);
  }
  return names;
}

module.exports = {
  MAP_FILE,
  OUTREACH_GROUP,
  REPEAT_MS,
  BLIND_MS,
  loadMap,
  pickOrder,
  planModels,
  currentModels,
  needsChange,
  withModels,
  describeModels,
  planAlarms,
  renderMessage,
  exitCode,
  roleGate,
  keyNamesIn,
};
