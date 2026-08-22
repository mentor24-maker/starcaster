#!/usr/bin/env node
'use strict';

/**
 * Every AI generation call must record what it cost.
 *
 * Token logging was lost on 2026-08-17 when the Dev Agent was removed (PR #300)
 * — it lived inside that feature's persona wrapper. Restoring it inside
 * lib/aiClient.js looked like the fix, but only 2 of the repo's 15 model call
 * sites use that client; the rest hand-rolled a fetch(). A meter there would
 * have reported a few percent of the bill and looked complete, which is worse
 * than no meter at all: the operator watches this number to know whether an AI
 * feature is spending money he needs for groceries.
 *
 * So the rule is structural, not stylistic: a file that calls a generation
 * endpoint must also reference recordAiUsage() from lib/aiUsage.js. This check
 * cannot prove the call is placed correctly — only that it exists. The tests in
 * scripts/builder/aiUsage.test.js cover the placement's behaviour.
 *
 * Model-listing and key-verification endpoints are deliberately exempt: they
 * consume no tokens. They are listed explicitly rather than pattern-guessed, so
 * adding a new one is a visible decision.
 *
 * Usage: node scripts/check_ai_metering.cjs [--all] [--report]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['lib', 'routes'];
const METER = 'recordAiUsage';

// Endpoints that generate tokens, and therefore cost money.
const GENERATION_PATTERNS = [
  { provider: 'anthropic', re: /api\.anthropic\.com\/v1\/messages/ },
  { provider: 'openai', re: /api\.openai\.com\/v1\/chat\/completions/ },
  { provider: 'openai', re: /api\.openai\.com\/v1\/responses/ },
  { provider: 'gemini', re: /generativelanguage\.googleapis\.com[^\n'"`]*generateContent/ },
];

// Files exempt from the rule, each with the reason. A path lands here only
// because it provably spends no tokens — never because wiring it was awkward.
const EXEMPT = new Map([
  ['lib/aiUsage.js', 'the meter itself'],
  ['lib/credentialVerify.js', 'GET /v1/models only — key verification, no generation'],
  ['routes/observe.js', 'GET /v1/models only — lists available models for the UI'],
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

function main() {
  const report = process.argv.includes('--report');
  const files = SCAN_DIRS
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => walk(dir));

  const metered = [];
  const missing = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');

    const providers = [...new Set(
      GENERATION_PATTERNS.filter((p) => p.re.test(source)).map((p) => p.provider)
    )];
    if (!providers.length) continue;

    if (EXEMPT.has(rel)) continue;
    if (source.includes(METER)) metered.push({ rel, providers });
    else missing.push({ rel, providers });
  }

  if (report || !missing.length) {
    console.log(`AI metering: ${metered.length} call site${metered.length === 1 ? '' : 's'} recording token usage`);
    for (const { rel, providers } of metered.sort((a, b) => a.rel.localeCompare(b.rel))) {
      console.log(`  ok  ${rel}  (${providers.join(', ')})`);
    }
    for (const [rel, why] of EXEMPT) {
      if (rel === 'lib/aiUsage.js') continue;
      console.log(`  --  ${rel}  exempt: ${why}`);
    }
  }

  if (missing.length) {
    console.error(`\nAI metering FAILED — ${missing.length} generation call site${missing.length === 1 ? '' : 's'} with no usage recording:\n`);
    for (const { rel, providers } of missing) {
      console.error(`  ${rel}  calls ${providers.join(', ')} but never calls ${METER}()`);
    }
    console.error(`
Fix: require the meter and call it right after the response is parsed.

    const { recordAiUsage } = require('./aiUsage');
    ...
    await recordAiUsage({
      provider: 'anthropic',          // 'anthropic' | 'openai' | 'gemini'
      model,                          // the id that actually ran
      feature: 'what_spent_this',     // shows up in Observe as the spender
      body,                           // parsed provider response
      scope,                          // project scope, when the function has one
    });

If the endpoint genuinely cannot spend tokens (a /v1/models listing, a key
check), add it to EXEMPT in this file with the reason — do not drop the call.
`);
    process.exit(1);
  }

  process.exit(0);
}

main();
