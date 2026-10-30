/**
 * Which keywords a writer's newest posts mention (Substack Miner upgrade 3/4,
 * task 86bcuxwn5). The Candidates list's "Also mentions" column, and the
 * details page in 4/4, both read it.
 *
 * A keyword matches when it appears in a post's title, subtitle or excerpt,
 * ignoring capital letters and as WHOLE words only — "art" is not in "start".
 * A phrase matches as the same words in order, whatever space sits between
 * them. Keywords in `exclude` (the writer's own Keywords column) are left out,
 * so the column only ever says something new. Each keyword appears once, in
 * the order the keyword list gives them.
 */

export type PostText = { title?: string; subtitle?: string; excerpt?: string };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A pattern for one keyword: its words in order, bounded by non-word-characters on both ends. */
function keywordPattern(keyword: string): RegExp | null {
  const words = keyword.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!words.length) return null;
  // Lookarounds rather than \b, so a keyword that starts or ends with a
  // symbol ("c++") is still bounded properly. Letters and digits of any
  // alphabet count as word characters.
  return new RegExp(`(?<![\\p{L}\\p{N}_])${words.join('\\s+')}(?![\\p{L}\\p{N}_])`, 'iu');
}

export function matchPostKeywords(posts: PostText[], keywords: string[], exclude: string[] = []): string[] {
  // Each field is matched on its own, so a phrase never spans the end of one
  // title and the start of the next post's subtitle.
  const fields = posts.flatMap((p) => [p.title, p.subtitle, p.excerpt]).filter((t): t is string => Boolean(t));
  if (!fields.length) return [];
  const skip = new Set(exclude.map((k) => k.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const keyword = String(raw || '').trim();
    const key = keyword.toLowerCase();
    if (!keyword || skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    const pattern = keywordPattern(keyword);
    if (pattern && fields.some((field) => pattern.test(field))) out.push(keyword);
  }
  return out;
}
