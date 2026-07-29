'use strict';

/**
 * routes/associations.js
 * Two-way links between any two objects.
 *
 * GET    /api/associations?type=<t>&id=<i>  → everything linked to that object
 * POST   /api/associations                  → create a link
 * DELETE /api/associations/:id              → remove a link
 *
 * The asset-side endpoints under /api/assets/:id/associations still exist and
 * still read the older asset_associations table; this module is the general
 * replacement that also answers "what is linked to this tweet?".
 */

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const {
  listAssociationsForObject,
  createAssociation,
  deleteAssociation,
  rowToAssociation,
  associationOtherSide,
} = require('../lib/objectAssociationsStore');

const PREFIX = '/api/associations';

const manifest = {
  id:       'associations',
  label:    'Associations',
  prefixes: [PREFIX],
};

function scopeFromRequest(req) {
  return {
    projectId: String(req?.projectContext?.project?.id || '').trim(),
    userId: String(req?.authUser?.id || '').trim(),
  };
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith(PREFIX)) return false;
  const scope = scopeFromRequest(req);

  if (pathname === PREFIX && method === 'GET') {
    const urlObj = getUrlObj(req);
    const self = {
      type: urlObj.searchParams.get('type') || '',
      id: urlObj.searchParams.get('id') || '',
    };
    if (!String(self.type).trim() || !String(self.id).trim()) {
      return sendErr(res, 400, 'type and id are required', { code: 'VALIDATION_ERROR' }), true;
    }

    const result = await listAssociationsForObject(self, scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;

    // Return each link already resolved from the caller's point of view, so the
    // client never has to work out which of the two sides was "the other one".
    const associations = (Array.isArray(result.data) ? result.data : [])
      .map(rowToAssociation)
      .filter(Boolean)
      .map((association) => {
        const other = associationOtherSide(association, self);
        return other ? { id: association.id, object: other, createdAt: association.createdAt } : null;
      })
      .filter(Boolean);

    return sendOk(res, 200, associations, { associations }, { total: associations.length }), true;
  }

  if (pathname === PREFIX && method === 'POST') {
    const body = await parseJsonBody(req);
    const result = await createAssociation({ a: body?.a ?? body?.from, b: body?.b ?? body?.to }, scope);
    if (!result.ok) {
      const errText = String(result.error || '').toLowerCase();
      if (errText.includes('duplicate') || errText.includes('unique')) {
        return sendErr(res, 409, 'These two are already associated', { code: 'DUPLICATE' }), true;
      }
      return sendErr(res, result.status || 500, result.error, { code: 'VALIDATION_ERROR' }), true;
    }
    const created = Array.isArray(result.data) ? result.data[0] : result.data;
    const association = rowToAssociation(created);
    return sendOk(res, 201, association, { association }), true;
  }

  const deleteMatch = pathname.match(/^\/api\/associations\/(\d+)$/);
  if (deleteMatch && method === 'DELETE') {
    const result = await deleteAssociation(Number(deleteMatch[1]), scope);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const deleted = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!deleted) return sendErr(res, 404, 'Association not found', { code: 'NOT_FOUND' }), true;
    const association = rowToAssociation(deleted);
    return sendOk(res, 200, association, { association }), true;
  }

  return false;
}

module.exports = { handle, manifest };
