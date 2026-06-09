'use strict';

const { getProviderValues } = require('./apiSettings');

async function queryGemini(systemPrompt, messagesOrPrompt, extraOptions = {}) {
  const cfg = getProviderValues('gemini');
  const apiKey = String(
    cfg.api_key
    || process.env.GEMINI_API_KEY
    || process.env.GOOGLE_GEMINI_API_KEY
    || ''
  ).trim();

  if (!apiKey) {
    return { ok: false, error: 'Missing Gemini API key. Configure GEMINI_API_KEY in Settings → APIs or Vercel env vars.' };
  }

  const model = String(extraOptions.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let contents = [];
  if (Array.isArray(messagesOrPrompt)) {
    contents = messagesOrPrompt.map((msg) => {
      const parts = [{ text: String(msg.text || msg.content || '') }];
      if (msg.inlineData) {
        parts.push({ inlineData: msg.inlineData });
      }
      return {
        role: msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });
  } else {
    contents = [{
      role: 'user',
      parts: [{ text: String(messagesOrPrompt || '') }],
    }];
  }

  const generationConfig = {
    temperature: Number(extraOptions.temperature ?? 0.2),
    maxOutputTokens: Number(extraOptions.maxOutputTokens || 8192),
  };
  if (extraOptions.responseMimeType) {
    generationConfig.responseMimeType = extraOptions.responseMimeType;
  }

  const payload = {
    systemInstruction: {
      parts: [{ text: String(systemPrompt || '') }],
    },
    contents,
    generationConfig,
  };

  const timeoutMs = Number(extraOptions.timeoutMs || 60000) || 60000;
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, error: `Gemini request failed: ${err.message}` };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: String(data?.error?.message || 'Gemini API error'),
      status: res.status,
    };
  }

  const outputText = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  const tokens = Number(data?.usageMetadata?.totalTokenCount || 0) || 0;
  return { ok: true, text: outputText, tokens, provider: 'gemini', model };
}

function parseJsonFromModelText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isGeminiConfigured() {
  const cfg = getProviderValues('gemini');
  return Boolean(String(
    cfg.api_key
    || process.env.GEMINI_API_KEY
    || process.env.GOOGLE_GEMINI_API_KEY
    || ''
  ).trim());
}

module.exports = {
  queryGemini,
  parseJsonFromModelText,
  isGeminiConfigured,
};
