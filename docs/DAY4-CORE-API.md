# Day 4 core API (e-mail, cron, durable limits, auth, routes, viewer)

This file covers what CORE ships for the seven day-4 builders. CORE-DATA and CORE-COMMS wrote the code;
CORE-CHECK reconciled and verified it. Read `docs/DAY4-COMMERCE.md` (the contract) first. This file
documents the code behind the contract's CORE section.

**pure** means no DB and no Next request APIs: safe in client components and unit tests. If a signature
here disagrees with the code, the code wins; say so in your report. Everything below was exercised on
2026-11-10 (see §13).

## 0. File map

| File | What |
|---|---|
| `drizzle/0003_day4.sql` | The day's only migration (applied). Builders never change the schema. |
| `src/db/schema/system.ts` | `emailMessages`, `rateLimitCounters`, `jobRuns` (+ `EmailStatus`, `EmailRelatedType`, `JobRunStatus`) |
| `src/db/schema/{auth,catalog,commerce,marketing}.ts` | `rateLimit` (Better Auth), `favorites`, the new columns (§1) |
| `src/lib/signed-token.ts` (no `server-only`, node crypto) | `signToken`, `verifyToken`, `createTokenSigner` |
| `src/lib/rate-limit.ts` (pure) | limit types, `memoryLimitStore`, sliding-window math, `clientIpFrom` |
| `src/lib/rate-limit-store.ts` | durable Postgres limits: `consumeLimits`, `checkLimits`, `forgetLimits`, `pruneRateLimits`, `dbLimitStore` |
| `src/lib/auth-limits.ts` (pure) | per-e-mail sign-in lock, Better Auth IP rules, blocked admin paths |
| `src/lib/cron/registry.ts` (pure) | `registerJob`, `listJobs`, `getJob`, `JOB_GROUPS` |
| `src/lib/cron/run.ts` | `runJob`, `runJobGroup`, `runJobNow`, `listJobStatus` (advisory locks + `job_runs`) |
| `src/lib/cron/handler.ts`, `src/app/api/cron/[group]/route.ts` | `GET|POST /api/cron/<frequent|daily>` (Bearer `CRON_SECRET`) |
| `src/lib/cron/jobs.ts` | **shared**: one import line per area job module |
| `src/lib/cron/core-jobs.ts`, `opportunistic.ts` | `orders.expire`, `carts.prune`, `ratelimits.prune`, `auth.prune`; expiry after `placeOrder` |
| `src/lib/email/index.ts` | **the e-mail API** (`@/lib/email`, server-only; importing it registers every template) |
| `src/lib/email/types.ts` (pure) | blocks, `EmailContent`, `EmailBuildContext`, `EmailTemplateRegistry`, `TemplateKey` |
| `src/lib/email/templates/index.ts` | **shared**: one import line per area template file |
| `src/lib/email/templates/account.ts` | `account_verify`, `password_reset` (core) |
| `src/lib/email/{queue,preview,registry,render,blocks,layout,theme,escape,environment,unsubscribe,jobs}.ts`, `drivers/*` | internals behind `@/lib/email` |
| `src/lib/auth.ts` | Better Auth config (verification required, reset, hooks, DB rate limit) |
| `src/lib/auth-emails.ts` | Better Auth → `account_verify` / `password_reset` mails |
| `src/lib/customer/auth-events.ts` | `onEmailVerified`, `onPasswordReset` (**empty: ACCOUNTS fills them**) |
| `src/lib/customer/viewer.ts` (pure), `viewer-actions.ts` (`"use server"`) | `ViewerState`, `loadViewer()` |
| `src/components/store/viewer/ViewerProvider.tsx` (client) | `ViewerProvider` (mounted in `src/app/[locale]/layout.tsx`), `useViewer()` |
| `src/app/[locale]/hesap/dogrula/*`, `src/components/store/account/VerifyEmailForm.tsx` | the verification landing page |
| `src/i18n/paths.ts` (pure), `src/proxy.ts` | localized second-level segments, `/hesap` gate, `safeReturnPath`, `signInHref` |
| `scripts/panel-test-user.ts` | throwaway staff **and customer** users (`create`, `cookie`, `delete`) |
| `scripts/cron-local.mjs` | calls `/api/cron/*` locally (once or on an interval) |
| `vercel.json` | daily Vercel crons for both groups |

## 1. Schema (migration `0003_day4.sql`, applied)

New tables (TS name → table):
- `emailMessages` → `email_messages`: the outbox and the log.
  - Columns: `id`, `template`, `toEmail`, `locale`, `subject`, `html`, `text`, `headers` (jsonb, List-Unsubscribe only), `status`, `attempts`, `lastError`, `sendAfter`, `relatedType`, `relatedId` (**text**: holds order ids and Better Auth user ids), `dedupeKey`, `createdBy`, `sentAt`, `createdAt`, `updatedAt`.
  - Indexes: `(status, send_after)`, `(related_type, related_id)`, `(created_at)`, `email_messages_dedupe_key_unique` (partial, where not null).
- `favorites` → `favorites`: `userId` (cascade), `productId` (cascade), `createdAt`; PK `(user_id, product_id)`; index on `product_id`.
- `rateLimitCounters` → `rate_limit_counters`: `key` (hashed), `windowStart`, `count`, `expiresAt`; PK `(key, window_start)`.
- `jobRuns` → `job_runs`: `job` PK, `lastStartedAt`, `lastFinishedAt`, `lastStatus`, `lastResult` (counts), `lastError` (error class / SQLSTATE only), `runCount`.
- `rateLimit` → `rate_limit` (Better Auth `storage: "database"`): `id`, `key` unique, `count`, `lastRequest` (bigint epoch ms).

New columns:

| Table | Columns |
|---|---|
| `orders` | `subscriptionId` (FK subscriptions, SET NULL, indexed), `reviewRequestedAt` |
| `subscriptions` | `email` (NOT NULL), `locale` (default `tr`), `paymentMethod` (NOT NULL), `skipNext` (default false), `reminderSentAt`, `cancelledAt`, `failedCount` (default 0) |
| `newsletter_subscribers` | `status` adds `pending` (**DB default stays `active`: insert `pending` explicitly**), `confirmTokenHash` (unique partial), `confirmedAt`, `unsubscribedAt`, `consentSource`, `consentIpHash` |
| `quote_requests` | `offer` (jsonb `QuoteOffer`), `quotedAt`, `consentAt` |
| `sample_requests` | `approvedAt`, `shippedAt`, `carrier`, `consentAt` |
| `companies` | `applicantUserId` (FK user, SET NULL), `rejectedAt`, `rejectionReason` |
| `email_campaigns` | `createdBy`, `localeMode` (`"per_subscriber"`) |

New unique partial indexes: `product_variants_barcode_unique` (barcode not null/empty),
`reviews_product_user_unique`, `reviews_product_order_unique`, `email_messages_dedupe_key_unique`,
`newsletter_subscribers_confirm_token_hash_unique`.

Types: `EmailStatus`, `EmailRelatedType`, `JobRunStatus` (system.ts), `QuoteOffer`, `CompanyStatus`, `SubscriptionStatus` (commerce.ts), `NewsletterStatus` (marketing.ts).

Data fixes: every staff role has `email_verified = true` (0 rows needed it today).

A unique violation inside `panelAction` still comes back as a generic `invalid`. Check reviews,
barcodes and dedupe keys yourself first.

## 2. Settings (new keys; `src/lib/settings/types.ts`)

