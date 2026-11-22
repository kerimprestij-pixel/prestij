// E-mail log filters <-> Turkish URL params (/panel/e-postalar?durum=&sablon=&ara=&ilgili=order:12&sayfa=).
// Pure: shared by the list page and its links.
import { EMAIL_RELATED_TYPES, EMAIL_STATUSES, type EmailRelatedType, type EmailStatus } from "@/lib/email/types";

export type EmailLogFilter = {
  status: EmailStatus | null;
  template: string | null;
  /** Recipient or subject contains (case-insensitive). */
  q: string;
  related: { type: EmailRelatedType; id: string | null } | null;
};

export const EMAIL_LOG_PATH = "/panel/e-postalar";

/** Turkish status params. */
export const EMAIL_STATUS_PARAM: Record<EmailStatus, string> = {
  queued: "kuyrukta",
  sending: "gonderiliyor",
  sent: "gonderildi",
  failed: "basarisiz",
  cancelled: "iptal",
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function parseEmailLogFilter(params: Params): EmailLogFilter {
  const durum = read(params, "durum");
  const status = (Object.entries(EMAIL_STATUS_PARAM).find(([, p]) => p === durum)?.[0] as EmailStatus | undefined) ?? null;
  const sablon = (read(params, "sablon") ?? "").trim();
  const ilgili = (read(params, "ilgili") ?? "").trim();
  const [type, id] = ilgili.split(":", 2);
  const related =
    type && (EMAIL_RELATED_TYPES as readonly string[]).includes(type)
      ? { type: type as EmailRelatedType, id: id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null }
      : null;
  return {
    status,
    template: /^[a-z][a-z0-9_]{1,63}$/.test(sablon) ? sablon : null,
    q: (read(params, "ara") ?? "").trim().slice(0, 100),
    related,
  };
}

export function parseEmailLogPage(params: Params): number {
  const n = Number(read(params, "sayfa"));
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

export function emailLogQuery(filter: Partial<EmailLogFilter>, page?: number): string {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("durum", EMAIL_STATUS_PARAM[filter.status]);
  if (filter.template) qs.set("sablon", filter.template);
  if (filter.q) qs.set("ara", filter.q);
  if (filter.related) qs.set("ilgili", filter.related.id ? `${filter.related.type}:${filter.related.id}` : filter.related.type);
  if (page && page > 1) qs.set("sayfa", String(page));
  return qs.toString();
}

export function emailLogHref(filter: Partial<EmailLogFilter>, page?: number): string {
  const qs = emailLogQuery(filter, page);
  return qs ? `${EMAIL_LOG_PATH}?${qs}` : EMAIL_LOG_PATH;
}

export const EMAIL_STATUSES_ORDERED: readonly EmailStatus[] = EMAIL_STATUSES;
