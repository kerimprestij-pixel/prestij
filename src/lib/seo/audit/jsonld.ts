// JSON-LD rules of the SEO audit. Pure. Required/recommended fields follow Google Search Central
// (checked 2026-11-10): merchant listings (Product: name, image, offers as Offer; Offer: price > 0 and
// priceCurrency; OfferShippingDetails; MerchantReturnPolicy), product variants (ProductGroup: name, a
// unique group id, hasVariant/variesBy recommended; each variant a full Product with a unique id),
// breadcrumbs (ListItem item/name/position; item optional on the last), Organization (no required
// fields), Article/BlogPosting (no required fields; author Person/Organization with a name, ISO 8601
// dates with a zone), FAQPage (Question name + acceptedAnswer.text; one FAQPage per page). WebSite
// needs name + url (site names); CollectionPage/ItemList follow the ItemList (carousel) rules.
// Day 6: VideoObject (checked 2026-11-12): name, thumbnailUrl and uploadDate (ISO 8601) required;
// description, contentUrl or embedUrl (contentUrl is the file, never the page) and duration (ISO 8601)
// recommended; a page may describe several videos, so distinct VideoObjects are not a duplicated type
// (the same video twice is).
//
// Where the contract (docs/DAY5-SEO.md §5.1) deliberately leaves something out, the audit only warns:
// OfferShippingDetails.deliveryTime (omitted until a setting exists).
import { issue, type Issue, type RuleCode } from "./types";
import { isAbsoluteHttpUrl, isForeignLocalUrl, isSameOrigin, primaryLanguage } from "./url";
import { charLength, hasTimeZone, isCountryCode, isCurrencyCode, isIsoDate, isValidGtin, toPlainNumber } from "./values";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Node = { [key: string]: Json };

export type JsonLdContext = {
  /** The page URL (on the audited origin). */
  pageUrl: string;
  /** The page's canonical (absolute) or null. */
  canonical: string | null;
  /** The audited origin. */
  origin: string;
  /** Primary language of the page (<html lang>), e.g. "tr". */
  pageLang: string | null;
  now: Date;
};

export type JsonLdOffer = { sku: string | null; price: number | null; currency: string | null; availability: string | null; url: string | null };

export type JsonLdFacts = {
  /** Every @type found (top level and nested), in document order, without duplicates. */
  types: string[];
  /** Offers of Product / ProductGroup variants (for the feed comparison). */
  offers: JsonLdOffer[];
  /** Same-origin page URLs the markup points to (crawled to prove they work). */
  pageUrls: string[];
  /** Image URLs (Product/BlogPosting image, logo) to check as assets. */
  images: string[];
  /** Product groups: productGroupID (else the variants' inProductGroupWithID) and the variants' SKUs. */
  groups: { id: string; skus: string[] }[];
};

const SCHEMA_CONTEXT_RE = /^https?:\/\/schema\.org\/?$/;
const ORGANIZATION_TYPES = new Set([
  "Organization",
  "OnlineStore",
  "OnlineBusiness",
  "Corporation",
  "LocalBusiness",
  "Store",
  "HealthAndBeautyBusiness",
  "NGO",
]);
const ARTICLE_TYPES = new Set(["Article", "BlogPosting", "NewsArticle", "TechArticle", "Report"]);
const AVAILABILITY = new Set([
  "BackOrder",
  "Discontinued",
  "InStock",
  "InStoreOnly",
  "LimitedAvailability",
  "OnlineOnly",
  "OutOfStock",
  "PreOrder",
  "PreSale",
  "SoldOut",
]);
const CONDITION = new Set(["NewCondition", "RefurbishedCondition", "UsedCondition", "DamagedCondition"]);
const RETURN_CATEGORY = new Set(["MerchantReturnFiniteReturnWindow", "MerchantReturnNotPermitted", "MerchantReturnUnlimitedWindow"]);
const RETURN_FEES = new Set(["FreeReturn", "ReturnFeesCustomerResponsibility", "ReturnShippingFees"]);
const RETURN_METHOD = new Set(["ReturnAtKiosk", "ReturnByMail", "ReturnInStore"]);
const VARIES_BY = new Set(["size", "color", "material", "pattern", "suggestedAge", "suggestedGender"]);
const GTIN_FIELDS: [string, (8 | 12 | 13 | 14) | undefined][] = [
  ["gtin", undefined],
  ["gtin8", 8],
  ["gtin12", 12],
  ["gtin13", 13],
  ["gtin14", 14],
];

/** ISO 8601 duration, e.g. "PT1M33S", "PT42S", "P1DT2H" (at least one component). */
const ISO_DURATION_RE = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;
export const isIsoDuration = (value: unknown): value is string => typeof value === "string" && ISO_DURATION_RE.test(value.trim());

const isObject = (value: Json | undefined): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);
const asArray = (value: Json | undefined): Json[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const str = (value: Json | undefined): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
/** "https://schema.org/InStock" / "schema:InStock" / "InStock" → "InStock". */
const enumName = (value: Json | undefined): string | null => {
  const s = str(value);
  return s ? s.replace(/^(?:https?:\/\/schema\.org\/|schema:)/, "") : null;
};

function typesOf(node: Node): string[] {
  return asArray(node["@type"])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^(?:https?:\/\/schema\.org\/|schema:)/, ""));
}

/** `{ "@id": "…" }` and nothing else: a pointer to a node described elsewhere. */
type RefNode = { "@id": string };
const isRefOnly = (value: Json | undefined): value is RefNode => isObject(value) && Object.keys(value).length === 1 && typeof value["@id"] === "string";

function nameOf(node: Node): string | null {
  return str(node.name) ?? str(node.headline);
}

