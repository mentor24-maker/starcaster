'use strict';

const {
  createMessagingHeadline,
} = require('./messagingHeadlinesStore');
const {
  createMessagingSubheading,
} = require('./messagingSubheadingsStore');
const {
  createMessagingTagline,
} = require('./messagingTaglinesStore');
const {
  createMessagingPitch,
} = require('./messagingPitchesStore');
const {
  createMessagingArticle,
} = require('./messagingArticlesStore');
const {
  createMessagingReport,
} = require('./messagingReportsStore');
const {
  createMessagingWhitePaper,
} = require('./messagingWhitePapersStore');
const {
  createMessagingEbook,
} = require('./messagingEbooksStore');
const {
  createMessagingTweet,
} = require('./messagingTweetsStore');
const {
  createMessagingEmail,
} = require('./messagingEmailsStore');
const {
  createMessagingPost,
} = require('./messagingPostsStore');
const {
  createMessagingDescription,
} = require('./messagingDescriptionsStore');
const {
  createMessagingTranscript,
} = require('./messagingTranscriptsStore');
const {
  createMessagingComment,
} = require('./messagingCommentsStore');
const {
  createMessagingHashtag,
} = require('./messagingHashtagsStore');
const {
  createMessagingCta,
} = require('./messagingCtasStore');
const {
  createMessagingKeyword,
} = require('./messagingKeywordsStore');
const {
  getFormatImportSpec,
  mapImportRows,
  validateImportHeaders,
} = require('./messagingFormatImport');

const CREATE_BY_SLUG = {
  tweets: createMessagingTweet,
  headlines: createMessagingHeadline,
  subheadings: createMessagingSubheading,
  taglines: createMessagingTagline,
  pitches: createMessagingPitch,
  emails: createMessagingEmail,
  posts: createMessagingPost,
  descriptions: createMessagingDescription,
  transcripts: createMessagingTranscript,
  comments: createMessagingComment,
  keywords: createMessagingKeyword,
  hashtags: createMessagingHashtag,
  ctas: createMessagingCta,
  articles: createMessagingArticle,
  reports: createMessagingReport,
  'white-papers': createMessagingWhitePaper,
  ebooks: createMessagingEbook,
};

function getCreateFn(slug) {
  return CREATE_BY_SLUG[String(slug || '').trim().toLowerCase()] || null;
}

async function importMessagingFormatRows(slug, rows, scope) {
  const key = String(slug || '').trim().toLowerCase();
  const createFn = getCreateFn(key);
  const spec = getFormatImportSpec(key);
  if (!createFn || !spec) {
    return { ok: false, status: 400, error: `Unknown messaging format: ${slug}` };
  }

  const headerCheck = validateImportHeaders(key, Object.keys(rows[0] || {}));
  if (!headerCheck.ok) {
    return {
      ok: false,
      status: 400,
      error: `CSV must include columns: ${headerCheck.missing.join(', ')}`,
    };
  }

  const mapped = mapImportRows(key, rows);
  if (!mapped.length) {
    return {
      ok: false,
      status: 400,
      error: `No valid ${spec.label} rows found`,
    };
  }

  let imported = 0;
  const errors = [];
  for (let i = 0; i < mapped.length; i += 1) {
    const result = await createFn(mapped[i], scope);
    if (result.ok) {
      imported += 1;
    } else {
      errors.push({ row: i + 1, error: result.error || 'Import failed' });
    }
  }

  return { ok: true, imported, errors, format: key, label: spec.label };
}

module.exports = {
  getCreateFn,
  importMessagingFormatRows,
  listImportSlugs: () => Object.keys(CREATE_BY_SLUG),
};
