# Day 6: the gift wheel (Hediye Çarkı) and video (product gallery, hero, video section)

Read `docs/ARCHITECTURE.md`, `docs/NEXT16-NOTES.md`, `docs/DAY4-CORE-API.md` and `docs/DAY5-CORE-API.md` first,
and the bundled Next docs for anything you touch (`node_modules/next/dist/docs/01-app/…`: route handlers,
server actions, caching/`use cache`, `cookies`, metadata/sitemap, `after`). This file is the contract the
day-6 agents share. Where it names a file, function, table or type, use exactly that name. If something here
is wrong or impossible, do the closest correct thing and say so in your report. `docs/DAY6-CORE-API.md`
(written by CORE) is the API reference for the shared pieces.

Background maps of the existing code (read the ones for your area before you start; they have file:line
references): `$SCRATCH/day6/map/{auth,commerce,panel,storefront,media,gallery,tooling}.md`.

**Goal (the client's words, translated).** "The gift wheel is there to persuade visitors to buy and to sign
up." And: "Let me add videos, not only photos, to the product gallery whenever I want." The client is
building "the most advanced site in the world selling the best cleaning and personal-care products": build
both features to a professional standard, fully editable in the panel without code, fast, accessible,
tr/en/ar with Arabic RTL, and safe against abuse.

**Facts.** Client: PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ., Kayseri. Products: Lavanta Latte, Lavanta,
Portakal (sıvı el sabunu) and Okyanus (duş jeli) in pompalı şişe, 5 L and 20 L bidon, a four-scent set, free
samples. Prices are placeholders. Money is integer kuruş, VAT included. Storefront pages are static (87 S +
60 P `.meta` files under tr/en/ar in the Day 5 build; home tr/en/ar are S) and must stay exactly so. The
copy rules of `docs/DAY5-SEO.md` §2 apply to every new text (no superlatives, no medical claims, no invented
facts; Arabic and English natural and complete).

## 0. Safety rules (every agent, no exceptions)

- The database `prestij` on localhost:54329 is the client's live local database.
  - Never run `npm run db:seed`, never TRUNCATE, never drop or edit `prestij_backup_day4_start`,
    `prestij_backup_day5_start` or `prestij_backup_day6_start`.
  - Never touch the client's cart `b60c134a-e103-4626-829f-066a65adccb6`, the user `admin@prestij.local` or
    any of its sessions.
  - Test data: throwaway rows only (e-mails `…@test.local`, codes/slugs/folders prefixed `day6-test-` or
    `DAY6TEST`), always removed again, id sequences restored like the existing DB tests do. Prefer
    `inRollback`.
- Port 3000 is the client's running site. Never start, stop or build into the default `.next` directory
  (`next build` without `NEXT_DIST_DIR` is forbidden). Use your own port and dist dir (§9). A build with
  `NEXT_DIST_DIR` rewrites `tsconfig.json` and `next-env.d.ts`: restore both afterwards from
  `$SCRATCH/day5/tsconfig.backup.json` and `$SCRATCH/day5/next-env.backup.d.ts` and check with `cmp`.
- Never print, log or copy values from `.env.local`. Variable names are fine.
- No network calls to third-party services from code you run: no Supabase, no SMTP, no iyzico/PayTR, no
  Google. Supabase code paths are written from the public docs and unit-tested with a fake `fetch`. Reading
  public documentation (supabase.com/docs, developers.google.com, developer.mozilla.org, schema.org) is fine.
- No AI-generated images or videos. Test clips for checks are synthetic (hand-built bytes for unit tests; a
  canvas animation recorded with MediaRecorder in a local headless Chromium for live checks) and are deleted
  afterwards. The client will upload real videos.
- No git. No new npm dependencies (the installed `motion` package must not be imported).
- Do not use the Claude browser pane (the lead uses it). A local headless Chromium/Edge via CDP is fine
  (Day 5 used `$SCRATCH/polish/cdp/*`).
- Edit only the files your area owns (§3). A file owned by another area: describe the change you need in
  your report. Files marked "shared" are edited with the Edit tool after re-reading them, touching only your
  own block.

`$SCRATCH` = `C:/Users/SILVER~1/AppData/Local/Temp/claude/42cf738c6d538154/dfd5ad79-5a93-4a7d-bb46-e9bba4f65c51/scratchpad`.

## 1. Product decisions (made by the lead; do not reopen them, mention disagreements in your report)

### 1.1 Gift wheel — who, when, what

- **Purpose.** Conversion and sign-up: a visitor spins, wins a prize, and must **sign up (or sign in)** to
  claim it. The claimed prize is a **unique, single-use coupon bound to that account**, valid for a limited
  time, auto-applied in the cart with a visible countdown.
- **Every slice wins.** No "kaybettin / tekrar dene" slice, and every slice has weight ≥ 1 (a slice that
  can never land must not be shown). Prize types: `percent` (1–50), `fixed` (kuruş, ≥ 100), `free_shipping`.
  Each slice: `key` (stable id), `label` LocalizedText (tr required, ≤ 40 chars), `type`, `value`,
  `minOrderTotal` (kuruş, 0 = none), `weight` (1–1000), `tone` (`brand` | `gold` | `cream` | `ink`,
  theme-safe colours). 4–8 slices. The server alone picks the result (`crypto.randomInt`, weighted).
- **Who sees it** (panel setting `audience`): `new_customers` (default: guests, and signed-in customers with
  no counted order by user id or by lower(e-mail); counted = the statuses of `COUNTED_STATUSES` in
  `src/lib/b2b/queries.ts`, export it) or `everyone`. Never staff accounts (any staff role). Approved business
  customers only when `showToBusiness` is on (default off). For guests, "has ordered" is unknowable, so the
  audience is enforced again at claim time.
- **One spin per visitor, one prize per account per round.** A spin is stored in `wheel_spins` and
  remembered by the httpOnly cookie `prestij_wheel` = `signToken('wheel-spin', { id }, holdDays)`. A visitor
  with a live unclaimed spin gets the same result again (idempotent), never a re-spin. Durable limits:
  `wheel:ip:<ip>` 10 spins / 24 h, `wheel:ip:<ip>` 3 claims / 24 h, `wheel:user:<id>` 1 claim per round.
  The panel has a `round` number ("Yeni tur başlat") that makes everyone eligible again.
- **Unclaimed hold:** `holdDays` (default 7). **Validity after claim:** `validityHours` (default 72, range
  24–720). The clock starts at claim (coupon issue), not at spin.
- **Claim paths.**
  1. Signed-in eligible visitor: the result screen shows "Hediyemi al"; the claim action issues the coupon at
     once and auto-applies it.
  2. Guest: the result screen shows "Hediyeni almak için ücretsiz üye ol" (→ `href(locale,'register')` +
     `?sonra=<current path>`, e-mail prefill via the existing sessionStorage key) and "Zaten üye misin? Giriş
     yap" (→ `signInHref(locale, sonra)`). `registerAction` binds the cookie spin to the new user id (only in
     the `!existedBefore` branch; never reveal whether an e-mail exists). The coupon is issued in
     `completeEmailVerification` (device-independent: the mail link may open on another device), inside a
     savepoint so a wheel error never rolls back order linking or the welcome mail.
  3. Existing account signing in (`afterSignIn`, and the `EMAIL_NOT_VERIFIED` branch of `signInAction` binds
     only): bind + issue if eligible and no prize this round, then auto-apply. Also add `callbackURL` with
     `?sonra=` to `auth.api.signInEmail` so a resent verification link keeps the return path.
  4. The register and sign-in pages show a small banner when the visitor holds an unclaimed spin ("Çark
     hediyen: %10 indirim — üyeliğini tamamlayınca hesabına tanımlanır").
- **Auto-apply.** After a claim, apply the code to the user's cart when the cart has eligible lines and no
  other code. Otherwise keep it and apply it on the next `addItem` when the cart has no code. Never overwrite
  a code the buyer typed. `coupon_no_benefit` means "keep for later", not an error. Never leave an invalid
  wheel code on a cart.
- **Countdown everywhere it persuades.** Cart page (`CouponForm`), cart drawer (small prize row), the
  storefront reminder chip (the teaser turns into "🎁 Hediyen seni bekliyor · 2g 03:14" linking to the cart
  for a signed-in user with an active unused prize), the account overview (`/hesap`) card, and the e-mails.
- **Coupons.** Wheel prizes are rows in `coupons` with `source = 'wheel'`, `user_id = <owner>`,
  `max_uses = 1`, `per_customer_limit = 1`, `starts_at = now`, `ends_at = now + validityHours`, unscoped (no
  product/category/group lists), `min_order_total` from the slice. Code format `CARK-XXXXXX` (6 chars from
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), unique on upper(code), insert with retry. `couponEligibility` fails with
  the new reason `not_owner` when `coupon.userId` is set and differs from the customer's user id (covers the
  cart and `placeOrder`). Wheel coupons stack like any coupon (current engine rules). A cancelled order
  frees the prize again until its expiry (current restock behaviour; document it).
  `listPanelCoupons` shows only `source = 'manual'`; wheel coupons are read-only in the coupon editor
  (deactivate only).