class Checker {
  readonly issues: Issue[] = [];
  readonly facts: JsonLdFacts = { types: [], offers: [], pageUrls: [], images: [], groups: [] };
  readonly byId = new Map<string, Node>();
  private faqPages = 0;
  private readonly topLevelTypes = new Map<string, number>();
  /** Top-level VideoObjects by the video they describe (contentUrl, else embedUrl, @id or name). */
  private readonly topLevelVideos = new Map<string, number>();

  constructor(readonly ctx: JsonLdContext) {}

  emit(code: RuleCode, path: string, message: string) {
    this.issues.push(issue(code, `${path}: ${message}`, this.ctx.pageUrl));
  }

  /** A referenced node ({ "@id" } only) resolved from this page, the value itself otherwise. */
  resolve(value: Json | undefined): Json | undefined {
    if (isRefOnly(value)) return this.byId.get(value["@id"] as string) ?? value;
    return value;
  }

  index(value: Json) {
    if (Array.isArray(value)) value.forEach((v) => this.index(v));
    else if (isObject(value)) {
      if (typeof value["@id"] === "string" && Object.keys(value).length > 1 && !this.byId.has(value["@id"])) this.byId.set(value["@id"], value);
      Object.values(value).forEach((v) => this.index(v));
    }
  }

  /** URLs anywhere in the markup on a local host other than the audited origin: one issue per origin. */
  scanForeign(value: Json, label: string) {
    const found = new Map<string, { count: number; example: string }>();
    const walk = (v: Json) => {
      if (typeof v === "string") {
        if (!isForeignLocalUrl(v, this.ctx.origin)) return;
        const origin = new URL(v.trim()).origin;
        const entry = found.get(origin);
        if (entry) entry.count += 1;
        else found.set(origin, { count: 1, example: v.trim() });
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (isObject(v)) Object.values(v).forEach(walk);
    };
    walk(value);
    for (const [origin, { count, example }] of found) {
      this.emit("foreign-origin-url", label, `${count} URL(s) on ${origin}, e.g. ${example}.`);
    }
  }

  noteType(type: string) {
    if (!this.facts.types.includes(type)) this.facts.types.push(type);
  }

  pageUrl(url: string) {
    if (isSameOrigin(url, this.ctx.origin) && !this.facts.pageUrls.includes(url)) this.facts.pageUrls.push(url);
  }

  /** An absolute URL property; returns the URL or null (and reports a relative/invalid one). */
  url(node: Node, key: string, path: string, required: boolean): string | null {
    const value = node[key];
    if (value === undefined || value === null) {
      if (required) this.emit("jsonld-required", path, `"${key}" is missing.`);
      return null;
    }
    const s = typeof value === "string" ? value.trim() : isObject(value) ? str(value["@id"]) ?? str(value.url) : null;
    if (!s || !isAbsoluteHttpUrl(s)) {
      this.emit("jsonld-invalid-value", path, `"${key}" must be an absolute URL (got ${JSON.stringify(value).slice(0, 80)}).`);
      return null;
    }
    return s;
  }

  /** image: URL, ImageObject or a list of them. Returns the absolute URLs. */
  images(node: Node, key: string, path: string, required: boolean, recommended = false): string[] {
    const values = asArray(node[key]);
    if (values.length === 0) {
      if (required) this.emit("jsonld-required", path, `"${key}" is missing.`);
      else if (recommended) this.emit("jsonld-recommended", path, `"${key}" is recommended.`);
      return [];
    }
    const urls: string[] = [];
    values.forEach((v, i) => {
      const value = this.resolve(v);
      const s = typeof value === "string" ? value.trim() : isObject(value) ? str(value.url) ?? str(value.contentUrl) : null;
      if (!s || !isAbsoluteHttpUrl(s)) this.emit("jsonld-invalid-value", `${path}.${key}[${i}]`, `must be an absolute image URL (got ${JSON.stringify(v).slice(0, 80)}).`);
      else urls.push(s);
    });
    for (const u of urls) if (!this.facts.images.includes(u)) this.facts.images.push(u);
    return urls;
  }

  requireText(node: Node, key: string, path: string): string | null {
    const value = str(node[key]);
    if (!value) this.emit("jsonld-required", path, `"${key}" is missing or empty.`);
    return value;
  }

  sameAsPage(value: string | null, path: string, what: string) {
    if (!value || !this.ctx.canonical) return;
    if (value !== this.ctx.canonical) this.emit("jsonld-mismatch", path, `${what} ${value} differs from the canonical ${this.ctx.canonical}.`);
  }

  /** inLanguage (one tag or a list, e.g. a WebSite in several languages) must include the page's language. */
  language(node: Node, path: string) {
    const langs = asArray(node.inLanguage).map((l) => str(l)).filter((l): l is string => Boolean(l));
    if (langs.length && this.ctx.pageLang && !langs.some((l) => primaryLanguage(l) === this.ctx.pageLang)) {
      this.emit("jsonld-mismatch", path, `inLanguage "${langs.join(", ")}" but the page is "${this.ctx.pageLang}".`);
    }
  }

  // -------------------------------------------------------------------------------------------------

  check(blocks: readonly string[]) {
    const docs: { value: Json; label: string }[] = [];
    blocks.forEach((raw, i) => {
      const label = `JSON-LD #${i + 1}`;
      let value: Json;
      try {
        value = JSON.parse(raw.trim()) as Json;
      } catch (error) {
        this.emit("jsonld-parse", label, error instanceof Error ? error.message : String(error));
        return;
      }
      docs.push({ value, label });
      this.index(value);
    });

    for (const { value, label } of docs) {
      this.scanForeign(value, label);
      const roots = asArray(value);
      roots.forEach((root, i) => {
        const rootLabel = roots.length > 1 ? `${label}[${i}]` : label;
        if (!isObject(root)) {
          this.emit("jsonld-no-type", rootLabel, "top level is not an object.");
          return;
        }
        if (!this.contextOk(root["@context"])) this.emit("jsonld-context", rootLabel, `@context is ${JSON.stringify(root["@context"] ?? null)}, expected "https://schema.org".`);
        const graph = root["@graph"];
        if (Array.isArray(graph)) {
          graph.forEach((node, j) => {
            if (isObject(node)) this.node(node, `${rootLabel}.@graph[${j}]`, "root");
          });
        } else this.node(root, rootLabel, "root");
      });
    }

    if (this.faqPages > 1) this.emit("jsonld-faq-multiple", "page", `${this.faqPages} FAQPage blocks (Google uses one per page; merge them).`);
    for (const [type, count] of this.topLevelTypes) {
      // Several videos are several entities (Google: one VideoObject per video); checked per video below.
      if (count > 1 && type !== "FAQPage" && type !== "VideoObject") this.emit("jsonld-duplicate-type", "page", `${count} top-level ${type} blocks.`);
    }
    for (const [video, count] of this.topLevelVideos) {
      if (count > 1) this.emit("jsonld-duplicate-type", "page", `${count} top-level VideoObject blocks describe the same video (${video}).`);
    }
  }

  contextOk(context: Json | undefined): boolean {
    return asArray(context).some((c) => (typeof c === "string" && SCHEMA_CONTEXT_RE.test(c)) || (isObject(c) && typeof c["@vocab"] === "string" && SCHEMA_CONTEXT_RE.test(c["@vocab"])));
  }

  /** Dispatch by @type. `role` says where the node sits (root, variant, nested). */
  node(node: Node, path: string, role: "root" | "variant" | "nested") {
    const types = typesOf(node);
    if (types.length === 0) {
      if (role === "root") this.emit("jsonld-no-type", path, "node without @type.");
      return;
    }
    types.forEach((t) => this.noteType(t));
    const label = `${path} (${types.join(", ")}${nameOf(node) ? ` "${nameOf(node)}"` : ""})`;
    if (role === "root") {
      const main = types[0];
      this.topLevelTypes.set(main, (this.topLevelTypes.get(main) ?? 0) + 1);
      if (main === "VideoObject") {
        const video = str(node.contentUrl) ?? str(node.embedUrl) ?? str(node["@id"]) ?? nameOf(node) ?? "?";
        this.topLevelVideos.set(video, (this.topLevelVideos.get(video) ?? 0) + 1);
      }
    }

    const has = (t: string) => types.includes(t);
    if (has("ProductGroup")) this.productGroup(node, label);
    else if (has("Product")) this.product(node, label, role);
    if (has("BreadcrumbList")) this.breadcrumbList(node, label);
    if (types.some((t) => ORGANIZATION_TYPES.has(t))) this.organization(node, label, role);
    if (has("WebSite")) this.webSite(node, label);
    if (has("CollectionPage")) this.collectionPage(node, label);
    if (has("ItemList")) this.itemList(node, label);
    if (types.some((t) => ARTICLE_TYPES.has(t))) this.article(node, label);
    if (has("FAQPage")) this.faqPage(node, label);
    if (has("VideoObject")) this.videoObject(node, label);
    this.language(node, label);

    // Nested nodes not handled by a parent rule above (e.g. a CollectionPage's mainEntity ItemList).
    for (const key of ["mainEntity", "about", "isPartOf", "hasPart"]) {
      for (const child of asArray(node[key])) {
        if (isObject(child) && !isRefOnly(child) && !has("FAQPage")) this.node(child, `${label}.${key}`, "nested");
      }
    }
  }

  // ------------------------------------------------------------------------------------------- Product

  product(node: Node, path: string, role: "root" | "variant" | "nested") {
    const full = role !== "nested";
    this.requireText(node, "name", path);
    this.images(node, "image", path, full);
    const url = this.url(node, "url", path, false);
    if (url) this.pageUrl(url);
    if (role === "root") this.sameAsPage(url, path, "url");
    // Variants without a description are reported once per group (productGroup), not once each.
    if (role === "root" && !str(node.description)) this.emit("jsonld-recommended", path, '"description" is recommended.');

    // Variants inherit the group's brand (Google's product-variant example puts it on the ProductGroup only).
    const brand = this.resolve(node.brand);
    if (role === "root" && (brand === undefined || (isObject(brand) && !str(brand.name) && !isRefOnly(brand)))) this.emit("jsonld-recommended", path, '"brand" with a name is recommended.');

    let hasGtin = false;
    for (const [key, length] of GTIN_FIELDS) {
      const value = node[key];
      if (value === undefined) continue;
      hasGtin = true;
      const s = typeof value === "number" ? String(value) : str(value);
      if (!s || !isValidGtin(s, length)) this.emit("jsonld-invalid-value", path, `"${key}" ${JSON.stringify(value)} is not a valid ${key.toUpperCase()} (digits and check digit).`);
    }
    const sku = str(node.sku);
    if (node.sku !== undefined && (!sku || /\s/.test(sku))) this.emit("jsonld-invalid-value", path, `"sku" ${JSON.stringify(node.sku)} must be one value without whitespace.`);
    if (role === "variant" && !sku && !hasGtin) this.emit("jsonld-required", path, 'a variant needs a unique id ("sku" or a GTIN).');
    else if (role === "root" && !sku && !hasGtin && node.mpn === undefined) this.emit("jsonld-recommended", path, '"sku" or a GTIN is recommended.');

    if (full) {
      const offers = asArray(node.offers).map((o) => this.resolve(o));
      if (offers.length === 0) this.emit("jsonld-required", path, '"offers" is missing (merchant listings need an Offer).');
      offers.forEach((offer, i) => {
        const offerPath = `${path}.offers${offers.length > 1 ? `[${i}]` : ""}`;
        if (!isObject(offer) || isRefOnly(offer)) return;
        const offerTypes = typesOf(offer);
        if (offerTypes.includes("AggregateOffer")) this.emit("jsonld-invalid-value", offerPath, "AggregateOffer: merchant listings need an Offer (the shop is the seller).");
        else this.offer(offer, offerPath, sku);
      });
    }

    if (node.aggregateRating !== undefined) this.aggregateRating(this.resolve(node.aggregateRating), `${path}.aggregateRating`);
    asArray(node.review).forEach((review, i) => this.review(this.resolve(review), `${path}.review[${i}]`));
  }

  offer(offer: Node, path: string, productSku: string | null) {
    if (!typesOf(offer).includes("Offer")) this.emit("jsonld-invalid-value", path, `@type should be "Offer" (got ${JSON.stringify(offer["@type"] ?? null)}).`);
    const spec = asArray(offer.priceSpecification).find(isObject) ?? null;
    const rawPrice = offer.price !== undefined ? offer.price : spec?.price;
    const rawCurrency = offer.price !== undefined ? offer.priceCurrency : (spec?.priceCurrency ?? offer.priceCurrency);
    const price = toPlainNumber(rawPrice ?? undefined);
    if (rawPrice === undefined) this.emit("jsonld-required", path, '"price" is missing.');
    else if (price === null) this.emit("jsonld-invalid-value", path, `"price" ${JSON.stringify(rawPrice)} must be a plain number (no currency sign or thousands separator).`);
    else if (price <= 0) this.emit("jsonld-invalid-value", path, `"price" ${price} must be greater than zero for merchant listings.`);
    if (rawCurrency === undefined) this.emit("jsonld-required", path, '"priceCurrency" is missing.');
    else if (!isCurrencyCode(rawCurrency)) this.emit("jsonld-invalid-value", path, `"priceCurrency" ${JSON.stringify(rawCurrency)} is not an ISO 4217 code.`);

    const availability = enumName(offer.availability);
    if (offer.availability === undefined) this.emit("jsonld-recommended", path, '"availability" is recommended.');
    else if (!availability || !AVAILABILITY.has(availability)) this.emit("jsonld-invalid-value", path, `"availability" ${JSON.stringify(offer.availability)} is not a schema.org ItemAvailability value.`);
    if (offer.itemCondition !== undefined) {
      const condition = enumName(offer.itemCondition);
      if (!condition || !CONDITION.has(condition)) this.emit("jsonld-invalid-value", path, `"itemCondition" ${JSON.stringify(offer.itemCondition)} is not a schema.org OfferItemCondition value.`);
    }
    const url = this.url(offer, "url", path, false);
    if (url) this.pageUrl(url);

    if (offer.priceValidUntil !== undefined) {
      const until = str(offer.priceValidUntil);
      if (!until || !isIsoDate(until)) this.emit("jsonld-invalid-value", path, `"priceValidUntil" ${JSON.stringify(offer.priceValidUntil)} is not an ISO 8601 date.`);
      else if (Date.parse(until) < this.ctx.now.getTime()) this.emit("jsonld-invalid-value", path, `"priceValidUntil" ${until} is in the past (Google may drop the listing).`);
    }

    const currency = isCurrencyCode(rawCurrency) ? rawCurrency : null;
    asArray(offer.shippingDetails).forEach((d, i) => {
      const details = this.resolve(d);
      if (isObject(details) && !isRefOnly(details)) this.shippingDetails(details, `${path}.shippingDetails${asArray(offer.shippingDetails).length > 1 ? `[${i}]` : ""}`, currency);
    });
    asArray(offer.hasMerchantReturnPolicy).forEach((p, i) => {
      const policy = this.resolve(p);
      if (isObject(policy) && !isRefOnly(policy)) this.returnPolicy(policy, `${path}.hasMerchantReturnPolicy${i > 0 ? `[${i}]` : ""}`);
    });

    this.facts.offers.push({ sku: str(offer.sku) ?? productSku, price, currency, availability: availability && AVAILABILITY.has(availability) ? availability : null, url });
  }

  shippingDetails(details: Node, path: string, offerCurrency: string | null) {
    const destination = this.resolve(details.shippingDestination);
    const destinations = asArray(destination);
    if (destinations.length === 0) this.emit("jsonld-required", path, '"shippingDestination" (DefinedRegion with addressCountry) is missing.');
    destinations.forEach((d) => {
      if (isObject(d) && !asArray(d.addressCountry).every(isCountryCode)) this.emit("jsonld-invalid-value", path, `"shippingDestination.addressCountry" ${JSON.stringify(d.addressCountry ?? null)} must be ISO 3166-1 alpha-2 (e.g. "TR").`);
      if (isObject(d) && d.addressCountry === undefined) this.emit("jsonld-required", path, '"shippingDestination.addressCountry" is missing.');
    });
    const rates = asArray(this.resolve(details.shippingRate));
    if (rates.length === 0) this.emit("jsonld-required", path, '"shippingRate" (MonetaryAmount) is missing.');
    if (rates.length > 1) this.emit("jsonld-invalid-value", path, "one shippingRate per OfferShippingDetails.");
    rates.forEach((rate) => {
      if (!isObject(rate)) return;
      const value = rate.value !== undefined ? rate.value : rate.maxValue;
      const amount = toPlainNumber(value ?? undefined);
      if (value === undefined) this.emit("jsonld-required", path, '"shippingRate.value" is missing (0 for free shipping).');
      else if (amount === null || amount < 0) this.emit("jsonld-invalid-value", path, `"shippingRate.value" ${JSON.stringify(value)} must be a non-negative plain number.`);
      if (!isCurrencyCode(rate.currency)) this.emit(rate.currency === undefined ? "jsonld-required" : "jsonld-invalid-value", path, `"shippingRate.currency" ${JSON.stringify(rate.currency ?? null)} must be an ISO 4217 code.`);
      else if (offerCurrency && rate.currency !== offerCurrency) this.emit("jsonld-invalid-value", path, `"shippingRate.currency" ${rate.currency} differs from the offer's ${offerCurrency}.`);
    });
    const delivery = this.resolve(details.deliveryTime);
    if (delivery === undefined) this.emit("jsonld-recommended", path, '"deliveryTime" (handlingTime + transitTime) is needed for Google\'s shipping-details enhancement.');
    else if (isObject(delivery)) {
      for (const key of ["handlingTime", "transitTime"]) {
        const span = delivery[key];
        if (span === undefined) continue;
        if (!isObject(span)) continue;
        const min = span.minValue;
        const max = span.maxValue;
        const unit = str(span.unitCode);
        if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 0 || (max as number) < (min as number) || (unit !== "DAY" && unit !== "d")) {
          this.emit("jsonld-invalid-value", path, `"deliveryTime.${key}" needs whole-number minValue ≤ maxValue and unitCode "DAY".`);
        }
      }
    }
  }

