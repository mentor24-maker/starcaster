export type RichTextEmojiGroup = {
  id: string;
  label: string;
  emojis: string[];
};

export const RICH_TEXT_EMOJI_GROUPS: RichTextEmojiGroup[] = [
  {
    id: "smileys",
    label: "Smileys",
    emojis: ["😀", "😃", "😄", "😁", "😊", "🙂", "😉", "😍", "🥳", "😎", "🤩", "😇", "🤔", "😮", "😅", "😂"]
  },
  {
    id: "gestures",
    label: "Gestures",
    emojis: ["👋", "👍", "👏", "🙌", "🤝", "✌️", "🤞", "💪", "🫶", "👀", "🙏", "🤙"]
  },
  {
    id: "hearts",
    label: "Hearts",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💕", "💖", "💯", "✨"]
  },
  {
    id: "game",
    label: "Game",
    emojis: ["🔔", "🎯", "🏆", "🥇", "🎉", "🎊", "🔥", "⚡", "⭐", "🌟", "💡", "🗳️", "📊", "📈", "🎮", "🏅"]
  },
  {
    id: "objects",
    label: "Objects",
    emojis: ["💬", "📣", "✅", "❌", "❗", "❓", "➡️", "🔗", "📝", "🎁", "🚀", "⏰", "📅", "🔒", "🔓", "💎"]
  }
];

export const RICH_TEXT_EMOJI_FLAT = RICH_TEXT_EMOJI_GROUPS.flatMap((group) => group.emojis);