- **Triggers and placement.** A teaser button bottom-**start** (WhatsApp owns bottom-end), `z-30`, appears
  after `viewer.ready` + idle + `teaserDelaySeconds` (default 6) on eligible pages only. Never on cart,
  checkout, account, order, legal pages, `/bulten`, 404 or panel. Desktop only (`(hover:hover) and
  (pointer:fine)`), the dialog may auto-open after `autoOpenSeconds` (default 25, 0 = off) or on exit intent
  (`exitIntent`, default on), at most once per `autoOpenCooldownDays` (default 7). **Mobile never auto-opens**
  (Google intrusive-interstitial rule); there the teaser only. Closing the dialog shrinks the teaser to a
  small gift icon. "Bir daha gösterme" hides it for 30 days. Dismissal is stored in localStorage
  `prestij:wheel` keyed by the config signature.
- **The wheel itself.** An SVG wheel (slices in the four tones, labels readable in tr/en/ar and mirrored for
  RTL where it matters, PRESTİJ mark in the centre, pointer), spun with a CSS transform transition (~4.5 s,
  ease-out) to the server-chosen slice. With reduced motion: no spin, a short fade to the result. A
  CSS-only celebration (no library), skipped with reduced motion. Native `<dialog>` with focus trap,
  Escape, focus return, `scrollbar-gutter: stable` (no CLS), aria-live result text.
