'use strict';

const { runYoutubeCommentAcquire } = require('./YoutubeCommentsRun');
const { resolveYoutubeApiKey } = require('./youtubeApiKey');

function safeText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function youtubeApiConfig() {
  const apiKey = resolveYoutubeApiKey();
  return { apiKey };
}

function toArrayTargets(rawTargets) {
  if (Array.isArray(rawTargets)) {
    return rawTargets.map((value) => safeText(value)).filter(Boolean);
  }
  const text = safeText(rawTargets);
  if (!text) return [];
  return text
    .split(/\r?\n|,/g)
    .map((value) => safeText(value))
    .filter(Boolean);
}

function parseYoutubeTarget(rawTarget) {
  const target = safeText(rawTarget);
  if (!target) return { type: 'unknown', raw: '' };

  if (/^[a-zA-Z0-9_-]{11}$/.test(target)) {
    return { type: 'video', videoId: target, canonical: `https://www.youtube.com/watch?v=${target}`, raw: target };
  }
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(target)) {
    return { type: 'channel', channelId: target, raw: target };
  }
  if (/^@[\w.\-]+$/i.test(target)) {
    return { type: 'channel_handle', handle: target.replace(/^@/, ''), raw: target };
  }

  let url = null;
  try {
    const withScheme = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    url = new URL(withScheme);
  } catch {
    return { type: 'unknown', raw: target };
  }

  const host = String(url.hostname || '').toLowerCase();
  const pathParts = String(url.pathname || '')
    .split('/')
    .map((part) => safeText(part))
    .filter(Boolean);

  if (host.includes('youtu.be')) {
    const id = safeText(pathParts[0]);
    if (id) return { type: 'video', videoId: id, canonical: `https://www.youtube.com/watch?v=${id}`, raw: target };
  }

  if (host.includes('youtube.com')) {
    const v = safeText(url.searchParams.get('v'));
    if (v) return { type: 'video', videoId: v, canonical: `https://www.youtube.com/watch?v=${v}`, raw: target };

    const shortsIdx = pathParts.findIndex((part) => part.toLowerCase() === 'shorts');
    if (shortsIdx >= 0 && safeText(pathParts[shortsIdx + 1])) {
      const id = safeText(pathParts[shortsIdx + 1]);
      return { type: 'video', videoId: id, canonical: `https://www.youtube.com/watch?v=${id}`, raw: target };
    }

    const channelIdx = pathParts.findIndex((part) => part.toLowerCase() === 'channel');
    if (channelIdx >= 0 && safeText(pathParts[channelIdx + 1])) {
      return { type: 'channel', channelId: safeText(pathParts[channelIdx + 1]), raw: target };
    }

    if (pathParts[0] && pathParts[0].startsWith('@')) {
      return { type: 'channel_handle', handle: pathParts[0].slice(1), raw: target };
    }
  }

  return { type: 'unknown', raw: target };
}

