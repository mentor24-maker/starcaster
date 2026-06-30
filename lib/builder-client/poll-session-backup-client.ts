"use client";

export const POLL_SESSION_BACKUP_STORAGE_KEY = "starcaster_poll_session_backup";

function claimedStorageKey(playerId: string) {
  return `starcaster_poll_session_claimed_${playerId}`;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isStoredPollSessionId(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export function savePollSessionBackup(sessionId: string) {
  if (!isStoredPollSessionId(sessionId)) {
    return;
  }

  try {
    localStorage.setItem(POLL_SESSION_BACKUP_STORAGE_KEY, sessionId);
  } catch {
    // Private browsing or storage quota — ignore.
  }
}

export function readPollSessionBackup(): string | null {
  try {
    const value = localStorage.getItem(POLL_SESSION_BACKUP_STORAGE_KEY);
    return isStoredPollSessionId(value) ? value : null;
  } catch {
    return null;
  }
}

export function markPollSessionClaimedForUser(playerId: string, sessionId: string) {
  if (!isStoredPollSessionId(sessionId) || !playerId.trim()) {
    return;
  }

  try {
    localStorage.setItem(claimedStorageKey(playerId), sessionId);
  } catch {
    // ignore
  }
}

export function wasPollSessionClaimedForUser(playerId: string, sessionId: string) {
  try {
    return localStorage.getItem(claimedStorageKey(playerId)) === sessionId;
  } catch {
    return false;
  }
}

export function rememberPollSessionFromPayload(pollSessionId: string | undefined) {
  if (pollSessionId) {
    savePollSessionBackup(pollSessionId);
  }
}