  returnPolicy(policy: Node, path: string) {
    const countries = asArray(policy.applicableCountry);
    if (countries.length === 0) this.emit("jsonld-required", path, '"applicableCountry" is missing.');
    else if (!countries.every(isCountryCode)) this.emit("jsonld-invalid-value", path, `"applicableCountry" ${JSON.stringify(policy.applicableCountry)} must be ISO 3166-1 alpha-2.`);
    const category = enumName(policy.returnPolicyCategory);
    if (policy.returnPolicyCategory === undefined) this.emit("jsonld-required", path, '"returnPolicyCategory" is missing.');
    else if (!category || !RETURN_CATEGORY.has(category)) this.emit("jsonld-invalid-value", path, `"returnPolicyCategory" ${JSON.stringify(policy.returnPolicyCategory)} is not a valid value.`);
    if (category === "MerchantReturnFiniteReturnWindow") {
      const days = policy.merchantReturnDays;
      if (days === undefined) this.emit("jsonld-required", path, '"merchantReturnDays" is required for a finite return window.');
      else if (!(Number.isInteger(days) && (days as number) >= 0) && !isIsoDate(days)) this.emit("jsonld-invalid-value", path, `"merchantReturnDays" ${JSON.stringify(days)} must be a whole number of days.`);
    }
    if (policy.returnFees !== undefined) {
      const fees = enumName(policy.returnFees);
      if (!fees || !RETURN_FEES.has(fees)) this.emit("jsonld-invalid-value", path, `"returnFees" ${JSON.stringify(policy.returnFees)} is not a valid value.`);
      if (fees === "ReturnShippingFees" && policy.returnShippingFeesAmount === undefined) this.emit("jsonld-required", path, '"returnShippingFeesAmount" is required with ReturnShippingFees.');
      if ((fees === "FreeReturn" || fees === "ReturnFeesCustomerResponsibility") && policy.returnShippingFeesAmount !== undefined) {
        this.emit("jsonld-invalid-value", path, `"returnShippingFeesAmount" must not be set with ${fees}.`);
      }
    }
    for (const method of asArray(policy.returnMethod)) {
      const m = enumName(method);
      if (!m || !RETURN_METHOD.has(m)) this.emit("jsonld-invalid-value", path, `"returnMethod" ${JSON.stringify(method)} is not a valid value.`);
    }
    if (policy.merchantReturnLink !== undefined) this.url(policy, "merchantReturnLink", path, false);
  }

