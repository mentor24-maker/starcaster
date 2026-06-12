import { getCurrentPollPanelStyle } from "@/lib/current-poll-module";
import type { CurrentPoll, PollSettingsSnapshot } from "@/src/site/home/types";
import { PollCategoryHeadline } from "@/src/site/home/partials/poll-category-headline";

type CurrentPollPanelProps = {
  currentPoll: CurrentPoll;
  isAwaitingNextPoll?: boolean;
  isSubmitting: boolean;
  moduleSettings?: Record<string, string>;
  onSubmit: (optionId: string) => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  settings?: PollSettingsSnapshot | null;
  showSkipPoll?: boolean;
};

export function CurrentPollPanel({
  currentPoll,
  isAwaitingNextPoll = false,
  isSubmitting,
  moduleSettings = {},
  onSubmit,
  onSkip,
  settings,
  showSkipPoll = false
}: CurrentPollPanelProps) {
  const panelBusy = isSubmitting || isAwaitingNextPoll;

  return (
    <article
      className={`panel action-panel poll-module-panel${isAwaitingNextPoll ? " poll-module-panel-awaiting-next" : ""}`}
      style={getCurrentPollPanelStyle(moduleSettings, settings)}
    >
      <div className="panel-label">Current Question</div>
      <PollCategoryHeadline category={currentPoll.category} />
      {isAwaitingNextPoll ? (
        <div
          aria-busy="true"
          aria-label="Loading next question"
          className="poll-question-area poll-question-area-hold"
        />
      ) : (
        <div className="poll-question-area">
          <h2 className="poll-question">{currentPoll.question}</h2>
          <div className="option-list">
            {currentPoll.options.map((option, index) => (
              <button
                className={`option-button poll-answer-button-${index === 0 ? "a" : "b"}`}
                key={option.id}
                onClick={() => void onSubmit(option.id)}
                disabled={panelBusy}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          {showSkipPoll && onSkip ? (
            <div className="poll-pod-action-row">
              <button
                className="secondary-button poll-pod-action-button"
                disabled={panelBusy}
                onClick={() => void onSkip()}
                type="button"
              >
                Skip Question
              </button>
            </div>
          ) : null}
        </div>
      )}
      {isSubmitting ? <p className="panel-copy">Saving your answer...</p> : null}
    </article>
  );
}
