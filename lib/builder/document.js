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

// Build a id→{locked, savedSectionId, canonical, rowBorder*} map from raw section objects.
// normalizeLayoutSections (template.js) outputs a strict field whitelist that drops these.
function sectionMetaFromSections(sections) {
  const map = {};
  if (!Array.isArray(sections)) return map;
  for (const s of sections) {
    if (s && s.id) {
      map[String(s.id)] = {
        locked: s.locked === true,
        savedSectionId: typeof s.savedSectionId === 'string' && s.savedSectionId ? s.savedSectionId : undefined,
        canonical: s.canonical === true,
        rowBorderWidth: typeof s.rowBorderWidth === 'string' ? s.rowBorderWidth : undefined,
        rowBorderColor: typeof s.rowBorderColor === 'string' ? s.rowBorderColor : undefined,
        rowBorderStyle: typeof s.rowBorderStyle === 'string' ? s.rowBorderStyle : undefined,
        rowBorderRadius: typeof s.rowBorderRadius === 'string' ? s.rowBorderRadius : undefined,
      };
    }
  }
  return map;
}

function applyMetaToSection(section, meta) {
  if (!meta) return section;
  const next = { ...section, locked: meta.locked === true };
  if (meta.savedSectionId) next.savedSectionId = meta.savedSectionId;
  if (meta.canonical) next.canonical = true;
  if (meta.rowBorderWidth !== undefined) next.rowBorderWidth = meta.rowBorderWidth;
  if (meta.rowBorderColor !== undefined) next.rowBorderColor = meta.rowBorderColor;
  if (meta.rowBorderStyle !== undefined) next.rowBorderStyle = meta.rowBorderStyle;
  if (meta.rowBorderRadius !== undefined) next.rowBorderRadius = meta.rowBorderRadius;
  return next;
}

function normalizeBuilderDocument(value) {
  const coerced = coerceLayoutInput(value);
  const doc = template.normalizeBuilderDocument(coerced);

  // template.normalizeBuilderDocument strips unknown fields like `locked`.
  // Restore locked, savedSectionId, and canonical from pre-normalization input.
  const inputSections = Array.isArray(coerced?.sections) ? coerced.sections
    : Array.isArray(coerced?.layoutSections) ? coerced.layoutSections : [];
  if (doc.layoutSections && inputSections.length) {
    const metaById = sectionMetaFromSections(inputSections);
    doc.layoutSections = doc.layoutSections.map((section) =>
      applyMetaToSection(section, metaById[section.id])
    );
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

  // template.serializeBuilderDocument also strips these fields (calls normalizeLayoutSections).
  // Re-attach so they are persisted to the database.
  if (serialized.sections && document.layoutSections) {
    const metaById = sectionMetaFromSections(document.layoutSections);
    serialized.sections = serialized.sections.map((section) => {
      const meta = metaById[section.id];
      if (!meta) return section;
      const next = { ...section };
      if (meta.locked) next.locked = true;
      if (meta.savedSectionId) next.savedSectionId = meta.savedSectionId;
      if (meta.canonical) next.canonical = true;
      return next;
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