  aggregateRating(value: Json | undefined, path: string) {
    if (!isObject(value)) return;
    const rating = toPlainNumber(value.ratingValue ?? undefined);
    const best = toPlainNumber(value.bestRating ?? undefined) ?? 5;
    const worst = toPlainNumber(value.worstRating ?? undefined) ?? 1;
    if (rating === null) this.emit(value.ratingValue === undefined ? "jsonld-required" : "jsonld-invalid-value", path, `"ratingValue" ${JSON.stringify(value.ratingValue ?? null)} must be a number.`);
    else if (rating < worst || rating > best) this.emit("jsonld-invalid-value", path, `"ratingValue" ${rating} is outside ${worst}–${best}.`);
    const count = toPlainNumber(value.ratingCount ?? undefined) ?? toPlainNumber(value.reviewCount ?? undefined);
    if (count === null) this.emit("jsonld-required", path, '"ratingCount" or "reviewCount" is missing.');
    else if (count <= 0) this.emit("jsonld-invalid-value", path, `rating count ${count} must be greater than zero.`);
  }

  review(value: Json | undefined, path: string) {
    if (!isObject(value) || isRefOnly(value)) return;
    const author = this.resolve(asArray(value.author)[0]);
    if (!isObject(author) || !str(author.name)) this.emit("jsonld-required", path, '"author" with a name is missing.');
    const rating = this.resolve(value.reviewRating);
    if (!isObject(rating) || toPlainNumber(rating.ratingValue ?? undefined) === null) this.emit("jsonld-required", path, '"reviewRating.ratingValue" is missing.');
  }

