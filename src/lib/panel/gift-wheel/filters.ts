// Hediye Çarkı panel URLs and their Turkish query params (?donem=7|30|90, ?durum=…&ara=…&sayfa=…).
// Pure: shared by the pages, their links and the CSV export route (so a download matches the list).
import { winnerStatusFromParam, WINNER_STATUS, type WinnerStatus } from "./labels";

export const WHEEL_PANEL_BASE = "/panel/hediye-carki";
export const WHEEL_SETTINGS_PATH = `${WHEEL_PANEL_BASE}/ayarlar`;
export const WHEEL_WINNERS_PATH = `${WHEEL_PANEL_BASE}/kazananlar`;
export const WHEEL_EXPORT_PATH = "/panel/api/hediye-carki/export";

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

// ---------------------------------------------------------------------------------------------------
// Overview period (Istanbul calendar days: today and the days before it)

export const WHEEL_PERIODS = [7, 30, 90] as const;
export type WheelPeriod = (typeof WHEEL_PERIODS)[number];
export const DEFAULT_WHEEL_PERIOD: WheelPeriod = 30;

export function parseWheelPeriod(params: Params): WheelPeriod {
  const n = Number(read(params, "donem"));
  return (WHEEL_PERIODS as readonly number[]).includes(n) ? (n as WheelPeriod) : DEFAULT_WHEEL_PERIOD;
}

export function wheelOverviewHref(period: WheelPeriod): string {
  return period === DEFAULT_WHEEL_PERIOD ? WHEEL_PANEL_BASE : `${WHEEL_PANEL_BASE}?donem=${period}`;
}

// ---------------------------------------------------------------------------------------------------
// Winners list

export type WinnerFilter = {
  status: WinnerStatus | null;
  /** Code (anyone) or e-mail (admins only) search text, trimmed, at most 100 characters. */
  q: string;
};

export const WINNER_PAGE_SIZE = 50;

export function parseWinnerFilter(params: Params): WinnerFilter {
  return {
    status: winnerStatusFromParam(read(params, "durum")),
    q: (read(params, "ara") ?? "").trim().slice(0, 100),
  };
}

export function parseWinnerPage(params: Params): number {
  const n = Number(read(params, "sayfa"));
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100_000) : 1;
}

/** Query string for a filter (+ page), without the leading "?" ("" when empty). */
export function winnerQuery(filter: Partial<WinnerFilter>, page?: number): string {
  const qs = new URLSearchParams();
  if (filter.status) qs.set("durum", WINNER_STATUS[filter.status].param);
  if (filter.q) qs.set("ara", filter.q);
  if (page && page > 1) qs.set("sayfa", String(page));
  return qs.toString();
}

export function winnersListHref(filter: Partial<WinnerFilter>, page?: number): string {
  const qs = winnerQuery(filter, page);
  return qs ? `${WHEEL_WINNERS_PATH}?${qs}` : WHEEL_WINNERS_PATH;
}

export function winnersExportHref(filter: Partial<WinnerFilter>): string {
  const qs = winnerQuery(filter);
  return qs ? `${WHEEL_EXPORT_PATH}?${qs}` : WHEEL_EXPORT_PATH;
}
