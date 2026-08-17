'use strict';

/**
 * Shared AI client — Gemini, Anthropic and OpenAI behind one interface, with
 * API keys resolved from Settings > APIs, falling back to env vars.
 *
 * Was `lib/rogerClient.js` until 2026-08-16. The name was a historical accident:
 * it grew out of the Roger Thorson agent-team experiment (archived — see
 * archive/roger-thorson/README.md) but the provider helpers underneath were
 * always general-purpose, and Contacts and the tweet OCR path depend on them.
 * The persona wrapper `queryAgentPersona()` went with the Dev Agent on
 * 2026-08-17; nothing else ever called it.
 *
 * Two things to know before adding a caller:
 *
 *  - `queryGemini()` hardcodes `responseMimeType: "application/json"`, so every
 *    Gemini call through here is forced to return JSON. Callers that want prose
 *    have to ask for it in the prompt and hope. That is the main reason a dozen
 *    other modules hand-rolled their own fetch() rather than reuse this file
 *    (see lib/altTextProviders.js, which says so in its own header).
 *  - **Token usage is reported from here, but this file is not the meter.**
 *    Logging was restored on 2026-08-17 — see lib/aiUsage.js. It is wired in
 *    beside every provider `fetch()` in the repo rather than only here, because
 *    only two call sites use this client and metering just these would have
 *    reported a few percent of the bill while looking complete.
 *
 * Folding the scattered callers back in here — with JSON opt-in per call — is
 * still the open follow-up. `npm run check:ai-metering` keeps the meter honest
 * in the meantime: it fails when a generation call has no usage recording next
 * to it.
 *
 * Callers should pass `feature` (what is spending) and `scope` (which tenant)
 * in extraOptions. Both default to unattributed rather than failing.
 */

const { getProviderValues } = require('./apiSettings');
const { recordAiUsage } = require('./aiUsage');

async function queryGemini(systemPrompt, messagesOrPrompt, extraOptions = {}) {
  const cfg = getProviderValues('gemini');
  const apiKey = String(cfg.api_key || process.env.GEMINI_API_KEY || '').trim();
  
  if (!apiKey) {
    return { ok: false, error: "Missing Gemini API Key. Configure it in Settings > APIs > Google Gemini AI." };
  }

  const model = extraOptions.model || 'gemini-2.5-pro';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let contents = [];
  if (Array.isArray(messagesOrPrompt)) {
    contents = messagesOrPrompt.map(msg => {
      const parts = [{ text: String(msg.text || msg.content || '') }];
      if (msg.inlineData) {
        parts.push({ inlineData: msg.inlineData });
      }
      return {
        role: msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });
  } else {
    contents = [
      {
        role: 'user',
        parts: [{ text: String(messagesOrPrompt || '') }]
      }
    ];
  }

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseMimeType: "application/json"
    }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  const data = await res.json();
  
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || "Gemini API error", status: res.status };
  }

  const outputText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const tokens = data?.usageMetadata?.totalTokenCount || 0;
  await recordAiUsage({
    provider: 'gemini',
    model,
    feature: extraOptions.feature,
    body: data,
    scope: extraOptions.scope,
  });
  return { ok: true, text: outputText, tokens, provider: 'gemini' };
}

async function queryAnthropic(systemPrompt, messagesOrPrompt, extraOptions = {}) {
  const cfg = getProviderValues('anthropic');
  const apiKey = String(cfg.api_key || process.env.ANTHROPIC_API_KEY || '').trim();
  
  if (!apiKey) {
    return { ok: false, error: "Missing Anthropic API Key for fallback. Configure it in Settings > APIs." };
  }

  const model = extraOptions.anthropicModel || 'claude-opus-4-8';
  const endpoint = `https://api.anthropic.com/v1/messages`;

  const messages = [];

  if (Array.isArray(messagesOrPrompt)) {
    messagesOrPrompt.forEach(msg => {
      messages.push({
        role: msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user',
        content: String(msg.text || msg.content || '')
      });
    });
  } else {
    messages.push({ role: 'user', content: String(messagesOrPrompt || '') });
  }

  const payload = {
    model,
    system: systemPrompt,
    messages,
    // NOTE: temperature is intentionally omitted. Opus 4.7/4.8 reject any
    // temperature/top_p/top_k with a 400 — steer via prompting instead.
    max_tokens: 4096
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  const data = await res.json();
  
  if (!res.ok) {
    const errorDetails = data && data.error ? JSON.stringify(data.error) : JSON.stringify(data);
    return { ok: false, error: errorDetails || "Anthropic API error", status: res.status };
  }

  const outputText = data?.content?.[0]?.text || '';
  const tokens = (data?.usage?.input_tokens || 0) + (data?.usage?.output_tokens || 0);
  await recordAiUsage({
    provider: 'anthropic',
    model,
    feature: extraOptions.feature,
    body: data,
    scope: extraOptions.scope,
  });
  return { ok: true, text: outputText, tokens, provider: 'anthropic' };
}

async function queryOpenAI(systemPrompt, messagesOrPrompt, extraOptions = {}) {
  const cfg = getProviderValues('openai');
  const apiKey = String(cfg.api_key || process.env.OPENAI_API_KEY || '').trim();
  
  if (!apiKey) {
    return { ok: false, error: "Missing OpenAI API Key for fallback. Configure it in Settings > APIs." };
  }

  const model = 'gpt-4o';
  const endpoint = `https://api.openai.com/v1/chat/completions`;

  const messages = [];
  messages.push({ role: 'system', content: systemPrompt });

  if (Array.isArray(messagesOrPrompt)) {
    messagesOrPrompt.forEach(msg => {
      messages.push({
        role: msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : 'user',
        content: String(msg.text || msg.content || '')
      });
    });
  } else {
    messages.push({ role: 'user', content: String(messagesOrPrompt || '') });
  }

  const payload = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 8192,
    response_format: { type: "json_object" }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  const data = await res.json();
  
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || "OpenAI API error", status: res.status };
  }

  const outputText = data?.choices?.[0]?.message?.content || '';
  const tokens = data?.usage?.total_tokens || 0;
  await recordAiUsage({
    provider: 'openai',
    model,
    feature: extraOptions.feature,
    body: data,
    scope: extraOptions.scope,
  });
  return { ok: true, text: outputText, tokens, provider: 'openai' };
}


module.exports = { queryGemini, queryAnthropic, queryOpenAI };