  productGroup(node: Node, path: string) {
    this.requireText(node, "name", path);
    const url = this.url(node, "url", path, false);
    if (url) {
      this.pageUrl(url);
      this.sameAsPage(url, path, "url");
    }
    if (!str(node.description)) this.emit("jsonld-recommended", path, '"description" is recommended.');
    const variesBy = asArray(node.variesBy);
    if (variesBy.length === 0) this.emit("jsonld-recommended", path, '"variesBy" is recommended (e.g. "https://schema.org/size").');
    for (const v of variesBy) {
      const name = enumName(v);
      if (!name || !VARIES_BY.has(name)) this.emit("jsonld-invalid-value", path, `"variesBy" ${JSON.stringify(v)} is not one of ${[...VARIES_BY].join(", ")}.`);
    }
    const variesBySize = variesBy.some((v) => enumName(v) === "size");

    const groupId = str(node.productGroupID);
    const variants = asArray(node.hasVariant).map((v) => this.resolve(v));
    if (variants.length === 0) this.emit("jsonld-recommended", path, '"hasVariant" is recommended.');
    const variantGroupIds = new Set(variants.filter(isObject).map((v) => str(v.inProductGroupWithID)).filter((v): v is string => v !== null));
    if (!groupId && variantGroupIds.size === 0) this.emit("jsonld-required", path, 'a unique group id is required ("productGroupID", or "inProductGroupWithID" on the variants).');
    if (groupId && [...variantGroupIds].some((id) => id !== groupId)) this.emit("jsonld-invalid-value", path, `variants' inProductGroupWithID differs from productGroupID "${groupId}".`);

    const urls = new Map<string, number>();
    const names = new Map<string, number>();
    const skus: string[] = [];
    let withoutDescription = 0;
    let productVariants = 0;
    const groupName = str(node.name);
    variants.forEach((variant, i) => {
      const vPath = `${path}.hasVariant[${i}]`;
      if (typeof variant === "string") {
        if (!isAbsoluteHttpUrl(variant)) this.emit("jsonld-invalid-value", vPath, "a variant reference must be an absolute URL.");
        return;
      }
      if (!isObject(variant) || isRefOnly(variant)) return;
      if (!typesOf(variant).includes("Product")) {
        if (Object.keys(variant).some((k) => k !== "url" && k !== "@type")) this.emit("jsonld-invalid-value", vPath, 'a variant must be a "Product".');
        return;
      }
      this.noteType("Product");
      this.product(variant, `${vPath} (Product${str(variant.name) ? ` "${str(variant.name)}"` : ""})`, "variant");
      productVariants += 1;
      if (!str(variant.description)) withoutDescription += 1;
      const vSku = str(variant.sku);
      if (vSku) skus.push(vSku);
      const vUrl = str(variant.url);
      if (vUrl) {
        urls.set(vUrl, (urls.get(vUrl) ?? 0) + 1);
        if (url && !vUrl.startsWith(url)) this.emit("jsonld-mismatch", vPath, `variant url ${vUrl} is not the group url plus a variant parameter.`);
        const offerUrls = asArray(variant.offers).map((o) => (isObject(o) ? str(o.url) : null)).filter((u): u is string => u !== null);
        if (offerUrls.some((u) => u !== vUrl)) this.emit("jsonld-mismatch", vPath, "the offer url differs from the variant url.");
      } else if (url) this.emit("jsonld-recommended", vPath, '"url" (the page with this variant preselected) is recommended.');
      const vName = str(variant.name);
      if (vName) {
        names.set(vName, (names.get(vName) ?? 0) + 1);
        if (groupName && vName === groupName) this.emit("jsonld-recommended", vPath, "the variant name should be more specific than the group name (include the size).");
      }
      if (variesBySize && variant.size === undefined) this.emit("jsonld-recommended", vPath, '"size" is recommended (the group varies by size).');
    });
    for (const [u, count] of urls) if (count > 1) this.emit("jsonld-invalid-value", path, `${count} variants share the url ${u} (each needs its own).`);
    for (const [n, count] of names) if (count > 1) this.emit("jsonld-recommended", path, `${count} variants share the name "${n}".`);
    if (withoutDescription > 0) {
      this.emit("jsonld-recommended", path, `${withoutDescription} of ${productVariants} variants have no "description" (recommended; Google suggests a variant-specific one, e.g. with the size).`);
    }
    const effectiveGroupId = groupId ?? [...variantGroupIds][0];
    if (effectiveGroupId) this.facts.groups.push({ id: effectiveGroupId, skus });

    if (node.aggregateRating !== undefined) this.aggregateRating(this.resolve(node.aggregateRating), `${path}.aggregateRating`);
    asArray(node.review).forEach((review, i) => this.review(this.resolve(review), `${path}.review[${i}]`));
  }

