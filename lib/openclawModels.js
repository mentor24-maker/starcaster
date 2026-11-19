'use strict';

/**
 * OpenClaw's models on the Mini, in the order it tries them (SC-871).
 *
 * ONE list, lib/openclawModels.json, read by scripts/install_openclaw.sh
 * (which writes it into ~/.openclaw/openclaw.json and copies the matching keys
 * from Doppler prd) and by anything that needs to say which model OpenClaw is
 * on. Until 2026-11-18 the installer named a single Anthropic model, so the day
 * that key ran out of credit, outreach posting stopped; the fix was made by
 * hand on the Mini and a rebuilt Mini would have gone straight back.
 *
 * Every model is `provider/model`, and every provider used must name the
 * Doppler key that pays for it, or the installer would set OpenClaw up to call
 * a provider it holds no key for. `load()` refuses such a list.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'openclawModels.json');

function providerOf(ref) {
  const m = /^([a-z0-9-]+)\/(\S+)$/.exec(String(ref || ''));
  return m ? m[1] : null;
}

/** Throws, naming the problem, when the list cannot be used as written. */
function validate(list) {
  const problems = [];
  if (!list || typeof list !== 'object') throw new Error('openclawModels: the list is not an object');
  const fallbacks = Array.isArray(list.fallbacks) ? list.fallbacks : null;
  if (!fallbacks) problems.push('"fallbacks" must be a list (empty is fine)');
  const order = [list.primary, ...(fallbacks || [])];
  const keys = list.keys && typeof list.keys === 'object' ? list.keys : {};
  const seen = new Set();
  for (const ref of order) {
    const provider = providerOf(ref);
    if (!provider) { problems.push(`"${ref}" is not provider/model`); continue; }
    if (seen.has(ref)) problems.push(`"${ref}" is listed twice`);
    seen.add(ref);
    if (!/^[A-Z][A-Z0-9_]*$/.test(String(keys[provider] || ''))) {
      problems.push(`"${ref}" needs a key, and "keys" names none for ${provider}`);
    }
  }
  if (problems.length) throw new Error(`openclawModels: ${problems.join('; ')}`);
  return list;
}

/** The list, checked. `primary`, `fallbacks`, `order` and `keysNeeded` (unique, in order). */
function load(file = FILE) {
  const list = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  const order = [list.primary, ...list.fallbacks];
  const keysNeeded = [...new Set(order.map((ref) => list.keys[providerOf(ref)]))];
  return { primary: list.primary, fallbacks: [...list.fallbacks], order, keysNeeded };
}

module.exports = { load, validate, providerOf, FILE };
