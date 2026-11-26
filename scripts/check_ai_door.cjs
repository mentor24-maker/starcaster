#!/usr/bin/env node
'use strict';

/**
 * Every AI generation call goes through the AI door, `generate()` in
 * lib/aiClient.js. No other file may spell a provider's generate address.
 *
 * Why this is a gate and not a habit: from 2026-10-30 one Anthropic account ran
 * out of credit and about twenty features stopped at once, the public sites'
 * AI features among them, while a funded OpenAI key sat unused. Each of those
 * features talked to Anthropic its own way, with its own key lookup and its own
 * model list, so the provider switch on Settings › APIs › AI provider could not
 * reach any of them. AI switch 1 to 5 (SC-843 to SC-847) moved every one of
 * them onto the door. This check stops the next one being written by hand.
 *
 * It reads source, never data: it fails when a file outside the door (and the
 * key and billing checks, which talk to providers about keys and money, not to
 * generate) contains a generate address, imports a provider's SDK, or uses one
 * of the door's old single-provider helpers (queryGemini, queryAnthropic,
 * queryOpenAI, queryKimi). Those helpers live inside lib/aiClient.js but skip
 * the provider order and the fall-through exactly as a raw fetch does, so
 * calling one by name is going round the door (SC-847 review, 2026-11-18:
 * lib/wyrTweetOcr.js called queryGemini and this check said all was well).
 *
 * Usage: node scripts/check_ai_door.cjs [--report] [--root <dir>]
 * (--root scans another tree; the tests use it so a planted break-test file
 * never lands in the real lib/, where a parallel test could read it.)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['lib', 'routes', 'api'];
// Generated server bundles: built from sources that are scanned themselves
// (the CLAUDE.md generated-files table). Skipped BY NAME, never by folder:
// lib/builder also holds hand-written, committed files (document.js, index.js,
// migrate-from-legacy.js, the two stubs), and skipping the whole folder let a
// direct provider call there pass unread (SC-847 review, 2026-11-19).
const SKIP_DIRS = new Set(['lib/site-import/dist']);
const SKIP_FILES = new Set([
  'lib/builder/template.js',
  'lib/builder/email-template.js',
  'lib/builder/template-frame.js',
  'lib/builder/email-render.js',
]);

// The addresses (and SDKs) that GENERATE, and therefore spend. Listing models
// or checking a key is not here: it spends nothing and needs no door.
const GENERATE_PATTERNS = [
  { what: "Anthropic's generate address", re: /api\.anthropic\.com\/v1\/messages/ },
  { what: "OpenAI's generate address", re: /api\.openai\.com\/v1\/(?:chat\/completions|responses|completions)\b/ },
  { what: "Gemini's generate address", re: /generativelanguage\.googleapis\.com[^\n'"`]*(?:generateContent|streamGenerateContent)/ },
  { what: "Kimi's generate address", re: /api\.moonshot\.(?:ai|cn)\/v1\/chat\/completions/ },
  { what: "Anthropic's SDK", re: /require\(\s*['"]@anthropic-ai\/sdk['"]\s*\)|from\s+['"]@anthropic-ai\/sdk['"]/ },
  { what: "OpenAI's SDK", re: /require\(\s*['"]openai['"]\s*\)|from\s+['"]openai['"]/ },
  { what: "Google's AI SDK", re: /require\(\s*['"]@google\/(?:generative-ai|genai)['"]\s*\)|from\s+['"]@google\/(?:generative-ai|genai)['"]/ },
];

// The door's old one-provider helpers. They sit inside lib/aiClient.js, so a
// file using them names no address at all, yet each one talks to a single
// provider by name: no provider order, no fall-through, no switch. Matched on
// code lines only (a comment explaining them is not a call).
const HELPER_PATTERNS = [
  { what: 'the one-provider helper queryGemini (Gemini only)', re: /\bqueryGemini\b/ },
  { what: 'the one-provider helper queryAnthropic (Anthropic only)', re: /\bqueryAnthropic\b/ },
  { what: 'the one-provider helper queryOpenAI (OpenAI only)', re: /\bqueryOpenAI\b/ },
  { what: 'the one-provider helper queryKimi (Kimi only)', re: /\bqueryKimi\b/ },
];

function isCommentLine(text) {
  return /^\s*(?:\/\/|\/\*|\*)/.test(text);
}

// The door itself, and the three files that talk to providers about KEYS and
// BILLING. Each spells a provider address to ask "does this key work?" or
// "how much credit is left?", which the door cannot answer for them.
const ALLOWED = new Map([
  ['lib/aiClient.js', 'the AI door itself'],
  ['lib/aiKeys.js', 'the key check (npm run ai-keys): one tiny request per provider to classify its key'],
  ['lib/credentialVerify.js', 'credential verification: lists models to prove a key works'],
  ['lib/anthropicBilling.js', "reads Anthropic's billing, not a generate call"],
]);

// Files that still call a provider by hand, each with why and the ticket that
// moves it. A file lands here only when the door cannot yet do what it needs;
// the list is meant to shrink to nothing, and the check prints it every run so
// nobody forgets it is there.
const WAITING = new Map([
  ['lib/themeWizardGenerator.js',
    "the Theme Wizard has the AI read web pages itself and answer in an exact JSON shape, which the door"
    + ' cannot do yet, and it asks for claude-fable-5 by name for design taste (door: SC-897, move: SC-898)'],
  ['lib/eventHarvest.js',
    'the schedule upload has the AI read a PDF or photo of the flyer; the door can send those now (SC-895)'
    + ' and the move is SC-896'],
  ['lib/wyrTweetOcr.js',
    'the Would You Rather import has the AI read the words off a post image with the Gemini-only helper'
    + ' queryGemini; the door can send pictures now (SC-895) and the move rides with SC-896'],
]);

function walk(dir, root = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(rel)) walk(full, root, out);
    } else if (SKIP_FILES.has(rel)) {
      continue;
    } else if (/\.(?:c|m)?[jt]s$/.test(entry.name) && !/\.test\.[cm]?[jt]s$/.test(entry.name)) {
      out.push({ full, rel });
    }
  }
  return out;
}

/** Every file outside the door that names a generate address or a one-provider helper: [{ rel, line, what }]. */
function findViolations(root = ROOT) {
  const found = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const { full } of walk(abs, root)) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (ALLOWED.has(rel) || WAITING.has(rel)) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((text, index) => {
        for (const p of GENERATE_PATTERNS) {
          if (p.re.test(text)) found.push({ rel, line: index + 1, what: p.what });
        }
        if (isCommentLine(text)) return;
        for (const p of HELPER_PATTERNS) {
          if (p.re.test(text)) found.push({ rel, line: index + 1, what: p.what });
        }
      });
    }
  }
  return found;
}