```ts
getSettings("emails")         // cached storefront read (tag `settings`); loadEmailSettings() for a fresh read
// emails:        { fromName: "PRESTİJ", replyTo: "" /* "" = general.email */, adminRecipients: [] /* [] = general.email */,
//                  footerNote: { tr: "" }, templates: {} /* Record<key, { enabled; subject?: LocalizedText; intro?: LocalizedText }> */ }
// reviews:       { enabled: true, allowGuestLinks: true, requestDaysAfterDelivery: 7, minLength: 10 }
// subscriptions: { enabled: true, reminderDaysBefore: 3, allowedMethods: ["card", "bank_transfer"], cardPaymentWindowHours: 72 }
// payments.card.maxInstallments: 1 (1–12)
EMAIL_TEMPLATE_KEY = /^[a-z][a-z0-9_]{1,63}$/     // also the registry's key rule (CORE-CHECK aligned them)
SUBSCRIPTION_PAYMENT_METHODS = ["card", "bank_transfer", "cash_on_delivery"] as const
```
- Panel inputs (`src/lib/panel/settings/schemas.ts`): `emailSettingsInput`, `emailTemplateOverrideInput`, `reviewSettingsInput`, `subscriptionSettingsInput`. All three are already in `SETTINGS_INPUTS` and in `SAVED_MESSAGE`.
- `parseSettings` keeps every valid top-level field and resets only the broken ones.
- **Settings pages (done by the builders):** `SETTINGS_PAGES` now has `e-posta` (NOTIFY), `yorumlar` (REVIEWS) and `abonelik` (SUBSCRIPTIONS), with their pages and save actions. The recipe they followed, for any later settings key:
  - the entry (slug `e-posta` → NOTIFY, `yorumlar` → REVIEWS, `abonelik` → SUBSCRIPTIONS);
  - the page `src/app/panel/(dashboard)/ayarlar/<slug>/page.tsx` (copy `numune/page.tsx`);
  - one line in the shared `src/app/panel/(dashboard)/ayarlar/actions.ts`: `export const saveReviewSettingsAction = panelAction(settingsActionOptions("reviews"));`

## 3. Signed tokens (`src/lib/signed-token.ts`)

```ts
signToken(purpose: string, payload: Record<string, unknown>, ttlSeconds?: number): string   // no ttl = never expires
const t = signToken("review", { o: order.id, p: product.id }, 60 * 60 * 24 * 60);
verifyToken<T>(purpose: string, token: unknown): { ok: true; payload: T; expiresAt: Date | null } | { ok: false; reason: "malformed" | "invalid" | "expired" }
const r = verifyToken<{ o?: unknown; p?: unknown }>("review", query.degerlendir); if (!r.ok) return notFound();
createTokenSigner(secret: string | (() => string), { now?: () => number }): TokenSigner   // unit tests: own secret + clock
MAX_TOKEN_LENGTH = 2048
```
- The purpose must match `/^[a-z][a-z0-9._-]{1,63}$/`. One purpose per link type. In use: `newsletter-unsubscribe` (core, payload `{ s: subscriberId }`). Suggested: `review`, `newsletter-confirm`, `subscription-skip`.
- The payload is signed, not encrypted. Put ids in it, never personal data. Validate its shape and re-read every id from the DB.
- Single use is your job (unique index or a "used" column). Rotating `BETTER_AUTH_SECRET` voids every link.

## 4. Durable rate limits

```ts
// src/lib/rate-limit.ts (pure)
type RateRule = { limit: number; windowMs: number };          // windowMs ≥ 1000
type LimitEntry = readonly [key: string, rule: RateRule];     // key "<area>:<dimension>:<value>"
type LimitDecision = { allowed: boolean; retryAfterMinutes: number };
clientIpFrom(headers): string                                  // request code: `await clientIp()` from @/lib/request-ip

// src/lib/rate-limit-store.ts (server-only)
consumeLimits(entries: readonly LimitEntry[], options?: { now?: number; executor?: Tx }): Promise<LimitDecision>
const d = await consumeLimits([[`quote:ip:${ip}`, { limit: 5, windowMs: 3_600_000 }], [`quote:email:${email}`, { limit: 20, windowMs: 86_400_000 }]]);
if (!d.allowed) return { formError: format(m.rateLimited, { minutes: d.retryAfterMinutes }) };
checkLimits(entries, options?): Promise<LimitDecision>            // read-only
const { retryAfterMinutes } = await checkLimits(keys); if (retryAfterMinutes > 0) return tooMany(retryAfterMinutes);
forgetLimits(keys: readonly string[], options?: { executor?: Tx }): Promise<void>
await forgetLimits([`quote:email:${email}`]);                   // tests / after a success that resets a counter
pruneRateLimits({ now?, only?: { keys?, authKeys? } }): Promise<{ counters: number; authRows: number }>   // the job; tests pass `only`
storedLimitKey(key: string): string                               // "quote:ip:<sha256 32 chars>" (what the table holds)
dbLimitStore: LimitStore                                          // for code that takes a store (auth-limits.ts)
```
- **Two patterns.**
  - Gate on every attempt: `consumeLimits` first, act only when `allowed`. Use it for public forms such as quote, sample, newsletter and review.
  - Count outcomes only: `checkLimits` first; after the outcome (a failed lookup, a placed order), call `consumeLimits`. Use it where only failures or successes should count.
- One atomic upsert per key: 20 parallel consumes against a limit of 5 allow exactly 5.
- Sliding-window counter (no 2× burst at a window edge). Keys are stored hashed, so the table holds no e-mail or IP.
- A consume counts against every key that still has room, even when another key is the one that blocks.

Keys in use:

| Key | Limit | Counts | Where |
|---|---|---|---|
| `order:ip:<ip>` | 10 / h | placed orders | `src/app/[locale]/odeme/actions.ts` |
| `order:email:<e>`, `order:phone:<+90…>` | 5 / h | placed orders | same |
| `lookup:ip:<ip>` | 8 / 15 min | failed lookups | `src/app/[locale]/siparis/_lib/throttle.ts` |
| `lookup:order:<PR-…>:<ip>` | 5 / h | failed lookups | same |
| `coupon:ip:<ip>` | 15 / 15 min | failed codes | `src/lib/cart/actions.ts` |
| `contact:ip:<ip>` | 5 / h | stored messages + honeypot hits | `src/lib/contact/throttle.ts` |
| `contact:email:<e>` | 20 / day | stored messages | same (+ DB site cap 50 / 10 min) |
| `auth:sign-in-failure:<e>` | 10 / 15 min | 401 sign-ins (any IP) | `src/lib/auth-limits.ts` via `auth.ts` hooks → 429 `TOO_MANY_FAILED_SIGN_INS` |
| Better Auth `<ip>\|<path>` (`rate_limit`, **production only**) | sign-in 5 / 60 s, sign-up 10 / h, request-password-reset 5 / h | requests | `AUTH_RATE_LIMIT_RULES` |

Contract limits for builders: quote 5/h/IP and 20/day/e-mail (REQUESTS). Use the same `<area>:<ip|email>:<value>` form, and lower-case e-mails before building keys.

Keys the builders added (final check, 2026-11-10; read from the code):

| Key | Limit | Where |
|---|---|---|
| `quote:ip:<ip>` / `sample:ip:<ip>` | 5 / h | `src/lib/requests/throttle.ts` (+ site cap 30 stored per form / 10 min) |
| `quote:email:<e>` / `sample:email:<e>` | 20 / day | same |
| `newsletter:ip:<ip>`, `newsletter:email:<e>` | 10 / h, 3 / day | `src/app/[locale]/actions/newsletter.ts` |
| `newsletter-link:ip:<ip>` | 30 / h (confirm / unsubscribe presses) | same |
| `review:ip:<ip>`, `review:user:<id>` | 10 / h, 20 / day | `src/lib/reviews/types.ts` (`REVIEW_RATE_RULES`) |
| `signin:ip:<ip>` | 30 failed / 15 min | `src/lib/account/auth-actions.ts` |
| `register:ip:<ip>`, `register:email:<e>` | 10 / h, 3 / h | same |
| `forgot:ip:<ip>`, `forgot:email:<e>`, `reset:ip:<ip>` | 10 / h, 5 / h, 20 / h | same |
| `password:user:<id>` | 5 wrong passwords / 15 min | `src/lib/account/actions.ts` (change password, delete account) |
| `marketing:user:<id>`, `favorites:user:<id>` | 5 / h, 120 / 10 min | same |
| `business:user:<id>`, `business:ip:<ip>` | 5 / day, 10 / h | `src/app/[locale]/hesap/kurumsal/actions.ts` |
| `subscription:user:<id>` | 30 changes / h | `src/lib/subscriptions/actions.ts` |
| `paycb:ip:<ip>` | 30 / 10 min | `src/lib/payments/http.ts` (iyzico callback) |
| `paycheck:order:<id>` | 60 / h | `src/app/[locale]/siparis/actions.ts` (`checkCardPaymentAction`) |
| `email-test:user:<id>` | 20 / h | `src/lib/panel/emails/test-send.ts` (`TEST_SEND_RULE`) |