- **KVKK and terms.** The dialog shows "Çarkı çevirerek <Kampanya Koşulları>'nı kabul etmiş olursun" linking
  to a new legal page "Hediye Çarkı Kampanya Koşulları" (draft, marked for the lawyer, tr/en/ar), and the
  KVKK notice link. The wheel collects no e-mail itself (sign-up collects it with the existing consents). The
  spin row stores no personal data except a salted IP hash. A daily job purges unclaimed spins older than
  30 days. `anonymizeAccount` clears `wheel_spins.user_id` and deactivates the user's unused wheel coupons.
- **E-mails.** `wheel_prize` (sent at claim: prize, code, expiry, link to the shop; transactional: the user
  asked for it) and `wheel_prize_reminder` (job `wheel.remind`, ~24 h before expiry, only if unused, **only to
  users with a confirmed newsletter subscription**; flag it for the lawyer). Both editable/switchable in the
  panel like other templates, with tr/en/ar texts.
- **Panel: Pazarlama → Hediye Çarkı** (`/panel/hediye-carki`, editor+), with tabs:
  - **Genel bakış:** KPIs for a period (7/30/90 days, Istanbul days): spins, claims, claim rate, sign-ups
    that came through the wheel, orders paid with a wheel code, revenue (REVENUE_STATUSES), a daily chart,
    and a per-slice table (spins, claims, orders, revenue, actual vs configured share).
  - **Ayarlar:** on/off, schedule (start/end, Istanbul time), audience, showToBusiness, slices repeater,
    validity and hold, triggers, texts (title, subtitle, teaser text, button texts, LocalizedText, with
    defaults from the messages), "Yeni tur başlat" (confirm dialog), and a live preview (the same wheel
    component in preview mode, probability % per slice, tr/en/ar switch).
  - **Kazananlar:** paginated list (status: aktif / kullanıldı / süresi doldu / bekliyor), prize, code,
    dates, linked order; e-mail masked for editors, full for admins; CSV export (admin, audited).
  - Config is the settings key `giftWheel` (saved with `settingsActionOptions('giftWheel')` overridden to
    `minRole: 'editor'`), dates stored as ISO strings. A layout-level cached reader must expose only display
    data (never weights).
- **Defaults.** In code (`settingsSchemas`): `enabled: false` (safe for a fresh production database). The
  content script (§6) stores a live row for the client's local database with `enabled: true` and six default
  slices: %5 (weight 35), %10 (25), Ücretsiz kargo (20), %15 (10), 50 TL indirim with 300 TL minimum (7),
  %20 with 750 TL minimum (3). The report tells the client to review slices before launch.

### 1.2 Video

