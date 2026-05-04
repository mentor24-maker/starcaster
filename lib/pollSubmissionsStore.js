'use strict';

const { sbQuery, tableConfig } = require('./supabase');

/**
 * Save a poll submission
 * @param {string} pollId
 * @param {string} vote
 * @returns {Promise<Object>}
 */
async function savePollSubmission(pollId, vote) {
  const table = tableConfig().developPollSubmissions;
  const res = await sbQuery({
    method: 'POST',
    table,
    body: {
      poll_id: pollId,
      vote: vote
    },
    headers: {
      Prefer: 'return=representation'
    }
  });
  if (!res.ok) throw new Error(res.error || 'Failed to save poll submission');
  return res.data?.[0] || null;
}

/**
 * Get poll results
 * @param {string} pollId
 * @returns {Promise<Array>}
 */
async function getPollResults(pollId) {
  const table = tableConfig().developPollSubmissions;
  const res = await sbQuery({
    method: 'GET',
    table,
    query: `poll_id=eq.${encodeURIComponent(pollId)}`
  });
  if (!res.ok) throw new Error(res.error || 'Failed to fetch poll results');
  return res.data || [];
}

module.exports = {
  savePollSubmission,
  getPollResults
};
