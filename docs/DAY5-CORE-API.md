# Day 5 core API (categories body + FAQ, SEO settings, variant/feed URLs, structured data, content script)

What CORE ships for the eight day-5 builders. Read `docs/DAY5-SEO.md` (the contract) first; this file
documents the code behind its §4. **pure** = no DB, no Next request APIs: safe in client components and
unit tests. If a signature here disagrees with the code, the code wins: say so in your report.
Everything below was exercised on 2026-11-10 (see §10).

## 0. File map

| File | What | Owner after CORE |
|---|---|---|
| `drizzle/0004_day5_seo.sql` (+ `meta/0004_snapshot.json`) | the day's only migration (applied) | nobody: builders never change the schema |
| `src/db/schema/catalog.ts` | `categories.body`, `categories.faq`, type `CategoryFaqItem` | — |
| `src/lib/data/catalog.ts` | `CategoryData.body` / `.faq`, `listCategories` (cached), `queryCategories` (uncached) | — |
| `src/lib/settings/types.ts` | `seoSettings.verification` / `.returns` / `.merchantCategory`, their zod pieces, `GOOGLE_PRODUCT_CATEGORIES` | — |
| `src/lib/panel/settings/schemas.ts` | `seoSettingsInput` + the same three fields (see §3.3) | SEO-PANEL |
| `src/lib/seo/variant-url.ts` (pure) | `VARIANT_QUERY_PARAM`, `variantPath`, `variantUrl`, `parseVariantParam` | — |
| `src/lib/seo/feed-url.ts` (pure) | `MERCHANT_FEED_PATH`, `merchantFeedUrl` | — |
| `src/lib/seo/structured-data.ts` (pure) | JSON-LD types, `ORG_ID`, `WEBSITE_ID`, helpers, six builders | SEO-TECH (bodies) |
| `src/components/seo/JsonLdScript.tsx` | prints one document through `jsonLd()` | — |
| `src/components/seo/{Site,Product,Category,ProductsIndex,BlogPosting}StructuredData.tsx` | server components, placed in the pages | SEO-TECH (bodies) |
| `scripts/seed-data/content-helpers.ts` | report types, `sameJson`, `getAt`/`setAt`, `decideDefaultUpdate`, guard, runner | — |
| `scripts/content-day5.ts` | the day-5 content script: `catalogSeo`, `blogPosts` (empty) | CONTENT-CATALOG / CONTENT-BLOG (one function each) |
| `scripts/content-day4.ts` | now imports the helpers (behaviour unchanged) | — |
| `tests/unit/day5-core-{seo-urls,settings,structured-data,content-helpers}.test.ts`, `tests/db/day5-core-api.test.ts` | CORE's tests | — |

## 1. Schema: migration `0004_day5_seo.sql` (applied)

```sql
ALTER TABLE "categories" ADD COLUMN "body" jsonb;
ALTER TABLE "categories" ADD COLUMN "faq" jsonb DEFAULT '[]'::jsonb NOT NULL;
```
Additive only (the test pins the exact statements). Existing rows have `body = null`, `faq = []`.

