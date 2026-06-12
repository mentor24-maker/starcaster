/**
 * Stub for normie's reminder diagnostics HUD (debug tooling tied to the
 * normie player session model).
 */
import type { PlayerGameReminderDiagnostics } from "@/lib/player-game-reminders";

export function PlayerGameReminderDiagnosticsGate(_props: {
  diagnostics: PlayerGameReminderDiagnostics;
  isLoading?: boolean;
}) {
  return null;
}
