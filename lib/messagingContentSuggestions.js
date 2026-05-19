'use strict';

const { getProviderValues } = require('./apiSettings');
const { getTrainingPromptConfig } = require('./trainingStore');
const { getLatestDirectAcquireRun } = require('./directAcquire');

function clean(value) {
  return String(value || '').trim();
}

function truncate(value, max = 4000) {
  const text = clean(value);
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function anthropicModel() {
  return clean(process.env.ANTHROPIC_MODEL) || 'claude-sonnet-4-20250514';
}

const ANTHROPIC_MODEL_CANDIDATES = [
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
];

const FORMAT_SCHEMAS = {
  Headlines: { kind: 'short', fieldLabel: 'Headline', count: 10 },
  'Sub-headings': { kind: 'short', fieldLabel: 'Sub-heading', count: 10 },
  Taglines: { kind: 'short', fieldLabel: 'Tagline', count: 10 },
  Pitches: { kind: 'short', fieldLabel: 'Pitch', count: 10 },
  Emails: { kind: 'short', fieldLabel: 'Email Body', count: 10, usesSubject: true },
  Tweets: { kind: 'short', fieldLabel: 'Tweet', count: 10, usesHashtags: true, usesUrl: true },
  Posts: { kind: 'short', fieldLabel: 'Post', count: 10, usesUrl: true },
  Descriptions: { kind: 'short', fieldLabel: 'Description', count: 10 },
  Transcripts: { kind: 'short', fieldLabel: 'Transcript', count: 10, usesUrl: true },
  Comments: { kind: 'short', fieldLabel: 'Comment', count: 10, usesUrl: true },
  Hashtags: { kind: 'short', fieldLabel: 'Hashtags', count: 10 },
  'Calls to Action': { kind: 'short', fieldLabel: 'CTA', count: 10, usesUrl: true },
  Articles: { kind: 'long', usesUrl: true, usesImage: true },
  Reports: { kind: 'long', usesUrl: true, usesImage: true, usesPdf: true },
  'White Papers': { kind: 'long', usesUrl: true, usesImage: true, usesPdf: true },
  eBooks: { kind: 'long', usesUrl: true, usesImage: true, usesPdf: true },
};

async function listAnthropicModels(apiKey) {
  const key = clean(apiKey);
  if (!key) return { ok: false, status: 400, error: 'Anthropic API key not configured.' };
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Anthropic models request failed: ${err.message}` };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = clean(body?.error?.message || body?.error || 'Anthropic models lookup failed');
    const type = clean(body?.error?.type);
    return { ok: false, status: res.status || 500, error: type ? `${type}: ${message}` : message };
  }
  const ids = (Array.isArray(body?.data) ? body.data : []).map((item) => clean(item?.id)).filter(Boolean);
  return { ok: true, status: 200, data: ids };
}

async function resolveAnthropicModel(apiKey) {
  const preferred = anthropicModel();
  const listed = await listAnthropicModels(apiKey);
  if (listed.ok) {
    const available = Array.isArray(listed.data) ? listed.data : [];
    if (available.includes(preferred)) return { ok: true, model: preferred, available };
    const fallback = ANTHROPIC_MODEL_CANDIDATES.find((candidate) => available.includes(candidate));
    if (fallback) return { ok: true, model: fallback, available };
    if (available.length) return { ok: true, model: available[0], available };
    return { ok: false, status: 404, error: 'Anthropic returned no available models.' };
  }
  return { ok: true, model: preferred, available: [], lookupError: listed.error || '' };
}

function schemaForFormat(format) {
  return FORMAT_SCHEMAS[clean(format)] || null;
}

function buildInput(input) {
  return {
    format: clean(input?.format),
    topic: clean(input?.topic),
    author: clean(input?.author),
    subject: truncate(input?.subject, 400),
    title: truncate(input?.title, 400),
    subtitle: truncate(input?.subtitle, 500),
    url: truncate(input?.url, 1200),
    hashtags: truncate(input?.hashtags, 500),
    body: truncate(input?.body || input?.primary, 12000),
    image_label: truncate(input?.image_label, 300),
    pdf_name: truncate(input?.pdf_name, 300),
    feedback: truncate(input?.feedback, 6000),
  };
}

function promptForShort(input, schema, training) {
  return [
    `Generate exactly ${Number(schema?.count || 10)} distinct ${input.format} options.`,
    'Return strict JSON only in this shape:',
    '{"options":["...","..."]}',
    '',
    'Constraints:',
    `- Each option should be only the ${schema.fieldLabel}.`,
    '- No numbering or bullets.',
    '- Keep each option concise and ready to use.',
    '- Make the options meaningfully different from one another.',
    input.author ? `- Write in a voice suitable for author: ${input.author}` : '',
    input.subject ? `- Use this subject/context: ${input.subject}` : '',
    input.hashtags ? `- Optional hashtag context: ${input.hashtags}` : '',
    input.url ? `- Related URL/context: ${input.url}` : '',
    '',
    'Project training context:',
    training.context || '-',
    '',
    'Project writing rules/guides:',
    training.guidelines || '-',
    '',
    'User-provided seed content/context:',
    input.body || '-',
    '',
    `Format: ${input.format}`,
    `Topic: ${input.topic || '-'}`,
  ].filter(Boolean).join('\n');
}

function promptForLong(input, training) {
  return [
    input.feedback
      ? `Revise exactly 1 draft for this ${input.format}.`
      : `Generate exactly 1 draft for this ${input.format}.`,
    'Return strict JSON only in this shape:',
    '{"draft":{"title":"...","subtitle":"...","body":"..."}}',
    '',
    'Constraints:',
    '- Produce one coherent, editable draft.',
    '- The body should be detailed enough to refine collaboratively.',
    '- Use the subtitle when it helps; otherwise keep it concise.',
    input.feedback ? '- Treat the existing body as the draft to revise, not just background notes.' : '',
    input.feedback ? '- Apply the feedback directly and return a revised full draft.' : '',
    input.author ? `- Write in a voice suitable for author: ${input.author}` : '',
    input.url ? `- Align with this URL/context when useful: ${input.url}` : '',
    input.image_label ? `- Possible supporting image: ${input.image_label}` : '',
    input.pdf_name ? `- There may also be a related PDF: ${input.pdf_name}` : '',
    '',
    'Project training context:',
    training.context || '-',
    '',
    'Project writing rules/guides:',
    training.guidelines || '-',
    '',
    input.feedback ? 'Current draft to revise:' : 'User-provided seed content/context:',
    input.body || '-',
    input.feedback ? '' : null,
    input.feedback ? 'Revision feedback:' : null,
    input.feedback || null,
    '',
    `Format: ${input.format}`,
    `Topic: ${input.topic || '-'}`,
    `Existing title hint: ${input.title || '-'}`,
    `Existing subtitle hint: ${input.subtitle || '-'}`,
  ].filter(Boolean).join('\n');
}

async function prepareMessagingContentPrompt(input) {
  const normalized = buildInput(input);
  const schema = schemaForFormat(normalized.format);
  if (!schema) return { ok: false, status: 400, error: 'A supported format is required.' };
  const training = await getTrainingPromptConfig('global').catch(() => ({ context: '', guidelines: '' }));
  const prompt_text = schema.kind === 'long'
    ? promptForLong(normalized, training || {})
    : promptForShort(normalized, schema, training || {});
  return {
    ok: true,
    status: 200,
    data: {
      format: normalized.format,
      topic: normalized.topic,
      prompt_kind: schema.kind,
      prompt_text,
    },
  };
}

function stripCodeFences(text) {
  return clean(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseShortResponse(text, count) {
  const raw = stripCodeFences(text);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const options = Array.isArray(parsed?.options) ? parsed.options : Array.isArray(parsed) ? parsed : [];
    const normalized = [];
    const seen = new Set();
    options.forEach((item) => {
      const value = clean(item).replace(/\s+/g, ' ');
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push(value);
    });
    return normalized.slice(0, count);
  } catch {
    return [];
  }
}

function parseLongResponse(text) {
  const raw = stripCodeFences(text);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const draft = parsed?.draft && typeof parsed.draft === 'object' ? parsed.draft : parsed;
    if (!draft || typeof draft !== 'object') return null;
    const normalized = {
      title: clean(draft.title),
      subtitle: clean(draft.subtitle),
      body: clean(draft.body || draft.content),
    };
    if (!normalized.title && !normalized.body) return null;
    return normalized;
  } catch {
    return null;
  }
}

function topicSuggestionPrompt(input, training, website) {
  const keywordLines = Array.isArray(website?.keywords)
    ? website.keywords.slice(0, 20).map((item) => `- ${item.keyword} (${item.score})`)
    : [];
  const pageLines = Array.isArray(website?.pages)
    ? website.pages.slice(0, 12).map((page, index) => {
      const title = clean(page?.title) || `Untitled Page ${index + 1}`;
      const meta = clean(page?.meta_desc);
      const headings = Array.isArray(page?.headings) ? page.headings.slice(0, 4).map((value) => clean(value)).filter(Boolean) : [];
      const snippet = truncate(page?.body_snippet, 320);
      return [
        `Page ${index + 1}: ${title}`,
        meta ? `Meta: ${meta}` : '',
        headings.length ? `Headings: ${headings.join(' | ')}` : '',
        snippet ? `Snippet: ${snippet}` : '',
      ].filter(Boolean).join('\n');
    })
    : [];

  return [
    'Review the website source material and produce the most meaningful messaging topics.',
    'Return strict JSON only in this shape:',
    '{"groups":[{"label":"Group Name","topics":["Topic One","Topic Two"]}]}',
    '',
    'Requirements:',
    '- Return 4 to 6 groups.',
    '- Return 10 to 20 total topics across all groups.',
    '- Topics should be concise, strategically useful, and grounded in the website content.',
    '- Group topics into clear thematic clusters.',
    '- Avoid brand names unless the brand itself is a necessary topic.',
    '- Avoid generic filler topics like "Innovation" or "Success" unless strongly supported by the source.',
    '- Each topic should be unique.',
    '',
    'Project training context:',
    training.context || '-',
    '',
    'Project writing rules/guides:',
    training.guidelines || '-',
    '',
    `Website source: ${clean(website?.source_url) || '-'}`,
    '',
    'Top website keywords:',
    keywordLines.length ? keywordLines.join('\n') : '-',
    '',
    'Website page summaries:',
    pageLines.length ? pageLines.join('\n\n') : '-',
    '',
    input?.notes ? `Extra user notes:\n${input.notes}` : '',
  ].filter(Boolean).join('\n');
}

function parseTopicSuggestions(text) {
  const raw = stripCodeFences(text);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
    const seen = new Set();
    return groups
      .map((group, index) => {
        const label = clean(group?.label || `Group ${index + 1}`);
        const topics = Array.isArray(group?.topics)
          ? group.topics
              .map((item) => clean(item).replace(/\s+/g, ' '))
              .filter(Boolean)
              .filter((item) => {
                const key = item.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              })
          : [];
        return { label, topics };
      })
      .filter((group) => group.topics.length);
  } catch {
    return [];
  }
}

async function generateTopicSuggestionsWithAnthropic(input, training, website) {
  const cfg = getProviderValues('anthropic');
  const apiKey = clean(cfg.api_key || process.env.ANTHROPIC_API_KEY);
  if (!apiKey) return { ok: false, status: 400, error: 'Anthropic API key not configured.' };
  const modelRes = await resolveAnthropicModel(apiKey);
  if (!modelRes.ok) return { ok: false, status: modelRes.status || 500, error: modelRes.error || 'Could not resolve an Anthropic model.' };

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelRes.model,
        max_tokens: 1800,
        messages: [{ role: 'user', content: topicSuggestionPrompt(input, training, website) }],
        system: 'You are an information architect generating topic taxonomies from website research. Output strict JSON only.',
      }),
      signal: AbortSignal.timeout(35000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Anthropic request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = clean(body?.error?.message || body?.error || 'Anthropic error');
    const type = clean(body?.error?.type);
    return { ok: false, status: res.status || 500, error: type ? `${type}: ${message}` : message, provider: 'anthropic' };
  }

  const text = clean((body?.content || []).map((part) => part?.text || '').join('\n'));
  const groups = parseTopicSuggestions(text);
  if (!groups.length) {
    return { ok: false, status: 502, error: 'Anthropic returned no usable topic suggestions.', provider: 'anthropic' };
  }
  const totalTopics = groups.reduce((sum, group) => sum + group.topics.length, 0);
  return {
    ok: true,
    status: 200,
    data: {
      groups,
      total_topics: totalTopics,
    },
    provider: 'anthropic',
    model: modelRes.model,
  };
}

async function generateWithAnthropic(input, schema, training) {
  const cfg = getProviderValues('anthropic');
  const apiKey = clean(cfg.api_key || process.env.ANTHROPIC_API_KEY);
  if (!apiKey) return { ok: false, status: 400, error: 'Anthropic API key not configured.' };
  const modelRes = await resolveAnthropicModel(apiKey);
  if (!modelRes.ok) return { ok: false, status: modelRes.status || 500, error: modelRes.error || 'Could not resolve an Anthropic model.' };

  const prompt = schema.kind === 'long' ? promptForLong(input, training) : promptForShort(input, schema, training);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelRes.model,
        max_tokens: schema.kind === 'long' ? 2200 : 1200,
        messages: [{ role: 'user', content: prompt }],
        system: schema.kind === 'long'
          ? 'You write publication-ready marketing and editorial drafts. Output strict JSON only.'
          : 'You write sharp marketing content options. Output strict JSON only.',
      }),
      signal: AbortSignal.timeout(35000),
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Anthropic request failed: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = clean(body?.error?.message || body?.error || 'Anthropic error');
    const type = clean(body?.error?.type);
    return { ok: false, status: res.status || 500, error: type ? `${type}: ${message}` : message, provider: 'anthropic' };
  }

  const text = clean((body?.content || []).map((part) => part?.text || '').join('\n'));
  if (schema.kind === 'long') {
    const draft = parseLongResponse(text);
    if (!draft) return { ok: false, status: 502, error: 'Anthropic returned no usable long-form draft.', provider: 'anthropic' };
    return { ok: true, status: 200, data: { kind: 'long', draft }, provider: 'anthropic', model: modelRes.model };
  }

  const options = parseShortResponse(text, Number(schema.count || 10));
  if (!options.length) return { ok: false, status: 502, error: 'Anthropic returned no usable content options.', provider: 'anthropic' };
  return { ok: true, status: 200, data: { kind: 'short', options }, provider: 'anthropic', model: modelRes.model };
}

async function generateMessagingContentSuggestions(input) {
  const normalized = buildInput(input);
  const schema = schemaForFormat(normalized.format);
  if (!schema) return { ok: false, status: 400, error: 'A supported format is required.' };
  const training = await getTrainingPromptConfig('global').catch(() => ({ context: '', guidelines: '' }));
  const generated = await generateWithAnthropic(normalized, schema, training || {});
  if (!generated.ok) return generated;
  return {
    ok: true,
    status: 200,
    data: {
      format: normalized.format,
      topic: normalized.topic,
      ...generated.data,
    },
    provider: generated.provider,
    model: generated.model,
  };
}

async function generateMessagingTopicSuggestions(input, scope = null) {
  const websiteInput = input && typeof input.website_data === 'object' ? input.website_data : null;
  const latestRun = websiteInput ? null : await getLatestDirectAcquireRun(scope);
  const website = websiteInput
    ? {
        source_url: clean(websiteInput.source_url),
        keywords: Array.isArray(websiteInput.keywords) ? websiteInput.keywords : [],
        pages: Array.isArray(websiteInput.pages) ? websiteInput.pages : [],
      }
    : latestRun
      ? {
          source_url: latestRun.source_url,
          keywords: Array.isArray(latestRun?.keyword_summary?.top_keywords) ? latestRun.keyword_summary.top_keywords : [],
          pages: Array.isArray(latestRun?.pages) ? latestRun.pages : [],
        }
      : null;
  if (!website || !website.source_url) {
    return { ok: false, status: 400, error: 'No harvested website data is available yet. Run Acquire: Web first.' };
  }
  const training = await getTrainingPromptConfig(scope?.userId || 'global').catch(() => ({ context: '', guidelines: '' }));
  const generated = await generateTopicSuggestionsWithAnthropic(input || {}, training || {}, website);
  if (!generated.ok) return generated;
  return {
    ok: true,
    status: 200,
    data: {
      source_url: website.source_url,
      groups: generated.data.groups,
      total_topics: generated.data.total_topics,
    },
    provider: generated.provider,
    model: generated.model,
  };
}

module.exports = {
  generateMessagingContentSuggestions,
  generateMessagingTopicSuggestions,
  prepareMessagingContentPrompt,
};
