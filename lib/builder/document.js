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

function coerceSectionMetaString(value) {
  if (typeof value === 'string' && value.length) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
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
        rowBorderWidth: coerceSectionMetaString(s.rowBorderWidth),
        rowBorderColor: coerceSectionMetaString(s.rowBorderColor),
        rowBorderStyle: coerceSectionMetaString(s.rowBorderStyle),
        rowBorderRadius: coerceSectionMetaString(s.rowBorderRadius),
      };
    }
  }
  return map;
}

// Same rescue, one level down: sectionId → moduleId → {savedModuleId, canonicalLocked}.
//
// normalizeBuilderModuleFromRecord (template.js) whitelists a module down to
// id/type/column/name/text/settings, so a module's link to the saved module it
// came from was written in the browser and thrown away on every save. Nothing
// ever persisted it: 0 of ~1,579 modules across the Delray project carried a
// link, which is why pushing an edit from a saved module to its copies has
// never once worked — the push searched for copies that could not exist.
function moduleMetaFromSections(sections) {
  const map = {};
  if (!Array.isArray(sections)) return map;
  for (const section of sections) {
    if (!section || !section.id || !Array.isArray(section.modules)) continue;
    const byModule = {};
    for (const module of section.modules) {
      if (!module || !module.id) continue;
      const savedModuleId =
        typeof module.savedModuleId === 'string' && module.savedModuleId ? module.savedModuleId : undefined;
      const canonicalLocked = module.canonicalLocked === true;
      // Only carry a module that actually claims a link, so an ordinary page
      // is untouched and the stored document does not grow.
      if (savedModuleId || canonicalLocked) {
        byModule[String(module.id)] = { savedModuleId, canonicalLocked };
      }
    }
    if (Object.keys(byModule).length) map[String(section.id)] = byModule;
  }
  return map;
}

function applyModuleMetaToSection(section, metaByModule) {
  if (!metaByModule || !Array.isArray(section?.modules)) return section;
  let touched = false;
  const modules = section.modules.map((module) => {
    const meta = metaByModule[String(module?.id ?? '')];
    if (!meta) return module;
    touched = true;
    const next = { ...module };
    if (meta.savedModuleId) next.savedModuleId = meta.savedModuleId;
    if (meta.canonicalLocked) next.canonicalLocked = true;
    return next;
  });
  return touched ? { ...section, modules } : section;
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
    const moduleMetaById = moduleMetaFromSections(inputSections);
    doc.layoutSections = doc.layoutSections.map((section) =>
      applyModuleMetaToSection(
        applyMetaToSection(section, metaById[section.id]),
        moduleMetaById[section.id]
      )
    );
  }

  return doc;
}

function serializeBuilderDocument(input) {
  const rawSections = input?.layoutSections ?? input?.sections;
  const document = normalizeBuilderDocument({
    pageBackground: input?.pageBackground,
    theme: input?.theme,
    sections: rawSections,
  });
  const serialized = template.serializeBuilderDocument(document);

  // template.serializeBuilderDocument also strips these fields (calls normalizeLayoutSections).
  // Re-attach so they are persisted to the database. Prefer normalized document values,
  // but fall back to the raw request payload when normalization dropped them.
  if (serialized.sections) {
    const metaFromDocument = sectionMetaFromSections(document.layoutSections);
    const metaFromInput = sectionMetaFromSections(
      Array.isArray(rawSections) ? rawSections : []
    );
    const moduleMetaFromDocument = moduleMetaFromSections(document.layoutSections);
    const moduleMetaFromInput = moduleMetaFromSections(
      Array.isArray(rawSections) ? rawSections : []
    );
    serialized.sections = serialized.sections.map((rawSection) => {
      const moduleMeta = {
        ...moduleMetaFromInput[rawSection.id],
        ...moduleMetaFromDocument[rawSection.id],
      };
      const section = applyModuleMetaToSection(rawSection, moduleMeta);
      const meta = {
        ...metaFromInput[section.id],
        ...metaFromDocument[section.id],
      };
      if (!meta || Object.keys(meta).length === 0) return section;
      const next = { ...section };
      if (meta.locked) next.locked = true;
      if (meta.savedSectionId) next.savedSectionId = meta.savedSectionId;
      if (meta.canonical) next.canonical = true;
      if (meta.rowBorderWidth !== undefined) next.rowBorderWidth = meta.rowBorderWidth;
      if (meta.rowBorderColor !== undefined) next.rowBorderColor = meta.rowBorderColor;
      if (meta.rowBorderStyle !== undefined) next.rowBorderStyle = meta.rowBorderStyle;
      if (meta.rowBorderRadius !== undefined) next.rowBorderRadius = meta.rowBorderRadius;
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
