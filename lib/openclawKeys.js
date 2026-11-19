'use strict';

/**
 * What `npm run ai-keys` says about OpenClaw on the Mini (SC-873).
 *
 * Until 2026-11-19 the check read ONE line of ~/.openclaw/.env,
 * ANTHROPIC_API_KEY, and said nothing about which model OpenClaw was on. SC-871
 * put OpenAI first and Anthropic second, so the key OpenClaw actually spends
 * from went unchecked, and a Mini whose openclaw.json had drifted from the
 * committed list (lib/openclawModels.json) looked exactly like one that had not.
 *
 * This file is the pure half: it takes the TEXT of the two files on the Mini
 * (or the reason one could not be read) plus the committed list, and returns
 *   entries  — one per provider key, for lib/aiKeys.js checkKeys()
 *   model    — the line naming OpenClaw's primary model and fallbacks
 *   findings — drift from the repo, and keys the model list needs but the
 *              .env lacks, each a sentence
 *   blind    — sentences for what could not be read (CANNOT TELL, never a pass)
 * scripts/ai_keys_check.mjs reads the files and prints.
 *
 * NO VALUE IS EVER RETURNED IN TEXT. Values ride only in `entries[].key`, which
 * checkKeys turns into a fingerprint (docs/DOCTRINE.md §4.1).
 */

const ENV_PATH_TEXT = '~/.openclaw/.env';
const CONFIG_PATH_TEXT = '~/.openclaw/openclaw.json';

/** The setting each provider's key goes by, from the committed list and the switch. */
function providerKeyNames(committedKeys = {}) {
  const out = { ...committedKeys };
  try {
    const { AI_PROVIDERS } = require('./aiClient');
    for (const def of Object.values(AI_PROVIDERS)) {
      if (def && def.id && def.keyEnv && !out[def.id]) out[def.id] = def.keyEnv;
    }
  } catch {
    // The committed list alone still covers every provider OpenClaw is set to use.
  }
  return out;
}

