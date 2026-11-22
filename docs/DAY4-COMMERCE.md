# Day 4: real payments, e-mails, customer accounts, B2B, requests, reviews, subscriptions

Read `docs/ARCHITECTURE.md`, `docs/NEXT16-NOTES.md`, `docs/DAY2-CORE-API.md` and `docs/DAY3-CORE-API.md`
first. This file is the contract the day-4 agents share. Where it names a file, function, table or type,
use exactly that name. If something here is wrong or impossible, do the closest correct thing and say so
in your report.

**Goal.** Turn the shop into a complete business:
- real card payments (iyzico and PayTR, switchable in the panel, test mode until the merchant
  approval);
- branded transactional e-mails in tr/en/ar;
- customer accounts;
- business accounts with approval and business prices;
- quote and sample request forms with panel workflows;
- moderated product reviews;
- subscriptions;
- newsletter double opt-in and campaign e-mails;
- scheduled jobs;
- durable rate limits.

Everything the client may want to change is editable in the panel without code: e-mail texts, review
and subscription rules, groups and prices. Secrets stay in environment variables.

**Facts.** The client is PRESTİJ BUKLET KOZMETİK, Kayseri. The site is in Turkish, English and Arabic
(RTL). Money is integer kuruş. Times are shown in Europe/Istanbul. There are no merchant keys yet and
no real mail account yet. Everything must work locally with the e-mail outbox and the payment mock, and
switch to the real services by setting environment variables.

## Scope

In scope:
- Payments:
  - iyzico Checkout Form and PayTR iFrame gateways;
  - callbacks and notifications;
  - provider refunds from the panel;
  - a local payment mock server for tests;
  - readiness on `/panel/ayarlar/odeme`.
- E-mail system:
  - a transactional outbox table;
  - drivers: `outbox` for local files and `smtp` via nodemailer;
  - a branded layout;
  - a template registry with panel-editable subject and intro per locale;
  - the panel template editor with preview and test send;
  - an e-mail log with resend;
  - every order e-mail and the admin notifications.
- Customer accounts (`/hesap`):
  - register with e-mail verification, sign in, forgot and reset password;
  - overview, orders, addresses, profile (incl. password change, marketing consent, account
    deletion), favorites;
  - guest orders linked after verification;
  - checkout prefill and "save address".
- B2B:
  - business application (`/hesap/kurumsal`);
  - panel Müşteriler, Kurumsal Hesaplar, Müşteri Grupları;
  - approval sets group and payment terms;
  - business prices shown to signed-in business customers;
  - deferred ("vadeli") checkout for approved companies.
- Quote request and sample request forms (new section types on `/kurumsal` and `/numune`), and panel
  Teklif Talepleri and Numune Talepleri with status workflows and e-mails.
- Reviews:
  - product page reviews with aggregate rating and JSON-LD;
  - writing a review (signed in, or by a signed e-mail link);
  - review request e-mail after delivery;
  - panel Yorumlar moderation and reply.
- Subscriptions:
  - "subscribe and save" on eligible products;
  - cart and checkout support;
  - a subscription created from the first order;
  - renewal orders by a job, with a reminder e-mail;
  - `/hesap/abonelikler` self-service;
  - panel Abonelikler and plan editing.
- Newsletter:
  - double opt-in (pending → confirm link → active);
  - one-click unsubscribe (List-Unsubscribe);
  - panel campaign compose, preview, test send, and batched sending by a job.
- Scheduled jobs: `/api/cron/[group]` with a secret, locks and a `job_runs` record; panel status
  card and "run now".
- Durable rate limits in Postgres for every public form and auth endpoint; a real barcode unique
  index.

Out of scope (later):
- SMS/OTP for cash on delivery (the client has not decided);
- e-invoice (e-Arşiv) integration;
- İYS integration (show a hint only);
- stored-card automatic charging for subscriptions (renewals send a pay link instead);
- partial refunds;
- converting a quote into an order automatically;
- a draft preview on the storefront;
- deployment (day 5).

## Roles (enforced on the server in every action and route handler)

| Area | Minimum role |
|---|---|
| Quote and sample requests: view, change status, reply | staff |
| Customers: list and detail (read) | staff |
| E-mail log: view, resend | staff |
| Subscriptions: view | staff |
| Dashboard job status | staff |
| Review moderation and reply | editor |
| Subscriptions: pause and cancel on behalf of a customer | editor |
| Newsletter campaign compose and test send | editor |
| Business approvals, customer groups, payment terms | admin |
| Customer ban, data export, anonymize, group change | admin |
| E-mail templates and sender settings | admin |
| Review, subscription and e-mail settings | admin |
| Subscription plans | admin |
| Newsletter campaign **send** | admin |
| Provider refunds | admin |
| Cron "run now" | admin |

Staff users must be able to sign in although e-mail verification becomes required:
- every staff user has `emailVerified = true` (fix existing rows in the migration);
- the team service, `scripts/create-admin.ts` and `scripts/panel-test-user.ts` set it on creation.

