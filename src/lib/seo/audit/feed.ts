// Google Merchant Center feed (RSS 2.0 + g: namespace) parsing and item rules. Pure. Field rules follow
// the Merchant Center product data specification and the contract (docs/DAY5-SEO.md §5.2): id, title
// (≤ 150), description (plain text, ≤ 5000), link, image_link (never AVIF), availability, price
// ("149.90 TRY"), brand, gtin (valid) or identifier_exists = no, condition, shipping, sale price dates.
import { collapseWhitespace, decodeEntities } from "./html";
import { issue, type Issue } from "./types";
import { isForeignLocalUrl, parseAbsolute, withoutQuery } from "./url";
import { charLength, isValidGtin } from "./values";

export type FeedItem = {
  /** 1-based position in the feed. */
  position: number;
  /** Field name without the g: prefix → every value (repeatable fields keep all). */
  fields: Record<string, string[]>;
  /** <g:shipping> blocks: sub-field → value. */
  shipping: Record<string, string>[];
};

export type ParsedFeed = {
  isRss: boolean;
  hasGoogleNamespace: boolean;
  hasChannel: boolean;
  channel: { title: string | null; link: string | null; description: string | null };
  items: FeedItem[];
};

export type FeedItemFacts = {
  position: number;
  id: string | null;
  link: string | null;
  /** The link without its query string (the product page). */
  productUrl: string | null;
  itemGroupId: string | null;
  price: { value: number; currency: string } | null;
  salePrice: { value: number; currency: string } | null;
  saleWindow: { start: number; end: number } | null;
  availability: string | null;
  images: string[];
};

export const FEED_TITLE_MAX = 150;
export const FEED_DESCRIPTION_MAX = 5000;
export const FEED_ID_MAX = 50;
export const FEED_ADDITIONAL_IMAGES_MAX = 10;
const AVAILABILITY = new Set(["in_stock", "out_of_stock", "preorder", "backorder"]);
const CONDITION = new Set(["new", "refurbished", "used"]);
const YES_NO = new Set(["yes", "no", "true", "false"]);
const PRICE_RE = /^(\d+(?:\.\d{1,2})?) ([A-Z]{3})$/;

