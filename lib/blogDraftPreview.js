'use strict';

/**
 * Who may read an UNPUBLISHED post by slug (86bbvtzt1).
 *
 * `GET /api/blog/posts/<slug>?by=slug` is a public read route — a visitor on a
 * published tenant page has no login, so routes/index.js deliberately does not
 * fold the tenant admin's session into it (lib/projectAdminApiAuth.js,
 * isPublicTenantContentReadRoute). That is right for a visitor and wrong for
 * the one case this file exists for: the "Preview draft" link in the Blog
 * Manager opens exactly this address, as the tenant admin, and the route saw
 * no session and answered "Post not found" — the same words a visitor gets.
 *
 * The rule is small enough to state whole: a draft is readable by a platform
 * user (req.authUser, already handled by the route) or by a tenant admin whose
 * session belongs to the SAME project as the post. An admin of another tenant
 * is a visitor here. The check is a pure function so it can be tested without
 * a database.
 */

function isPublishedPost(post) {
  return String(post?.status || '').trim() === 'published';
}

/**
 * @param {{ status?: string, projectId?: string, project_id?: string } | null} post
 * @param {{ projectId?: string } | null} adminSession  a resolved tenant admin session, or null
 * @returns {boolean} true when this session may read this unpublished post
 */
function canPreviewDraft(post, adminSession) {
  if (!post || !adminSession) return false;
  const postProject = String(post.projectId || post.project_id || '').trim();
  const sessionProject = String(adminSession.projectId || '').trim();
  if (!postProject || !sessionProject) return false;
  return postProject === sessionProject;
}

module.exports = { canPreviewDraft, isPublishedPost };
