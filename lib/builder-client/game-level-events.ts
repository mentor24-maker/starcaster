import { normalizeGameAudience } from "@/lib/game-audience";
import { isSupportedGameEventModuleType, resolveSavedModuleClass } from "@/lib/module-class-triggers";
import type { PlayerPortalLevelEvent } from "@/lib/player-portal";
import { normalizeBuilderModules, type BuilderTemplateModule } from "@/lib/builder-template";

export type GameLevelEventRow = {
  event_name: string | null;
  level_name: string | null;
  sublevel_name: string | null;
  module_id: string | null;
  trigger: string | null;
  audience?: string | null;
  metadata: unknown;
  builder_cell_modules?:
    | {
        id: string | null;
        name: string | null;
        module_class: string | null;
        modules: unknown;
      }
    | Array<{
        id: string | null;
        name: string | null;
        module_class: string | null;
        modules: unknown;
      }>
    | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function buildLevelEventsFromRows(rows: GameLevelEventRow[]): PlayerPortalLevelEvent[] {
  return rows.flatMap((row) => {
    const savedModule = firstRelation(row.builder_cell_modules);
    const modules = normalizeBuilderModules(savedModule?.modules);
    const savedModuleDefinition = modules.length === 1 ? modules[0] : null;
    const moduleSettings = savedModuleDefinition?.settings ?? {};
    const moduleClass = resolveSavedModuleClass(savedModule?.module_class, modules);
    const moduleType = String(savedModuleDefinition?.type ?? "").trim();

    if (!savedModuleDefinition || !isSupportedGameEventModuleType(moduleType)) {
      return [];
    }

    const audience = normalizeGameAudience(row.audience ?? moduleSettings.gameAudience);

    return [
      {
        eventName: row.event_name ?? "Level Up Event",
        levelName: row.level_name ?? "",
        sublevelName: row.sublevel_name ?? "",
        moduleId: row.module_id ?? savedModule?.id ?? "",
        moduleName: savedModule?.name ?? savedModuleDefinition.name ?? "Game Effect",
        moduleType,
        moduleSettings,
        gameModule: savedModuleDefinition as BuilderTemplateModule,
        trigger: row.trigger ?? "game",
        audience,
        metadata: toRecord(row.metadata)
      }
    ];
  });
}

export const ACTIVE_GAME_LEVEL_EVENTS_SELECT =
  "event_name, level_name, sublevel_name, module_id, trigger, audience, metadata, builder_cell_modules(id, name, module_class, modules)";