  // ----------------------------------------------------------------------------------------- Listings

  breadcrumbList(node: Node, path: string) {
    const items = asArray(node.itemListElement);
    if (items.length === 0) {
      this.emit("jsonld-required", path, '"itemListElement" is missing or empty.');
      return;
    }
    if (items.length < 2) this.emit("jsonld-recommended", path, "a breadcrumb trail should have at least two items.");
    items.forEach((raw, i) => {
      const item = this.resolve(raw);
      const iPath = `${path}.itemListElement[${i}]`;
      if (!isObject(item)) {
        this.emit("jsonld-invalid-value", iPath, "must be a ListItem.");
        return;
      }
      if (item.position !== i + 1) this.emit("jsonld-invalid-value", iPath, `"position" ${JSON.stringify(item.position ?? null)} should be ${i + 1} (1, 2, 3… in order).`);
      const last = i === items.length - 1;
      const target = item.item;
      const targetNode = isObject(target) ? target : null;
      if (!str(item.name) && !(targetNode && str(targetNode.name))) this.emit("jsonld-required", iPath, '"name" is missing.');
      if (target === undefined || target === null) {
        if (!last) this.emit("jsonld-required", iPath, '"item" (URL) is missing (only the last crumb may omit it).');
        return;
      }
      const href = typeof target === "string" ? target.trim() : targetNode ? (str(targetNode["@id"]) ?? str(targetNode.url)) : null;
      if (!href || !isAbsoluteHttpUrl(href)) {
        this.emit("jsonld-invalid-value", iPath, `"item" must be an absolute URL (got ${JSON.stringify(target).slice(0, 80)}).`);
        return;
      }
      this.pageUrl(href);
      if (last && this.ctx.canonical && href !== this.ctx.canonical) this.emit("jsonld-mismatch", iPath, `the last crumb ${href} is not this page (${this.ctx.canonical}).`);
    });
  }

