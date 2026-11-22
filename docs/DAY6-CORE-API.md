# Day 6 core API (gift wheel + video: schema, settings, coupons, shared types, media kinds)

What CORE ships for the seven day-6 builders. Read `docs/DAY6-WHEEL-VIDEO.md` (the contract) first; this file
documents the code behind its §4 plus the shared stubs the lead asked for. **pure** = no DB, no Next
request APIs: safe in client components and unit tests. If a signature here disagrees with the code, the
code wins: say so in your report. Everything below was exercised on 2026-11-12 (see §10).

## 0. File map

| File | What | Owner after CORE |
|---|---|---|
| `drizzle/0005_day6_wheel_video.sql` (+ `meta/0005_snapshot.json`, journal) | the day's only migration (**applied**) | nobody: builders never change the schema |
| `src/db/schema/wheel.ts` (new, exported from `index.ts`) | `wheel_spins`, `WheelSpinStatus`, `WheelBoundVia`, `WheelPrizeSnapshot` | — |
| `src/db/schema/{commerce,site,catalog}.ts` | `coupons.source/user_id` (+ `COUPON_SOURCES`, `CouponSource`), `orders(coupon_id)` index, `media.kind/duration_ms/poster_id`, `product_media.autoplay` | — |
| `src/lib/settings/types.ts` | `giftWheel` schema + defaults, `WHEEL_*` constants, `GIFT_WHEEL_DEFAULT_SLICES` | — |
| `src/lib/panel/settings/schemas.ts` | `giftWheelSettingsInput`, `giftWheelSliceInput` (+ registry, `SettingsInputsFit`) | WHEEL-PANEL may refine messages (not the shape) |
| `src/lib/panel/settings/service.ts` | `SAVED_MESSAGE.giftWheel`, extra tag `wheel` for the key | — |
| `src/components/panel/settings/SettingsOverview.tsx` | `summarize().giftWheel` | — |
| `scripts/seed-data/site.ts` | `buildSettings().giftWheel = {}` (code defaults) | CONTENT (may store the live value there) |
| `src/lib/cache-tags.ts` | `TAGS.wheel` | — |
| `src/lib/coupons/{eligibility,validate}.ts` | `isForeignCoupon`, owner rule, `couponColumns` (exported) with `userId`/`source` | — |
| `src/lib/cart/types.ts`, `compute.ts`, `view.ts` | `CouponData.userId/source`, `CouponInvalidReason "not_owner"`, `CouponState`/`CartView.coupon` `endsAt`/`source` | WHEEL-CART |
| `src/lib/cart/mutations.ts` | `applyCouponToCart` (tx helper), `applyCouponCode` on top of it | WHEEL-CART |
| `src/lib/b2b/queries.ts` | `COUNTED_ORDER_STATUSES`, `COUNTED_STATUSES` exported | — |
| `src/lib/wheel/types.ts` (pure) | every shared wheel type, zod schema, constant and display helper | **CORE only** (request changes) |
| `src/lib/wheel/actions.ts` (`"use server"`) | `loadWheel`, `claimWheel` (final signatures, stub bodies) | WHEEL-SERVER |
| `src/app/api/wheel/spin/route.ts` | `POST` (final signature, stub: 503) | WHEEL-SERVER |
| `src/lib/wheel/prize-coupons.ts` | `findActiveWheelCoupon` (working) | WHEEL-SERVER |
| `src/components/store/wheel/WheelGraphic.tsx`, `wheel-geometry.ts` (pure) | minimal SVG wheel + geometry | WHEEL-UI (WHEEL-PANEL imports the graphic) |
| `src/lib/media/types.ts` (pure) | `MEDIA_KINDS`, `MediaKind`, `MediaLike.kind?/mime?`, `isVideoMedia`, `toMediaLike` | — |
| `src/lib/data/media.ts` | `mediaColumns` + `kind`/`mime`, `imageOnly()` | — |
| `src/lib/panel/media/{types,queries,actions}.ts` | `PanelMedia.kind/durationMs/posterId/poster`, `MediaKindFilter`, kind filter in `listMedia`/`listMediaAction`, posters in `getPanelMedia` | MEDIA-UPLOAD |
| `src/components/panel/form/MediaPicker.tsx`, `MediaPickerDialog.tsx` | `kind` prop (default `"image"`), video tiles via `MediaThumb` | MEDIA-UPLOAD |
| `src/components/panel/media/MediaThumb.tsx` (pure) | thumbnail: image, or video cover + play badge + duration | MEDIA-UPLOAD |
| `src/i18n/messages/{tr,en,ar}.ts` | `wheel.*`, `product.video/playVideo/pauseVideo`, `cart.errors.coupon_not_owner` | areas may add keys in their own sub-groups via report |
| `src/lib/panel/ui-strings/catalog.ts` | group label `wheel: "Hediye çarkı"` + sub-group labels | — |
| `scripts/content-day6.ts` | skeleton: `wheelTerms`, `giftWheelConfig`, `launchChecklist` (empty) | CONTENT (one function each) |
| `tests/unit/day6-core-{settings,coupons,wheel,media}.test.ts`, `tests/db/day6-core-api.test.ts` | CORE's tests (40 unit + 21 DB) | — |

## 1. Schema: migration `0005_day6_wheel_video` (applied)

Generated with `npx drizzle-kit generate --name day6_wheel_video` (non-interactive, nothing hand-edited),
reviewed (additive only: 1 `CREATE TABLE`, 6 `ADD COLUMN`, 4 FKs, 8 indexes, 4 `ADD CONSTRAINT … CHECK`),
applied with `npm run db:migrate` (row 6 of `drizzle.__drizzle_migrations`, `created_at` = journal `when`
1794439995288). A fresh `drizzle-kit generate` reports "No schema changes". `tests/db/day6-core-api.test.ts`
pins the hash and every statement.

```sql
CREATE TABLE "wheel_spins" (id identity PK, round int NOT NULL, slice_key text NOT NULL, prize jsonb NOT NULL,
  status text DEFAULT 'spun' NOT NULL, user_id text, bound_via text, coupon_id integer, locale text DEFAULT 'tr' NOT NULL,
  ip_hash text, page_path text, created_at timestamptz DEFAULT now() NOT NULL, bound_at timestamptz, claimed_at timestamptz,
  reminded_at timestamptz,
  CHECK status in ('spun','bound','claimed','expired'), CHECK bound_via is null or in ('register','sign_in','signed_in'),
  CHECK page_path is null or char_length(page_path) <= 200);
ALTER TABLE media ADD kind text DEFAULT 'image' NOT NULL, duration_ms integer, poster_id integer;
ALTER TABLE product_media ADD autoplay boolean DEFAULT false NOT NULL;
ALTER TABLE coupons ADD source text DEFAULT 'manual' NOT NULL, user_id text;
FK wheel_spins.user_id → user ON DELETE SET NULL;  wheel_spins.coupon_id → coupons ON DELETE SET NULL;
FK media.poster_id → media ON DELETE SET NULL;      coupons.user_id → user ON DELETE CASCADE;
INDEX wheel_spins(user_id), wheel_spins(created_at), media(poster_id), coupons(source), coupons(user_id), orders(coupon_id);
UNIQUE wheel_spins(user_id, round) WHERE user_id IS NOT NULL AND status IN ('bound','claimed')   -- wheel_spins_user_round_unique
UNIQUE wheel_spins(coupon_id) WHERE coupon_id IS NOT NULL                                        -- wheel_spins_coupon_unique
CHECK media_kind_check (kind in ('image','video'));  media_kind_mime_check ((kind = 'video') = (mime like 'video/%'));
CHECK coupons_source_check (source in ('manual','wheel'));  coupons_wheel_owner_check (source <> 'wheel' or user_id is not null);
```

```ts
// src/db/schema/wheel.ts
WHEEL_SPIN_STATUSES = ["spun", "bound", "claimed", "expired"]; type WheelSpinStatus
WHEEL_BOUND_VIA = ["register", "sign_in", "signed_in"];       type WheelBoundVia
type WheelPrizeSnapshot = { type: CouponType; value: number; label: LocalizedText; minOrderTotal: Kurus }
wheelSpins  // id, round, sliceKey, prize, status, userId, boundVia, couponId, locale, ipHash, pagePath, createdAt, boundAt, claimedAt, remindedAt
// src/db/schema/commerce.ts
COUPON_SOURCES = ["manual", "wheel"]; type CouponSource; coupons.source, coupons.userId
// src/db/schema/site.ts / catalog.ts
media.kind ($type<MediaKind>), media.durationMs, media.posterId;  productMedia.autoplay
```
Rules the database now enforces (and the tests prove):
- **kind ⇔ mime.** A video row must have `kind = 'video'` **and** a `video/*` mime; an image row the opposite. Set both.
  Image consumers filter on `kind` (`imageOnly()`, §6).
- **A wheel prize always has an owner** (`coupons_wheel_owner_check`), and goes away with the account (`ON DELETE
  CASCADE`): an owner-less wheel code would be usable by anyone who sees it. Anonymization keeps the user row,
  so prizes survive it unless WHEEL-SERVER deactivates them (contract: it does).
- **One prize per account per round:** at most one `bound` or `claimed` spin per `(user_id, round)`. `spun` and
  `expired` rows do not count. Insert/update to `bound` and catch `23505` + `wheel_spins_user_round_unique`.
- **A prize coupon belongs to one spin** (`wheel_spins_coupon_unique`).
- Spin rows survive account deletion (`user_id` → null) and coupon deletion (`coupon_id` → null) for statistics.
- `remindedAt` (extra column, not in the contract list): set by the `wheel.remind` job when it queues the reminder,
  so a prize is reminded at most once (the e-mail dedupe key stays the hard guarantee).
- Existing rows: all 52 media rows are `image`, coupons (none live) `manual`, product_media `autoplay = false`.

## 2. Settings `giftWheel` (`src/lib/settings/types.ts`)

```ts
getSettings("giftWheel")   // cached (tag settings); the storefront teaser reader is WHEEL-UI's (tag wheel)
readSettingsRow("giftWheel", tx) / parseSettings("giftWheel", value)   // uncached / pure
{
  enabled: false,                       // code default: off (safe for a fresh production DB)
  startsAt: null, endsAt: null,         // ISO instants with zone, or null; live while startsAt ≤ now < endsAt
  audience: "new_customers",            // | "everyone"
  showToBusiness: false,
  slices: GIFT_WHEEL_DEFAULT_SLICES,    // 4–8 (fresh copy per parse)
  validityHours: 72,                    // 24–720, from the claim (coupon issue)
  holdDays: 7,                          // 1–30, unclaimed spin kept (and the cookie's lifetime)
  teaserDelaySeconds: 6,                // 0–120
  autoOpenSeconds: 25,                  // 0–300 (0 = never), desktop only
  exitIntent: true,                     // desktop only
  autoOpenCooldownDays: 7,              // 1–90
  round: 1,                             // 1–1 000 000 ("Yeni tur başlat" increments it)
  texts: {},                            // { title?, subtitle?, teaser?, claimCta?, registerCta?, signInCta? }: LocalizedText overrides
  reminderEnabled: true,                // expiry reminder e-mail (newsletter-confirmed users only; lawyer to confirm)
}
type GiftWheelSlice = { key; label: { tr; en?; ar? }; type: "percent" | "fixed" | "free_shipping"; value: number;
                        minOrderTotal: number /* kuruş, 0 = none */; weight: number /* 1–1000 */; tone: "brand" | "gold" | "cream" | "ink" }
```
Default slices (`GIFT_WHEEL_DEFAULT_SLICES`, contract §1.1 "Defaults"; tr / en / ar labels):

