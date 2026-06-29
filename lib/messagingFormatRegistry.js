'use strict';

const FAMILY = {
  SHORT_FORM: 'short-form',
  SOCIAL_SHORT: 'social-short',
  SOCIAL_MEDIUM: 'social-medium',
  EMAIL: 'email',
  SUPPORT: 'support',
  SUPPORT_TAGS: 'support-tags',
  SUPPORT_CTA: 'support-cta',
  LONG_FORM: 'long-form',
};

// One entry per messaging format. All 16 default formats are listed here.
// Slugs use the singular form to match FIELD_TYPE_OPTIONS IDs and existing handler keys.
const FORMAT_REGISTRY = {
  tweet: {
    slug: 'tweet',
    label: 'Tweet',
    family: FAMILY.SOCIAL_SHORT,
    contentField: 'content',
    isLongform: false,
    aiDescriptor: 'a tweet (conversational and punchy, maximum 280 characters)',
    maxChars: 280,
  },
  headline: {
    slug: 'headline',
    label: 'Headline',
    family: FAMILY.SHORT_FORM,
    contentField: 'headline',
    isLongform: false,
    aiDescriptor: 'a headline (5 to 12 words, title case, attention-grabbing)',
    maxWords: 12,
  },
  subheading: {
    slug: 'subheading',
    label: 'Sub-heading',
    family: FAMILY.SHORT_FORM,
    contentField: 'subheading',
    isLongform: false,
    aiDescriptor: 'a sub-heading (5 to 20 words, supports and elaborates on the main point)',
    maxWords: 20,
  },
  tagline: {
    slug: 'tagline',
    label: 'Tagline',
    family: FAMILY.SHORT_FORM,
    contentField: 'tagline',
    isLongform: false,
    aiDescriptor: 'a tagline (3 to 12 words, memorable brand phrase)',
    maxWords: 12,
  },
  pitch: {
    slug: 'pitch',
    label: 'Pitch',
    family: FAMILY.SHORT_FORM,
    contentField: 'pitch',
    isLongform: false,
    aiDescriptor: 'an elevator pitch (100 to 300 characters, compelling and direct)',
    maxChars: 300,
  },
  email: {
    slug: 'email',
    label: 'Email',
    family: FAMILY.EMAIL,
    contentField: 'email',
    isLongform: false,
    aiDescriptor: 'an email body (150 to 500 words, conversational and persuasive, no subject line)',
    minWords: 150,
    maxWords: 500,
  },
  post: {
    slug: 'post',
    label: 'Post',
    family: FAMILY.SOCIAL_MEDIUM,
    contentField: 'post',
    isLongform: false,
    aiDescriptor: 'a social media post (250 to 500 characters, engaging and informative)',
    minChars: 250,
    maxChars: 500,
  },
  description: {
    slug: 'description',
    label: 'Description',
    family: FAMILY.SUPPORT,
    contentField: 'description',
    isLongform: false,
    aiDescriptor: 'a description (100 to 500 characters, clear and scannable)',
    maxChars: 500,
  },
  transcript: {
    slug: 'transcript',
    label: 'Transcript',
    family: FAMILY.SUPPORT,
    contentField: 'transcript',
    isLongform: false,
    aiDescriptor: 'a spoken-word transcript (natural conversational tone, no formal structure)',
  },
  comment: {
    slug: 'comment',
    label: 'Comment',
    family: FAMILY.SUPPORT,
    contentField: 'comment',
    isLongform: false,
    aiDescriptor: 'a social media comment (50 to 300 characters, conversational and on-topic)',
    maxChars: 300,
  },
  hashtag: {
    slug: 'hashtag',
    label: 'Hashtag',
    family: FAMILY.SUPPORT_TAGS,
    contentField: 'hashtag',
    isLongform: false,
    // Each line of the AI response becomes a separate hashtag record.
    aiDescriptor: '5 to 10 relevant hashtags (each starting with #, one per line, nothing else)',
  },
  cta: {
    slug: 'cta',
    label: 'Call to Action',
    family: FAMILY.SUPPORT_CTA,
    contentField: 'cta',
    isLongform: false,
    aiDescriptor: 'a call to action (8 to 15 words, action-oriented, starts with an active verb)',
    maxWords: 15,
  },
  article: {
    slug: 'article',
    label: 'Article',
    family: FAMILY.LONG_FORM,
    contentField: 'content',
    titleField: 'title',
    isLongform: true,
    aiDescriptor: 'a full article (500 to 3000 words)',
    minWords: 500,
    maxWords: 3000,
  },
  report: {
    slug: 'report',
    label: 'Report',
    family: FAMILY.LONG_FORM,
    contentField: 'content',
    titleField: 'title',
    isLongform: true,
    aiDescriptor: 'a structured report (1000 to 5000 words, with clear sections)',
    minWords: 1000,
    maxWords: 5000,
  },
  'white-paper': {
    slug: 'white-paper',
    label: 'White Paper',
    family: FAMILY.LONG_FORM,
    contentField: 'content',
    titleField: 'title',
    isLongform: true,
    aiDescriptor: 'an authoritative white paper (2000 or more words, formal tone, with titled sections)',
    minWords: 2000,
  },
  ebook: {
    slug: 'ebook',
    label: 'eBook',
    family: FAMILY.LONG_FORM,
    contentField: 'content',
    titleField: 'title',
    isLongform: true,
    aiDescriptor: 'an eBook chapter (3000 or more words, educational tone, with sections and examples)',
    minWords: 3000,
  },
  'web-page': {
    slug: 'web-page',
    label: 'Web Page',
    family: FAMILY.LONG_FORM,
    contentField: 'content',
    titleField: 'title',
    isLongform: true,
    aiDescriptor: 'a web page (clear page title and readable body copy distilled from site content)',
    minWords: 50,
  },
};

function getFormatSpec(slug) {
  return FORMAT_REGISTRY[String(slug || '').trim().toLowerCase()] || null;
}

function listFormatSlugs() {
  return Object.keys(FORMAT_REGISTRY);
}

// Extract the primary usable text from a source DB row.
function getSourceText(spec, row) {
  if (!spec || !row) return '';
  if (spec.isLongform) {
    const title = String(row.title || '').trim();
    const content = String(row.content || '').trim();
    return [title, content].filter(Boolean).join('\n\n');
  }
  return String(row[spec.contentField] || '').trim();
}

// Build the create payload for a target store from transformed content.
function buildCreatePayload(spec, content, meta) {
  if (!spec) return {};
  const base = {
    topic: String(meta?.topic || '').trim(),
    category: String(meta?.category || '').trim(),
  };
  if (spec.isLongform) {
    return {
      ...base,
      title: String(meta?.title || '').trim().slice(0, 300) || String(content || '').slice(0, 200),
      content: String(meta?.body || content || '').trim(),
    };
  }
  return { ...base, [spec.contentField]: String(content || '').trim() };
}

// Simple substring filter — empty includes string means match all.
function contentMatchesIncludes(content, includes) {
  const filter = String(includes || '').trim();
  if (!filter) return true;
  return String(content || '').toLowerCase().includes(filter.toLowerCase());
}

module.exports = {
  FAMILY,
  FORMAT_REGISTRY,
  getFormatSpec,
  listFormatSlugs,
  getSourceText,
  buildCreatePayload,
  contentMatchesIncludes,
};
