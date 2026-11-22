// Turkish labels and URL helpers of /panel/yorumlar (pure).
import type { Tone } from "@/components/panel/labels";
import type { ReviewStatus } from "@/lib/reviews/types";

export const REVIEWS_PATH = "/panel/yorumlar";

export const REVIEW_STATUS: Record<ReviewStatus, { label: string; tone: Tone }> = {
  pending: { label: "Onay bekliyor", tone: "warning" },
  approved: { label: "Yayında", tone: "success" },
  rejected: { label: "Reddedildi", tone: "danger" },
};

/** URL value of each status tab (Turkish), and the tab label. */
export const STATUS_TABS = [
  { status: "pending", param: "bekleyen", label: "Bekleyen" },
  { status: "approved", param: "yayinda", label: "Yayında" },
  { status: "rejected", param: "reddedilen", label: "Reddedilen" },
  { status: "all", param: "tumu", label: "Tümü" },
] as const;

export type StatusFilter = (typeof STATUS_TABS)[number]["status"];

export function statusFromParam(value: string | undefined): StatusFilter {
  return STATUS_TABS.find((t) => t.param === value)?.status ?? "pending";
}

export const LOCALE_LABEL: Record<string, string> = { tr: "Türkçe", en: "İngilizce", ar: "Arapça" };

export type ReviewListFilter = { status: StatusFilter; productId?: number | null; rating?: number | null; page?: number };

/** /panel/yorumlar?durum=…&urun=…&puan=…&sayfa=… (defaults left out). */
export function reviewsListHref(filter: ReviewListFilter): string {
  const params = new URLSearchParams();
  const tab = STATUS_TABS.find((t) => t.status === filter.status);
  if (tab && tab.status !== "pending") params.set("durum", tab.param);
  if (filter.productId) params.set("urun", String(filter.productId));
  if (filter.rating) params.set("puan", String(filter.rating));
  if (filter.page && filter.page > 1) params.set("sayfa", String(filter.page));
  const query = params.toString();
  return query ? `${REVIEWS_PATH}?${query}` : REVIEWS_PATH;
}
