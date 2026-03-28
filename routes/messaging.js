'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const {
  listMessagingHeadlines,
  createMessagingHeadline,
  updateMessagingHeadline,
  deleteMessagingHeadline
} = require('../lib/messagingHeadlinesStore');
const {
  listMessagingSubheadings,
  createMessagingSubheading,
  updateMessagingSubheading,
  deleteMessagingSubheading
} = require('../lib/messagingSubheadingsStore');
const {
  listMessagingTaglines,
  createMessagingTagline,
  updateMessagingTagline,
  deleteMessagingTagline
} = require('../lib/messagingTaglinesStore');
const {
  listMessagingPitches,
  createMessagingPitch,
  updateMessagingPitch,
  deleteMessagingPitch
} = require('../lib/messagingPitchesStore');
const {
  listMessagingArticles,
  createMessagingArticle,
  updateMessagingArticle,
  deleteMessagingArticle
} = require('../lib/messagingArticlesStore');
const {
  listMessagingReports,
  createMessagingReport,
  updateMessagingReport,
  deleteMessagingReport
} = require('../lib/messagingReportsStore');
const {
  listMessagingWhitePapers,
  createMessagingWhitePaper,
  updateMessagingWhitePaper,
  deleteMessagingWhitePaper
} = require('../lib/messagingWhitePapersStore');
const {
  listMessagingEbooks,
  createMessagingEbook,
  updateMessagingEbook,
  deleteMessagingEbook
} = require('../lib/messagingEbooksStore');
const {
  listMessagingTweets,
  createMessagingTweet,
  updateMessagingTweet,
  deleteMessagingTweet
} = require('../lib/messagingTweetsStore');
const {
  listMessagingEmails,
  createMessagingEmail,
  updateMessagingEmail,
  deleteMessagingEmail,
} = require('../lib/messagingEmailsStore');
const {
  listMessagingHashtags,
  createMessagingHashtag,
  createMessagingHashtags,
  updateMessagingHashtag,
  deleteMessagingHashtag,
} = require('../lib/messagingHashtagsStore');
const {
  listMessagingPosts,
  createMessagingPost,
  updateMessagingPost,
  deleteMessagingPost,
} = require('../lib/messagingPostsStore');
const {
  listMessagingDescriptions,
  createMessagingDescription,
  updateMessagingDescription,
  deleteMessagingDescription,
} = require('../lib/messagingDescriptionsStore');
const {
  listMessagingTranscripts,
  createMessagingTranscript,
  updateMessagingTranscript,
  deleteMessagingTranscript,
} = require('../lib/messagingTranscriptsStore');
const {
  listMessagingComments,
  createMessagingComment,
  updateMessagingComment,
  deleteMessagingComment,
} = require('../lib/messagingCommentsStore');
const {
  listMessagingCtas,
  createMessagingCta,
  updateMessagingCta,
  deleteMessagingCta,
} = require('../lib/messagingCtasStore');
const {
  listMessagingCategories,
  createMessagingCategory,
  getMessagingCategory,
  updateMessagingCategory,
  deleteMessagingCategory,
} = require('../lib/messagingCategoriesStore');
const {
  listMessagingTags,
  createMessagingTag,
  getMessagingTag,
  updateMessagingTag,
  deleteMessagingTag,
} = require('../lib/messagingTagsStore');
const { generateMessagingContentSuggestions } = require('../lib/messagingContentSuggestions');

function isValidHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function handleSimpleTextResource(req, res, pathname, requestMethod, options) {
  const {
    path,
    field,
    singularKey,
    pluralKey,
    listFn,
    createFn,
    updateFn,
    deleteFn,
    limit = 5000,
  } = options || {};

  if (pathname === path && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const result = await listFn(Number(urlObj.searchParams.get('limit') || limit));
    if (!result.ok) {
      sendErr(res, result.status || 500, result.error);
      return true;
    }
    const items = result.data || [];
    sendOk(res, 200, items, { [pluralKey]: items }, { total: items.length });
    return true;
  }

  if (pathname === path && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const value = String(body?.[field] || '').trim();
    if (!value) {
      sendErr(res, 400, `${field} is required`, { code: 'VALIDATION_ERROR' });
      return true;
    }
    const result = await createFn(body || {});
    if (!result.ok) {
      sendErr(res, result.status || 500, result.error);
      return true;
    }
    sendOk(res, 201, result.data, { [singularKey]: result.data });
    return true;
  }

  const itemIdMatch = String(pathname || '').match(new RegExp(`^${path.replace(/\//g, '\\/')}/(\\d+)/?$`));
  if (itemIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(itemIdMatch[1]);
    const body = await parseJsonBody(req);
    const value = String(body?.[field] || '').trim();
    if (!value) {
      sendErr(res, 400, `${field} is required`, { code: 'VALIDATION_ERROR' });
      return true;
    }
    const result = await updateFn(id, body || {});
    if (!result.ok) {
      sendErr(res, result.status || 500, result.error);
      return true;
    }
    sendOk(res, 200, result.data, { [singularKey]: result.data });
    return true;
  }

  if (itemIdMatch && requestMethod === 'DELETE') {
    const id = Number(itemIdMatch[1]);
    const result = await deleteFn(id);
    if (!result.ok) {
      sendErr(res, result.status || 500, result.error);
      return true;
    }
    sendOk(res, 200, result.data, { [singularKey]: result.data });
    return true;
  }

  return false;
}

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();

  if (pathname === '/api/messaging/content-suggestions' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const format = String(body?.format || '').trim();
    if (!format) return sendErr(res, 400, 'format is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await generateMessagingContentSuggestions(body || {});
    if (!result.ok) {
      return sendErr(
        res,
        result.status || 500,
        result.error || 'Could not generate messaging content suggestions',
        { code: 'MESSAGING_CONTENT_SUGGESTIONS_FAILED' }
      ), true;
    }
    return sendOk(res, 200, result.data, result.data), true;
  }

  if (pathname === '/api/messaging/headlines' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 5000);
    const result = await listMessagingHeadlines(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const headlines = result.data || [];
    return sendOk(res, 200, headlines, { headlines }, { total: headlines.length }), true;
  }

  if (pathname === '/api/messaging/headlines' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const headline = String(body?.headline || '').trim();
    if (!headline) return sendErr(res, 400, 'headline is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createMessagingHeadline(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { headline: result.data }), true;
  }

  const headlineIdMatch = String(pathname || '').match(/^\/api\/messaging\/headlines\/(\d+)\/?$/);
  if (headlineIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(headlineIdMatch[1]);
    const body = await parseJsonBody(req);
    const headline = String(body?.headline || '').trim();
    if (!headline) return sendErr(res, 400, 'headline is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await updateMessagingHeadline(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { headline: result.data }), true;
  }

  if (headlineIdMatch && requestMethod === 'DELETE') {
    const id = Number(headlineIdMatch[1]);
    const result = await deleteMessagingHeadline(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { headline: result.data }), true;
  }

  if (pathname === '/api/messaging/subheadings' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 5000);
    const result = await listMessagingSubheadings(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const subheadings = result.data || [];
    return sendOk(res, 200, subheadings, { subheadings }, { total: subheadings.length }), true;
  }

  if (pathname === '/api/messaging/subheadings' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const subheading = String(body?.subheading || '').trim();
    if (!subheading) return sendErr(res, 400, 'subheading is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createMessagingSubheading(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { subheading: result.data }), true;
  }

  const subheadingIdMatch = String(pathname || '').match(/^\/api\/messaging\/subheadings\/(\d+)\/?$/);
  if (subheadingIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(subheadingIdMatch[1]);
    const body = await parseJsonBody(req);
    const subheading = String(body?.subheading || '').trim();
    if (!subheading) return sendErr(res, 400, 'subheading is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await updateMessagingSubheading(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { subheading: result.data }), true;
  }

  if (subheadingIdMatch && requestMethod === 'DELETE') {
    const id = Number(subheadingIdMatch[1]);
    const result = await deleteMessagingSubheading(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { subheading: result.data }), true;
  }

  if (pathname === '/api/messaging/taglines' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 5000);
    const result = await listMessagingTaglines(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const taglines = result.data || [];
    return sendOk(res, 200, taglines, { taglines }, { total: taglines.length }), true;
  }

  if (pathname === '/api/messaging/taglines' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const tagline = String(body?.tagline || '').trim();
    if (!tagline) return sendErr(res, 400, 'tagline is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createMessagingTagline(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { tagline: result.data }), true;
  }

  const taglineIdMatch = String(pathname || '').match(/^\/api\/messaging\/taglines\/(\d+)\/?$/);
  if (taglineIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(taglineIdMatch[1]);
    const body = await parseJsonBody(req);
    const tagline = String(body?.tagline || '').trim();
    if (!tagline) return sendErr(res, 400, 'tagline is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await updateMessagingTagline(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { tagline: result.data }), true;
  }

  if (taglineIdMatch && requestMethod === 'DELETE') {
    const id = Number(taglineIdMatch[1]);
    const result = await deleteMessagingTagline(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { tagline: result.data }), true;
  }

  if (pathname === '/api/messaging/pitches' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 5000);
    const result = await listMessagingPitches(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const pitches = result.data || [];
    return sendOk(res, 200, pitches, { pitches }, { total: pitches.length }), true;
  }

  if (pathname === '/api/messaging/pitches' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const pitch = String(body?.pitch || '').trim();
    if (!pitch) return sendErr(res, 400, 'pitch is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createMessagingPitch(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { pitch: result.data }), true;
  }

  const pitchIdMatch = String(pathname || '').match(/^\/api\/messaging\/pitches\/(\d+)\/?$/);
  if (pitchIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(pitchIdMatch[1]);
    const body = await parseJsonBody(req);
    const pitch = String(body?.pitch || '').trim();
    if (!pitch) return sendErr(res, 400, 'pitch is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await updateMessagingPitch(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { pitch: result.data }), true;
  }

  if (pitchIdMatch && requestMethod === 'DELETE') {
    const id = Number(pitchIdMatch[1]);
    const result = await deleteMessagingPitch(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { pitch: result.data }), true;
  }

  if (pathname === '/api/messaging/articles' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 200);
    const result = await listMessagingArticles(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const articles = result.data || [];
    return sendOk(res, 200, articles, { articles }, { total: articles.length }), true;
  }

  if (pathname === '/api/messaging/articles' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    const publishDate = String(body?.publish_date || '').trim();

    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (!isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    if (publishDate && Number.isNaN(new Date(publishDate).getTime())) {
      return sendErr(res, 400, 'publish_date must be a valid date', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await createMessagingArticle(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { article: result.data }), true;
  }

  const articleIdMatch = String(pathname || '').match(/^\/api\/messaging\/articles\/(\d+)\/?$/);
  if (articleIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(articleIdMatch[1]);
    const body = await parseJsonBody(req);
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    const publishDate = String(body?.publish_date || '').trim();

    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (!isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    if (publishDate && Number.isNaN(new Date(publishDate).getTime())) {
      return sendErr(res, 400, 'publish_date must be a valid date', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateMessagingArticle(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { article: result.data }), true;
  }

  if (articleIdMatch && requestMethod === 'DELETE') {
    const id = Number(articleIdMatch[1]);
    const result = await deleteMessagingArticle(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { article: result.data }), true;
  }

  if (pathname === '/api/messaging/reports' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 200);
    const result = await listMessagingReports(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const reports = result.data || [];
    return sendOk(res, 200, reports, { reports }, { total: reports.length }), true;
  }

  if (pathname === '/api/messaging/reports' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    const pdfDataUrl = String(body?.pdf_data_url || '').trim();
    const publishDate = String(body?.publish_date || '').trim();

    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (url && !isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    if (!url && !pdfDataUrl) return sendErr(res, 400, 'provide a URL or upload a PDF', { code: 'VALIDATION_ERROR' }), true;
    if (pdfDataUrl && !/^data:application\/pdf(?:;charset=[^;,]+)?;base64,/i.test(pdfDataUrl)) {
      return sendErr(res, 400, 'uploaded file must be a PDF', { code: 'VALIDATION_ERROR' }), true;
    }
    if (publishDate && Number.isNaN(new Date(publishDate).getTime())) {
      return sendErr(res, 400, 'publish_date must be a valid date', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await createMessagingReport(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { report: result.data }), true;
  }

  const reportIdMatch = String(pathname || '').match(/^\/api\/messaging\/reports\/(\d+)\/?$/);
  if (reportIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(reportIdMatch[1]);
    const body = await parseJsonBody(req);
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    const pdfDataUrl = String(body?.pdf_data_url || '').trim();
    const publishDate = String(body?.publish_date || '').trim();

    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (url && !isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    if (!url && !pdfDataUrl) return sendErr(res, 400, 'provide a URL or upload a PDF', { code: 'VALIDATION_ERROR' }), true;
    if (pdfDataUrl && !/^data:application\/pdf(?:;charset=[^;,]+)?;base64,/i.test(pdfDataUrl)) {
      return sendErr(res, 400, 'uploaded file must be a PDF', { code: 'VALIDATION_ERROR' }), true;
    }
    if (publishDate && Number.isNaN(new Date(publishDate).getTime())) {
      return sendErr(res, 400, 'publish_date must be a valid date', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateMessagingReport(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { report: result.data }), true;
  }

  if (reportIdMatch && requestMethod === 'DELETE') {
    const id = Number(reportIdMatch[1]);
    const result = await deleteMessagingReport(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { report: result.data }), true;
  }

  if (pathname === '/api/messaging/white-papers' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 200);
    const result = await listMessagingWhitePapers(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const whitePapers = result.data || [];
    return sendOk(res, 200, whitePapers, { whitePapers }, { total: whitePapers.length }), true;
  }

  if (pathname === '/api/messaging/white-papers' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    const pdfDataUrl = String(body?.pdf_data_url || '').trim();
    const publishDate = String(body?.publish_date || '').trim();

    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (url && !isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    if (!url && !pdfDataUrl) return sendErr(res, 400, 'provide a URL or upload a PDF', { code: 'VALIDATION_ERROR' }), true;
    if (pdfDataUrl && !/^data:application\/pdf(?:;charset=[^;,]+)?;base64,/i.test(pdfDataUrl)) {
      return sendErr(res, 400, 'uploaded file must be a PDF', { code: 'VALIDATION_ERROR' }), true;
    }
    if (publishDate && Number.isNaN(new Date(publishDate).getTime())) {
      return sendErr(res, 400, 'publish_date must be a valid date', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await createMessagingWhitePaper(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { whitePaper: result.data }), true;
  }

  const whitePaperIdMatch = String(pathname || '').match(/^\/api\/messaging\/white-papers\/(\d+)\/?$/);
  if (whitePaperIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(whitePaperIdMatch[1]);
    const body = await parseJsonBody(req);
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    const pdfDataUrl = String(body?.pdf_data_url || '').trim();
    const publishDate = String(body?.publish_date || '').trim();

    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (url && !isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    if (!url && !pdfDataUrl) return sendErr(res, 400, 'provide a URL or upload a PDF', { code: 'VALIDATION_ERROR' }), true;
    if (pdfDataUrl && !/^data:application\/pdf(?:;charset=[^;,]+)?;base64,/i.test(pdfDataUrl)) {
      return sendErr(res, 400, 'uploaded file must be a PDF', { code: 'VALIDATION_ERROR' }), true;
    }
    if (publishDate && Number.isNaN(new Date(publishDate).getTime())) {
      return sendErr(res, 400, 'publish_date must be a valid date', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateMessagingWhitePaper(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { whitePaper: result.data }), true;
  }

  if (whitePaperIdMatch && requestMethod === 'DELETE') {
    const id = Number(whitePaperIdMatch[1]);
    const result = await deleteMessagingWhitePaper(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { whitePaper: result.data }), true;
  }

  if (pathname === '/api/messaging/ebooks' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 200);
    const result = await listMessagingEbooks(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const ebooks = result.data || [];
    return sendOk(res, 200, ebooks, { ebooks }, { total: ebooks.length }), true;
  }

  if (pathname === '/api/messaging/ebooks' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    const pdfDataUrl = String(body?.pdf_data_url || '').trim();
    const publishDate = String(body?.publish_date || '').trim();

    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (url && !isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    if (!url && !pdfDataUrl) return sendErr(res, 400, 'provide a URL or upload a PDF', { code: 'VALIDATION_ERROR' }), true;
    if (pdfDataUrl && !/^data:application\/pdf(?:;charset=[^;,]+)?;base64,/i.test(pdfDataUrl)) {
      return sendErr(res, 400, 'uploaded file must be a PDF', { code: 'VALIDATION_ERROR' }), true;
    }
    if (publishDate && Number.isNaN(new Date(publishDate).getTime())) {
      return sendErr(res, 400, 'publish_date must be a valid date', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await createMessagingEbook(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { ebook: result.data }), true;
  }

  const ebookIdMatch = String(pathname || '').match(/^\/api\/messaging\/ebooks\/(\d+)\/?$/);
  if (ebookIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(ebookIdMatch[1]);
    const body = await parseJsonBody(req);
    const title = String(body?.title || '').trim();
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    const pdfDataUrl = String(body?.pdf_data_url || '').trim();
    const publishDate = String(body?.publish_date || '').trim();

    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (url && !isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    if (!url && !pdfDataUrl) return sendErr(res, 400, 'provide a URL or upload a PDF', { code: 'VALIDATION_ERROR' }), true;
    if (pdfDataUrl && !/^data:application\/pdf(?:;charset=[^;,]+)?;base64,/i.test(pdfDataUrl)) {
      return sendErr(res, 400, 'uploaded file must be a PDF', { code: 'VALIDATION_ERROR' }), true;
    }
    if (publishDate && Number.isNaN(new Date(publishDate).getTime())) {
      return sendErr(res, 400, 'publish_date must be a valid date', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await updateMessagingEbook(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { ebook: result.data }), true;
  }

  if (ebookIdMatch && requestMethod === 'DELETE') {
    const id = Number(ebookIdMatch[1]);
    const result = await deleteMessagingEbook(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { ebook: result.data }), true;
  }

  if (await handleSimpleTextResource(req, res, pathname, requestMethod, {
    path: '/api/messaging/emails',
    field: 'email',
    singularKey: 'email',
    pluralKey: 'emails',
    listFn: listMessagingEmails,
    createFn: createMessagingEmail,
    updateFn: updateMessagingEmail,
    deleteFn: deleteMessagingEmail,
  })) return true;

  if (await handleSimpleTextResource(req, res, pathname, requestMethod, {
    path: '/api/messaging/tweets',
    field: 'content',
    singularKey: 'tweet',
    pluralKey: 'tweets',
    listFn: listMessagingTweets,
    createFn: createMessagingTweet,
    updateFn: updateMessagingTweet,
    deleteFn: deleteMessagingTweet,
    limit: 5000,
  })) return true;

  if (await handleSimpleTextResource(req, res, pathname, requestMethod, {
    path: '/api/messaging/posts',
    field: 'post',
    singularKey: 'post',
    pluralKey: 'posts',
    listFn: listMessagingPosts,
    createFn: createMessagingPost,
    updateFn: updateMessagingPost,
    deleteFn: deleteMessagingPost,
  })) return true;

  if (await handleSimpleTextResource(req, res, pathname, requestMethod, {
    path: '/api/messaging/descriptions',
    field: 'description',
    singularKey: 'description',
    pluralKey: 'descriptions',
    listFn: listMessagingDescriptions,
    createFn: createMessagingDescription,
    updateFn: updateMessagingDescription,
    deleteFn: deleteMessagingDescription,
  })) return true;

  if (await handleSimpleTextResource(req, res, pathname, requestMethod, {
    path: '/api/messaging/transcripts',
    field: 'transcript',
    singularKey: 'transcript',
    pluralKey: 'transcripts',
    listFn: listMessagingTranscripts,
    createFn: createMessagingTranscript,
    updateFn: updateMessagingTranscript,
    deleteFn: deleteMessagingTranscript,
  })) return true;

  if (await handleSimpleTextResource(req, res, pathname, requestMethod, {
    path: '/api/messaging/comments',
    field: 'comment',
    singularKey: 'comment',
    pluralKey: 'comments',
    listFn: listMessagingComments,
    createFn: createMessagingComment,
    updateFn: updateMessagingComment,
    deleteFn: deleteMessagingComment,
  })) return true;

  if (await handleSimpleTextResource(req, res, pathname, requestMethod, {
    path: '/api/messaging/hashtags',
    field: 'hashtag',
    singularKey: 'hashtag',
    pluralKey: 'hashtags',
    listFn: listMessagingHashtags,
    createFn: createMessagingHashtag,
    updateFn: updateMessagingHashtag,
    deleteFn: deleteMessagingHashtag,
  })) return true;

  if (await handleSimpleTextResource(req, res, pathname, requestMethod, {
    path: '/api/messaging/ctas',
    field: 'cta',
    singularKey: 'cta',
    pluralKey: 'ctas',
    listFn: listMessagingCtas,
    createFn: createMessagingCta,
    updateFn: updateMessagingCta,
    deleteFn: deleteMessagingCta,
  })) return true;

  if (pathname === '/api/messaging/tweets' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 200);
    const result = await listMessagingTweets(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const tweets = result.data || [];
    return sendOk(res, 200, tweets, { tweets }, { total: tweets.length }), true;
  }

  if (pathname === '/api/messaging/tweets' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (!isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    const result = await createMessagingTweet(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { tweet: result.data }), true;
  }

  const tweetIdMatch = String(pathname || '').match(/^\/api\/messaging\/tweets\/(\d+)\/?$/);
  if (tweetIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(tweetIdMatch[1]);
    const body = await parseJsonBody(req);
    const content = String(body?.content || '').trim();
    const url = String(body?.url || '').trim();
    if (!content) return sendErr(res, 400, 'content is required', { code: 'VALIDATION_ERROR' }), true;
    if (!isValidHttpUrl(url)) return sendErr(res, 400, 'url must be a valid http(s) URL', { code: 'VALIDATION_ERROR' }), true;
    const result = await updateMessagingTweet(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { tweet: result.data }), true;
  }

  if (tweetIdMatch && requestMethod === 'DELETE') {
    const id = Number(tweetIdMatch[1]);
    const result = await deleteMessagingTweet(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { tweet: result.data }), true;
  }

  if (pathname === '/api/messaging/hashtags' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 5000);
    const result = await listMessagingHashtags(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const hashtags = result.data || [];
    return sendOk(res, 200, hashtags, { hashtags }, { total: hashtags.length }), true;
  }

  if (pathname === '/api/messaging/hashtags' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const hashtags = Array.isArray(body?.hashtags) ? body.hashtags : [];
    const campaignId = Number(body?.campaign_id || 0) || 0;
    if (!hashtags.length) return sendErr(res, 400, 'At least one hashtag is required', { code: 'VALIDATION_ERROR' }), true;
    if (!campaignId) return sendErr(res, 400, 'campaign_id is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createMessagingHashtags(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { hashtags: result.data }, { total: result.data.length }), true;
  }

  if (pathname === '/api/messaging/categories' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 5000);
    const result = await listMessagingCategories(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const categories = result.data || [];
    return sendOk(res, 200, categories, { categories }, { total: categories.length }), true;
  }

  if (pathname === '/api/messaging/categories' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const category = String(body?.category || '').trim();
    if (!category) return sendErr(res, 400, 'category is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createMessagingCategory(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { category: result.data }), true;
  }

  const messagingCategoryIdMatch = String(pathname || '').match(/^\/api\/messaging\/categories\/(\d+)\/?$/);
  if (messagingCategoryIdMatch && requestMethod === 'GET') {
    const id = Number(messagingCategoryIdMatch[1]);
    const result = await getMessagingCategory(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { category: result.data }), true;
  }

  if (messagingCategoryIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(messagingCategoryIdMatch[1]);
    const body = await parseJsonBody(req);
    const category = String(body?.category || '').trim();
    if (!category) return sendErr(res, 400, 'category is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await updateMessagingCategory(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { category: result.data }), true;
  }

  if (messagingCategoryIdMatch && requestMethod === 'DELETE') {
    const id = Number(messagingCategoryIdMatch[1]);
    const result = await deleteMessagingCategory(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { category: result.data }), true;
  }

  if (pathname === '/api/messaging/tags' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 5000);
    const result = await listMessagingTags(limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const tags = result.data || [];
    return sendOk(res, 200, tags, { tags }, { total: tags.length }), true;
  }

  if (pathname === '/api/messaging/tags' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const tag = String(body?.tag || '').trim();
    if (!tag) return sendErr(res, 400, 'tag is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await createMessagingTag(body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { tag: result.data }), true;
  }

  const messagingTagIdMatch = String(pathname || '').match(/^\/api\/messaging\/tags\/(\d+)\/?$/);
  if (messagingTagIdMatch && requestMethod === 'GET') {
    const id = Number(messagingTagIdMatch[1]);
    const result = await getMessagingTag(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { tag: result.data }), true;
  }

  if (messagingTagIdMatch && (requestMethod === 'PATCH' || requestMethod === 'PUT')) {
    const id = Number(messagingTagIdMatch[1]);
    const body = await parseJsonBody(req);
    const tag = String(body?.tag || '').trim();
    if (!tag) return sendErr(res, 400, 'tag is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await updateMessagingTag(id, body || {});
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { tag: result.data }), true;
  }

  if (messagingTagIdMatch && requestMethod === 'DELETE') {
    const id = Number(messagingTagIdMatch[1]);
    const result = await deleteMessagingTag(id);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { tag: result.data }), true;
  }

  return false;
}

const manifest = {
  id: 'messaging',
  label: 'Messaging',
  prefixes: ['/api/messaging'],
};

module.exports = { handle, manifest };
