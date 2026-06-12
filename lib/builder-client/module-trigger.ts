export const MODULE_TRIGGER_SETTING_KEY = "trigger";

export const MODULE_TRIGGER_OPTIONS = [
  { value: "button", label: "Button Click" },
  { value: "on-load", label: "Page Load" },
  { value: "game", label: "Game" }
] as const;

export type ModuleTrigger = (typeof MODULE_TRIGGER_OPTIONS)[number]["value"];

export function normalizeModuleTrigger(value: string | undefined): ModuleTrigger {
  const allowed = new Set<ModuleTrigger>(MODULE_TRIGGER_OPTIONS.map((option) => option.value));
  const candidate = String(value ?? "").trim();

  if (allowed.has(candidate as ModuleTrigger)) {
    return candidate as ModuleTrigger;
  }

  return "button";
}

export function getModuleTrigger(settings: Record<string, string>): ModuleTrigger {
  return normalizeModuleTrigger(settings[MODULE_TRIGGER_SETTING_KEY]);
}

export function isGameModuleTrigger(settings: Record<string, string>): boolean {
  return getModuleTrigger(settings) === "game";
}
