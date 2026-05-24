'use strict';

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

function cell(row, ...keys) {
  const wanted = keys.map((key) => normalizeHeader(key));
  for (const rowKey of Object.keys(row || {})) {
    const normalized = normalizeHeader(rowKey);
    if (!wanted.includes(normalized)) continue;
    const value = String(row[rowKey] == null ? '' : row[rowKey]).trim();
    if (value) return value;
  }
  return '';
}

const FORMAT_IMPORT_SPECS = {
  tweets: {
    label: 'Tweet',
    primaryField: 'content',
    primaryHeaders: ['tweet', 'content', 'question', 'one_line_question', 'one_line_question_text'],
    requireTopicOrCategory: true,
  },
  headlines: {
    label: 'Headline',
    primaryField: 'headline',
    primaryHeaders: ['headline', 'headline_text', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  subheadings: {
    label: 'Sub-heading',
    primaryField: 'subheading',
    primaryHeaders: ['subheading', 'sub_heading', 'subheading_text', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  taglines: {
    label: 'Tagline',
    primaryField: 'tagline',
    primaryHeaders: ['tagline', 'tagline_text', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  pitches: {
    label: 'Pitch',
    primaryField: 'pitch',
    primaryHeaders: ['pitch', 'pitch_text', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  emails: {
    label: 'Email',
    primaryField: 'email',
    primaryHeaders: ['email', 'email_body', 'body', 'content', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  posts: {
    label: 'Post',
    primaryField: 'post',
    primaryHeaders: ['post', 'post_text', 'content', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  descriptions: {
    label: 'Description',
    primaryField: 'description',
    primaryHeaders: ['description', 'description_text', 'content', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  transcripts: {
    label: 'Transcript',
    primaryField: 'transcript',
    primaryHeaders: ['transcript', 'transcript_text', 'content', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  comments: {
    label: 'Comment',
    primaryField: 'comment',
    primaryHeaders: ['comment', 'comment_text', 'content', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  keywords: {
    label: 'Keyword',
    primaryField: 'keyword',
    primaryHeaders: ['keyword', 'keywords', 'content', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  hashtags: {
    label: 'Hashtag',
    primaryField: 'hashtag',
    primaryHeaders: ['hashtag', 'hashtags', 'tag', 'content', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  ctas: {
    label: 'Call to Action',
    primaryField: 'cta',
    primaryHeaders: ['cta', 'call_to_action', 'content', 'question', 'one_line_question'],
    requireTopicOrCategory: false,
  },
  articles: {
    label: 'Article',
    primaryField: 'title',
    secondaryField: 'content',
    primaryHeaders: ['title', 'article_title', 'headline', 'question', 'one_line_question'],
    secondaryHeaders: ['content', 'article', 'article_body', 'body', 'text'],
    requireTopicOrCategory: false,
  },
  reports: {
    label: 'Report',
    primaryField: 'title',
    secondaryField: 'content',
    primaryHeaders: ['title', 'report_title', 'headline', 'question', 'one_line_question'],
    secondaryHeaders: ['content', 'report', 'report_body', 'body', 'text'],
    requireTopicOrCategory: false,
  },
  'white-papers': {
    label: 'White Paper',
    primaryField: 'title',
    secondaryField: 'content',
    primaryHeaders: ['title', 'white_paper_title', 'headline', 'question', 'one_line_question'],
    secondaryHeaders: ['content', 'white_paper', 'body', 'text'],
    requireTopicOrCategory: false,
  },
  ebooks: {
    label: 'eBook',
    primaryField: 'title',
    secondaryField: 'content',
    primaryHeaders: ['title', 'ebook_title', 'headline', 'question', 'one_line_question'],
    secondaryHeaders: ['content', 'ebook', 'body', 'text'],
    requireTopicOrCategory: false,
  },
};

function getFormatImportSpec(slug) {
  const key = String(slug || '').trim().toLowerCase();
  return FORMAT_IMPORT_SPECS[key] || null;
}

function listFormatImportSlugs() {
  return Object.keys(FORMAT_IMPORT_SPECS);
}

function mapImportRow(slug, row) {
  const spec = getFormatImportSpec(slug);
  if (!spec || !row || typeof row !== 'object') return null;

  const primaryKeys = (spec.primaryHeaders || [spec.primaryField]).map(normalizeHeader);
  const primary = cell(row, ...(spec.primaryHeaders || [spec.primaryField]));
  if (!primary) return null;

  const mapped = {
    [spec.primaryField]: primary,
    topic: cell(row, 'Topic', 'topic'),
    category: cell(row, 'Category', 'category'),
  };

  if (spec.secondaryField) {
    const secondary = cell(row, ...(spec.secondaryHeaders || [spec.secondaryField]));
    mapped[spec.secondaryField] = secondary || primary;
  }

  return mapped;
}

function mapImportRows(slug, rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => mapImportRow(slug, row))
    .filter(Boolean);
}

function validateImportHeaders(slug, headers) {
  const spec = getFormatImportSpec(slug);
  if (!spec) {
    return { ok: false, missing: ['Unknown format'] };
  }

  const normalized = new Set((Array.isArray(headers) ? headers : []).map(normalizeHeader));
  const primaryFound = (spec.primaryHeaders || [spec.primaryField]).some((header) => {
    return normalized.has(normalizeHeader(header));
  });

  const missing = [];
  if (!primaryFound) {
    const labels = (spec.primaryHeaders || [spec.primaryField])
      .map((header) => header.replace(/_/g, ' '))
      .join(', ');
    missing.push(`${spec.label} column (${labels})`);
  }
  if (spec.requireTopicOrCategory && !normalized.has('topic') && !normalized.has('category')) {
    missing.push('Topic or Category');
  }

  return { ok: missing.length === 0, missing, spec };
}

function importInstructions(slug) {
  const spec = getFormatImportSpec(slug);
  if (!spec) return 'Upload a CSV file to import rows.';
  const primaryNames = (spec.primaryHeaders || [spec.primaryField])
    .slice(0, 4)
    .map((header) => header.replace(/_/g, ' '))
    .join(', ');
  const parts = [`<strong>${primaryNames}</strong>`];
  if (spec.secondaryField) {
    parts.push(`optional <strong>${spec.secondaryField}</strong>`);
  }
  parts.push('optional <strong>Topic</strong> and <strong>Category</strong>');
  if (spec.requireTopicOrCategory) {
    return `Upload a CSV with ${parts[0]} plus <strong>Topic</strong> and/or <strong>Category</strong>.`;
  }
  return `Upload a CSV with ${parts.join(', ')} columns.`;
}

module.exports = {
  FORMAT_IMPORT_SPECS,
  getFormatImportSpec,
  listFormatImportSlugs,
  mapImportRow,
  mapImportRows,
  validateImportHeaders,
  importInstructions,
};
