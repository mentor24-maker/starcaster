'use strict';

/**
 * Look up the page a form's "Go to a page on this site" points at, by id,
 * within the form's own project (task 86bcxmq23). The rule for what to do
 * with it lives in lib/crmFormHandling.js (`redirectAddressFor`); this is the
 * one I/O step, kept apart so that file stays pure.
 *
 * Never throws and never fails a submission: a page that is gone, or a read
 * that failed, answers `page: null` and the form shows its message instead.
 * Both are logged loudly, because a form quietly falling back is otherwise
 * invisible to everyone but the visitor who expected a page.
 */

const { normalizeFormHandling } = require('./crmFormHandling');

async function findFormRedirectPage(form, projectId) {
  const pageId = normalizeFormHandling(form?.handling).redirectPageId;
  if (!pageId) return { page: null, missing: false };
  const scope = { projectId: String(projectId || form?.projectId || '').trim(), userId: '' };
  try {
    const { getPage } = require('./builderPagesStore');
    const res = await getPage(pageId, scope);
    if (res?.ok && res.data) return { page: res.data, missing: false };
    const missing = res?.status === 404 || res?.status === 400;
    console.error(
      `[crm] Form ${form?.id || '?'} sends visitors to page ${pageId}, which ${missing ? 'no longer exists' : 'could not be read'}`
      + ` (${res?.status || '?'} ${res?.error || ''}) — showing the success message instead.`,
    );
    return { page: null, missing };
  } catch (err) {
    console.error(`[crm] Form ${form?.id || '?'}: reading its After-submit page ${pageId} failed — showing the success message instead:`, err?.message || err);
    return { page: null, missing: false };
  }
}

module.exports = { findFormRedirectPage };
