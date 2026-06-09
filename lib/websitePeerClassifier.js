'use strict';

const { queryGemini, parseJsonFromModelText, isGeminiConfigured } = require('./geminiClient');
const { listWebsitePeers } = require('./websitePeersStore');
const {
  WEBSITE_PEER_MODELS,
  TIER_ONE_HEURISTIC_MODELS,
  suggestedReferenceRole,
  normalizeWebsiteModel,
} = require('./websitePeerTaxonomy');

const BATCH_SIZE = 25;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const FEW_SHOT_LIMIT = 20;

const CLASSIFICATION_SYSTEM = `You classify discovered websites relative to a project website.
Return strict JSON only in this shape:
{"classifications":[{"domain":"example.com","website_model":"Direct Competitors","suggested_reference_role":"peer","confidence":0.82,"rationale":"short reason"}]}

Rules:
- website_model MUST be exactly one value from the provided taxonomy list.
- suggested_reference_role MUST be "peer" or "model".
- Use "peer" for Direct Competitors and other true competitive peers at similar scale.
- Use "model" for reference archetypes: Mega hubs, Media Giants and Publishers, Comparison Sites, Multinational Corporations, Industry Hubs and Publications, Thought Leaders/Influencers, Large Institutions/Organization, directories, and national publishers.
- Prefer peers that resemble the project site's scale, service, and market — not directories, media giants, or legal aggregators.
- confidence is a number from 0 to 1.
- rationale is one concise sentence.
- Return one classification object per candidate domain in the batch.`;

function getClassificationProvider() {
  const raw = String(process.env.PEER_CLASSIFICATION_PROVIDER || 'hybrid').trim().toLowerCase();
  if (raw === 'gemini' || raw === 'heuristic') return raw;
  return 'hybrid';
}

