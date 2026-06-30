/**
 * Feature switches for Builder modules not yet backed by a starcaster
 * backend. Modules stay in the codebase but are hidden from the
 * palette and render placeholders when a capability is off.
 */
export const BUILDER_CAPABILITIES = {
  playerPortal: false,
  legacyRemindersImport: false,
  pollDeepDive: false
} as const;

export type BuilderCapability = keyof typeof BUILDER_CAPABILITIES;

export function builderCapabilityEnabled(capability: BuilderCapability): boolean {
  return BUILDER_CAPABILITIES[capability];
}
