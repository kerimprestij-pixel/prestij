// "Are the Day-1 placeholder prices still in the catalog?" (sales-ready SR-3 / SR-6, FIX F2). Pure: one rule for
// the go-live copy script (scripts/golive/copy-content.ts --profile=sales refuses), its verifier
// (scripts/golive/verify-target.ts) and the panel's launch checklist ("Fiyatlar gerçek" on /panel/seo).
//
// The Day-1 seed (scripts/seed.ts) priced every product with the same few round numbers (and stocked every
// variant with exactly 100 units): 149,90 TL (500 ml), 449,90 TL (5 L), 1.499,90 TL (20 L) and 1.599,90 TL (the
// 4 × 5 L set). A variant "matches" when its price is one of those four, whatever its stock: stock is the field
// the owner is most likely to update first, so it never hides a seed price. Considered = active variants of
// active products, price above 0, not free samples.
//
// What the callers do with the matches:
// - the go-live scripts refuse while ANY considered variant matches and list the SKUs; --allow-prices (the owner
//   really sells at that price) turns this into a warning that still lists them;
// - the panel step is "Tamam" only with no match, "Yapılacak" while the Day-1 set is clearly still there
//   (`placeholder`: at least PLACEHOLDER_MIN_MATCHES matches that are at least PLACEHOLDER_MIN_SHARE of the
//   considered variants), and "Kontrol et" with the SKUs listed in between (the panel has no override, so a
//   price the owner really keeps must not leave the step undone forever).

/** Day-1 seed prices in kuruş: 149,90 / 449,90 / 1.499,90 / 1.599,90 TL. */
export const DAY1_PLACEHOLDER_PRICES: readonly number[] = Object.freeze([14990, 44990, 149990, 159990]);
/** Day-1 seed stock of every variant (only mentioned in the panel's advice; the rule ignores stock). */
export const DAY1_PLACEHOLDER_STOCK = 100;
/** The panel's "Yapılacak": at least this many matching variants … */
export const PLACEHOLDER_MIN_MATCHES = 2;
/** … that are at least this share of the priced variants considered. */
export const PLACEHOLDER_MIN_SHARE = 0.5;

/** One variant with its product's status and type (both the panel query and the scripts' SQL return this). */
export type PriceCheckRow = {
  sku: string;
  price: number;
  stock: number;
  variantActive: boolean;
  productStatus: string;
  productType: string;
};

export type PlaceholderPriceCheck = {
  /** Priced active variants of active products (samples excluded). */
  considered: number;
  /** The considered variants that still carry a Day-1 price (any stock), by SKU. */
  matches: { sku: string; price: number; stock: number }[];
  /** matches / considered (0 when nothing is considered). */
  share: number;
  /** True when the Day-1 placeholder set is clearly still there (the panel's "Yapılacak"; see the file comment). */
  placeholder: boolean;
};

/** SQL (PostgreSQL, no parameters) that returns PriceCheckRow rows; used by the go-live scripts. */
export const PRICE_CHECK_ROWS_SQL = `select v.sku, v.price, v.stock, v.is_active as "variantActive", p.status as "productStatus", p.type as "productType"
  from product_variants v join products p on p.id = v.product_id order by v.id`;

const num = (value: unknown): number => (typeof value === "number" ? value : Number(value));

export function isConsideredForPriceCheck(row: PriceCheckRow): boolean {
  return Boolean(row.variantActive) && row.productStatus === "active" && row.productType !== "sample" && num(row.price) > 0;
}

/** True when the price is one of the Day-1 seed prices (stock is not looked at). */
export function matchesDay1Placeholder(row: Pick<PriceCheckRow, "price">): boolean {
  return DAY1_PLACEHOLDER_PRICES.includes(num(row.price));
}

/** The placeholder-price rule over every variant of the catalog (order does not matter). */
export function placeholderPriceCheck(rows: readonly PriceCheckRow[]): PlaceholderPriceCheck {
  const considered = rows.filter(isConsideredForPriceCheck);
  const matches = considered.filter(matchesDay1Placeholder).map((r) => ({ sku: r.sku, price: num(r.price), stock: num(r.stock) }));
  const share = considered.length ? matches.length / considered.length : 0;
  return {
    considered: considered.length,
    matches,
    share,
    placeholder: matches.length >= PLACEHOLDER_MIN_MATCHES && share >= PLACEHOLDER_MIN_SHARE,
  };
}

/** "149,90 TL" for the messages (kuruş → Turkish lira, no Intl so the scripts print the same everywhere). */
export function formatKurusTl(kurus: number): string {
  const lira = Math.trunc(kurus / 100);
  const rest = String(Math.abs(kurus % 100)).padStart(2, "0");
  return `${String(lira).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${rest} TL`;
}