function classificationModel() {
  return String(process.env.PEER_CLASSIFICATION_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function shouldUseGemini(provider = getClassificationProvider()) {
  if (provider === 'heuristic') return false;
  return isGeminiConfigured();
}

function isTierOneHeuristic(candidate) {
  const model = String(candidate?.website_model || '').trim();
  const source = String(candidate?.classification_source || 'heuristic').trim();
  return source === 'heuristic' && TIER_ONE_HEURISTIC_MODELS.has(model);
}

async function loadFewShotExamples(scope, limit = FEW_SHOT_LIMIT) {
  const result = await listWebsitePeers(Math.max(limit, 50), scope);
  if (!result.ok) return [];
  return (Array.isArray(result.data) ? result.data : [])
    .filter((peer) => String(peer?.domain || '').trim() && String(peer?.website_model || '').trim())
    .slice(0, limit)
    .map((peer) => ({
      domain: String(peer.domain || '').trim().toLowerCase(),
      url: String(peer.site_url || '').trim(),
      title: String(peer.title || '').trim(),
      website_model: normalizeWebsiteModel(peer.website_model),
      suggested_reference_role: String(peer.reference_role || peer.metadata?.reference_role || suggestedReferenceRole(peer.website_model)).trim().toLowerCase() === 'model'
        ? 'model'
        : 'peer',
      snippet: String(peer.snippet || '').trim().slice(0, 240),
    }));
}

function buildClassificationContext({
  sourceUrl,
  sourceDomain,
  fingerprint,
  keywordSummary,
  searchedKeywords,
  fewShotExamples,
}) {
  const keywords = (Array.isArray(keywordSummary?.top_keywords) ? keywordSummary.top_keywords : [])
    .slice(0, 15)
    .map((item) => String(item?.keyword || '').trim())
    .filter(Boolean);
  return {
    project: {
      source_url: String(sourceUrl || '').trim(),
      source_domain: String(sourceDomain || '').trim().toLowerCase(),
      title: String(fingerprint?.title || '').trim(),
      meta_desc: String(fingerprint?.meta_desc || '').trim(),
      headings: String(fingerprint?.headings || '').trim().slice(0, 600),
      topic_terms: Array.isArray(fingerprint?.topic_terms) ? fingerprint.topic_terms.slice(0, 15) : [],
      searched_keywords: Array.isArray(searchedKeywords) ? searchedKeywords : keywords,
      top_keywords: keywords,
    },
    taxonomy: WEBSITE_PEER_MODELS.slice(),
    examples: Array.isArray(fewShotExamples) ? fewShotExamples : [],
  };
}

function compactCandidate(candidate) {
  return {
    domain: String(candidate?.domain || '').trim().toLowerCase(),
    url: String(candidate?.url || '').trim(),
    title: String(candidate?.title || '').trim().slice(0, 240),
    snippet: String(candidate?.snippet || '').trim().slice(0, 400),
    matched_keywords: (Array.isArray(candidate?.matched_keywords) ? candidate.matched_keywords : []).slice(0, 8),
    heuristic_model: String(candidate?.website_model || '').trim(),
    heuristic_role: String(candidate?.suggested_reference_role || '').trim(),
    homepage_title: String(candidate?.homepage_title || '').trim().slice(0, 180),
    homepage_meta: String(candidate?.homepage_meta || '').trim().slice(0, 240),
  };
}

function normalizeClassificationEntry(entry) {
  const domain = String(entry?.domain || '').trim().toLowerCase();
  if (!domain) return null;
  const websiteModel = normalizeWebsiteModel(entry?.website_model);
  let role = String(entry?.suggested_reference_role || '').trim().toLowerCase();
  if (role !== 'peer' && role !== 'model') {
    role = suggestedReferenceRole(websiteModel);
  }
  if (websiteModel === 'Direct Competitors') role = 'peer';
  const confidence = Math.max(0, Math.min(Number(entry?.confidence || 0) || 0, 1));
  const rationale = String(entry?.rationale || '').trim().slice(0, 500);
  return {
    domain,
    website_model: websiteModel,
    suggested_reference_role: role,
    confidence,
    rationale,
  };
}

async function classifyCandidateBatch(candidates, context) {
  const batch = (Array.isArray(candidates) ? candidates : []).map(compactCandidate).filter((item) => item.domain);
  if (!batch.length) {
    return { ok: true, classifications: [], tokens: 0, error: '' };
  }

  const prompt = [
    'Classify each candidate website relative to the project website.',
    '',
    'Project context:',
    JSON.stringify(context.project, null, 2),
    '',
    'Allowed taxonomy:',
    JSON.stringify(context.taxonomy, null, 2),
    '',
    'Known examples from this project (use as guidance):',
    JSON.stringify(context.examples, null, 2),
    '',
    'Candidates:',
    JSON.stringify(batch, null, 2),
  ].join('\n');

  const res = await queryGemini(CLASSIFICATION_SYSTEM, prompt, {
    model: classificationModel(),
    temperature: 0.2,
    responseMimeType: 'application/json',
    timeoutMs: 90000,
  });
  if (!res.ok) {
    return { ok: false, classifications: [], tokens: 0, error: res.error || 'Gemini classification failed' };
  }

  const parsed = parseJsonFromModelText(res.text);
  const rows = Array.isArray(parsed?.classifications) ? parsed.classifications : [];
  const classifications = rows.map(normalizeClassificationEntry).filter(Boolean);
  return {
    ok: classifications.length > 0,
    classifications,
    tokens: Number(res.tokens || 0) || 0,
    error: classifications.length ? '' : 'Gemini returned no valid classifications',
  };
}

function applyClassificationOverride(candidate, override) {
  if (!override) return candidate;
  const referenceRole = override.suggested_reference_role === 'model' ? 'model' : 'peer';
  const peerBoost = referenceRole === 'peer' ? 4 : 0;
  const directCompetitorBoost = override.website_model === 'Direct Competitors' ? 3 : 0;
  const similarity = Number(candidate?.similarity_score || 0) || 0;
  const reasons = override.rationale
    ? [override.rationale]
    : (Array.isArray(candidate?.reasons) ? candidate.reasons : ['Classified from search listing']);
  return {
    ...candidate,
    website_model: override.website_model,
    suggested_reference_role: referenceRole,
    similarity_score: similarity,
    sort_score: similarity + peerBoost + directCompetitorBoost,
    reasons,
    classification_source: 'gemini',
    classification_confidence: override.confidence,
    classification_rationale: override.rationale,
  };
}

async function applyHybridClassification(heuristicCandidates, options = {}) {
  const provider = getClassificationProvider();
  const candidates = Array.isArray(heuristicCandidates) ? heuristicCandidates : [];
  const meta = {
    provider,
    gemini_configured: isGeminiConfigured(),
    gemini_used: false,
    tokens: 0,
    errors: [],
    classified_by_gemini: 0,
    classified_by_heuristic: 0,
  };

  if (!shouldUseGemini(provider)) {
    meta.classified_by_heuristic = candidates.length;
    return {
      results: candidates.map((item) => ({
        ...item,
        classification_source: item.classification_source || 'heuristic',
      })),
      meta,
    };
  }

  const fewShotExamples = await loadFewShotExamples(options.scope, FEW_SHOT_LIMIT);
  const context = buildClassificationContext({
    sourceUrl: options.sourceUrl,
    sourceDomain: options.sourceDomain,
    fingerprint: options.fingerprint,
    keywordSummary: options.keywordSummary,
    searchedKeywords: options.searchedKeywords,
    fewShotExamples,
  });

  const geminiTargets = provider === 'gemini'
    ? candidates
    : candidates.filter((item) => !isTierOneHeuristic(item));

  const classificationByDomain = new Map();
  for (let index = 0; index < geminiTargets.length; index += BATCH_SIZE) {
    const slice = geminiTargets.slice(index, index + BATCH_SIZE);
    const batchRes = await classifyCandidateBatch(slice, context);
    meta.tokens += Number(batchRes.tokens || 0) || 0;
    if (!batchRes.ok) {
      meta.errors.push(batchRes.error || 'Gemini batch classification failed');
      continue;
    }
    meta.gemini_used = true;
    batchRes.classifications.forEach((entry) => {
      classificationByDomain.set(entry.domain, entry);
    });
  }

  const results = candidates.map((candidate) => {
    const domain = String(candidate?.domain || '').trim().toLowerCase();
    const override = classificationByDomain.get(domain);
    if (override) {
      meta.classified_by_gemini += 1;
      return applyClassificationOverride(candidate, override);
    }
    meta.classified_by_heuristic += 1;
    return {
      ...candidate,
      classification_source: candidate.classification_source || 'heuristic',
    };
  });

  return { results, meta };
}

module.exports = {
  BATCH_SIZE,
  getClassificationProvider,
  shouldUseGemini,
  loadFewShotExamples,
  buildClassificationContext,
  classifyCandidateBatch,
  applyHybridClassification,
};
