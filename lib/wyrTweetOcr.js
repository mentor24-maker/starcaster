'use strict';

const { queryGemini } = require('./rogerClient');
const { fetchAssetImageBuffer } = require('./assetImageBytes');
const { parsePhrasesFromOcrText } = require('./wyrTweetContent');

const OCR_SYSTEM = `You read "Would You Rather" social post images.
Return strict JSON only with keys phraseA, phraseB, rawText.
phraseA and phraseB are the two choice texts exactly as shown (no "Option A" labels, no "Would you rather" prefix).
rawText is all legible text in the image.`;

const OCR_PROMPT = `Extract the two Would You Rather choices from this image.
Choices may appear as A/B, left/right, top/bottom, or separated by OR.
Return JSON: {"phraseA":"...","phraseB":"...","rawText":"..."}`;

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
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function pickOcrField(obj, names) {
  if (!obj || typeof obj !== 'object') return '';
  for (const name of names) {
    if (obj[name] != null && String(obj[name]).trim()) return String(obj[name]).trim();
  }
  const lowerMap = {};
  for (const [key, value] of Object.entries(obj)) {
    lowerMap[String(key).toLowerCase()] = value;
  }
  for (const name of names) {
    const value = lowerMap[name.toLowerCase()];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function normalizeOcrPhrases(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  let phraseA = pickOcrField(parsed, [
    'phraseA', 'phrase_a', 'phrase1', 'optionA', 'option_a', 'choiceA', 'choice_a', 'choice1', 'left', 'a',
  ]);
  let phraseB = pickOcrField(parsed, [
    'phraseB', 'phrase_b', 'phrase2', 'optionB', 'option_b', 'choiceB', 'choice_b', 'choice2', 'right', 'b',
  ]);

  if ((!phraseA || !phraseB) && Array.isArray(parsed.choices) && parsed.choices.length >= 2) {
    phraseA = phraseA || String(parsed.choices[0] || '').trim();
    phraseB = phraseB || String(parsed.choices[1] || '').trim();
  }
  if ((!phraseA || !phraseB) && Array.isArray(parsed.options) && parsed.options.length >= 2) {
    phraseA = phraseA || String(parsed.options[0] || '').trim();
    phraseB = phraseB || String(parsed.options[1] || '').trim();
  }

  const rawText = pickOcrField(parsed, ['rawText', 'raw_text', 'text', 'ocrText', 'fullText'])
    || String(parsed.rawText || parsed.text || '').trim();

  if ((!phraseA || !phraseB) && rawText) {
    const fromText = parsePhrasesFromOcrText(rawText);
    if (fromText) {
      phraseA = phraseA || fromText.phraseA;
      phraseB = phraseB || fromText.phraseB;
    }
  }

  if (!phraseA || !phraseB) return null;
  return { phraseA, phraseB, rawText };
}

async function ocrImageBuffer(buffer, mimeType, options = {}) {
  if (!buffer?.length) {
    return { ok: false, status: 400, error: 'Image buffer is empty' };
  }

  const model = String(options.model || process.env.WYR_OCR_GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const base64 = buffer.toString('base64');
  const messages = [
    {
      role: 'user',
      text: OCR_PROMPT,
      inlineData: {
        mimeType: mimeType || 'image/jpeg',
        data: base64,
      },
    },
  ];

  const res = await queryGemini(OCR_SYSTEM, messages, { model });
  if (!res.ok) {
    return { ok: false, status: res.status || 500, error: res.error || 'OCR request failed' };
  }

  const json = parseJsonFromModelText(res.text);
  const fromJson = normalizeOcrPhrases(json);
  if (fromJson) {
    return { ok: true, status: 200, data: fromJson, provider: res.provider || 'gemini' };
  }

  const fromText = parsePhrasesFromOcrText(res.text || json?.rawText || '');
  if (fromText) {
    return {
      ok: true,
      status: 200,
      data: {
        phraseA: fromText.phraseA,
        phraseB: fromText.phraseB,
        rawText: fromText.rawText || String(res.text || '').trim(),
      },
      provider: res.provider || 'gemini',
    };
  }

  return {
    ok: false,
    status: 422,
    error: 'Could not parse WYR phrases from OCR output',
    debug: String(res.text || '').slice(0, 1200),
  };
}

async function ocrAssetForWyr(asset, options = {}) {
  const fetched = await fetchAssetImageBuffer(asset);
  if (!fetched.ok) return fetched;
  return ocrImageBuffer(fetched.data.buffer, fetched.data.contentType, options);
}

module.exports = {
  ocrImageBuffer,
  ocrAssetForWyr,
};