| key | label (tr) | type / value | minimum | weight | tone |
|---|---|---|---|---|---|
| `indirim-5` | %5 indirim · 5% off · خصم 5% | percent 5 | — | 35 | cream |
| `indirim-10` | %10 indirim | percent 10 | — | 25 | brand |
| `ucretsiz-kargo` | Ücretsiz kargo · Free shipping · شحن مجاني | free_shipping 0 | — | 20 | gold |
| `indirim-15` | %15 indirim | percent 15 | — | 10 | ink |
| `indirim-50-tl` | 50 TL indirim · ₺50 off · خصم 50 ليرة | fixed 5000 | 30000 (300 TL) | 7 | cream |
| `indirim-20` | %20 indirim | percent 20 | 75000 (750 TL) | 3 | brand |

| Rule (`WHEEL_LIMITS`) | Storefront schema | Panel message (field path) |
|---|---|---|
| 4–8 slices | min/max | "Çarkta en az 4 dilim olmalı." / "…en fazla 8 dilim olabilir." (`slices`) |
| key `^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$`, unique | regex + unique | trimmed, lower-cased; `slices.<i>.key` |
| label tr 1–40, en/ar ≤ 40 | yes | `localizedTextOf({ max: 40 })` (`slices.<i>.label.tr`) |
| percent 1–50 · fixed ≥ 100 kuruş · free_shipping 0 | refine | "İndirim oranı 1 ile 50 arasında…", "İndirim tutarı en az 1 TL olmalı." (`slices.<i>.value`); fixed also takes a TL string ("50,00" → 5000); free shipping is stored as 0 |
| weight 1–1000 (a slice that can never land must not be shown) | yes | `slices.<i>.weight` |
| tone in the four | enum | `slices.<i>.tone` |
| end after start | **panel only** (no object-level refinement in the storefront schema: `parseSettings` repairs per top-level field) | "Bitiş zamanı başlangıçtan sonra olmalı." (`endsAt`) |
| dates | `z.iso.datetime({ offset: true })` | `dateTimeInput` (datetime-local = Istanbul, or ISO) → ISO string; "" → null |
| texts | optional LocalizedText | empty → undefined (dictionary default), "Önce Türkçe metni girin." when only en/ar; lengths title 80, subtitle 200, teaser 60, claimCta 40, registerCta 60, signInCta 60 |

Saving: `panelAction({ ...settingsActionOptions("giftWheel"), minRole: "editor" })` (contract §1.1). The options
return `tags: [TAGS.settings, TAGS.wheel]` for this key (other keys keep `[TAGS.settings]`) and the message
"Hediye çarkı ayarları kaydedildi.". A stored document with one broken field falls back for that field only
(e.g. a slice with weight 0 → the default slices, the rest kept). The live DB has **no** `giftWheel` row:
everything reads the code defaults (wheel off) until CONTENT's `giftWheelConfig` inserts the live row.
`readAllSettings` / `SettingsOverview` include the key (summary "Açık · 6 dilim · ödül 72 saat geçerli · 1. tur"
or "Kapalı"); there is no card on `/panel/ayarlar` (the wheel has its own page).

## 3. Coupons: owner, source, expiry (`src/lib/coupons/*`, `src/lib/cart/types.ts`)

```ts
type CouponData = { …; userId?: string | null; source?: CouponSource }   // optional: older literals stay valid
couponColumns   // exported from validate.ts; selects userId and source too (loadCoupon uses it)
isForeignCoupon(coupon: Pick<CouponData, "userId">, userId: string | null | undefined): boolean   // pure
couponEligibility(coupon, { lines, subtotal, customer: Pick<CustomerContext, "groupId"> & Partial<Pick<…, "userId">>, now })
type CouponInvalidReason = … | "not_owner"
type CouponState = { …; endsAt?: string /* ISO */; source?: CouponSource }
CartView["coupon"] = { …; endsAt?: string; source?: CouponSource }
```
- **Owner check first:** a coupon with `userId` fails with `not_owner` for every other customer (signed out
  included), before inactive/window/limits, with no eligible lines, so nothing about someone else's code leaks.
  `computeCart` passes the full customer already, so the cart, `/sepet` and **`placeOrder`** (recomputes with
  `ctx.customer`) all enforce it; a guest can never pay with a wheel code (`coupon_unavailable` at checkout).
- **Error mapping:** `applyCouponCode`/`applyCouponToCart` answer `coupon_not_found` for `not_owner` (existence not
  revealed; `COUPON_FAILURES` in actions.ts already counts it toward the guess limit). A code already on a cart
  that is not the viewer's shows `cart.errors.coupon_not_owner` ("…başka bir hesaba tanımlı…", tr/en/ar).
- For a foreign code the engine state carries `minOrderTotal: 0` and no `endsAt`/`source`.
- `endsAt` / `source` appear only when set (manual coupons without an end have no `endsAt`).
- `COUNTED_ORDER_STATUSES = ["paid","processing","shipped","delivered","awaiting_transfer"]` and
  `COUNTED_STATUSES` (the same as an SQL tuple: `status in ${COUNTED_STATUSES}`) from `@/lib/b2b/queries`
  (server-only): the "has a counted order" rule of the `new_customers` audience (by user id or lower(e-mail)).
- Wheel coupons stack like every coupon (current engine). A cancelled order releases the use (`restockOrder`:
  `used_count - 1`), so the prize is usable again until its `ends_at` (current behaviour, per contract).

## 4. Cart: `applyCouponToCart` (`src/lib/cart/mutations.ts`)

```ts
type ApplyCouponMode = "manual" | "auto"
type ApplyCouponToCartInput = { cartId: string | null; code: string; customer: CustomerContext; now: Date; mode: ApplyCouponMode;
                                locale?: Locale /* written to the cart; omitted = kept */; settings?: CommerceSettings /* else read with tx */ }
type ApplyCouponKeptReason = "no_cart" | "cart_has_code" | "already_applied" | "min_order" | "no_eligible_items" | "no_benefit"
type ApplyCouponToCartResult =
  | { status: "applied"; cartId: string; code: string; refreshCookie: boolean }
  | { status: "kept"; cartId: string | null; reason: ApplyCouponKeptReason }              // auto only
  | { status: "refused"; cartId: string | null; code: CartErrorCode; reason?: CouponInvalidReason; vars?: Record<string, number> }
applyCouponToCart(tx: DbExecutor, input: ApplyCouponToCartInput): Promise<ApplyCouponToCartResult>
applyCouponCode(cartId, { code }, ctx): Promise<CartMutationResult>   // unchanged behaviour: its own tx + "manual" + Rollback on refusal
```
- Runs **inside the caller's transaction**, locks the cart row first (`SELECT … FOR UPDATE`; lock order cart →
  order → variants → coupon), writes `carts.coupon_code` only on `"applied"`.
- **manual** = the old `applyCouponCode` body: replaces the cart's code when the new one is valid and lowers what
  the buyer pays; every other outcome is `"refused"` (codes as before: `coupon_empty`, `coupon_not_found`,
  `coupon_min_order` + `vars.amount`, `coupon_no_benefit`, …). Covered by `tests/db/orders.test.ts` (unchanged, green).
- **auto** (wheel prizes; contract §1.1 "Auto-apply"): never overwrites a code already on the cart (`cart_has_code`;
  the same code → `already_applied`), no live cart → `no_cart`, below the minimum / no eligible line / no benefit
  → `"kept"` (keep the prize, retry on the next `addItem`); expired / used up / inactive / another account's →
  `"refused"` (do not retry). Never leaves an invalid code on the cart.
- WHEEL-SERVER: call it right after issuing the prize, in the same tx, with the owner's customer context; WHEEL-CART:
  call it in `addItem` when the cart has no code and `findActiveWheelCoupon` returns one (that is the
  `getBestWheelCode(tx, userId, now)` of the contract: `(await findActiveWheelCoupon(tx, userId, now))?.code`).
- An auto-apply changes `cartRevision` (the coupon code is part of it): a checkout open meanwhile gets
  `cart_changed` once (safe; the buyer confirms again).

## 5. Gift wheel shared pieces

### 5.1 `src/lib/wheel/types.ts` (pure; CORE-owned)
```ts
// re-exported from settings/types: giftWheelSettings, giftWheelSlice, giftWheelTexts, GIFT_WHEEL_DEFAULT_SLICES, defaultGiftWheelSlices(),
//   WHEEL_AUDIENCES, WHEEL_LIMITS, WHEEL_PRIZE_TYPES, WHEEL_SLICE_KEY_PATTERN, WHEEL_TONES,
//   GiftWheelSlice, GiftWheelTextKey, WheelAudience, WheelPrizeType, WheelTone; from the schema: WheelBoundVia, WheelPrizeSnapshot, WheelSpinStatus
type GiftWheelSettings = z.infer<typeof giftWheelSettings>          // server only (weights)
WHEEL_COOKIE = "prestij_wheel"; WHEEL_SPIN_TOKEN_PURPOSE = "wheel-spin"     // signToken(purpose, { id }, holdDays * 86400)
WHEEL_STORAGE_KEY = "prestij:wheel"; WHEEL_NEVER_SHOW_DAYS = 30
WHEEL_RATE_LIMITS = { spinsPerIp: { limit: 3 /* 10 before D13, §13 */, windowMs: 24 h }, claimsPerIp: { limit: 3, windowMs: 24 h } }
WHEEL_CODE_PREFIX = "CARK-"; WHEEL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" (31); WHEEL_CODE_LENGTH = 6; WHEEL_CODE_PATTERN
WHEEL_PURGE_AFTER_DAYS = 30; WHEEL_HONEYPOT_FIELD = "website"
type WheelDisplaySlice = { key: string; label: string; tone: WheelTone }           // never the weight
wheelDisplaySlices(slices, locale): WheelDisplaySlice[]                            // labels localized (tr fallback)
wheelSliceShares(slices): number[]                                                 // % per slice, 1 decimal (panel preview)
wheelText(override: LocalizedText | null | undefined, locale, fallback: string): string
type WheelTeaser = { signature; startsAt: string | null; endsAt: string | null; audience; showToBusiness; teaserDelaySeconds;
                     autoOpenSeconds; exitIntent; autoOpenCooldownDays; teaserText: string | null }   // layout props, < 0.5 KB
WHEEL_ELIGIBILITY_REASONS / type WheelEligibilityReason = "eligible" | "disabled" | "not_started" | "ended" | "staff" | "business"
                     | "has_ordered" | "already_claimed" | "spin_limit" | "claim_limit" | "unavailable"
WHEEL_ERROR_CODES / type WheelErrorCode = every reason except "eligible" + "rate_limited" | "invalid_request" | "no_spin"
                     | "spin_expired" | "sign_in_required" | "network"      // each has wheel.errors.<code> in tr/en/ar
type WheelClaimMode = "claim" | "register"
type WheelPrizeView = { label: string; summary: string }                           // localized by the server
type WheelSpinView = { sliceIndex: number /* -1: slice removed since */; prize: WheelPrizeView; holdUntil: string; claim: WheelClaimMode }
type WheelActivePrize = { code: string; label: string; endsAt: string }
type WheelTexts = Record<GiftWheelTextKey, string>                                 // resolved (override or dictionary)
type WheelState = { eligible; reason; signedIn; spin: WheelSpinView | null; activePrize: WheelActivePrize | null;
                    slices: WheelDisplaySlice[]; texts: WheelTexts; links: { terms: string | null; privacy: string | null }; validityHours: number }
wheelSpinRequestSchema = z.object({ locale: z.enum(LOCALES), path?: string (≤ 2000), website?: string (honeypot) }); type WheelSpinRequest
type WheelSpinResponse = { ok: true; sliceIndex; prize: WheelPrizeView; holdUntil; claim; repeated: boolean }
                       | { ok: false; error: WheelErrorCode; message: string; retryAfterSeconds?: number }
type WheelClaimResult = { ok: true; prize: WheelActivePrize & { summary: string }; applied: boolean; cart?: CartView }
                      | { ok: false; error: WheelErrorCode; message: string }
type WheelGraphicProps = { slices; rotation?; spinDurationMs?; highlightIndex?; dir?: "ltr" | "rtl"; label?; centerLabel?; className? }
```
Notes: use **distinct** rate-limit keys for spins and claims (`wheel:ip:<ip>`, `wheel-claim:ip:<ip>`; the
contract wrote `wheel:ip` for both, but one key would mix the two counts). Dismissal/auto-open hints are keyed by
`WheelTeaser.signature` (WHEEL-UI computes it in the cached reader, e.g. a hash of round + slices + texts + triggers).

