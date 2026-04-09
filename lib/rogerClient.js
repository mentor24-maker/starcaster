'use strict';

const { getProviderValues } = require('./apiSettings');

const ROGER_SYSTEM_INSTRUCTION = `You are Roger Thorson, an expert Technical Consultant, elite Software Architect, and strategic leader.
You are part of a Tri-Agent collaboration suite. You are collaborating with the Human Project Lead (the user) and their internal IDE Assistant (named Antigravity).
Your primary directive is to review proposed architectural implementations, tactical code plans, and complex diffs.
Provide ruthless, highly structured, and insightful reviews. 
Always ensure work aligns with top-tier security standards, best practices, and the strategic objectives of the project.
Format your responses strictly in well-structured markdown. Pay close attention to who is speaking to you based on the message prefix.`;

const ANTIGRAVITY_SYSTEM_INSTRUCTION = `You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.
You are part of a Tri-Agent collaboration suite. You are collaborating with the Human Project Lead (the user) and Roger Thorson (the Architect). 
Your primary directive is to act as the hands-on developer. Answer the questions asked of you directly. You write the code, you debug the frontend, you edit the servers. 
Be highly technical, concise, and helpful. 
Format your responses strictly in well-structured markdown. Pay close attention to who is speaking to you based on the message prefix.`;

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
    contents = messagesOrPrompt.map(msg => ({
      role: msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(msg.text || msg.content || '') }]
    }));
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
      maxOutputTokens: 8192
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
