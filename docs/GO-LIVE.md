# Go-live: database steps on deploy day (B3 schema, B4 content, B5 admin)

For the lead, on the owner's Windows PC, in **Windows PowerShell**. This covers the database part of
the go-live runbook: create the schema on the new Supabase project, copy the owner's content into it,
lock it down, and create the production panel admin. Everything happens **before** the first Vercel
deploy, because the first build reads the database (product, category, blog and page routes are
prerendered).

Scripts (committed, run with `npx.cmd tsx` from the project root; why `.cmd`: see "The production window"):

| Script | What it does | Writes |
|---|---|---|
| `scripts/golive/copy-content.ts` | Copies the 25 content tables from the local DB to the target in ONE transaction, resets their id sequences, and with `--profile=sales` switches the target to sales mode (refused while the shop is not ready for sales), with `--profile=showcase` to showcase mode. A **production** target needs one of the two profiles (a plain copy is refused there; it stays for local rehearsals) | target only |
| `scripts/golive/verify-target.ts` | Read-only checks of the target: migrations, counts against local, no private or test data, RLS, launch flags of the profile, announcement links, sales readiness (`--profile=sales`), no localhost URLs, sequences | nothing |
| `scripts/golive/create-admin.ts` | Creates the production panel admin through the app's own Better Auth | target only |
| `scripts/golive/copy-run.ts`, `rules.ts`, `pg.ts` | The copy flow without the command line (testable), shared rules (URL guard, table lists, profiles, readiness, password rules) and DB helpers | — |

**The owner's decision: go live only when everything is ready for sales.** Use `--profile=sales` on deploy day
(B4 sets `$golive = 'sales'` once and every later command uses it). The showcase profile stays documented for the
case that this decision changes.

All three scripts take the target **only** from the environment variable `TARGET_DATABASE_URL`, never
from an argument or a file, and never print it. They accept exactly two kinds of target:

- **production**: the Supabase *session pooler* (`postgres.<ref>@…pooler.supabase.com:5432/postgres`),
  with exactly `?sslmode=require` and no other parameter;
- **rehearsal**: `127.0.0.1` or `localhost` with a database named `prestij_golive_*` and **no URL
  parameter** (postgres.js would let `?database=`, `?host=`, `?port=`, `?user=` or `?options=` redirect the
  connection to another database than the one checked; only a lone `?sslmode=disable` is allowed).

Everything else is refused: the owner's local `prestij` database, its backups, the transaction pooler
(port 6543), the direct host `db.<ref>.supabase.co`, a URL with `pgbouncer=true`, a URL that still has the
`[YOUR-PASSWORD]` placeholder or keeps its `[ ]` brackets around the password. The local source is always
opened read-only, and each script also checks `select current_database()` against the checked URL before
it reads or writes anything.

## Content that is copied, and what is not

Copied (25 tables, ids kept): `settings, themes, media, categories, products, product_options,
product_option_values, product_variants, variant_option_values, product_media, product_relations,
bundle_items, customer_groups, group_prices, tier_prices, subscription_plans, pages, page_sections,
menus, announcements, blog_posts, legal_documents, redirects, ui_strings, campaigns`.

Never copied (27 tables): `user, account, session, verification, rate_limit, rate_limit_counters, carts,
cart_items, orders, order_items, order_events, payments, coupons, wheel_spins, email_messages,
email_campaigns, job_runs, audit_log, newsletter_subscribers, contact_messages, quote_requests,
sample_requests, reviews, favorites, companies, subscriptions, addresses`.

A unit test (`tests/unit/golive-data-tables.test.ts`) fails when a new table is added to
`src/db/schema` without being put in one of the two lists, and when a copied table gets a foreign key
to a table that is not copied.

Media: the 52 image rows point to `/media/…`, which ships with the code (`public/media`). Nothing has to
be uploaded to Supabase Storage for the existing images. A photo uploaded in the **local** panel is stored
under `storage/uploads` (gitignored) with a `/uploads/…` URL and never reaches Vercel: do not upload new
images locally before the copy (the logo and new photos go in through the live panel after B6). The copy
prints a WARN line with such media ids and `verify-target.ts` reports them as FAIL (`media uploads`); see
the B4 failure table.

## The showcase profile (Level 1: site live, no orders)

`--profile=showcase` runs inside the copy transaction, **on the target only** (the local database is
never changed). Every changed settings document is parsed the way the storefront parses it, changed,
validated with the app's own schema (`settingsSchemas` in `src/lib/settings/types.ts`), written, and
read back before the commit:

| Where | Change |
|---|---|
| `settings.giftWheel` | `enabled` false, `reminderEnabled` false |
| `settings.payments` | `card.enabled`, `bankTransfer.enabled`, `cashOnDelivery.enabled` all false (checkout cannot place an order; `src/lib/orders/place.ts` refuses unavailable methods) |
| `settings.newsletter` | `enabled` false, `popupEnabled` false (until İYS) |
| `settings.samples` | `cartSampleEnabled` false, `requestFormEnabled` false (until ÜTS) |
| `settings.subscriptions` | `enabled` false (the local DB has no row: one is inserted with the defaults plus this change) |
| `pages` slug `hediye-carki-kampanya-kosullari` (id 13) | `is_published` false: `/sayfa/…` answers 404 and the page leaves the sitemap; the wheel dialog stops linking it |
| `page_sections` of type `newsletter` (id 9, home page) | `is_visible` false: this band renders its sign-up form whatever `newsletter.enabled` says, and every submission would fail while the newsletter is off |
| `announcements` | every **active** announcement whose link points at a feature the profile leaves off is set inactive and printed (sales-ready SR-3, both profiles; see "Announcements" below). Today: announcement 2 ("Oteller ve işletmeler için ücretsiz numune", link `/numune`), because the showcase profile switches both sample options off |

Not touched by the profile: the announcement texts (announcement 1 still says "1.500 TL ve üzeri
siparişlerde ücretsiz kargo"; the owner changes it in the local panel before the copy, runbook A6.7, or in
the live panel later), prices, legal texts. `verify-target.ts` prints the active announcements so this
is seen.

To switch a feature back on later, use the live panel (never SQL after the first deploy: SQL skips the
cache invalidation): wheel and its terms page in /panel/hediye-carki and /panel/sayfalar, payments in
/panel/ayarlar/odeme, the newsletter in /panel/ayarlar/bulten **and** the newsletter band on Ana Sayfa
in /panel/sayfalar, a deactivated announcement in /panel/duyurular.

## The sales profile (Level 2: orders by kapıda ödeme and/or havale, card later)

