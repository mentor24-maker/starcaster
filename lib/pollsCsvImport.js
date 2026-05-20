'use strict';

/**
 * Maps Normie "Would You Rather" scoring CSV rows to builder_polls payloads.
 * Expected headers (Starcaster Import.csv):
 *   Question ID, Category, Personality System, Trait / Dimension,
 *   Option A, Option B, One-Line Question,
 *   Option A Score Code, Option B Score Code, Scoring Logic,
 *   Weight, Reverse Scored?, AI Interpretation Tag
 */

function cell(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

function parseReverseScored(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return false;
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  return false;
}

function parseWeight(raw) {
  const n = Number(String(raw || '').trim());
  return Number.isFinite(n) ? n : 1;
}

function orderIndexFromExternalId(externalId) {
  const m = String(externalId || '').match(/(\d+)\s*$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

function isAdvancedScoringRow(row) {
  return Boolean(
    cell(row, 'Question ID', 'ID', 'Id')
    && cell(row, 'One-Line Question', 'Question')
  );
}

function mapAdvancedRow(row) {
  const externalId = cell(row, 'Question ID', 'ID', 'Id');
  const question = cell(row, 'One-Line Question', 'Question');
  if (!externalId || !question) return null;

  const optionA = cell(row, 'Option A');
  const optionB = cell(row, 'Option B');
  const options = [];
  if (optionA) {
    options.push({
      label: optionA,
      sort_order: 1,
      score_code: cell(row, 'Option A Score Code') || null,
    });
  }
  if (optionB) {
    options.push({
      label: optionB,
      sort_order: 2,
      score_code: cell(row, 'Option B Score Code') || null,
    });
  }

  return {
    poll: {
      question,
      category: cell(row, 'Category') || null,
      external_id: externalId,
      personality_system: cell(row, 'Personality System') || null,
      trait_dimension: cell(row, 'Trait / Dimension', 'Trait/Dimension') || null,
      scoring_logic: cell(row, 'Scoring Logic') || null,
      weight: parseWeight(row.Weight),
      reverse_scored: parseReverseScored(row['Reverse Scored?'] ?? row['Reverse Scored']),
      ai_interpretation_tag: cell(row, 'AI Interpretation Tag') || null,
      order_index: orderIndexFromExternalId(externalId),
      is_published: true,
    },
    options,
  };
}

function mapBasicRow(row) {
  const question = cell(row, 'Question', 'One-Line Question');
  if (!question) return null;

  const options = [];
  if (cell(row, 'Option A')) {
    options.push({ label: cell(row, 'Option A'), sort_order: 1, score_code: null });
  }
  if (cell(row, 'Option B')) {
    options.push({ label: cell(row, 'Option B'), sort_order: 2, score_code: null });
  }

  return {
    poll: {
      question,
      category: cell(row, 'Category') || null,
      external_id: cell(row, 'ID', 'Question ID') || null,
      order_index: orderIndexFromExternalId(cell(row, 'ID', 'Question ID')),
      is_published: true,
    },
    options,
  };
}

function mapImportRow(row, mode = 'auto') {
  if (mode === 'advanced' || (mode === 'auto' && isAdvancedScoringRow(row))) {
    return mapAdvancedRow(row);
  }
  return mapBasicRow(row);
}

function validateAdvancedHeaders(headers) {
  const required = ['Question ID', 'One-Line Question', 'Option A', 'Option B'];
  const missing = required.filter((h) => !headers.includes(h));
  return { ok: missing.length === 0, missing };
}

module.exports = {
  cell,
  mapImportRow,
  mapAdvancedRow,
  isAdvancedScoringRow,
  validateAdvancedHeaders,
  orderIndexFromExternalId,
};