function main(argv = process.argv.slice(2)) {
  const report = argv.includes('--report');
  const rootAt = argv.indexOf('--root');
  const root = rootAt === -1 ? ROOT : path.resolve(argv[rootAt + 1] || '');
  if (rootAt !== -1 && !(argv[rootAt + 1] && fs.existsSync(root))) {
    console.error(`AI door: cannot read --root ${argv[rootAt + 1] || '(missing)'}`);
    return 2;
  }
  const found = findViolations(root);
  if (!found.length) {
    console.log(WAITING.size
      ? `AI door: every AI generation call goes through generate() in lib/aiClient.js, except the ${WAITING.size} file(s) still waiting below`
      : 'AI door: every AI generation call goes through generate() in lib/aiClient.js');
    if (report) for (const [rel, why] of ALLOWED) console.log(`  allowed  ${rel}  (${why})`);
    for (const [rel, why] of WAITING) console.log(`  waiting  ${rel}  still calls a provider by hand: ${why}`);
    return 0;
  }
  console.error(`AI door FAILED: ${found.length} AI call${found.length === 1 ? '' : 's'} that go${found.length === 1 ? 'es' : ''} round the door:\n`);
  for (const f of found) console.error(`  ${f.rel}:${f.line}  names ${f.what}`);
  console.error(`
Use generate() from lib/aiClient.js instead. It uses whichever provider comes
first on Settings › APIs › AI provider, falls through when one is out of credit,
and meters the spend under your feature's name:

    const aiClient = require('./aiClient');
    const reply = await aiClient.generate({
      feature: 'what_spent_this',   // shows up on Observe as the spender
      tier: 'strong',               // or 'fast'; never a model by name
      system, messages: prompt, maxTokens, scope,
    });
    if (!reply.ok) return { ok: false, error: reply.error };
    // reply.text (and reply.json with json: true), reply.providerLabel

Why: on 2026-10-30 one account's credit ran out and every feature that called a
provider its own way stopped at once (docs/DOCTRINE.md, "AI calls go through the door").`);
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = { findViolations, main, SKIP_FILES, GENERATE_PATTERNS, HELPER_PATTERNS, ALLOWED, WAITING };