### 5.2 Stubs with final signatures (WHEEL-SERVER fills them)
```ts
// src/lib/wheel/actions.ts ("use server")
loadWheel(raw: { locale: string }): Promise<WheelState>          // stub: { eligible: false, reason: "disabled", slices: [], texts from wheel.* , … }
claimWheel(raw: { locale: string }): Promise<WheelClaimResult>   // stub: { ok: false, error: "disabled", message }
// src/app/api/wheel/spin/route.ts
POST(request: Request): Promise<Response>   // stub: 503 { ok: false, error: "unavailable", message } (Cache-Control: no-store)
```
`/api/` is outside the proxy matcher (no locale redirect). Both actions validate the locale (`z.enum(LOCALES).catch("tr")`).

### 5.3 `findActiveWheelCoupon` (`src/lib/wheel/prize-coupons.ts`, server-only, working)
```ts
type ActiveWheelCoupon = { couponId: number; code: string; endsAt: Date; label?: LocalizedText; type: CouponType; value: number; minOrderTotal: number }
findActiveWheelCoupon(tx: Tx, userId: string, now: Date): Promise<ActiveWheelCoupon | null>
```
`source = 'wheel'`, owned by `userId`, active, started, `ends_at > now` (a prize always has an end), not used up;
the one that expires first; `label` from the spin snapshot (absent when the spin row is gone). Read-only, no
locks (writers re-validate through the engine under the cart lock). Use it for the reminder chip, the account
card, the cart's prize row and auto-apply on `addItem`.

### 5.4 `WheelGraphic` + geometry (`src/components/store/wheel/`)
`WheelGraphic(props: WheelGraphicProps)`: pure SVG (viewBox 200), wedges in `WHEEL_TONE_COLORS` (theme tokens:
brand → `--brand`/`--brand-contrast`, gold → `--gold`/`--gold-contrast`, cream → `--gold-50`/`--brand-900`, ink →
`--brand-950`/`--gold-200`), radial labels (`direction="rtl"` on /ar), PRESTİJ centre disc, top pointer; rotation by
CSS transform (`transition: transform <spinDurationMs>ms`), `aria-hidden` unless `label` is given.
`wheel-geometry.ts` (pure): `sliceAngle(count)`, `polar(cx, cy, r, deg)`, `slicePath(i, count, cx, cy, r)`,
`landingRotation(index, count, { from = 0, turns = 5 })` (forward ≥ `turns` turns, stops slice `index` under the
pointer), `sliceAtRotation(rotation, count)`. Angles: degrees clockwise from the top; slice 0 centred at rotation 0.
WHEEL-UI perfects label fitting, RTL details and the celebration; WHEEL-PANEL imports the same component.

## 6. Media kinds

```ts
// src/lib/media/types.ts (pure)
MEDIA_KINDS = ["image", "video"]; type MediaKind
type MediaLike = { …; kind?: MediaKind; mime?: string }       // missing kind = image
isVideoMedia(media: { kind?; mime? } | null | undefined): boolean     // kind "video", else a video/* mime
toMediaLike(row)   // keeps kind/mime only when the row has them (older image objects keep their exact shape)
// src/lib/data/media.ts
mediaColumns       // + kind, mime (every storefront MediaLike from it carries both now)
imageOnly(table = schema.media): SQL    // `kind = 'image'`; add to every image query on product_media/media (pass an alias when joined under another name)
// src/lib/panel/media/types.ts
type PanelMedia = … & { kind?: MediaKind; durationMs?: number | null; posterId?: number | null; poster?: MediaLike | null }
type MediaKindFilter = MediaKind | "all"; MEDIA_KIND_FILTERS = ["image", "video", "all"]
type MediaListInput = { q?; folder?; cursor?; kind?: MediaKindFilter }
// src/lib/panel/media/queries.ts
mediaKindFilter(value: unknown): MediaKindFilter          // unknown → "image"
listMedia({ …, kind = "image" }, executor?, pageSize?)    // kind filter; video rows come with `poster` (one extra query)
getPanelMedia(ids, executor?)                             // any kind, with `poster`
panelMediaColumns                                         // + kind, durationMs, posterId; toPanelMedia(row) sets poster: null
listMediaAction({ q?, folder?, cursor?, kind? })          // "image" unless told otherwise
```
- **Default `"image"` everywhere**, so every existing image picker keeps offering images only. **The media library
  (`/panel/medya`, `MediaLibrary.tsx`) still calls without `kind`, i.e. images only:** MEDIA-UPLOAD adds the
  Tümü / Fotoğraflar / Videolar tabs and passes `"all"` / `"image"` / `"video"`.
- `MediaPicker` / `MediaPickerDialog` take `kind?: MediaKindFilter` (default `"image"`; texts unchanged for images,
  "Video seç / Video ekle…" for videos, "Görsel veya video…" for all). With `kind="video"` the dialog hides its
  upload tab (it uploads images only) until MEDIA-UPLOAD's shared queue handles videos. Grid tiles and previews use
  `MediaThumb`; tiles of videos say ", video" in their aria-label.
- `MediaThumb({ media, sizes, fill?, alt? = "", className?, showDuration? = true })` (pure): an image renders `<Img>`;
  a video renders its `poster` via `<Img>` (or a neutral tile with a film icon), a play badge with the duration
  (`formatMediaDuration(ms)`: "0:42", "1:02:05") and sr-only "Video, 0:42". The video file is never used as an image.
- Server-side kind checks (`ensureMediaExist` / products `missingMedia`) and every storefront image consumer are the
  builders' (MEDIA-UPLOAD / VIDEO-STORE): use `imageOnly()` and `isVideoMedia()`. `src/lib/data/site.ts getMediaById`
  still selects its own columns without `kind`/`mime` (VIDEO-STORE: add them if a field can hold a video).
- JSON references to videos end in `MediaId` (`videoMediaId`, `posterImageId`) so usage tracking sees them.

## 7. Messages (`src/i18n/messages/{tr,en,ar}.ts`)

`wheel` (group label "Hediye çarkı"; voice **"siz"** like the rest of the site since FIX, lead decision D1 — first-person buttons such as "Hediyemi al" stay; §12):
```
teaser    { label, open, hide, collapsed, neverShow }
chip      { text "Hediyen seni bekliyor · {time}", label "…son kullanım {date}. Sepete git." }
dialog    { label, title, subtitle, loading, close, spin, spinning, prizes, everySliceWins,
            terms "Çarkı çevirerek {link}’nı kabul etmiş olursun.", termsLink "Kampanya Koşulları", privacy "… {link} …", privacyLink }
result    { title, prize "{prize}", announcement "{prize}", minOrder "{amount}", validity "{hours}" (en/ar plural),
            freeShippingHeavy, holdUntil "{date}", alreadySpun }
claim     { claimCta "Hediyemi al", registerCta "Hediyeni almak için ücretsiz üye ol", signInCta "Zaten üye misin? Giriş yap",
            claiming, claimedTitle, code, copy, copied, applied, kept, expires "{date}", goToCart, continueShopping }
banner    { register "{prize}", signIn "{prize}", verify }
cart      { title, timeLeft "{time}", expiresAt "{date}", applied, waitingMinOrder "{prize} {amount}", waitingOtherCode,
            waitingNoBenefit "{prize}", expired, drawer "{time}" }
account   { title, active "{prize}", code, timeLeft "{time}", expiresAt "{date}", pending, used, expired, shop }
countdown { days "{days}g {clock}" (ar plural), expired }
prize     { percent "%{value} indirim", fixed "{amount} indirim", freeShipping }   // for slices without a translation
errors    { <every WheelErrorCode> }
```
Also `product.video` ("Video"), `product.playVideo` ("Videoyu oynat"), `product.pauseVideo` ("Videoyu duraklat"),
and `cart.errors.coupon_not_owner`. Placeholders: `{time}` = the formatted countdown, `{date}` = an Istanbul date/time,
`{amount}` = `formatPrice`, `{prize}` = a slice label, `{link}` = a link element the UI inserts, `{clock}` = "03:14"
(UI-formatted). Every key has the same placeholders in tr/en/ar (Arabic may pluralize), Western digits; the
panel's UI-strings page lists them under "Hediye çarkı" with Turkish sub-group names. Slice labels and the six
overridable texts are content (`giftWheel.slices[].label`, `giftWheel.texts`): resolve them with
`wheelDisplaySlices` / `wheelText(override, locale, messages.wheel.…)`.

## 8. Content script (`scripts/content-day6.ts`)

```bash
npx tsx --conditions=react-server --env-file=.env.local scripts/content-day6.ts --dry-run --only=giftWheelConfig   # while building
```
Same machinery and rules as day 5 (`scripts/seed-data/content-helpers.ts`; DAY5-CORE-API §8): one transaction per
step, `--dry-run`, `--only=a,b`, refuses `NODE_ENV=production` / non-local DBs without `--allow-production`, unknown
step → error listing the steps. Steps (all CONTENT, all empty now, run order): `wheelTerms`, `giftWheelConfig`,
`launchChecklist`. Importable without a database (no `@/db` at top level). `tests/db/day6-core-api.test.ts` runs every
step twice in a rolled-back transaction (second report empty) and restores the `pages`, `page_sections`,
`legal_documents` sequences; CONTENT adds its own step tests. Use `defaultGiftWheelSlices()` for the live row.

## 9. Gotchas

1. **Same-transaction account delete.** Deleting a user in the same transaction that inserted one of its spin rows
   *with a coupon* fails (`wheel_spins_coupon_id_coupons_id_fk`): PostgreSQL re-checks the coupon FK of a row created
   in the current transaction when the `user_id SET NULL` cascade updates it, before the coupon's own `SET NULL` has
   run. Rows from earlier transactions skip that check, so real deletions work. DB tests: delete the coupon first, or
   test the two cascades separately (as `day6-core-api.test.ts` does). No app path deletes users (anonymize instead).