```ts
// src/db/schema/catalog.ts
export type CategoryFaqItem = { question: LocalizedText; answer: LocalizedText };
categories.body  // jsonb $type<LocalizedText>() nullable: editorial HTML per locale
categories.faq   // jsonb $type<CategoryFaqItem[]>() not null default []
```
- **body** is HTML in the blog-body subset (write p, h2, h3, strong, em, a, ul/ol/li, blockquote, hr;
  `sanitizeHtml`'s allow-list also keeps br, b, i, u, s, h4, small, sup, sub, span, and drops the rest). Sanitize
  on save (`z.string().transform(sanitizeHtml)`, as `src/lib/panel/blog/schema.ts` does) **and** on render
  (`localizeBodyLinks(sanitizeHtml(localize(category.body, locale)), locale)`, as the blog post page does).
- **faq** answers follow the Faq section: plain text or the same sanitized subset, rendered with
  `localizedRichTextHtml(answer, locale)`. Questions are plain text. Keep `tr` filled in every item.
- A category save returns the tags `categories` and `products` (DAY3 §7), which already refresh every
  page that reads categories.

## 2. Read path (`src/lib/data/catalog.ts`)

```ts
listCategories(): Promise<CategoryData[]>      // "use cache", cacheLife("max"), tags categories/products/media (unchanged)
queryCategories(executor?: Tx): Promise<CategoryData[]>   // the uncached query behind it: DB tests only
type CategoryData = {
  id; slug; name: LocalizedText; description: LocalizedText | null;
  body: LocalizedText | null;          // NEW: sanitize before rendering
  faq: CategoryFaqItem[];              // NEW: well-formed items only (malformed jsonb items are dropped, never thrown)
  parentId; accentColor; image: MediaLike | null; seo: SeoFields | null; productCount: number;
};
```
- The category page already loads its category through `listCategories()` (`findCategory`), so
  `category.body` / `category.faq` are there with no new query:
  `const faqItems = category.faq.map((f) => ({ question: localize(f.question, locale), answer: localize(f.answer, locale) }))`.
- `CategoryChips` (a server component) receives the full list; that's fine. **Never pass `CategoryData`
  to a client component**: the bodies would be serialized into the page. Pick the fields you need.
- `getProduct(slug).category` stays `{ id, slug, name }`.

## 3. SEO settings (`src/lib/settings/types.ts`)

### 3.1 Shape and defaults
```ts
getSettings("seo")  // cached (tag settings); every new field has a default, so the stored row stays valid
{
  titleTemplate, defaultTitle, description, ogImageId,                 // unchanged
  verification: { google: "", bing: "", yandex: "" },                   // NEW: content attribute of each meta tag
  returns: { days: 14, freeReturns: null },                             // NEW: MerchantReturnPolicy + feed
  merchantCategory: "3208",                                             // NEW: Google product category
}
```
| Field | Rule | Use |
|---|---|---|
| `verification.google` | trimmed, ≤ 100, `SEO_VERIFICATION_PATTERN` `^[A-Za-z0-9_\-:.=]*$`; "" = no tag | Metadata `verification.google` |
| `verification.bing` | same | Metadata `verification.other["msvalidate.01"]` |
| `verification.yandex` | same | Metadata `verification.yandex` |
| `returns.days` | integer 0–365 (0 = no returns; Turkish distance-sales law needs ≥ 14) | `merchantReturnDays` / feed |
| `returns.freeReturns` | `true` (shop pays return shipping) / `false` (customer pays) / `null` (not stated: leave it out) | `returnFees` |
| `merchantCategory` | "" (let Google decide), a taxonomy id (`^\d{1,7}$`), or a full path with " > " (no `<`, no control chars); ≤ 250 | feed `g:google_product_category` |

A stored value that breaks a rule falls back to its default **for its top-level field only** (`parseSettings`
repairs per top-level key): one invalid code resets the whole `verification` block to its defaults (the other two
codes too), an invalid `returns.days` resets `returns`; `titleTemplate`, `merchantCategory` etc. keep their values.

### 3.2 Google product taxonomy (checked 2026-11-10)
Source: `https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt` and `.tr-TR.txt`
(header "Google_Product_Taxonomy_Version: 2021-09-21"). Ids are the same in every language.
```ts
GOOGLE_PRODUCT_CATEGORIES = {
  liquidHandSoap: "3208",        // Health & Beauty > Personal Care > Cosmetics > Bath & Body > Liquid Hand Soap
                                 // (Sağlık ve Güzellik > Kişisel Bakım > Kozmetik > Banyo ve Vücut > Sıvı El Sabunu)  ← default
  bodyWash: "2747",              // … > Bath & Body > Body Wash (… > Vücut Şampuanları): the shower gel (Okyanus duş jeli)
  bathAndBodyGiftSets: "475",    // … > Cosmetics > Bath & Body Gift Sets (… > Banyo ve Vücut Bakımı Hediye Setleri): bundles
}
```
FEED: `merchantCategory` is the store-wide default (most products are liquid hand soap). Overriding it
per product (shower gel → `bodyWash`, bundle → `bathAndBodyGiftSets`) is FEED's call; the constants are
there for that. Related ids seen in the same file: Bath & Body 474, Bar Soap 2503, Hand Sanitizers & Wipes
3691, Powdered Hand Soap 7417.

### 3.3 Exported pieces and the panel schema
```ts
SEO_VERIFICATION_PATTERN; SEO_VERIFICATION_MAX_LENGTH = 100
seoVerificationSettings   // z.object({ google, bing, yandex }) with defaults ""; Turkish messages
seoReturnSettings         // z.object({ days, freeReturns }) with defaults 14 / null; Turkish messages
merchantCategorySetting   // z.string() rule above (no default)
GOOGLE_PRODUCT_CATEGORIES
```
**Deviation (CORE edited a SEO-PANEL file, one block).** `src/lib/panel/settings/schemas.ts` has a
compile-time guard (`Fits<SettingsInput<"seo">, Settings<"seo">>`) and a unit test asserting that every
panel schema outputs a complete storefront value. Adding required (defaulted) storefront fields without
the panel fields fails typecheck and `npm test`, and a save from the SEO page would silently reset the
new fields. So CORE added the three fields to `seoSettingsInput`, reusing the schemas above (a missing
field keeps its default). The existing SEO form already sends its whole state, so the values round-trip
today. SEO-PANEL owns that block from now on: build the form fields and help texts, and refine the
messages if you like.

## 4. Variant links (`src/lib/seo/variant-url.ts`, pure)

```ts
VARIANT_QUERY_PARAM = "varyant"
variantPath(locale: Locale, slug: string, variantId: number): string
//   variantPath("en", "lavanta", 12) → "/en/products/lavanta?varyant=12"; a non-positive/non-integer id → the plain product path
variantUrl(locale, slug, variantId): string                          // absolute (siteOrigin()): feed `link`, ProductGroup hasVariant[].url
parseVariantParam(value: string | readonly string[] | null | undefined): number | null
//   digits only ("12" → 12; " 12", "1e3", "0", "-3", "12abc" → null); the first value of an array
```
STORE-UI (client island, page stays static, canonical stays clean):
```ts
const id = parseVariantParam(new URLSearchParams(window.location.search).get(VARIANT_QUERY_PARAM));
if (id != null && variants.some((v) => v.id === id)) select(id);
// on change: history.replaceState(null, "", variantPath(locale, slug, next.id));
```
Read `window.location` in an effect (not `useSearchParams`, which needs a Suspense boundary and would
make the static page bail out to client rendering for that subtree).

## 5. Merchant feed URL (`src/lib/seo/feed-url.ts`, pure)

```ts
MERCHANT_FEED_PATH = "/feeds/google-merchant.xml"
merchantFeedUrl(origin = siteOrigin()): string   // "https://prestij.com.tr/feeds/google-merchant.xml" (trailing slash on origin ignored)
```
`src/proxy.ts`'s matcher skips every path ending in a file extension (`.*\.[a-zA-Z0-9]+$`), so
`/feeds/google-merchant.xml` and `/indexnow-key.txt` reach their route handlers without a locale redirect.
`manifest` and `robots.txt` / `sitemap` are excluded by name too.

## 6. Structured data (`src/lib/seo/structured-data.ts`, pure)

Rules for every builder: one plain input object; returns a complete document with `"@context"` (or
null when there is nothing to describe); absolute URLs; only what the page shows. Print each document
in its own script with `<JsonLdScript data={doc} />` (`jsonLd()` stays the only serializer).

```ts
SCHEMA_CONTEXT = "https://schema.org"
type JsonLdNode = { "@type": string; "@id"?: string; [property: string]: unknown }
type JsonLdDocument = JsonLdNode & { "@context": string }
type JsonLdRef = { "@id": string }                 // publisher: { "@id": ORG_ID() } satisfies JsonLdRef
ORG_ID(origin = siteOrigin()): string             // "https://…/#organization"  (same on every page and locale)
WEBSITE_ID(origin = siteOrigin()): string         // "https://…/#website"
jsonLdLanguage(locale): string                    // "tr-TR" | "en-US" | "ar"  (inLanguage)
absoluteLink(urlOrPath): string                   // "/media/x.webp" → "https://…/media/x.webp"; http(s) URLs unchanged
```

| Builder | Input | Minimal body today (CORE) | SEO-TECH completes |
|---|---|---|---|
| `organizationJsonLd(input)` | `{ locale, general, seo, logo: MediaLike \| null }` | `Organization`, `@id`, name, legalName, url (`/<locale>`), logo | subtype for online stores (if Google recommends it), telephone (E.164), email, PostalAddress, contactPoint, sameAs, hasMerchantReturnPolicy |
| `webSiteJsonLd(input)` | `{ locale, general, seo }` | `WebSite`, `@id`, name, url, inLanguage, description, publisher → `ORG_ID()`; no SearchAction | as needed |
| `productGroupJsonLd(input)` | `{ product: ProductDetail, locale, reviews: ProductReviewsData \| null, general, shipping, seo }` | **exactly the pre-day-5 Product markup** (`withReviewJsonLd(productJsonLd(…))`; `shipping`/`seo` unused yet) | ProductGroup / Product per §5.1, offers with shippingDetails, return policy; move `productJsonLd` here from `product-view-model.ts` |
| `collectionPageJsonLd(input)` | `{ locale, name, description?, path, products: ProductCardData[] }` | `CollectionPage` (name, description, url, inLanguage) + `mainEntity` `ItemList` (numberOfItems, ListItem position/url/name) | as needed |
| `blogPostingJsonLd(input)` | `{ post: PostDetail, locale, general, logo }` | **exactly the pre-day-5 BlogPosting markup** (moved verbatim from the blog page) | author/publisher → Organization by `@id`, etc. |
| `faqPageJsonLd(items)` | `{ question: string; answer: string }[]` (already localized) | `FAQPage`; empty items dropped; null when none | — |

`faqPageJsonLd` produces the same shape the Faq section prints (`src/components/sections/Faq.tsx` still
builds its own; switching it over is optional). **One FAQPage per page:** the category FAQ gets its
FAQPage from the Faq section STORE-UI renders, so `CategoryStructuredData` must not add another.

## 7. Components (`src/components/seo/`, server components, placed by CORE)

| Component | Props | Reads itself (cached) | Placed in (one line) | Prints today |
|---|---|---|---|---|
| `SiteStructuredData` | `{ locale }` | `getSettings("general"/"seo")`, light logo | `src/app/[locale]/page.tsx`, `Home`, before `<SectionRenderer>` | Organization + WebSite (2 scripts) |
| `ProductStructuredData` | `{ product, locale, reviews }` (`reviews` = `reviewBlock.data`) | general, shipping, seo settings | `src/app/[locale]/urunler/[slug]/page.tsx`, where the inline script was | the pre-day-5 Product JSON-LD, byte-identical |
| `CategoryStructuredData` | `{ category: CategoryData, products: ProductCardData[], locale }` | nothing | `src/app/[locale]/kategori/[slug]/page.tsx`, first child of the product-scope div | CollectionPage + ItemList |
| `ProductsIndexStructuredData` | `{ locale, name, description?, products }` | nothing | `src/app/[locale]/urunler/page.tsx`, before `<ListingHeader>` | CollectionPage + ItemList |
| `BlogPostingStructuredData` | `{ post: PostDetail, locale }` | general settings, light logo | `src/app/[locale]/blog/[slug]/page.tsx`, where the inline script was (end of `<article>`) | the pre-day-5 BlogPosting, byte-identical |
| `JsonLdScript` | `{ data: JsonLdDocument \| null \| undefined }` | — | inside the above | one `<script type="application/ld+json">` or nothing |

- SEO-TECH changes only these bodies and the builders. Need more data? Read cached settings inside the
  component (they're async server components) rather than adding props to the page line. Pages are
  STORE-UI's files; never edit the lines CORE placed.
- Cached reads only (`getSettings`, `getMediaById`): the pages stay static (○). No `cookies()`,
  `headers()`, `searchParams` or `connection()` in these components.
- Blog page cleanup: the inline `articleJsonLd`, the `general`/logo reads and their imports moved out of
  `src/app/[locale]/blog/[slug]/page.tsx`; the product page no longer imports `productJsonLd`,
  `withReviewJsonLd` or `jsonLd`.

## 8. Content script (`scripts/content-day5.ts` + `scripts/seed-data/content-helpers.ts`)

```bash
npx tsx --conditions=react-server --env-file=.env.local scripts/content-day5.ts --dry-run --only=catalogSeo   # while building
```
Steps (owners edit **only their own function**, with the Edit tool, after re-reading the file):
`catalogSeo` (CONTENT-CATALOG), `blogPosts` (CONTENT-BLOG). Both start empty (`emptyReport()`).
`STEPS` order: catalogSeo, then blogPosts. Flags: `--dry-run` (roll every step back, then print its report),
`--only=a,b`, `--allow-production`. Unknown step → error listing the steps. Exit code 1 when a step failed.

```ts
// scripts/seed-data/content-helpers.ts
type ContentReport = { inserted: string[]; updated: string[]; skipped: string[] }
type ContentStep = (db: ScriptDb) => Promise<ContentReport>          // db = the step's transaction
type ContentStepDefinition = { key: string; owner: string; run: ContentStep }
emptyReport(): ContentReport;  isNothingToDo(report): boolean       // no inserted/updated lines
lt(tr, en, ar) → { tr, en, ar }
sameJson(a, b): boolean                       // deep equality; key order and undefined properties ignored
type Path = (string | number)[];  getAt(value, path);  setAt(value, path, next)   // setAt returns a copy
decideDefaultUpdate(current, next, ...previous): "update" | "up_to_date" | "edited"
//   "update" only while `current` still equals one of the previous seeded defaults (include `undefined`
//   to also fill a value that was never set); otherwise report report.skipped.push(`${where}: ${SKIP_REASON[decision]}`)
SKIP_REASON = { up_to_date: "already up to date", edited: "edited in the panel, left as is" }
assertSafeTarget(argv, env?)                  // refuses NODE_ENV=production and non-local DATABASE_URL without --allow-production
runContentSteps({ title, steps, argv })       // the runner both scripts use
```
Example (the shape CONTENT-CATALOG's updates should take):
```ts
const [row] = await db.select({ id: categories.id, seo: categories.seo }).from(categories).where(eq(categories.slug, "el-sabunu"));
const decision = decideDefaultUpdate(row.seo?.title, NEXT_TITLE, PREVIOUS_SEEDED_TITLE, undefined);
if (decision !== "update") report.skipped.push(`category el-sabunu seo.title: ${SKIP_REASON[decision]}`);
else { await db.update(categories).set({ seo: { ...row.seo, title: NEXT_TITLE }, updatedAt: new Date() }).where(eq(categories.id, row.id)); report.updated.push(`categories #${row.id}: seo.title`); }
```
Rules (contract §6): insert only what is missing; update only previous seeded defaults; idempotent; one
transaction per step (the runner does it); no other DB connection, no network. Write the same content into
the seed definitions (`scripts/seed-data/**`) so a fresh database matches. DB test per step: run it twice
inside a rolled-back transaction and assert the second report has no inserted/updated lines
(`tests/db/day5-core-api.test.ts` already does this for both steps, generically).

`content-day4.ts` now imports these helpers (and re-exports `ContentReport` / `ContentStep`); its steps,
report lines and output are unchanged (dry run on the live DB: every step "nothing to do").

## 9. Gotchas

1. **`useId` shifts on the home page.** Adding `<SiteStructuredData>` as a sibling changes React's
   generated ids (`_R_…_`) and the newsletter form's `$ACTION_KEY` there. They're not visible and are
   consistent within the page; mentioned only so nobody chases it in a diff.
2. **`npm run lint` (bare `eslint`) was already red before day 5**: 2 errors in `cache-handler.cjs`
   (`require()` imports) plus warnings in other areas' files and in `kaynak/`. The gate earlier days used,
   `npx eslint src scripts tests --quiet`, is clean.
3. **`cacheLife()` throws outside Next** ("only available with the cacheComponents config"), so DB tests
   can't call `listCategories()`: use `queryCategories(tx)`.
4. Home Organization/WebSite and listing CollectionPage JSON-LD are new (invisible); product and blog
   JSON-LD are byte-identical to before (verified live and by unit tests).

## 10. What CORE verified (2026-11-10)

- **Gates:** `npm run typecheck` clean; `npx eslint src scripts tests --quiet` clean and every CORE file
  0 warnings; `npm test` 709/709 (33 new); `npm run test:db` 312/312 (9 new in
  `tests/db/day5-core-api.test.ts`), with every table and sequence identical before and after (row-hash
  fingerprint of all 93 tables + sequences).
- **Static build:** `NEXT_DIST_DIR=.next/dev-core next build` OK. All 69 fully static storefront pages (home,
  products, 15 product pages, 9 category pages, blog + placeholder, 18 `sayfa`, kurumsal, numune, iletisim,
  siparis, hesap/sifremi-unuttum; tr/en/ar) prerender with no postponed part (○), the same set as the
  pre-day-5 build (CORE-CHECK compared every `.meta`). `.next/dev-core` deleted afterwards, and `tsconfig.json`
  and `next-env.d.ts` restored from `$SCRATCH/day5/*.backup*`.
- **Migration:** generated with `npx drizzle-kit generate --name day5_seo`, reviewed (two `ADD COLUMN`s),
  applied with `npm run db:migrate`; the 4 existing categories read `body = null`, `faq = []`.
- **Storefront unchanged:** dev server on `check.localhost:3501` (`.next/dev-core`), 14 pages (home,
  products, three categories, five product pages incl. the bundle; tr/en/ar) captured before and after.
  Product pages: JSON-LD byte-identical and markup identical. Listings: markup identical plus the new
  CollectionPage. Home: markup identical apart from gotcha 1, plus Organization + WebSite.
- **Content scripts:** `content-day4.ts --dry-run`: every step "nothing to do"; `content-day5.ts --dry-run`:
  both steps "nothing to do"; `--only=nope` → error; `NODE_ENV=production` → refused.

## 11. After the build areas (INTEGRATE, 2026-11-11)

The day-5 areas extended the API above. The code is the reference; this is the map.

**Structured data (`src/lib/seo/structured-data.ts`, SEO-TECH).**
- `productGroupJsonLd(input)` now returns `JsonLdDocument | null` (null: nothing sellable and no rating).
  Several sellable variants → `ProductGroup` (`productGroupID`, `variesBy` size, `hasVariant` Products with
  size, sku, gtin13, images, description, `?varyant=` url, Offer); one → `Product`. Optional input
  `campaignEndsAt` (ISO) → `priceValidUntil`.
- `organizationJsonLd(input)` builds an `OnlineStore` with the store-wide return policy; optional inputs
  `languages` (contactPoint.availableLanguage) and `returnsPath` (merchantReturnLink).
- New exports: `productGroupId(product)` (`"PRD-<id>"`, also the feed's `g:item_group_id`),
  `validGtin13(barcode)`, `oneUnitShippingFee(unitPrice, weightGrams, rules)` (pinned to `computeCart` by a
  test), `offerShippingDetails`, `merchantReturnPolicyJsonLd`, `reviewProperties`, `phoneE164`,
  `countryCode`, `httpsUrl`, `SHOP_COUNTRY`, `SHOP_CURRENCY`, `MAX_JSONLD_REVIEWS`.
- `productJsonLd` / `withReviewJsonLd` are gone from `product-view-model.ts`.
- The contact section (`src/components/sections/ContactInfo.tsx`) prints the same `OnlineStore` entity
  (`@id` = `ORG_ID()`, url, E.164 phone, ISO country) as the home page.

**Crawling.** `querySitemapData(executor?, now?)` (uncached, `src/lib/data/sitemap.ts`) behind the cached
`getSitemapData()`; `SitemapData` has `posts`, and items carry `images?`. `buildSitemap(data, locales)`
(`src/lib/seo/sitemap-entries.ts`) is shared by `app/sitemap.ts` and the IndexNow job (`seo.indexnow`,
`src/lib/seo/indexnow.ts` + `jobs.ts`). Verification tags: `verificationMetadata()` in the locale layout.
`/manifest.webmanifest`, `/indexnow-key.txt` (404 without `INDEXNOW_KEY`).

**Feed.** `buildMerchantFeed(data, origin)` / `collectMerchantFeedItems` (`src/lib/seo/merchant-feed.ts`),
served at `MERCHANT_FEED_PATH`. Items of a product with several variants share
`g:item_group_id = productGroupId(product)`, the page's `productGroupID`.

**Storefront pieces.** `src/components/store/page-heading.ts` (`claimPageHeading`: one `<h1>` per page;
`ListingHeader` claims it unless `claimHeading={false}`), `product-heading.ts` (`productHeading`,
`productGalleryImages`), `CategoryContent.tsx` (category body + FAQ; headings from the UI dictionary keys
`category.faqEyebrow` / `category.faqTitle`). `AudienceGate` + `audience-gate-rules.ts`: `getPage` returns
every audience; `isRenderable(section, filter = "any")`, pass `"retail"` for the guest view (the static HTML).
`Img` props `eager` and `preloadMedia`.

**Panel.** `/panel/seo` (rules in `src/lib/panel/seo/`; `pages.ts` mirrors the storefront's title, description
and H1 logic: keep it in step), `/panel/ayarlar/seo` (verification codes, returns, merchant category, tool
URLs). `pageSitePath` / `pageAddressNote` send the `urunler` page row to `/urunler` (`ROUTE_COPY_PAGES`).

**Content script.** `catalogSeo` and `blogPosts` are filled; `scripts/seed.ts` writes the same content
(category body/faq/seo, product and home SEO, blog posts). `tests/db/day5-core-api.test.ts` restores the
categories, pages, page_sections and blog_posts id sequences after its rolled-back runs.

## 12. After review (FIX, 2026-11-11)

**Structured data / metadata.**
- `webSiteJsonLd(input)`: `url` is the domain root (`https://…/`) on every locale (Google reads site names
  only from the domain home page; `/` redirects to `/tr`, where the markup is printed); `inLanguage` lists the
  enabled languages (optional input `languages`). The audit's `inLanguage` check accepts a list.
- `postKeywords(post, locale)` / `POST_TAGS_LOCALE` (`"tr"`): blog tags are Turkish (`blog_posts.tags` is not
  localized), so BlogPosting `keywords` and `article:tag` are printed on the Turkish page only.
- `notFoundMetadata`, `/bulten/onay`, `/bulten/ayril`: `alternates: { canonical: null, languages: {} }` (no
  inherited home canonical/hreflang on noindex pages); the newsletter pages also set their own share metadata.
- `/urunler` honours its page row's `seo.noIndex` (robots noindex, and the sitemap leaves `/urunler` out) and
  `seo.ogImageId` (share image). Business-only products: product page `robots: { index: false }`, left out of
  the sitemap/IndexNow (`querySitemapData` filters `businessOnly = false`) and shown as noindex (note) in SEO Kontrol.

**Sitemap / IndexNow.** `postLastModified({ updatedAt, publishedAt })` (`src/lib/panel/blog/reading.ts`, pure):
the later of the two. Used for `PostDetail.updatedAt` (dateModified, `article:modified_time`) and the posts'
sitemap lastmod, so a scheduled post is submitted to IndexNow when it goes live. `SitemapData` has optional
`homeUpdatedAt` and `productsPage: { updatedAt, noIndex }`; the home and `/urunler` lastmods include them.

**Sections.** `SectionProps` has optional `audience` and `priority`. `SectionRenderer` passes each section's
`audience`, and with `leadsPage` (home, `/sayfa/<slug>`, CmsPage) gives `priority` to the first section guests
see. `claimSectionHeading(owner, audience)` (`page-heading.ts`) and `mayLeadPage(audience)`
(`audience-gate-rules.ts`): a business-only section never claims the page's `<h1>` and never preloads. Hero
preloads only when `mayLeadPage`; Story, ImageBanner and Packaging preload their first image when `priority`.
Home: a page whose sections are all business-only still gives guests `FALLBACK_SECTIONS` (gated `retail`).

**Content corrections.** `scripts/seed-data/content-fixes.ts`: `TextFix { before, after }`, `LocaleFixes`,
`undoFixes`, `undoLocalizedFixes`. Records: `BLOG_BODY_FIXES` + `firstWrittenBody(post)` (blog.ts),
`CATEGORY_COPY_FIXES`, `PRODUCT_SEO_FIXES` (catalog-copy.ts), `ABOUT_STORY_BODY_FIXES` (site-pages.ts). The
seed holds the corrected text; `content-day5.ts` updates a live value only while it still equals the first
version (the seed text with the corrections undone). To correct day-5 copy again later: edit the seed text and
add a `{ before, after }` record, never rewrite a record.

## 13. After verification (CONTENT2 + UI2, integrated 2026-11-11)

**Correction rounds** (`content-fixes.ts`). `TextFix` has an optional `round` (none = FIX, round 1). A later
correction is a new record with `round: N`, listed after the earlier ones (`undoFixes` throws on bad order).
`undoFixes` / `undoLocalizedFixes(text, fixes, fromRound = 1)`; `fixRounds(fixes)`; `earlierVersions(value,
[{ path, fixes }])` returns the version before each round, newest first. Steps accept any of those versions
as "written by us" (the live DB may hold any earlier round), anything else stays "edited in the panel".
- New records: `SECTION_COPY_FIXES` (site-pages.ts; applied by `correctSectionCopy`, which replaces
  `correctAboutStory`), `HAND_SOAP_WARNINGS_FIXES` (products.ts; `correctHandSoapWarnings`, products #1–3 and
  their samples), round-2 entries in `CATEGORY_COPY_FIXES` (now also `seoTitle` and `faq`) and
  `BLOG_BODY_FIXES` (`earlierBodies(post)` in blog.ts).
- Legal pages: `LEGAL_PAGE_DESCRIPTIONS` + `legalPageSeo(slug, title)` (site.ts). `scripts/seed.ts` stores them
  with each legal page; `fillLegalPageDescriptions` fills `seo.description` on live rows only where it is empty.
  The `/sayfa` route also prints it as the intro under the legal page title.

**Front end (UI2).** Cormorant italic is its own next/font instance (`preload: false`); italic text and
rich-text blockquotes use `--font-heading-italic` (theme engine + globals.css; Arabic maps it to the heading
stack). `can-hover` Tailwind variant (`(hover: hover) and (pointer: fine)`) hides the card hover photo on
touch. `next.config.ts` headers: `/media/:path*` → `public, max-age=86400, stale-while-revalidate=604800`.
Hero preloads only when `priority` (`preload = priority && inGuestHtml`). Card image alt =
`productCardImageAlt` (name + type; wrapper `aria-hidden`); gallery thumbnails carry the media alt; blog card
covers use the alt in the page's own language or stay decorative.

## 14. After the second review (FIX2, 2026-11-11)

**Footer.** The copyright line is `FooterCopyright` (`src/components/store/FooterCopyright.tsx`, pure; `withPeriod`
moved there). The company name sits in `<bdi>` and the year in `dir="ltr"`. Without the isolate, the name's
final period took the paragraph's RTL direction on /ar and showed before the name (".PRESTİJ … ŞTİ").

**Product phrase.** `productPhrase(product, locale)` (`product-heading.ts`, pure). On tr/en it equals
`productHeading().text` ("Lavanta Sıvı El Sabunu"). On ar, name + type reads as a sentence
("اللافندر صابون سائل لليدين"). So ar uses the Arabic SEO title's phrase before its first " — " (the idafa,
"صابون اللافندر السائل لليدين"), when that phrase contains the name and says more than it. Otherwise it uses
"name — type", the structured-data label form. Where it is used:
- the card image alt (`productCardImageAlt`), through a new `ProductCardData.seoTitle` (`products.seo.title`,
  selected by `queryCards`);
- the gallery fallback alt;
- the product page's share image alt and its title fallback.
The `<h1>` is unchanged (see below).

**Round 3** (`round: 3` in `SECTION_COPY_FIXES`):
- the /kurumsal hero subline (tr/en/ar) names the keyword in its own words instead of repeating the `<h1>`
  keyword line;
- the /numune hero subline (en) reads "…, so you can experience…".
The live database got both through `content-day5.ts`.

**Accepted, not changed** (verification findings with recorded reasons):
- **SEO-4.** On every storefront page the body (with the `<h1>`) is in a hidden `S:0` segment after the
  footer, and React's inline `$RC` script moves it into `<main>`. This is how React streams a completed
  Suspense boundary. The content is still in the static prerender (the first HTML response), and Google and
  Bing render JavaScript. Moving the content inline would mean removing the page-level `<Suspense>` around
  every storefront view, which risks the static/partial route table (Cache Components) for a small gain.
- **SEO-5.** The Arabic product `<h1>` reads name, then type ("اللافندر" / "صابون سائل لليدين"). This is the
  layout contract §5.3 asks for: the type is a smaller second line inside the `<h1>`, and on screen the two
  are separate block lines (a name over a descriptor). The Arabic keyword is in both the `<h1>` and the
  `<title>`, and the `<title>` uses the natural idafa form. Only the one-string uses (alts, share alt, title
  fallback) needed the phrase; they now use `productPhrase`.