async function ytFetch(endpoint, params, apiKey, timeoutMs = 15000) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      'user-agent': 'APH-YoutubeCommentMiner/1.0',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (!response.ok) {
    const message = safeText(body?.error?.message || body?.error?.errors?.[0]?.message) || `YouTube API error (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return body;
}

async function resolveChannelIdFromHandle(handle, apiKey) {
  const cleanHandle = safeText(handle).replace(/^@/, '');
  if (!cleanHandle) return '';
  const data = await ytFetch('search', {
    part: 'snippet',
    q: `@${cleanHandle}`,
    type: 'channel',
    maxResults: 1,
  }, apiKey);
  const first = Array.isArray(data?.items) ? data.items[0] : null;
  return safeText(first?.id?.channelId);
}

async function listRecentChannelVideos(channelId, limit, apiKey) {
  const maxResults = Math.max(1, Math.min(Number(limit || 5) || 5, 20));
  const out = [];
  let pageToken = '';

  while (out.length < maxResults) {
    const batchSize = Math.min(50, maxResults - out.length);
    const data = await ytFetch('search', {
      part: 'snippet',
      channelId: safeText(channelId),
      order: 'date',
      type: 'video',
      maxResults: batchSize,
      pageToken: pageToken || undefined,
    }, apiKey);

    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const videoId = safeText(item?.id?.videoId);
      if (!videoId) continue;
      out.push({
        video_id: videoId,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        title: safeText(item?.snippet?.title),
        channel_name: safeText(item?.snippet?.channelTitle),
      });
      if (out.length >= maxResults) break;
    }

    pageToken = safeText(data?.nextPageToken);
    if (!pageToken) break;
  }

  return out;
}

function parsePhraseList(value) {
  return String(value || '')
    .split(/\r?\n|,/g)
    .map((item) => safeText(item).toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
}

function normalizeTrainingFeedback(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = [];
    }
  }
  return toArray(parsed).map((row) => ({
    quality: Math.max(0, Math.min(Number(row?.quality || 0) || 0, 5)),
    categories: (() => {
      if (Array.isArray(row?.categories)) {
        return row.categories.map((item) => safeText(item).toLowerCase()).filter(Boolean).slice(0, 20);
      }
      const legacyCategory = safeText(row?.topic).toLowerCase();
      return legacyCategory ? [legacyCategory] : [];
    })(),
    hashtags: String(row?.hashtags || row?.tags || '')
      .split(/\r?\n|,/g)
      .map((item) => safeText(item).toLowerCase())
      .filter(Boolean)
      .slice(0, 25),
    attributes: (() => {
      if (Array.isArray(row?.attributes)) {
        return row.attributes.map((item) => safeText(item).toLowerCase()).filter(Boolean).slice(0, 20);
      }
      const legacyAttribute = safeText(row?.attribute).toLowerCase();
      return legacyAttribute ? [legacyAttribute] : [];
    })(),
    approaches: (() => {
      if (Array.isArray(row?.approaches)) {
        return row.approaches.map((item) => safeText(item).toLowerCase()).filter(Boolean).slice(0, 20);
      }
      const legacyApproach = safeText(row?.approach || row?.response_type || row?.response_style).toLowerCase();
      return legacyApproach ? [legacyApproach] : [];
    })(),
    category_explain: safeText(row?.category_explain).toLowerCase(),
    attributes_explain: safeText(row?.attributes_explain).toLowerCase(),
    approaches_explain: safeText(row?.approaches_explain).toLowerCase(),
    note: safeText(row?.note).toLowerCase(),
    response_type: safeText(row?.response_type || row?.response_style).toLowerCase(),
    suggested_response: safeText(row?.suggested_response || row?.response_example),
  })).filter((row) => row.quality > 0);
}

function buildTrainingSignals(feedbackRows = []) {
  const includeTerms = new Set();
  const excludeTerms = new Set();
  const preferredTags = new Set();
  const categoryBoost = {};
  const attributeBoost = {};
  const approachBoost = {};
  const responseTypePreference = {};
  const suggestedResponses = [];

  function addPhraseTerms(sourceText, targetSet) {
    String(sourceText || '')
      .split(/\r?\n|,|;|\||\//g)
      .map((part) => safeText(part).toLowerCase())
      .filter((part) => part.length >= 3)
      .forEach((part) => targetSet.add(part));
  }

  toArray(feedbackRows).forEach((row) => {
    const quality = Number(row?.quality || 0) || 0;
    const categories = toArray(row?.categories)
      .map((item) => safeText(item).toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
    const attributes = toArray(row?.attributes)
      .map((item) => safeText(item).toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
    const approaches = toArray(row?.approaches)
      .map((item) => safeText(item).toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
    const legacyCategory = safeText(row?.topic).toLowerCase();
    if (legacyCategory && !categories.includes(legacyCategory)) categories.push(legacyCategory);
    const legacyApproach = safeText(row?.response_type).toLowerCase();
    if (legacyApproach && !approaches.includes(legacyApproach)) approaches.push(legacyApproach);
    const hashtags = toArray(row?.hashtags || row?.tags).map((tag) => safeText(tag).toLowerCase()).filter(Boolean);
    const note = safeText(row?.note).toLowerCase();
    const categoryExplain = safeText(row?.category_explain).toLowerCase();
    const attributesExplain = safeText(row?.attributes_explain).toLowerCase();
    const approachesExplain = safeText(row?.approaches_explain).toLowerCase();
    const suggestedResponse = safeText(row?.suggested_response);

    if (quality >= 4) {
      addPhraseTerms(note, includeTerms);
      addPhraseTerms(categoryExplain, includeTerms);
      addPhraseTerms(attributesExplain, includeTerms);
      addPhraseTerms(approachesExplain, includeTerms);
      hashtags.forEach((tag) => {
        includeTerms.add(tag);
        preferredTags.add(tag);
      });
      categories.forEach((category) => {
        categoryBoost[category] = Number(categoryBoost[category] || 0) + (quality - 3);
      });
      attributes.forEach((name) => {
        attributeBoost[name] = Number(attributeBoost[name] || 0) + (quality - 3);
      });
      approaches.forEach((name) => {
        approachBoost[name] = Number(approachBoost[name] || 0) + (quality - 3);
        responseTypePreference[name] = Number(responseTypePreference[name] || 0) + (quality - 3);
      });
      if (suggestedResponse) {
        suggestedResponses.push(suggestedResponse);
      }
    } else if (quality <= 2) {
      addPhraseTerms(note, excludeTerms);
      addPhraseTerms(categoryExplain, excludeTerms);
      addPhraseTerms(attributesExplain, excludeTerms);
      addPhraseTerms(approachesExplain, excludeTerms);
      hashtags.forEach((tag) => excludeTerms.add(tag));
      categories.forEach((category) => {
        categoryBoost[category] = Number(categoryBoost[category] || 0) - (3 - quality);
      });
      attributes.forEach((name) => {
        attributeBoost[name] = Number(attributeBoost[name] || 0) - (3 - quality);
      });
      approaches.forEach((name) => {
        approachBoost[name] = Number(approachBoost[name] || 0) - (3 - quality);
        responseTypePreference[name] = Number(responseTypePreference[name] || 0) - (3 - quality);
      });
    }
  });

  return {
    include_terms: Array.from(includeTerms).slice(0, 120),
    exclude_terms: Array.from(excludeTerms).slice(0, 120),
    preferred_hashtags: Array.from(preferredTags).slice(0, 120),
    preferred_tags: Array.from(preferredTags).slice(0, 120),
    category_boost: categoryBoost,
    attribute_boost: attributeBoost,
    approach_boost: approachBoost,
    response_type_preference: responseTypePreference,
    suggested_response_examples: suggestedResponses.slice(0, 100),
  };
}

function defaultCategoryConfig() {
  return [
    {
      name: 'intent',
      rationale: 'Clear action-seeking language. Prioritize for fast follow-up and concrete next steps.',
      value_rank: 5,
      match_hashtags: ['purchase_intent', 'solution_seeking'],
    },
    {
      name: 'pain_point',
      rationale: 'Active frustration or blockers. Lead with empathy and one diagnostic question.',
      value_rank: 5,
      match_hashtags: ['pain_point', 'problem_signal'],
    },
    {
      name: 'growth',
      rationale: 'Self-development or identity-shift signal. Use aspirational but practical framing.',
      value_rank: 5,
      match_hashtags: ['growth_openness', 'identity_shift'],
    },
    {
      name: 'question',
      rationale: 'Direct information request. Provide concise value, then invite one-step continuation.',
      value_rank: 4,
      match_hashtags: ['question'],
    },
    {
      name: 'positive',
      rationale: 'Supportive sentiment without clear need. Keep warm and lightweight.',
      value_rank: 3,
      match_hashtags: ['positive_signal'],
    },
    {
      name: 'risk',
      rationale: 'Trust skepticism or scam concern. Respond with clarity and credibility.',
      value_rank: 2,
      match_hashtags: ['trust_risk'],
    },
    {
      name: 'general',
      rationale: 'Low-actionability baseline. Deprioritize unless paired with strong attributes.',
      value_rank: 1,
      match_hashtags: [],
    },
  ];
}

function defaultAttributeConfig() {
  return [
    { name: 'motivated', rationale: 'Ready to act now. Prioritize with specific, low-friction next steps.', value_rank: 5, match_hashtags: ['growth_openness', 'purchase_intent', 'identity_shift'] },
    { name: 'self_involved', rationale: 'Status-centered framing. Keep engagement brief unless stronger intent appears.', value_rank: 2, match_hashtags: ['social_handle'] },
    { name: 'negative_outlook', rationale: 'Pessimistic tone. Acknowledge first, then gently reframe toward agency.', value_rank: 2, match_hashtags: ['pain_point', 'trust_risk'] },
    { name: 'fan', rationale: 'High affinity and goodwill. Useful for rapport and lightweight engagement.', value_rank: 3, match_hashtags: ['positive_signal'] },
    { name: 'introvert', rationale: 'Reflective communication style. Prefer thoughtful prompts over hard push.', value_rank: 3, match_hashtags: ['question', 'growth_openness'] },
  ];
}

function defaultApproachConfig() {
  return [
    { name: 'ignore', rationale: 'Skip low-signal/noise comments to conserve effort for actionable conversations.', value_rank: 5, match_hashtags: ['noise'] },
    { name: 'encourage', rationale: 'Affirm momentum and reinforce identity shift. Best for growth-oriented or positive comments.', value_rank: 4, match_hashtags: ['growth_openness', 'positive_signal', 'identity_shift'] },
    { name: 'intrigue', rationale: 'Use curiosity/open loops to continue conversation when intent is emerging but not explicit.', value_rank: 3, match_hashtags: ['solution_seeking'] },
    { name: 'inquire', rationale: 'Lead with a clarifying question to diagnose context before advising. Best for pain/question comments.', value_rank: 4, match_hashtags: ['question', 'pain_point'] },
    { name: 'direct_cta', rationale: 'Offer one concrete next step when intent is explicit and friction is low.', value_rank: 5, match_hashtags: ['purchase_intent'] },
  ];
}

function normalizeConfigRows(raw, defaults, fallbackName) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = [];
    }
  }
  const normalized = toArray(parsed)
    .map((row) => {
      const name = safeText(row?.name) || fallbackName;
      const rationale = safeText(row?.rationale);
      const rankNum = Number(row?.value_rank);
      const valueRank = Math.max(1, Math.min(Number.isFinite(rankNum) ? rankNum : 3, 5));
      const tagsRaw = row?.match_hashtags || row?.match_tags;
      const matchTags = (Array.isArray(tagsRaw) ? tagsRaw : String(tagsRaw || '').split(/\r?\n|,/g))
        .map((item) => safeText(item).toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
      return { name, rationale, value_rank: valueRank, match_hashtags: Array.from(new Set(matchTags)) };
    })
    .filter((row) => Boolean(row.name));
  return normalized.length ? normalized : defaults();
}

function normalizeCategoryConfig(raw) {
  return normalizeConfigRows(raw, defaultCategoryConfig, 'general');
}

function normalizeAttributeConfig(raw) {
  return normalizeConfigRows(raw, defaultAttributeConfig, 'motivated');
}

function normalizeApproachConfig(raw) {
  return normalizeConfigRows(raw, defaultApproachConfig, 'ignore');
}

function resolveBestConfigForTags(tags = [], configRows = [], boostMap = {}) {
  const uniqueTags = Array.from(new Set(toArray(tags).map((t) => safeText(t).toLowerCase()).filter(Boolean)));
  const cfg = toArray(configRows);
  let best = null;
  cfg.forEach((row, idx) => {
    const rowTags = toArray(row?.match_hashtags || row?.match_tags).map((t) => safeText(t).toLowerCase()).filter(Boolean);
    const matchedTags = rowTags.filter((tag) => uniqueTags.includes(tag));
    const matchCount = matchedTags.length;
    const valueRank = Math.max(1, Math.min(Number(row?.value_rank || 3) || 3, 5));
    const boost = Number(boostMap[safeText(row?.name).toLowerCase()] || 0) || 0;
    const score = matchCount > 0 ? (matchCount * 100 + valueRank * 10 + (cfg.length - idx) + (boost * 15)) : (boost * 10);
    if (!best || score > best.score) {
      best = {
        name: safeText(row?.name),
        rationale: safeText(row?.rationale),
        value_rank: valueRank,
        match_hashtags: matchedTags,
        score,
      };
    }
  });
  return best && best.score > 0 ? best : null;
}

function resolveCategoryForTags(tags = [], categoryConfig = [], categoryBoost = {}) {
  const cfg = normalizeCategoryConfig(categoryConfig);
  const best = resolveBestConfigForTags(tags, cfg, categoryBoost);
  if (best) return best;
  const general = cfg.find((row) => safeText(row?.name).toLowerCase() === 'general') || cfg[0] || {};
  return {
    name: safeText(general.name) || 'general',
    rationale: safeText(general.rationale),
    value_rank: Math.max(1, Math.min(Number(general.value_rank || 1) || 1, 5)),
    match_hashtags: [],
    score: 0,
  };
}

function resolveAttributesForTags(tags = [], attributeConfig = [], attributeBoost = {}) {
  const cfg = normalizeAttributeConfig(attributeConfig);
  const uniqueTags = Array.from(new Set(toArray(tags).map((t) => safeText(t).toLowerCase()).filter(Boolean)));
  const ranked = cfg.map((row, idx) => {
    const rowTags = toArray(row?.match_hashtags || row?.match_tags).map((t) => safeText(t).toLowerCase()).filter(Boolean);
    const matchedTags = rowTags.filter((tag) => uniqueTags.includes(tag));
    const matchCount = matchedTags.length;
    const valueRank = Math.max(1, Math.min(Number(row?.value_rank || 3) || 3, 5));
    const boost = Number(attributeBoost[safeText(row?.name).toLowerCase()] || 0) || 0;
    const score = matchCount > 0 ? (matchCount * 100 + valueRank * 10 + (cfg.length - idx) + (boost * 15)) : (boost * 10);
    return {
      name: safeText(row?.name),
      rationale: safeText(row?.rationale),
      value_rank: valueRank,
      match_hashtags: matchedTags,
      score,
    };
  }).filter((row) => row.score > 0);
  ranked.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return ranked.slice(0, 4);
}

function resolveApproachForTags(tags = [], approachConfig = [], approachBoost = {}) {
  const cfg = normalizeApproachConfig(approachConfig);
  const best = resolveBestConfigForTags(tags, cfg, approachBoost);
  if (best) return best;
  const fallback = cfg.find((row) => safeText(row?.name).toLowerCase() === 'ignore') || cfg[0] || {};
  return {
    name: safeText(fallback.name) || 'ignore',
    rationale: safeText(fallback.rationale),
    value_rank: Math.max(1, Math.min(Number(fallback.value_rank || 1) || 1, 5)),
    match_hashtags: [],
    score: 0,
  };
}

function classifyComment(comment, tuning = {}) {
  const text = safeText(comment?.text).toLowerCase();
  const likeCount = Number(comment?.like_count || 0) || 0;
  const replyCount = Number(comment?.reply_count || 0) || 0;

  const has = (re) => re.test(text);
  const tags = [];
  const why = [];
  let score = 0;
  const includePhrases = Array.isArray(tuning.include_phrases) ? tuning.include_phrases : [];
  const excludePhrases = Array.isArray(tuning.exclude_phrases) ? tuning.exclude_phrases : [];
  const preferredTags = Array.isArray(tuning.preferred_hashtags)
    ? tuning.preferred_hashtags
    : (Array.isArray(tuning.preferred_tags) ? tuning.preferred_tags : []);

  if (has(/\?/) || has(/\b(how|what|why|where|when|does|can|should)\b/)) {
    tags.push('question');
    score += 3;
    why.push('question language');
  }
  if (has(/\b(help|stuck|issue|problem|error|failing|broken|cant|can't|struggle)\b/)) {
    tags.push('pain_point');
    score += 4;
    why.push('pain-point signal');
  }
  if (has(/\b(looking for|recommend|anyone know|suggest|best way|how do i)\b/)) {
    tags.push('solution_seeking');
    score += 4;
    why.push('solution-seeking language');
  }
  // Signals for identity shift / openness to change.
  if (has(/\b(want(ing)? more|outgrow(ing)?|ready for (a )?change|new chapter|next level|more to life|stuck in (my )?(life|environment)|bored (with|of)|reinvent(ing)? myself|becom(e|ing) a better version)\b/)) {
    tags.push('growth_openness');
    score += 4;
    why.push('growth-openness language');
  }
  if (has(/\b(buy|price|pricing|cost|worth it|subscribe|trial|plan)\b/)) {
    tags.push('purchase_intent');
    score += 5;
    why.push('purchase-intent language');
  }
  if (has(/\b(love|great|awesome|thanks|helpful|amazing)\b/)) {
    tags.push('positive_signal');
    score += 2;
    why.push('positive sentiment');
  }
  if (has(/\b(spam|scam|fake|bot)\b/)) {
    tags.push('trust_risk');
    score += 2;
    why.push('trust-risk language');
  }
  if (has(/https?:\/\/|www\./)) {
    tags.push('link_out');
    score += 1;
    why.push('external link');
  }
  if (has(/@\w+/)) {
    tags.push('social_handle');
    score += 1;
    why.push('social handle mention');
  }

  preferredTags.forEach((tag) => {
    if (!tag) return;
    if (tags.includes(tag)) {
      score += 2;
      why.push(`trainer preferred hashtag: "${tag}"`);
    }
  });

  includePhrases.forEach((phrase) => {
    if (!phrase) return;
    if (text.includes(phrase)) {
      tags.push('trainer_include');
      score += 3;
      why.push(`trainer include: "${phrase}"`);
    }
  });
  excludePhrases.forEach((phrase) => {
    if (!phrase) return;
    if (text.includes(phrase)) {
      tags.push('trainer_exclude');
      score -= 6;
      why.push(`trainer exclude: "${phrase}"`);
    }
  });

  if (likeCount >= 5) {
    score += 2;
    why.push('social proof: likes >= 5');
  }
  if (replyCount >= 2) {
    score += 1;
    why.push('discussion depth: replies >= 2');
  }
  if (text.length < 15) {
    score -= 2;
    why.push('short comment penalty');
  }
  if (has(/\b(first|lol|lmao|nice|cool|bro)\b/) && text.length < 35) {
    score -= 2;
    why.push('low-signal slang penalty');
  }

  const isNoise = has(/\b(first|lol|lmao|nice|cool|bro|sub4sub|follow me)\b/) && text.length < 45;
  if (isNoise) tags.push('noise');

  const categoryResolved = resolveCategoryForTags(tags, tuning.category_config, tuning.category_boost || {});
  const attributesResolved = resolveAttributesForTags(tags, tuning.attribute_config, tuning.attribute_boost || {});
  const approachResolved = resolveApproachForTags(tags, tuning.approach_config, tuning.approach_boost || {});
  if (safeText(categoryResolved?.name)) {
    why.push(`category: ${safeText(categoryResolved.name)}`);
  }
  if (safeText(categoryResolved?.rationale)) {
    why.push(`category rationale: ${safeText(categoryResolved.rationale)}`);
  }
  if (attributesResolved.length) {
    why.push(`attributes: ${attributesResolved.map((row) => safeText(row?.name)).filter(Boolean).join(', ')}`);
  }
  if (safeText(approachResolved?.name)) {
    why.push(`approach: ${safeText(approachResolved.name)}`);
  }

  return {
    score,
    hashtags: Array.from(new Set(tags)),
    tags: Array.from(new Set(tags)),
    why: Array.from(new Set(why)),
    category: safeText(categoryResolved?.name) || 'general',
    category_rationale: safeText(categoryResolved?.rationale),
    category_value_rank: Number(categoryResolved?.value_rank || 0) || 0,
    category_match_hashtags: toArray(categoryResolved?.match_hashtags || categoryResolved?.match_tags),
    category_match_tags: toArray(categoryResolved?.match_hashtags || categoryResolved?.match_tags),
    attributes: attributesResolved.map((row) => safeText(row?.name)).filter(Boolean),
    attribute_names: attributesResolved.map((row) => safeText(row?.name)).filter(Boolean),
    attribute_rationales: attributesResolved.map((row) => safeText(row?.rationale)).filter(Boolean),
    approach: safeText(approachResolved?.name) || 'ignore',
    approach_name: safeText(approachResolved?.name) || 'ignore',
    approach_rationale: safeText(approachResolved?.rationale),
    approach_value_rank: Number(approachResolved?.value_rank || 0) || 0,
    is_noise: isNoise,
  };
}

function buildReplyDraft(classified, comment, trainingSignals = {}) {
  const author = safeText(comment?.author) || 'there';
  const commentText = safeText(comment?.text).replace(/\s+/g, ' ');
  const commentSnippet = commentText.slice(0, 140);
  const base = `Thanks ${author} for sharing this.`;
  const tags = toArray(classified?.hashtags || classified?.tags).map((tag) => safeText(tag));
  const approach = safeText(classified?.approach || classified?.approach_name).toLowerCase();
  const responseContext = safeText(trainingSignals?.response_context || '');
  const responseGuidelines = safeText(trainingSignals?.response_guidelines || '').toLowerCase();
  const responseTypePreference = trainingSignals?.response_type_preference || {};
  const preferredResponseType = Object.entries(responseTypePreference)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([name]) => safeText(name))
    .find(Boolean);
  const contextBridge = (() => {
    if (!responseContext) return '';
    const ctx = responseContext.toLowerCase();
    if (/\bisitas\b/.test(ctx)) {
      if (tags.includes('growth_openness') || tags.includes('pain_point') || tags.includes('solution_seeking') || tags.includes('question')) {
        return 'If useful, I can connect this to an ISITAS-style next step that stays practical.';
      }
      return 'If useful, I can frame this through the ISITAS lens in one practical step.';
    }
    if (tags.includes('growth_openness') || tags.includes('pain_point') || tags.includes('solution_seeking')) {
      return 'If useful, I can suggest one practical next step based on your goals.';
    }
    return '';
  })();

  function withContext(text) {
    if (!contextBridge) return text;
    return `${text} ${contextBridge}`.trim();
  }

  function withGuidelines(text) {
    let output = safeText(text);
    if (!output) return output;
    if (commentSnippet) {
      output = `${output} You wrote: "${commentSnippet}".`;
    }
    if (responseGuidelines.includes('no links') || responseGuidelines.includes('avoid links')) {
      output = output.replace(/\s*https?:\/\/\S+/gi, '').trim();
    }
    if (responseGuidelines.includes('no question') || responseGuidelines.includes('avoid question')) {
      output = output.replace(/\?/g, '.').replace(/\s{2,}/g, ' ').trim();
    }
    return output;
  }

  if (approach === 'ignore') {
    return 'No reply suggested for this comment.';
  }
  if (approach === 'intrigue') {
    return withGuidelines(withContext(`${base} You’re pointing at something important. If you want, I can share one angle most people miss here.`));
  }
  if (approach === 'inquire') {
    return withGuidelines(withContext(`${base} Quick question: what outcome are you aiming for first?`));
  }
  if (approach === 'direct_cta') {
    return withGuidelines(withContext(`${base} If you’re ready, I can share a direct next step you can start today.`));
  }
  if (tags.includes('purchase_intent')) {
    return withGuidelines(withContext(`${base} ${preferredResponseType === 'cta_direct'
      ? 'If you are ready, start here and I can walk you through each step.'
      : 'If you want, I can share a quick comparison and the fastest way to get started.'}`));
  }
  if (tags.includes('growth_openness')) {
    return withGuidelines(withContext(`${base} That shift you described is real. If you want, I can share a simple path to move from feeling stuck to clear next steps.`));
  }
  if (tags.includes('pain_point') || tags.includes('solution_seeking')) {
    return withGuidelines(withContext(`${base} That sounds frustrating. If you describe your exact setup, I can suggest a concrete fix path.`));
  }
  if (tags.includes('question')) {
    return withGuidelines(withContext(`${base} Great question. The short answer is: start with a simple baseline, then iterate based on what your audience responds to.`));
  }
  if (tags.includes('positive_signal')) {
    return withGuidelines(withContext(`${base} Glad this helped. Curious what part was most useful for you?`));
  }
  if (tags.includes('trust_risk')) {
    return withGuidelines(withContext(`${base} Good call to be cautious. Verifying sources and outcomes before acting is the safest move.`));
  }
  return withGuidelines(withContext(`${base} Appreciate the perspective.`));
}

async function runYoutubeCommentMiner(rawInput = {}) {
  const cfg = youtubeApiConfig();
  if (!cfg.apiKey) {
    return {
      ok: false,
      status: 400,
      error: 'YouTube API key is not configured. Go to Settings > APIs > YouTube and add your key.',
    };
  }

  const targets = toArrayTargets(rawInput.targets || rawInput.targets_text);
  if (!targets.length) {
    return { ok: false, status: 400, error: 'Provide at least one video or channel target.' };
  }

  const videosPerChannel = Math.max(1, Math.min(Number(rawInput.videos_per_channel || 5) || 5, 20));
  const maxCommentsPerVideo = Math.max(1, Math.min(Number(rawInput.max_comments_per_video || 100) || 100, 500));
  const includeReplies = rawInput.include_replies === true;
  const sortBy = safeText(rawInput.sort_by) === 'time' ? 'time' : 'relevance';
  const minScore = Math.max(0, Math.min(Number(rawInput.min_score || 3) || 3, 20));
  const excludeNoise = rawInput.exclude_noise !== false;
  const includePhrases = parsePhraseList(rawInput.include_phrases_text || rawInput.include_phrases);
  const excludePhrases = parsePhraseList(rawInput.exclude_phrases_text || rawInput.exclude_phrases);
  const categoryConfig = normalizeCategoryConfig(rawInput.category_config || rawInput.category_config_json);
  const attributeConfig = normalizeAttributeConfig(rawInput.attribute_config || rawInput.attribute_config_json);
  const approachConfig = normalizeApproachConfig(rawInput.approach_config || rawInput.approach_config_json);
  const trainingFeedback = normalizeTrainingFeedback(rawInput.training_feedback || rawInput.trainer_feedback);
  const trainingSignals = buildTrainingSignals(trainingFeedback);
  const responseContext = safeText(rawInput.response_context || rawInput.project_context).slice(0, 5000);
  const responseGuidelines = safeText(rawInput.response_guidelines || rawInput.reply_guidelines).slice(0, 5000);
  trainingSignals.response_context = responseContext;
  trainingSignals.response_guidelines = responseGuidelines;
  const mergedIncludePhrases = Array.from(new Set([...includePhrases, ...toArray(trainingSignals.include_terms)])).slice(0, 150);
  const mergedExcludePhrases = Array.from(new Set([...excludePhrases, ...toArray(trainingSignals.exclude_terms)])).slice(0, 150);

  const resolvedVideos = [];
  const warnings = [];
  const seen = new Set();

  for (const rawTarget of targets) {
    const parsed = parseYoutubeTarget(rawTarget);
    try {
      if (parsed.type === 'video') {
        const key = safeText(parsed.video_id || parsed.videoId);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        resolvedVideos.push({
          source_target: rawTarget,
          source_type: 'video',
          video_url: parsed.canonical || `https://www.youtube.com/watch?v=${key}`,
          video_id: key,
        });
        continue;
      }

      let channelId = '';
      if (parsed.type === 'channel') channelId = safeText(parsed.channelId);
      if (parsed.type === 'channel_handle') channelId = await resolveChannelIdFromHandle(parsed.handle, cfg.apiKey);

      if (channelId) {
        const videos = await listRecentChannelVideos(channelId, videosPerChannel, cfg.apiKey);
        if (!videos.length) {
          warnings.push(`No recent videos found for channel target: ${rawTarget}`);
        }
        videos.forEach((video) => {
          const key = safeText(video.video_id);
          if (!key || seen.has(key)) return;
          seen.add(key);
          resolvedVideos.push({
            source_target: rawTarget,
            source_type: 'channel',
            channel_id: channelId,
            video_url: safeText(video.video_url),
            video_id: key,
            title_hint: safeText(video.title),
            channel_name_hint: safeText(video.channel_name),
          });
        });
      } else {
        warnings.push(`Could not parse target as YouTube video/channel: ${rawTarget}`);
      }
    } catch (err) {
      warnings.push(`${rawTarget}: ${safeText(err?.message) || 'failed to resolve target'}`);
    }
  }

  if (!resolvedVideos.length) {
    return {
      ok: false,
      status: 400,
      error: 'No valid videos resolved from targets.',
      data: { warnings },
    };
  }

  const perVideo = [];
  const allClassified = [];
  const errors = [];

  for (const video of resolvedVideos) {
    try {
      const result = await runYoutubeCommentAcquire({
        video_url: video.video_url,
        max_comments: maxCommentsPerVideo,
        include_replies: includeReplies,
        sort_by: sortBy,
      });

      const comments = Array.isArray(result?.comments) ? result.comments : [];
      const classifiedComments = comments.map((comment) => {
        const classified = classifyComment(comment, {
          include_phrases: mergedIncludePhrases,
          exclude_phrases: mergedExcludePhrases,
          preferred_hashtags: toArray(trainingSignals.preferred_hashtags || trainingSignals.preferred_tags),
          category_boost: trainingSignals.category_boost,
          attribute_boost: trainingSignals.attribute_boost || {},
          approach_boost: trainingSignals.approach_boost || trainingSignals.response_type_preference || {},
          category_config: categoryConfig,
          attribute_config: attributeConfig,
          approach_config: approachConfig,
        });
        return {
          ...comment,
          ...classified,
          video_id: safeText(result?.video_id || video.video_id),
          video_url: safeText(result?.video_url || video.video_url),
          video_title: safeText(result?.title || video.title_hint || ''),
          channel_name: safeText(result?.channel_name || video.channel_name_hint || ''),
          source_target: video.source_target,
          reply_draft: buildReplyDraft(classified, comment, trainingSignals),
        };
      });

      perVideo.push({
        source_target: video.source_target,
        video_id: safeText(result?.video_id || video.video_id),
        video_url: safeText(result?.video_url || video.video_url),
        video_title: safeText(result?.title || video.title_hint || ''),
        channel_name: safeText(result?.channel_name || video.channel_name_hint || ''),
        stats: result?.stats || {},
      });
      allClassified.push(...classifiedComments);
    } catch (err) {
      errors.push({
        source_target: video.source_target,
        video_url: video.video_url,
        error: safeText(err?.message) || 'comment acquire failed',
      });
    }
  }

  const filtered = allClassified
    .filter((row) => Number(row.score || 0) >= minScore)
    .filter((row) => (excludeNoise ? !row.is_noise : true))
    .sort((a, b) => {
      const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return Number(b.like_count || 0) - Number(a.like_count || 0);
    });

  const categoryCounts = filtered.reduce((acc, row) => {
    const key = safeText(row.topic) || 'general';
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const attributeCounts = filtered.reduce((acc, row) => {
    toArray(row.attributes || row.attribute_names).forEach((name) => {
      const key = safeText(name);
      if (!key) return;
      acc[key] = Number(acc[key] || 0) + 1;
    });
    return acc;
  }, {});
  const approachCounts = filtered.reduce((acc, row) => {
    const key = safeText(row.approach || row.approach_name);
    if (!key) return acc;
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  const tagCounts = filtered.reduce((acc, row) => {
    const tags = Array.isArray(row.hashtags) ? row.hashtags : (Array.isArray(row.tags) ? row.tags : []);
    tags.forEach((tag) => {
      const key = safeText(tag);
      if (!key) return;
      acc[key] = Number(acc[key] || 0) + 1;
    });
    return acc;
  }, {});

  return {
    ok: true,
    status: 200,
    data: {
      input: {
        target_count: targets.length,
        videos_per_channel: videosPerChannel,
        max_comments_per_video: maxCommentsPerVideo,
        include_replies: includeReplies,
        sort_by: sortBy,
        min_score: minScore,
        exclude_noise: excludeNoise,
        include_phrases: includePhrases,
        exclude_phrases: excludePhrases,
        merged_include_phrases: mergedIncludePhrases,
        merged_exclude_phrases: mergedExcludePhrases,
        training_feedback_count: trainingFeedback.length,
        response_context: responseContext,
        response_guidelines: responseGuidelines,
        training_signals: trainingSignals,
        category_config: categoryConfig,
        attribute_config: attributeConfig,
        approach_config: approachConfig,
      },
      stats: {
        resolved_videos: resolvedVideos.length,
        acquired_videos: perVideo.length,
        total_comments_raw: allClassified.length,
        total_comments_filtered: filtered.length,
      },
      per_video: perVideo,
      category_counts: categoryCounts,
      attribute_counts: attributeCounts,
      approach_counts: approachCounts,
      hashtag_counts: tagCounts,
      tag_counts: tagCounts,
      comments: filtered.slice(0, 500),
      warnings,
      errors,
    },
  };
}

module.exports = {
  runYoutubeCommentMiner,
};
