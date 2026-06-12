export function isReminderDebugEnabled(search = ""): boolean {
  if (typeof window !== "undefined" && !search) {
    return new URLSearchParams(window.location.search).get("reminderDebug") === "1";
  }

  return new URLSearchParams(search).get("reminderDebug") === "1";
}
