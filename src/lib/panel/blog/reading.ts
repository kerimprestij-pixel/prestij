// Blog helpers shared by the panel editor (live preview), the save service and the storefront.
// Pure: no DB, no Next APIs.

/** Average silent reading speed used for the "x dk okuma" estimate (Turkish prose). */
export const WORDS_PER_MINUTE = 200;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Visible text of an HTML fragment (tags dropped, block ends turned into spaces, basic entities decoded). */
export function plainTextOf(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?(p|br|h[1-6]|li|ul|ol|blockquote|hr|div)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === "#") {
        const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Word count of an HTML fragment. */
export function wordCount(html: string | null | undefined): number {
  const text = plainTextOf(html);
  return text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

/** Estimated reading minutes (at least 1) for an HTML body; null when it has no words. */
export function readingMinutes(html: string | null | undefined): number | null {
  const words = wordCount(html);
  return words === 0 ? null : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** True when the HTML has no visible text (e.g. "<p><br></p>" left behind by the editor). */
export function isBlankHtml(html: string | null | undefined): boolean {
  return plainTextOf(html) === "";
}

export type PostVisibility = "draft" | "scheduled" | "published";

/** Where a post stands at `now`: drafts never show; published posts with a future date are scheduled. */
export function postVisibility(
  post: { status: string; publishedAt: Date | string | null },
  now: Date | number = Date.now(),
): PostVisibility {
  if (post.status !== "published") return "draft";
  if (!post.publishedAt) return "published";
  const at = new Date(post.publishedAt).getTime();
  return at > new Date(now).getTime() ? "scheduled" : "published";
}

/**
 * A post's last change for dateModified, article:modified_time, the sitemap lastmod and IndexNow: the
 * later of its updatedAt and its publish date. A scheduled post is saved before it goes live and no row
 * changes when it does, so updatedAt alone would predate publication (and IndexNow would skip it).
 */
export function postLastModified(row: { updatedAt: Date; publishedAt: Date | null }): Date {
  return row.publishedAt && row.publishedAt.getTime() > row.updatedAt.getTime() ? row.publishedAt : row.updatedAt;
}

/**
 * Cache lifetime for a storefront entry that must change at `at` (the next scheduled post's publish
 * time): it goes stale exactly then (at least 1 minute, at most a week ahead), else "max".
 */
export function lifeUntil(at: Date | null, now: number = Date.now()): "max" | { stale: number; revalidate: number; expire: number } {
  if (!at) return "max";
  const seconds = Math.ceil((at.getTime() - now) / 1000);
  const revalidate = Math.min(Math.max(seconds, 60), 7 * 24 * 3600);
  return { stale: 300, revalidate, expire: Math.max(revalidate * 2, 3600) };
}

/** Normalizes free-form tags: trimmed, single spaces, unique ignoring case (Turkish rules), order kept. */
export function normalizeTags(tags: readonly string[], { max = 12, maxLength = 40 } = {}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
    const key = tag.toLocaleLowerCase("tr-TR");
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}
