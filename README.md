This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Environment variables

`.env.example` lists every variable with a short explanation (copy it to `.env.local`). Secrets live
only in the environment: never in the database, never shown in the panel (it shows "tanımlı / tanımlı
değil"), never logged.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (local: `npm run db` starts Postgres 17 on port 54329). |
| `BETTER_AUTH_SECRET` | Long random string. Signs sessions and, via HKDF, the signed links in e-mails (review, newsletter confirm / unsubscribe). Changing it signs everyone out and voids those links. |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_SITE_URL` | Public base URL of the site (links in e-mails, payment callback URLs). `NEXT_PUBLIC_SITE_URL` is baked into the build: a Vercel production build (`VERCEL_ENV=production`) fails when it is missing, not `https://`, or a local host. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Panel admin for `npm run admin:create`. |
| `PAYMENT_SIMULATOR` | Local only: `true` in `.env.local` = the local fake card gateway; wins over iyzico / PayTR. Ignored on a public https site (a production build on a non-local origin); never set it on Vercel. |
| `TRUSTED_IP_HEADER`, `AUTH_IP_HEADER`, `AUTH_TRUSTED_PROXIES` | Self-hosting behind a reverse proxy: the header it overwrites (e.g. `x-real-ip`), for per-IP rate limits. Not needed on Vercel. |
| `STORAGE_DRIVER`, `LOCAL_UPLOAD_DIR`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | Panel uploads (images and videos): local disk (default, `storage/uploads`) or Supabase Storage. Every file goes from the browser straight to the storage, one per request (no 4.5 MB serverless body limit); `local` refuses to run on Vercel (read-only disk). `SUPABASE_SERVICE_ROLE_KEY` may be a new secret key (`sb_secret_…`, sent only as `apikey`) or the legacy `service_role` JWT (deprecated end of 2026). The bucket must be public; set its file size limit to 50 MB and its allowed types to JPEG/PNG/WebP/AVIF/MP4/WebM. |
| `SUPABASE_PUBLISHABLE_KEY` | Optional, public by design: only needed if the Supabase API gateway asks for an `apikey` on signed-URL uploads (check once with a test upload on the live site). |
| `IYZICO_API_KEY`, `IYZICO_SECRET_KEY` | iyzico credentials. Card via iyzico is ready only when both are set. |
| `IYZICO_BASE_URL` | Optional override. Default `https://sandbox-api.iyzipay.com` while the panel's test mode is on, `https://api.iyzipay.com` otherwise. Overrides must be `https://`, or `http://localhost` / `http://127.0.0.1` for the payment mock: outside production, or in a production build whose `NEXT_PUBLIC_SITE_URL` is itself local (`next start` on `*.localhost` for an end-to-end check; a live site never qualifies). |
| `PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY`, `PAYTR_MERCHANT_SALT` | PayTR credentials (test mode is a request flag). |
| `PAYTR_BASE_URL` | Optional override (same rule as above), default `https://www.paytr.com`. |
| `EMAIL_DRIVER` | `outbox` (default outside production: `.html` + `.txt` files in `storage/mail-outbox/`) or `smtp`. In production without `smtp`, e-mails stay queued and the panel shows a warning. |
| `EMAIL_SMTP_URL` | e.g. `smtps://user:pass@smtp.example.com:465`. |
| `EMAIL_FROM` | e.g. `PRESTİJ <siparis@prestij.com.tr>` (a domain verified at the mail provider). |
| `EMAIL_OUTBOX_DIR` | Optional: folder for the `outbox` driver's files (default `storage/mail-outbox/`). |
| `AUTH_PUBLIC_SIGNUP` | Customer self-registration is open (with e-mail verification). `false` closes it in an emergency; staff accounts are not affected. |
| `CRON_SECRET` | Bearer secret for `/api/cron/*` (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`), at least 16 characters. Without it every cron request is refused. |
| `INDEXNOW_KEY` | Optional IndexNow key (8–128 letters, digits, hyphens), served at `/indexnow-key.txt`; changed pages are reported to Bing and Yandex daily. |

## Card payments (iyzico, PayTR) and the local payment mock

- New card payments use the provider chosen in `/panel/ayarlar/odeme` when its keys are set
  (`PAYMENT_SIMULATOR=true` wins locally). Callbacks, notifications and refunds always go to the provider
  and environment that took the payment. The panel page shows readiness, the URLs to give the providers
  and the go-live steps.
- Test mode on a live site: while the panel's test mode is on, a production build on a public origin
  offers card checkout only to signed-in panel staff (a test payment moves no money); everyone else sees
  card as unavailable. Test payments carry a red "TEST ÖDEMESİ – para çekilmedi" badge on the panel order
  page and in the admin new-order e-mail.
- iyzico: the buyer is redirected to iyzico's hosted Checkout Form; iyzico posts the token to
  `/api/payments/iyzico/callback`, which retrieves and verifies the result. PayTR: `/odeme/kart` shows the
  PayTR iframe; PayTR's server notifies `/api/payments/paytr/notify` (set it as "Bildirim URL" in the PayTR
  panel). Refunds: "Kart iadesi yap" on the panel order page (admin). Algorithms and sources:
  `src/lib/payments/iyzico-gateway.ts`, `src/lib/payments/paytr-gateway.ts`.
- Local mock of both providers (same signature algorithms, fake hosted page / iframe with "Başarılı /
  Başarısız" buttons, refunds):
  ```bash
  IYZICO_API_KEY=mock-key IYZICO_SECRET_KEY=mock-secret PAYTR_MERCHANT_ID=100001 PAYTR_MERCHANT_KEY=mock-paytr-key \
    PAYTR_MERCHANT_SALT=mock-paytr-salt node scripts/payment-mock.mjs --port 4411 \
    --paytr-notify-url http://localhost:3411/api/payments/paytr/notify
  # the dev server gets the same made-up keys, PAYMENT_SIMULATOR=false and
  # IYZICO_BASE_URL=http://127.0.0.1:4411 PAYTR_BASE_URL=http://127.0.0.1:4411
  ```
  For `next build` + `next start`, set these variables (and a local `NEXT_PUBLIC_SITE_URL`) for the build too:
  the PayTR iframe origin goes into the `/odeme/kart` CSP at build time. Also set `EMAIL_DRIVER=outbox`
  (production defaults to no driver).
  Test controls: `POST /_mock/paytr/replay { merchantOid }` (duplicate notification),
  `POST /_mock/config { iyzicoCancel: "refuse" }`, `GET /_mock/state`. `tests/db/payments-providers.test.ts`
  starts it in-process.

## Scheduled jobs

Jobs are registered per area (`registerJob` in `src/lib/cron/registry.ts`, imported from
`src/lib/cron/jobs.ts`) and run in two groups through `GET|POST /api/cron/frequent` and
`/api/cron/daily`, each job under its own Postgres advisory lock, with the last run stored in
`job_runs`.

- Vercel: `vercel.json` calls both groups once a day (a sub-daily schedule fails the deploy on the Hobby
  plan). On Vercel Pro, set the frequent cron to every 5 minutes: `"schedule": "*/5 * * * *"` for
  `/api/cron/frequent` in `vercel.json` (docs/DAY6-CORE-API.md §14). Placing an order also runs
  `orders.expire` at most every 5 minutes per instance.
- Local: start the app, then `node scripts/cron-local.mjs --base http://localhost:<port>` (frequent
  every 5 minutes, daily every 24 hours) or `--once [--group daily]`. It reads `CRON_SECRET` from
  `.env.local` or the environment.
