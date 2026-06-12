/**
 * Type subset of normie's lib/player-game-reminders needed by the
 * reminder runtime's diagnostics props. The server-side reminder
 * evaluation stays in normie; starcaster uses game-reminder-eval directly.
 */

export type PlayerGameReminderDiagnosticReminder = {
  id: string;
  name: string;
  appearance: string;
  criterionSummary: string;
  matched: boolean;
  matchReason: string;
  queuedForDisplay: boolean;
  blockedByDismissal: boolean;
};

export type PlayerGameReminderDiagnostics = {
  loadedAt: string;
  playerId: string | null;
  evaluationSource: 'authenticated' | 'anonymous_session' | 'empty';
  sessionId: string | null;
  loadError: string | null;
  activeReminderCount: number;
  context: {
    pollsTaken: number;
    loginCount: number;
    isRegistered: boolean;
    answeredPollIds: string[];
  };
  reminders: PlayerGameReminderDiagnosticReminder[];
  matchedSpeechBubbleCount: number;
  matchedStripCount: number;
};
