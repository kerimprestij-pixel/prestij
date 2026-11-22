// Turkish labels for the blog panel (pure; server and client).
import type { Tone } from "@/components/panel/labels";
import type { PanelPostFilter } from "@/lib/panel/blog/queries";
import { postVisibility, type PostVisibility } from "@/lib/panel/blog/reading";
import { formatIstanbul } from "@/lib/panel/format";

export const POST_FILTERS: { param: string | null; filter: PanelPostFilter; label: string }[] = [
  { param: null, filter: "all", label: "Tümü" },
  { param: "yayinda", filter: "published", label: "Yayında" },
  { param: "planlanan", filter: "scheduled", label: "Planlanan" },
  { param: "taslak", filter: "draft", label: "Taslak" },
];

export function postFilterFromParam(value: string | undefined): (typeof POST_FILTERS)[number] {
  return POST_FILTERS.find((f) => f.param === (value ?? null)) ?? POST_FILTERS[0];
}

export function postListHref({ filter, q, page }: { filter?: string | null; q?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (filter) params.set("durum", filter);
  if (q) params.set("ara", q);
  if (page && page > 1) params.set("sayfa", String(page));
  const query = params.toString();
  return query ? `/panel/blog?${query}` : "/panel/blog";
}

export const VISIBILITY_LABELS: Record<PostVisibility, { label: string; tone: Tone }> = {
  draft: { label: "Taslak", tone: "warning" },
  scheduled: { label: "Planlandı", tone: "info" },
  published: { label: "Yayında", tone: "success" },
};

/** Badge text and tone for a post, e.g. "Planlandı · 12 Kas 2026 09:00". */
export function postStatus(post: { status: string; publishedAt: string | null }, now: number = Date.now()) {
  const visibility = postVisibility(post, now);
  const base = VISIBILITY_LABELS[visibility];
  return {
    visibility,
    tone: base.tone,
    label: base.label,
    detail: visibility === "scheduled" && post.publishedAt ? formatIstanbul(post.publishedAt) : null,
  };
}
