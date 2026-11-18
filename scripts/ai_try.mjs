#!/usr/bin/env node
// Send ONE tiny request through the AI door (lib/aiClient.js generate()) and
// say which provider and model answered, or each provider's reason when none
// could (AI switch 1, SC-843).
//
//   node scripts/ai_try.mjs                 # the "fast" tier, plain prose
//   node scripts/ai_try.mjs --tier strong   # the "strong" tier
//   node scripts/ai_try.mjs --json          # ask for JSON, and show it parsed
//
// It needs the provider keys in its environment, so run it inside Doppler:
//   doppler run --project starcaster --config prd -- node scripts/ai_try.mjs
//
// Read-only apart from the one metered call (feature "ai-try"), which shows on
// Observe › AI spend like any other. It never prints a key.
//
// Exit codes follow scripts/ui/harness-exit.mjs: 0 a provider answered, 1 a
// provider refused the request itself, 2 no provider could answer at all.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generate, getAiProviderOrder } = require('../lib/aiClient.js');

const args = process.argv.slice(2);
const tierAt = args.indexOf('--tier');
const tier = tierAt >= 0 ? args[tierAt + 1] : 'fast';
const json = args.includes('--json');

const { providers, source, ignored } = getAiProviderOrder();
console.log(`order (${source === 'default' ? 'the built-in default' : 'from AI_PROVIDER_ORDER'}): ${providers.map((p) => `${p.id} (${p.models[tier] || '?'})`).join(' → ') || '(none)'}`);
if (ignored.length) console.log(`ignored, not providers this door knows: ${ignored.join(', ')}`);

const result = await generate({
  feature: 'ai-try',
  tier,
  json,
  maxTokens: 300,
  timeoutMs: 45000,
  system: 'You are a connectivity check. Keep the answer under ten words.',
  messages: json ? 'Return {"ok": true, "who": "<your model name>"}.' : 'Say hello and name the model you are.',
});

for (const s of result.skipped || []) console.log(`skipped ${s.label}: ${s.verdict} — ${s.reason}`);

if (result.ok) {
  console.log(`answered by ${result.provider} (${result.model}), finish: ${result.stopReason || 'unknown'}`);
  console.log(`reply: ${json ? JSON.stringify(result.json) : JSON.stringify(result.text)}`);
  process.exit(0);
}
console.log(`NOT ANSWERED (${result.code}): ${result.error}`);
process.exit(result.code === 'no_provider' ? 2 : 1);