## 5. E-mail system (`@/lib/email`, server-only)

### 5.1 API

```ts
enqueueEmail<K extends TemplateKey>(tx: Tx, input: EnqueueEmailInput<K>): Promise<{ id: number; status: EmailStatus } | null>
//  input = { template: K; to: string; locale: string; data: EmailDataFor<K>; related?: { type: EmailRelatedType; id: string | number } | null;
//            dedupeKey?: string | null; sendAfter?: Date | null; createdBy?: string | null; unsubscribe?: UnsubscribeLinks | null }
await db.transaction(async (tx) => { /* business change */
  await enqueueEmail(tx, { template: "quote_offer", to: q.email, locale: q.locale, data, related: { type: "quote", id: q.id }, dedupeKey: `quote:${q.id}:offer:customer` }); });
```
- The mail is rendered at enqueue time and inserted in the **caller's** transaction.
- It returns `null` when the template is switched off in the panel or the dedupe key is already used.
- An invalid recipient or a render error is stored as `failed` with a short reason; it does not throw. An unknown template key, or a marketing template without `unsubscribe`, throws.
- It calls `scheduleEmailFlush()` itself.

```ts
flushEmailQueue(opts?: { limit?: number; ids?: number[]; driver?: EmailDriver | null; now?: Date }): Promise<{ claimed; sent; retried; failed; notConfigured }>
await flushEmailQueue({ ids: [row.id], driver: fakeDriver });       // DB tests: ALWAYS pass ids (shared DB) and a driver
scheduleEmailFlush(): boolean                                        // after() → flush; false (no-op) outside a request
cancelQueuedEmail(tx: Tx, id: number): Promise<boolean>              // queued → cancelled
requeueEmail(tx: Tx, id: number, { createdBy? }): Promise<{ id; status } | null>   // "Tekrar gönder": a copy, no dedupe key; null for account_verify / password_reset (§15)
await db.transaction((tx) => requeueEmail(tx, id, { createdBy: actor.user.id }));
sendTestEmail(template: string, to: string, locale: string, { createdBy?, overrides?: { subject?, intro? } }): Promise<{ ok: true; id } | { ok: false; error }>
const r = await sendTestEmail("order_paid", actor.user.email, "ar", { createdBy: actor.user.id });   // "[Test] " subject, ignores on/off
renderEmailPreview(template: string, locale: string, overrides?: { subject?, intro? }): Promise<{ subject; preheader; html; text; template; locale } | null>
const p = await renderEmailPreview(key, "en", { subject: draftSubject });  // sample data; show p.html in <iframe sandbox srcDoc>
emailTemplateDefaults(template: string, locale: string): Promise<{ subject: string; intro: string } | null>   // built-in texts, placeholders unfilled
adminRecipients(executor?: Tx): Promise<string[]>                    // settings list → general.email → []
for (const to of await adminRecipients(tx)) await enqueueEmail(tx, { template: "admin_new_order", to, locale: "tr", data, dedupeKey: `order:${id}:new:admin:${to.toLowerCase()}` });
listEmailTemplates(): { key; label; description; audience; marketing; placeholders }[]   // panel editor list (sorted by label)
getEmailTemplate(key: string): EmailTemplate | null
emailDriverStatus(): { driver: "outbox" | "smtp" | "none"; ready: boolean; fromAddress: string | null; problem: string | null }   // Turkish problem text
isEmailAddress(value: unknown): value is string
findPlaceholders(text): string[];  unknownPlaceholders(text, allowed: readonly string[]): string[]   // validate panel overrides
const bad = unknownPlaceholders(input.subject.tr, [...tpl.placeholders, ...GLOBAL_PLACEHOLDERS]);
loadEmailSettings(executor?: Tx): Promise<{ general; emails }>;  loadEmailEnvironment(tx, locale): Promise<EmailRenderEnvironment>
newsletterUnsubscribeLinks(subscriberId: number, locale: Locale): { url: string; oneClickUrl: string }
await enqueueEmail(tx, { template: "newsletter_campaign", …, unsubscribe: newsletterUnsubscribeLinks(sub.id, sub.locale) });
readNewsletterUnsubscribeToken(token: unknown): number | null       // subscriber id; re-read the row
newsletterUnsubscribeToken(id: number): string; NEWSLETTER_UNSUBSCRIBE_PURPOSE = "newsletter-unsubscribe"; ONE_CLICK_UNSUBSCRIBE_PATH = "/api/newsletter/unsubscribe"
EMAIL_MAX_ATTEMPTS = 5; EMAIL_BACKOFF_MINUTES = [1, 5, 15, 60]; EMAIL_FLUSH_LIMIT = 25; GLOBAL_PLACEHOLDERS = ["siteName"]
EMAIL_STATUSES, EMAIL_RELATED_TYPES                                   // arrays for panel filters (compile-time checked against the schema)
```

### 5.2 How a mail is built

- **Template:** `build(data, ctx)` returns `{ subject, preheader?, blocks }`. `ctx: EmailBuildContext` has:
  - `locale` and `dir`;
  - `messages`: the full UI dictionary, with panel overrides;
  - `settings.general` and `settings.emails`;
  - `siteUrl` and `url(path)` (absolute);
  - `formatPrice(kurus)`, `formatDate(value, { time? })` (Europe/Istanbul) and `format(template, vars)` (i18n plurals).
- **Blocks** (all text is PLAIN; the renderer escapes it):

| Block | Fields |
|---|---|
| `heading` | `text`, `eyebrow?`, `level?` (1 or 2) |
| `paragraph` | `text`, `tone?` (`muted`), `size?` (`sm`). A newline becomes a line break, a blank line a new paragraph. |
| `button` | `label`, `url` (absolute or site path; unsafe URLs render the label only), `variant?` (`secondary`), `showUrl?` |
| `keyValue` | `title?`, `rows: { label, value }[]` |
| `orderLines` | `title?`, `lines: { name, detail?, quantity, total, unitPrice?, imageUrl? (absolute JPEG/PNG/WebP, 64×64), accent?, badge? }[]` |
| `totals` | `rows: { label, value, kind?: "default" \| "discount" \| "total" \| "note" }[]` |
| `notice` | `text`, `title?`, `tone?` (`info`, `success`, `warning`) |
| `divider` | none |
| `bankAccounts` | `title?`, `accounts`, `reference?: { label, value }`, `note?`, `labels?` |
| `richText` | `html` (sanitized; campaign bodies) |

- **Placeholders.**
  - `{name}` tokens in heading, paragraph, notice, button label, keyValue label, subject and preheader are filled **after** escaping.
  - Values come from `siteName`, then `data[placeholder]` for every declared placeholder, then `variables(data, ctx)`.
  - Declare every token the panel may use in `placeholders` (shown as chips).
