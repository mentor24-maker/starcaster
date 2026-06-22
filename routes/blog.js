'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { listCategories, getCategory, getCategoryBySlug, createCategory, updateCategory, deleteCategory } = require('../lib/blogCategoriesStore');
const { listPosts, getPost, getPostBySlug, createPost, updatePost, deletePost } = require('../lib/blogPostsStore');
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

  return false;
}

const manifest = {
  id:       'blog',
  label:    'Blog',
  prefixes: ['/api/blog'],
};

module.exports = { handle, manifest };
