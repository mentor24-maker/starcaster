import { modulePaletteGroups, modulePaletteItems } from "@/components/builder/builder-types";
import type { BuilderTemplateModule } from "@/lib/builder-template";
import { isGameModuleTrigger } from "@/lib/module-trigger";

/** Module classes that expose the shared Trigger setting in the builder. */
export const MODULE_CLASSES_WITH_TRIGGER = ["Special Effects", "Speech Bubble"] as const;

export const BUILDER_MODULE_CLASS_OPTIONS = [
  ...modulePaletteGroups.map((group) => group.label),
  "Layout",
  "Content",
  "Media",
  "Game",
  "Custom"
].filter((value, index, values) => values.indexOf(value) === index);

export function getBuilderModuleClassOptions(currentValue: string): string[] {
  const trimmedValue = normalizeModuleClassName(currentValue);

  if (!trimmedValue || BUILDER_MODULE_CLASS_OPTIONS.includes(trimmedValue)) {
    return BUILDER_MODULE_CLASS_OPTIONS;
  }

  return [trimmedValue, ...BUILDER_MODULE_CLASS_OPTIONS];
}

export type ModuleClassWithTrigger = (typeof MODULE_CLASSES_WITH_TRIGGER)[number];

export function normalizeModuleClassName(moduleClass: string | null | undefined): string {
  return String(moduleClass ?? "").trim();
}

/** Map legacy slug values (speech-bubble) to canonical class labels (Speech Bubble). */
export function canonicalizeModuleClassName(moduleClass: string | null | undefined): string {
  const trimmed = normalizeModuleClassName(moduleClass);

  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();

  if (lower === "confetti") {
    return "Special Effects";
  }

  const paletteGroup = modulePaletteGroups.find(
    (group) => group.value.toLowerCase() === lower || group.label.toLowerCase() === lower
  );

  if (paletteGroup) {
    return paletteGroup.label;
  }

  const paletteItem = modulePaletteItems.find((item) => item.type.toLowerCase() === lower);

  if (paletteItem) {
    const itemGroup = modulePaletteGroups.find((group) => group.value === paletteItem.group);

    if (itemGroup) {
      return itemGroup.label;
    }
  }

  return trimmed;
}

export function moduleClassSupportsTrigger(moduleClass: string | null | undefined): boolean {
  const normalized = canonicalizeModuleClassName(moduleClass).toLowerCase();

  if (!normalized) {
    return false;
  }

  return MODULE_CLASSES_WITH_TRIGGER.some((value) => value.toLowerCase() === normalized);
}

/** Module types that always expose Trigger settings regardless of saved class. */
export const MODULE_TYPES_WITH_TRIGGER = ["speech-bubble"] as const;

export function moduleTypeSupportsTrigger(moduleType: string | null | undefined): boolean {
  const normalized = String(moduleType ?? "").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return MODULE_TYPES_WITH_TRIGGER.some((value) => value.toLowerCase() === normalized);
}

export function builderModuleShowsTriggerSettings(
  module: BuilderTemplateModule,
  moduleClassOverride?: string | null
): boolean {
  if (moduleTypeSupportsTrigger(module.type)) {
    return true;
  }

  return moduleClassSupportsTrigger(resolveModuleClassForBuilderModule(module, moduleClassOverride));
}

export function inferModuleClassFromBuilderModules(modules: BuilderTemplateModule[]): string {
  if (modules.length !== 1) {
    return "Layout";
  }

  const moduleType = modules[0]?.type;

  if (moduleType === "confetti") {
    return "Special Effects";
  }

  if (moduleType === "speech-bubble") {
    return "Speech Bubble";
  }

  if (moduleType === "reminder") {
    return "Reminders";
  }

  const paletteItem = modulePaletteItems.find((item) => item.type === moduleType);
  const paletteGroup = modulePaletteGroups.find((group) => group.value === (paletteItem?.group ?? moduleType));

  return paletteGroup?.label ?? String(moduleType ?? "Custom");
}

export function inferModuleClassFromBuilderModule(module: BuilderTemplateModule): string {
  return inferModuleClassFromBuilderModules([module]);
}

export function resolveSavedModuleClass(
  moduleClass: string | null | undefined,
  modules: BuilderTemplateModule[]
): string {
  const explicit = canonicalizeModuleClassName(moduleClass);

  if (explicit) {
    return explicit;
  }

  if (modules.length === 1) {
    const fromSettings = normalizeModuleClassName(modules[0]?.settings?.moduleClass);

    if (fromSettings) {
      return fromSettings;
    }
  }

  return inferModuleClassFromBuilderModules(modules);
}

export function isGameLayerTriggeredModule(
  moduleClass: string | null | undefined,
  settings: Record<string, string>,
  moduleType?: string | null
): boolean {
  if (moduleTypeSupportsTrigger(moduleType) && isGameModuleTrigger(settings)) {
    return true;
  }

  return moduleClassSupportsTrigger(moduleClass) && isGameModuleTrigger(settings);
}

/** Module types the game layer knows how to execute today. */
export const GAME_EVENT_MODULE_TYPES = ["confetti", "floating-image", "speech-bubble"] as const;

export type GameEventModuleType = (typeof GAME_EVENT_MODULE_TYPES)[number];

export function isSupportedGameEventModuleType(moduleType: string): moduleType is GameEventModuleType {
  return (GAME_EVENT_MODULE_TYPES as readonly string[]).includes(moduleType);
}

export function resolveModuleClassForBuilderModule(
  module: BuilderTemplateModule,
  moduleClassOverride?: string | null
): string {
  const explicitOverride = canonicalizeModuleClassName(moduleClassOverride);

  if (explicitOverride) {
    return explicitOverride;
  }

  const explicitSetting = canonicalizeModuleClassName(module.settings?.moduleClass);

  if (explicitSetting) {
    return explicitSetting;
  }

  return inferModuleClassFromBuilderModule(module);
}

export function isGameEventPickableModule(input: {
  moduleClass: string;
  settings: Record<string, string>;
  moduleType?: string;
}): boolean {
  return isSupportedGameEventModuleType(String(input.moduleType ?? ""));
}

/** @deprecated Use isGameEventPickableModule — kept for existing imports. */
export function isGameEligibleSavedModule(input: {
  moduleClass: string;
  moduleType: string;
  settings: Record<string, string>;
}): boolean {
  return isGameEventPickableModule(input);
}
