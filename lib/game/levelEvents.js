'use strict';

const { normalizeBuilderModules } = require('../builder/template');

const SUPPORTED_GAME_EVENT_MODULE_TYPES = new Set([
  'confetti',
  'speech-bubble',
  'floating-image',
  'reminder',
]);

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeAudience(value) {
  const candidate = safeText(value, 40).toLowerCase();
  if (candidate === 'public' || candidate === 'portal' || candidate === 'both') return candidate;
  return 'both';
}

function firstRelation(value) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function toRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveSavedModuleClass(moduleClass, modules) {
  const trimmed = safeText(moduleClass, 255);
  if (trimmed) return trimmed;
  const first = Array.isArray(modules) ? modules[0] : null;
  return safeText(first?.type, 80);
}

function isSupportedGameEventModuleType(type) {
  return SUPPORTED_GAME_EVENT_MODULE_TYPES.has(safeText(type, 80).toLowerCase());
}

function buildLevelEventsFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.flatMap((row) => {
    const savedModule = firstRelation(row.builder_modules || row.builderModules || row.builder_cell_modules);
    const modules = normalizeBuilderModules(savedModule?.modules);
    const savedModuleDefinition = modules.length === 1 ? modules[0] : null;
    const moduleSettings = savedModuleDefinition?.settings || {};
    const moduleType = safeText(savedModuleDefinition?.type, 80);

    if (!savedModuleDefinition || !isSupportedGameEventModuleType(moduleType)) {
      return [];
    }

    return [{
      eventName: safeText(row.event_name || row.eventName, 255) || 'Level Up Event',
      levelName: safeText(row.level_name || row.levelName, 80),
      sublevelName: safeText(row.sublevel_name || row.sublevelName, 160),
      moduleId: safeText(row.module_id || row.moduleId, 120) || safeText(savedModule?.id, 120),
      moduleName: safeText(savedModule?.name, 255) || safeText(savedModuleDefinition.name, 255) || 'Game Effect',
      moduleType,
      moduleSettings,
      gameModule: savedModuleDefinition,
      trigger: safeText(row.trigger, 40) || 'game',
      audience: normalizeAudience(row.audience ?? moduleSettings.gameAudience),
      metadata: toRecord(row.metadata),
    }];
  });
}

module.exports = {
  SUPPORTED_GAME_EVENT_MODULE_TYPES,
  buildLevelEventsFromRows,
  isSupportedGameEventModuleType,
};
