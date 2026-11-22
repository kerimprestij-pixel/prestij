// Newsletter list filters <-> Turkish URL params (?ara=&durum=aktif|ayrilan&kaynak=&dil=&sayfa=).
// Pure: shared by the list page, its links and the CSV export route, so the export matches the list.
import { LOCALES, type Locale } from "@/i18n/locales";
import { SUBSCRIBER_SOURCES } from "./schemas";

export type SubscriberStatusFilter = "pending" | "active" | "unsubscribed" | null;
export type SubscriberSource = (typeof SUBSCRIBER_SOURCES)[number];

export type SubscriberFilter = {
  q: string;
  status: SubscriberStatusFilter;
  source: SubscriberSource | null;
  locale: Locale | null;
};

export const STATUS_PARAM: Record<Exclude<SubscriberStatusFilter, null>, string> = { pending: "onay-bekleyen", active: "aktif", unsubscribed: "ayrilan" };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function parseSubscriberFilter(params: Params): SubscriberFilter {
  const durum = read(params, "durum");
  const kaynak = read(params, "kaynak");
  const dil = read(params, "dil");
  return {
    q: (read(params, "ara") ?? "").trim().slice(0, 100),
    status: durum === STATUS_PARAM.active ? "active" : durum === STATUS_PARAM.unsubscribed ? "unsubscribed" : durum === STATUS_PARAM.pending ? "pending" : null,
    source: (SUBSCRIBER_SOURCES as readonly string[]).includes(kaynak ?? "") ? (kaynak as SubscriberSource) : null,
    locale: (LOCALES as readonly string[]).includes(dil ?? "") ? (dil as Locale) : null,
  };
}

export function parsePage(params: Params): number {
  const n = Number(read(params, "sayfa"));
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

/** Query string for a filter (+ page), without the leading "?" ("" when empty). */
export function subscriberQuery(filter: Partial<SubscriberFilter>, page?: number): string {
  const qs = new URLSearchParams();
  if (filter.q) qs.set("ara", filter.q);
  if (filter.status) qs.set("durum", STATUS_PARAM[filter.status]);
  if (filter.source) qs.set("kaynak", filter.source);
  if (filter.locale) qs.set("dil", filter.locale);
  if (page && page > 1) qs.set("sayfa", String(page));
  return qs.toString();
}

export const NEWSLETTER_PATH = "/panel/e-bulten";
export const NEWSLETTER_EXPORT_PATH = "/panel/api/newsletter/export";

export function subscriberListHref(filter: Partial<SubscriberFilter>, page?: number): string {
  const qs = subscriberQuery(filter, page);
  return qs ? `${NEWSLETTER_PATH}?${qs}` : NEWSLETTER_PATH;
}

export function subscriberExportHref(filter: Partial<SubscriberFilter>): string {
  const qs = subscriberQuery(filter);
  return qs ? `${NEWSLETTER_EXPORT_PATH}?${qs}` : NEWSLETTER_EXPORT_PATH;
}
