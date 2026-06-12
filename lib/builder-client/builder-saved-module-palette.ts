import { modulePaletteGroups, modulePaletteItems, type ModulePaletteGroup } from "@/components/builder/builder-types";
import type { BuilderCellModuleRecord, BuilderTemplateModule } from "@/lib/builder-template";
import { resolveSavedModuleClass } from "@/lib/module-class-triggers";

/** Palette groups populated only from saved modules matched by module class. */
export const SAVED_MODULE_ONLY_PALETTE_GROUPS: ModulePaletteGroup[] = ["special-effects"];

export function isSavedModuleOnlyPaletteGroup(group: ModulePaletteGroup): boolean {
  return SAVED_MODULE_ONLY_PALETTE_GROUPS.includes(group);
}

export function getPaletteGroupLabel(group: ModulePaletteGroup): string {
  return modulePaletteGroups.find((entry) => entry.value === group)?.label ?? String(group);
}

export function getSavedModulesForPaletteGroup(
  cellModules: BuilderCellModuleRecord[],
  group: ModulePaletteGroup
): BuilderCellModuleRecord[] {
  const groupLabel = getPaletteGroupLabel(group).toLowerCase();

  return cellModules.filter((cellModule) => {
    if (cellModule.modules.length !== 1) {
      return false;
    }

    return resolveSavedModuleClass(cellModule.moduleClass, cellModule.modules).toLowerCase() === groupLabel;
  });
}

/** Built-in palette starters for groups that still ship blank module templates. */
export function getStarterModulesForPaletteGroup(group: ModulePaletteGroup) {
  if (isSavedModuleOnlyPaletteGroup(group)) {
    return [];
  }

  return modulePaletteItems.filter((item) => item.group === group);
}

export function getSavedModulePaletteIcon(module: BuilderTemplateModule): string {
  const paletteItem = modulePaletteItems.find((item) => item.type === module.type);

  return paletteItem?.icon ?? "◆";
}

export function getSavedModulePaletteLabel(cellModule: BuilderCellModuleRecord): string {
  const savedModule = cellModule.modules[0];

  if (!savedModule) {
    return cellModule.name || "Saved Module";
  }

  const paletteItem = modulePaletteItems.find((item) => item.type === savedModule.type);
  const typeLabel = paletteItem?.label ?? savedModule.type;

  return cellModule.name?.trim() || savedModule.name?.trim() || typeLabel;
}
