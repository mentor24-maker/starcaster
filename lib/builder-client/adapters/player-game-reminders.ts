/**
 * Type subset for player-game-reminders used by the reminder runtime's
 * diagnostics props. Server-side evaluation uses game-reminder-eval directly.
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
