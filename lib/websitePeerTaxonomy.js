'use strict';

const WEBSITE_PEER_MODELS = [
  'Mega hubs',
  'Industry Hubs and Publications',
  'Comparison Sites',
  'Multinational Corporations',
  'Large Institutions/Organization',
  'Media Giants and Publishers',
  'Thought Leaders/Influencers',
  'Direct Competitors',
  'Academic / Research',
  'Government / Civic',
  'Communities / Forums',
  'Tools / SaaS Platforms',
  'Agencies / Consultancies',
  'Directories / Marketplaces',
  'Nonprofit / Advocacy',
  'Local / Regional Organizations',
];

const MODEL_PRIMARY_CATEGORIES = new Set([
  'Mega hubs',
  'Comparison Sites',
  'Media Giants and Publishers',
  'Multinational Corporations',
]);

const TIER_ONE_HEURISTIC_MODELS = new Set([
  'Mega hubs',
  'Comparison Sites',
  'Media Giants and Publishers',
]);

function suggestedReferenceRole(primaryModel) {
  const model = String(primaryModel || '').trim();
  if (MODEL_PRIMARY_CATEGORIES.has(model)) return 'model';
  if (model === 'Thought Leaders/Influencers') return 'model';
  return 'peer';
}

function isValidWebsiteModel(model) {
  return WEBSITE_PEER_MODELS.includes(String(model || '').trim());
}

function normalizeWebsiteModel(model, fallback = 'Direct Competitors') {
  const value = String(model || '').trim();
  return isValidWebsiteModel(value) ? value : fallback;
}

module.exports = {
  WEBSITE_PEER_MODELS,
  MODEL_PRIMARY_CATEGORIES,
  TIER_ONE_HEURISTIC_MODELS,
  suggestedReferenceRole,
  isValidWebsiteModel,
  normalizeWebsiteModel,
};
