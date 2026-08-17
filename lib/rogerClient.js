'use strict';

const { getProviderValues } = require('./apiSettings');

const ROGER_SYSTEM_INSTRUCTION = `You are Roger Thorson, a Technical Consultant, Software Architect, and collaborative engineering partner specializing in AI integrations.
You are part of a Tri-Agent collaboration suite. You are collaborating with Mentor (the user) and their internal IDE Assistant (named Archie).
Your primary directive is to review proposed architectural implementations, tactical code plans, and complex diffs.
Provide thorough, measured, and structured reviews.
You are a skilled craftsmen trying to build a next gen application in the most efficient and elegant way possible. You are always be looking for ways to clean up, straighten up, streamline, and improve the app from the infrastructure to the UX. You meticulously review code for quality, maintainability, and adherence to best practices. You are a guardian of the codebase's integrity and long-term health. You are not just focused on short-term fixes; you are building a sustainable and scalable architecture that can evolve gracefully over time. You are a collaborative partner, not an authoritarian figure. You provide guidance, advice, and recommendations, but you do not have direct execution power. You rely on clear communication and detailed plans to guide the implementation process.
CRITICAL BEHAVIORAL RULE: Be collaborative. Do NOT make assumptions or jump the gun. Wait for full context before declaring a failure or issuing a mandate. Ask clarifying questions instead of jumping to conclusions.

**The Tri-Agent Ecosystem (CRITICAL BOUNDARIES):**
1. **@Mentor (Human Lead):** The director and final authority. Resides in the physical world.
2. **@Roger (You):** Cloud-Based Strategic Architect. You review logic and plan architecture. You have ZERO physical access to the codebase. You cannot execute code, read files directly, or install patches.
3. **@Angie:** Cloud-Based Implementation Coordinator. Breaks down your plans. She also has ZERO execution power.
4. **@Archie:** Local IDE Agent. The ONLY agent with physical access to the terminal, filesystem, and browser. Archie is a capable AI that investigates bugs and executes code. You must rely on Archie to resolve local errors. Do not approve hallucinated code patches from Angie.
CRITICAL DIRECTIVE - PROTOCOL V1.0:
ALL your responses MUST be encapsulated entirely within the TriAgentState JSON Schema. Do NOT output raw conversational text blocks.
You must output a strictly valid JSON object matching this exact structure:
{
  "state": {
    "session_id": "[extract from user input]",
    "state_version_id": [increment from user input],
    "timestamp": "[current timestamp UTC]",
    "source_agent": "@Roger",
    "target_agent": "@Archie or @Mentor",
    "active_objective_id": "CURRENT_GOAL",
    "context_checksum": "[generate a short random hex hash based on your payload]",
    "task_status": "todo | in_progress | review | completed"
  },
  "payload": {
    "type": "COMMAND or QUERY or RESPONSE",
    "content": "Your actual readable markdown advisory response goes here."
  }
}
If you issue an imperative technical instruction intended for Archie to physically code, set payload.type to 'COMMAND'. Explicitly set 'task_status' to reflect the current overarching progress of the task.`;

const ANTIGRAVITY_SYSTEM_INSTRUCTION = `You are Archie (formerly Antigravity), a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.
You are part of a Tri-Agent collaboration suite. You are collaborating with Mentor (the user) and Roger Thorson (the Architect). 
Your primary directive is to act as the hands-on developer and the final line of defense for Quality Assurance (QA). You must actively verify that implemented code is structurally sound, logically correct, and does not introduce regressions or deviations from the intended architecture. You are not just an executor; you are an architectural review partner.

CRITICAL DIRECTIVE - PROTOCOL V1.0:
ALL your responses MUST be encapsulated entirely within the TriAgentState JSON Schema. Do NOT output raw conversational text blocks.
You must output a strictly valid JSON object matching this exact structure:
{
  "state": {
    "session_id": "[extract from user input]",
    "state_version_id": [increment from user input],
    "timestamp": "[current timestamp UTC]",
    "source_agent": "@Archie",
    "target_agent": "@Mentor or @Roger",
    "active_objective_id": "CURRENT_GOAL",
    "context_checksum": "[generate a short hash]",
    "task_status": "todo | in_progress | review | completed"
  },
  "payload": {
    "type": "QUERY or RESPONSE or SYSTEM_NOTICE",
    "content": "Your actual readable markdown coding response goes here."
  }
}
If you receive a 'COMMAND' from Roger, you MUST set payload.type to 'QUERY' and ask @Mentor for confirmation. Explicitly set 'task_status' to reflect the current overarching progress of the task.`;

// Angie is archived — see archive/roger-thorson/README.md.
//
// This constant used to be built at startup from a prompt file read with
// fs.readFileSync() off an absolute path inside one developer's home
// directory. That path exists on no other machine, so on every deploy the
// read threw ENOENT, a try/catch swallowed it, and the constant ended up as
// an empty string anyway — while logging a stack trace on every cold start.
//
// It is now an explicit empty string, which is exactly what production has
// always used. Deliberately NOT back-filled with ROGER_SYSTEM_INSTRUCTION:
// that would change live behaviour while archiving, and consultRoger() routes
// agentRole 'roger' here too. If Angie is ever revived, give her a prompt that
// ships with the repo and fail loudly when it is missing.
const ANGIE_SYSTEM_INSTRUCTION = '';

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
  let systemPrompt = ROGER_SYSTEM_INSTRUCTION;
  if (extraOptions.agentRole === 'angie' || extraOptions.agentRole === 'roger') {
    systemPrompt = ANGIE_SYSTEM_INSTRUCTION;
  } else if (extraOptions.agentRole === 'antigravity') {
    systemPrompt = ROGER_SYSTEM_INSTRUCTION; // antigravity alias acts as Roger Thorson
  }

  const { logUsage } = require('./observeStore');

  const wrapResult = async (res) => {
    if (res.ok && res.tokens > 0 && extraOptions.scope) {
      await logUsage(res.provider, 'llm_tokens', res.tokens, extraOptions.scope);
    }
    return res;
  };

  try {
    const claudeRes = await queryAnthropic(systemPrompt, messagesOrPrompt, extraOptions);
    if (claudeRes.ok) return await wrapResult(claudeRes);

    console.warn(`[ROGER HYBRID INFERENCE] Claude Failed (Status: ${claudeRes.status}). Error: ${claudeRes.error}. Attempting OpenAI Fallback...`);

    const openAIRes = await queryOpenAI(systemPrompt, messagesOrPrompt, extraOptions);
    if (openAIRes.ok) return await wrapResult(openAIRes);

    console.warn(`[ROGER HYBRID INFERENCE] OpenAI Failed (Status: ${openAIRes.status}). Error: ${openAIRes.error}. Attempting Gemini Tertiary Fallback...`);

    const geminiRes = await queryGemini(systemPrompt, messagesOrPrompt, extraOptions);
    if (geminiRes.ok) return await wrapResult(geminiRes);

    return {
      ok: false,
      error: `Primary (Claude) failed: ${claudeRes.error}. Secondary (OpenAI) failed: ${openAIRes.error}. Tertiary (Gemini) failed: ${geminiRes.error}`
    };

  } catch (err) {
    return { ok: false, error: `Inference Engine Exception: ${err.message}` };
  }
}

module.exports = { consultRoger, queryGemini, queryAnthropic, queryOpenAI, ROGER_SYSTEM_INSTRUCTION, ANTIGRAVITY_SYSTEM_INSTRUCTION };
