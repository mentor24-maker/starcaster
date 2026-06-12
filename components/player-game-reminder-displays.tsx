"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatRichTextContent } from "@/lib/builder-template";
import type { PlayerMatchedReminder } from "@/lib/game-reminder-eval";
import {
  getReminderSpeechBubbleBodyStyle,
  getReminderSpeechBubbleShellStyle,
  getReminderStripOffsetStyle,
  resolveReminderHostZIndex,
  resolveReminderStripPlacement
} from "@/lib/game-reminder-presentation";
import {
  persistDismissedReminderIds,
  readDismissedReminderIds
} from "@/lib/player-game-reminder-dismissals";

function useVisibleReminders(reminders: PlayerMatchedReminder[]) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    setDismissedIds(readDismissedReminderIds());
  }, [reminders]);

  const visibleReminders = useMemo(
    () => reminders.filter((reminder) => !dismissedIds.includes(reminder.id)),
    [dismissedIds, reminders]
  );

  function dismissReminder(reminderId: string) {
    setDismissedIds((current) => {
      const next = current.includes(reminderId) ? current : [...current, reminderId];
      persistDismissedReminderIds(next);
      return next;
    });
  }

  return { visibleReminders, dismissReminder };
}

function useDismissActiveReminderOnClick(
  activeReminder: PlayerMatchedReminder | null,
  dismissReminder: (reminderId: string) => void
) {
  useEffect(() => {
    if (!activeReminder) {
      return;
    }

    const reminderId = activeReminder.id;

    function handleClick() {
      dismissReminder(reminderId);
    }

    window.addEventListener("click", handleClick, { once: true });

    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, [activeReminder, dismissReminder]);
}

function ReminderRichMessage({ messageHtml }: { messageHtml: string }) {
  return (
    <div
      className="player-game-reminder-message"
      dangerouslySetInnerHTML={{ __html: formatRichTextContent(messageHtml) }}
    />
  );
}

/** Speech-bubble styled reminder above page content; dismisses on the next click anywhere. */
export function PlayerGameRemindersSpeechBubble({ reminders }: { reminders: PlayerMatchedReminder[] }) {
  const [isMounted, setIsMounted] = useState(false);
  const { visibleReminders, dismissReminder } = useVisibleReminders(reminders);
  const activeReminder = visibleReminders[0] ?? null;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useDismissActiveReminderOnClick(activeReminder, dismissReminder);

  if (!activeReminder || !isMounted) {
    return null;
  }

  const shellStyle = getReminderSpeechBubbleShellStyle(activeReminder.metadata);
  const bodyStyle = getReminderSpeechBubbleBodyStyle(activeReminder.metadata);
  const hostZIndex = resolveReminderHostZIndex(activeReminder.metadata);

  return createPortal(
    <div
      aria-live="polite"
      className="player-game-reminder-speech-host"
      style={{ zIndex: hostZIndex }}
    >
      <div className="builder-preview-speech-bubble" style={shellStyle}>
        <div className="builder-preview-speech-bubble-body" style={bodyStyle}>
          <div className="builder-preview-speech-bubble-content">
            <ReminderRichMessage messageHtml={activeReminder.messageHtml} />
          </div>
          <span aria-hidden="true" className="builder-preview-speech-bubble-tail" />
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Full-width strip reminder (top by default); dismisses on the next click anywhere. */
export function PlayerGameRemindersStrip({ reminders }: { reminders: PlayerMatchedReminder[] }) {
  const { visibleReminders, dismissReminder } = useVisibleReminders(reminders);
  const activeReminder = visibleReminders[0] ?? null;

  useDismissActiveReminderOnClick(activeReminder, dismissReminder);

  if (!activeReminder) {
    return null;
  }

  const placement = resolveReminderStripPlacement(activeReminder.metadata);
  const hostZIndex = resolveReminderHostZIndex(activeReminder.metadata);
  const offsetStyle = getReminderStripOffsetStyle(activeReminder.metadata);

  return (
    <div
      aria-live="polite"
      className={`player-game-reminder-strip player-game-reminder-strip-${placement}`}
      role="status"
      style={{ zIndex: hostZIndex }}
    >
      <div className="player-game-reminder-strip-inner" style={offsetStyle}>
        <strong className="player-game-reminder-strip-title">{activeReminder.name}</strong>
        <ReminderRichMessage messageHtml={activeReminder.messageHtml} />
      </div>
    </div>
  );
}