2. **Constraint errors inside a rolled-back test transaction** abort it: wrap the failing statement in a savepoint
   (`tx.transaction(async (sp) => …)`), see `failure()` in `day6-core-api.test.ts`; read the constraint with `pgConstraint`.
3. **Media rows must set `kind` with the mime** (check constraint). `processImage` output keeps the default `image`.
4. `mediaColumns` now adds `kind`/`mime` to every storefront MediaLike, a few dozen bytes per image object in the RSC
   payload; markup and JSON-LD are unchanged (verified, §10).
5. Server Action files (`"use server"`) may export only async functions: keep constants/types in `types.ts`.
6. `cacheLife()` throws outside Next: DB tests call `readSettingsRow` / uncached queries, never `getSettings`.
7. `npm run lint` keeps the 23 pre-existing warnings (kaynak/ and old panel files); CORE's files have 0.

## 10. What CORE verified (2026-11-12)

- **Backup** `prestij_backup_day6_start` present before the migration; DB fingerprint taken before migrating
  (`$SCRATCH/day6/core/fp-pre-migrate.json`).
- **Migration** generated, reviewed, applied (row 6, hash = sha256 of the file, `created_at` = journal `when`); a fresh
  `drizzle-kit generate` → "No schema changes".
- **Gates:** `npm run typecheck` exit 0 · `npm run lint` exit 0 (0 errors, the 23 pre-existing warnings, none in
  CORE files; `npx eslint --max-warnings=0` on every touched file: clean) · `npx eslint src scripts tests --quiet`:
  empty · `npm test` **1149/1149** (40 new + 1 from the settings-key loop) · `npm run test:db` **370/370** (21 new)
  with the DB fingerprint identical before and after (52 tables, 39 sequences).
- **Storefront unchanged:** dev server `check.localhost:3701` (`.next/dev-core6`, deleted afterwards; `tsconfig.json`
  and `next-env.d.ts` restored and `cmp`-equal). Visible text of `/tr`, `/ar`, `/en/products`, `/ar/products`,
  `/ar/page/hakkimizda` = the Day 5 FIX2 captures (same word multiset; only dev streaming order/title placement
  differ); product JSON-LD of `/tr/urunler/lavanta`, `/tr/urunler/portakal`, `/en/products/okyanus`,
  `/ar/products/lavanta-latte` byte-identical to the Day 5 smoke captures (origin normalized); product, category and
  cart pages 200 without errors. No full build (contract: CORE skips it).
- **Content script:** `content-day6.ts --dry-run` → "nothing to do" ×3; `--only=nope` → error; `NODE_ENV=production`
  → refused; fingerprint unchanged.

## 11. After the build areas (INTEGRATE, 2026-11-12)

Merged every area's integrator notes; the tree is consistent and all gates pass (§11.4). The build-area reports in
`$SCRATCH/day6/results/*.md` stay the reference for each area's own API; this section lists only what changed at
integration and the shared pieces that had no home yet.

### 11.1 Changes made at integration