  itemList(node: Node, path: string) {
    const items = asArray(node.itemListElement);
    if (node.itemListElement === undefined) this.emit("jsonld-required", path, '"itemListElement" is missing.');
    if (node.numberOfItems !== undefined && node.numberOfItems !== items.length) {
      this.emit("jsonld-invalid-value", path, `"numberOfItems" ${JSON.stringify(node.numberOfItems)} but ${items.length} items are listed.`);
    }
    items.forEach((raw, i) => {
      const item = this.resolve(raw);
      const iPath = `${path}.itemListElement[${i}]`;
      if (!isObject(item)) {
        if (typeof item !== "string") this.emit("jsonld-invalid-value", iPath, "must be a ListItem.");
        return;
      }
      if (item.position !== i + 1) this.emit("jsonld-invalid-value", iPath, `"position" ${JSON.stringify(item.position ?? null)} should be ${i + 1}.`);
      const target = item.item;
      const href = str(item.url) ?? (typeof target === "string" ? target.trim() : isObject(target) ? (str(target.url) ?? str(target["@id"])) : null);
      if (!href) this.emit("jsonld-required", iPath, '"url" is missing.');
      else if (!isAbsoluteHttpUrl(href)) this.emit("jsonld-invalid-value", iPath, `"url" ${href} must be absolute.`);
      else this.pageUrl(href);
      if (isObject(target) && typesOf(target).length > 0) this.node(target, `${iPath}.item`, "nested");
    });
  }

  collectionPage(node: Node, path: string) {
    this.requireText(node, "name", path);
    const url = this.url(node, "url", path, true);
    if (url) this.sameAsPage(url, path, "url");
  }

  // ------------------------------------------------------------------------------------ Organization

  organization(node: Node, path: string, role: "root" | "variant" | "nested") {
    this.requireText(node, "name", path);
    const url = this.url(node, "url", path, false);
    if (url) this.pageUrl(url);
    else if (role === "root" && node.url === undefined) this.emit("jsonld-recommended", path, '"url" is recommended.');
    if (node.logo !== undefined) this.images(node, "logo", path, false);
    asArray(node.sameAs).forEach((s, i) => {
      if (!isAbsoluteHttpUrl(s)) this.emit("jsonld-invalid-value", `${path}.sameAs[${i}]`, `must be an absolute URL (got ${JSON.stringify(s)}).`);
    });
    const telephone = str(node.telephone);
    if (telephone && !/^\+\d[\d\s-]{6,}$/.test(telephone)) this.emit("jsonld-format", path, `"telephone" ${telephone} should be international (+90…).`);
    for (const address of asArray(this.resolve(node.address))) {
      if (isObject(address) && address.addressCountry !== undefined && !isCountryCode(address.addressCountry)) {
        this.emit("jsonld-format", path, `"address.addressCountry" ${JSON.stringify(address.addressCountry)} should be ISO 3166-1 alpha-2 ("TR").`);
      }
    }
    asArray(node.contactPoint).forEach((c, i) => {
      const point = this.resolve(c);
      if (isObject(point) && !str(point.telephone) && !str(point.email)) this.emit("jsonld-recommended", `${path}.contactPoint[${i}]`, "needs a telephone or an email.");
    });
    asArray(node.hasMerchantReturnPolicy).forEach((p, i) => {
      const policy = this.resolve(p);
      if (isObject(policy) && !isRefOnly(policy)) this.returnPolicy(policy, `${path}.hasMerchantReturnPolicy${i > 0 ? `[${i}]` : ""}`);
    });
  }

  webSite(node: Node, path: string) {
    this.requireText(node, "name", path);
    const url = this.url(node, "url", path, true);
    if (url) {
      const pathname = new URL(url).pathname.replace(/\/+$/, "");
      if (pathname.split("/").filter(Boolean).length > 1) this.emit("jsonld-mismatch", path, `url ${url} is not the site's home page.`);
    }
    for (const action of asArray(node.potentialAction)) {
      if (!isObject(action) || !typesOf(action).includes("SearchAction")) continue;
      const target = isObject(action.target) ? str(action.target.urlTemplate) : str(action.target);
      if (!target || !target.includes("{search_term_string}") || !str(action["query-input"])) {
        this.emit("jsonld-invalid-value", path, "SearchAction needs a target with {search_term_string} and query-input.");
      }
    }
  }

  // ----------------------------------------------------------------------------------------- Article

