"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BuilderTemplateSection } from "@/lib/builder-template";
import {
  PlayerGameRemindersSpeechBubble,
  PlayerGameRemindersStrip
} from "@/components/player-game-reminder-displays";
import { PlayerGameReminderDiagnosticsGate } from "@/components/player-game-reminder-diagnostics-gate";
import { collectEvaluableRemindersFromLayout } from "@/lib/builder-reminder-module";
import { evaluatePlayerReminders, explainReminderMatch, type PlayerMatchedReminder } from "@/lib/game-reminder-eval";
import { gameAudienceFiresForContext, type GamePlayContext } from "@/lib/game-audience";
import { POLL_TEST_MODE_CHANGED_EVENT } from "@/lib/poll-test-mode";
import type { PlayerReminderContext } from "@/lib/game-reminder-eval";
import type { PlayerGameReminderDiagnostics } from "@/lib/player-game-reminders";
import { formatReminderCriteriaSummary } from "@/lib/game-reminder";
import { PLAYER_GAME_REMINDERS_REFRESH_EVENT } from "@/lib/player-reminder-events";
import { syncDismissedReminderIds } from "@/lib/player-game-reminder-dismissals";

type ReminderContextResponse = {
  context: {
    pollsTaken: number;
    loginCount: number;
    isRegistered: boolean;
    answeredPollIds: string[];
  };
  playerId: string | null;
  evaluationSource: PlayerGameReminderDiagnostics["evaluationSource"];
  sessionId: string | null;
  error?: string;
};

type BuilderReminderRuntimeProps = {
  layoutSections: BuilderTemplateSection[];
};

export function BuilderReminderRuntime({ layoutSections }: BuilderReminderRuntimeProps) {
  const [contextPayload, setContextPayload] = useState<ReminderContextResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshContext = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoading(true);
    }
    setFetchError(null);

    try {
      const response = await fetch("/api/player/reminder-context", { cache: "no-store" });
      const data = (await response.json()) as ReminderContextResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load reminder context.");
      }

      setContextPayload(data);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Failed to load reminder context.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  useEffect(() => {
    const handleRefresh = () => {
      void refreshContext({ silent: true });
    };

    window.addEventListener(PLAYER_GAME_REMINDERS_REFRESH_EVENT, handleRefresh);
    window.addEventListener(POLL_TEST_MODE_CHANGED_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(PLAYER_GAME_REMINDERS_REFRESH_EVENT, handleRefresh);
      window.removeEventListener(POLL_TEST_MODE_CHANGED_EVENT, handleRefresh);
    };
  }, [refreshContext]);

  const pageReminders = useMemo(() => collectEvaluableRemindersFromLayout(layoutSections), [layoutSections]);

  const playContext: GamePlayContext =
    contextPayload?.evaluationSource === "authenticated" ? "portal" : "public";

  const eligibleReminders = useMemo(
    () =>
      pageReminders.filter(
        (reminder) => reminder.isActive && gameAudienceFiresForContext(reminder.audience, playContext)
      ),
    [pageReminders, playContext]
  );

  const playerContext: PlayerReminderContext | null = useMemo(() => {
    if (!contextPayload) {
      return null;
    }

    return {
      pollsTaken: contextPayload.context.pollsTaken,
      loginCount: contextPayload.context.loginCount,
      isRegistered: contextPayload.context.isRegistered,
      answeredPollIds: new Set(contextPayload.context.answeredPollIds)
    };
  }, [contextPayload]);

  const matched = useMemo(() => {
    if (!playerContext) {
      return [] as PlayerMatchedReminder[];
    }

    return evaluatePlayerReminders(eligibleReminders, playerContext);
  }, [eligibleReminders, playerContext]);

  useEffect(() => {
    if (matched.length === 0) {
      return;
    }

    syncDismissedReminderIds(
      pageReminders.map((reminder) => ({
        id: reminder.id,
        matched: matched.some((entry) => entry.id === reminder.id)
      }))
    );
  }, [matched, pageReminders]);

  const speechBubbleReminders = matched.filter((reminder) => reminder.appearance === "speech_bubble");
  const stripReminders = matched.filter((reminder) => reminder.appearance === "strip");

  const diagnostics: PlayerGameReminderDiagnostics = useMemo(() => {
    const matchedIds = new Set(matched.map((reminder) => reminder.id));
    const context = contextPayload?.context ?? {
      pollsTaken: 0,
      loginCount: 0,
      isRegistered: false,
      answeredPollIds: []
    };

    return {
      loadedAt: new Date().toISOString(),
      playerId: contextPayload?.playerId ?? null,
      evaluationSource: contextPayload?.evaluationSource ?? "empty",
      sessionId: contextPayload?.sessionId ?? null,
      loadError: fetchError,
      activeReminderCount: pageReminders.length,
      context,
      reminders: pageReminders.map((reminder) => {
        const explanation = playerContext
          ? explainReminderMatch(reminder, playerContext)
          : { matched: false, reason: "Waiting for visitor context." };
        const audienceAllowed = gameAudienceFiresForContext(reminder.audience, playContext);

        return {
          id: reminder.id,
          name: reminder.name,
          appearance: reminder.appearance,
          criterionSummary: formatReminderCriteriaSummary(reminder),
          matched: explanation.matched,
          matchReason: explanation.reason,
          queuedForDisplay: audienceAllowed && matchedIds.has(reminder.id),
          blockedByDismissal: false
        };
      }),
      matchedSpeechBubbleCount: speechBubbleReminders.length,
      matchedStripCount: stripReminders.length
    };
  }, [
    contextPayload,
    fetchError,
    matched,
    pageReminders,
    playContext,
    playerContext,
    speechBubbleReminders.length,
    stripReminders.length
  ]);

  if (pageReminders.length === 0) {
    return null;
  }

  return (
    <>
      <PlayerGameRemindersSpeechBubble reminders={speechBubbleReminders} />
      <PlayerGameRemindersStrip reminders={stripReminders} />
      <PlayerGameReminderDiagnosticsGate diagnostics={diagnostics} isLoading={isLoading} />
    </>
  );
}
