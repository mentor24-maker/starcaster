import { isSupportedGameEventModuleType } from "@/lib/module-class-triggers";
import type { BuilderTemplateModule } from "@/lib/builder-template";

export async function fireGameEventModule(
  moduleType: string,
  settings: Record<string, string>,
  moduleDefinition?: BuilderTemplateModule | null
): Promise<boolean> {
  if (!isSupportedGameEventModuleType(moduleType)) {
    return false;
  }

  if (moduleType === "confetti") {
    const { fireConfettiFromModuleSettings } = await import("@/lib/confetti-game-trigger");
    await fireConfettiFromModuleSettings(settings);
    return true;
  }

  if (moduleType === "floating-image" && moduleDefinition) {
    const { fireGameFloatingImageModule } = await import("@/lib/game-floating-image-trigger");
    fireGameFloatingImageModule({
      ...moduleDefinition,
      settings
    });
    return true;
  }

  if (moduleType === "speech-bubble" && moduleDefinition) {
    const { fireGameSpeechBubbleModule } = await import("@/lib/game-speech-bubble-trigger");
    fireGameSpeechBubbleModule({
      ...moduleDefinition,
      settings: { ...moduleDefinition.settings, ...settings }
    });
    return true;
  }

  return false;
}