/** KEY=value lines, quotes and `export` stripped. Never logged. */
function parseEnv(text) {
  const values = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    values[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

/**
 * OpenClaw's model setting out of openclaw.json: `agents.defaults.model`, which
 * OpenClaw accepts as a string or as { primary, fallbacks }.
 * Returns { primary, fallbacks } or { unreadable }.
 */
function liveModels(configText) {
  let config;
  try { config = JSON.parse(String(configText)); } catch (err) {
    return { unreadable: `${CONFIG_PATH_TEXT} is not JSON this check can read (${String(err?.message || err).slice(0, 80)})` };
  }
  const model = config?.agents?.defaults?.model;
  if (typeof model === 'string' && model.trim()) return { primary: model.trim(), fallbacks: [] };
  if (model && typeof model === 'object' && typeof model.primary === 'string' && model.primary.trim()) {
    const fallbacks = Array.isArray(model.fallbacks) ? model.fallbacks.map((f) => String(f).trim()).filter(Boolean) : [];
    return { primary: model.primary.trim(), fallbacks };
  }
  return { unreadable: `${CONFIG_PATH_TEXT} names no model (agents.defaults.model is missing)` };
}

/** "openai/gpt-5.5 (fallback anthropic/claude-sonnet-5-5)" — the installer's own wording. */
function modelText({ primary, fallbacks }) {
  return primary + (fallbacks.length ? ` (fallback ${fallbacks.join(', then ')})` : ' (no fallback)');
}

/** "OpenAI", "Anthropic" — the switch's own name for a provider, or its id. */
function labelFor(provider) {
  try { return require('./aiClient').AI_PROVIDERS[provider]?.label || provider; } catch { return provider; }
}

const providerOf = (ref) => {
  const m = /^([a-z0-9-]+)\/\S+$/.exec(String(ref || ''));
  return m ? m[1] : null;
};

/**
 * Everything the check says about OpenClaw.
 *
 *   envText     — the .env file's text, or null when it could not be read
 *   envError    — why it could not be read (said on the CANNOT TELL rows)
 *   configText  — openclaw.json's text, or null when it could not be read
 *   configError — why
 *   committed   — lib/openclawModels.js load(), or { unreadable }
 *   committedKeys — the list's `keys` map (provider → setting name)
 */
function openclawReport({ envText = null, envError = '', configText = null, configError = '', committed, committedKeys = {} }) {
  const findings = [];
  const blind = [];

  // Which model OpenClaw is on, and whether it matches the repo.
  let live = null;
  let model;
  if (configText == null) {
    blind.push(`OpenClaw model: CANNOT TELL — ${configError || `${CONFIG_PATH_TEXT} could not be read`}.`);
    model = null;
  } else {
    live = liveModels(configText);
    if (live.unreadable) {
      blind.push(`OpenClaw model: CANNOT TELL — ${live.unreadable}.`);
      live = null;
      model = null;
    } else {
      model = `OpenClaw model: ${modelText(live)}   (${CONFIG_PATH_TEXT})`;
    }
  }
  if (!committed || committed.unreadable) {
    blind.push(`Whether the Mini matches the repo: CANNOT TELL — lib/openclawModels.json could not be read (${committed?.unreadable || 'no list'}).`);
  } else if (live) {
    const same = live.primary === committed.primary
      && live.fallbacks.length === committed.fallbacks.length
      && live.fallbacks.every((f, i) => f === committed.fallbacks[i]);
    if (!same) {
      findings.push(`DRIFT: the Mini has drifted from the repo — ${CONFIG_PATH_TEXT} says ${modelText(live)}, `
        + `lib/openclawModels.json says ${modelText(committed)}. Run scripts/install_openclaw.sh on the Mini to put it back.`);
    }
  }

  // Which provider keys to check: every provider either model list names
  // (those are NEEDED), then any other known provider key the .env holds.
  const names = providerKeyNames(committedKeys);
  const needed = [];
  const order = [
    ...(committed && !committed.unreadable ? committed.order : []),
    ...(live ? [live.primary, ...live.fallbacks] : []),
  ];
  for (const ref of order) {
    const provider = providerOf(ref);
    if (provider && !needed.includes(provider)) needed.push(provider);
  }

  const values = envText == null ? null : parseEnv(envText);
  const extra = values
    ? Object.keys(names).filter((p) => !needed.includes(p) && String(values[names[p]] || '').trim())
    : [];

  const entries = [];
  for (const provider of [...needed, ...extra]) {
    const keyEnv = names[provider] || '';
    const base = {
      id: `openclaw-${provider}`,
      provider,
      label: labelFor(provider),
      place: `the Mini's OpenClaw (${ENV_PATH_TEXT})`,
      job: needed.includes(provider)
        ? `the Mini — OpenClaw (${provider} is in its model list): outreach posting, sign-in checks, Reddit and Substack passes`
        : `nothing right now: ${provider} is not in OpenClaw's model list`,
      source: `${ENV_PATH_TEXT} ${keyEnv || '(no setting name known)'}`,
    };
    if (values == null) {
      entries.push({ ...base, unreadable: envError || `${ENV_PATH_TEXT} could not be read` });
      continue;
    }
    if (!keyEnv) {
      entries.push({ ...base, unreadable: `OpenClaw's model list names ${provider}, but nothing says which setting holds its key` });
      continue;
    }
    const key = String(values[keyEnv] || '').trim();
    if (!key && needed.includes(provider)) {
      // Reported, never skipped: OpenClaw will try this provider and fail.
      entries.push({ ...base, key: '', keyEnv });
      findings.push(`MISSING: OpenClaw's model list uses ${provider}, but ${ENV_PATH_TEXT} has no ${keyEnv}. `
        + 'Run scripts/install_openclaw.sh on the Mini to copy it from Doppler prd.');
      continue;
    }
    entries.push({ ...base, key, keyEnv });
  }

  return { entries, model, findings, blind, needed };
}

/** Pairs to compare: each OpenClaw key with the website's key for the same provider. */
function comparePairs(entries) {
  return entries.map((e) => [`website-${e.provider}`, e.id]);
}

/**
 * The script's exit, folding OpenClaw's findings into the keys' own code:
 * a drift or a missing key is a finding (1), an unreadable file is blind (2),
 * and 1 outranks 2, the same rule lib/aiKeys.js exitCode() keeps.
 */
function exitCode(keysCode, report) {
  if (keysCode === 1 || (report && report.findings.length)) return 1;
  if (keysCode === 2 || (report && report.blind.length)) return 2;
  return keysCode;
}

module.exports = { openclawReport, comparePairs, exitCode, parseEnv, liveModels, modelText, providerKeyNames };