const value = (raw: string) => collapseWhitespace(decodeEntities(raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")));
/** Like value() but keeps line breaks (descriptions). */
const longValue = (raw: string) => decodeEntities(raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).trim();

export function parseMerchantFeed(xml: string): ParsedFeed {
  const isRss = /<rss[\s>]/.test(xml) && /<rss\b[^>]*\bversion\s*=\s*["']2\.0["']/.test(xml);
  const hasGoogleNamespace = /xmlns:g\s*=\s*["']http:\/\/base\.google\.com\/ns\/1\.0["']/.test(xml);
  const channelMatch = /<channel\b[^>]*>([\s\S]*?)<\/channel\s*>/i.exec(xml);
  const channelBody = channelMatch ? channelMatch[1].replace(/<item\b[\s\S]*?<\/item\s*>/gi, "") : "";
  const channelField = (tag: string) => {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i").exec(channelBody);
    return m ? value(m[1]) || null : null;
  };

  const items: FeedItem[] = [];
  for (const [index, match] of [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].entries()) {
    const fields: Record<string, string[]> = {};
    const shipping: Record<string, string>[] = [];
    for (const field of match[1].matchAll(/<((?:g:)?[a-zA-Z_][\w-]*)\b[^>]*>([\s\S]*?)<\/\1\s*>/g)) {
      const name = field[1].replace(/^g:/, "").toLowerCase();
      if (name === "shipping") {
        const block: Record<string, string> = {};
        for (const sub of field[2].matchAll(/<(?:g:)?([a-zA-Z_][\w-]*)\b[^>]*>([\s\S]*?)<\/(?:g:)?\1\s*>/g)) block[sub[1].toLowerCase()] = value(sub[2]);
        shipping.push(block);
        continue;
      }
      (fields[name] ??= []).push(name === "description" ? longValue(field[2]) : value(field[2]));
    }
    items.push({ position: index + 1, fields, shipping });
  }
  return {
    isRss,
    hasGoogleNamespace,
    hasChannel: channelMatch !== null,
    channel: { title: channelField("title"), link: channelField("link"), description: channelField("description") },
    items,
  };
}

function parsePrice(raw: string | undefined): { value: number; currency: string } | null {
  const match = raw ? PRICE_RE.exec(raw.trim()) : null;
  return match ? { value: Number(match[1]), currency: match[2] } : null;
}

/** ISO 8601 date-time with a zone; seconds, fractions and a colon-less offset ("+0100", Google's own example) allowed. */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** "2026-11-01T00:00+03:00/2026-11-30T23:59+03:00" → epoch ms bounds, or null when malformed. */
export function parseEffectiveDate(raw: string): { start: number; end: number } | null {
  const [start, end, extra] = raw.trim().split("/");
  if (extra !== undefined || !start || !end || !ISO_DATETIME_RE.test(start) || !ISO_DATETIME_RE.test(end)) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  return Number.isNaN(s) || Number.isNaN(e) || s >= e ? null : { start: s, end: e };
}

export type FeedContext = { origin: string; feedUrl: string; now: Date };

/** Structure + per-item rules. Returns the issues and the facts the cross-site rules need. */
export function checkFeed(feed: ParsedFeed, ctx: FeedContext): { issues: Issue[]; items: FeedItemFacts[] } {
  const issues: Issue[] = [];
  const at = (code: Parameters<typeof issue>[0], message: string) => issues.push(issue(code, message, ctx.feedUrl));
  if (!feed.isRss) at("feed-invalid", 'Not an <rss version="2.0"> document.');
  if (!feed.hasGoogleNamespace) at("feed-invalid", 'Missing xmlns:g="http://base.google.com/ns/1.0".');
  if (!feed.hasChannel) at("feed-invalid", "No <channel>.");
  else {
    const missing = (["title", "link", "description"] as const).filter((k) => !feed.channel[k]);
    if (missing.length > 0) at("feed-item-recommended", `<channel> misses ${missing.join(", ")} (RSS 2.0 requires them).`);
  }
  if (feed.items.length === 0) at("feed-empty", "The feed has no <item>.");

  const facts: FeedItemFacts[] = [];
  const ids = new Map<string, number[]>();
  const currencies = new Set<string>();
  for (const item of feed.items) {
    const f = (name: string) => item.fields[name]?.[0]?.trim() || undefined;
    const id = f("id") ?? null;
    const label = `item #${item.position}${id ? ` (g:id ${id})` : ""}`;
    const required = (name: string, what = `g:${name}`) => {
      const v = f(name);
      if (!v) at("feed-item-required", `${label}: ${what} is missing.`);
      return v;
    };
    const invalid = (message: string) => at("feed-item-invalid", `${label}: ${message}`);
    const recommended = (message: string) => at("feed-item-recommended", `${label}: ${message}`);

    if (id) {
      ids.set(id, [...(ids.get(id) ?? []), item.position]);
      if (charLength(id) > FEED_ID_MAX) invalid(`g:id is longer than ${FEED_ID_MAX} characters.`);
    } else required("id");

    const title = required("title", "title");
    if (title && charLength(title) > FEED_TITLE_MAX) invalid(`title is ${charLength(title)} characters (max ${FEED_TITLE_MAX}).`);
    if (title && /<[a-z!/][^>]*>/i.test(title)) invalid("title contains HTML.");
    const description = required("description", "description");
    if (description && charLength(description) > FEED_DESCRIPTION_MAX) invalid(`description is ${charLength(description)} characters (max ${FEED_DESCRIPTION_MAX}).`);
    if (description && /<[a-z!/][^>]*>/i.test(description)) invalid("description contains HTML (plain text only).");

    const link = required("link", "link");
    const linkUrl = parseAbsolute(link);
    if (link && (!linkUrl || linkUrl.origin !== ctx.origin)) {
      invalid(`link ${link} is not an absolute URL on ${ctx.origin}.`);
      if (isForeignLocalUrl(link, ctx.origin)) at("foreign-origin-url", `${label}: link points to ${link}.`);
    }

    const images: string[] = [];
    const checkImage = (raw: string, field: string) => {
      const url = parseAbsolute(raw);
      if (!url) return invalid(`${field} "${raw}" is not an absolute URL.`);
      if (/\.avif$/i.test(url.pathname)) invalid(`${field} ${raw} is AVIF (Merchant Center does not accept it; use JPEG, PNG or WebP).`);
      if (isForeignLocalUrl(raw, ctx.origin)) at("foreign-origin-url", `${label}: ${field} points to ${raw}.`);
      images.push(url.href);
    };
    const imageLink = required("image_link");
    if (imageLink) checkImage(imageLink, "g:image_link");
    const additional = item.fields.additional_image_link ?? [];
    if (additional.length > FEED_ADDITIONAL_IMAGES_MAX) invalid(`${additional.length} g:additional_image_link (max ${FEED_ADDITIONAL_IMAGES_MAX}).`);
    additional.forEach((raw) => checkImage(raw, "g:additional_image_link"));

    const availability = required("availability");
    if (availability && !AVAILABILITY.has(availability)) invalid(`g:availability "${availability}" is not one of ${[...AVAILABILITY].join(", ")}.`);

    const priceRaw = required("price");
    const price = parsePrice(priceRaw);
    if (priceRaw && !price) invalid(`g:price "${priceRaw}" must look like "149.90 TRY".`);
    if (price && price.value <= 0) invalid(`g:price ${priceRaw} must be greater than zero.`);
    if (price) currencies.add(price.currency);

    const saleRaw = f("sale_price");
    const salePrice = parsePrice(saleRaw);
    if (saleRaw && !salePrice) invalid(`g:sale_price "${saleRaw}" must look like "129.90 TRY".`);
    if (salePrice && price && (salePrice.currency !== price.currency || salePrice.value >= price.value)) invalid(`g:sale_price ${saleRaw} must be lower than g:price ${priceRaw} in the same currency.`);
    const windowRaw = f("sale_price_effective_date");
    let saleWindow: { start: number; end: number } | null = null;
    if (windowRaw) {
      saleWindow = parseEffectiveDate(windowRaw);
      if (!saleWindow) invalid(`g:sale_price_effective_date "${windowRaw}" must be "start/end" in ISO 8601 with a time zone (start before end).`);
      else if (saleWindow.end < ctx.now.getTime()) recommended(`g:sale_price_effective_date ended ${new Date(saleWindow.end).toISOString()}.`);
      if (!saleRaw) invalid("g:sale_price_effective_date without g:sale_price.");
    }

    required("brand");
    const condition = f("condition");
    if (!condition) recommended("g:condition is recommended (new).");
    else if (!CONDITION.has(condition)) invalid(`g:condition "${condition}" is not new, refurbished or used.`);

    const gtin = f("gtin");
    const identifierExists = f("identifier_exists")?.toLowerCase();
    if (identifierExists && !YES_NO.has(identifierExists)) invalid(`g:identifier_exists "${identifierExists}" must be yes or no.`);
    if (gtin && !isValidGtin(gtin)) invalid(`g:gtin "${gtin}" is not a valid GTIN (digits and check digit).`);
    if (gtin && (identifierExists === "no" || identifierExists === "false")) invalid("g:gtin together with g:identifier_exists no.");
    if (!gtin && identifierExists !== "no" && identifierExists !== "false" && !f("mpn")) at("feed-item-required", `${label}: needs a valid g:gtin, or g:identifier_exists no (or g:mpn with g:brand).`);

    if (item.shipping.length === 0) recommended("g:shipping is missing (Merchant Center falls back to account settings).");
    item.shipping.forEach((block, i) => {
      const where = `g:shipping${item.shipping.length > 1 ? `[${i + 1}]` : ""}`;
      if (!block.country || !/^[A-Z]{2}$/.test(block.country)) invalid(`${where} needs g:country as ISO 3166-1 alpha-2 (got ${JSON.stringify(block.country ?? null)}).`);
      const shipPrice = parsePrice(block.price);
      if (!shipPrice) invalid(`${where} g:price "${block.price ?? ""}" must look like "99.90 TRY" (0.00 for free).`);
      else if (price && shipPrice.currency !== price.currency) invalid(`${where} currency ${shipPrice.currency} differs from g:price ${price.currency}.`);
    });
    const weight = f("shipping_weight");
    if (weight && !/^\d+(?:\.\d+)? ?(?:lb|oz|g|kg)$/.test(weight)) invalid(`g:shipping_weight "${weight}" must look like "5.2 kg".`);
    const category = f("google_product_category");
    if (!category) recommended("g:google_product_category is recommended.");
    else if (!/^\d{1,7}$/.test(category) && (/^\d/.test(category) || !category.split(" > ").every((segment) => segment.trim() !== "" && !/[<>]/.test(segment)))) {
      invalid(`g:google_product_category "${category}" is neither a taxonomy id nor a "A > B > C" path.`);
    }
    if (!f("product_type")) recommended("g:product_type is recommended (category > product).");
    const bundle = f("is_bundle")?.toLowerCase();
    if (bundle && !YES_NO.has(bundle)) invalid(`g:is_bundle "${bundle}" must be yes or no.`);
    const unitMeasure = f("unit_pricing_measure");
    if (unitMeasure && !/^\d+(?:\.\d+)? ?(?:ml|cl|l|cbm|mg|g|kg|oz|lb|floz|pt|qt|gal|in|ft|yd|cm|m|sqft|sqm|ct)$/i.test(unitMeasure)) invalid(`g:unit_pricing_measure "${unitMeasure}" must look like "5000 ml".`);

    facts.push({
      position: item.position,
      id,
      link: linkUrl?.href ?? null,
      productUrl: linkUrl ? withoutQuery(linkUrl.href) : null,
      itemGroupId: f("item_group_id") ?? null,
      price,
      salePrice,
      saleWindow,
      availability: availability ?? null,
      images,
    });
  }

  for (const [id, positions] of ids) if (positions.length > 1) at("feed-duplicate-id", `g:id ${id} is used by items #${positions.join(", #")}.`);
  if (currencies.size > 1) at("feed-item-invalid", `Prices in several currencies: ${[...currencies].join(", ")}.`);

  // Variants: items of one product page share one item_group_id; one group never spans two products.
  const byProduct = new Map<string, FeedItemFacts[]>();
  for (const item of facts) if (item.productUrl) byProduct.set(item.productUrl, [...(byProduct.get(item.productUrl) ?? []), item]);
  for (const [productUrl, items] of byProduct) {
    if (items.length < 2) continue;
    const groups = new Set(items.map((i) => i.itemGroupId));
    if (groups.has(null) || groups.size > 1) at("feed-item-group", `${items.length} items link to ${productUrl} but their g:item_group_id values are ${[...groups].map((g) => g ?? "(missing)").join(", ")}.`);
  }
  const byGroup = new Map<string, Set<string>>();
  for (const item of facts) if (item.itemGroupId && item.productUrl) byGroup.set(item.itemGroupId, (byGroup.get(item.itemGroupId) ?? new Set()).add(item.productUrl));
  for (const [group, products] of byGroup) if (products.size > 1) at("feed-item-group", `g:item_group_id ${group} spans ${products.size} product pages: ${[...products].join(", ")}.`);

  return { issues, items: facts };
}

/** The price a shopper pays now: the sale price inside its window (or without one), else the price. */
export function effectivePrice(item: FeedItemFacts, now: Date): { value: number; currency: string } | null {
  if (item.salePrice && (!item.saleWindow || (item.saleWindow.start <= now.getTime() && now.getTime() <= item.saleWindow.end))) return item.salePrice;
  return item.price;
}

/** Merchant Center availability ↔ schema.org ItemAvailability. */
export function sameAvailability(feed: string, schema: string): boolean {
  const map: Record<string, string[]> = {
    in_stock: ["InStock", "LimitedAvailability", "OnlineOnly", "InStoreOnly"],
    out_of_stock: ["OutOfStock", "SoldOut", "Discontinued"],
    preorder: ["PreOrder", "PreSale"],
    backorder: ["BackOrder"],
  };
  return (map[feed] ?? []).includes(schema);
}