`--profile=sales` is the profile for "go live only when everything is ready for sales". It runs like the
showcase profile (inside the copy transaction, on the target only, every settings document parsed, changed,
validated with `settingsSchemas` and read back), but it **keeps** kapıda ödeme and havale exactly as the owner
configured them in the local panel, and switches off only what is not ready yet:

| Where | Change |
|---|---|
| `settings.payments` | `card.enabled` false (until PayTR is set up); `cashOnDelivery` and `bankTransfer` (accounts, discount, `paymentDays`) unchanged |
| `settings.giftWheel` | `enabled` false, `reminderEnabled` false (until the lawyer answers) |
| `settings.newsletter` | `enabled` false, `popupEnabled` false (until İYS) |
| `settings.samples` | `cartSampleEnabled` false, `requestFormEnabled` false (free samples only after ÜTS). Only once the ÜTS notification is confirmed: add `--keep-samples` to the copy **and** to every `verify-target.ts` run; samples then stay as configured locally (printed as `WARN`) |
| `settings.subscriptions` | `enabled` false (row inserted with the defaults when missing) |
| `pages` / `page_sections` | wheel terms page unpublished, newsletter band hidden (as showcase) |
| `announcements` | active announcements linking to a feature that stays off are deactivated and printed (as showcase). Today: announcement 2 (`/numune`), because the samples are switched off; with `--keep-samples` it stays |

**It refuses before anything is written** (dry run and copy alike, before a single statement reaches the target;
every problem is listed in Turkish, then in English, and the run ends with `REFUSED: satış profili reddedildi,
hiçbir şey yazılmadı / the sales profile was refused, nothing was written`) when, in the **local** content that
would be copied:

| Rule | Refused when | Fix (local panel, then copy again) |
|---|---|---|
| Legal texts | the current version of `pre_information`, `distance_sales`, `kvkk`, `returns`, `cookies` or `membership` is missing, has a label starting with "taslak", still carries the draft notice (`<aside class="legal-draft">`), or its body (any language, tags ignored) still contains a `[bracketed text]` of 2–120 characters: the same rule as the legal editor's "Doldurulacak yerler" list | Yasal Metinler: publish the lawyer-approved text under a label like "2026-11 v1" with the draft notice off and no `[ … ]` left (the seeded notes such as "[Sipariş özeti ödeme adımında otomatik eklenir.]" must go too). Only if the lawyer approved a bracketed text as it is (e.g. a citation "[Mülga: …]"): `--allow-legal-brackets` turns this rule into a `WARN` that still lists every bracket; the label and notice rules always refuse |
| Seller details | anything the panel's "Satıcı bilgileri eksiksiz" step asks for is missing: legal name, MERSİS number, tax office, tax number, **KEP address**, e-mail, phone, address (street, district, city), **chamber name** and an `https://` **link to the chamber's rules** (one rule: `missingSellerFields`, `src/lib/settings/seller.ts`) | Ayarlar › Firma bilgileri |
| Payment methods | neither kapıda ödeme nor havale is on | Ayarlar › Ödeme yöntemleri |
| Havale account | havale is on without an account that has a valid TR IBAN **and** an account holder | Ayarlar › Ödeme yöntemleri |
| Prices | **any** variant still has a Day-1 placeholder price (below); the SKUs are listed | Ürünler: real prices; or `--allow-prices` |

**Placeholder prices** (`src/lib/pricing/placeholder-prices.ts`, also used by the panel's launch checklist step
"Fiyatlar gerçek"): the Day-1 seed gave every product the same prices 149,90 / 449,90 / 1.499,90 / 1.599,90 TL (and
every variant a stock of 100). A variant *matches* when its price is one of those four, **whatever its stock**
(stock is usually the first thing the owner updates). Only active variants of active products with a price above 0
are considered (free samples are not). The scripts refuse while **any** considered variant matches and list the
SKUs (today 13 of 13). If the owner really sells at one of those prices, add `--allow-prices` to the copy (and to
`verify-target.ts`): the rule then prints a `WARN` with the same SKUs and does not refuse. The panel step is
"Tamam" only with no match, "Yapılacak" while at least 2 variants and at least half of them match, and
"Kontrol et" with the SKUs listed in between (the panel has no override).

`--allow-prices`, `--allow-legal-brackets` and `--keep-samples` are refused without `--profile=sales` (both scripts).

**Checked twice.** The readiness rules run first on the local content (the fast refusal above) and **again inside
the copy transaction, on the copied content** (after the profile, before the commit). If the local content changed
in between (a draft published, a price changed), the copy ends with `REFUSED: satış profili reddedildi: kopyalanan
içerik satışa hazır değil, kopya geri alındı / … the copy was rolled back, nothing was committed`; the target stays
empty and the copy can run again.

`verify-target.ts --profile=sales` checks the same flags (card, wheel, newsletter, samples, subscriptions off; wheel
terms page unpublished; no visible newsletter band; no stale announcement) and the same readiness rules on the
**target** as hard checks (`legal <key>`, `seller details`, `payment methods`, `prices`, `samples`; with
`--allow-prices` / `--allow-legal-brackets` / `--keep-samples` the matching line is a warning). Kapıda ödeme and
havale are not expected to be off.

B4 with the sales profile, complete (this is what B4 below runs with `$golive = 'sales'`):

```powershell
$golive = 'sales'
$flags = @()                       # e.g. @('--allow-prices') only as described above; @() in the normal case
$env:TARGET_DATABASE_URL = "${base}?sslmode=require"
npm.cmd run db                                                            # local source must run
npx.cmd tsx scripts/golive/copy-content.ts --dry-run "--profile=$golive" @flags
npx.cmd tsx scripts/golive/copy-content.ts "--profile=$golive" @flags
npx.cmd tsx scripts/golive/verify-target.ts "--profile=$golive" @flags
# … lock-down SQL (below), then:
npx.cmd tsx scripts/golive/verify-target.ts "--profile=$golive" @flags --locked-down
```

### Announcements (both profiles)

An active announcement whose link points at a feature the profile leaves off would send visitors to a page
with nothing to offer (or a 404), so the copy deactivates it on the target and prints it, and
`verify-target.ts --profile=…` fails on any that is still active (`announcement links`). Only relative storefront
links count (the panel stores them as paths; an absolute URL may be another site), in any language form
(`/numune`, `/tr/numune`, `/en/samples`, `/ar/samples?…`):

| Feature off | Links |
|---|---|
| samples (cart samples **and** the request form both off) | `/numune…` |
| gift wheel | `/sayfa/hediye-carki-kampanya-kosullari` or any link containing `hediye-carki` |
| newsletter | `/bulten…`, `#bulten`, `#e-bulten`, `#newsletter` |
| subscriptions | `/hesap/abonelikler…` |

