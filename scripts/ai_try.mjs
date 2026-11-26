#!/usr/bin/env node
// Send ONE tiny request through the AI door (lib/aiClient.js generate()) and
// say which provider and model answered, or each provider's reason when none
// could (AI switch 1, SC-843).
//
//   node scripts/ai_try.mjs                 # the "fast" tier, plain prose
//   node scripts/ai_try.mjs --tier strong   # the "strong" tier
//   node scripts/ai_try.mjs --json          # ask for JSON, and show it parsed
//   node scripts/ai_try.mjs --feature seo_alt_text   # ask as that feature: its group's order (SC-872)
//
// The order comes from Settings › APIs › AI provider (AI switch 2, SC-844),
// or AI_PROVIDER_ORDER when nothing is saved there or it cannot be read.
//
// It needs the provider keys in its environment, so run it inside Doppler:
//   doppler run --project starcaster --config prd -- node scripts/ai_try.mjs
//
// Read-only apart from the one metered call (feature "ai-try", or the one named
// by --feature), which shows on Observe › AI spend like any other. It never
// prints a key.
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
// The connectivity check's own feature name, in the "Everything else" group.
const DEFAULT_FEATURE = 'ai-try';
const featureAt = args.indexOf('--feature');
const feature = featureAt >= 0 ? String(args[featureAt + 1] || '').trim() : DEFAULT_FEATURE;
if (!feature || feature.startsWith('--')) {
  console.log('--feature needs a feature name, e.g. --feature seo_alt_text (the names are in lib/aiFeatureGroups.js)');
  process.exit(2);
}

const { providers, source, ignored, fallbackReason, group, orderUsed, groupNote } = await getAiProviderOrder({ feature });
console.log(`feature: ${feature}`);
console.log(`group: ${group ? group.label : '(none — this feature is in no group)'}, using ${orderUsed === 'group' ? 'its own order' : 'the main order'}`);
if (groupNote) console.log(`why: ${groupNote}`);
const from = source === 'settings' ? (orderUsed === 'group' ? 'from Settings › APIs, this group\'s own' : 'from Settings › APIs') : source === 'default' ? 'the built-in default' : 'from AI_PROVIDER_ORDER';
console.log(`order (${from}): ${providers.map((p) => `${p.id} (${p.models[tier] || '?'})`).join(' → ') || '(none)'}`);
if (fallbackReason) console.log(`not using Settings › APIs: ${fallbackReason}`);
if (ignored.length) console.log(`ignored, not providers this door knows: ${ignored.join(', ')}`);

const result = await generate({
  feature: feature || DEFAULT_FEATURE,
  tier,
  json,
  maxTokens: 300,
  timeoutMs: 45000,
  system: 'You are a connectivity check. Keep the answer under ten words.',
  messages: json ? 'Return {"ok": true, "who": "<your model name>"}.' : 'Say hello and name the model you are.',
});

for (const s of result.skipped || []) console.log(`skipped ${s.label}: ${s.verdict} — ${s.reason}`);

if (result.ok) {
  console.log(`answered by: ${result.providerLabel} (${result.model}), finish: ${result.stopReason || 'unknown'}`);
  console.log(`reply: ${json ? JSON.stringify(result.json) : JSON.stringify(result.text)}`);
  process.exit(0);
}
console.log(`NOT ANSWERED (${result.code}): ${result.error}`);
process.exit(result.code === 'no_provider' ? 2 : 1);
