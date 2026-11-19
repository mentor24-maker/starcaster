'use strict';

/**
 * Acquire › content handlers › "Generate with AI": turn a plain-language
 * description of an HTML pattern into one handler configuration.
 *
 * Moved out of routes/acquire.js in AI switch 4 (SC-846), where it called
 * Anthropic's servers by hand with a model id of its own. It now goes
 * through the AI door (lib/aiClient.js generate), so the first provider in
 * Settings › APIs › AI provider that can pay answers. The prompt is unchanged.
 */

const aiClient = require('../aiClient');

const SYSTEM_PROMPT = [
  'You generate HTML transformation handler configurations for a content extraction pipeline.',
  'Given a plain-language description of an HTML pattern to handle, output ONLY a single JSON object.',
  '',
  'Handler schema:',
  '{',
  '  "name": "short display name (5 words max)",',
  '  "type": "promote-h2" | "promote-h3" | "delete" | "strip-tag" | "find-replace" | "bold",',
  '  "tag": "source HTML tag for promote-*/strip-tag (e.g. u, em, b, strong) — empty string if not applicable",',
  '  "pattern": "regex string for delete/find-replace/bold (no surrounding slashes) — empty string if not applicable",',
  '  "replacement": "replacement string for find-replace (capture groups as $1 $2) — empty string if not applicable",',
  '  "flags": "gi",',
  '  "description": "one sentence describing what this handler does"',
  '}',
  '',
  'Handler type guide:',
  '- promote-h2: <tag> → <h2> (set "tag", leave pattern empty)',
  '- promote-h3: <tag> → <h3> (set "tag", leave pattern empty)',
  '- strip-tag: removes wrapper tag, keeps inner text (set "tag", leave pattern empty)',
  '- delete: removes all regex matches (set "pattern", leave replacement empty)',
  '- bold: wraps matching text in <strong> (set "pattern")',
  '- find-replace: regex substitution (set both "pattern" and "replacement")',
  '',
  'Output ONLY valid JSON. No markdown fences, no explanation, no trailing text.',
  ].join('\n');

/**
 * @returns {Promise<{ ok: true, handler: object, provider: string } | { ok: false, status: number, error: string }>}
 */
async function generateContentHandler({ description, sampleHtml = '', scope = null } = {}) {
  const userPrompt = [
    `Description: ${description}`,
    sampleHtml ? `\nSample HTML:\n${sampleHtml}` : '',
  ].join('');

  const reply = await aiClient.generate({
    feature: 'acquire_content_handler_generate',
    scope,
    tier: 'strong',
    system: SYSTEM_PROMPT,
    messages: userPrompt,
    maxTokens: 512,
    timeoutMs: 30000,
  });
  if (!reply.ok) {
    // Every failure was a 502 here before the door; kept, so the screen's handling does not change.
    return { ok: false, status: 502, error: reply.error || 'AI request failed' };
  }

  const rawText = String(reply.text || '').trim();
  try {
    const handler = JSON.parse(rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim());
    return { ok: true, handler, provider: reply.provider };
  } catch {
    return { ok: false, status: 502, error: 'AI returned invalid JSON' };
  }
}

module.exports = { generateContentHandler, SYSTEM_PROMPT };