The announcement texts themselves are never changed (e.g. the free-shipping amount): check them in the local
panel before the copy.

### Sample links on the storefront while samples are off (PayTR-fix IMPL-B, S17)

The copy changes no menu and no page section for the samples. The storefront hides them at render time instead,
server side and from cached reads only (`src/lib/samples/visibility.ts`), whenever `settings.samples` has both
`cartSampleEnabled` and `requestFormEnabled` false (what the sales profile writes without `--keep-samples`):

| Where | What is hidden |
|---|---|
| Header and footer menus (and their fallbacks) | every item whose link is the samples page, children included (today: header "Numune" `/numune`, footer_corporate "Ücretsiz Numune" `/numune#numune-formu`) |
| Page-builder sections on every page except `/numune` (`getStorefrontPage`, `src/lib/data/pages.ts`) | a section whose main call to action (`cta`, or a hero's `primaryCta`) is the samples page (today: home section 7 and kurumsal section 20, both `sample_cta`); any other button or link to it inside a section is removed and the section stays (today: home 6, kurumsal 15 and 18, the "Ücretsiz numune isteyin" second buttons) |

Links count in any language form, with or without query or anchor, exactly like the announcement rule above (a unit
test keeps the two equal). The settings document is cached under the `settings` tag, so switching samples back on
in the panel brings everything back without a deploy; with `--keep-samples` nothing is hidden. `/numune` itself is
left as stored and shows its closed note ("Numune talepleri şu anda alınmıyor…"). **Texts are never changed**: the
About page (`/sayfa/hakkimizda`, rich text with a link to `/numune`), the `/urunler` intro text (rich text 34, also
with a link to `/numune`; links inside rich text are content and stay), the FAQ answers on home (33), kurumsal (19)
and urunler (35), the bullets of home 6, kurumsal 18 and the kurumsal quote form (30), and the contact form intro and
its "Numune talebi" subject (27) still mention free samples. So do (PayTR-fix R-UX1, read-only query 2026-11-21)
6 of the 7 published blog posts, whose `blog_posts.body` mentions free samples and links `/numune` in tr, en and ar
(`5-litre-20-litre-sivi-sabun-rehberi`, `dogru-el-yikama-adimlari`, `dus-jeli-mi-kati-sabun-mu`,
`koku-secimi-lavanta-portakal-okyanus`, `otel-ofis-restoran-icin-sivi-sabun`, `sivi-el-sabunu-nasil-secilir`; seed
`scripts/seed-data/blog.ts` `TO.samples`), and the `categories.body` of `el-sabunu`, `dus-jeli` and `hediye-setleri`
(rendered by `CategoryContent` under the grid; seed `catalog-copy.ts`), also in all three languages. Category
`description`, `faq` and `seo` and the product jsonb fields do not link `/numune`; the KVKK text's "iletişim/numune/
teklif formları" is correct as it is. `src/lib/samples/visibility.ts` filters only menus and page-builder sections, so
these links stay clickable and land on the closed note. To re-check before the copy, search `page_sections`,
`menus`, `announcements`, `blog_posts.body` and `categories.body/description/faq` for "numune". The owner edits
them in the local panel before the copy (docs/YAYINA-ALMA-REHBERI.md, "Numune kapalıyken") or confirms ÜTS first and
copies with `--keep-samples`.

## Connection strings: which one where

From Supabase > **Connect**, the *shared pooler* entries (host ending in `.pooler.supabase.com`). Copy
the plain URI without ORM parameters. The user is `postgres.<project ref>`, the database `postgres`. Use
a database password made of letters and digits (runbook B2), so it needs no URL encoding.

| Use | URL | sslmode | Why |
|---|---|---|---|
| Vercel `DATABASE_URL` (the app) | Transaction pooler `…pooler.supabase.com:6543/postgres` | `?sslmode=require` | postgres.js; `src/db/index.ts` turns prepared statements off for `:6543` |
| `npx.cmd drizzle-kit migrate` (B3) | Session pooler `…pooler.supabase.com:5432/postgres` | `?sslmode=no-verify` | drizzle-kit uses the `pg` driver here (it prints "Using 'pg' driver"); `pg` treats `require` as `verify-full`, which fails against Supabase's own CA |
| `scripts/golive/*` (B4, B5) and any other postgres.js script | Session pooler `:5432` | `?sslmode=require`, nothing else | postgres.js treats `no-verify` as full verification and fails; the scripts refuse anything but `require` |
| `pg_dump` / `psql` / `pg_restore` (libpq) | Session pooler `:5432` | `?sslmode=require` | libpq `require` = encrypted, no CA check |
| Optional single URL with CA check | Session pooler `:5432` | `?sslmode=verify-full&sslrootcert=C:/path/prod-ca.crt` (CA from Database Settings > SSL) | Works for pg, postgres.js and libpq, but the golive scripts accept only `require` |

Do not use the direct host `db.<ref>.supabase.co` (IPv6-only on Free/Pro) or a "dedicated pooler"
entry from this PC. Corrections against runbook Appendix B: none in substance (both sslmode rules were
confirmed in `node_modules`: pg-connection-string 2.14.1 and postgres 4.1.0); the scripts now use
`TARGET_DATABASE_URL` (the runbook said `TARGET_URL`) and live in `scripts/golive/` instead of a scratch
folder.

## Before you start

- The owner has finished the local panel edits (runbook A6) and said "content final". For the sales launch that
  includes everything the sales profile checks (docs/YAYINA-ALMA-REHBERI.md section 3, step 1): lawyer-approved
  legal texts, complete seller details (incl. KEP and chamber), the havale IBAN, real prices. A dry run with
  `--profile=sales` against a rehearsal database (see "Sales-profile rehearsal") tells beforehand whether the copy
  will be refused.
- B1 is done: `prestij_backup_golive` exists (local safety copy).
- The local database runs: `npm.cmd run db` (safe to run again; the owner's site uses the same server).
- The Supabase project exists (B2): region eu-central-1, Data API off, SSL enforced, the Session and
  Transaction pooler URIs are in the password manager.
- No Vercel project has been deployed yet (if one was: after this page, redeploy **without** build cache).

## The production window

Open a **new** Windows PowerShell window that is used only for production, and close it at the end. Never
run `npm run dev`, `npm run test:db`, `npm run db:seed`, `npm run admin:create` or the content-day scripts in
a window that ever held a Supabase URL.

**Always type `npm.cmd` and `npx.cmd`, never `npm` / `npx`, in this window.** On this PC a new PowerShell
window runs with the default execution policy *Restricted*, so the `npm.ps1` / `npx.ps1` shims that plain
`npm` / `npx` resolve to are blocked ("cannot be loaded because running scripts is disabled on this
system"). The `.cmd` shims are the same programs and need no policy change. Never change the CurrentUser or
LocalMachine execution policy for this.

```powershell
Set-Location '<project root>'           # the folder with package.json
Remove-Item Env:DATABASE_URL, Env:TARGET_DATABASE_URL, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD, Env:DOTENV_OVERRIDE, Env:DOTENV_CONFIG_OVERRIDE -ErrorAction SilentlyContinue
npx.cmd --version                        # any version number = the .cmd shims work in this window

# The owner pastes the Session pooler URI (port 5432, with the real password) into a hidden prompt.
$s = Read-Host 'Supabase Session pooler URI (5432)' -AsSecureString
$base = ([System.Net.NetworkCredential]::new('', $s).Password).Trim()
if ($base -match 'YOUR-PASSWORD') { throw 'The URI still has the [YOUR-PASSWORD] placeholder.' }
if ($base -match ':\[[^@]*\]@') { throw 'Remove the [ ] around the password (they belong to the placeholder).' }
if ($base -notmatch '^postgres(ql)?://postgres\.[a-z0-9]+:[^@\s]+@[a-z0-9.-]+\.pooler\.supabase\.com:5432/postgres$') {
  throw 'Not a plain Session pooler URI (…pooler.supabase.com:5432/postgres, no ?parameters).'
}
([uri]$base).Host                        # prints only the host, e.g. aws-0-eu-central-1.pooler.supabase.com
```

The secret exists only in this window's memory: `Read-Host -AsSecureString` input is not saved in the
command history, and later lines refer to `$base`, never to the value.

## B3. Schema

```powershell
$env:DATABASE_URL = "${base}?sslmode=no-verify"   # drizzle-kit (pg driver) only
$env:DOTENV_DEBUG = 'true'                        # makes dotenv say that it keeps our DATABASE_URL
npx.cmd drizzle-kit migrate
Remove-Item Env:DATABASE_URL, Env:DOTENV_DEBUG
```

When it works it prints (rehearsed tonight):

```
Reading config file '…\drizzle.config.ts'
┆ "DATABASE_URL" is already defined and was NOT overwritten
◇ injected env (6) from .env.local
Using 'pg' driver for database querying
[✓] migrations applied successfully!
```

The line `"DATABASE_URL" is already defined and was NOT overwritten` is the proof that drizzle.config.ts
(which loads `.env.local` with dotenv) did not switch to the local database. If it is missing, stop:
`DOTENV_OVERRIDE` is set somewhere, or `$env:DATABASE_URL` is empty.

| Failure | Meaning | Recovery |
|---|---|---|
| `npx.ps1 cannot be loaded because running scripts is disabled on this system` (or `npm.ps1`) | plain `npx` / `npm` was typed | type `npx.cmd` / `npm.cmd`; never change the CurrentUser or LocalMachine execution policy |
| `password authentication failed` | the password in the URI is not the current database password | first check the URI: no `[ ]` left around the password (the window's check refuses that), the password pasted completely. Only if it is really the current one and still fails: Supabase > Database > Settings > reset the password, save it in the password manager, start "The production window" again |
| `Tenant or user not found` | wrong user or pooler host | copy the Session pooler URI again (user `postgres.<ref>`) |
| `self-signed certificate in certificate chain` | `sslmode=require` was used with drizzle-kit | use `?sslmode=no-verify` for this step only |
| `ENOTFOUND` / timeout | host typo, or the PC is offline | check `([uri]$base).Host`; the direct `db.<ref>.supabase.co` host does not work |
| error inside a migration | a statement failed | drizzle runs all pending migrations in one transaction, so nothing is half-applied; fix and run the same command again |

Running it twice is safe (already applied migrations are skipped).

## B4. Content copy, verification and lock-down

Set the profile **once**; every copy and verify line of this page (B4, the failure table, the lock-down check, B5)
uses it. `$flags` stays empty unless the sales section above says otherwise (`--allow-prices`,
`--allow-legal-brackets`, `--keep-samples`; each only with the reason it names).

```powershell
$golive = 'sales'                  # the owner's decision (sales-ready go-live); 'showcase' only if that decision changes
$flags = @()
$env:TARGET_DATABASE_URL = "${base}?sslmode=require"
npm.cmd run db                                                   # local source must run
npx.cmd tsx scripts/golive/copy-content.ts --dry-run "--profile=$golive" @flags
npx.cmd tsx scripts/golive/copy-content.ts "--profile=$golive" @flags
npx.cmd tsx scripts/golive/verify-target.ts "--profile=$golive" @flags
```

With `sales`, the dry run and the copy first print `Sales readiness (profile sales; …)` with one line each for the
legal texts, seller details, payments, prices and samples, then either `sales readiness OK` or the refusal list
(see "The sales profile"). Nothing below that list runs while it is refused; fix the items in the **local** panel
and run the dry run again.

**Dry run** prints the preflight, the copy order with the local row counts and the planned profile, and
ends with `DRY RUN OK: nothing was written to production aws-…pooler.supabase.com:5432/postgres.` (the profile
lines below are the showcase ones of 2026-11-14; with `sales` the payments line shows only `card.enabled true ->
false`, and `settings.samples` and announcement 2 appear as below unless `--keep-samples` is given):

```
Preflight
  target migrations   7/7, hashes = repo files (last: 0006_golive_rls)  OK
  local migrations    7/7  OK
  content tables      25 on both sides, columns compatible  OK
  target content      all 25 tables empty  OK
  row level security  enabled on 25/25 content tables; not applied to this login  OK
  outside references  none with data  OK
…
  274 rows in 25 tables; identity sequences to reset: announcements, blog_posts, …
Profile showcase (would be applied to the TARGET only, inside the copy transaction)
  settings.giftWheel      enabled true -> false, reminderEnabled true -> false  [existing row; validated with settingsSchemas.giftWheel]
  settings.payments       bankTransfer.enabled true -> false, card.enabled true -> false, cashOnDelivery.enabled true -> false  […]
                          also written in parsed form: bankTransfer.paymentDays (none) -> 3, card.maxInstallments (none) -> 1, paytrLogoImageId (none) -> null
  settings.newsletter     enabled true -> false  […]
  settings.samples        cartSampleEnabled true -> false, requestFormEnabled true -> false  […]
  settings.subscriptions  enabled true -> false  [no row yet: inserted with the schema defaults; …]
  pages               hediye-carki-kampanya-kosullari: id 13, published -> unpublished
  page_sections       id 9 (newsletter, page 1) -> hidden
  announcement 2      -> inactive: links to /numune (samples off) “Oteller ve işletmeler için ücretsiz numune”
```

(The counts are tonight's.) If A6 already switched something off in the local panel, that line shows
"(already as wanted)". A line `media uploads  WARN: media id(s) … point to /uploads/` means a photo was
uploaded in the local panel: see the failure table.

**Copy** prints the same preflight, the profile summary (with `sales` also `sales readiness OK (checked again on
the copied content, inside the transaction)`), then a table `table / local / copied / target / next id` where the
three counts are equal in every row, and ends with `OK: 274 rows in 25 tables copied to production …, profile sales
applied.` Nothing is committed unless every table copied completely, the settings read back correctly and (sales)
the copied content passed the readiness rules again.

**Verify** prints sections Schema, Content, Private data, Row level security, Launch flags, (with `sales`) Sales
readiness, Local URLs, Identity sequences, For the owner, and ends with `VERIFY OK` (exit code 0). Before B5 it reports
`user 0 account(s): none (run create-admin, B5)` as OK. Expected `settings` line:
`11 rows (local 10; added on the target: subscriptions)`. Until the lock-down SQL below has run, the
lines `API role grants` and `API default privileges` are warnings (Supabase grants its API roles access by
default); after it, `--locked-down` turns them into hard checks.

| Failure | Meaning | Recovery |
|---|---|---|
| `npx.ps1 cannot be loaded …` / `npm.ps1 cannot be loaded …` | plain `npx` / `npm` was typed | type `npx.cmd` / `npm.cmd` (never change the execution policy) |
| `REFUSED: TARGET_DATABASE_URL …` | URL rule (the reason says which) | fix the URI and set the variable again |
| `REFUSED: a production copy needs a profile …` | `"--profile=$golive"` is missing from the line (or `$golive` is empty in this window) | set `$golive = 'sales'` and copy the B4 line exactly |
| `REFUSED: satış profili reddedildi, hiçbir şey yazılmadı …` | the local content is not ready for sales; the list above the line says what (Turkish, then English) | nothing was written (the target was not touched). The owner fixes each item in the **local** panel (Yasal Metinler, Firma bilgileri, Ödeme yöntemleri, Ürünler), then run the dry run again. Never add `--allow-prices` / `--allow-legal-brackets` just to get past it |
| `REFUSED: satış profili reddedildi: kopyalanan içerik satışa hazır değil, kopya geri alındı …` | the local content changed between the first check and the copy (e.g. the panel published a draft meanwhile) | the copy rolled back, the target is still empty: stop editing the local panel, run the dry run and the copy again |
| `REFUSED: --allow-prices, … belong(s) to --profile=sales` | a sales-only flag with another profile | use `$golive = 'sales'` |
| `REFUSED: remove the square brackets around the password …` | the `[ ]` of the `[YOUR-PASSWORD]` placeholder stayed in the URI | start "The production window" again and paste the URI without them |
| `REFUSED: the target has N applied migrations, the repo ships M` | B3 not run, or run with an older checkout | run B3 again from this project folder |
| `REFUSED: target migration N (…) was applied from a different file …` | the schema came from another copy of the repo | stop; the target must be migrated from this folder (a fresh Supabase project is the clean fix) |
| `REFUSED: the target is not empty (…)` | a copy has committed before | run `verify-target.ts`; if it is OK you are done. Otherwise see "Start the copy over" |
| `REFUSED: schemas differ: …` | the local DB is behind the repo migrations | in a normal (non-production) window: `npm.cmd run db:migrate`, then retry |
| `REFUSED: row level security applies to this login …` | not connected as the table owner | use the Session pooler URI with user `postgres.<ref>` |
| `REFUSED: FORCE ROW LEVEL SECURITY is set on …` | a migration forces RLS (the app would read nothing) | fix the migration first |
| `ECONNREFUSED 127.0.0.1:54329` | local database not running | `npm.cmd run db` |
| `FAILED: … nothing was committed on the target` | an error before the target COMMIT | the target is still empty; fix the cause and run the copy again |
| `FAILED: … the target COMMIT may or may not have completed` | the connection dropped while the target COMMIT was in flight | run `npx.cmd tsx scripts/golive/verify-target.ts "--profile=$golive" @flags`: VERIFY OK = committed, you are done; every content table empty = nothing committed, run the copy again; anything else: "Start the copy over" |
| `FAILED: … the copy had committed on the target before this error` | the copy is in; the error came after it (e.g. the local connection dropped) | run `npx.cmd tsx scripts/golive/verify-target.ts "--profile=$golive" @flags`; do not copy again |
| copy `media uploads WARN`, verify `FAIL media uploads` | a photo uploaded in the LOCAL panel (`/uploads/…`, a file on this PC only) | not a reason to stop: after B6, upload that image again in the live /panel/medya, select it again where it was used (logo: Ayarlar > Genel; product: the product's media), then delete the old row in /panel/medya. Until then that image is missing on the live site |
| verify `FAIL` on a launch flag | the verify line names another profile than the copy (check `$golive` and `$flags`), or the target was changed by hand | with `sales`: **never switch kapıda ödeme or havale off** (that would quietly turn the sales launch into a showcase). Switch off only the item the FAIL line names (card, wheel, newsletter, samples, subscriptions) with the SQL below, before the first deploy, or "Start the copy over" and copy again with the profile |
| verify `FAIL` in Sales readiness | the target holds content the readiness rules refuse (should be impossible after a sales copy, which checks the copied content inside its transaction) | "Start the copy over", fix locally, copy again |
| verify `FAIL` on a count | local content changed after the copy (freeze broken) | "Start the copy over" |

Fixing a single flag before the first deploy (Supabase SQL Editor), for example the wheel:
`update settings set value = jsonb_set(value, '{enabled}', 'false'::jsonb), updated_at = now() where key = 'giftWheel';`
(samples: `jsonb_set(jsonb_set(value, '{cartSampleEnabled}', 'false'::jsonb), '{requestFormEnabled}', 'false'::jsonb)` with
`key = 'samples'`). After the first deploy, change settings only in the panel.

### Supabase-only lock-down (SQL Editor)

Run after the copy, **as one Run, exactly this block and nothing else** (no `VACUUM` in the same Run:
the SQL Editor sends a script as one transaction, `VACUUM` cannot run inside one, and the error then rolls
back every statement before it). Idempotent: the RLS loop does nothing for tables the repo migration
`0006_golive_rls` already covers; the rest removes the table grants Supabase gives its API roles by default
(the app never uses the Data API; it connects as the table owner, which RLS does not restrict).

```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
```

It must answer "Success. No rows returned". Any error means **nothing** of it was applied: read the error,
fix it and run the whole block again. Then check it from the production window (no SQL Editor checks
needed; the verifier reads the same catalogs):

```powershell
npx.cmd tsx scripts/golive/verify-target.ts "--profile=$golive" @flags --locked-down
```

It must end with `VERIFY OK`, with `RLS enabled  on all 52 public tables`, `API role grants  none on public
tables and sequences` and `API default privileges  none for new tables, sequences or functions in schema
public` as OK. `--locked-down` turns those lines into failures, so a lock-down that did not apply cannot
pass. Storage is not affected (it uses its own `storage` schema). `copy-content.ts` already ran `ANALYZE` on
every copied table; no `VACUUM` is needed. The identity-sequence block of the runbook's
`supabase-after-copy.sql` is not needed either: `copy-content.ts` resets the sequences itself.

### Start the copy over (only before the first deploy)

Only while the shop has no customer data. In the Supabase SQL Editor:

```sql
TRUNCATE settings, themes, media, categories, products, product_options, product_option_values,
  product_variants, variant_option_values, product_media, product_relations, bundle_items,
  customer_groups, group_prices, tier_prices, subscription_plans, pages, page_sections, menus,
  announcements, blog_posts, legal_documents, redirects, ui_strings, campaigns
  RESTART IDENTITY CASCADE;
```

`CASCADE` also empties tables that point at these (carts, orders, reviews, companies, …), which are
empty before launch. The admin account is not affected. Then run the B4 commands again.

## B5. Production admin

```powershell
$env:ADMIN_EMAIL = '<a mailbox the owner already reads>'     # not a secret; never admin@prestij.local
$p = Read-Host 'Panel şifresi (en az 14 karakter)' -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $p).Password
npx.cmd tsx --conditions=react-server scripts/golive/create-admin.ts
Remove-Item Env:ADMIN_PASSWORD; Remove-Variable p
npx.cmd tsx scripts/golive/verify-target.ts "--profile=$golive" @flags --locked-down
```

Why not `npm run admin:create`: it runs with `--env-file=.env.local`, so an unset or empty
`ADMIN_EMAIL`/`ADMIN_PASSWORD` silently becomes the **local** admin's e-mail and password from
`.env.local` (PowerShell deletes a variable that is set to `''`), it accepts any `DATABASE_URL`, and it
allows 10-character passwords. `scripts/golive/create-admin.ts` reads nothing from disk, applies the
target URL rules, requires 14-128 characters (no shop name, no e-mail, not a run of a few characters),
refuses `.local`/example addresses in production, and never prints the password.

When it works:

```
… WARN [Better Auth]: … Base URL is not set. …        (expected: no web request is involved here)
Admin created: owner@… (role admin, e-mail verified) on production aws-…pooler.supabase.com:5432/postgres
Accounts on the target: 1 admin; sessions: 0
OK
```

Then `verify-target.ts` must end with `VERIFY OK`, with `user 1 account(s): 1 admin` and
`account 1 row(s), 1 admin credential(s)`. (Rehearsed tonight with an `@test.local` admin: the verifier then
reports that account under `test rows` as FAIL, by design; a real mailbox does not match.)

| Failure | Meaning | Recovery |
|---|---|---|
| `REFUSED: the password must have at least 14 characters` (or another password rule) | weak password | generate one in the password manager, enter it again |
| `REFUSED: ADMIN_EMAIL must be a real mailbox …` | placeholder or `.local` address | use the owner's real inbox (password resets go there) |
| `REFUSED: start it with: npx.cmd tsx --conditions=react-server …` | flag missing | copy the command exactly |
| `REFUSED: connected to database "…", but the checked URL names "…"` | the connection did not land on the checked database (should be impossible with the URL rules) | stop and check `$base`; nothing was written |
| `REFUSED: … is already an admin` | it ran before | nothing to do; to set a new password add `--reset-password` (revokes that admin's sessions) |
| `REFUSED: … already exists as a "customer" account` | someone registered that address | use another address; never promote unknown accounts |

## Close the window

```powershell
Remove-Item Env:TARGET_DATABASE_URL, Env:ADMIN_EMAIL -ErrorAction SilentlyContinue
Remove-Variable base, s, golive, flags -ErrorAction SilentlyContinue
exit
```

Then continue with B6 (Storage bucket) and the Vercel import (B9). In any window used for local work,
`echo $env:DATABASE_URL` and `echo $env:TARGET_DATABASE_URL` must print nothing.

## Rehearsal (done 2026-11-14, local only)

On the local server, with throwaway databases created from `template0` and dropped afterwards:

1. `prestij_golive_rehearsal1`: `drizzle-kit migrate` with `DATABASE_URL` set in the environment (dotenv
   debug confirmed "already defined and was NOT overwritten"), `copy-content.ts --dry-run`, then
   `--profile=showcase`, then `verify-target.ts --profile=showcase`: VERIFY OK (one warning: no repo
   migration enables RLS yet). Every copied table was compared row by row with the local database:
   identical, apart from the profile rows (page 13 differs only in `is_published`/`updated_at`).
   `create-admin.ts` created a test admin (`@test.local`), refused a second run, reset the password with
   `--reset-password`; an in-process sign-in with that password worked and a wrong one was refused; the
   verifier then reported the session, the rate-limit counter and the test account as failures, as it
   should.
2. `prestij_golive_rehearsal2`: same, with RLS enabled on every table first (what the RLS migration will
   do): the copy works and the verifier reports `RLS enabled on all 52 public tables`. With `FORCE ROW
   LEVEL SECURITY` on one table the copy is refused.

3. `prestij_golive_final` (FINAL, with migration `0006_golive_rls` in the repo, run in Windows PowerShell
   with `npx.cmd`): `drizzle-kit migrate` (dotenv: "already defined and was NOT overwritten"), dry run
   (`7/7 … 0006_golive_rls`, RLS `25/25`), copy with the showcase profile (274 rows, 25 tables, counts equal
   in every row), `verify-target.ts --profile=showcase` and `--locked-down`: VERIFY OK with every line OK
   (RLS on all 52 tables). A target URL with `?database=prestij` was refused by both scripts. The lock-down
   block above was run as one multi-statement query inside a rolled-back transaction, after creating
   Supabase's three API roles with Supabase's default grants: before, the verifier's queries saw grants for
   3 roles and 9 default-privilege entries; after, none (and RLS on 52/52). `create-admin.ts` created an
   `@test.local` admin, refused a second run, and `--reset-password` worked (the verifier then reports that
   account under `test rows`, as designed). A production-like build on this database (no
   `PAYMENT_SIMULATOR`, outbox mail, a throwaway auth secret) passed the strict SEO audit, the smoke test and
   the headless-browser checks (storefront, closed checkout, panel login, the new checklist items).

The first rehearsal found a real bug, fixed before this page was written: settings written as a
pre-serialized JSON string were stored as a jsonb *string*, which the storefront would have read as
"all defaults" (every payment method on). The copy now writes through `tx.json()` and reads every
settings document back inside the transaction before committing.

To repeat a rehearsal (bash; any `prestij_golive_*` name; in PowerShell use `npx.cmd` and `$env:` variables):

```bash
node -e "const s=require('postgres').default('postgres://postgres:postgres@127.0.0.1:54329/postgres');s.unsafe('create database prestij_golive_x template template0').then(()=>s.end())"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/prestij_golive_x npx drizzle-kit migrate
export TARGET_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/prestij_golive_x
npx tsx scripts/golive/copy-content.ts --dry-run --profile=showcase
npx tsx scripts/golive/copy-content.ts --profile=showcase
npx tsx scripts/golive/verify-target.ts --profile=showcase
# drop it the same way: drop database prestij_golive_x with (force)
# (never CREATE DATABASE … TEMPLATE prestij: it needs the owner's site disconnected)
```

### Sales-profile rehearsal (sales-ready, 2026-11-20)

Proves both halves of the sales profile on throwaway databases: it **refuses** on today's local content, and
it **passes** end to end once the content is ready. The owner's `prestij` database is only read. Because the
readiness rules read the copy's **source**, the "ready" half copies from a patched rehearsal database: a
rehearsal database may be the source only when the target is another local rehearsal database
(`checkSourceUrl(…, { rehearsalTarget })`; a production copy always reads the owner's database).

```bash
mk() { node -e "const s=require('postgres').default('postgres://postgres:postgres@127.0.0.1:54329/postgres');s.unsafe('create database $1 template template0').then(()=>s.end())"; \
       DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/$1 npx drizzle-kit migrate; }
mk prestij_golive_sa; mk prestij_golive_sb
L=postgres://postgres:postgres@127.0.0.1:54329

# 1. Today's content is refused, nothing is written (exit code 1 both times; sa stays empty)
export TARGET_DATABASE_URL=$L/prestij_golive_sa
npx tsx scripts/golive/copy-content.ts --dry-run --profile=sales   # REFUSED: legal drafts/[placeholders], seller, IBAN, prices
npx tsx scripts/golive/copy-content.ts --profile=sales             # REFUSED, same list

# 2. Plain copy into sa, then patch sa ONLY with fake-but-valid data
npx tsx scripts/golive/copy-content.ts
npx tsx scripts/golive/verify-target.ts --profile=sales            # VERIFY FAILED (flags + readiness)
node -e "
const s=require('postgres').default('$L/prestij_golive_sa');
(async()=>{const [{d}]=await s\`select current_database() d\`; if(d!=='prestij_golive_sa') throw new Error(d);
 await s.begin(async t=>{
  for (const k of ['pre_information','distance_sales','kvkk','returns','cookies','membership'])
   await t\`update legal_documents set version='prova-2026-11 v1', body=\${t.json({tr:'<p>Prova metni.</p>'})} where key=\${k} and is_current\`;
  await t\`update settings set value = value || \${t.json({email:'satis@prestij.example',mersisNo:'0123456789012345',taxOffice:'Kocasinan',taxNumber:'1234567890',kep:'prestij@hs01.kep.tr',chamber:{name:{tr:'Kayseri Ticaret Odası'},rulesUrl:'https://www.example.org/meslek-kurallari'}})} where key='general'\`;
  await t\`update settings set value = jsonb_set(jsonb_set(value,'{bankTransfer,accounts}',\${t.json([{bank:'Prova Bankası',holder:'PRESTİJ BUKLET KOZMETİK',iban:'TR330006100519786457841326'}])}),'{cashOnDelivery,enabled}','true') where key='payments'\`;
  await t\`update product_variants set price = price + 1000, stock = 25 where price > 0\`;
 }); await s.end();})()"

# 3. Copy the ready content (sa) to sb with the sales profile, verify sb
export SOURCE_DATABASE_URL=$L/prestij_golive_sa TARGET_DATABASE_URL=$L/prestij_golive_sb
npx tsx scripts/golive/copy-content.ts --dry-run --profile=sales   # Sales readiness … OK, DRY RUN OK
npx tsx scripts/golive/copy-content.ts --profile=sales             # OK … profile sales applied
npx tsx scripts/golive/verify-target.ts --profile=sales            # VERIFY OK
unset SOURCE_DATABASE_URL TARGET_DATABASE_URL
# drop prestij_golive_sa and prestij_golive_sb (drop database … with (force))
```

What it showed on 2026-11-20 (IMPL-B, databases `prestij_golive_implb_{a,b,c,d}`, all dropped afterwards; the
owner's database fingerprint was identical before and after):

1. Dry run and copy with `--profile=sales` on today's content: `REFUSED` with 21 problems (all six legal texts:
   "taslak-1", draft notice, `[e-posta adresi]`-style placeholders; seller e-mail, MERSİS, tax office and number;
   havale on without an account; 13/13 priced variants on Day-1 prices with stock 100), exit code 1, the target
   still empty (the plain copy after it passed the "target is empty" preflight). With `--allow-prices` the price
   rule became a `WARN` and the other 20 problems still refused. `--allow-prices` without `--profile=sales` and an
   unknown profile were refused.
2. `verify-target.ts --profile=sales` on a plain copy: `VERIFY FAILED` on the wheel, card, newsletter and
   subscription flags, the wheel terms page, the newsletter band, the six legal texts, seller details, payment
   methods and prices.
3. After patching rehearsal A with fake-but-valid data, the sales copy A → B passed its readiness check, switched
   card, wheel, newsletter and subscriptions off, kept kapıda ödeme, havale (1 account, 3 days) and samples, and
   `verify-target.ts --profile=sales` ended with `VERIFY OK`. The same database checked with `--profile=showcase`
   failed exactly on the kept methods and samples, as it should.
4. Showcase copy into C: announcement 2 (`/numune`) was deactivated and printed, `VERIFY OK`; re-activating it made
   `verify-target.ts --profile=showcase` fail on `announcement links`.

Repeated after the sales-ready FIX on 2026-11-21 (databases `prestij_golive_fix{a,b,c}`, dropped afterwards; the
owner's database fingerprint identical before and after; the seller patch in the recipe above now also fills KEP
and the chamber, which the seller rule requires since the FIX):

1. Today's content: `REFUSED` with 21 problems, Turkish titles instead of keys ("Ön Bilgilendirme Formu: …"), the
   seller line naming KEP, chamber and its rules link, the price line listing the SKUs, and a samples line
   ("switched off on the target by the profile"). `--keep-samples` with `--profile=showcase`,
   `--allow-legal-brackets` without a profile and a plain dry run against a production-shaped URL were refused
   (the last one before any connection).
2. Patched A → B with `--profile=sales`: readiness OK, samples switched off, announcement 2 deactivated,
   `sales readiness OK (checked again on the copied content, inside the transaction)`, `VERIFY OK`.
3. One variant of A set back to 149,90 TL: the dry run refused with that one SKU; A → C with `--allow-prices
   --keep-samples` copied with two `WARN` lines and kept announcement 2; `verify-target.ts --profile=sales
   --allow-prices --keep-samples` ended `VERIFY OK (2 warning(s): prices, samples)`, and without `--keep-samples`
   it failed on the two samples flags and the samples line.

## Level 3: PayTR card payments (after go-live; PayTR-fix, 2026-11-21)

Nothing here runs on deploy day: the sales profile leaves `card.enabled` false and the database still selects
iyzico. The owner-facing walk-through is docs/YAYINA-ALMA-REHBERI.md §4.1, the lead's step list RUNBOOK C12. What
the lead must know:

1. **Two gates at PayTR.** The application review (documents, KYC by the imza yetkilisi with an NFC phone and a chip
   ID card, the site's legal and contact pages) and, after a test payment on the live site, the live-mode request
   (Destek & Kurulum › Canlı Mod: "Evet, Entegrasyonu Tamamladım", then "Canlı Moda Geçiş Talebi Gönder"; PayTR
   confirms by SMS and e-mail).
   Official pages give "2 hours" and "1-5 business days"; plan for days. Application form: product **Sanal POS**,
   **Limited Şirket**, website `https://www.<domain>`; the integration is "kendi yazılımımız, iFrame API".
2. **Domains.** Add both `<domain>` and `www.<domain>` to the Vercel project so both get certificates (the PayTR
   contract, Art. 5.22, wants valid SSL on every public page) and the apex redirects to www. Use exactly
   `https://www.<domain>` everywhere: the PayTR form, `NEXT_PUBLIC_SITE_URL`, the Bildirim URL, the contracts.
3. **Keys.** PAYTR_MERCHANT_ID / KEY / SALT from PayTR Mağaza Paneli › Destek & Kurulum › Entegrasyon Bilgileri
   (formerly "Bilgi", still so in PayTR's English FAQ; PayTR documents no user roles for it: if the page is missing,
   sign in with the store's main user or ask PayTR) into Vercel (Production, sensitive), then **Redeploy**. Never set
   `PAYTR_BASE_URL` or `PAYMENT_SIMULATOR` there.
4. **Bildirim URL.** Copy "PayTR bildirim URL'si" from /panel/ayarlar/odeme into Destek & Kurulum › Ayarlar ›
   Bildirim URL Ayarları, protocol **HTTPS**, no trailing slash (the slash form answers 308), never a `*.vercel.app`
   address (the panel warns when the site runs on one). Check without side effects: `curl.exe -i
   https://www.<domain>/api/payments/paytr/notify` answers 405 (Allow: POST); a 30x means the wrong host or a
   redirect in front of it. The readiness block shows whether the keys are set ("Hazır"). The old POST probe
   (`--data "merchant_oid=TEST"`, 400 "bad hash") still works and is only logged: the dashboard warning
   "PayTR bildirimleri reddediliyor" counts refusals whose merchant_oid is a stored attempt of one of our orders
   (PayTR-fix R5). Prefer the GET anyway. Do not enable PayTR's Havale/EFT product or an interim notification URL (the handler accepts
   card notifications only).
5. **Panel.** /panel/ayarlar/odeme: provider PayTR, test mode **on**, card on (CF-11 keeps card visible to signed-in
   staff only). Test payment, order "Ödendi", refund. Then the live-mode request; only after PayTR's SMS or e-mail:
   test mode off, one small real payment and its refund. A refund on the first day may fail with PayTR `010` (net
   balance too low): not a site bug.
6. **Contract notice (S7).** `footer.paytr.*` UI strings render "Bu internet sitesindeki ödeme hizmetleri PAYTR Ödeme
   ve Elektronik Para Kuruluşu A.Ş. tarafından sağlanmaktadır." with the company name linked to https://www.paytr.com
   (`src/components/store/PaytrNotice.tsx`): always under the iframe on /odeme/kart, and in the footer only while
   `card.enabled && provider === "paytr" && !testMode`, the PayTR keys are set and the simulator is off
   (`src/lib/payments/paytr-notice.ts`). The logo is `settings.payments.paytrLogoImageId` (Ayarlar › Ödeme yöntemleri ›
   PayTR logosu): the owner uploads PayTR's own logo file (PayTR panel, or the PayTR_Gorselleri.zip link in the
   dev.paytr.com FAQ); nothing renders without it.
7. **Afterwards.** Partial refunds only by hand in the PayTR panel plus an order note, and never "Kart iadesi yap" on
   that order afterwards (the site refunds in full only). Linkle Ödeme payments never reach the site. Keep
   installments off unless the lawyer's texts cover them. The owner checks PayTR "Mağaza Bildirimleri" daily in the
   first weeks; the dashboard to-dos "Kart ödemesi doğrulanamadı", "PayTR bildirimleri reddediliyor", "Canlı siparişe
   PayTR test ödemesi geldi" and "Başarısız ödemeden sonra başarılı bildirim" are explained in the owner guide and in
   docs/DAY6-CORE-API.md §16. "Canlı siparişe PayTR test ödemesi geldi" means the panel test mode was switched off
   before PayTR's live approval: switch it back on until PayTR's SMS or e-mail. PayTR's İşlemler page knows the
   merchant_oid ("PayTR sipariş no", e.g. `PR261001A2K7Q9ZB`) or the buyer's e-mail, never the dashed order number;
   the "Kart ödemesi doğrulanamadı" notice prints the merchant_oids to search for.

## The havale line in the contracts (for the lawyer)

With a havale order, the order block that the checkout puts in front of the Ön Bilgilendirme Formu and the Mesafeli
Satış Sözleşmesi (seller, buyer, items, totals, payment method) adds one generated line, with the date and the day
count the order was placed with (Ayarlar › Ödeme yöntemleri › Ödeme süresi, stored with the order):

> Havale/EFT ile ödemede son ödeme tarihi: 13 Kasım 2026 (sipariş tarihinden itibaren 3 gün).

It states no consequence (since the sales-ready FIX; the earlier draft added "Bu tarihe kadar ödemesi hesabımıza
ulaşmayan siparişler iptal edilebilir."). What happens after the date belongs in the lawyer-approved body. The
order e-mail and the order page still tell the buyer that an unpaid order may be cancelled (they are not contract
text). docs/YAYINA-ALMA-REHBERI.md asks the lawyer about it.
