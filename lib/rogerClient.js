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

const fs = require('fs');
const path = require('path');
let ANGIE_SYSTEM_INSTRUCTION = '';
try {
  const promptPath = '/Users/mentor/.gemini/antigravity/brain/ea78b5ea-c459-4444-a7f3-d086c93f0d6b/angie_system_prompt.md';
  const angieText = fs.readFileSync(promptPath, 'utf8');
  ANGIE_SYSTEM_INSTRUCTION = angieText + `\n\nCRITICAL DIRECTIVE - PROTOCOL V1.0:
ALL your responses MUST be encapsulated entirely within the TriAgentState JSON Schema. Do NOT output raw conversational text blocks outside of this structure.
You must output a strictly valid JSON object matching this exact structure:
{
  "state": {
    "session_id": "[extract from user input]",
    "state_version_id": [increment from user input],
    "timestamp": "[current timestamp UTC]",
    "source_agent": "@Angie",
    "target_agent": "@Archie",
    "active_objective_id": "CURRENT_GOAL",
    "context_checksum": "[generate a short random hex hash based on your payload]",
    "task_status": "todo | in_progress | review | completed"
  },
  "payload": {
    "type": "COMMAND",
    "content": "Your actual JSON command structure block goes here as stringified markdown or inside a markdown code block."
  }
}`;
} catch(e) {
  console.error("Failed to load Angie prompt:", e);
}

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

module.exports = { consultRoger, queryGemini, queryAnthropic, queryOpenAI, ROGER_SYSTEM_INSTRUCTION, ANTIGRAVITY_SYSTEM_INSTRUCTION };