  article(node: Node, path: string) {
    const headline = this.requireText(node, "headline", path);
    if (headline && charLength(headline) > 110) this.emit("jsonld-format", path, `"headline" is ${charLength(headline)} characters (keep it short; long titles are cut).`);
    const published = str(node.datePublished);
    if (!published) this.emit("jsonld-required", path, '"datePublished" is missing.');
    else if (!isIsoDate(published)) this.emit("jsonld-invalid-value", path, `"datePublished" ${published} is not ISO 8601.`);
    else if (!hasTimeZone(published)) this.emit("jsonld-format", path, `"datePublished" ${published} has no time zone.`);
    const modified = str(node.dateModified);
    if (node.dateModified !== undefined) {
      if (!modified || !isIsoDate(modified)) this.emit("jsonld-invalid-value", path, `"dateModified" ${JSON.stringify(node.dateModified)} is not ISO 8601.`);
      else if (published && isIsoDate(published) && Date.parse(modified) < Date.parse(published)) this.emit("jsonld-format", path, `"dateModified" ${modified} is before "datePublished" ${published}.`);
    }
    const authors = asArray(node.author);
    if (authors.length === 0) this.emit("jsonld-required", path, '"author" is missing.');
    authors.forEach((a, i) => {
      const author = this.resolve(a);
      const aPath = `${path}.author${authors.length > 1 ? `[${i}]` : ""}`;
      if (isRefOnly(author)) {
        this.emit("jsonld-recommended", aPath, `references ${String(author["@id"])} which is not described on this page (Google sees an author without a name).`);
        return;
      }
      if (!isObject(author)) {
        this.emit("jsonld-invalid-value", aPath, "must be a Person or an Organization object.");
        return;
      }
      const types = typesOf(author);
      if (!types.some((t) => t === "Person" || ORGANIZATION_TYPES.has(t))) this.emit("jsonld-invalid-value", aPath, `@type ${JSON.stringify(author["@type"] ?? null)} should be Person or Organization.`);
      if (!str(author.name)) this.emit("jsonld-required", aPath, '"name" is missing.');
    });
    const publisher = this.resolve(node.publisher);
    if (isRefOnly(publisher)) this.emit("jsonld-recommended", `${path}.publisher`, `references ${String(publisher["@id"])} which is not described on this page.`);
    this.images(node, "image", path, false, true);
    const main = node.mainEntityOfPage;
    const mainUrl = typeof main === "string" ? main.trim() : isObject(main) ? (str(main["@id"]) ?? str(main.url)) : null;
    this.sameAsPage(mainUrl, path, "mainEntityOfPage");
    if (node.url !== undefined) this.sameAsPage(this.url(node, "url", path, false), path, "url");
  }

  // ------------------------------------------------------------------------------------------- Video

  videoObject(node: Node, path: string) {
    this.requireText(node, "name", path);
    if (!str(node.description)) this.emit("jsonld-recommended", path, '"description" is recommended.');
    this.images(node, "thumbnailUrl", path, true);

    const uploaded = str(node.uploadDate);
    if (!uploaded) this.emit("jsonld-required", path, '"uploadDate" is missing.');
    else if (!isIsoDate(uploaded)) this.emit("jsonld-invalid-value", path, `"uploadDate" ${uploaded} is not ISO 8601.`);
    else if (!hasTimeZone(uploaded)) this.emit("jsonld-format", path, `"uploadDate" ${uploaded} has no time zone.`);

    const content = node.contentUrl !== undefined ? this.url(node, "contentUrl", path, false) : null;
    if (node.embedUrl !== undefined) this.url(node, "embedUrl", path, false);
    if (node.contentUrl === undefined && node.embedUrl === undefined) {
      this.emit("jsonld-recommended", path, '"contentUrl" or "embedUrl" is recommended (Google fetches the video from it).');
    }
    if (content && (content === this.ctx.pageUrl || content === this.ctx.canonical)) {
      this.emit("jsonld-invalid-value", path, '"contentUrl" must be the video file itself, not the page it is on.');
    }

    if (node.duration === undefined) this.emit("jsonld-recommended", path, '"duration" is recommended.');
    else if (!isIsoDuration(node.duration)) this.emit("jsonld-invalid-value", path, `"duration" ${JSON.stringify(node.duration)} is not an ISO 8601 duration (e.g. "PT1M33S").`);

    if (node.expires !== undefined) {
      const expires = str(node.expires);
      if (!expires || !isIsoDate(expires)) this.emit("jsonld-invalid-value", path, `"expires" ${JSON.stringify(node.expires)} is not ISO 8601.`);
      else if (Date.parse(expires) < this.ctx.now.getTime()) this.emit("jsonld-invalid-value", path, `"expires" ${expires} is in the past (Google drops the video).`);
    }
  }

  faqPage(node: Node, path: string) {
    this.faqPages += 1;
    const questions = asArray(node.mainEntity);
    if (questions.length === 0) {
      this.emit("jsonld-required", path, '"mainEntity" (the questions) is missing or empty.');
      return;
    }
    questions.forEach((raw, i) => {
      const q = this.resolve(raw);
      const qPath = `${path}.mainEntity[${i}]`;
      if (!isObject(q) || !typesOf(q).includes("Question")) {
        this.emit("jsonld-invalid-value", qPath, 'must be a "Question".');
        return;
      }
      this.noteType("Question");
      if (!str(q.name)) this.emit("jsonld-required", qPath, '"name" (the question) is missing.');
      const answer = this.resolve(asArray(q.acceptedAnswer)[0]);
      if (!isObject(answer) || !str(answer.text)) this.emit("jsonld-required", qPath, '"acceptedAnswer.text" is missing.');
      else this.noteType("Answer");
    });
  }
}

/** Validates every JSON-LD block of one page; returns the issues and what the markup says. */
export function checkJsonLd(blocks: readonly string[], ctx: JsonLdContext): { issues: Issue[]; facts: JsonLdFacts } {
  const checker = new Checker(ctx);
  checker.check(blocks);
  return { issues: checker.issues, facts: checker.facts };
}