- **Panel overrides.** `settings.emails.templates[key].subject[locale]` replaces the subject. `.intro[locale]` replaces the **first paragraph** block, so make your first paragraph the intro. An empty override for a locale means the built-in text; there is no fallback to Turkish.
- **Layout:**
  - table-based, with inline styles;
  - a PNG logo (`/media/marka/prestij-logo.png`, absolute from `NEXT_PUBLIC_SITE_URL`) and a gold hairline;
  - serif headings and navy pill buttons;
  - `dir="rtl"` with right alignment for ar, while URLs, phone numbers and prices stay LTR;
  - a footer with `general` company data, `footerNote`, and the transactional or marketing reason;
  - marketing mails add the unsubscribe link and the List-Unsubscribe headers (stored in `headers`);
  - a plain-text part.
- **Drivers:**
  - `EMAIL_DRIVER=outbox` (the default outside production) writes `storage/mail-outbox/<stamp>-<template>-<id>.html|.txt|.json`. `EMAIL_OUTBOX_DIR` overrides the folder.
  - `smtp` uses nodemailer with `EMAIL_SMTP_URL` and `EMAIL_FROM`.
  - Production without `smtp` gives `none`: mails stay queued and the panel shows `emailDriverStatus().problem`.
  - Logs carry only the id and the template.

### 5.3 How to add a template (full example)

1. Add the texts to the messages (tr/en/ar, same shape, Edit tool, re-read first).
   - **Convention:** one sub-object per area inside the shared `email` group, e.g. `email.reviews: { request: { subject, preheader, eyebrow, heading, intro, button, … } }`.
   - Add its Turkish name to `src/lib/panel/ui-strings/catalog.ts` (e.g. `"email.reviews": "Yorum e-postaları"`). Without it, Arayüz Metinleri shows the raw key; no test catches that.
   - Put `{placeholders}` into the texts and declare them below.
2. Create `src/lib/email/templates/<area>.ts`:

```ts
// src/lib/email/templates/reviews.ts
import { defineEmailTemplate } from "../registry";

export type ReviewRequestEmailData = {
  name: string;
  orderNumber: string;
  products: { name: string; detail: string | null; imageUrl: string | null; url: string }[]; // url = signed ?degerlendir= link
};

declare module "../types" {
  interface EmailTemplateRegistry {
    review_request: ReviewRequestEmailData;
  }
}

export const reviewRequestEmail = defineEmailTemplate({
  key: "review_request",
  audience: "customer",
  label: "Değerlendirme isteği",
  description: "Teslimattan birkaç gün sonra müşteriden ürünlerini değerlendirmesi istenir.",
  placeholders: ["name", "orderNumber"],
  sample: () => ({
    name: "Ayşe",
    orderNumber: "PR-261001",
    products: [{ name: "Lavanta Sıvı El Sabunu", detail: "500 ml", imageUrl: null, url: "https://prestij.com.tr/tr/urunler/lavanta?degerlendir=ornek" }],
  }),
  build: (data, ctx) => {
    const m = ctx.messages.email.reviews.request;
    return {
      subject: m.subject, // "{orderNumber} siparişiniz nasıldı?"
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro }, // first paragraph = the panel's "intro"
        ...data.products.flatMap((p) => [
          { type: "orderLines" as const, lines: [{ name: p.name, detail: p.detail, quantity: 1, total: "", imageUrl: p.imageUrl }] },
          { type: "button" as const, label: m.button, url: p.url, variant: "secondary" as const },
        ]),
        { type: "paragraph", text: m.footer, tone: "muted", size: "sm" },
      ],
    };
  },
});
```

3. Add **one line** to `src/lib/email/templates/index.ts` with the Edit tool: `import "./reviews";`.
4. Enqueue it in the same transaction as the business change. The key and the data type are checked by tsc:
   `await enqueueEmail(tx, { template: "review_request", to, locale, data, related: { type: "order", id }, dedupeKey: \`order:${id}:review_request:customer\` });`
5. Check the result: `renderEmailPreview("review_request", "ar")` in a unit or DB test, or the outbox files (§10).

Admin mails: use `audience: "admin"`, `locale: "tr"`, and one row per recipient from `adminRecipients(tx)`.
Marketing mails: set `marketing: true` and always pass `unsubscribe`.

### 5.4 Dedupe-key convention

Format: `<relatedType>:<id>:<event>:<audience>[:<qualifier>]`. Lower case, at most ~200 characters, no secrets.

| Case | Key |
|---|---|
| Customer mail per event | `order:12:paid:customer`, `order:12:shipped:customer`, `quote:7:offer:customer` |
| Admin mail (one row per recipient) | `order:12:new:admin:<recipient lower-cased>` |
| Once per order | `order:12:payment_failed:customer`, `order:12:review_request:customer` |
| Once per period | `subscription:5:remind:<next_run_at as YYYY-MM-DD>`, `subscription:5:payment_due:<renewal order id>` |
| Campaign | `campaign:3:subscriber:812` |
| Once ever per user | `user:<id>:welcome` |
| Throttled repeat (core) | `user:<id>:verify:<floor(now / 120 s)>`, `user:<id>:reset:<bucket>` |
| Never deduped | test sends, `requeueEmail` copies (null) |

Rules:
- A key is used **forever**, whatever the row's status. A `failed` or `cancelled` row still blocks it. To send again, use `requeueEmail` or a new qualifier.
- A dedupe hit still consumes an id from `email_messages_id_seq` (ON CONFLICT DO NOTHING), so ids have gaps.

## 6. Scheduled jobs

```ts
// src/lib/cron/registry.ts (pure)
registerJob({ key: "<area>.<action>", group: "frequent" | "daily", label?: string, run: () => Promise<Record<string, number>> }): JobDefinition
listJobs(group?: JobGroup): JobDefinition[];  getJob(key): JobDefinition | null;  isJobGroup(v): v is JobGroup;  JOB_GROUPS = ["frequent", "daily"]
unregisterJob(key)                                  // tests only
// src/lib/cron/run.ts
runJob(job: JobDefinition): Promise<{ key; status: "ok" | "error" | "skipped"; durationMs; result? }>   // advisory lock, job_runs row, never throws
const out = await runJob(reviewsRequestJob); assert.equal(out.status, "ok");   // DB test (delete its job_runs row afterwards)
runJobGroup(group): Promise<{ group; ok; jobs }>;  runJobs(jobs);  loadJobs()
runJobNow(key: string): Promise<JobOutcome | null>   // panel "Şimdi çalıştır": the CALLER checks admin
listJobStatus(): Promise<{ key; group; label; lastStartedAt; lastFinishedAt; lastStatus; lastResult; lastError; runCount; running }[]>   // staff
sanitizeCounts(v): Record<string, number>
// src/lib/cron/handler.ts
handleCronRequest(request, group, deps?: { runGroup?; secret? }): Promise<Response>;  isAuthorizedCronRequest(header, secret);  MIN_CRON_SECRET_LENGTH = 16
// src/lib/cron/core-jobs.ts
ordersExpireJob, cartsPruneJob, rateLimitsPruneJob, authPruneJob;  pruneExpiredCarts(now?);  pruneExpiredVerifications(now?);  ORDER_PAYMENT_TIMEOUT_MINUTES = 30
scheduleOpportunisticOrderExpiry(now?): boolean      // placeOrder effects, at most once / 5 min / instance
```

Registered jobs today:

| Key | Group | Does |
|---|---|---|
| `orders.expire` | frequent | `expireStalePendingOrders(30)` |
| `emails.flush` | frequent | up to 4 × 50 due mails |
| `carts.prune` | daily | carts expired more than 1 day ago |
| `ratelimits.prune` | daily | expired counters + Better Auth rows older than 24 h |
| `auth.prune` | daily | expired `verification` rows |
| `newsletter.send` | frequent | campaign batches of 200 (NOTIFY, `src/lib/newsletter/jobs.ts`) |
| `reviews.request` | daily | `review_request` mails (REVIEWS) |
| `subscriptions.remind` | daily | `subscription_reminder` mails (SUBSCRIPTIONS) |
| `subscriptions.renew` | daily | renewal orders (SUBSCRIPTIONS) |

