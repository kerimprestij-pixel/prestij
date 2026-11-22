# Day 5: search visibility (SEO), the business-sections fix, performance and the final quality pass

Read `docs/ARCHITECTURE.md`, `docs/NEXT16-NOTES.md`, `docs/DAY3-CORE-API.md` and `docs/DAY4-CORE-API.md`
first, and the bundled Next docs for anything you touch (`node_modules/next/dist/docs/01-app/…`: metadata,
`generateMetadata`, `sitemap`, `robots`, `manifest`, JSON-LD guide, route handlers, caching). This file is
the contract the day-5 agents share. Where it names a file, function, table or type, use exactly that
name. If something here is wrong or impossible, do the closest correct thing and say so in your report.
`docs/DAY5-CORE-API.md` (written by CORE) is the API reference for the shared pieces.

**Goal (the client's words, translated).** "When people search the internet for *sabun*, *el sabunu* or
*duş jeli* — even just *temizlik* — we should come up." Make PRESTİJ as findable as a site can make itself:
technically flawless for Google, Bing and Yandex, rich and genuinely useful content around those words in
Turkish (primary), English and Arabic, eligible for Google Shopping free listings and rich results, fast,
and with panel tools so the client can keep it that way without code.

Be honest in reports and UI copy: rankings for head terms like "sabun" or "temizlik" also depend on
things outside the code (domain age, links from other sites, Google Business Profile, customer reviews,
time). We do every on-site part to a professional standard and give the client a clear launch checklist
for the off-site part. Never promise a ranking.

**Facts.** Client: PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ., Cırgalan Mah. Engir Gölü Küme Evler No:5/E,
Kocasinan – Kayseri, tel 0352 353 30 70. Products: four scents — Lavanta Latte, Lavanta, Portakal (sıvı el
sabunu) and Okyanus (duş jeli) — in pompalı şişe, 5 L and 20 L bidon; a four-scent 5 L set; free samples
(not for sale, noindex). Label claims (the only product claims we may make): ETKİLİ TEMİZLİK, CİLDİ KORUYAN,
FERAH KOKU, YUMUŞAK HİS. Made in Türkiye; current site copy says "Kayseri'de üretilir". Prices and the pump
bottle volume are placeholders: never put prices or a pump ml figure into new copy. Money is integer
kuruş. The site is tr/en/ar (ar is RTL). Storefront pages are static (○ in the build table) and must stay so.

## 0. Safety rules (every agent, no exceptions)

- The database `prestij` on localhost:54329 is the client's live local database.
  - Never run `npm run db:seed`, never TRUNCATE, never drop or edit `prestij_backup_day4_start` or
    `prestij_backup_day5_start`.
  - Never touch the client's cart `b60c134a-e103-4626-829f-066a65adccb6`, the user `admin@prestij.local` or
    any of its sessions.
  - Test data: throwaway rows only (e-mails `…@test.local`, slugs prefixed `day5-test-`), always removed
    again (and id sequences restored, like the existing DB tests do).
- Port 3000 is the client's running site. Never start, stop or build into the default `.next` directory
  (`next build` without `NEXT_DIST_DIR` is forbidden). Use your own port and dist dir (table in §9). A build
  with `NEXT_DIST_DIR` rewrites `tsconfig.json` and `next-env.d.ts`: restore both afterwards from
  `$SCRATCH/day5/tsconfig.backup.json` and `$SCRATCH/day5/next-env.backup.d.ts`.
- Never print, log or copy values from `.env.local` (`ADMIN_PASSWORD`, `BETTER_AUTH_SECRET`, …). Variable
  names are fine.
- No network calls to third-party services from code you run: no IndexNow ping, no Google/Bing/Yandex API,
  no real SMTP, no iyzico/PayTR. Reading public documentation pages (developers.google.com, schema.org,
  support.google.com, yandex.com/support) with WebFetch/WebSearch for reference is allowed; never send
  client data anywhere.
- No AI-generated images. Use the existing media library (52 rows) for covers and pictures.
- No git (there is no repo). No new npm dependencies.
- Edit only the files your area owns (§3). A file owned by another area: describe the change you need in
  your report instead. Shared files marked "shared" are edited with the Edit tool after re-reading them,
  touching only your own block.

`$SCRATCH` = `C:/Users/SILVER~1/AppData/Local/Temp/claude/42cf738c6d538154/dfd5ad79-5a93-4a7d-bb46-e9bba4f65c51/scratchpad`.

## 1. Keyword map (TR primary; EN/AR are natural equivalents, not word-for-word)

One primary target per page, so pages don't compete with each other:

| Page | Primary (TR) | Supporting (TR) | EN | AR |
|---|---|---|---|---|
| Home `/tr` | sıvı el sabunu ve duş jeli | sabun, sıvı sabun, temizlik, Kayseri | liquid hand soap and shower gel | صابون سائل لليدين وجل استحمام |
| `/tr/urunler` | temizlik ürünleri | sıvı sabun, kişisel temizlik, el sabunu, duş jeli | cleaning & personal care products | منتجات التنظيف والعناية الشخصية |
| `/tr/kategori/el-sabunu` | sıvı el sabunu | el sabunu, sıvı sabun, pompalı sıvı sabun, 5 L / 20 L sıvı sabun | liquid hand soap | صابون سائل لليدين |
| `/tr/kategori/dus-jeli` | duş jeli | 5 litre duş jeli, otel duş jeli, ferah duş jeli | shower gel | جل الاستحمام |
| `/tr/kategori/hediye-setleri` | sabun hediye seti | sıvı sabun seti, bidon seti | soap gift set | طقم هدايا صابون |
| product pages | `<koku> sıvı el sabunu` / `okyanus duş jeli` | lavanta kokulu sıvı sabun, portakal sıvı sabun, 5 lt / 20 lt bidon | `<scent> liquid hand soap` | |
| `/tr/kurumsal` | toptan sıvı sabun | toptan duş jeli, 20 litre sıvı sabun, otel/ofis/restoran sıvı sabun, tedarik | bulk liquid soap for business | صابون سائل بالجملة |
| `/tr/numune` | ücretsiz sıvı sabun numunesi | numune, deneme | free liquid soap samples | عينات مجانية |
| `/tr/sayfa/hakkimizda` (new) | PRESTİJ Kayseri | sıvı sabun ve duş jeli, Kayseri | about PRESTİJ | من نحن |
| blog posts | one informational query each (§6.6) | | | |

Rules: keywords appear where a human editor would naturally put them (title, H1, first paragraph, a few
subheadings, image alt, link text). No keyword stuffing, no hidden text, no lists of search terms, no
doorway pages, no near-duplicate pages. Titles ≤ 60 characters before the ` | PRESTİJ` suffix where
possible, meta descriptions 120–155 characters, every one unique.

## 2. Copy compliance (all content, all languages)

Cosmetics advertising in Türkiye (Kozmetik Yönetmeliği, claims rules) and consumer law:
- No medical or biocidal claims: never "antibakteriyel", "mikropları öldürür", "%99,9", "hastalıklardan
  korur", "dezenfekte eder", "dermatolojik olarak test edilmiştir", "hipoalerjenik", "doğal/organik",
  "vegan", "paraben içermez", pH values — unless written on the label (they are not).
- No superlatives you can't prove ("en iyi", "Türkiye'nin 1 numarası", "en ucuz"), no invented facts
  (founding year, certificates, ISO, capacity, customer counts, delivery times, testimonials, ratings).
- General hygiene guidance is fine when phrased as general guidance ("ellerinizi en az 20 saniye
  köpürterek ovun"), never as a promise the product prevents illness, and never with an invented citation.
- Hand soaps: include "Göz ile temasından kaçının; temas hâlinde bol suyla durulayın" in usage text.
- Samples: "ücretsiz, satılmaz".
- Arabic and English are complete, natural translations reviewed for grammar; Arabic uses Arabic
  punctuation and Western digits as the rest of the site does.

## 3. Areas and file ownership

| Area | Owns (create/edit) |
|---|---|
| CORE | migration + `src/db/schema` changes; `src/lib/settings/types.ts` (seo block); `src/lib/seo/structured-data.ts` (types + base builders); `src/lib/seo/variant-url.ts`; `src/lib/seo/feed-url.ts`; stub components `src/components/seo/*.tsx` and their placement in the pages; `scripts/content-day5.ts` skeleton + `scripts/seed-data/content-helpers.ts`; `docs/DAY5-CORE-API.md` |
| SEO-TECH | the bodies of `src/components/seo/*.tsx`; `src/lib/seo/structured-data.ts` (after CORE, the builders); `src/components/store/product-view-model.ts` (`productJsonLd` moves to structured-data); `src/app/sitemap.ts`, `src/lib/data/sitemap.ts`, `src/app/robots.ts`, `src/app/manifest.ts` (new); `generateMetadata` of `src/app/[locale]/layout.tsx` (verification codes only); `robots` metadata of private/utility routes (`hesap`, `sepet`, `odeme`, `siparis`, `bulten`); IndexNow: `src/lib/seo/indexnow.ts`, `src/app/indexnow-key.txt/route.ts`, `src/lib/seo/jobs.ts` + one import line in `src/lib/cron/jobs.ts` (shared) |
| FEED | `src/lib/seo/merchant-feed.ts`, `src/app/feeds/google-merchant.xml/route.ts`, tests |
| STORE-UI | `src/app/[locale]/urunler/[slug]/page.tsx`, `src/app/[locale]/kategori/[slug]/page.tsx`, `src/app/[locale]/urunler/page.tsx`, `src/app/[locale]/page.tsx`, `src/app/[locale]/blog/**`, `src/app/[locale]/sayfa/[slug]/page.tsx`, `src/components/store/ListingHeader.tsx`, product page components under `src/components/store/` (gallery, variant picker, product info, cards, grid, Breadcrumbs), `src/components/sections/Hero.tsx`, `src/components/sections/RichText.tsx`, `src/components/sections/Faq.tsx` (layout only; its JSON-LD stays), new `src/components/store/CategoryContent.tsx` — never the lines CORE placed for `src/components/seo/*` |
| SEO-PANEL | `src/app/panel/(dashboard)/ayarlar/seo/**`, `src/components/panel/settings/SeoSettingsForm.tsx` and its action/schema, new `src/app/panel/(dashboard)/seo/**` + `src/lib/panel/seo/**`, category editor files `src/components/panel/categories/**` and the category save action/schema in `src/lib/panel/**` (body + FAQ fields), panel navigation entry (shared: one line) |
| CONTENT-CATALOG | `scripts/content-day5.ts` → function `catalogSeo` (and only it); seed definitions in `scripts/seed-data/**` for settings, categories, products, pages/sections, menus, media alt texts; never blog seed |
| CONTENT-BLOG | `scripts/content-day5.ts` → function `blogPosts` (and only it); new `scripts/seed-data/blog.ts`; the one call in `scripts/seed.ts` that inserts it (shared) |
| AUDIENCE-PERF | `src/components/sections/SectionRenderer.tsx`, new `src/components/sections/AudienceGate.tsx`, `src/components/store/CmsPage.tsx` (only if needed for the gate), the audience select help text in the panel section editor (shared: one line), `src/components/store/Header.tsx` + header subcomponents, `src/components/store/AnnouncementBar.tsx`, `src/components/cart/**` (drawer polish), `src/lib/fonts.ts`, `src/lib/media/Img.tsx` (only for priority/sizes fixes) |
| SEO-AUDIT | new `src/lib/seo/audit/**` (pure rules), `scripts/seo-audit.ts` (crawler/CLI), tests |

Tests: each area adds its own files under `tests/unit/day5-<area>-*.test.ts` and `tests/db/day5-<area>-*.test.ts`.
If an existing test breaks because of an intended change (e.g. a seeded name changed), fix that test in
the smallest way and list it in your report.

## 4. CORE (runs first, alone)

1. **Schema + migration.** Add to `categories`: `body jsonb $type<LocalizedText>()` (sanitized HTML subset,
   same rules as blog/rich_text bodies, nullable) and `faq jsonb $type<{ question: LocalizedText; answer: LocalizedText }[]>() not null default '[]'`.
   Generate with `npm run db:generate` (review the SQL: additive only) and apply with `npm run db:migrate`.
   Make the catalog read path (`listCategories` and friends, cached) return both fields.
2. **Settings.** Extend `seoSettings` (defaults must keep existing rows valid):
   - `verification: { google: string, bing: string, yandex: string }` (default all ""; the content attribute
     of each engine's meta tag; validate `^[A-Za-z0-9_\-:.=]*$`, max 100).
   - `returns: { days: number (int 0–365, default 14), freeReturns: boolean | null (default null = unknown) }`
     for MerchantReturnPolicy structured data and the feed.
   - `merchantCategory: string` (Google product taxonomy id or path for hand soap, default chosen by CORE
     after checking Google's taxonomy file; document the value).
3. **Shared SEO API.**
   - `src/lib/seo/variant-url.ts`: `VARIANT_QUERY_PARAM = "varyant"`;
     `variantPath(locale, slug, variantId)` → product path + `?varyant=<id>`; `parseVariantParam(value)`.
   - `src/lib/seo/feed-url.ts`: `MERCHANT_FEED_PATH = "/feeds/google-merchant.xml"`, `merchantFeedUrl()`.
   - `src/lib/seo/structured-data.ts`: JSON-LD types, `ORG_ID`/`WEBSITE_ID` helpers (`${origin}/#organization`,
     `${origin}/#website`), and exported builder signatures with minimal working bodies:
     `organizationJsonLd`, `webSiteJsonLd`, `productGroupJsonLd`, `collectionPageJsonLd`,
     `blogPostingJsonLd`, `faqPageJsonLd` (reuse whatever exists). Keep `jsonLd()` (the `</script>`-safe
     serializer in `src/components/store/format.ts`) as the only way to print JSON-LD.
4. **Stub components + placement.** Create server components in `src/components/seo/` that take plain props
   available on each page and return `<script type="application/ld+json">` via `jsonLd()` (or `null`):
   `SiteStructuredData` (home: Organization + WebSite), `ProductStructuredData` (replaces the inline script
   in the product page), `CategoryStructuredData`, `ProductsIndexStructuredData`, `BlogPostingStructuredData`.
   Place them in the page files now (one line each), so SEO-TECH fills bodies without touching page files.
   Product page: keep exactly today's output until SEO-TECH replaces it.
5. **Content script skeleton.** `scripts/content-day5.ts` in the style of `scripts/content-day4.ts` (same CLI
   flags, one transaction per step, `--dry-run`, refuses production, reports inserted/updated/skipped,
   idempotent). Move the generic helpers (`sameJson`, `getAt`, `setAt`, report helpers, "update only if
   still the previous seeded default") into `scripts/seed-data/content-helpers.ts` and import them from both
   scripts. Register two empty owner functions: `catalogSeo` (CONTENT-CATALOG) and `blogPosts`
   (CONTENT-BLOG).
6. **Docs.** `docs/DAY5-CORE-API.md`: every new export with signature and a 1–3 line usage note, the
   migration name, settings defaults, component props, the content script rules.
7. Gates for your own work: `npm run typecheck`, `npm run lint`, `npm test`, the DB tests you touched. The
   storefront must render exactly as before (no visible change from CORE).

## 5. Build areas (run in parallel after CORE)

### 5.1 SEO-TECH — structured data, metadata, crawling
- **Organization** (home, via `SiteStructuredData`): check Google's current Organization docs and use the
  subtype they recommend for online stores if any (e.g. `OnlineStore`), else `Organization`. `@id`, name,
  legalName, url, logo (absolute URL of the light logo, ≥112 px), telephone (E.164), email if set,
  PostalAddress (TR), `contactPoint` (customer service, phone, `availableLanguage` tr/en/ar), `sameAs` from
  `settings.general.social` (only valid https URLs), `hasMerchantReturnPolicy` from `settings.seo.returns`
  (+ `merchantReturnLink` to the returns page). **WebSite**: `@id`, name, url per locale, `inLanguage`,
  `publisher` → organization `@id`. No SearchAction (there is no search page).
- **Product** (`ProductStructuredData`): follow Google's merchant-listing + product-variant docs. A product
  with several sellable variants → `ProductGroup` (`productGroupID`, `variesBy` size, `hasVariant` Product
  per variant with name incl. size, sku, gtin13 only when a valid EAN-13, image, `size`, `url` =
  `variantPath(...)` absolute, `offers`); a single variant → `Product`. Offers: price (campaign-aware, as
  today), `priceCurrency` TRY, availability, `itemCondition`, `priceValidUntil` when a campaign has an end
  date, `shippingDetails` (rate computed with the real shipping rules for one unit of that variant —
  flat fee, free threshold, heavy surcharge — destination TR; omit `deliveryTime` unless a setting exists),
  `hasMerchantReturnPolicy` (or rely on the organization-level one if the docs allow; say which). Keep
  `aggregateRating` and add up to 5 recent approved `review`s when they exist. `brand` → PRESTİJ.
- **Category / products index**: `CollectionPage` with `mainEntity` `ItemList` (position, url, name).
  **Blog post**: `BlogPosting` (headline, description, image, datePublished, dateModified, author and
  publisher → organization, `mainEntityOfPage`, `inLanguage`). BreadcrumbList stays where it is; make sure
  product, category, page and blog post pages all have one (coordinate with STORE-UI through your report
  if a page lacks visible breadcrumbs).
- **Metadata**: verification meta tags from `settings.seo.verification` (google → `verification.google`,
  yandex → `verification.yandex`, bing → `other["msvalidate.01"]`) in the root locale layout. Audit every
  indexable route's `generateMetadata`: unique title, description, `alternates` (canonical self + hreflang
  incl. x-default) for its own URL, `shareMetadata`. Home must not render "PRESTİJ … | PRESTİJ" (use an
  absolute title there if needed).
- **Robots/noindex**: every private or utility route (account, cart, checkout and its card/simulator
  pages, order pages and lookup, newsletter confirm/unsubscribe, password reset/verify) returns
  `robots: { index: false }` metadata. robots.txt keeps disallowing panel/api/cart/checkout/account and adds
  the order pages; do not disallow pages that carry a noindex you need crawlers to see.
- **Sitemap**: add `images` (absolute URLs of up to 5 product images; blog cover) to entries; new pages
  (e.g. `hakkimizda`) appear automatically when published and indexable; keep everything cached and
  tag-invalidated.
- **Manifest**: `src/app/manifest.ts` (name, short_name, description from settings, start_url `/tr`, icons
  from the existing app icons, theme/background colors from the brand). Check the docs for how a manifest
  coexists with the `[locale]` root layout.
- **IndexNow** (Bing, Yandex): `INDEXNOW_KEY` env var (8–128 chars `[A-Za-z0-9-]`); `GET /indexnow-key.txt`
  returns the key as text/plain (404 when unset); a daily cron job `seo.indexnow` (registered like the
  existing jobs) submits sitemap URLs changed since the last successful run to `https://api.indexnow.org/indexnow`
  with `keyLocation`. It does nothing (result `skipped`, reason) unless `NODE_ENV=production`, the key is
  set and the site origin is not localhost. Unit-test with an injected fetch; never hit the network.
- Unit tests for every builder against Google's required/recommended fields.

### 5.2 FEED — Google Merchant Center (also valid for Meta catalogs)
- `GET /feeds/google-merchant.xml`: RSS 2.0 with the `g:` namespace, Turkish, target TR. One `<item>` per
  sellable variant of every active, indexable `standard`/`bundle` product (never samples). Fields: `g:id`
  (SKU), `g:item_group_id` (product), `title` (brand + name + type + size, ≤150), `description` (plain
  text, no HTML, ≤5000), `link` (absolute `variantPath`), `g:image_link` + up to 10
  `g:additional_image_link` (absolute; a JPEG/PNG/WebP rendition — never AVIF), `g:availability`,
  `g:price` ("149.90 TRY"), `g:sale_price` + `g:sale_price_effective_date` for campaigns, `g:brand`,
  `g:gtin` (valid EAN-13 only) else `g:identifier_exists` no + `g:mpn` = SKU, `g:condition` new,
  `g:google_product_category` (from settings), `g:product_type` (category > product), `g:size`,
  `g:shipping` (TR, price for one unit computed with the real rules), `g:shipping_weight`, `g:is_bundle`
  for bundles, `g:unit_pricing_measure` when the volume is known.
- Pure builder `buildMerchantFeed(data, origin)` (unit-tested: escaping, prices, required fields, sample
  exclusion, campaign dates in ISO 8601 with +03:00), cached reads with the catalog/settings tags, correct
  `Content-Type: application/xml; charset=utf-8`. The route must not make storefront pages dynamic.

### 5.3 STORE-UI — what crawlers and people see on the page
- Product page: the H1 reads as the full product name + type ("Lavanta Sıvı El Sabunu"), visually like
  today (type as a smaller line inside the H1, no duplicated eyebrow). Variant preselect from
  `?varyant=<id>` on the client (inside the existing client island; the page stays static, canonical stays
  the clean product URL); changing the variant may `history.replaceState` the param. Image alt fallback:
  name + type + size. Description HTML renders headings/lists well (CONTENT adds `<h2>`/`<ul>`).
- Category page: render `category.body` (sanitized) below the grid as a readable editorial section and
  `category.faq` with the existing Faq section look (FAQPage JSON-LD comes from the Faq component). H1 =
  category name.
- `/urunler`: its page-builder sections render below the grid (check; fix if not). H1 from the page title.
- Home: the hero H1 contains the keyword line — render the hero eyebrow inside the `<h1>` as its first,
  smaller line when the hero is the page's first section (same look as today). Only one H1 per page
  everywhere (check CMS pages and blog).
- Blog post page: visible breadcrumbs, related products, author "PRESTİJ", reading time; the blog index
  lists posts with cover, excerpt and date.
- Internal links: product pages link to their category and to the other scents (relations exist);
  category bodies and blog posts contain links (CONTENT writes them, you make sure they render).
- RTL correct everywhere you touch; no layout shift added.

### 5.4 SEO-PANEL — keep it right without code
- `/panel/ayarlar/seo`: add the verification codes (with where-to-find-it help text), the returns block,
  the merchant category, and read-only copyable URLs: sitemap, robots, merchant feed, IndexNow key file
  (shows whether `INDEXNOW_KEY` is set, never its value). Audit-logged like other settings.
- Category editor: localized rich-text **body** (same editor/sanitizer as blog bodies) and a repeatable
  **SSS** list (question/answer per locale, add/remove/reorder), saved with the existing optimistic lock
  and audit log; cache invalidation like other category saves.
- New page **SEO Kontrol** (`/panel/seo`, nav entry, read-only, roles that can open settings): for home,
  products index, categories, products, published pages and blog posts, per locale:
  title (present, 30–60 chars), description (120–160), H1/name present, body length (category body ≥ 150
  words, product description ≥ 80 words, blog ≥ 400 words), images without alt text (per locale), variants
  without a valid GTIN, noindex flags, duplicate titles/descriptions, missing share image. A status badge
  per row (İyi / Geliştirilebilir / Eksik) with the reasons and a link to the editor. Pure rule functions in
  `src/lib/panel/seo/` with unit tests.
- On the same page, a **"Yayına çıkınca"** checklist card (static Turkish copy, plain and short): Google
  Search Console (verify with the code above, submit the sitemap URL), Bing Webmaster Tools (import from
  Search Console), Yandex Webmaster, Google Business Profile for the Kayseri address (photos, hours, ask
  customers for reviews), Google Merchant Center (feed URL, shipping and returns settings), social profile
  links in Genel ayarlar, `INDEXNOW_KEY`, links from suppliers/partners/local directories. Each item shows the
  exact URL to paste where relevant.

### 5.5 CONTENT-CATALOG — the words (step `catalogSeo` + seed definitions)
Write in Turkish first, then English and Arabic. Use the keyword map (§1) and compliance rules (§2). Read the
current rows and the rendered pages before writing so nothing is duplicated (e.g. a spec table the product
page already shows). Seed definitions get the same content so a fresh database matches.
- `settings.seo`: default title/description mentioning sıvı el sabunu, duş jeli and temizlik.
- Home page SEO title/description; an FAQ section near the end of the home page (4–6 real questions people
  ask about sıvı el sabunu / duş jeli / bidon sizes / samples / business supply).
- Categories: names "Sıvı El Sabunu", "Duş Jeli", "Hediye Setleri" (slugs unchanged); SEO title and
  description; `body` (TR 300–600 words with `<h2>` subheadings: choosing, pump bottle vs 5 L / 20 L bidon and
  refilling, where it's used — home, office, hotel, restaurant, school, gym —, the scents; internal links
  to products, `/kurumsal`, `/numune`); `faq` 4–6 items. EN/AR equivalents.
- Products: SEO title/description per §1; append to each description (only while it is still the seeded
  default) factual sections: "Ürün özellikleri" (type, scent, packaging options, where to use), "Kullanım"
  (how to use + the eye-contact caution for hand soaps), "Bidonlar ve yeniden doldurma" for 5 L/20 L. Bundle:
  what's inside. Keep the existing poetic paragraph first.
- `/urunler` page row (slug `urunler`, if missing): title "Tüm Ürünler", SEO title/description targeting
  "temizlik ürünleri", and sections below the grid: a short rich-text "kişisel temizlik" guide linking the
  categories, plus an FAQ.
- `/kurumsal`: SEO title/description targeting "toptan sıvı sabun" (5 L, 20 L, otel, ofis, restoran) without
  changing what the page offers. `/numune`, `/iletisim`: polish SEO title/description.
- New page `hakkimizda` (published, indexable): who PRESTİJ is (company, Kayseri, products, packaging,
  business and home customers, samples), only facts from this file; sections built from existing section
  types and existing media. Add it to the footer menu.
- Footer menu: links (with keyword link text) to Sıvı El Sabunu, Duş Jeli, Toptan Sıvı Sabun (`/kurumsal`),
  Ücretsiz Numune, Blog, Hakkımızda — only those missing; keep the menu tidy and the same in all locales.
- Media alt texts (tr/en/ar) for product and lifestyle images: descriptive, natural, keyword where true
  ("Lavanta sıvı el sabunu, pompalı cam şişe, mermer lavabo üzerinde"); only where the alt is empty or still
  the seeded default.

### 5.6 CONTENT-BLOG — helpful articles (step `blogPosts` + `scripts/seed-data/blog.ts`)
Six to seven published posts, each 700–1200 words in Turkish with complete EN and AR versions, author
"PRESTİJ", tags, reading minutes, a cover from the existing lifestyle media, 1–3 related products, SEO
title/description, internal links to categories/products/`/kurumsal`/`/numune`, no claims beyond §2.
Suggested set (adjust slugs/titles to read naturally):
1. `sivi-el-sabunu-nasil-secilir` — Sıvı el sabunu nasıl seçilir?
2. `5-litre-20-litre-sivi-sabun-rehberi` — 5 L ve 20 L bidon sıvı sabun: işletmeler için rehber
3. `sivi-sabun-dispenseri-nasil-doldurulur` — Dispenser ve pompalı şişe nasıl doldurulur? (clean and dry
   before refilling; don't top up)
4. `dus-jeli-mi-kati-sabun-mu` — Duş jeli mi, katı sabun mu?
5. `otel-ofis-restoran-icin-sivi-sabun` — Oteller, ofisler ve restoranlar için sıvı sabun ve duş jeli
6. `dogru-el-yikama-adimlari` — Doğru el yıkama: adım adım el temizliği (general guidance, targets "temizlik")
7. (optional) `koku-secimi-lavanta-portakal-okyanus` — Hangi alana hangi koku?
Published dates spread over the past weeks (not in the future), ordered sensibly. Slugs are ASCII.

### 5.7 AUDIENCE-PERF — the known bug and speed
- **Bug**: business-only page sections never show and retail-only sections show to business customers,
  because pages are static and `SectionRenderer` always uses `audience="retail"`. Fix: render `all`
  sections as today; wrap `business`/`retail` sections in a client `AudienceGate` that uses `useViewer()`:
  business sections appear only when `viewer.ready` and the viewer is an approved business customer;
  retail sections are in the static HTML and hide for approved business customers once the viewer loads.
  Pages stay static. No flash of wrong content for guests; a gentle fade-in for business sections. Help
  text in the panel section editor: "Yalnızca onaylı kurumsal müşterilere gösterilir — gizli bilgi
  koymayın (sayfa kaynağında görünür)." Tests for the gate logic.
- **Header layout shift** (deferred from day 4): find what moves after load (viewer greeting/account
  link, cart count, announcement bar, logo, fonts) and reserve its space. **Cart drawer**: the sample list
  must not jump when the "added" notice disappears; the "Sepete eklendi" button text must not be cut off
  (check tr/en/ar, narrow phones).
- **LCP/weight**: the first hero/product image has priority/`fetchPriority="high"` and correct `sizes`; no
  other image is eager; fonts don't block or shift; no unnecessary client JS on static pages (lazy-load
  heavy islands where it's simple and safe). Report before/after numbers you can measure from the build
  (route sizes, first-load JS).

### 5.8 SEO-AUDIT — the checker the final stage runs
- `npx tsx scripts/seo-audit.ts --base <origin> [--connect <origin>] [--json <file>] [--strict]`
  (`--connect`: where to actually send requests, e.g. `http://127.0.0.1:3660` while `--base` is
  `http://check.localhost:3660`; URLs found on pages are rewritten for fetching only): fetch `/robots.txt`,
  `/sitemap.xml`, every sitemap URL, the merchant feed, and every same-origin link found on those pages
  (not disallowed by robots). Report per URL: status (200; redirects followed and reported), `<title>`
  (present, unique, length), meta description (present, unique, length), exactly one `<h1>`, `<html lang>`
  and `dir`, canonical = self (absolute), hreflang set complete + reciprocal + x-default, OG title/image,
  robots meta vs sitemap membership (no noindex URL in the sitemap; no indexable page missing from it),
  images without alt, JSON-LD parses and has the required fields for its type (Product/ProductGroup,
  Offer, BreadcrumbList, Organization, WebSite, CollectionPage, BlogPosting, FAQPage), broken internal
  links (4xx/5xx), feed items with missing required fields. Errors make the exit code 1; warnings don't.
  Human-readable summary on stdout, full detail in `--json`.
- Pure rule functions in `src/lib/seo/audit/` with unit tests (HTML is our own; a small tolerant parser
  with regexes is acceptable, no new dependency).

## 6. Content script rules (`scripts/content-day5.ts`)

- Same guarantees as `content-day4.ts`: inserts only what is missing; updates only fields whose current
  value is still exactly the previous seeded default (compare with `sameJson`); anything else is reported as
  skipped ("edited by the client"); idempotent (a second run reports nothing to do); one transaction per
  step; `--dry-run` rolls back; refuses production without `--allow-production`.
- Run it yourself only as `--dry-run --only=<yourStep>` while building. The INTEGRATE stage runs it for
  real on the live database; FINAL runs it again to prove idempotency.
- A DB test per step: inside a transaction, apply the step twice, assert the second report is empty,
  roll back.
- After a real run the running site needs its caches refreshed; the final stage reports that.

## 7. Integration, review, fix, final

- **INTEGRATE**: merge all areas into one working tree; run every gate; run `content-day5.ts --dry-run`,
  then for real; build into `.next/build-integrate` and serve on its port with
  `NEXT_PUBLIC_SITE_URL`/`BETTER_AUTH_URL` = `http://check.localhost:<port>` (baked at build time);
  run `scripts/seo-audit.ts` against it; fix cross-area breakage; report.
- **REVIEW** (4 lenses, read-only, then adversarial verification of each finding): SEO correctness;
  content quality and compliance; code correctness and security; performance, UX, accessibility and RTL.
- **FIX**: fix every confirmed finding (high and medium always; low unless it needs a product decision).
- **FINAL**: all gates; content script idempotency; isolated build + seo-audit with zero errors;
  storefront routes still ○; DB diff against `$SCRATCH/day5/start.json` contains only the intended
  content changes (no test leftovers); restore `tsconfig.json`/`next-env.d.ts`; stop every server you
  started; full report.

## 8. Gates

`npm run typecheck` · `npm run lint` · `npm test` · `npm run test:db` · `next build` with `NEXT_DIST_DIR` (§9)
· `npx tsx scripts/seo-audit.ts` against the isolated build. Build areas may skip the full build; they must
leave their own files free of type and lint errors (other areas' in-progress files may show errors while
everyone works in parallel — don't fix those, mention them).

## 9. Ports and dist dirs

| Stage | Port | `NEXT_DIST_DIR` |
|---|---|---|
| CORE | 3501 | `.next/dev-core` |
| SEO-TECH | 3510 | `.next/dev-seotech` |
| FEED | 3520 | `.next/dev-feed` |
| STORE-UI | 3530 | `.next/dev-storeui` |
| SEO-PANEL | 3540 | `.next/dev-seopanel` |
| CONTENT-CATALOG | 3550 | `.next/dev-catalog` |
| CONTENT-BLOG | 3560 | `.next/dev-blog` |
| AUDIENCE-PERF | 3570 | `.next/dev-perf` |
| SEO-AUDIT | 3580 | `.next/dev-audit` |
| INTEGRATE | 3590 | `.next/build-integrate` |
| reviewers | 3600–3630 | `.next/dev-review-<n>` |
| FIX | 3650 | `.next/build-fix` |
| FINAL | 3660 | `.next/build-final` |

Use `http://check.localhost:<port>` as the origin so the client's localhost:3000 cookies are never touched.
Node and curl on Windows may not resolve `*.localhost`: connect to `127.0.0.1:<port>` instead
(`curl --resolve check.localhost:<port>:127.0.0.1 …`; the audit script takes `--connect http://127.0.0.1:<port>`
and keeps `--base` as the canonical origin for comparisons). Do not use the Claude browser pane (the lead
uses it). Stop every server you start before you finish (only your own PIDs; never the process on port 3000).

## 10. Report (every agent)

Write `$SCRATCH/day5/results/<area>.md` and return the structured summary you are asked for: what you did,
files changed, tests added, gates run with results, anything left open or needing a product decision, and
exact notes for the integrator (changes you need in files you don't own).
