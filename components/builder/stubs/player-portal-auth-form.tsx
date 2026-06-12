/**
 * Stub for normie's player portal auth form (no player portal in starcaster;
 * see BUILDER_CAPABILITIES.playerPortal). Keeps the pure settings helpers so
 * the module editor still round-trips settings; the form renders a placeholder.
 */

export type PlayerPortalAuthMode = "login" | "register";

export type PlayerPortalAuthSettings = {
  redirectPath: string;
  defaultMode: PlayerPortalAuthMode;
  showRegister: boolean;
  showForgotPassword: boolean;
};

const defaultPlayerPortalAuthSettings: PlayerPortalAuthSettings = {
  redirectPath: "/portal/dashboard",
  defaultMode: "login",
  showRegister: true,
  showForgotPassword: true
};

function normalizeRedirectPath(value: string | undefined): string {
  const trimmed = value?.trim() || defaultPlayerPortalAuthSettings.redirectPath;

  if (!trimmed.startsWith("/")) {
    return defaultPlayerPortalAuthSettings.redirectPath;
  }

  return trimmed;
}

export function getPlayerPortalAuthSettings(settings: Record<string, string>): PlayerPortalAuthSettings {
  const defaultMode = settings.defaultMode === "register" ? "register" : "login";

  return {
    redirectPath: normalizeRedirectPath(settings.redirectPath),
    defaultMode,
    showRegister: settings.showRegister !== "false",
    showForgotPassword: settings.showForgotPassword !== "false"
  };
}

type PlayerPortalAuthFormProps = {
  settings: PlayerPortalAuthSettings;
  heading?: string;
  previewMode?: boolean;
};

export function PlayerPortalAuthForm({ heading = "" }: PlayerPortalAuthFormProps) {
  return (
    <div className="builder-capability-placeholder">
      {heading ? <h3>{heading}</h3> : null}
      <p>Player Portal modules are not available in StarCaster.</p>
    </div>
  );
}