(The last four were added by the builders; all nine show on the dashboard's "Zamanlanmış görevler" card.)

**How to add a job (full example; `sendDueReviewRequests` stands for your own service):**

```ts
// src/lib/reviews/jobs.ts
import "server-only";
import { db } from "@/db";
import { registerJob } from "@/lib/cron/registry";
import { sendDueReviewRequests } from "./service";

/** Bounded batch per run; the next run continues. Idempotent: orders.review_requested_at + the dedupe key. */
export const reviewsRequestJob = registerJob({
  key: "reviews.request",
  group: "daily",
  label: "Değerlendirme isteği e-postaları",
  run: async () => {
    const { queued, skipped } = await sendDueReviewRequests(db, { now: new Date(), limit: 200 });
    return { queued, skipped }; // counts only; anything else is dropped
  },
});
```
Then add **one line** to `src/lib/cron/jobs.ts` with the Edit tool: `import "@/lib/reviews/jobs"; // reviews.request (daily)`.

Rules for `run`:
- No Next request APIs.
- Safe to run twice at the same time: the advisory lock skips a concurrent run, but make the work idempotent anyway (lock rows, set a "done" timestamp, dedupe mails).
- Work in bounded batches.
- Return counts only.
- Never import a job module from client code.

**Schedule.**
- `vercel.json` runs `frequent` at 03:00 and `daily` at 03:30 UTC, because the Hobby plan allows only daily crons. On Vercel Pro, set the frequent cron to every 5 minutes (`"*/5 * * * *"`, docs/DAY6-CORE-API.md §14).
- So a "frequent" job must stay correct when it runs once a day. Mails still go out right after each request through `after()`.
- Locally, use `scripts/cron-local.mjs` (§10).

**Dashboard job status card:** built by the integrator (§14): "Zamanlanmış görevler" on `/panel` (staff) with "Şimdi çalıştır" (admin), on `listJobStatus()` / `runJobNow()`.

## 7. Auth and accounts wiring

Better Auth (`src/lib/auth.ts`):
- E-mail + password, `minPasswordLength: 10`, public sign-up on (`AUTH_PUBLIC_SIGNUP=false` closes it).
- `requireEmailVerification: true`: an unverified sign-in gets 403 `EMAIL_NOT_VERIFIED` plus a fresh mail (`sendOnSignIn`).
- Verification tokens are stateless JWTs valid 24 h, with `autoSignInAfterVerification`. Reset tokens are valid 1 h, single use, and other sessions are revoked on reset.
- `user.additionalFields`: `phone` and `locale` are client-writable. `companyId`, `customerGroupId`, `marketingConsent` and `marketingConsentAt` are not.
- Hooks: the per-e-mail failure lock (§4). `afterEmailVerification` → `onEmailVerified`; `onPasswordReset` → `onPasswordReset`.

```ts
// @/lib/auth-emails (server-only; called by Better Auth, not by builders)
sendVerificationMail(user, betterAuthUrl, token): Promise<void>;  sendPasswordResetMail(user, betterAuthUrl, token): Promise<void>
linkContext(betterAuthUrl, user): { locale: Locale; sonra: string | null }   // from callbackURL / redirectTo, else user.locale, else tr
verificationLink(token, locale, sonra) → "/<l>/hesap/dogrula?token=…[&sonra=…]" (absolute);  resetPasswordLink(token, locale) → "/<l>/hesap/sifre-sifirla?token=…"
greetingName(user): string;  AUTH_EMAIL_THROTTLE_SECONDS = 120
// @/lib/customer/auth-events (ACCOUNTS fills these; never throw, open your own db.transaction, log ids only)
onEmailVerified(user: { id; email; name; emailVerified }): Promise<void>   // link guest orders + `welcome` mail (dedupe `user:<id>:welcome`)
onPasswordReset(user): Promise<void>                                       // `password_changed` mail
```

**What ACCOUNTS calls** (`authClient` from `@/lib/auth-client`):
- **Sign-up:**
  `signUp.email({ name, email, password, phone?, locale, callbackURL: href(locale, "verifyEmail") + (sonra ? \`?sonra=${encodeURIComponent(sonra)}\` : "") })`.
  It answers 200 with `token: null` for new **and** existing addresses (no session, and no mail for an existing address). Always show "check your inbox".
- **Sign-in:**
  - `signIn.email({ email, password })`.
  - Errors: 401 `INVALID_EMAIL_OR_PASSWORD`; 403 `EMAIL_NOT_VERIFIED` (show `auth.errors.emailNotVerified`, a mail was sent); 429 `TOO_MANY_FAILED_SIGN_INS`.
  - Afterwards call `useViewer().refresh()`, or do a full page load.
- **Forgot password:** `authClient.requestPasswordReset({ email, redirectTo: href(locale, "resetPassword") })`. It gives the same answer for unknown addresses.
- **Reset page** (`/hesap/sifre-sifirla?token=`): `authClient.resetPassword({ newPassword, token })`. A token used twice gets 400 `INVALID_TOKEN`.
- **Verification page:** `/hesap/dogrula` is already built (a confirm button, because mail scanners would use up the auto sign-in).
  - On success it does a full page load to `sonra`, or to `href(locale, "account") + "?dogrulandi=1"`.
  - ACCOUNTS may restyle it with the other auth pages.

## 8. Routes, proxy and link helpers (`src/i18n/paths.ts`, pure)

| Turkish folder | en / ar | `href` name | Gate |
|---|---|---|---|
| `/` | `/` | `home` | |
| `/urunler`, `/urunler/[slug]` | `/products/…` | `products`, `product` | |
| `/kategori/[slug]` | `/category/…` | `category` | |
| `/sepet` | `/cart` | `cart` | |
| `/odeme` | `/checkout` | `checkout` | 307 → cart without a cart cookie |
| `/odeme/simulator` | `/checkout/simulator` | `paymentSimulator` | |
| `/odeme/kart` | `/checkout/card` | `cardPayment` (PAYMENTS) | |
| `/siparis`, `/siparis/[orderNumber]` | `/order/…` | `orderLookup`, `order` | |
| `/kurumsal` · `/numune` · `/iletisim` · `/blog` · `/sayfa/[slug]` | `/business` · `/samples` · `/contact` · `/blog` · `/page/…` | `business`, `samples`, `contact`, `blog`/`post`, `page` | |
| `/hesap` | `/account` | `account` | session cookie |
| `/hesap/giris` · `/kayit` · `/sifremi-unuttum` · `/sifre-sifirla` · `/dogrula` | `/account/sign-in` · `/register` · `/forgot-password` · `/reset-password` · `/verify` | `signIn`, `register`, `forgotPassword`, `resetPassword`, `verifyEmail` | public |
| `/hesap/siparisler`, `/hesap/siparisler/[orderNumber]` | `/account/orders/…` | `accountOrders`, `accountOrder({ orderNumber })` | session cookie |
| `/hesap/adresler` · `/profil` · `/favoriler` · `/abonelikler` · `/kurumsal` | `/account/addresses` · `/profile` · `/favorites` · `/subscriptions` · `/business` | `accountAddresses`, `accountProfile`, `accountFavorites`, `accountSubscriptions`, `accountBusiness` | session cookie |
| `/bulten/onay` · `/bulten/ayril` | `/newsletter/confirm` · `/newsletter/unsubscribe` | `newsletterConfirm`, `newsletterUnsubscribe` (NOTIFY) | |
| API (not localized) | `/api/cron/[group]`, `/api/auth/*`, `/api/payments/iyzico/callback`, `/api/payments/paytr/notify`, `/api/newsletter/unsubscribe` | none | own checks |

- **Wrong-language segments** get a 308. This covers both levels: `/en/account/giris` → `/en/account/sign-in`, `/tr/hesap/sign-in` → `/tr/hesap/giris`, `/en/hesap/giris` → `/en/account/sign-in`.
- **`/hesap/**` without a session cookie** (GET or HEAD only, auth pages excluded) gets a 307 to `href(l, "signIn")?sonra=<path+query>`.
  - This is optimistic only. **Every account page and action re-checks** with `getSession()` from `@/lib/session` and redirects with `signInHref(locale, path)`.
  - Account and auth pages read the session or searchParams inside `<Suspense>` and export `robots: { index: false }` metadata.
- Every route in the table exists now (final check, 2026-11-10). A sub-segment without a page folder would be rewritten correctly and then answered with a 404 by the `[...rest]` catch-all.

```ts
href(locale, "accountOrder", { orderNumber: "PR-261001" })  // "/en/account/orders/PR-261001"
safeReturnPath(raw: unknown): string | null                   // local paths only (no //, \, controls, encoded slashes, ≤ 512)
const sonra = safeReturnPath(query.sonra) ?? href(locale, "account");
signInHref(locale, returnTo?: string | null): string          // "/en/account/sign-in?sonra=%2Fen%2Fcheckout" (unsafe returnTo dropped)
redirect(signInHref(locale, href(locale, "accountOrders")));
folderPath(publicPath): { locale; path } | null               // "/en/account/orders/PR-1" → { locale: "en", path: "/hesap/siparisler/PR-1" }
localizePath(locale, storedPath);  switchLocalePath(path, target);  absoluteUrl(path);  siteOrigin()
toSubFolderSegment(folder, seg): string | null;  subSegmentFor(locale, folder, trSub);  hasSubSegments(folder);  isTurkishSubSegment / isEnglishSubSegment(folder, seg)
SUB_SEGMENTS, SEGMENTS (adds bulten: "newsletter"), ACCOUNT_AUTH_SUB_SEGMENTS = ["giris", "kayit", "sifremi-unuttum", "sifre-sifirla", "dogrula"]
```

## 9. Viewer (static pages stay static)

```ts
// @/lib/customer/viewer (pure)
type ViewerState = { signedIn: boolean; firstName: string | null; isBusiness: boolean; companyStatus: "pending" | "approved" | "rejected" | null; favoriteProductIds: number[] };
SIGNED_OUT_VIEWER; firstNameOf(name): string | null; MAX_VIEWER_FAVORITES = 500
// @/lib/customer/viewer-actions ("use server")
loadViewer(): Promise<ViewerState>      // the caller's own data only; signed-out state on any error
// @/components/store/viewer/ViewerProvider (client; already mounted in the storefront root layout)
useViewer(): ViewerState & { ready: boolean; refresh(): Promise<ViewerState>; setFavorite(productId: number, on: boolean): void }
const viewer = useViewer(); if (!viewer.ready || !viewer.signedIn) return <SignedOutHeart href={signInHref(locale, pathname)} />;
viewer.setFavorite(id, true); const r = await toggleFavoriteAction({ productId: id }); if (!r.ok) await viewer.refresh();
// (SignedOutHeart / toggleFavoriteAction are illustrative: ACCOUNTS builds them)
```
- `loadViewer` runs once per full page load, when the browser is idle (one POST to the current page), and the state survives client navigations.
- Before `ready`, render the signed-out look so nothing shifts.
- Never read the session on a static page. Business prices go through `loadPersonalPrices` (B2B) in the same island style.

## 10. Local workflow: test users, outbox, cron

```bash
node scripts/db-server.mjs start
# Own dev server (never port 3000). Point Better Auth and the mail links at YOUR origin, and give it a cron secret:
NEXT_DIST_DIR=.next/dev-<you> NEXT_PUBLIC_SITE_URL=http://<you>.localhost:<port> BETTER_AUTH_URL=http://<you>.localhost:<port> \
  CRON_SECRET=<32+ random chars> npx next dev -p <port>
# Users (e-mail must end with @test.local; created verified; prints a generated password)
npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts create <you>-buyer@test.local customer   # or staff|editor|admin
npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts cookie <you>-buyer@test.local <password> http://<you>.localhost:<port>
#   → name=value; in your tab: document.cookie = "<name=value>; path=/"
npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts delete <you>-buyer@test.local   # + sessions, accounts, favorites, audit rows, sign-in counter
# Real sign-up over HTTP (curl can't use *.localhost directly; write non-ASCII JSON to a UTF-8 file):
curl -s --resolve <you>.localhost:<port>:127.0.0.1 -X POST http://<you>.localhost:<port>/api/auth/sign-up/email \
  -H "Origin: http://<you>.localhost:<port>" -H "Content-Type: application/json" --data-binary @signup.json
# Cron: once, against your server (Node's fetch can't resolve *.localhost → use localhost)
CRON_SECRET=<same> node scripts/cron-local.mjs --once --group frequent --base http://localhost:<port>
```
- **Outbox:**
  - Mails land in `storage/mail-outbox/` a moment after the response (`after()`).
  - The `.txt` file holds the links. Open the `.html` in your browser tab: copy it to a temporary `public/zz-<you>/` file, open it, then delete it. The built-in browser can't open `file://`.
  - Delete **only your** files, by id: `<stamp>-<template>-<id>.{html,txt,json}`. Avoid globs: the safety check refuses `rm` with a wildcard in the project.
  - Delete your rows: `delete from email_messages where to_email like '<you>-%@test.local'`.
- **Cleanup that user deletion does NOT do:**
  - `verification` rows (reset tokens: `value = <userId>`) — delete them **before** deleting the user;
  - `email_messages` rows;
  - `job_runs` rows your runs created;
  - rate-limit counters of addresses that never became users: `forgetLimits([signInFailureKey(email)])`.
- **DB tests that send mail:**
  - Enqueue inside your transaction, then `flushEmailQueue({ ids, driver })` with a fake driver or `createOutboxDriver({ dir: <tmp> })` from `@/lib/email/drivers`.
  - Delete your rows in `after()` and restore `email_messages_id_seq` with `setval`.
  - See `tests/db/email-outbox.test.ts`.

## 11. Gotchas found today

1. *(Resolved: ACCOUNTS built the account pages.)* After verification the user lands on `/<l>/hesap?dogrulandi=1` ("E-posta adresiniz doğrulandı").
2. **Sign-up never reveals an existing address:** 200, `token: null`, no cookie, no mail. The UI must not treat 200 as "signed in".
3. **Verification and reset mails are throttled with a fixed 2-minute bucket** (epoch-aligned). Two mails a few seconds apart are possible across a bucket edge; I saw reset mails 40 s apart. Further requests in the same bucket return the same answer and send nothing.
4. **Dedupe keys are permanent** (§5.4), and dedupe hits leave id gaps.
5. **Better Auth's IP limits are production only.** In dev only our durable limits apply. To exercise the store over HTTP, send 10 wrong passwords for one address; the 11th answer is 429 `TOO_MANY_FAILED_SIGN_INS`, and it still holds after a server restart.
6. **Don't run whole cron groups against the shared DB casually.**
   - `frequent` cancels other agents' unpaid card orders older than 30 minutes.
   - `daily` deletes carts that expired more than a day ago, and expired verification rows.
   - In tests, call `runJob(yourJob)` or your service directly, and delete the `job_runs` row afterwards.
7. **Stopping a background `npx next dev` on Windows leaves its node children listening.** Stop the process tree that owns your port (PowerShell: `Get-NetTCPConnection -LocalPort <port> -State Listen`, then stop that PID, its parent and the `npx next dev -p <port>` process). Then delete `.next/dev-<you>` and restore `tsconfig.json` and `next-env.d.ts`, which `next dev` edits.
8. **Use your own origin for your dev server.** Set `NEXT_PUBLIC_SITE_URL` and `BETTER_AUTH_URL` in the process env (they win over `.env.local`). Otherwise mail links point to `localhost:3000`, and Better Auth's origin and callback checks compare against the wrong host.
   **This works for `next dev` only.** `next build` inlines `NEXT_PUBLIC_SITE_URL` into every bundle, the server
   chunks included (`siteOrigin()`, mail links and logo, the iyzico callback URL, Better Auth's trusted origins,
   `localPaymentMockAllowed`). For `next start`, set it when you **build**; a different origin needs a new build
   (on Vercel: a redeploy). Setting it only in the `next start` environment has no effect.
9. **`newsletter_subscribers.status` still defaults to `active`.** Double opt-in code must insert `pending` explicitly.
10. **`expireStalePendingOrders` still uses 30 minutes for every card order.** SUBSCRIPTIONS must make card renewals honour `cardPaymentWindowHours`. `orders.expire` calls it with `ORDER_PAYMENT_TIMEOUT_MINUTES`.
11. **Each job holds an idle transaction (advisory lock) while it runs.** Keep runs short and bounded. Day 5 checks Supabase's `idle_in_transaction_session_timeout`.
12. **The e-mail logo is the fixed PNG `/media/marka/prestij-logo.png`.** Panel logos exist only as AVIF/WebP, which Outlook doesn't show. Product images in `orderLines` must be absolute URLs. Our media exists only as AVIF/WebP: pass the WebP variant (Gmail and Apple Mail show it; Outlook desktop doesn't) and always pass `accent`, which fills the 64×64 box when there is no image. Never pass AVIF.
13. **E-mail texts are plain text.** Don't pre-escape (`&amp;` would show literally). Use `richText` only for sanitized panel HTML.
14. **`enqueueEmail` reads settings and texts through the `tx` you pass**, memoized per transaction. A mail queued in a transaction sees that transaction's settings.
15. **Windows curl mangles non-ASCII `-d '…'` JSON.** I got `?????` for an Arabic name. Write the body with Node to a UTF-8 file and send `--data-binary @file`.