| File | Change |
|---|---|
| `src/lib/wheel/types.ts` | `WHEEL_TERMS_LEGAL_KEY = "wheel_terms"`, `WHEEL_TERMS_PAGE_SLUG = "hediye-carki-kampanya-kosullari"` (single source; `src/lib/wheel/links.ts` re-exports the slug) |
| `src/i18n/messages/{tr,en,ar}.ts` | new group `email.wheel` (`prize{…}`, `reminder{…}`, `common{…}`): the wheel e-mail texts, editable under Arayüz Metinleri (sub-group label "Hediye çarkı e-postaları" in `src/lib/panel/ui-strings/catalog.ts`) |
| `src/lib/email/templates/wheel.ts` | texts from `ctx.messages.email.wheel` (overrides included); `WheelEmailTexts = Messages["email"]["wheel"]`; `WHEEL_EMAIL_TEXTS` = the built-in dictionaries (tests) |
| `src/components/store/wheel/WheelAuthBanner.tsx` | reads `getVisitorWheelBanner(locale)` (cookie + spin row only, never writes a cookie); a spin already bound at sign-up shows `wheel.banner.verify` |
| `src/components/store/wheel/WheelLive.tsx` | the account card's countdown is a `role="timer"` like the cart countdowns |
| `src/lib/panel/marketing/schemas.ts`, `src/components/panel/marketing/labels.ts` | newsletter source `wheel` ("Hediye çarkı") in the e-bülten filter and list |
| `src/app/panel/(dashboard)/islem-kaydi/page.tsx` | settings audit rows of `giftWheel` read "Hediye Çarkı" |
| `src/components/panel/dashboard/SalesChart.tsx` | the screen-reader table sits in an `sr-only` wrapper (a `<table>` ignores `overflow`, so `sr-only` on it widened phones) |
| `src/lib/panel/content/sections.ts` | a required video field says "Bir video seçin." |
| `src/components/panel/sections/section-ui.ts` | icon `video: Clapperboard` |
| `src/components/sections/schemas.ts` | legal_document select offers `membership` and `wheel_terms` |
| `src/lib/data/site.ts` | `getMediaById` (logos, default share image) reads images only (`imageOnly()`) |
| `src/lib/panel/media/queries.ts` | a product video's usage reads "Ürün videosu" |
| `src/lib/panel/categories/service.ts` | category image / share image refuse a video ("Bu alana yalnızca görsel seçilebilir; seçtiğiniz dosya bir video.") |
| `src/lib/panel/settings/schemas.ts` | slice weight messages say "Şans ağırlığı" (the form's label) |
| `src/lib/panel/seo/launch.ts` | media-storage step: bucket public + 50 MB + MIME allow-list, a > 4,5 MB test photo, `SUPABASE_PUBLISHABLE_KEY` only if the signed PUT asks for an apikey; wheel-slices step links `/panel/hediye-carki/ayarlar` |
| `src/app/panel/(dashboard)/seo/page.tsx` | passes `mediaStorage` (only whether the variables are set), `giftWheelEnabled`, `wheelTermsVersion` to the checklist |
| `tests/unit/day6-integrate-consistency.test.ts` (new) | one terms key/slug everywhere, the legal select covers every seeded document, the three countdown helpers agree in tr/en/ar, newsletter source labels, video field message |
| `tests/unit/day6-content-launch.test.ts` | the wheel step's new panel link |

Accepted as delivered: MEDIA-UPLOAD's additive `sequential` option in `src/lib/media/process.ts` and its
`src/app/panel/(dashboard)/medya/page.tsx` change (`kind: "all"`, `?medya=<id>`).

### 11.2 Media upload and serving (MEDIA-UPLOAD, for reference)

- Routes: `POST /panel/api/media/uploads` (ticket + PUT target), `PUT /panel/api/media/uploads/local?ticket=…`
  (local driver, streamed, byte-capped), `POST /panel/api/media/uploads/complete` (stat + sniff, then image pipeline
  with sequential encodes, or video row). Legacy `POST /panel/api/media` stays for small single images only.
- Storage adapter (optional methods): `createUploadTarget`, `readRange`, `read`, `move`, `listStale`; `sb_secret_…`
  keys only in `apikey`; the local driver refuses to run when `VERCEL` is set.
- `ensureMediaExist(executor, ids, field, { kind = "image" })`, `mediaRefsByKind(json)`; usage kind `video_poster`;
  `updateMediaPosterAction`; daily job `media.prune-incoming` (staging files older than 24 h).
- `/uploads/[...key]`: GET + HEAD, single Range → 206, unsatisfiable → 416, ETag/304/If-Range, mp4/webm, never
  `_incoming/`. Next 16.4 strips `Content-Length` from Route Handler responses (local driver only; Supabase serves
  production files itself).

### 11.3 Content run

`content-day6.ts --dry-run`, sequences put back, real run (legal_documents #7, pages #13, page_sections #40, settings
`giftWheel`), second run "nothing to do" ×3 with an unchanged fingerprint; content-day4/day5 dry runs still "nothing
to do". A running server keeps its caches: restart the client's site (or rebuild) to see the wheel and the terms page.

### 11.4 What INTEGRATE verified

typecheck exit 0 · lint exit 0 (4 pre-existing warnings) · `eslint --quiet` empty · `npm test` 1493/1493 ·
`npm run test:db` 446/446 with identical fingerprints · isolated build `.next/build-int6` (origin
`check.localhost:3770`): `.meta` set = Day 5 + the three terms pages (all S, homes S) · SEO audit 0 errors /
0 warnings (87 sitemap URLs) · smoke 353/353 (Day 5's 310 + 43 day-6 checks) · end-to-end wheel and video runs in
headless Chromium (results in `$SCRATCH/day6/results/integrate.md`) · first-load JS `/tr` 219,731 B gz (Day 5
218,314; +1,417 B for all day-6 areas, budget 1.5 KB) · throttled mobile LCP /tr ≈ 1.95 s, PDP ≈ 1.91 s, category
≈ 1.54 s, /ar ≈ 2.04 s, CLS 0 on TR pages · all test data removed; DB diff vs `$SCRATCH/day6/start.json` = migration +
giftWheel row + wheel_terms document/page/section only.

## 12. Day 6 FIX (2026-11-12)

What the review fixes changed in the shared pieces (details per finding in `$SCRATCH/day6/results/fix.md`).

| Area | Change |
|---|---|
| Rate limits (SEC-1) | `src/lib/wheel/limits.ts` (new): `wheelSpinLimitKey`, `wheelClaimLimitKey`, `consumeWheelSpinLimit(executor, ip)`, `wheelClaimLimiter(ip)`. **`ClaimLimiter = (executor: Tx) => Promise<boolean>`**: every wheel limit is counted on the transaction that is already open (never on the shared pool inside a transaction: that deadlocked the pool). `hooks.ts` re-exports the three names. Lock order spin row → counter (`claimSpinForAccount` locks the held spin first). `src/db/index.ts`: `queue_timeout: 15` (a nested pool use errors instead of hanging). |
| Spin route | Its decision moved into `spinWheel(tx, { config, userId, cookieSpinId, ip, locale, pagePath, now, commerce?, randomInt? })` → `SpinDecision` (service, no Next APIs). |
| Hold (COR-2) | `WheelPrizeSnapshot.holdUntil?` (ISO, JSON field, no migration): set by `createSpin`; `spinHoldUntilOf(spin, holdDays)` / `isSpinHeld` / `holdUntilOf` read it (older rows: created_at + current holdDays); SQL twin `spinHoldEndSql(holdDays)` in the stale-bound expiry and the purge. |
| Pending (COR-1) | `WheelSpinView.pending?` / `WheelSpinResponse.pending?`: a guest whose spin is already bound at sign-up; `isSpinPendingVerification(spin, signedIn)`. The dialog then shows `wheel.result.pending` + `checkInbox` and a close button. |
| Labels (COR-7) | One prize-name rule everywhere: the label in the reader's language, Turkish readers the Turkish one, en/ar without a translation the generated name. `wheelDisplaySlices(slices, locale, generated?)`; `wheelPrizeLabel` and the cart's `buildWheelPrizeView` follow it. |
| Display slices (UX-5) | `WheelDisplaySlice.minOrderTotal?` (a condition, never the weight); the ready view lists the minimums (`wheel.dialog.minOrderNote` / `minOrderItem`). |
| Messages | tr wheel + email.wheel in "siz" (D1); new keys `wheel.dialog.minOrderNote`, `minOrderItem`, `wheel.result.validityDays`, `pending`, `checkInbox`; `wheel.banner.verify` / `wheel.account.pending` take `{date}` (the hold end). `validityText(hours, locale, m.result)` in `src/lib/wheel/prize.ts` (days for whole days ≥ 2). |
| Panel | `rekeyChangedSlices` / `slicePrizeChanged` / `tinySliceLabels` (`src/lib/panel/gift-wheel/slices.ts`); `SettingsForm` takes an optional `prepare(state)`; `updateMediaPoster` refuses to remove a used video's cover (`in_use`); upload queue: `canCancelUpload`, `CANCELLED_MESSAGE` (`upload-queue-model.ts`), `putFailureMessage` (`upload-errors.ts`). |
| KVKK (SEC-3) | `exportCustomerData` adds `giftWheel: { note, spins[], prizes[] }` (`ipHashStored` boolean, never the hash). |


## 13. Day 6 follow-up: lead decisions D13–D16 (2026-11-12)

The four review findings FIX skipped for a product decision (SEC-2, UX-3, COR-4, UX-12), as the lead decided them.
Details, tests and gate results: `$SCRATCH/day6/results/decide-impl.md`. No schema or migration change (D10).

| Decision | Change |
|---|---|
| **D13** (SEC-2) wheel per-IP limits | `WHEEL_RATE_LIMITS.spinsPerIp` = **3** per 24 h (was 10; claims stay 3). New pure `wheelLimitAddress(ip)` (`src/lib/wheel/limit-address.ts`, re-exported by `limits.ts`): IPv6 → its /64 prefix in canonical hex (`"2001:db8:a:b::/64"`; brackets, port and zone id ignored), IPv4-mapped IPv6 (`::ffff:a.b.c.d`, also the hex spelling) → the IPv4 address, IPv4 and anything else → unchanged. `wheelSpinLimitKey` / `wheelClaimLimitKey` apply it, so every wheel limit (spin route via `spinWheel`, `loadWheel`'s read-only pre-check, `claimWheel`, sign-in, sign-up, unverified sign-in bind) counts per address rule. Only the wheel: `clientIpFrom`, the other areas' keys and the spin row's salted `ip_hash` keep the full IP. On Vercel the IP already comes from `x-vercel-forwarded-for`. The terms draft says only "…sayısı sınırlandırılabilir" (no number), the messages and panel help state none: nothing to adjust. |
| **D14** (UX-3) dismissal vs panel edits | `parseWheelStore(raw, signature)` (`src/components/store/wheel/wheel-storage.ts`): hints saved under another signature of the **same round** (`wheelSignatureRound("3.k2j9xq") = "3"`) keep `hiddenUntil` ("Bir daha gösterme"), `promptedAt` (auto-open cooldown) and `chipHiddenUntil`; `collapsed` and the held-prize hint (`prize`) follow the full signature; another round ("Yeni tur başlat") starts over. The returned store carries the current signature, so the launcher's next write (unchanged) saves the kept hints under it. The module is imported only by the lazy launcher/dialog chunks (and now the `/hesap` card), not by the first-load island. |
| **D15** (COR-4) held spins after the campaign end | Service `findAccountHeldSpin(tx, { config, userId, now, commerce? })` (`src/lib/wheel/service.ts`): the account's bound, unclaimed spin inside its frozen hold, by `resolveWheelVisitor` with **no cookie** = exactly the rules `claimSpinForAccount` applies (wheel on, account eligible; schedule ignored, D8). Loader `queryAccountHeldSpin(executor, userId, now)` / `getAccountHeldSpin` in the new `src/lib/data/wheel-held.ts` → `AccountHeldSpin { spinId, prize, holdUntil, validityHours, heavySurcharge, claimCta }` (a separate module, so the layout's teaser reader keeps its import graph). Pure card model `heldSpinCardModel(input, locale, m.wheel)` / `heldSpinCardLabels(m.wheel)` (`src/components/store/wheel/held-spin-card.ts`, server side): prize name by `prizeLabel`, conditions by `prizeSummary` (minimum basket, validity, heavy note), claim-until from the frozen hold, button text `wheelText(texts.claimCta, …)`. Client card `AccountHeldSpinCard` (above the prize card in `AccountWheelCard`): "Hediyemi al" → existing `claimWheel` (it already finds the spin by the account first: no cookie needed, no service change), then code + copy, `WheelCountdownText` (`role="timer"`, real `ends_at`), applied/kept note, "Sepete git"; `publishCartView(result.cart)` and `clearCachedWheelData()`; errors show the server's localized message (`role="alert"`), final refusals hide the button. New keys `wheel.account.heldTitle`, `held` (`{prize}`), `claimUntil` (`{date}`) in tr ("siz")/en/ar (sub-group "Hesabım: çark hediyesi kartı" already in the UI-strings catalog). Launcher and island untouched. |
| **D16** (UX-12) captions | No captions feature. `VIDEO_SPEECH_TIP` (`src/components/panel/media/video-guidance.ts`): "İpucu: Konuşmasız videolar kullanın ya da altyazıyı videonun görüntüsüne ekleyin. Videoda gösterilen önemli bilgileri ürün veya sayfa metnine de yazın." Shown in the product editor's media tab (under "Video ekle"), as a second help line of every `accept: "video"` field in `SectionFieldsEditor` (hero background video, video section), and in `UploadDropzone` whenever it accepts videos (media library upload dialog, the video picker's upload tab; linked via `aria-describedby`). |

Tests: `tests/unit/day6-decide-{limits,wheel-store,held-card,video-tip}.test.ts`, `tests/db/day6-decide-wheel.test.ts`; the pinned
`tests/unit/day6-wheel-ui-rules.test.ts` title now says "another round" (its assertion, a different round starts over, holds).

**FINAL-2 follow-ups (review findings DL-1, DL-3, DU-1…DU-5; `$SCRATCH/day6/results/decide-final.md`):**

- `/hesap` held card (`AccountHeldSpinCard`): the refusal rules live in the new pure `src/components/store/wheel/held-spin-state.ts`
  (`heldCardRefusal(code)`, `heldHoldPassed(holdUntil, now)`, `HELD_CARD_FINAL_ERRORS` = the dialog's LASTING list plus
  `no_spin`/`spin_expired`, `ACCOUNT_WHEEL_HEADING_ID`). Once the frozen `holdUntil` has passed (exact timer + 60 s tick, and again
  at click time, before any claim is sent) the button goes and the card says "Çark sonucunun süresi doldu." under the neutral title
  `wheel.account.title`; `no_spin`/`ended`/`not_started` from `claimWheel` mean the same for this card. `already_claimed` calls
  `router.refresh()` (the prize card with the code replaces the held card; focus moves to its heading `#account-wheel`, now
  `tabIndex={-1}`). The button uses `aria-disabled` while claiming (focus stays), and a final refusal moves focus to the notice
  (`role="alert"`, `tabIndex={-1}`). `heldSpinCardLabels` adds `expired` and `goneTitle` (existing texts).
- `wheel.account.held` (tr/en) now names the prize after a colon: "Çarkta kazandığınız hediye: {prize}. Hediyenizi aldığınızda …".
- `WHEEL_SPEND_PREFIXES` (`route-rules.ts`) includes `/hesap`: after an account page the launcher drops its cached answer and asks
  the server again on the next storefront page (a claim on `/hesap` no longer leaves a stale teaser). Launcher and island files unchanged.
- D16 tip: the media picker shows it once above its tabs when it offers videos (`VideoSpeechTip`, exported by `MediaUploadDialog.tsx`;
  the upload tab links its file input to it via `UploadDropzone`'s new `videoTipId`); the product editor shows it right under
  "Video ekle", above the media list.

## 14. Go-live code fixes (2026-11-14)

The code part of the go-live runbook (Vercel + Supabase), CF-1 to CF-15 and CF-18. Tests:
`tests/unit/golive-{config,seller,payments-email}.test.ts`, `tests/db/golive-{payments,email-queue,rls}.test.ts`.

| Fix | Change |
|---|---|
| CF-1 simulator | `isSimulatorEnabled()` = `PAYMENT_SIMULATOR === "true" && localPaymentMockAllowed()`: a production build on a public origin ignores the variable. `.env.example` ships `PAYMENT_SIMULATOR=` (local only). |
| CF-2 Vercel | `vercel.json` `"regions": ["fra1"]` (next to Supabase Frankfurt). Both crons stay daily (`0 3 * * *`, `30 3 * * *`), because a sub-daily schedule fails the deploy on the Hobby plan. |
| CF-3 card page CSP | `src/lib/security/card-page-csp.ts` (pure, imported by `next.config.ts`): `frame-ancestors 'self'; frame-src 'self' <PayTR origin> https:`, so PayTR's in-iframe return page and the bank's 3-D Secure page are not blocked. |
| CF-4 draft contracts | `checkoutLegalReady(docs)` (`src/lib/orders/legal-ready.ts`, uses `isDraftLegalVersion`): `/odeme` shows "Online siparişler şu an kapalı" (`checkout.page.closedTitle/closedText/closedContact`) instead of the form, and `placeOrder` refuses `legal_unavailable`. `PlaceOrderContext.allowDraftContracts` is for tests and scripts only (the checkout action never passes it). |
| CF-5 build guard | `productionSiteUrlError(env)` (`src/lib/deploy/site-url.ts`): with `VERCEL_ENV=production`, `next.config.ts` throws when `NEXT_PUBLIC_SITE_URL` is missing, not `https://`, or a local host. |
| CF-6 outbox on Vercel | `emailDriverStatus`: `EMAIL_DRIVER=outbox` with `VERCEL` set is not ready ("salt okunur disk"); mails stay queued. |
| CF-7 repo | `.gitignore` `/kaynak/`, `/storage/`; `.env.example` `INDEXNOW_KEY=`; `package.json` `"engines": { "node": "26.x" }` (local Node 26, Vercel's current default; every dependency accepts ≥ 20.9). |
| CF-8 DB tests | `tests/db/setup/local-only.ts`: the first import of every `tests/db/*.test.ts` (enforced by a unit test), so a single file run directly is guarded even when the shell’s `DATABASE_URL` wins over `--env-file`; `npm run test:db` also checks it once up front and loads it in every test process (`--import`); only localhost / 127.0.0.1 / ::1. |
| CF-9 seller identity | `general.chamber { name: LocalizedText, rulesUrl }`, `general.trademark` (settings, panel input, Firma bilgileri form). `sellerIdentityRows()` / `missingSellerFields()` (`src/lib/settings/seller.ts`), `SellerIdentity` (server markup, `<bdi>` values): the footer prints legal name, address, phone, e-mail, MERSİS, KEP, chamber + rules link and trademark under a visible "İletişim" heading; the contact section adds a "Satıcı bilgileri" block. Messages `footer.seller.*`. Every line hidden when empty; no new dynamic read (cached `getSettings("general")`). |
| CF-10 launch checklist | Five steps after the day-6 ones: `seller-identity`, `email-sending`, `site-url`, `cron-secret`, `admin-recipients` (only set / not set: `cronSecretState`, `adminRecipientsState`, `emailDriverStatus`). |
| CF-11 test mode | `cardTestModeHidden(payments, customer)` / `getCardGatewayFor` / `isCardPaymentReadyFor` (`gateway.ts`): on a live site with the panel's test mode on, card is `not_configured` for everyone but staff (`CustomerContext.staff`, set by `getCustomerContext` from the user's role) in the cart view, the legal preview, `placeOrder` and the retry action; the order page hides "retry". `isTestPayment` / `hasTestPayment` (`attempts.ts`): red "TEST ÖDEMESİ – para çekilmedi" on the panel order page and first in the admin new-order mail (`admin.testPayment`, notice tone `danger`). The readiness PayTR step says to switch the PayTR merchant panel to Canlı Mod first. |
| CF-12 PayTR refusal | `GatewayRefusedError` / `safeProviderMessage` (`src/lib/payments/refusal.ts`, masked, ≤ 200 characters): `initiateCardPayment` logs the reason and stores `payments.raw.lastError = { at, message }`; the panel order page shows it under the payment record. |
| CF-13 campaign footer | `company.identity` in the e-mail layout: "MERSİS No: …" and "KEP: …" beside the legal name in marketing mails (HTML and text), each only when filled (`email.layout.mersisNo/kep`). |
| CF-14 mail queue | `CAMPAIGN_EMAIL_TEMPLATES` (`newsletter_campaign`, `wheel_prize_reminder`) are claimed and sent after every due transactional row. |
| CF-15 postgres | `idle_timeout: 20`; `ssl: "require"` for `*.supabase.com` / `*.supabase.co` hosts when the URL sets no sslmode (`src/db/connection-options.ts`). |
| CF-18 RLS | `.enableRLS()` on all 52 tables and migration `0006_golive_rls` (52 × `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, nothing else; applied locally). No policies: the app's role owns the tables and bypasses RLS; Supabase's anon / authenticated roles see no rows through the Data API. Any data-copy script that checks the migration count must expect 7. |

**Frequent cron on Vercel Pro.** Once the team is on Vercel Pro, change the `/api/cron/frequent` entry in
`vercel.json` to `"schedule": "*/5 * * * *"` and redeploy (abandoned card orders then release their stock within
minutes, failed mails retry every 5 minutes, subscriptions renew on time). Keep `/api/cron/daily` at `30 3 * * *`.
On the Hobby plan a sub-daily schedule fails the deploy, which is why both stay daily for now.

### 14.1 Go-live FINAL fixes (2026-11-14, night)

Tests: `tests/unit/golive-final.test.ts`, additions to `tests/unit/golive-{config,data-urls,seller}.test.ts`,
`tests/db/golive-payments.test.ts` (order-page retry for staff) and `tests/db/subscriptions.test.ts` (held renewal).

| Finding | Change |
|---|---|
| GC-1 draft label | `isDraftLegalVersion` moved to the tiny `src/lib/panel/legal/draft.ts` (re-exported by `launch.ts` and `legal/schemas.ts`). `legalVersionSuggestions(current, existing, now)` → `{ approved, draft }`: after a draft, `approved` is the Istanbul-month label `"2026-11 v1"` (`approvedVersionLabel`), `draft` the next `"taslak-N"`; `suggestNextVersion` is unchanged. `getLegalEditorData` returns `nextVersion` (approved) and `nextDraftVersion`; publish/restore return both. The editor pre-fills the label from the draft-notice switch (on → draft, off → approved; a typed label is never overwritten), warns under "Yeni sürüm adı" and in the publish dialog while a sales contract (or the wheel terms) has a `taslak…` label, and warns when the notice is on with a non-draft label. `/panel/yasal` shows draft versions with a warning badge ("taslak: ödeme sayfası kapalı" on the two contracts). `LegalDraftBanner` explains the label rule. Launch checklist step `checkout-contracts` "Satış sözleşmeleri onaylı" (`checkoutContracts` input, `checkoutContractsApproved` = the `checkoutLegalReady` rule) after `seller-identity`. `/panel/ayarlar/odeme`: `PaymentReadiness.checkoutClosedByContracts` banner when a payment method is on but the checkout is closed by the contracts. |
| GC-2 DB test guard | `import "./setup/local-only";` is the first import of all 42 `tests/db/*.test.ts`; a unit test enforces it for new files; DAY3-CORE-API §15 single-file command adds `--import ./tests/db/setup/local-only.ts`. |
| GC-3 closed checkout copy | `checkout.page.closedText` tr/en/ar: no invitation to order by phone or e-mail; the cart is kept "for a while". |
| GC-4 renewals | `renewSubscription` holds (`{ status: "held", reason: "legal_unavailable" }`) while a contract is missing or a draft: nothing written, `next_run_at` unchanged (the daily job retries), no customer mail, a server log line, `held` in the job counts. `RenewOptions.allowDraftContracts` for tests/scripts only. |
| GC-5 order-page retry | `getOrderByToken(orderNumber, token, viewer?)`: both order pages pass `getCustomerContext()`, so staff see "retry payment" in test mode on a live site (the retry action already allowed them). |
| GC-6 | Header comments of the go-live modules name the real test files. |
| GD-1 URL guard | `scripts/golive/rules.ts`: a local target or source URL carries no query parameter (a lone `sslmode=disable` excepted), because postgres.js lets `?database=` / `?host=` / `?port=` / `?user=` / `?options=` redirect the connection. Every script also asserts `current_database()` equals the checked database (`assertConnectedTo`, create-admin via `db.execute`). |
| GD-2 PowerShell | docs/GO-LIVE.md uses `npm.cmd` / `npx.cmd` (the `.ps1` shims are blocked by the Restricted policy of a new window on this PC). |
| GD-3 lock-down | No `VACUUM` in the lock-down Run; `verify-target.ts --locked-down` fails on any API-role privilege on public tables/sequences (from the ACLs) and any schema-public default privilege for them. |
| GD-4 /uploads media | verify-target `media uploads` FAIL (ids listed), copy-content preflight WARN line; GO-LIVE.md recovery row; RUNBOOK A6: no local uploads. |
| GD-5 brackets | A password still wrapped in `[ ]` is refused (rules.ts and the PowerShell block). |
| GD-6 copy phase | copy-content reports `committing` (may or may not have committed: run verify) vs `committed`. |

## 15. Sales-ready IMPL-B (2026-11-20): havale deadline, sales profile, launch checklist

Tests: `tests/unit/salesready-impl-b.test.ts`, `tests/db/salesready-impl-b.test.ts`; pinned updates in
`tests/unit/{day5-seo-panel-launch,day6-content-launch,golive-seller,golive-data-profile}.test.ts`.

| Item | Change |
|---|---|
| SR-2 setting | `settings.payments.bankTransfer.paymentDays` (int 1–14, default 3, `.catch(3)` so an unusable stored value never drops the bank accounts; panel input `int(1, 14, "Ödeme süresi")`, field in /panel/ayarlar/odeme with help "the same number must appear in the legal texts", audit label `paymentDays`). `BANK_TRANSFER_DEADLINE_DAYS` stays exported as the default only. |
| SR-2 rule | `src/lib/orders/bank-transfer-deadline.ts` (pure): `bankTransferDeadline(placedAt, days)` = 23:59:59.999 Istanbul of the order's Istanbul day + `days`; `bankTransferOverdueCutoff(now, days)` (`created_at < cutoff` ⇔ past the deadline); `isBankTransferOverdue(order, days, now)` (unpaid `awaiting_transfer` havale only). |
| SR-2 where it shows | the "Havale/EFT bilgileriniz" e-mail (`loadOrderEmailData`), the order page (`order.payment.bankDeadline/bankDeadlineNote`, `OrderView.payment.bankTransfer.deadline`), the order block of both contracts (`LegalRenderInput.bankTransferDays`, `checkout.legal.bankTransferTerm`; place, legal preview and renewals pass it), the checkout hint under the havale option (`PaymentMethodOption/View.paymentDays`, `checkout.form.methodBankDays`). tr/en/ar with ICU plurals. |
| SR-2 panel | `src/lib/orders/bank-transfer-overdue.ts` (`overdueBankTransferWhere/Flag`, `countOverdueBankTransfers`, `listOverdueBankTransfers`; executor + `now`). /panel/siparisler: "Ödeme süresi doldu" badge per row, `?sure=doldu` filter inside "Havale bekleyen" with the daily-check help; order detail: badge, warning notice with the last payment day, deadline in the action hint (`OrderDetail.transferDeadline`); dashboard "Yapılacaklar": optional line "Havale ödeme süresi doldu" (`DashboardTodo.overdueTransfers`, `getDashboardTodo(now)`). Nothing is cancelled automatically. |
| SR-3 sales profile | `scripts/golive/rules.ts`: `SALES_SETTINGS`, `SALES_EXPECTED_FLAGS`, `PROFILES`, readiness rules (`legalProblems`, `legalPlaceholders`, `sellerProblems`, `paymentProblems`, `priceProblems`, `salesReadiness`), announcement rule (`announcementFeature`, `featuresOff`, `featureSettingsAfter`, `announcementsToDeactivate`), `checkSourceUrl(raw, { rehearsalTarget })`. `copy-content.ts --profile=sales [--allow-prices]` refuses before writing; both profiles deactivate stale announcements. `verify-target.ts --profile=sales [--allow-prices]`. `pg.ts readSalesReadinessInput`. docs/GO-LIVE.md "The sales profile", "Announcements", "Sales-profile rehearsal". |
| SR-3/SR-6 prices | `src/lib/pricing/placeholder-prices.ts` (pure, one rule): a variant matches with price ∈ {14990, 44990, 149990, 159990} and stock exactly 100; considered = active variants of active products, price > 0, not samples; "still there" = ≥ 2 matches and ≥ 50 % of the considered. `PRICE_CHECK_ROWS_SQL` (scripts), `loadPriceCheckRows` (panel). |
| SR-6 checklist | `launch.ts`: `real-prices` ("Fiyatlar gerçek"), `bank-transfer` ("Havale: IBAN ve ödeme süresi", only while havale is on; counts only, never an IBAN), `shipping-settings` ("Kargo ayarları", `review: true` = "Kontrol et" badge while a fee is still on `DAY1_SHIPPING_DEFAULTS`), after `admin-recipients`. `isUsableBankAccount` (`src/lib/validation/tr.ts`) shared with the sales profile. |

### 15.1 Sales-ready IMPL-A (2026-11-20): newsletter off until İYS, renewals in the card test mode

Tests: `tests/unit/salesready-impl-a.test.ts`, `tests/db/salesready-impl-a.test.ts` (FIX: behaviour tests, see 15.2).

| Item | Change |
|---|---|
| SR-1 register | The register form's commercial e-mail box is shown only while `settings.newsletter.enabled` (`RegisterForm` prop `newsletterOptIn`, the page passes the cached `getSettings("newsletter")`). `registerAction` re-reads the switch fresh (`isNewsletterEnabled`, now exported from `src/lib/newsletter/service.ts`), so a ticked box with the newsletter off (stale page, forged request) is ignored. A brand-new account's records run in `recordNewAccount(tx, …)` (`src/lib/account/registration.ts`, no Next APIs): wheel spin bind, optional double opt-in (savepoint) and the consent audit row (`marketingRequested`, `newsletter` outcome, `newsletterMailQueued`). Pure rules in `src/lib/account/register-newsletter.ts`: `registerNewsletterRequested`, `registerMarketingNotice` (success line only for an accepted request), FIX `registerSuccessMarketing` (the whole success flag; an existing address answers like a new one). |
| SR-1 profile | `MarketingPreference` (prop `newsletterOn`): no subscribe / resend button while the newsletter is off, an "off" account reads `account.profilePage.marketingClosed` ("şu an kapalı", tr/en/ar), withdrawing consent always stays possible. `setMarketingAction` answers `marketingClosed` (never the generic forbidden) before the rate limit; FIX: the decision inside the transaction is `profileMarketingSubscribe(tx, …)` (`src/lib/account/marketing.ts`). |
| SR-1 home page | `src/components/sections/Newsletter.tsx` renders nothing while the newsletter is off (cached `getSettings("newsletter")`, like the footer band; no request-time read, the page stays static). |
| SR-4 renewals | `renewSubscription` holds a card renewal (`{ status: "held", reason: "card_test_mode" }`, `RenewHoldReason`) while the panel's card test mode is on on a live site: nothing written, `next_run_at` unchanged, no customer mail, a server log line `renewal held subscription=<id> … (card_test_mode)`, `held` in the job counts. FIX F7: only when the test mode is the **sole** blocker (`card.enabled` and `getCardGateway(...) !== null`); with card switched off or no provider configured the renewal fails with `method_unavailable` as before (customer told, `failed_count` + 1). New payments use `getCardGatewayFor(payments, null)` (no simulator on a live site). |

### 15.2 Sales-ready FIX (2026-11-21)

Tests: `tests/unit/salesready-fix.test.ts`, `tests/db/salesready-fix.test.ts`; updated `tests/unit/{salesready-impl-a,salesready-impl-b,day5-seo-panel-launch,day6-content-launch,golive-seller}.test.ts`, `tests/db/{salesready-impl-a,salesready-impl-b,orders}.test.ts`.

| Finding | Change |
|---|---|
| F1 samples | `SALES_SETTINGS.samples` switches `cartSampleEnabled`/`requestFormEnabled` off; both in `SALES_EXPECTED_FLAGS`. `--keep-samples` (both scripts, sales only, `WARN`) via `resolveProfile(name, { keepSamples })`, which drops the samples patch and its two flags. Samples line in the copy's readiness summary and in verify-target (`samplesSummary`). The announcement rule then deactivates `/numune` on its own. |
| F2 prices | `placeholder-prices.ts`: a variant matches on a Day-1 price alone (stock ignored). Scripts: `priceProblems` refuses on **any** match and lists the SKUs (`priceMatchList`); `--allow-prices` = warning with the same list. Panel step `real-prices`: `done` true only with no match, false while `placeholder` (≥ 2 and ≥ 50 %), else `done: null, review: true` ("Kontrol et") with the SKUs. |
| F3 seller | `missingSellerFieldKeys` / `REQUIRED_SELLER_FIELDS` / `SELLER_FIELD_NAMES` (`src/lib/settings/seller.ts`): one rule for the panel step and `sellerProblems` (KEP, chamber, `chamberRulesHref`-valid rules link, address with district). |
| F4 havale deadline | `OrderBreakdown.bankTransferDays` (optional, no migration) set by `placeOrder` and renewals; `placeOrder` also stores `createdAt: now` (the contract's date). `orderPaymentDays(breakdown, setting)` in `getOrderView`, `getOrderDetail`, `loadOrderEmailData`, `listOverdueBankTransfers`; the overdue SQL (`overdueBankTransferWhere/Flag(input: { now, paymentDays })`) uses each row's own count (`created_at < istanbulDayStart(now) − days × 24 h`, setting as fallback). `listPanelOrders({ overdueAt })`. Payment settings help: a change affects new orders only. |
| F5 copy TOCTOU | `assertCopiedContentReady(tx, …)` runs the readiness rules on the copied content inside the target transaction after the profile; a problem throws `Refusal` and rolls back. |
| F6 production profile | `productionProfileProblem(kind, profile)`: copy-content refuses a production target without `--profile`. |
| F7 renewal hold | see 15.1 SR-4. |
| F8 legal brackets | `legalPlaceholders` = the editor's `findMissingFields` (2–120 characters) over every language; `--allow-legal-brackets` (sales only) turns them into warnings (`legalReadiness(docs, allow)`); Turkish messages name the legal texts by title (`SALES_LEGAL_TITLES`). |
| F9 contract line | `checkout.legal.bankTransferTerm` (tr/en/ar) states only the date and the day count; the cancellation consequence is left to the lawyer-approved body. The line is listed for the lawyer in docs/YAYINA-ALMA-REHBERI.md (section 4 and question 10) and docs/GO-LIVE.md. |
| F11 tests | copy-content's flow moved to `scripts/golive/copy-run.ts` (`runCopy`, `salesGate`, `assertCopiedContentReady`; refusals throw `Refusal` from `pg.ts`, the CLI prints `REFUSED`). The sales gate now runs before the target preflight, so an unready shop never reaches the target (unit test with stubbed connections). |
| B-F7 order page | `order.payment.bankDeadlinePassed` (tr/en/ar): past the deadline the havale panel shows "Son ödeme tarihi geçti …" instead of the future-tense note (`now` passed by both order pages after `connection()`). |
| B-F8 wording | "varyant", "Ağır paket farkı", "Ayarlar › Kargo", "Kargoya verme süresi" in the cargo step (`shipping.estimatedDays` input), Turkish legal titles in the scripts. |
| B-F9 checklist groups | `LaunchStep.group` (`LaunchGroup`: before / wheel / after) and `LAUNCH_GROUPS`; the card ("Yayına alma adımları") renders three groups; no showcase alternative. Order: media storage, seller, contracts, e-mail, site URL, cron, admin mails, prices, havale, shipping, wheel slices, wheel terms, search engines. |

## 16. PayTR sağlamlaştırma (PayTR-fix, 2026-11-21)

A PayTR-readiness audit against the official PayTR pages (dev.paytr.com iFrame API steps 1-2, Durum Sorgu, iade,
hata kodları, FAQ, integration process; paytr.com Çerçeve Sözleşme and application conditions), adversarially
verified, produced findings C1-C13 (code), S1-S23 (site and owner) and X1-X8 (critic). Three implementation stages
followed: A1 (lost results, expiry, double charge), A2 (notification hardening and panel warnings) and B (contract
notice, sample links, panel texts, docs). No migration (everything lives in existing tables and jsonb; `drizzle-kit
generate` says "No schema changes"), no new dependency. PayTR is never called from tests: fetch stubs re-derive every
token, and `scripts/payment-mock.mjs` on 127.0.0.1 keeps its own hash checks.

Tests: `tests/unit/paytr-fix-{a1,a2,b}.test.ts`, `tests/db/paytr-fix-{a1,a2,b}.test.ts`; pinned updates in
`tests/unit/{golive-config,golive-data-profile}.test.ts`.

### 16.1 A1: results that never arrived (C3, C2 + X2, C4, C5 shared rule)

| Item | Change |
|---|---|
| Durum Sorgu | `paytrStatusToken` (base64 HMAC-SHA256 of merchant_id + merchant_oid + merchant_salt with merchant_key) and `parsePaytrStatusResponse` in `paytr-crypto.ts`: `paid` (status success; kuruş from PayTR's decimal strings via `parsePaytrDecimal`, `money.ts`, comma or dot), `not_paid` (err 004 only), `unknown` (001-003, refunds already made, other currency, unreadable amount, no answer). `queryPaytrStatus` in `paytr-gateway.ts` (`STATUS_TIMEOUT_MS` 5 s). |
| One apply path | `src/lib/payments/paytr-result.ts` `applyPaytrResult`: the notification (`callbacks.ts`) and the inquiry (`reconcile.ts`) complete a payment the same way (amount check, idempotent per merchant_oid, events, stock, e-mails through `completeCardPayment`). |
| Reconcile | `reconcileCardOrder` asks Durum Sorgu about an order's unsettled PayTR attempts (bounded by `paytrInquiryBudget`: deadline, per-call timeout, breaker after 3 failures). `paid` pays the order; `not_paid`/`unknown` change nothing. |
| Window | `src/lib/payments/paytr-window.ts` (pure): `PAYTR_VERIFY_WINDOW_MINUTES` = timeout_limit 30 + 15; the card page offers a form until 2 minutes before PayTR closes it (`PAYTR_FORM_USABLE_MS`); `paytrAttemptState`, `paytrWindowPassed`, `paytrUnverifiedAlertDue` (24 h). |
| Expiry (C2 + X2) | `expireStalePendingOrders` (`src/lib/orders/status.ts`): a PayTR order waits until its latest attempt is 45 minutes old, is cancelled (and restocked) only on `not_paid` for every unsettled attempt, paid on `paid`, kept on `unknown` (never cancelled). Each run is bounded (`EXPIRY_LIMITS`: 100 orders, 20 s budget, concurrency 3, 5 s per inquiry, breaker), so the "frequent" cron can run every 5 minutes on Vercel Pro. `core-jobs.ts` returns `expired, paid, waiting, unknown, deferred, failed`. |
| To-do (C3) | After 24 h of `unknown` the expiry job writes one `order_events` row `payment_unverified` (`src/lib/payments/unverified.ts`); the dashboard counts open orders carrying it ("Kart ödemesi doğrulanamadı") and the order page shows a warning: check at PayTR (the İşlemler page, by the merchant_oids the notice prints or the buyer's e-mail: §16.4), then "Ödeme alındı" or "İptal et". |
| No double charge (C4) | Inside the window without a result the order pages say "Ödemeniz doğrulanıyor" (`order.payment.verifying*`, `checkout.cardPayment.verifying*`, tr/en/ar) instead of a retry button; `retryCardPayment` refuses `verifying` under the order row lock and `checking` while PayTR cannot be reached; `checkBeforeCardRetry` asks PayTR first. The return poller (`CardReturnPoller`, `checkCardReturnAction(r, inquire)`) and the order page check (`CardPaymentCheck`) ask Durum Sorgu in their slow phase. While that attempt's form is still usable, the order page offers it again ("Ödeme formuna dön", `OrderPaymentPanel`). |
| C5 rule | `paytrTestResultForLiveAttempt` (one helper for both paths): a PayTR result with test_mode=1 for an attempt sent live on a public origin moved no money and never marks the order paid. |
| Mock | `/odeme/durum-sorgu` with its own token check; `/_mock/config` `paytrStatus` auto / paid / not_paid / error / down. |

### 16.2 A2: notification hardening and panel warnings (C5, C7, C8, C10, C13, refusals)

| Item | Change |
|---|---|
| C5 | `handlePaytrNotify`: a test payment for a live attempt is recorded as refused (`refuseCardResult`, `complete.ts`; reason `test_payment_on_live`, the open attempt's row becomes "failed", one `payment_refused` order event), answered "OK", never paid; the dashboard line "Canlı siparişe PayTR test ödemesi geldi" (72 h). Locally and for test-mode attempts nothing changes ("TEST ÖDEMESİ"). |
| Refusals | `src/lib/payments/alerts.ts`: bad hash, missing fields (also an unreadable body) and keys not configured are recorded in `audit_log` (entity `payment_notification`, action `refused`; never the body or hash; at most one row per kind per 10 minutes, one write per kind per 10 s per instance, `pg_try_advisory_xact_lock`). `notifyRefusalSummary` (72 h) feeds the dashboard line "PayTR bildirimleri reddediliyor" and the banner on /panel/ayarlar/odeme (reasons, count, last time, our merchant_oid, "Mağaza Bildirimleri" restart hint). Audit labels for the rows. Since §16.4 (R5) only refusals whose merchant_oid is a stored attempt of one of our orders are recorded; an unreadable body or a hand-made POST probe is logged only. A GET (405) is still the clean check. |
| C13 | (a) a success after a recorded failure for the same merchant_oid: one `payment_success_after_failure` event, a log line, no state change (dashboard line, 14 days); (b) a notification without Content-Type is read as a form (`http.ts`); (c) any get-token token without `/`, `?`, `#`, whitespace or control characters (≤ 512) is accepted (`isUsablePaytrToken`). |
| C8 | `paytrUserIp`: IPv4 as is, IPv6 compressed (≤ 39), IPv4-mapped IPv6 as IPv4, never cut; unusable → 127.0.0.1; the get-token hash uses the same value. |
| C10 | iade: 90 s timeout (`PAYTR_REFUND_TIMEOUT_MS`, the PHP sample's value) and `maxDuration = 120` on the panel order page; `paytrRefundErrorMessage`: 006/009 "it may already be refunded, check the PayTR panel", 010 "net balance too low". |
| C7 | Card page CSP `frame-ancestors 'self' <PayTR origin>; frame-src 'self' <PayTR origin> https:` (`card-page-csp.ts`; X-Frame-Options stays SAMEORIGIN). |
| Panel | `TodoCard`: the four PayTR lines are warnings (not counted as order work); admins are linked to /panel/ayarlar/odeme. `OrderEventList` labels for the new event types; the order page lists them as anomalies. |
| Mock | `paytrStoreTestMode`, `paytrRefund` err009 / err010 with a delay, `paytrToken` hex / base64 / slash, `contentType: "none"`. |

### 16.3 B: contract notice, sample links, panel texts, docs (S7, S17, C9, S8, C1, C11, C12)

| Item | Change |
|---|---|
| S7 notice | UI strings `footer.paytr.{notice,company,logoAlt}` (tr = the website reading of Çerçeve Sözleşme Art. 10.3, "Bu internet sitesindeki ödeme hizmetleri {company} tarafından sağlanmaktadır."; en/ar faithful translations; company = "PAYTR Ödeme ve Elektronik Para Kuruluşu A.Ş." everywhere), owner-editable in Arayüz Metinleri (sub-heading `footer.paytr`; `{company}` is required). `src/components/store/PaytrNotice.tsx` (server component): the company name is the link to `PAYTR_WEBSITE_URL` (https://www.paytr.com, new tab, `<bdi>`), plus the optional logo on a white plate. |
| S7 where | Card page `/odeme/kart`: under the PayTR iframe whenever the form shows (the page exists only for PayTR). Footer: only while `paytrNoticeInFooter` (`src/lib/payments/paytr-notice.ts`, pure) holds: `card.enabled && provider === "paytr" && !testMode`, PayTR keys configured (`paytrEnv()`) and no simulator. Cached settings (tag `settings`, refreshed by the panel save) plus the deployment's environment (changes only with a redeploy), so the footer stays in the static shell. |
| S7 logo slot | `settings.payments.paytrLogoImageId` (top-level `mediaId.default(null)`; panel input `mediaIdInput`; `checkReferences` → `ensureMediaExist(…, "paytrLogoImageId")`, images only; audit label "PayTR logosu"; media usage "Ayarlar › Ödeme yöntemleri / PayTR logosu" via the `ImageId` key rule, so the image cannot be deleted while used). Picker in `PaymentSettingsForm` (page loads it with `getPanelMedia`). No logo file ships: the owner uploads PayTR's own file (PayTR panel, or the PayTR_Gorselleri.zip link in the dev.paytr.com FAQ); nothing renders without it. The go-live copy prints `paytrLogoImageId (none) -> null` in its parsed-form line. |
| S17 samples | `src/lib/samples/visibility.ts` (pure): `samplesSwitchedOff` (both switches off), `isSamplesHref` (relative links, any language form, query/anchor; equal to the go-live `announcementFeature(...) === "samples"`, unit-tested), `withoutSamplesMenuItems` (recursive), `withoutSamplesSections` (main CTA `cta`/hero `primaryCta` to /numune → section left out; other buttons and `href` links → removed; texts untouched). Header and footer filter their menus and fallbacks; `getStorefrontPage(slug)` (`src/lib/data/pages.ts`: `getPage` + cached `getSettings("samples")`, /numune returned as stored) is used by home, `/sayfa/[slug]`, `/urunler` and `CmsPageView`; metadata keeps `getPage`. /numune shows its closed note from `SampleRequestForm`. Owner texts that still mention samples are listed in docs/GO-LIVE.md and the owner guide. |
| Panel texts | `PaymentReadiness`: keys under Destek & Kurulum › Entegrasyon Bilgileri (formerly "Bilgi"; no user role is documented, §16.4); Bildirim URL Ayarları with protocol HTTPS, exactly as shown, no trailing slash, never *.vercel.app (`isVercelAppUrl` warning when the site URL is one); application form (Sanal POS, Limited Şirket, "kendi yazılımımız, iFrame API"); no PayTR Havale/EFT product or interim notification URL; the live-mode order (test payment "Ödendi" → Destek & Kurulum › Canlı Mod: "Evet, Entegrasyonu Tamamladım" → "Canlı Moda Geçiş Talebi Gönder" → PayTR's SMS or e-mail → test mode off → small real payment and refund; 010 on the first day is not a site bug). `PaymentSettingsForm`: test-mode and installment hints, the logo field and where the notice shows. |
| Docs | docs/YAYINA-ALMA-REHBERI.md §2.2, §2.5, §4.1 (PayTR step by step), §5 (samples off, first weeks with card, dashboard warnings); docs/GO-LIVE.md (sample links, Level 3); the go-live RUNBOOK (A7, C12, Phase D, risk 9). |

### 16.4 FIX after the review (R1, R2, R4-R7, R-UX1-R-UX8)

| Item | Change |
|---|---|
| R1 inquiry amounts | `parsePaytrDecimal` returns null for a single "." or "," followed by exactly three digits ("1.500", "1,500", "2.000", "10.000": tr-TR thousands or decimal, never guessed). `reconcileCardOrder` applies a Durum Sorgu "paid" only when `paytrChargedAmount(total, requested)` equals the order total (requested = the attempt's payment_amount, else grandTotal); otherwise it writes nothing, logs both amounts and counts the attempt as unknown (the expiry never cancels, a retry answers "checking", the 24 h to-do follows). Only the hash-verified notification records a short payment. Defence in depth in `completeCardPayment`: a failed row with `raw.source = "durum-sorgu"` and `reason = "amount_mismatch"` is replaced (same row) by a non-inquiry success with the exact total. |
| R2 two tabs | `initiateCardPayment` writes `payments.raw.startingAt` under the order row lock before get-token and removes it when the attempt is stored or the start failed; a retry (`notWhileVerifying`) is refused with "verifying" while a marker is younger than `ATTEMPT_STARTING_MS` (60 s, longer than the 20 s get-token timeout). Behavioural DB test with two concurrent retries against a slow stubbed get-token. |
| R4 iyzico in the expiry | `reconcileCardOrder({ iyzicoBudget })`: the expiry passes its run deadline, `EXPIRY_LIMITS.iyzicoTimeoutMs` (10 s; `retrieveIyzicoCheckout` takes `timeoutMs`) and a breaker (`maxInquiryFailures`); skipped retrieves count as unknown. A run ends within about the budget plus one timeout. |
| R5 refusals | `notePaytrNotifyRefusal` records a refusal only when the posted merchant_oid is a stored attempt of one of our orders (`parsePaytrMerchantOid` → order → `findAttempt`), for every kind; an unreadable body is logged only. Dashboard hint and settings banner say that a single refusal can still be a forgery that leaves orders untouched. `not_configured` is not gated on the selected provider: after this rule it can only come from one of our attempts, whose payment would otherwise go unnoticed. |
| R6 refunds | `paytrRefundErrorMessage`: 007 → restart the stuck notifications in Mağaza Bildirimleri, then retry; 000 → try again in a few minutes. |
| R7 no stored attempt | `handlePaytrNotify`: without a stored attempt the panel's current test mode stands in for the attempt's (as for iyzico), so a test_mode=1 success on a live site is refused (`refuseCardResult`), not paid. `loadPaymentSettings(exec)`. |
| R-UX1 | Owner guide and GO-LIVE list the 6 blog posts and 3 category bodies (tr/en/ar) that still link `/numune`. |
| R-UX2 | `TodoCard`: "Bekleyen iş yok; ödeme uyarılarını kontrol edin" while a payment warning shows (and "düşük stoklu varyantlara göz atın" for low stock), never "her şey yolunda" above a warning. |
| R-UX3 | Dashboard hint, timeline text and owner guide: switch the test mode back on (it was switched off too early), keep it on until PayTR's SMS or e-mail. |
| R-UX4 | Panel, owner guide, GO-LIVE and RUNBOOK: "Entegrasyon Bilgileri (eski adı: Bilgi)"; the unsupported user-role sentence is replaced by "göremiyorsanız ana kullanıcıyla girin ya da PayTR'ye sorun". |
| R-UX5 | `verifyingFormText` / `order.payment.verifyingRetryAt` (tr/en/ar): without a payment the order is cancelled automatically shortly after {time}. |
| R-UX6 | The order page's "Ödeme formuna dön" is a secondary button with an explicit text (not paid or declined; same form, no second charge); after a merchant_fail_url return the poller's slow screen uses `checkout.cardPayment.verifyingFailedText` (no "do not pay again"). |
| R-UX7 | "Kart ödemesi doğrulanamadı" notice prints the order's unsettled merchant_oids (`OrderDetail.paytrUnsettledRefs`) and the buyer's e-mail as search keys for PayTR's İşlemler page (menu named neutrally); the timeline text says the same. |
| R-UX8 | `countPaymentEventAlerts` also returns the order id when one order is affected; `TodoCard` links the C5/C13a lines to that order, or to `/panel/siparisler?uyari=test-odeme` or `?uyari=basarisiz-sonra-basarili` (`paymentEventAlertWhere`, same rule as the count). Admins keep the settings link on the C5 line and get a second line "Test ödemesi gelen sipariş". |

Tests: `tests/unit/paytr-fix-r.test.ts`, `tests/db/paytr-fix-r.test.ts`; the A1/A2/B tests were updated where the
behaviour changed (the a1 "lower amount" test now expects nothing written; the a1 regex test on the lock was replaced
by the behavioural R2 test; the a2 refusal test seeds stored attempts).

### 16.5 Left open on purpose

- C6/S22: the iframe keeps `referrerPolicy="no-referrer"` (no official PayTR rule); switch to `origin` only if PayTR
  reports a referrer or domain error during the test payment.
- Partial refunds stay manual at PayTR (plus an order note; never "Kart iadesi yap" afterwards). Installments stay
  effectively off (`maxInstallments` 1) until the lawyer's texts cover them. PayTR Havale/EFT and Linkle Ödeme are
  not integrated.
- Owner and lawyer items (S1-S6, S9-S16, S18, S21, S23) are in the RUNBOOK and the owner guide, not in code.
