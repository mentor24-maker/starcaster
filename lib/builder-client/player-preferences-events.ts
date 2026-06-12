export const PLAYER_PREFERENCES_UPDATED_EVENT = "normie-player-preferences-updated";
const PLAYER_PREFERENCES_UPDATED_STORAGE_KEY = "normie-player-preferences-updated";

export function dispatchPlayerPreferencesUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(PLAYER_PREFERENCES_UPDATED_EVENT));

  try {
    localStorage.setItem(PLAYER_PREFERENCES_UPDATED_STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

export function subscribePlayerPreferencesUpdated(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(PLAYER_PREFERENCES_UPDATED_EVENT, listener);

  function handleStorage(event: StorageEvent) {
    if (event.key === PLAYER_PREFERENCES_UPDATED_STORAGE_KEY) {
      listener();
    }
  }

  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(PLAYER_PREFERENCES_UPDATED_EVENT, listener);
    window.removeEventListener("storage", handleStorage);
  };
}