## 12. Reconciled by CORE-CHECK (2026-11-10)

- E-mail code against the `email_messages` schema:
  - columns, partial dedupe index (`onConflictDoNothing`), `headers` and text `related_id` all match;
  - added a compile-time guard (`EMAIL_TYPES_MATCH_SCHEMA` in `src/lib/email/types.ts`) so `EMAIL_STATUSES` / `EMAIL_RELATED_TYPES` cannot drift from the schema's `EmailStatus` / `EmailRelatedType`.
- Template keys: the registry now uses `EMAIL_TEMPLATE_KEY` from settings (it used a shorter local regex), so every registered key can be overridden in the panel.
- `emails.flush` is registered (`src/lib/cron/jobs.ts`) and runs in the `frequent` group.
- The Better Auth hooks use the core templates `account_verify` and `password_reset`; `onEmailVerified` and `onPasswordReset` are wired and empty.
- Durable limits are used at every old call site. No request code imports `blockedFor` / `recordHit` / `forgetHits` (only unit tests and `memoryLimitStore`).
- `href` names match the contract table; the proxy rewrites and redirects every new sub-segment (checked through `proxy()` and over HTTP).
- `ViewerProvider` is mounted in `src/app/[locale]/layout.tsx`.
- Defaults of the new settings keys parse and round-trip through `SETTINGS_INPUTS` (unit test).