## Environment variables (new; document them in README and `.env.example`)

| Variable | Meaning |
|---|---|
| `IYZICO_API_KEY`, `IYZICO_SECRET_KEY` | iyzico credentials. Card via iyzico is ready only when both are set. |
| `IYZICO_BASE_URL` | Optional override. Default: `https://sandbox-api.iyzipay.com` when the panel's test mode is on, `https://api.iyzipay.com` otherwise. Overrides must be `https://`, or `http://localhost` / `http://127.0.0.1` outside production (the mock). |
| `PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY`, `PAYTR_MERCHANT_SALT` | PayTR credentials (test mode is a request flag). |
| `PAYTR_BASE_URL` | Optional override (same rule as above), default `https://www.paytr.com`. |
| `EMAIL_DRIVER` | `outbox` (default outside production: writes `.html` + `.txt` to `storage/mail-outbox/`) or `smtp`. In production without `smtp`, e-mails stay queued and the panel shows a warning. |
| `EMAIL_SMTP_URL` | e.g. `smtps://user:pass@smtp.example.com:465`. |
| `EMAIL_FROM` | e.g. `PRESTİJ <siparis@prestij.com.tr>` (must be a domain verified at the mail provider). |
| `CRON_SECRET` | Bearer secret for `/api/cron/*` (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`). |

`PAYMENT_SIMULATOR=true` still wins locally (the simulator stays the default local card flow).

Secrets are never stored in the DB, never shown in the panel (only "tanımlı / tanımlı değil") and
never logged. Signed links (review links, newsletter confirm and unsubscribe) use HMAC-SHA256 with
a key derived from `BETTER_AUTH_SECRET` via HKDF:
- one purpose label per link type;
- `src/lib/signed-token.ts` (core) exposes `signToken(purpose, payload, ttlSeconds?)` and
  `verifyToken(purpose, token)`;
- the comparison is timing-safe.

## Localized routes (core adds these; `href()` route names in parentheses)

Today only the first path segment is translated. Core extends `src/i18n/paths.ts` and
`src/proxy.ts`:
- second-level segments under `hesap`, `odeme` and `bulten` are translated too;
- the same 308 rules apply to wrong-language segments.

| Turkish (canonical folder) | en / ar | href name |
|---|---|---|
| `/hesap` | `/account` | `account` |
| `/hesap/giris` | `/account/sign-in` | `signIn` |
| `/hesap/kayit` | `/account/register` | `register` |
| `/hesap/sifremi-unuttum` | `/account/forgot-password` | `forgotPassword` |
| `/hesap/sifre-sifirla` | `/account/reset-password` | `resetPassword` |
| `/hesap/dogrula` | `/account/verify` | `verifyEmail` |
| `/hesap/siparisler`, `/hesap/siparisler/[orderNumber]` | `/account/orders/...` | `accountOrders`, `accountOrder` |
| `/hesap/adresler` | `/account/addresses` | `accountAddresses` |
| `/hesap/profil` | `/account/profile` | `accountProfile` |
| `/hesap/favoriler` | `/account/favorites` | `accountFavorites` |
| `/hesap/abonelikler` | `/account/subscriptions` | `accountSubscriptions` |
| `/hesap/kurumsal` | `/account/business` | `accountBusiness` |
| `/odeme/kart` | `/checkout/card` | `cardPayment` (PayTR iframe page) |
| `/bulten/onay` | `/newsletter/confirm` | `newsletterConfirm` |
| `/bulten/ayril` | `/newsletter/unsubscribe` | `newsletterUnsubscribe` |

The proxy checks for a session cookie on `/hesap/**` and redirects to sign-in with
`?sonra=<path>`, except for the auth pages. Every page re-checks on the server. `sonra` accepts
local paths only (no open redirect).

Route handlers are not localized:
- `/api/payments/iyzico/callback` (browser POST from iyzico);
- `/api/payments/paytr/notify` (server-to-server, answers plain `OK`);
- `/api/newsletter/unsubscribe` (RFC 8058 one-click POST);
- `/api/cron/[group]`.

## Schema (CORE-DATA writes ONE migration `drizzle/0003_day4.sql`; nobody else changes the schema)

New tables:
- **`email_messages`**: the outbox and log.
  - Columns:
    - `id`;
    - `template` (registry key);
    - `to_email`, `locale`;
    - `subject`, `html`, `text`;
    - `status` (`queued | sending | sent | failed | cancelled`);
    - `attempts`, `last_error` (short, no secrets);
    - `send_after`;
    - `related_type` (`order | quote | sample | company | review | subscription | newsletter | campaign | contact | user | test`), `related_id`;
    - `dedupe_key` (unique when not null; e.g. `order:12:paid:customer`);
    - `created_by`;
    - `sent_at`;
    - timestamps.
  - Indexes: `(status, send_after)` and `(related_type, related_id)`.
- **`favorites`**:
  - columns `user_id` (FK user, cascade), `product_id` (FK products, cascade), `created_at`;
  - primary key `(user_id, product_id)`.
- **`rate_limit_counters`**:
  - columns `key`, `window_start`, `count`, `expires_at`;
  - primary key `(key, window_start)`; index on `expires_at`.
- **`job_runs`**: `job` (primary key), `last_started_at`, `last_finished_at`, `last_status`
  (`ok | error | skipped`), `last_result` (jsonb, counts only), `last_error`, `run_count`.
- **Better Auth's database rate-limit table**: name and columns exactly as Better Auth 1.7 expects
  for `rateLimit.storage = "database"`; check `node_modules/better-auth`.

Changes:
- `newsletter_subscribers`:
  - status adds `pending`;
  - new columns `confirm_token_hash`, `confirmed_at`, `unsubscribed_at`, `consent_source`,
    `consent_ip_hash`;
  - existing rows stay `active`.
- `orders`:
  - new columns `subscription_id` (nullable, indexed) and `review_requested_at`.
- `subscriptions`:
  - new columns `email`, `locale`, `payment_method`, `skip_next` (bool), `reminder_sent_at`,
    `cancelled_at`, `failed_count`;
  - the existing `items` / `shipping_address` / `invoice` / `next_run_at` stay.
- `reviews`:
  - unique `(product_id, user_id)` where `user_id` is not null;
  - unique `(product_id, order_id)` where `order_id` is not null.
- `quote_requests`:
  - new column `offer` (jsonb):
    `{ lines: { variantId?: number; label: string; quantity: number; unitPrice: Kurus }[]; validUntil?: string; note?: string; total: Kurus }`;
  - new columns `quoted_at` and `consent_at`.
- `sample_requests`: new columns `approved_at`, `shipped_at`, `carrier`, `consent_at`.
- `companies`: new columns `applicant_user_id`, `rejected_at`, `rejection_reason`.
- `email_campaigns`: new columns `created_by`, `locale_mode` (`per_subscriber`).
- `product_variants`: partial unique index on `barcode` where it is not null and not empty. Check
  for duplicates first.
- `user`: every staff role gets `email_verified = true` (data fix in the migration).

Settings (`src/lib/settings/types.ts`, new keys with defaults; core adds the schemas):
- **`emails`**:
  - `fromName`, `replyTo` (default: `general.email`);
  - `adminRecipients: string[]`;
  - `footerNote: LocalizedText`;
  - `templates: Record<TemplateKey, { enabled: boolean; subject?: LocalizedText; intro?: LocalizedText }>`.
- **`reviews`**: `{ enabled, allowGuestLinks, requestDaysAfterDelivery: 7, minLength: 10 }`.
  Moderation is always on.
- **`subscriptions`**:
  - `enabled`;
  - `reminderDaysBefore: 3`;
  - `allowedMethods: ("card" | "bank_transfer" | "cash_on_delivery")[]`;
  - `cardPaymentWindowHours: 72`.
- **`payments.card.maxInstallments`**: 1–12, default 1.

## CORE (two builders in parallel, then CORE-CHECK writes `docs/DAY4-CORE-API.md`)

### CORE-DATA owns

- **Schema.** The schema files and the migration above. Apply the migration locally with
  `npm run db:migrate`; core only.
- **Settings.** The settings schemas.
- **Durable rate limits** in `src/lib/rate-limit-store.ts`:
  - API:
    - `consumeLimits(entries: [key, {limit, windowMs}][]): Promise<{ allowed: boolean; retryAfterMinutes: number }>`
      (one atomic upsert per key);
    - `checkLimits(entries)`;
    - `forgetLimits(keys)`.
  - Call sites: move every existing call site to it (order lookup, placing an order, coupon tries,
    contact form, the sign-in failure lock in `auth-limits.ts`).
  - Better Auth: switch to `rateLimit.storage = "database"`.
  - Unit tests: keep the pure in-memory helpers.
- **Cron framework:**
  - `src/lib/cron/registry.ts`:
    `registerJob({ key, group: "frequent" | "daily", run: () => Promise<Record<string, number>> })`
    and `listJobs()`;
  - `src/lib/cron/run.ts` `runJobGroup(group)`:
    - takes a `pg_try_advisory_lock` per job and skips the job when it is locked;
    - writes `job_runs`;
    - catches errors per job;
  - `src/app/api/cron/[group]/route.ts`: GET and POST, timing-safe Bearer check against
    `CRON_SECRET`, 401 without it, 404 for unknown groups, JSON counts only;
  - `vercel.json` with a daily cron for each group (the Hobby plan allows daily only; on Vercel Pro
    set the frequent cron to every 5 minutes, see docs/DAY6-CORE-API.md §14);
  - `scripts/cron-local.mjs` calls the groups on an interval for local testing.
- **Core jobs:**
  - `orders.expire`: frequent, the existing `expireStalePendingOrders`;
  - `carts.prune`: daily, expired carts;
  - `ratelimits.prune`: daily;
  - `auth.prune`: daily, expired verification rows.
  - Also run `orders.expire` opportunistically after `placeOrder`, throttled to once per 5 minutes
    per instance, because the Hobby cron is daily.
- **`src/lib/signed-token.ts`**, with tests.
- **DB tests** for:
  - the rate-limit store, including concurrency (20 parallel consumes → exactly `limit` allowed);
  - the cron lock (two runs at once → one skipped);
  - the migration's data fixes.

### CORE-COMMS owns

- **The e-mail system** in `src/lib/email/**`:
  - **API:**
    - `enqueueEmail(tx, { template, to, locale, data, related?, dedupeKey?, sendAfter?, createdBy? })`:
      - renders at enqueue time and stores subject, html and text, so the log shows exactly what
        was sent;
      - a disabled template or a duplicate `dedupeKey` is a no-op that returns `null`.
    - `flushEmailQueue({ limit })`:
      - claims rows with `FOR UPDATE SKIP LOCKED`;
      - sends through the driver;
      - marks a row `sent`, or `failed` after 5 attempts with backoff (1, 5, 15, 60 minutes);
      - never throws.
    - `scheduleEmailFlush()`: `after()` → flush, so mails go out right after the response.
    - `sendTestEmail(template, to, locale)`: uses the sample data.
    - `renderEmailPreview(template, locale, overrides?)`: for the panel editor.
    - `adminRecipients()`.
  - **Registration:**
    `defineEmailTemplate({ key, audience: "customer" | "admin", placeholders: string[], sample: () => Data, build: (data, ctx) => EmailContent })`,
    where `EmailContent` is `{ subject; preheader?; blocks: EmailBlock[] }`.
    - Blocks: `heading`, `paragraph`, `button`, `keyValue`, `orderLines`, `totals`, `notice`,
      `divider`, `bankAccounts`.
    - The panel's subject and intro override replaces `subject` and the first paragraph.
    - Placeholders such as `{orderNumber}` and `{name}` are filled after HTML-escaping.
  - **Templates:** each template lives in `src/lib/email/templates/<area>.ts`. Builders add one
    import line each to `src/lib/email/templates/index.ts` (a shared file; edit it with the Edit
    tool only).
  - **Layout:**
    - table-based, with inline styles;
    - logo by absolute URL from `NEXT_PUBLIC_SITE_URL`;
    - brand colors from the default theme;
    - `dir="rtl"` and right alignment for ar;
    - a plain-text part;
    - a preheader;
    - a footer with company data from settings (`general`), `footerNote`, and for marketing mails
      an unsubscribe link plus the `List-Unsubscribe` and `List-Unsubscribe-Post` headers;
    - looks premium in Gmail, Outlook and Apple Mail (no web fonts required; a serif fallback for
      headings).
  - **Drivers:**
    - `outbox` writes `storage/mail-outbox/<timestamp>-<template>-<id>.html|.txt`, plus a JSON
      header file;
    - `smtp` uses nodemailer (the one new dependency allowed today);
    - no PII in console logs: only the id and the template.
  - **Job:** `emails.flush` (frequent).
- **Auth wiring:**
  - Better Auth:
    - public sign-up on;
    - `requireEmailVerification: true` for customers;
    - `sendVerificationEmail` and `sendResetPassword` enqueue the core templates
      `account_verify` and `password_reset`;
    - `autoSignInAfterVerification`;
    - tokens expire in 24 h (verify) and 1 h (reset);
    - no user enumeration (forgot-password always answers the same);
  - the verify landing page `/hesap/dogrula`.
- **Routes:** the localized route additions in `paths.ts` and `proxy.ts` (table above), with tests.
- **Viewer state** (keeps static pages static):
  - `src/lib/customer/viewer-actions.ts` (`"use server"`) `loadViewer(): Promise<ViewerState>` with
    `ViewerState = { signedIn: boolean; firstName: string | null; isBusiness: boolean; companyStatus: CompanyStatus | null; favoriteProductIds: number[] }`;
  - `src/components/store/viewer/ViewerProvider.tsx`: a client context that calls `loadViewer()`
    once after hydration (idle), and `useViewer()`;
  - mounted in the storefront layout;
  - static pages never read the session on the server.
- **Messages:** the message groups `account`, `auth`, `email` skeletons in tr/en/ar.

The interface between the two cores is the schema above. CORE-COMMS writes code against the table
definitions that CORE-DATA puts in `src/db/schema/*`. Until they exist, it works on the non-DB parts
first (layout, blocks, drivers, routes).

### CORE-CHECK

Reconciles both halves, runs every gate and writes `docs/DAY4-CORE-API.md`:
- every export with its signature and an example;
- how to add a template;
- how to add a job;
- the rate-limit keys in use;
- the route table;
- the test-user and outbox workflow;
- gotchas.

## Builders (parallel after CORE) and what they own

Every builder:
- writes its services in `src/lib/<area>/service.ts`, taking `(tx, input, actor)` without Next
  APIs, so DB tests call them directly;
- writes panel actions via `panelAction`;
- writes storefront actions with zod, durable rate limits and a honeypot where public;
- writes e-mails through `enqueueEmail` in the same transaction as the business change;
- writes DB tests in `tests/db/<area>.test.ts`;
- flips `ready: true` for its nav items.

New seeded content goes into BOTH the seed definitions (`scripts/seed-data/**`) AND the idempotent
content script `scripts/content-day4.ts`:
- the script inserts only what is missing and never overwrites existing rows;
- the client's live DB will get it the same way;
- builders own their own function in it, and REQUESTS creates the file.

### PAYMENTS: iyzico, PayTR, refunds, mock, readiness

- **Gateways.**
  - Files: `src/lib/payments/iyzico-gateway.ts` and `paytr-gateway.ts` implement `PaymentGateway`.
  - Extend the interface:
    - `refund(input: { orderId; providerRef; amount; raw }): Promise<{ ok: true; ref: string } | { ok: false; error: string }>`;
    - `initiate()` may return `{ redirectUrl }` or `{ iframeUrl }`.
  - `getCardGateway()` becomes async:
    - the simulator when `PAYMENT_SIMULATOR=true`;
    - otherwise the provider chosen in `settings.payments.card.provider`, if its env keys exist;
    - otherwise `null` (fail closed);
    - update every caller.
- **Research the official documentation on the web before coding** (dev.iyzipay.com, the PayTR
  developer docs). Implement exactly:
  - **iyzico:**
    - Checkout Form initialize (IYZWSv2 HMAC-SHA256 auth header, basket items summing exactly to
      the price, buyer/address fields from the order, `callbackUrl`, `locale`, `currency TRY`,
      `enabledInstallments`, `basketId = orderNumber`, `conversationId`);
    - redirect to `paymentPageUrl`;
    - callback: POST `token` → retrieve the checkout form result and verify its `signature` →
      `completeCardPayment` → 303 to the order page;
    - refund by API.
  - **PayTR:**
    - iFrame `get-token` with the documented `paytr_token` hash (`merchant_oid` alphanumeric:
      derive it from the order number plus an attempt suffix; keep the mapping in
      `payments.raw` / `providerRef`);
    - `user_basket`, `user_ip` from the trusted client IP, `test_mode`, `no_installment` /
      `max_installment`, `merchant_ok_url` / `merchant_fail_url`;
    - `/odeme/kart` shows the iframe, styled to the brand;
    - notify: verify the hash, then `completeCardPayment`, answer `OK` (also for replays);
    - refund by API.
  - Amount checks always compare with `orders.grandTotal`. Callbacks are idempotent (existing
    `completeCardPayment` rules).
- **Mock.** `scripts/payment-mock.mjs` is a local HTTP server that emulates both providers'
  endpoints with the same signature algorithms:
  - a fake hosted page with "Başarılı / Başarısız" buttons;
  - iyzico posts the token to our callback;
  - PayTR sends the server-to-server notify, then redirects the browser to the ok/fail URL;
  - refund endpoints.
  - Point `IYZICO_BASE_URL` / `PAYTR_BASE_URL` at it in tests and in the browser check.
- **Unit tests:** signature and hash building, using any test vectors the docs publish;
  amount/kuruş formatting (iyzico decimal string, PayTR ×100 integer); forged and replayed
  callbacks.
- **DB tests:** the full flow against the mock for both providers (success, failure, retry,
  duplicate notify, amount mismatch, refund).
- **Panel.**
  - `/panel/ayarlar/odeme` shows:
    - for each provider: keys tanımlı / tanımlı değil;
    - test mode;
    - the callback and notify URLs to give the provider (built from `NEXT_PUBLIC_SITE_URL`);
    - max installments;
    - a clear Turkish explanation of what the client must do to go live.
  - Order detail: "Kart iadesi yap" (admin, confirm dialog) → `gateway.refund` → on success, the
    existing `mark_refunded` transition plus an order event; on failure, a Turkish error.
- **Tests:** `tests/unit/payments-*.test.ts`, `tests/db/payments-providers.test.ts`.

### ACCOUNTS: `/hesap` storefront, auth pages, favorites, checkout integration

- **Auth pages:**
  - `/hesap/giris`, `/hesap/kayit`, `/hesap/sifremi-unuttum`, `/hesap/sifre-sifirla`,
    `/hesap/dogrula`;
  - luxury-minimal, in tr/en/ar, RTL;
  - show/hide password, strength hint, clear errors;
  - the register form has:
    - name, e-mail, password, optional phone;
    - required acceptance of the membership agreement (new legal document key `membership`,
      draft text marked for lawyer review, seeded and listed in `/panel/yasal`) and the KVKK
      notice link;
    - an optional, unticked commercial e-mail consent box that starts the newsletter double
      opt-in.
- **Account area:**
  - `/hesap`: overview (greeting, recent orders, business status, quick links);
  - `/hesap/siparisler` + detail: reuse the order view components; the customer sees only their
    own orders;
  - `/hesap/adresler`: CRUD for addresses with invoice data and defaults, using TR validation;
  - `/hesap/profil`:
    - name, phone, preferred language;
    - change password, which revokes other sessions;
    - the marketing consent toggle;
    - "Hesabımı sil" with password confirmation. This anonymizes the user's personal data,
      deletes addresses and favorites, cancels subscriptions, revokes sessions and keeps orders
      (legal retention); explain this in the UI;
  - `/hesap/favoriler`.
- **Favorites:** the heart on product cards and product pages (client island using
  `useViewer()`). Signed out, the heart goes to sign-in with a return path.
- **Guest orders:** when an e-mail is verified, link orders with that e-mail and no user to the
  user, and tell the user.
- **Header:**
  - the account icon links to `/hesap` (or sign-in);
  - it shows the first name from `useViewer()` when signed in;
  - no server session read on static pages.
- **Cart on sign-in:** attach the guest cart to the user. When both exist, merge them, keeping
  the larger quantity per variant. After sign-in, prices re-resolve for the user's group.
- **Checkout, when signed in:**
  - the e-mail is the account's;
  - prefill the default address;
  - "Bu adresi kaydet";
  - the order gets `userId`.
- **Order confirmation for guests:** "Hesap oluştur", with the e-mail prefilled.
- **E-mails:** `welcome` (after verification), `password_changed`. The core owns the verify and
  reset templates.
- **Tests:** `tests/db/accounts.test.ts`:
  - IDOR: another user's order, address or favorite → not found;
  - guest order linking only after verification;
  - account deletion.

### B2B: business application, Müşteriler, Kurumsal Hesaplar, groups, business prices

- **Business application:**
  - `/hesap/kurumsal` form:
    - company name, sector, tax office, VKN (validated), phone, e-mail, website, address,
      expected monthly volume, note;
  - creates a `companies` row (`pending`, `applicant_user_id`) and links `user.companyId`;
  - the status page shows the state (pending, approved with group name and terms, or rejected
    with the reason);
  - the CTA from `/kurumsal`.
  - E-mails: `business_application_received` (customer + admin), `business_approved`,
    `business_rejected`.
- **Panel `/panel/musteriler`:**
  - list (search name / e-mail / phone, filters: group, company, has orders, verified), paging;
  - detail: profile, orders, addresses, company, subscriptions, reviews, e-mails sent;
  - admin actions:
    - change the group;
    - ban / unban (sessions revoked);
    - send a password reset;
    - export the customer's data as JSON (KVKK);
    - anonymize, with a confirm dialog and the same rules as self-service deletion.
- **Panel `/panel/kurumsal-hesaplar`:**
  - list with status tabs (Bekleyen first);
  - detail with company data (editable);
  - Onayla: choose a customer group and payment terms (`allowDeferred`, `days`);
  - Reddet: with a reason, which is e-mailed;
  - members;
  - orders.
  - A "Müşteri Grupları" tab:
    - CRUD for groups (localized name, slug, isBusiness, discountPercent, showPricesExVat);
    - delete is guarded when the group is in use.
- **Business prices on static product pages:**
  - `src/lib/customer/price-actions.ts` `loadPersonalPrices(variantIds)` returns formatted
    prices only for signed-in customers whose group gives a different price, and `{}` otherwise;
  - a small client island on product pages and cards shows "Kurumsal fiyatınız: …" (KDV hariç,
    when the group says so);
  - the cart and checkout already use the customer context; verify parity.
- **Deferred checkout:** make sure "Vadeli ödeme (cari hesap)" appears at checkout for an
  approved company with `allowDeferred`, and never otherwise (server-enforced). Show the days.
  Order e-mails mention the terms.
- **Tests:** `tests/db/b2b.test.ts`:
  - approval flips pricing;
  - a rejected or pending company gets retail prices;
  - a customer cannot set their own group or company through any action;
  - deferred is refused without terms.

### REQUESTS: quote and sample forms, panel workflows, content script

- **New section types:** `quote_form` and `sample_request_form`:
  - schema, field specs (editable headings, intro, success text, which products are listed),
    registry entry, component;
  - placed on `/kurumsal` (id anchor `teklif`) and `/numune` (anchor `numune-formu`) by the seed
    and by `scripts/content-day4.ts` (create this file, with one function per area that other
    builders fill in: `membershipLegalDoc`, `reviewSettings` …);
  - update existing CTAs that pointed to `/iletisim?konu=teklif` where it makes sense, and say
    which.
- **Quote form:**
  - company, contact, e-mail, phone, sector;
  - product lines (choose a product and variant + quantity, add or remove rows; free-text line
    allowed);
  - message;
  - KVKK consent;
  - honeypot, durable rate limits (5/hour/IP, 20/day/e-mail);
  - prefilled when signed in.
  - Sample form: company, contact, e-mail, phone, sector, address (il / ilçe / adres), products
    (checkboxes of active products), estimated monthly litres, message, consent; respects
    `samples.requestFormEnabled`.
- **Panel `/panel/teklifler`:**
  - list with status tabs and search;
  - detail: request, lines, an offer editor (a unit price per line with the current list and
    group price shown, validity date, note, computed total) → "Teklifi gönder" e-mails the offer
    (`quote_offer`, localized, with lines and total) and sets `quoted`;
  - statuses `new → in_review → quoted → won | rejected`;
  - admin note;
  - reply by e-mail.
- **Panel `/panel/numune-talepleri`:** statuses `new → in_review → approved → shipped (carrier + tracking) → won | rejected`. Approved, shipped and rejected each send an e-mail.
- **E-mails:** `quote_received` (customer + admin), `quote_offer`, `sample_received`
  (customer + admin), `sample_approved`, `sample_shipped`, `sample_rejected`.
- The contact form's admin notification (`contact_message`, admin) is also yours: replace the
  `notifyContactMessage` stub.
- **Tests:** `tests/db/requests.test.ts`.

### REVIEWS: storefront reviews, request e-mails, moderation

- **Product page (stays ○):**
  - reviews come from cached `getApprovedReviews(productId)` (tag `reviews:<id>`);
  - aggregate stars and count, a distribution bar, the latest reviews with "Daha fazla göster",
    the admin reply, a verified-purchase badge;
  - `AggregateRating` + `Review` JSON-LD when at least 1 review is approved;
  - stars on product cards when `ratingCount > 0`;
  - keep `products.ratingAverage/ratingCount` updated on approve, reject and delete.
- **Writing a review** (client island):
  - signed-in customers: one per product, edit their pending review;
  - guests: through a signed link from the review request e-mail (`?degerlendir=<token>`,
    purpose `review`, payload `{orderId, productId}`), which marks the review verified;
  - rating 1–5, title, text (min length from settings), display name (initials by default);
  - rate-limited;
  - sanitized as plain text.
- **Review request:** the job `reviews.request` (daily) e-mails a `review_request` with one
  button per product, `requestDaysAfterDelivery` days after `deliveredAt`, once per order
  (`orders.review_requested_at`), only when reviews are enabled.
- **Panel `/panel/yorumlar`:**
  - Bekleyen first; filters (status, product, rating);
  - approve, reject, delete with confirmation;
  - reply (shown publicly);
  - bulk approve.
  - Each change updates the `reviews:<id>` and `product:<slug>` tags.
- **Settings page:** `/panel/ayarlar/yorumlar`.
- **Tests:** `tests/db/reviews.test.ts`:
  - one review per user and product;
  - guest token forged, expired or reused;
  - the rating aggregate stays right.

### SUBSCRIPTIONS: subscribe and save, renewals, self-service, panel

- **Product page** (for `products.allowSubscription` and `subscriptions.enabled`):
  - a "Tek seferlik / Abone ol" choice with the active plans (`subscription_plans`) and their
    discount;
  - stays ○ (client island).
- **Cart line** with `subscriptionPlanId`. Pricing (money code, be careful):
  - the plan discount applies to the line's resolved unit price;
  - it does NOT stack with an automatic campaign: the better one wins, and the cart shows which;
  - coupons apply as today;
  - extend the pure engine with tests;
  - the product page, cart, checkout and renewal show the same price.
- **Checkout:**
  - a subscription line requires a signed-in account (show a sign-in prompt in the cart and at
    checkout);
  - only the methods in `subscriptions.allowedMethods`;
  - after the first order succeeds (paid, or placed for cash on delivery or bank transfer), create
    one `subscriptions` row per plan (items, address, invoice, method, `next_run_at = now + interval`).
- **Jobs (daily):**
  - `subscriptions.remind`: a `subscription_reminder` e-mail `reminderDaysBefore` days ahead,
    with "skip" and "manage" links;
  - `subscriptions.renew`:
    - for due active subscriptions, create a renewal order with current prices and the plan
      discount, with stock checks (out of stock → e-mail and retry next day, `failed_count`);
    - link it via `orders.subscription_id`;
    - then advance `next_run_at`, or skip it once when `skip_next`.
  - Renewal by method:
    - card renewals are `pending_payment`, with a `subscription_payment_due` e-mail linking to
      the order page's pay button, and expire after `cardPaymentWindowHours` instead of 30 min
      (adjust `expireStalePendingOrders`);
    - bank transfer → `awaiting_transfer` + instructions;
    - cash on delivery → `processing`.
- **`/hesap/abonelikler`:** list and detail. Actions: pause / resume, skip next, change plan,
  change address, cancel (confirm), each with an e-mail where useful (`subscription_changed`).
- **Panel `/panel/abonelikler`:**
  - list (status, next run), detail with renewal orders;
  - pause / cancel (editor);
  - a "Planlar" tab for plan CRUD (admin; delete guarded when in use).
- **Settings page:** `/panel/ayarlar/abonelik`.
- **Tests:** `tests/unit/subscription-pricing.test.ts`, `tests/db/subscriptions.test.ts`
  (renewal idempotent per period, a double job run creates one order, skip, pause, out of stock).

### NOTIFY: order e-mails, templates editor, e-mail log, newsletter opt-in and campaigns

- **Order e-mails.** Replace the `notifyOrderEvent` stub so it enqueues inside or right after the
  status change, deduped per order and event. Keep the existing call sites, and keep it safe to
  call from scripts.
  - Rules:
    - card → the customer e-mail on `paid` (never "order received" for an unpaid card attempt);
    - bank transfer → on `placed` with the IBANs, the amount, the order number as the
      reference, and the deadline; then a `paid` e-mail when confirmed;
    - cash on delivery and deferred → on `placed`;
    - `shipped` with the carrier name and tracking link (from `shipping.carriers`);
    - `delivered`;
    - `cancelled` (with the refund note when paid);
    - `refunded`;
    - `payment_failed` → a "complete your payment" e-mail with the order page link (once per
      order);
    - admin `admin_new_order` when an order becomes actionable (paid card, or placed bank
      transfer / cash on delivery / deferred).
  - Every e-mail has the order lines with images, totals exactly like the order page, the
    addresses, and a "Siparişi görüntüle" button (the token link for guests).
- **Panel `/panel/ayarlar/e-posta`** (admin):
  - sender name, reply-to, admin recipients, footer note, the driver status (outbox / smtp /
    not configured);
  - per template:
    - enabled;
    - subject and intro per locale, with placeholder chips and validation;
    - live preview (sandboxed iframe, tr/en/ar, desktop / mobile width);
    - "Test e-postası gönder".
- **Panel `/panel/e-postalar`** (staff):
  - log with filters (status, template, recipient, related);
  - detail with the rendered mail in a sandboxed iframe, **secret link values hidden** (reset, verification,
    order, newsletter, review and skip links: `src/lib/email/redact.ts`, fixer 2026-11-10);
  - "Tekrar gönder" and "İptal" (queued). Password reset / verification mails are never re-sent from the log.
  - The order detail page lists the e-mails of that order.
- **Newsletter double opt-in:**
  - every subscribe entry point (footer, the `newsletter` section, checkout checkbox, register,
    profile) creates or updates a `pending` row + a `newsletter_confirm` e-mail;
  - `/bulten/onay?t=` activates it (shows a nice page);
  - an existing active row is unchanged;
  - re-subscribing after unsubscribing goes through pending again;
  - `/bulten/ayril?t=` and the one-click POST `/api/newsletter/unsubscribe` unsubscribe (no login);
  - rate-limited;
  - no enumeration (the same answer whether or not the e-mail exists);
  - keep the CSV export working (pending rows excluded or marked).
- **Campaigns on `/panel/e-bulten`** (`email_campaigns`):
  - compose a localized subject and body (rich text), audience (all / retail / business);
  - preview, test send (editor);
  - "Gönder" (admin, confirm with the recipient count), or schedule;
  - the job `newsletter.send` (frequent) enqueues e-mails in batches of 200 to active
    subscribers in their locale, with the unsubscribe link and headers;
  - stats (recipients / sent / failed);
  - an İYS hint for commercial messages in Türkiye.
- **Tests:** `tests/db/notify.test.ts`:
  - the right e-mails per method and status;
  - no duplicates on replays;
  - double opt-in;
  - unsubscribe tokens;
  - campaign batching is idempotent.

## Storefront rules (everyone)

- Static stays static: home, listing, product, category, legal, blog, kurumsal, numune and
  iletisim are ○ in `next build`. Personal things (viewer, favorites, business prices, review
  form, subscription choice) are client islands that call Server Actions after hydration.
- Account pages and auth pages are dynamic (◐ or ƒ) and send `noindex`.
- Every form:
  - zod on the server;
  - field errors under the fields;
  - works in tr/en/ar (RTL), dark mode and at 375 px;
  - submit buttons show a pending state;
  - success states are clear.
- Build links with `href` / `localizePath`; money only through `formatPrice`.

## Shared rules for all builders

- Every action and route handler checks the session and role itself. Never trust ids from the
  client: re-read them and check ownership on the server. Customers only ever see their own data.
- Concurrency:
  - money and stock changes lock rows;
  - jobs are idempotent and safe to run twice at the same time;
  - e-mails are deduped.
- Every panel mutation writes an audit entry and invalidates the right tags.
- Destructive actions use `ConfirmDialog`, and references are checked first.
- No PII or secrets in console logs: ids and event names only.
- Messages:
  - storefront strings only, in your own group;
  - the same shape in tr/en/ar;
  - Edit tool only;
  - re-read shared files before editing (`schemas.ts`, `nav-config.ts`, messages, sitemap,
    `templates/index.ts`, `cron` registry imports, `scripts/content-day4.ts`, settings pages
    nav).
- Never run `npm run db:seed` or migrations; core does the migration. Restore every row you change
  while testing, and delete every row, user, e-mail outbox file and mock server you create. While
  others are working, run only your own DB test files.
- No new npm dependencies except nodemailer (core). No git. No connected accounts. No generated
  images.
