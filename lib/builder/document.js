'use strict';

const template = require('./template');
const { migrateLegacyLayoutSections } = require('./migrate-from-legacy');

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeStarCasterTemplateKind(value) {
  const kind = safeText(value, 40).toLowerCase();
  if (kind === 'email') return 'email';
  if (kind === 'modular') return 'modular';
  if (kind === 'fixed' || kind === 'text') return 'fixed';
  return template.normalizeTemplateKind(kind) === 'email' ? 'email' : 'modular';
}

function coerceLayoutInput(value) {
  const migrated = migrateLegacyLayoutSections(value);
  return migrated;
}

// Build a id→locked map from an array of raw section objects.
function lockedMapFromSections(sections) {
  const map = {};
  if (!Array.isArray(sections)) return map;
  for (const s of sections) {
    if (s && s.id) map[String(s.id)] = s.locked === true;
  }
  return map;
}

function normalizeBuilderDocument(value) {
  const coerced = coerceLayoutInput(value);
  const doc = template.normalizeBuilderDocument(coerced);

  // template.normalizeBuilderDocument strips unknown fields like `locked`.
  // Restore it from the pre-normalization input so the flag survives round-trips.
  const inputSections = Array.isArray(coerced?.sections) ? coerced.sections
    : Array.isArray(coerced?.layoutSections) ? coerced.layoutSections : [];
  if (doc.layoutSections && inputSections.length) {
    const lockedById = lockedMapFromSections(inputSections);
    doc.layoutSections = doc.layoutSections.map((section) => ({
      ...section,
      locked: lockedById[section.id] === true,
    }));
  }

  return doc;
}

function serializeBuilderDocument(input) {
  const document = normalizeBuilderDocument({
    pageBackground: input?.pageBackground,
    theme: input?.theme,
    sections: input?.layoutSections ?? input?.sections,
  });
  const serialized = template.serializeBuilderDocument(document);

  // template.serializeBuilderDocument also strips `locked` (calls normalizeLayoutSections).
  // Re-attach it so the flag is persisted to the database.
  if (serialized.sections && document.layoutSections) {
    const lockedById = lockedMapFromSections(document.layoutSections);
    serialized.sections = serialized.sections.map((section) => {
      if (lockedById[section.id]) return { ...section, locked: true };
      return section;
    });
  }

  return serialized;
}

function readLayoutSectionsFromRow(row) {
  const raw = row?.layout_sections ?? row?.layoutSections;
  return normalizeBuilderDocument(raw);
}

function writeLayoutSectionsToRow(document) {
  return serializeBuilderDocument(document);
}

module.exports = {
  normalizeStarCasterTemplateKind,
  normalizeBuilderDocument,
  serializeBuilderDocument,
  readLayoutSectionsFromRow,
  writeLayoutSectionsToRow,
};
