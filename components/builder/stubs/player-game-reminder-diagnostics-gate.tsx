/**
 * Stub for the reminder diagnostics HUD (debug tooling; no player session model in starcaster).
 */
import type { PlayerGameReminderDiagnostics } from "@/lib/player-game-reminders";

export function PlayerGameReminderDiagnosticsGate(_props: {
  diagnostics: PlayerGameReminderDiagnostics;
  isLoading?: boolean;
}) {
  return null;
}
