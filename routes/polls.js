'use strict';

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { listPolls, listWyrQuestionPolls, createPoll, updatePoll, deletePoll, importPollRows } = require('../lib/pollsStore');
const { mapImportRow, validateAdvancedHeaders } = require('../lib/pollsCsvImport');

async function handle(req, res, pathname, method) {
  // GET /api/polls/wyr-questions
  if (pathname === '/api/polls/wyr-questions' && method === 'GET') {
    try {
      const polls = await listWyrQuestionPolls();
      return sendOk(res, 200, polls, { polls }), true;
    } catch (err) {
      return sendErr(res, 500, err.message), true;
    }
  }

  // GET /api/polls
  if (pathname === '/api/polls' && method === 'GET') {
    try {
      const polls = await listPolls();
      return sendOk(res, 200, polls), true;
    } catch (err) {
      return sendErr(res, 500, err.message), true;
    }
  }

  // POST /api/polls
  if (pathname === '/api/polls' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const question = String(body.question || '').trim();
      if (!question) return sendErr(res, 400, 'Question is required'), true;
      
      const poll = await createPoll(
        { question, category: body.category },
        Array.isArray(body.options) ? body.options : []
      );
      return sendOk(res, 201, poll), true;
    } catch (err) {
      return sendErr(res, 500, err.message), true;
    }
  }

  // PATCH /api/polls/:id
  const patchMatch = pathname.match(/^\/api\/polls\/([^/]+)$/);
  if (patchMatch && method === 'PATCH') {
    const id = patchMatch[1];
    try {
      const body = await parseJsonBody(req);
      const pollData = {};
      if (body.question !== undefined) pollData.question = String(body.question).trim();
      if (body.category !== undefined) pollData.category = String(body.category).trim();
      if (body.is_published !== undefined) pollData.is_published = Boolean(body.is_published);
      
      const optionsList = Array.isArray(body.options) ? body.options : null;
      
      await updatePoll(id, pollData, optionsList);
      return sendOk(res, 200, { success: true }), true;
    } catch (err) {
      return sendErr(res, 500, err.message), true;
    }
  }

  // DELETE /api/polls/:id
  const deleteMatch = pathname.match(/^\/api\/polls\/([^/]+)$/);
  if (deleteMatch && method === 'DELETE') {
    const id = deleteMatch[1];
    try {
      await deletePoll(id);
      return sendOk(res, 200, { success: true }), true;
    } catch (err) {
      return sendErr(res, 500, err.message), true;
    }
  }

  // POST /api/polls/import
  if (pathname === '/api/polls/import' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return sendErr(res, 400, 'No data to import'), true;

      const mapped = rows
        .map((row) => mapImportRow(row, 'basic'))
        .filter(Boolean);
      if (!mapped.length) return sendErr(res, 400, 'No valid poll rows found'), true;

      const result = await importPollRows(mapped, { upsert: false });
      return sendOk(res, 201, { success: true, ...result }), true;
    } catch (err) {
      return sendErr(res, 500, err.message), true;
    }
  }

  // POST /api/polls/import/advanced — legacy WYR scoring CSV (all columns)
  if (pathname === '/api/polls/import/advanced' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return sendErr(res, 400, 'No data to import'), true;

      const headers = Object.keys(rows[0] || {});
      const headerCheck = validateAdvancedHeaders(headers);
      if (!headerCheck.ok) {
        return sendErr(
          res,
          400,
          `CSV missing required columns: ${headerCheck.missing.join(', ')}`
        ), true;
      }

      const mapped = rows
        .map((row) => mapImportRow(row, 'advanced'))
        .filter(Boolean);
      if (!mapped.length) {
        return sendErr(res, 400, 'No valid scoring poll rows found'), true;
      }

      const upsert = body.upsert !== false;
      const result = await importPollRows(mapped, { upsert });
      return sendOk(res, 201, { success: true, ...result }), true;
    } catch (err) {
      return sendErr(res, 500, err.message), true;
    }
  }

  return false;
}

module.exports = {
  handle,
  manifest: {
    id: 'polls',
    label: 'Polls Management',
    prefixes: ['/api/polls']
  }
};
