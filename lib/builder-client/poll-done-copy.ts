import type { PollDoneReason } from "@/src/site/home/types";

export function getPollDoneMessage(doneReason: PollDoneReason | undefined) {
  switch (doneReason) {
    case "no_polls_matching_preferences":
      return "No published polls match your preferred categories. Open Preferences and select more categories, or clear your selection to see all polls. New imports often use category names that are not in your preference list yet.";
    case "no_polls_in_category":
      return "There are no published polls in this category yet. Try Play Polls without a category filter, or pick another category in Preferences.";
    case "invalid_category":
      return "That category link is not valid. Open Play Polls from the portal header or update your default category in Preferences.";
    case "all_answered_in_category":
      return "You have answered every published poll in this category. Choose another category in Preferences or clear your default category to keep playing.";
    case "all_answered_in_preferences":
      return "You have answered every published poll in your preferred categories. Add more categories in Preferences, or clear your selection to include newly imported polls.";
    case "all_answered":
      return "You have answered every published poll. Check back when new questions are published.";
    case "no_polls_available":
      return "No published polls are available right now. Check back after new questions are published or imported.";
    default:
      return "You are done for now. Check back when new questions are published.";
  }
}
