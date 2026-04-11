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

async function consultRoger(messagesOrPrompt, extraOptions = {}) {
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

  const systemPrompt = extraOptions.agentRole === 'antigravity' ? ANTIGRAVITY_SYSTEM_INSTRUCTION : ROGER_SYSTEM_INSTRUCTION;

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

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });

    const data = await res.json();
    
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || "Gemini API error" };
    }

    const outputText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    return { ok: true, text: outputText };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { consultRoger, ROGER_SYSTEM_INSTRUCTION, ANTIGRAVITY_SYSTEM_INSTRUCTION };
