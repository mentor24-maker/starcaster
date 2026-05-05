'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const {
  scopedInsertRow,
} = require('./projectScope');
const { createMessagingTextStore } = require('./messagingTextStore');

const store = createMessagingTextStore({
  tableKey: 'messagingHashtags',
  field: 'hashtag',
  label: 'Hashtag',
  maxLength: 240,
  normalize: function normalizeHashtag(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.startsWith('#') ? text : `#${text}`;
  },
});

function table() {
  return tableConfig().messagingHashtags;
}

/**
 * Bulk-create hashtags for a campaign.
 * Accepts { hashtags: string[], campaign_id: number }.
 */
async function bulkCreateHashtags(input, scope) {
  const tags = Array.isArray(input?.hashtags) ? input.hashtags : [];
  const campaignId = Number(input?.campaign_id || 0) || 0;

  if (!tags.length) return { ok: false, status: 400, error: 'At least one hashtag is required' };
  if (!campaignId) return { ok: false, status: 400, error: 'campaign_id is required' };

  const normalize = (value) => {
    const text = String(value || '').trim().replace(/^[#,]+/, '');
    if (!text) return '';
    return `#${text}`;
  };

  const rows = [];
  for (const tag of tags) {
    const normalized = normalize(tag);
    if (!normalized) continue;
    const row = await scopedInsertRow(table(), {
      hashtag: normalized,
      campaign_id: campaignId,
    }, scope);
    rows.push(row);
  }

  if (!rows.length) return { ok: false, status: 400, error: 'No valid hashtags provided' };

  let res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: rows,
  });

  // Retry without campaign_id if the column doesn't exist yet
  if (!res.ok) {
    const errText = String(res.error || res.message || '').toLowerCase();
    if (errText.includes('campaign_id') && (errText.includes('column') || errText.includes('schema cache'))) {
      const fallbackRows = rows.map((r) => {
        const copy = { ...r };
        delete copy.campaign_id;
        return copy;
      });
      res = await sbQuery({
        method: 'POST',
        table: table(),
        query: 'select=*',
        headers: { Prefer: 'return=representation' },
        body: fallbackRows,
      });
    }
  }

  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data.map(store.rowToItem) : [];
  return { ok: true, status: 201, data: created };
}

module.exports = {
  listMessagingHashtags: store.list,
  createMessagingHashtag: store.create,
  updateMessagingHashtag: store.update,
  deleteMessagingHashtag: store.remove,
  createMessagingHashtags: bulkCreateHashtags,
  rowToHashtag: store.rowToItem,
};