## 13. What CORE-CHECK verified (2026-11-10)

- **Gates:**
  - `npx tsc --noEmit` clean;
  - `npx eslint src scripts tests --quiet` clean;
  - `npm test` 600/600;
  - `npm run test:db` 198/198, with the DB identical to `start.json` afterwards (counts, every row of every pre-existing table, sequences, admin sessions, client cart);
  - `npx next build` OK: 63 storefront paths fully static (every home, listing, product, category, `sayfa`, blog, kurumsal, numune, iletisim and siparis page in tr/en/ar). Partial: `sepet`, `odeme`, `odeme/simulator`, `siparis/[orderNumber]`, `hesap/dogrula`, `[...rest]`.
- **Smoke test:** dev server on `corecheck.localhost:3402`, all through the real endpoints.
  - **Sign-up and verification:**
    - two customers signed up via `POST /api/auth/sign-up/email`, one tr and one ar; the verification mails appeared in the outbox;
    - the tr and ar HTML looks premium at desktop width and 375 px: ar is `dir=rtl` with right-aligned text and buttons, LTR links, and no sideways scroll;
    - following the tr link and clicking "E-postamı doğrula" verified the user, signed them in and redirected to `sonra` (`/tr/sepet`);
    - the ar link landed on `/ar/account?dogrulandi=1` (404 until ACCOUNTS).
  - **Enumeration and reset:**
    - signing up again with an existing address gave 200, no cookie, no mail;
    - forgot-password answered the same for a known and an unknown address, and only the known one got a mail;
    - the reset with the mailed token gave 200 and revoked the browser session; reusing the token gave 400 `INVALID_TOKEN`; the old password gave 401, the new one 200;
    - an unverified sign-in gave 403 `EMAIL_NOT_VERIFIED` and a fresh mail.
  - **Staff:** a throwaway staff user signed in to `/panel` through the real login form ("Genel Bakış").
  - **Cron:**
    - `/api/cron/frequent` without a secret → 401, with a wrong one → 401, unknown group → 404, PUT → 405;
    - with the secret: 200 for frequent (2 jobs) and daily (3 jobs), with `job_runs` rows written;
    - `cron-local.mjs --once` → HTTP 200.
  - **Durable limit:** 10 wrong sign-ins → 401, the 11th → 429; after a server restart still 429, while another address still got 401.
  - **Routes:**
    - `/tr/hesap`, `/en/account` and `/ar/account/orders` → 307 to sign-in with `sonra`;
    - wrong-language segments → 308;
    - `/en/account/sign-in` → `/en/hesap/giris` and `/ar/account/register` → `/ar/hesap/kayit` (rewrites, 404 until the pages exist); `/en/account/verify` → 200.
- **Cleanup:** test users, verification rows, mails, outbox files, `job_runs` rows, rate-limit counters, the temporary `public/zz-corecheck/` files and `.next/dev-corecheck` are deleted. The `email_messages` sequence was restarted, and `tsconfig.json` / `next-env.d.ts` were restored. The DB equals `start.json` again.

## 14. Integrator (2026-11-10)

- **Job status card (built by the integrator; the contract named no owner).** `/panel` shows "Zamanlanmış görevler"
  (`src/components/panel/dashboard/JobStatusCard.tsx`, staff): every registered job with its group, last run, result
  counts in Turkish (`job-labels.ts`) and the stored error class. Admins get "Şimdi çalıştır" (`RunJobButton.tsx` →
  `runJobNowAction` in `src/app/panel/(dashboard)/job-actions.ts`): admin check, `runJobNow(key)` under the job's
  advisory lock (a running job answers "atlandı"), audit row `action: "run", entity: "job"`.
- **Yapılacaklar** also counts unanswered quote requests (`new`/`in_review`) and, for editors and admins, reviews
  waiting for moderation (`getDashboardTodo().pendingQuotes` / `.pendingReviews`).
- **İşlem Kaydı** names the day-4 entities in Turkish and links them (`company`, `customer_group`, `quote_request`,
  `sample_request`, `review`, `subscription`, `subscription_plan`, `email_message`, `email_campaign`, `job`); `user`
  now reads "Kullanıcı" (team members and customers share the table).
- **Business buyers and subscribe-and-save.** `loadPersonalPrices` also returns `unitPrice` (kuruş) and
  `subscriptionUnitPrices` (plan id → kuruş) computed by `computeCart` with the plan on the line, and the product
  page's subscription choice uses them for signed-in group buyers. Before, it showed the retail-based subscription
  price (142,41 ₺) while the cart charged the business price minus the plan discount (121,05 ₺).