- **What the owner can do (panel, no code):** upload MP4 (H.264/AAC) or WebM videos to the media library
  (max 50 MB, max 90 s); add up to 3 videos to a product's gallery (Görseller tab → "Video ekle"), each with
  a cover image and an "Otomatik oynat (sessiz)" switch; pick an uploaded video for the hero background; add
  a new "Video" section to any page. MOV and HEVC are refused with a clear hint ("MP4 (H.264) olarak dışa
  aktarın").
- **Data model.** `media` gets `kind` (`image` | `video`, default `image`), `duration_ms`, `poster_id`
  (FK media, ON DELETE SET NULL). A video row: `mime` video/mp4|video/webm, `url`, width/height from the
  browser (validated), `variants` null, blur/dominant copied from the poster. `product_media` gets
  `autoplay boolean not null default false`. JSON keys referencing videos end in `MediaId`
  (`videoMediaId`) so usage tracking and delete protection see them; poster usage gets its own usage kind.
- **Poster.** The browser captures a frame (canvas → JPEG at ~1 s) and uploads it through the image
  pipeline first; the video row links it via `poster_id`. The owner can replace it in the media detail
  drawer. No ffmpeg.
- **Upload transport (also fixes a go-live bug for images).** Vercel rejects request bodies over ~4.5 MB,
  and today's clients send up to 10 × 15 MB in one multipart body. New flow for **every** upload, one file per
  request, directly to storage:
  1. `POST /panel/api/media/uploads` (editor+, same-origin) with `{ name, size, type, kind, folder }` →
     validates → returns `{ ticket, upload: { url, method: 'PUT', headers } }`. The ticket is
     `signToken('media-upload', {...}, 7200)`. Staging key `_incoming/<random>/<safe-name>`.
     Supabase: `POST {SUPABASE_URL}/storage/v1/object/upload/sign/{bucket}/{key}` (server-side, service key),
     browser PUTs to the returned signed URL. Local driver: `PUT /panel/api/media/uploads/local?ticket=…`
     streams the body to disk (no buffering of the whole file).
  2. Browser PUTs the file with progress.
  3. `POST /panel/api/media/uploads/complete` with `{ ticket, meta: { width, height, durationMs }, posterId?,
     alt? }` → re-checks size (stat) and type (head bytes + sniff), then: image → read original, process
     (encodes run **sequentially**, not in parallel), store variants, delete staging; video → move to the
     final key, create the row. Mismatch → delete staging, Turkish error.
  The old `POST /panel/api/media` route stays working for small single files (back-compat), but both
  clients (`useUploadQueue` and the duplicate in `MediaPickerDialog`) switch to the new flow through **one**
  shared upload queue. Also fix `SupabaseStorage.headers()` (an `sb_secret_…` key goes only in `apikey`;
  `Authorization: Bearer` only for legacy JWT keys) and fail fast with a clear error when `process.env.VERCEL`
  is set and the storage driver is `local`. Add `_incoming/` cleanup of tickets older than 24 h to a daily job.
- **Serving.** `src/app/uploads/[...key]/route.ts` serves mp4/webm with HTTP Range (206/416,
  `Accept-Ranges: bytes`), streams instead of reading whole files, and answers HEAD without a body.
- **Kind safety everywhere.** Pickers take `kind` (default `image`); `listMedia`/`listMediaAction` filter by
  kind; server-side reference checks verify kinds (an image field never accepts a video). Every image
  consumer of `product_media`/`media` filters to images: card image and hover, cart thumbnails and order
  snapshots, JSON-LD `image`, image sitemap, panel pickers/thumbnails, SEO panel, request e-mails, OG
  fallback, merchant feed. `<Img>` returns `null` for a video row (defensive).
- **Gallery.** The first item of every variant view is an image (save rule: position 0 must be an image;
  `imagesFor` moves the first image to the front if needed). A video slide shows the poster image; the
  `<video>` element is mounted only when its slide is active (`preload="none"` until then). Autoplay rows play
  muted, looped, `playsinline`, with a pause button; other rows show a play button and play with controls.
  Keyboard/swipe handlers ignore events coming from the video and its controls. Thumbnails get a play badge
  and duration; screen readers hear "Video".
- **Hero.** New `videoMediaId` (picker) next to the legacy `videoUrl` (kept; `videoMediaId` wins). A client
  island attaches the video source only after load + idle, never with reduced motion or `saveData`/2g/3g, and
  fades it in on `playing`; the responsive poster `<Img>` stays the LCP; no `poster=` attribute pointing at the
  largest WebP.
- **Video section** (new section type `video`): eyebrow/title/text (LocalizedText), `videoMediaId`
  (required), `posterImageId` (optional, else the video's poster), `layout` (`wide` | `split`), `playback`
  (`autoplay_muted` | `click_to_play`), audience/schedule like every section. The source is attached only
  when the section scrolls into view.
- **SEO.** VideoObject for product videos (name, description, thumbnailUrl, uploadDate, contentUrl,
  duration, inLanguage) printed so the SEO audit stays at **0 errors, 0 warnings** (no duplicate-type
  warning: use one document per page, e.g. an `@graph`, or attach via `subjectOf`, and add a VideoObject rule
  to `src/lib/seo/audit/jsonld.ts`). Video sitemap entries for product videos (XML-escaped). Merchant feed
  stays images-only.

## 2. Copy rules

DAY5-SEO §2 applies. Wheel copy must be honest: no "herkes kazanıyor!!!" hype, no fake scarcity, no fake
timers (every countdown is a real expiry). Prize texts state conditions (minimum basket, validity) where they
apply. tr is primary; en and ar natural and complete; Arabic punctuation, Western digits.

## 3. Areas and file ownership

| Area | Owns (create/edit) |
|---|---|
| CORE | migration `drizzle/0005_day6_*.sql` + `src/db/schema/*` changes (coupons.source/user_id + indexes, `wheel_spins`, media.kind/duration_ms/poster_id, product_media.autoplay, an index on orders.coupon_id); `src/lib/settings/types.ts` (`giftWheel` schema + defaults) and the other compile-enforced places for a settings key (`src/lib/panel/settings/schemas.ts` SETTINGS_INPUTS/SettingsInputsFit, SAVED_MESSAGE, SettingsOverview summarize, `scripts/seed-data/site.ts` buildSettings); `src/lib/cache-tags.ts` (`wheel`); `src/lib/media/types.ts` (`MediaKind`, optional `kind`), `src/lib/data/media.ts` (columns + `imageOnly`); `src/lib/wheel/types.ts` (shared types + zod); `src/lib/coupons/*` + cart coupon types for `userId`/`source`/`not_owner`/`endsAt` (engine stays pure); messages skeleton (`wheel` group and `product.video*` keys with final Turkish texts, en/ar complete) + UI-strings group label; `scripts/content-day6.ts` skeleton + registered steps; `docs/DAY6-CORE-API.md` |
| WHEEL-SERVER | `src/lib/wheel/**` except `types.ts` (pure pick/eligibility/code/countdown modules + DB services spin/bind/claim/issue/auto-apply helper/purge), `src/app/api/wheel/**` (spin route), wheel server actions (`src/lib/wheel/actions.ts`: `loadWheel`, `claimWheel`), the hooks in `src/lib/account/auth-actions.ts`, `src/lib/account/events.ts`, `src/lib/account/sign-in-effects.ts`, `src/app/[locale]/hesap/dogrula/actions.ts`, `src/lib/account/service.ts` (anonymize), e-mail templates `src/lib/email/templates/wheel.ts` (+ one import line, shared), jobs `src/lib/wheel/jobs.ts` (+ one import line in `src/lib/cron/jobs.ts`, shared), newsletter source `wheel` |
| WHEEL-CART | `src/lib/cart/**` (applyCouponCode refactor into a tx helper, auto-apply on addItem, CouponState/CartView `endsAt`+`source`), `src/components/cart/**` (CouponForm countdown, drawer prize row), `src/lib/panel/marketing/**` + `src/components/panel/marketing/**` + `src/app/panel/(dashboard)/kuponlar/**` (manual-only list, read-only wheel coupons) |
| WHEEL-UI | `src/components/store/wheel/**` (server wrapper, island, teaser/reminder chip, lazy dialog, SVG wheel shared with the panel preview, celebration), its single mount line in `src/app/[locale]/layout.tsx` (shared), the wheel banner on `src/app/[locale]/hesap/kayit/**` and `hesap/giris/**`, the prize card on `src/app/[locale]/hesap/page.tsx`, `src/lib/data/wheel.ts` (cached display-only teaser reader) |
| WHEEL-PANEL | `src/app/panel/(dashboard)/hediye-carki/**`, `src/components/panel/gift-wheel/**`, `src/lib/panel/gift-wheel/**` (stats/winners queries, export), `src/app/panel/api/hediye-carki/**`, the nav entry (shared: one block in `src/components/panel/nav-config.ts`), audit labels (shared: `src/components/panel/audit/labels.ts`) |
| MEDIA-UPLOAD | `src/lib/media/storage.ts`, `src/lib/panel/media/**` (sniff incl. a small mp4/webm parser, service video branch, direct-upload tickets, kind-aware list/usage/ensureMediaExist), `src/app/panel/api/media/**`, `src/app/uploads/**`, `src/components/panel/media/**`, `src/components/panel/form/MediaPicker*.tsx` (kind prop, video tiles), shared `MediaThumb`, `_incoming/` cleanup job (+ one import line, shared), `.env.example` + README env table (shared) |
| VIDEO-STORE | product save/editor (`src/lib/panel/products/**`, `src/components/panel/products/**`), catalog loaders and every image consumer filter (`src/lib/data/catalog.ts`, `src/lib/cart/load.ts` image join only — coordinate with WHEEL-CART via report, `src/lib/requests/**`, `src/lib/panel/pickers.ts`, `src/lib/panel/seo/**` queries, `src/lib/orders/place.ts` snapshot image only), `src/components/store/ProductGallery.tsx`, `src/components/store/product-heading.ts`, product page (`src/app/[locale]/urunler/[slug]/page.tsx`), `src/lib/media/Img.tsx` (video guard), sections (`src/components/sections/**`: Hero video island, new `video` section, field-spec `accept`, registry), `src/components/panel/sections/SectionFieldsEditor.tsx`, `src/lib/panel/content/pages-service.ts` (kind checks), SEO (`src/lib/seo/structured-data.ts` VideoObject, `src/components/seo/ProductStructuredData.tsx`, `src/lib/data/sitemap.ts`, `src/lib/seo/sitemap-entries.ts`, `src/lib/seo/audit/jsonld.ts` rule) |
| CONTENT | `scripts/content-day6.ts` step functions (`giftWheelConfig`, `wheelTerms`, `launchChecklist`) and `scripts/seed-data/**` definitions for them; the legal page + document "Hediye Çarkı Kampanya Koşulları" (tr/en/ar draft); the "Yayına çıkınca" checklist items in `src/lib/panel/seo/launch.ts` (Supabase storage keys + test upload on the live site, review wheel slices, lawyer review of wheel terms) |

Tests: each area adds its own files under `tests/unit/day6-<area>-*.test.ts` and
`tests/db/day6-<area>-*.test.ts`. If an existing test breaks because of an intended change, fix that test
in the smallest way and list it in your report. New fields in shared types are optional where tests build
literals (`MediaLike`, `GalleryImage`, `CouponData`, product media).

## 4. CORE (runs first, alone)

1. **Schema + migration** (additive only): the tables/columns of §1 and §3, with indexes:
   `coupons(source)`, `coupons(user_id)`, `orders(coupon_id)`, `wheel_spins(user_id)`, a partial unique index
   on `wheel_spins(user_id, round)` where `user_id is not null and status in ('bound','claimed')`,
   `wheel_spins(created_at)`. `wheel_spins`: `id` identity, `round int`, `slice_key text`, `prize jsonb`
   (snapshot: type, value, label, minOrderTotal), `status text` (`spun` | `bound` | `claimed` | `expired`),
   `user_id` (FK user, ON DELETE SET NULL), `bound_via text` (`register` | `sign_in` | `signed_in`) null,
   `coupon_id` (FK coupons, ON DELETE SET NULL), `locale`, `ip_hash`, `page_path` (canonical tr path, ≤ 200,
   no query), `created_at`, `bound_at`, `claimed_at`. Generate with drizzle-kit (`--name day6_wheel_video`),
   review the SQL, apply with `npm run db:migrate`, pin it in a DB test like Day 5's. Before the migration,
   check that `prestij_backup_day6_start` exists (the lead creates it); stop if it does not.
2. **Settings `giftWheel`** with the fields of §1.1 (enabled, startsAt/endsAt ISO|null, audience,
   showToBusiness, slices, validityHours, holdDays, teaserDelaySeconds, autoOpenSeconds, exitIntent,
   autoOpenCooldownDays, round, texts {title, subtitle, teaser, claimCta, registerCta, signInCta} as optional
   LocalizedText overrides, reminderEnabled) in all five compile-enforced places; panel input schema with
   Turkish messages enforcing every range rule of §1.1.
3. **Shared types/APIs** (signatures + minimal bodies, documented): `src/lib/wheel/types.ts`; coupon
   `userId`/`source` in `CouponData` and `couponColumns`, `not_owner` reason end to end (eligibility input
   widened to the customer's user id, error mapping, cart message keys tr/en/ar, tests/unit/helpers);
   `CouponState`/`CartView.coupon` gain optional `endsAt` (ISO) and `source`; `MediaKind`, `MediaLike.kind?`,
   `mediaColumns` gain `kind`/`mime`, `imageOnly` SQL helper and a pure `isVideoMedia()`; export
   `COUNTED_STATUSES`; `TAGS.wheel`.
4. **Messages:** the `wheel` group (all storefront texts for the teaser, dialog, result, claim, banners,
   reminder chip, cart countdown, account card, errors) and `product.video`, `product.playVideo`,
   `product.pauseVideo`, final in tr/en/ar; UI-strings group label "Hediye çarkı".
5. **Content script skeleton** `scripts/content-day6.ts` (copy `content-day5.ts`: flags, one transaction per
   step, `--dry-run`, refuses production, idempotent) with empty owner steps `giftWheelConfig`, `wheelTerms`,
   `launchChecklist`.
6. **Docs:** `docs/DAY6-CORE-API.md` (every new export, migration name, settings defaults, rules).
7. Gates for your own work; the storefront must render exactly as before (no visible change from CORE).

## 5. Build areas (parallel after CORE)

### 5.1 WHEEL-SERVER
Spin route `POST /api/wheel/spin` (Route Handler: `isSameOriginRequest`, honeypot, durable limits, locale
validated, reads config **uncached**, checks enabled/schedule/audience/staff/business, returns
`{ sliceIndex, prize: {label, summary}, holdUntil, claim: 'claim' | 'register' }`, sets `prestij_wheel`);
idempotent for a visitor with a live spin. `loadWheel({ locale })` server action (lazy, called by the
island): eligibility, existing spin/claim state, active prize `{ code, label, endsAt }` for the reminder
chip, the slices for display (labels/tones only, never weights) and texts. `claimWheel()` for signed-in
users. Services take `tx` and no Next APIs; pure modules for pick/eligibility/code/countdown. Hooks per §1.1.
E-mails and jobs per §1.1 (`wheel.remind` in group `daily`, `wheel.purge` daily). After a claim that changes
the cart, return the new cart view so the island can `publishCartView`. Unit + DB tests for: weighting
(statistical sanity with a seeded RNG injection), every eligibility rule, idempotent spin, one claim per
account per round, register-bind + verify-issue across "devices" (no cookie at verification), sign-in claim,
existing-e-mail register never binds, staff/business refusal, purge, anonymize.

### 5.2 WHEEL-CART
`applyCouponToCart(tx, …)` factored out of `applyCouponCode`; auto-apply rules of §1.1 (after claim; on
`addItem` when no code; never overwrite; keep for later on no-benefit); `getBestWheelCode(tx, userId, now)`
(provided by WHEEL-SERVER's module if it exists, else coordinate via report: you own the cart side only);
countdown UI in `CouponForm` and a prize row in `CartDrawerSheet` (hydration-safe countdown via
`useSyncExternalStore` ticking once per second only while visible, never `Date.now()` in render); panel
coupons list `source='manual'` + read-only wheel coupons. Tests: owner check in cart and placeOrder, auto-apply
does not overwrite a typed code, no-benefit kept, cartRevision behaviour documented.

### 5.3 WHEEL-UI
Server wrapper (async, reads `getActiveWheelTeaser()` — `'use cache'` + `cacheTag(TAGS.wheel)` + schedule-aware
cacheLife like `getActiveAnnouncements`, display-only, props < 0.5 KB) mounted once in the locale layout after
`CartDrawer`; client island that renders nothing on the server and first client render, decides by
`useViewer()` + localStorage + route rules (read `window.location` at interaction time, canonicalize with
`localizePath('tr', …)`), lazy-loads the dialog (`React.lazy(import().catch(...))`, prefetched on idle or on
teaser hover/focus). The SVG wheel component is pure and shared with the panel preview. Countdown chip,
account card, register/sign-in banners. Budgets: first-load JS of `/tr` grows ≤ 1.5 KB gz; CLS stays 0 on TR
pages; LCP not worse than the Day 5 baseline (§8). RTL and reduced motion verified. Tests: route-eligibility
rules, dismissal signature logic, countdown formatting (tr/en/ar), wheel geometry (slice angles, landing
rotation for a given index).

### 5.4 WHEEL-PANEL
Pages/tabs of §1.1 with the existing panel kit (PageHeader, tabs like NewsletterTabs, SettingsForm/Card,
Repeater, LocalizedInput, ScheduleInput, KpiCard, a SalesChart copy generalised for spins/claims/orders,
tableClass lists, FilterTabs, EmptyState). Preview uses WHEEL-UI's pure wheel component (import it; if it is
not ready yet, render a placeholder and note it). Stats queries uncached with Istanbul day boundaries in SQL.
Audit labels for the settings key and the winners export. Tests: stats queries on throwaway rows in a
rollback, input schema rules, masking.

### 5.5 MEDIA-UPLOAD
Everything in §1.2 "Upload transport", "Serving", the library/picker side of "Kind safety" and the poster
capture (client `readVideoMeta(file)`: object URL → `loadedmetadata` → seek ~1 s → canvas JPEG; refuse when
`videoWidth` is 0 with the HEVC hint), video tiles (poster + play badge + duration) in library, picker and
detail drawer (`<video controls>`, duration, change poster), kind filter tabs (Tümü / Fotoğraflar /
Videolar). Sniffing: video before sharp; brand whitelist (isom, iso2–iso6, mp41, mp42, avc1, dash, M4V);
refuse `qt  `; avif/heic/mif1 go to the image path; WebM by EBML + DocType `webm`; mp4 duration from `mvhd`.
Limits in `MEDIA_UPLOAD.video` (50 MB, 90 s). Tests: sniff fixtures, Range parsing (206/416/HEAD), ticket
signing/expiry/tamper, Supabase request shapes with a fake fetch (sign, PUT target, stat, move, delete, the
header fix), local direct upload end to end in a temp dir, kind filters, poster usage protection.

### 5.6 VIDEO-STORE
Everything in §1.2 "Kind safety" (consumers), "Gallery", "Hero", "Video section", "SEO", plus the product
editor (MediaTab "Video ekle", video rows with poster thumb, duration, autoplay switch, no role select, max 3,
first-item rule with a Turkish error; VariantsTab image choices images only; header cover first image) and
`product_media.autoplay` end to end (state, schema, diff, duplicate, audit). Tests: image-only filters for
every consumer listed in `$SCRATCH/day6/map/gallery.md`, gallery ordering rule, VideoObject builder and audit
rule, sitemap video XML escaping, section schema/field specs, save-time kind rules.

### 5.7 CONTENT
`giftWheelConfig` (insert the live settings row of §1.1 "Defaults" only if no `giftWheel` row exists),
`wheelTerms` (the legal document + page, draft text in tr/en/ar covering: organiser, period, who can join,
one prize per person per round, prize types and conditions, validity, no cash value, not transferable,
combination with other offers, cancellation/abuse, personal data (link to KVKK), changes to the campaign;
marked "taslak — avukat onayı bekliyor"), `launchChecklist` items (§3). Same content in `scripts/seed-data/**`.
Dry-run only while building; INTEGRATE runs it for real.

## 6. Content script rules (`scripts/content-day6.ts`)

Same as DAY5-SEO §6 (insert only what is missing; update only values still equal to the previous seeded
default; skip and report client edits; idempotent; one transaction per step; `--dry-run`; refuses
production). A DB test per step (apply twice in a rollback, the second report is empty).

## 7. Integration, review, fix, final

- **INTEGRATE:** merge all areas; run every gate; `content-day6.ts --dry-run` then for real; isolated build
  `.next/build-int6` served on its port with `NEXT_PUBLIC_SITE_URL`/`BETTER_AUTH_URL` =
  `http://check.localhost:<port>`; SEO audit; an end-to-end wheel run in headless Chromium on the isolated
  build with throwaway `@test.local` users: guest spin → register → verify (link from the e-mail outbox row,
  opened in a fresh browser context = another device) → coupon issued → auto-applied in the cart →
  countdown visible; signed-in claim; second spin refused; staff hidden; mobile never auto-opens. A video
  run: upload a synthetic clip through the new direct flow (local driver), add it to a throwaway product, see
  it play in the gallery (Range 206), then delete everything. Fix cross-area breakage. Clean up all test data.
- **REVIEW** (separate workflow, 4 lenses, read-only, then adversarial verification of each finding):
  security and abuse (spin/claim/coupon/upload); correctness and data integrity; performance, UX,
  accessibility, RTL and copy; SEO and panel usability.
- **FIX:** fix every confirmed finding (high and medium always; low unless it needs a product decision).
- **FINAL:** all gates; content script idempotency; isolated build + SEO audit 0 errors/0 warnings; the
  storefront `.meta` S/P set identical to Day 5 (`$SCRATCH/final-r2/meta.lst`); perf budgets; DB diff against
  `$SCRATCH/day6/start.json` contains only the intended changes (migration, the giftWheel settings row, the
  terms page/document, checklist content) and no test leftovers; restore `tsconfig.json`/`next-env.d.ts`;
  stop every server you started; full report.

## 8. Gates

`npm run typecheck` · `npm run lint` (exit 0; the 23 pre-existing warnings may remain, 0 warnings in touched
files) · `npx eslint src scripts tests --quiet` (empty) · `npm test` · `npm run test:db` (DB fingerprint
before = after, via `$SCRATCH/fix/snap.mjs`) · `next build` with `NEXT_DIST_DIR` (§9) · `npx tsx
scripts/seo-audit.ts` against the isolated build (0 errors, 0 warnings). Perf baseline (Day 5, throttled
mobile): LCP /tr ≈ 2.2 s, PDP ≈ 2.1–2.3 s, category ≈ 1.9 s, /ar ≈ 2.4–2.5 s; CLS 0 on TR pages; first-load
JS /tr 218,314 B gz. Measure with `$SCRATCH/perf/jsweight.mjs` and `$SCRATCH/polish/cdp/s-lcp.mjs`. Build
areas may skip the full build; they must leave their own files free of type and lint errors (other areas'
in-progress files may show errors while everyone works in parallel — don't fix those, mention them).

## 9. Ports and dist dirs

| Stage | Port | `NEXT_DIST_DIR` | CDP port |
|---|---|---|---|
| CORE | 3701 | `.next/dev-core6` | — |
| WHEEL-SERVER | 3710 | `.next/dev-wserver` | — |
| WHEEL-CART | 3715 | `.next/dev-wcart` | — |
| WHEEL-UI | 3720 | `.next/dev-wui` | 9720 |
| WHEEL-PANEL | 3730 | `.next/dev-wpanel` | 9730 |
| MEDIA-UPLOAD | 3740 | `.next/dev-media` | 9740 |
| VIDEO-STORE | 3750 | `.next/dev-video` | 9750 |
| CONTENT | 3760 | `.next/dev-content6` | — |
| INTEGRATE | 3770 | `.next/build-int6` | 9770 |
| reviewers | 3780–3783 | `.next/dev-review6-<n>` | 9780–9783 |
| FIX | 3785 | `.next/build-fix6` | 9785 |
| FINAL | 3790 | `.next/build-final6` | 9790 |

Use `http://check.localhost:<port>` as the origin so the client's localhost:3000 cookies are never touched
(connect to `127.0.0.1:<port>`; `curl --resolve check.localhost:<port>:127.0.0.1 …`; the audit takes
`--connect http://127.0.0.1:<port>`). Dev servers (`next dev`) with your own `NEXT_DIST_DIR` are fine for
building; delete your dist dir and stop only your own process tree before you finish (never the process on
port 3000).

## 10. Report (every agent)

Write `$SCRATCH/day6/results/<area>.md` and return the structured summary you are asked for: what you did,
files changed, tests added, gates run with results, anything left open or needing a product decision, and
exact notes for the integrator (changes you need in files you don't own).
