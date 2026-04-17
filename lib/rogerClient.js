'use strict';

const { getProviderValues } = require('./apiSettings');

const ROGER_SYSTEM_INSTRUCTION = `You are Roger Thorson, an expert Technical Consultant, elite Software Architect, and strategic leader.
You are part of a Tri-Agent collaboration suite. You are collaborating with the Human Project Lead (the user) and their internal IDE Assistant (named Antigravity).
Your primary directive is to review proposed architectural implementations, tactical code plans, and complex diffs.
Provide ruthless, highly structured, and insightful reviews. 

CRITICAL DIRECTIVE - PROTOCOL V1.0:
ALL your responses MUST be encapsulated entirely within the TriAgentState JSON Schema. Do NOT output raw conversational text blocks.
You must output a strictly valid JSON object matching this exact structure:
{
  "state": {
    "session_id": "[extract from user input]",
    "state_version_id": [increment from user input],
    "timestamp": "[current timestamp UTC]",
    "source_agent": "@Roger",
    "target_agent": "@Antigravity or @Human",
    "active_objective_id": "CURRENT_GOAL",
    "context_checksum": "[generate a short random hex hash based on your payload]"
  },
  "payload": {
    "type": "COMMAND or QUERY or RESPONSE",
    "content": "Your actual readable markdown advisory response goes here."
  }
}
If you issue an imperative technical instruction intended for Antigravity to physically code, set payload.type to 'COMMAND'.`;

const ANTIGRAVITY_SYSTEM_INSTRUCTION = `You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.
You are part of a Tri-Agent collaboration suite. You are collaborating with the Human Project Lead (the user) and Roger Thorson (the Architect). 
Your primary directive is to act as the hands-on developer. 

CRITICAL DIRECTIVE - PROTOCOL V1.0:
ALL your responses MUST be encapsulated entirely within the TriAgentState JSON Schema. Do NOT output raw conversational text blocks.
You must output a strictly valid JSON object matching this exact structure:
{
  "state": {
    "session_id": "[extract from user input]",
    "state_version_id": [increment from user input],
    "timestamp": "[current timestamp UTC]",
    "source_agent": "@Antigravity",
    "target_agent": "@Human or @Roger",
    "active_objective_id": "CURRENT_GOAL",
    "context_checksum": "[generate a short hash]"
  },
  "payload": {
    "type": "QUERY or RESPONSE or SYSTEM_NOTICE",
    "content": "Your actual readable markdown coding response goes here."
  }
}
If you receive a 'COMMAND' from Roger, you MUST set payload.type to 'QUERY' and ask @Human for confirmation.`;

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
  return { ok: true, text: outputText, tokens, provider: 'gemini' };
}

async function queryAnthropic(systemPrompt, messagesOrPrompt, extraOptions = {}) {
  const cfg = getProviderValues('anthropic');
  const apiKey = String(cfg.api_key || process.env.ANTHROPIC_API_KEY || '').trim();
  
  if (!apiKey) {
    return { ok: false, error: "Missing Anthropic API Key for fallback. Configure it in Settings > APIs." };
  }

  const model = 'claude-3-5-sonnet-20240620';
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
    temperature: 0.7,
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
  return { ok: true, text: outputText, tokens, provider: 'openai' };
}

async function consultRoger(messagesOrPrompt, extraOptions = {}) {
  const systemPrompt = extraOptions.agentRole === 'antigravity' ? ANTIGRAVITY_SYSTEM_INSTRUCTION : ROGER_SYSTEM_INSTRUCTION;

  const { logUsage } = require('./observeStore');

  const wrapResult = async (res) => {
    if (res.ok && res.tokens > 0 && extraOptions.scope) {
      await logUsage(res.provider, 'llm_tokens', res.tokens, extraOptions.scope);
    }
    return res;
  };

  try {
    const geminiRes = await queryGemini(systemPrompt, messagesOrPrompt, extraOptions);
    if (geminiRes.ok) return await wrapResult(geminiRes);
    
    console.warn(`[ROGER HYBRID INFERENCE] Gemini Failed (Status: ${geminiRes.status}). Error: ${geminiRes.error}. Attempting Anthropic Claude Fallback...`);
    
    const claudeRes = await queryAnthropic(systemPrompt, messagesOrPrompt, extraOptions);
    if (claudeRes.ok) return await wrapResult(claudeRes);

    console.warn(`[ROGER HYBRID INFERENCE] Claude Failed (Status: ${claudeRes.status}). Error: ${claudeRes.error}. Attempting OpenAI Tertiary Fallback...`);
    
    const openAIRes = await queryOpenAI(systemPrompt, messagesOrPrompt, extraOptions);
    if (openAIRes.ok) return await wrapResult(openAIRes);

    return { 
      ok: false, 
      error: `Primary (Gemini) failed: ${geminiRes.error}. Secondary (Claude) failed: ${claudeRes.error}. Tertiary (OpenAI) failed: ${openAIRes.error}` 
    };

  } catch (err) {
    return { ok: false, error: `Inference Engine Exception: ${err.message}` };
  }
}

module.exports = { consultRoger, ROGER_SYSTEM_INSTRUCTION, ANTIGRAVITY_SYSTEM_INSTRUCTION };