- **Payment mock with `next start`.** A local `IYZICO_BASE_URL` / `PAYTR_BASE_URL` is accepted outside production
  *or* when the build serves a local origin (`NEXT_PUBLIC_SITE_URL` on `localhost` / `127.0.0.1` / `*.localhost`):
  `localPaymentMockAllowed()` in `src/lib/payments/config.ts` and its twin in `next.config.ts`. A live site has a
  public origin, so it can never use the mock. The PayTR origin is baked into the `/odeme/kart` CSP at build time:
  set the payment variables (and `EMAIL_DRIVER=outbox`; production defaults to no driver) for `next build` too.
- **Gotchas found by the integrator:**
  1. `next start -H 127.0.0.1` (16.4.5) makes every en/ar URL loop on a 308: the router builds its URL with the
     `-H` host while the proxy's `request.nextUrl` uses `localhost`, so the proxy's rewrite looks external and is
     proxied back through the proxy. Run `next start` without `-H` (or with `-H localhost`). The browser caches the
     308 permanently: test such a host again only under a new hostname.
  2. The payment mock used to restart its iyzico `paymentId`s at a fixed number; after a restart the site refused
     the repeated id (`invalid_input`: the reference belongs to another order). It is now seeded from the clock.
  3. `scripts/panel-test-user.ts delete` also deletes the user's saved addresses (`addresses.user_id` has no
     foreign key, so two builders' addresses had been left behind).
  4. Better Auth's IP limits apply under `next start` (production): use `scripts/panel-test-user.ts cookie` for
     panel users instead of the login form when you need many sign-ins.

## 15. Fixer (2026-11-10): API changes after the day-4 review

**E-mail log never shows credentials** (`src/lib/email/redact.ts`, pure):
- `redactEmailSecrets(body)` replaces the values of `SECRET_LINK_PARAMS` (`token`, `t`, `degerlendir`, `atla`) in
  HTML, text and headers (raw, `&amp;` and percent-encoded separators) with `REDACTED_VALUE` ("gizlendi");
  `hasEmailSecrets(body)`; `AUTH_LINK_TEMPLATES` = `account_verify`, `password_reset`.
- `getEmailMessage` (panel) returns html, text and headers redacted, plus `redacted` and `authLink`. It is the
  only reader of stored bodies; never add another one without `redactEmailSecrets`.
- `flushEmailQueue` scrubs the stored body of an `AUTH_LINK_TEMPLATES` mail once it is sent (the driver gets the
  real link). `requeueEmail` returns null and `resendEmailMessage` throws `invalid` for those templates.

**iyzico results that never reached us** (`src/lib/payments/reconcile.ts`):
- `retrieveIyzicoCheckout` → `{ ok: false, reason: "unreachable" }` for a timeout, network error or HTTP 5xx
  (`iyzicoPost` now throws `IyzicoHttpError` on any 5xx). `retrieve_failed` stays for error answers.
- The callback sends the buyer to `orderPageHref(…, { paymentChecking: true })` (`?payment=checking`) for
  `pending` / `retrieve_failed` / `unreachable`, never `payment=failed`. The order page then shows "Ödemeniz
  doğrulanıyor" and polls `checkCardPaymentAction({ locale, orderNumber, token })`
  (`src/app/[locale]/siparis/actions.ts`, 60 checks / order / hour) for about 2 minutes before it offers the retry form.
- `reconcileCardOrder(orderId, { effects?, applyFailures?, fetch? })` → `{ state: "paid" | "failed" | "pending" |
  "unpaid" | "unknown" | "none" | "not_pending"; checked }`: asks iyzico about the order's unrecorded attempts
  (newest 5) and applies confirmed results through `completeCardPayment`. Never throws.
- `retryCardPayment` runs it first: a charge that never reached us completes the order (redirect `?new=1`);
  `unknown` → new code `"checking"` (`messages.order.payment.retryErrors.checking`), no new provider session.
- `expireStalePendingOrders` runs it (failures not recorded) before cancelling: paid → skipped; unknown →
  postponed for at most `UNKNOWN_PAYMENT_GRACE_HOURS` (48) after the order was placed.
- `scripts/payment-mock.mjs`: `POST /_mock/config { iyzicoRetrieve: "down" | "ok" }` (retrieve answers 503).

**Late failures of older attempts:** `CompleteCardPaymentInput.attemptRef` (iyzico token / PayTR merchant_oid;
both callbacks pass it). A failure of an attempt older than the latest one in the open row is stored as its own
`failed` row with `raw.superseded = true` (`isSupersededPayment(raw)` in `attempts.ts`): the open row stays
`initiated`, no `payment_failed` event or mail. The card page and `initiateCardPayment` skip superseded rows.

**Subscriptions:**
- `activatePendingSubscriptions` starts nothing for an anonymized (deleted) account; it writes an order event
  `subscription_skipped { reason: "account_deleted" }`. `sendDueReviewRequests` skips (and stamps) orders of
  anonymized accounts.
- `RenewFailureReason` adds `"quantity_changed"`: any `quantity_adjusted` issue (min / max / step) refuses the
  renewal (mail text `email.subscriptions.renewalFailed.reasons.quantity_changed`).
- `dueSubscriptionIds` orders by `failed_count`, then `next_run_at` (failing subscriptions cannot starve a batch).
- `anchorDayOf(date)`; `advanceRunAt(from, plan, anchorDay?)` and `nextRunAfter(current, plan, now, anchorDay?)`
  undo a short-month clamp (31 Jan → 28 Feb → 31 Mar). Renewals pass `anchorDayOf(subscription.createdAt)`.
- `changeSubscription` returns `mailQueued`; an address change to the same address is a no-op (no mail).

**Orders:** `checkTransition` / `allowedActions` take an optional `paymentMethod`. Vadeli orders accept
`mark_paid` in `DEFERRED_PAYABLE_STATUSES` (processing, shipped, delivered) once, without a status change, so
a later return can be recorded with `mark_refunded`.

**Reviews:** `approveReviewsSchema = { reviews: [{ id, updatedAt }] }`, `rejectReviewSchema = { id, updatedAt }`;
`setReviewStatus(tx, { ids, status, expected? })` refuses a review changed since the moderator loaded it (conflict).

**Panel:** `guardTestSend(tx, { userId, email, role }, to)` (`src/lib/panel/emails/test-send.ts`): campaign and
template test sends go only to the sender or the notification recipients unless an admin sends them, at most
`TEST_SEND_RULE` (20 / h / user). `relatedHref(type, id, { customer? })` links every related record type;
`relatedRef(type, id)` names quotes / samples TKL- / NMN-. `getDashboardTodo()` adds `samplesToShip` and
`paidCancelled`. `business_rejected` takes `revoked` ("Onayı kaldır" mails the revocation texts
`email.business.rejected.revoked`). `TR_PROVINCE_NAMES` (`validation/tr.ts`) is the alphabetical list for selects.

## 16. Final check (2026-11-10)

**Mails queued from inside `after()` waited for the next flush (fixed).** `scheduleNotification` runs
`notifyOrderEvent` in an `after()` callback, and `enqueueEmail` schedules its flush with another `after()`. Once
Next runs the after-queue, a nested `after()` starts **at once**, so that flush ran while the notification's
transaction was still open, found nothing, and the order mails stayed `queued` until some later request flushed
or the `emails.flush` job ran (once a day on the Hobby cron). Seen live: a deferred order's two mails were sent
3 minutes late, a campaign mail only by the cron call. Fix: `notifyOrderEvent` calls `scheduleEmailFlush()`
again after its transaction committed, and the campaign "Şimdi gönder" callback does the same after
`processCampaigns` (`src/lib/notifications/index.ts`, `src/app/panel/(dashboard)/e-bulten/kampanyalar/actions.ts`).
Checked live after the fix: COD order, iyzico-paid order and campaign mails were all `sent` within 0.1 s.
**Rule for new code:** if you enqueue mail inside an `after()` callback, call `scheduleEmailFlush()` after your
transaction commits.

**Test hygiene:** `tests/db/requests.test.ts` now also forgets the `quote:ip` / `quote:email` counters of its
group-price test (IP #40, `tiers`) and restores `tier_prices_id_seq`.
