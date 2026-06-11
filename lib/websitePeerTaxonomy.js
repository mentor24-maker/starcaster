'use strict';

/**
 * One-line identification guide for each website category.
 * Distilled from the competitive-landscape framework: who dominates SERPs,
 * who is a reference archetype (model), and who is a true peer.
 */
const WEBSITE_PEER_MODEL_GUIDE = [
  {
    model: 'Mega hubs',
    role_hint: 'model',
    definition: 'Massive UGC/crowdsourced platforms (Wikipedia, Amazon, Quora, Medium) with huge breadth and DA; dominate root terms; never a peer.',
  },
  {
    model: 'Industry Hubs and Publications',
    role_hint: 'model',
    definition: 'Topic-specific portals with deep, fresh content in one industry; high authority in their niche; reference archetype, not a peer.',
  },
  {
    model: 'Comparison Sites',
    role_hint: 'model',
    definition: 'Review and ranking intermediaries (G2, Capterra, Avvo, Healthgrades) that aggregate options; own category root terms; model not peer.',
  },
  {
    model: 'Multinational Corporations',
    role_hint: 'model',
    definition: 'Large global brands with massive DA, SEO teams, and content volume; model unless same niche at clearly similar scale.',
  },
  {
    model: 'Large Institutions/Organization',
    role_hint: 'model',
    definition: 'Universities, major nonprofits, government bodies, religious orgs; high stature/DA; compete by size and reputation, not niche service overlap.',
  },
  {
    model: 'Media Giants and Publishers',
    role_hint: 'model',
    definition: 'News, magazine, and entertainment publishers with professional content operations and strong SERP presence; model not peer.',
  },
  {
    model: 'Thought Leaders/Influencers',
    role_hint: 'model',
    definition: 'Individual experts, consultants, creators, or small firms building authority via content; often model/reference; peer only if same offering at similar scale.',
  },
  {
    model: 'Direct Competitors',
    role_hint: 'peer',
    definition: 'Same product, service, and market at similar scale — the usual suspects you benchmark against; true peers.',
  },
  {
    model: 'Academic / Research',
    role_hint: 'model',
    definition: 'Universities, research labs, and scholarly publications; model reference for expertise and citations.',
  },
  {
    model: 'Government / Civic',
    role_hint: 'model',
    definition: 'Government agencies and civic institutions; model reference, not commercial peers.',
  },
  {
    model: 'Communities / Forums',
    role_hint: 'model',
    definition: 'Discussion boards and community platforms; model unless the community itself is the direct competitive product.',
  },
  {
    model: 'Tools / SaaS Platforms',
    role_hint: 'peer',
    definition: 'Software or SaaS vendors; peer when same product category and scale, otherwise model/reference.',
  },
  {
    model: 'Agencies / Consultancies',
    role_hint: 'peer',
    definition: 'Service firms and consultancies; peer when same specialty, geography, and client scale as the project site.',
  },
  {
    model: 'Directories / Marketplaces',
    role_hint: 'model',
    definition: 'Listing sites and marketplaces that help users find providers; aggregators, not direct service competitors.',
  },
  {
    model: 'Nonprofit / Advocacy',
    role_hint: 'model',
    definition: 'Mission-driven and advocacy organizations; model reference unless directly competing for the same paying clients.',
  },
  {
    model: 'Local / Regional Organizations',
    role_hint: 'peer',
    definition: 'Geo-focused businesses or orgs; peer when same locale and service; otherwise regional model/reference.',
  },
];

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
  if (model === 'Direct Competitors') return 'peer';
  return 'model';
}

function isValidWebsiteModel(model) {
  return WEBSITE_PEER_MODELS.includes(String(model || '').trim());
}

function normalizeWebsiteModel(model, fallback = 'Direct Competitors') {
  const value = String(model || '').trim();
  return isValidWebsiteModel(value) ? value : fallback;
}

function getWebsitePeerModelGuide() {
  return WEBSITE_PEER_MODEL_GUIDE.map((entry) => ({ ...entry }));
}

function getWebsitePeerModelGuideForPrompt() {
  return WEBSITE_PEER_MODEL_GUIDE.map((entry) => ({
    category: entry.model,
    typical_role: entry.role_hint,
    identify_by: entry.definition,
  }));
}

module.exports = {
  WEBSITE_PEER_MODELS,
  WEBSITE_PEER_MODEL_GUIDE,
  MODEL_PRIMARY_CATEGORIES,
  TIER_ONE_HEURISTIC_MODELS,
  suggestedReferenceRole,
  isValidWebsiteModel,
  normalizeWebsiteModel,
  getWebsitePeerModelGuide,
  getWebsitePeerModelGuideForPrompt,
};
