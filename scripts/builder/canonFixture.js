'use strict';

/**
 * Outreach wizard 8/19 (86bcrmbje) — a canon for the YouTube and Substack
 * store tests, now that neither drafts without one (lib/canonPrompt.js).
 *
 * `withCanon(sbQuery)` wraps a fake database's sbQuery so a read of
 * canon_documents answers CANON_DOCS, for every project — the canon table's
 * own behaviour is scripts/builder/canonStore.test.js's, and the schema fake
 * does not parse its unique constraint. It also drops lib/canonStore.js from
 * the require cache, so the store reloads against the fake supabase the
 * caller has just installed.
 */

const canonStorePath = require.resolve('../../lib/canonStore.js');

const BLOCKLIST_MD = [
  '# AIism Blocklist',
  '',
  '## FENCE — never',
  '',
  '| Phrase | Why |',
  '|---|---|',
  '| "delve into" | the AI tell |',
  '| "tapestry" | ornament |',
  '',
  '## RATION — at most once',
  '',
  '| Phrase | Limit |',
  '|---|---|',
  '| "honestly" | once |',
].join('\n');

/** Seven documents, as production holds: VOICE, the blocklist, and five thesis documents. */
const CANON_DOCS = Object.freeze([
  { docKey: 'AIISM-BLOCKLIST', title: 'AIism Blocklist', body: BLOCKLIST_MD, syncedAt: '2026-10-12T22:47:41.063Z' },
  { docKey: 'DANE-OF-EARTH', title: 'Dane of Earth', body: '# Dane of Earth\nA stewardship ethic.', syncedAt: '2026-10-12T22:47:41.047Z' },
  { docKey: 'DEO', title: 'DEO', body: '# DEO\nThe organism thesis.', syncedAt: '2026-10-12T22:47:41.066Z' },
  { docKey: 'ISITAS', title: 'ISITAS', body: '# ISITAS\nWhat is, as it is.', syncedAt: '2026-10-12T22:47:41.070Z' },
  { docKey: 'STARCASTER', title: 'StarCaster', body: '# StarCaster\nTools for small publishers.', syncedAt: '2026-10-12T22:47:41.072Z' },
  { docKey: 'VOICE', title: 'Voice', body: '# Voice\nShort declaratives. Every sentence gets its predicate.', syncedAt: '2026-10-12T23:27:39.644Z' },
  { docKey: 'WAVECENTER', title: 'WaveCenter', body: '# WaveCenter\nThe practice.', syncedAt: '2026-10-12T22:47:41.075Z' },
]);

function canonRow(doc, projectId) {
  return {
    id: `canon-${doc.docKey}`,
    project_id: projectId,
    owner_user_id: 'user_1',
    doc_key: doc.docKey,
    title: doc.title,
    body: doc.body,
    source_path: '',
    content_hash: '',
    synced_at: doc.syncedAt,
  };
}

function withCanon(sbQuery, { docs = CANON_DOCS } = {}) {
  delete require.cache[canonStorePath];
  return async (req) => {
    if (req && req.table === 'canon_documents') {
      const project = decodeURIComponent((String(req.query || '').match(/project_id=eq\.([^&]*)/) || [])[1] || '');
      return { ok: true, status: 200, data: docs.map((d) => canonRow(d, project)) };
    }
    return sbQuery(req);
  };
}

module.exports = { BLOCKLIST_MD, CANON_DOCS, withCanon };
