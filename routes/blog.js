'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { listCategories, getCategory, getCategoryBySlug, createCategory, updateCategory, deleteCategory } = require('../lib/blogCategoriesStore');
const { listPosts, getPost, getPostBySlug, createPost, updatePost, deletePost } = require('../lib/blogPostsStore');
const { getCardTemplate, saveCardTemplate } = require('../lib/blogCardTemplateStore');
const { listTags, listPostsWithTag, renameTag, removeTag } = require('../lib/blogTagsStore');
const { listRelations, listRelatedPostIds, relatePosts, setRelatedPosts, unrelatePosts } = require('../lib/blogPostRelationsStore');
const { listImportCandidates, importPosts, IMPORT_BATCH_SIZE } = require('../lib/blogImportStore');
const { getPublicProjectById } = require('../lib/projectsStore');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { logActivity } = require('../lib/activityLog');

function requestScope(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId:    String(req?.authUser?.id || '').trim(),
  };
}

async function handle(req, res, pathname, method) {
  const urlObj = getUrlObj(req);

  // ── Blog Categories ─────────────────────────────────────────────────────────

  if (pathname === '/api/blog/categories' && method === 'GET') {
    const categories = await listCategories(requestScope(req));
    return sendOk(res, 200, categories, { categories }, { total: categories.length }), true;
  }

  if (pathname === '/api/blog/categories' && method === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendErr(res, 400, 'name is required', { code: 'VALIDATION_ERROR' }), true;
    const created = await createCategory({
      name,
      slug:        String(body.slug || '').trim(),
      description: String(body.description || '').trim(),
      color:       String(body.color || '').trim(),
      sortOrder:   Number(body.sortOrder ?? 0),
    }, requestScope(req));
    if (!created) return sendErr(res, 500, 'Failed to create category'), true;
    logActivity({ action: 'blog_category.created', entityType: 'blog_category', entityId: created.id, summary: `Blog category created: "${name}"` });
    return sendOk(res, 201, created, { category: created }), true;
  }

  const categoryMatch = pathname.match(/^\/api\/blog\/categories\/([^/]+)$/);

  if (categoryMatch && method === 'GET') {
    const id = decodeURIComponent(categoryMatch[1]);
    const category = await getCategory(id, requestScope(req));
    if (!category) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    return sendOk(res, 200, category, { category }), true;
  }

  if (categoryMatch && method === 'PUT') {
    const id = decodeURIComponent(categoryMatch[1]);
    const body = await parseJsonBody(req);
    const patch = {};
    if (body.name        !== undefined) patch.name        = String(body.name || '').trim();
    if (body.slug        !== undefined) patch.slug        = String(body.slug || '').trim();
    if (body.description !== undefined) patch.description = String(body.description || '').trim();
    if (body.color       !== undefined) patch.color       = String(body.color || '').trim();
    if (body.sortOrder   !== undefined) patch.sortOrder   = Number(body.sortOrder ?? 0);
    const updated = await updateCategory(id, patch, requestScope(req));
    if (!updated) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'blog_category.updated', entityType: 'blog_category', entityId: id, summary: `Blog category updated: "${updated.name}"` });
    return sendOk(res, 200, updated, { category: updated }), true;
  }

  if (categoryMatch && method === 'DELETE') {
    const id = decodeURIComponent(categoryMatch[1]);
    const deleted = await deleteCategory(id, requestScope(req));
    if (!deleted) return sendErr(res, 404, 'Category not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'blog_category.deleted', entityType: 'blog_category', entityId: id, summary: `Blog category deleted: ${id}` });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  // ── Blog Posts ──────────────────────────────────────────────────────────────

  if (pathname === '/api/blog/posts' && method === 'GET') {
    const params = urlObj.searchParams;
    const status     = String(params.get('status') || '').trim() || undefined;
    const categorySlug = String(params.get('category') || '').trim();
    const page       = parseInt(params.get('page')  || '1',  10) || 1;
    const limit      = parseInt(params.get('limit') || '20', 10) || 20;

    // Resolve category slug → ID for filtering
    let categoryId;
    if (categorySlug) {
      const cat = await getCategoryBySlug(categorySlug, requestScope(req));
      if (!cat) return sendOk(res, 200, [], { posts: [], total: 0 }), true;
      categoryId = cat.id;
    }

    const posts = await listPosts({ status, categoryId, page, limit }, requestScope(req));
    return sendOk(res, 200, posts, { posts }, { total: posts.length, page, limit }), true;
  }

  if (pathname === '/api/blog/posts' && method === 'POST') {
    const body = await parseJsonBody(req);
    const title = String(body.title || '').trim();
    if (!title) return sendErr(res, 400, 'title is required', { code: 'VALIDATION_ERROR' }), true;
    const created = await createPost({
      title,
      slug:                 String(body.slug || '').trim(),
      status:               String(body.status || 'draft').trim(),
      author:               String(body.author || '').trim(),
      authorUserId:         String(body.authorUserId || '').trim(),
      featuredImageUrl:     String(body.featuredImageUrl || '').trim(),
      featuredImageAssetId: String(body.featuredImageAssetId || '').trim(),
      excerpt:              String(body.excerpt || '').trim(),
      body:                 String(body.body || ''),
      seoTitle:             String(body.seoTitle || '').trim(),
      seoDescription:       String(body.seoDescription || '').trim(),
      tags:                 Array.isArray(body.tags) ? body.tags.map(String) : [],
      readingTimeMinutes:   body.readingTimeMinutes != null ? Number(body.readingTimeMinutes) : null,
      publishedAt:          body.publishedAt || null,
      categoryIds:          Array.isArray(body.categoryIds) ? body.categoryIds : [],
    }, requestScope(req));
    if (!created) return sendErr(res, 500, 'Failed to create post'), true;
    logActivity({ action: 'blog_post.created', entityType: 'blog_post', entityId: created.id, summary: `Blog post created: "${title}"` });
    return sendOk(res, 201, created, { post: created }), true;
  }

  const postMatch = pathname.match(/^\/api\/blog\/posts\/([^/]+)$/);

  if (postMatch && method === 'GET') {
    const id = decodeURIComponent(postMatch[1]);
    // Support ?by=slug to look up by slug instead of ID
    const bySlug = String(urlObj.searchParams.get('by') || '').trim() === 'slug';
    const post = bySlug
      ? await getPostBySlug(id, requestScope(req))
      : await getPost(id, requestScope(req));
    if (!post) return sendErr(res, 404, 'Post not found', { code: 'NOT_FOUND' }), true;
    const isPublicSlugRead = bySlug && !req.authUser;
    if (isPublicSlugRead && String(post.status || '').trim() !== 'published') {
      return sendErr(res, 404, 'Post not found', { code: 'NOT_FOUND' }), true;
    }
    return sendOk(res, 200, post, { post }), true;
  }

  if (postMatch && method === 'PUT') {
    const id = decodeURIComponent(postMatch[1]);
    const body = await parseJsonBody(req);
    const patch = {};
    if (body.title                !== undefined) patch.title                = String(body.title || '').trim();
    if (body.slug                 !== undefined) patch.slug                 = String(body.slug || '').trim();
    if (body.status               !== undefined) patch.status               = String(body.status || '').trim();
    if (body.author               !== undefined) patch.author               = String(body.author || '').trim();
    if (body.authorUserId         !== undefined) patch.authorUserId         = String(body.authorUserId || '').trim();
    if (body.featuredImageUrl     !== undefined) patch.featuredImageUrl     = String(body.featuredImageUrl || '').trim();
    if (body.featuredImageAssetId !== undefined) patch.featuredImageAssetId = String(body.featuredImageAssetId || '').trim();
    if (body.excerpt              !== undefined) patch.excerpt              = String(body.excerpt || '').trim();
    if (body.body                 !== undefined) patch.body                 = String(body.body || '');
    if (body.seoTitle             !== undefined) patch.seoTitle             = String(body.seoTitle || '').trim();
    if (body.seoDescription       !== undefined) patch.seoDescription       = String(body.seoDescription || '').trim();
    if (body.tags                 !== undefined) patch.tags                 = Array.isArray(body.tags) ? body.tags.map(String) : [];
    if (body.readingTimeMinutes   !== undefined) patch.readingTimeMinutes   = body.readingTimeMinutes != null ? Number(body.readingTimeMinutes) : null;
    if (body.publishedAt          !== undefined) patch.publishedAt          = body.publishedAt || null;
    if (body.categoryIds          !== undefined) patch.categoryIds          = Array.isArray(body.categoryIds) ? body.categoryIds : [];
    const updated = await updatePost(id, patch, requestScope(req));
    if (!updated) return sendErr(res, 404, 'Post not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'blog_post.updated', entityType: 'blog_post', entityId: id, summary: `Blog post updated: "${updated.title}"` });
    return sendOk(res, 200, updated, { post: updated }), true;
  }

  if (postMatch && method === 'DELETE') {
    const id = decodeURIComponent(postMatch[1]);
    const deleted = await deletePost(id, requestScope(req));
    if (!deleted) return sendErr(res, 404, 'Post not found', { code: 'NOT_FOUND' }), true;
    logActivity({ action: 'blog_post.deleted', entityType: 'blog_post', entityId: id, summary: `Blog post deleted: ${id}` });
    return sendOk(res, 200, { deleted: true, id }, { deleted: true }), true;
  }

  // ── Bulk import from discarded pages ────────────────────────────────────────
  // docs/BLOG_BULK_IMPORT_HANDOFF.md. Both endpoints require a session (they
  // are not in the public tenant read list) and are scoped to the caller's
  // project. Candidates is the dry run: nothing is written until the POST,
  // and the POST takes page ids only — the fields come from the snapshots.

  if (pathname === '/api/blog/import/candidates' && method === 'GET') {
    if (checkEndpointLimit(req, res, 'blog.import')) return true;
    const scope = requestScope(req);
    const result = await listImportCandidates(scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Could not list import candidates'), true;
    // Suggested author for posts whose source names none — the site's name,
    // editable in the picker before anything is written. The store returns an
    // envelope, so the name is on .data (landmine 12): reading it off the
    // envelope silently yields undefined and an empty suggestion box.
    const project = await getPublicProjectById(scope.projectId);
    return sendOk(res, 200, {
      candidates: result.data,
      defaultAuthorSuggestion: String(project?.data?.name || '').trim(),
      batchSize: IMPORT_BATCH_SIZE,
    }), true;
  }

  if (pathname === '/api/blog/import' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'blog.import')) return true;
    const body = await parseJsonBody(req);
    const result = await importPosts({
      pageIds: Array.isArray(body.pageIds) ? body.pageIds : [],
      defaultAuthor: String(body.defaultAuthor || '').trim(),
    }, requestScope(req));
    if (!result.ok) return sendErr(res, result.status || 500, result.error || 'Import failed'), true;
    logActivity({ action: 'blog_post.bulk_imported', entityType: 'blog_post', entityId: '', summary: `Blog bulk import: ${result.data.created} created, ${result.data.skipped} skipped, ${result.data.failed} failed` });
    return sendOk(res, 200, result.data), true;
  }

  // ── Blog Card Template ──────────────────────────────────────────────────────

  if (pathname === '/api/blog/card-template' && method === 'GET') {
    const template = await getCardTemplate(requestScope(req));
    return sendOk(res, 200, template, { template }), true;
  }

  if (pathname === '/api/blog/card-template' && method === 'PUT') {
    const body = await parseJsonBody(req);
    const saved = await saveCardTemplate(body, requestScope(req));
    return sendOk(res, 200, saved, { template: saved }), true;
  }

  // ── Blog Tags ───────────────────────────────────────────────────────────────
  // Tags have no table: they are a text[] on each post, so the list is derived
  // and every edit rewrites the posts that carry the word. See lib/blogTagsStore.js.

  if (pathname === '/api/blog/tags' && method === 'GET') {
    const tags = await listTags(requestScope(req));
    return sendOk(res, 200, tags, { tags }, { total: tags.length }), true;
  }

  if (pathname === '/api/blog/tags/posts' && method === 'GET') {
    const tag = String(urlObj.searchParams.get('tag') || '').trim();
    if (!tag) return sendErr(res, 400, 'tag is required', { code: 'VALIDATION_ERROR' }), true;
    const posts = await listPostsWithTag(tag, requestScope(req));
    return sendOk(res, 200, posts, { posts }, { total: posts.length }), true;
  }

  if (pathname === '/api/blog/tags/rename' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'blog.tags')) return true;
    const body = await parseJsonBody(req);
    const from = String(body.from || '').trim();
    const to   = String(body.to || '').trim();
    if (!from) return sendErr(res, 400, 'from is required', { code: 'VALIDATION_ERROR' }), true;
    if (!to)   return sendErr(res, 400, 'to is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await renameTag(from, to, requestScope(req));
    if (result.error) return sendErr(res, 400, result.error, { code: 'VALIDATION_ERROR' }), true;
    // A partial rename is reported as a failure with the count that DID land,
    // never as a success -- the posts left behind still carry the old tag.
    if (!result.ok) {
      return sendErr(res, 500, `Renamed ${result.updated} post(s), but ${result.failed.length} could not be saved and still carry "${from}".`, {
        code: 'PARTIAL_WRITE', details: result,
      }), true;
    }
    logActivity({ action: 'blog_tag.renamed', entityType: 'blog_tag', entityId: from, summary: `Blog tag renamed: "${from}" to "${to}" across ${result.updated} post(s)` });
    return sendOk(res, 200, result, { result }), true;
  }

  if (pathname === '/api/blog/tags' && method === 'DELETE') {
    if (checkEndpointLimit(req, res, 'blog.tags')) return true;
    const body = await parseJsonBody(req);
    const tag = String(body.tag || '').trim();
    if (!tag) return sendErr(res, 400, 'tag is required', { code: 'VALIDATION_ERROR' }), true;
    const result = await removeTag(tag, requestScope(req));
    if (result.error) return sendErr(res, 400, result.error, { code: 'VALIDATION_ERROR' }), true;
    if (!result.ok) {
      return sendErr(res, 500, `Removed the tag from ${result.updated} post(s), but ${result.failed.length} could not be saved and still carry "${tag}".`, {
        code: 'PARTIAL_WRITE', details: result,
      }), true;
    }
    logActivity({ action: 'blog_tag.removed', entityType: 'blog_tag', entityId: tag, summary: `Blog tag removed: "${tag}" from ${result.updated} post(s)` });
    return sendOk(res, 200, result, { result }), true;
  }

  // ── Blog Post Relations (hand-picked "related articles") ────────────────────

  if (pathname === '/api/blog/relations' && method === 'GET') {
    const scope = requestScope(req);
    const postId = String(urlObj.searchParams.get('postId') || '').trim();
    if (postId) {
      const relatedIds = await listRelatedPostIds(postId, scope);
      return sendOk(res, 200, relatedIds, { relatedIds }, { total: relatedIds.length }), true;
    }
    const relations = await listRelations(scope);
    return sendOk(res, 200, relations, { relations }, { total: relations.length }), true;
  }

  if (pathname === '/api/blog/relations' && method === 'POST') {
    if (checkEndpointLimit(req, res, 'blog.relations')) return true;
    const body = await parseJsonBody(req);
    const postIds = Array.isArray(body.postIds) ? body.postIds.map(String) : [];
    const distinct = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
    if (distinct.length < 2) {
      return sendErr(res, 400, 'Check at least two articles to relate them to each other.', { code: 'VALIDATION_ERROR' }), true;
    }
    const result = await relatePosts(distinct, requestScope(req));
    // null means the database REFUSED. Falling back to the local file here
    // would answer 200 with the caller's own input while nothing was stored
    // (landmine 15), so the store returns null and this says so.
    if (!result) return sendErr(res, 500, 'Could not save the relations.'), true;
    logActivity({ action: 'blog_post.related', entityType: 'blog_post', entityId: distinct[0], summary: `Blog articles related: ${distinct.length} articles, ${result.added} new link(s)` });
    return sendOk(res, 200, result, { result }), true;
  }

  // The post editor's write: one post's whole related set, replacing what is
  // stored. POST above only ever ADDS (it relates a checked set to each other,
  // which is the links manager's move); unchecking a post in the editor has to
  // remove a pair, and only pairs involving this post may be touched.
  if (pathname === '/api/blog/relations' && method === 'PUT') {
    if (checkEndpointLimit(req, res, 'blog.relations')) return true;
    const body = await parseJsonBody(req);
    const postId = String(body.postId || '').trim();
    if (!postId) return sendErr(res, 400, 'postId is required', { code: 'VALIDATION_ERROR' }), true;
    const relatedIds = [...new Set(
      (Array.isArray(body.relatedIds) ? body.relatedIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => id && id !== postId)
    )];
    const result = await setRelatedPosts(postId, relatedIds, requestScope(req));
    // null means the database REFUSED — see the POST handler above.
    if (!result) return sendErr(res, 500, 'Could not save the related posts.'), true;
    logActivity({ action: 'blog_post.related', entityType: 'blog_post', entityId: postId, summary: `Related posts set: ${relatedIds.length} article(s), ${result.added} added, ${result.removed} removed` });
    return sendOk(res, 200, result, { result }), true;
  }

  if (pathname === '/api/blog/relations' && method === 'DELETE') {
    if (checkEndpointLimit(req, res, 'blog.relations')) return true;
    const body = await parseJsonBody(req);
    const postIdA = String(body.postIdA || '').trim();
    const postIdB = String(body.postIdB || '').trim();
    if (!postIdA || !postIdB) return sendErr(res, 400, 'postIdA and postIdB are required', { code: 'VALIDATION_ERROR' }), true;
    const result = await unrelatePosts(postIdA, postIdB, requestScope(req));
    if (!result) return sendErr(res, 500, 'Could not remove the relation.'), true;
    return sendOk(res, 200, result, { result }), true;
  }

  return false;
}

const manifest = {
  id:       'blog',
  label:    'Blog',
  prefixes: ['/api/blog'],
};

module.exports = { handle, manifest };
