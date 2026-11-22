# Day 3: the panel edits everything

Read `docs/ARCHITECTURE.md`, `docs/NEXT16-NOTES.md` and `docs/DAY2-CORE-API.md` first. This file is the
contract the day-3 builders share. Where it names a file, function or type, use exactly that name. If
something here is wrong or impossible, do the closest correct thing and say so in your report.

**Goal.** The client must be able to change everything visible on the storefront from `/panel`, without
code: products and prices, categories, home and other pages (sections), menus, announcements, theme
colors, UI texts, settings (company, shipping, payments incl. IBANs), legal texts, campaigns, coupons,
blog, media. The panel must feel as premium as the storefront: calm, fast, clear Turkish copy, no
surprises. After a save, the storefront shows the change on the next request and stays static.

## Scope

In scope:
- Panel kit (forms, localized inputs, media picker, save bar, dialogs, toasts, command palette).
- Products and categories: create, edit, duplicate, archive, delete; variants, options, prices,
  stock, media, SEO, bundles, tier and group prices, related products.
- Pages and sections (page builder), menus, announcements.
- Themes (scheduled and campaign-linked), UI text overrides.
- Settings (all keys) and versioned legal documents.
- Campaigns (panel and storefront display), coupons, newsletter subscriber list.
- Media library with uploads; blog (panel and storefront).
- Storefront pages that the main menu already links to: `/kurumsal`, `/numune`, `/iletisim` (CMS
  pages) with a contact form, and a panel inbox for its messages.
- Team (staff accounts and roles), audit log viewer, a real dashboard.
- Two storefront polish items (see TEAM).

Out of scope (day 4+): real payment providers, e-mails (stubs only), customer accounts, B2B
approvals, quote and sample request forms (CTAs point to the contact page meanwhile), reviews,
subscriptions, e-mail campaigns, cron, draft preview on the storefront.

## Roles (enforced on the server in every action and route handler)

| Area | Minimum role |
|---|---|
| Orders (existing), messages inbox | staff |
| Product list, quick stock edit | staff |
| Products (create/edit/delete), categories, pages/sections, menus, announcements, blog, media, theme, UI texts, campaigns, coupons, newsletter list | editor |
| Newsletter CSV export (personal data), settings (all tabs), legal documents, team, audit log | admin |

Nav items for roles above the user's are hidden; the server check is what counts.

## CORE (runs alone first; everyone else builds on it)

Write `docs/DAY3-CORE-API.md` with every export below, its exact signature and an example.

1. **Action wrapper** `src/lib/panel/action.ts`:
   ```ts
   export type ActionResult<T = undefined> =
     | { ok: true; data?: T; message?: string }
     | { ok: false; error: string; code: PanelErrorCode; fieldErrors?: Record<string, string> };
   export function panelAction<S extends z.ZodType, T = undefined>(opts: {
     minRole: StaffRole;
     schema: S;
     run: (input: z.output<S>, ctx: { actor: StaffSession; tx: Tx }) => Promise<{
       data?: T; message?: string; tags?: string[]; audit?: AuditEntry | AuditEntry[];
     }>;
   }): (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
   ```
   - Reads one form field `payload` (JSON) and validates it with `schema`. Editors keep their state in
     React and submit it as JSON. Field errors use dotted paths (`variants.2.price`) and Turkish text.
   - Runs `run` in one `db.transaction`. Audit rows are written in the same transaction. After commit
     it calls `updateTag` once per distinct tag.
   - `src/lib/panel/errors.ts`: `class PanelError(code, message, fieldErrors?)` with
     `PanelErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "in_use" | "server"`.
     Unknown errors are logged with `safeErrorInfo` and returned as a generic Turkish message.
   - Business logic lives in services (`src/lib/panel/<area>/service.ts`) that take `(tx, input, actor)`
     and never touch Next APIs, so DB tests can call them directly.
2. **Optimistic locking** `src/lib/panel/concurrency.ts`: `assertFresh(row.updatedAt, expectedUpdatedAt)`
   throws `PanelError("conflict", "Bu kayıt siz düzenlerken başka biri tarafından değiştirildi. Sayfayı
   yenileyin.")`. Every editor sends the `updatedAt` it loaded. Stock quick-edits send the stock they saw.
3. **Audit** `src/lib/panel/audit.ts`: `writeAudit(tx, { actorId, action, entity, entityId, before, after })`.
   Never store passwords or tokens. Keep `before`/`after` to the changed record.
4. **Validation helpers** `src/lib/panel/schemas.ts`: `localizedTextInput` (tr required, en/ar optional,
   trimmed), `slugInput` (lowercase a–z, 0–9, hyphen), `hrefInput` (relative `/path` not `//`, `#anchor`,
   `https://`, `mailto:`, `tel:`; rejects `javascript:`, `data:` and everything else), `kurusInput`,
   `percentInput`, `hexColorInput`, `scheduleInput` (end after start), `mediaIdInput`.
   `src/lib/panel/format.ts`: `slugify` (Turkish: ç→c ğ→g ı/İ→i ö→o ş→s ü→u), `parseTryAmount("1.499,90")
   → 149990`, `formatTryAmount`, `isValidEan13`, `istanbulDateTimeLocal()` helpers for `<input
   type="datetime-local">` (panel times are Europe/Istanbul). Reuse `src/lib/validation/tr.ts` (IBAN,
   TCKN, VKN, phone) — do not duplicate.
5. **Cache tags**: add `campaigns: "campaigns"` and `redirects: "redirects"` to `TAGS`. Write the
   entity → tags map in the core doc (product save: `products`, `product:<old>`, `product:<new>`,
   `categories` when the category changed; media alt/delete: `media`, `products`, `pages`,
   `categories`, `blog`; and so on).
6. **Redirects**: `src/lib/panel/redirects.ts` `recordMove(tx, fromPath, toPath)` stores canonical Turkish
   folder paths (`/urunler/eski` → `/urunler/yeni`), collapses chains (x→a plus a→b gives x→b) and
   removes loops. `src/lib/data/redirects.ts` `redirectIfMoved(locale, folderPath)` (cached, tag
   `redirects`) calls `permanentRedirect(localizePath(locale, toPath))` when a row exists. Core wires it
   into the not-found branches of the product, category and `/sayfa/[slug]` pages.
7. **Media upload**: route handler `src/app/panel/api/media/route.ts` (POST multipart):
   - editor+ session; same-origin check (Origin header must match the host); at most 10 files of
     15 MB each;
   - type sniffed with sharp (JPEG, PNG, WebP, AVIF; no SVG, no GIF); `processImage` → storage adapter
     → `media` row (folder, alt);
   - audit; returns `MediaLike[]` JSON.

   Each upload gets a new unique file name (the optimized-image cache can't be invalidated). Check in
   the bundled Next docs whether files written to `public/` after the build are served by
   `next start`. If not, the local driver writes uploads outside `public/` and serves them through a
   route handler (key validation with `assertValidKey`, correct content type, immutable cache, no
   listing). `proxy.ts` must not locale-redirect that path. Existing seeded `/media/...` files keep
   working.

   Data helpers in `src/lib/panel/media/queries.ts`:
   - `listMedia({ q, folder, cursor })`;
   - `mediaUsage(mediaId)`: every reference in products, product_media, variants, option swatches,
     categories, section content, settings (logos, og image), blog covers and SEO og images.

   Deleting a media row that is in use is refused with `in_use` and the list of places.
8. **Panel UI kit** in `src/components/panel/form/` and `src/components/panel/ui/`, matching the
   existing panel look:
   - **Basic inputs:** `Field` (label, help, error, required mark), `TextInput`, `Textarea`,
     `NumberInput`, `MoneyInput` (Turkish format ↔ kuruş), `PercentInput`, `Switch`, `Select`.
   - **Localized inputs:** `LocalizedInput` and `LocalizedTextarea` (TR/EN/AR tabs with filled-state
     dots, Arabic input `dir="rtl"`, "TR'den kopyala").
   - **Rich text:** `RichTextEditor` and `LocalizedRichText`. No new dependency: contenteditable with
     a toolbar for bold, italic, link, H2/H3, lists, quote and HR, plus an HTML source toggle. The
     output is sanitized on save with `sanitizeHtml`.
   - **Specialized inputs:** `ColorInput` (picker + hex + AA badge against the background),
     `ScheduleInput`, `SlugInput` (auto from the TR name until edited by hand), `LinkInput` (internal
     link picker: static routes, products, categories, pages, legal pages, blog posts; or a custom
     URL validated like `hrefInput`).
   - **Pickers:** `MediaPicker` (dialog: grid, search, folder filter, upload tab, single or multiple
     selection), `ProductPicker`, `CategoryPicker`.
   - **Lists:** `SortableList` (drag handle with pointer events plus keyboard up/down buttons;
     accessible) and `Repeater` (add, remove, reorder items).
   - **Save bar:** `SaveBar`, sticky, with a dirty indicator, Kaydet/Vazgeç, Ctrl/⌘+S, a
     `beforeunload` guard and pending state.
   - **UI:** `Dialog`, `ConfirmDialog`, `Tabs`, `Badge`, and `Toaster` + `useToast` (aria-live).
   - **Hook:** `usePanelForm(initial)` returns state, dirty and reset, plus `submit(action)` that
     sends `payload` and maps `fieldErrors` back.
9. **Section field specs**: `src/components/sections/field-spec.ts` exports the `FieldSpec` union:
   - `text`, `localized`, `localizedLong`, `localizedRich`, `media`, `product`, `products`, `number`,
     `percent`, `select` (options), `switch`, `link`, `cta` (localized label + href, optional);
   - `localizedList` (array of localized strings, max);
   - `repeater` (itemLabel, min, max, nested `fields`).

   Add `fields: FieldSpec[]` with Turkish labels and help texts to every entry of `sectionMeta` in
   `schemas.ts`. Every key of every schema must be editable. Also add `description` (one line for
   the section picker). A unit test checks that every type's `defaults` parse with its schema and
   that every schema key has a field.
10. **Nav** (`nav-config.ts`, core edits it once):
    - add "Mesajlar" (`/panel/mesajlar`, Satış, staff);
    - add "Arayüz Metinleri" (`/panel/metinler`, İçerik ve Görünüm, editor);
    - add "Yasal Metinler" (`/panel/yasal`, İçerik ve Görünüm, admin);
    - add "Ekip" (`/panel/ekip`, Sistem, admin);
    - set `minRole` on every item per the role table.

    Builders flip `ready: true` on their own items with the Edit tool when their pages exist.
    Müşteriler, Kurumsal Hesaplar, Teklif/Numune Talepleri and Yorumlar stay "coming soon".
11. **Command palette** (Ctrl/⌘+K) in the panel shell: jump to any nav item the user may open, and
    search products (name, SKU, barcode), orders (number, e-mail) and pages through a server action
    `panelSearch(q)`. Mount `Toaster` there too.
12. **Test users** `scripts/panel-test-user.ts`:
    - `create <email> <role>` creates a throwaway local user and prints its generated password;
    - `delete <email>` removes the user, sessions and accounts;
    - `cookie <email> <password> <origin>` signs in and prints only the `name=value` session cookie,
      for `document.cookie`;
    - refuses production and non-local DBs.

    Builders use `<key>@test.local` emails and delete their users before finishing. Nobody ever reads,
    prints or types `ADMIN_PASSWORD`.
13. **Schema**: core makes every schema change of the day (one migration), if any is needed (e.g.
    indexes for panel search, `media.original_name`). Builders never change the schema or migrations;
    they report needs to the integrator.

## Builders (run in parallel after CORE) and what they own

Panel copy is Turkish and written directly in components. New storefront copy goes into the messages
files under the builder's own group (Edit tool only).

### PRODUCTS — `/panel/urunler`, `/panel/kategoriler`
Owns: `src/app/panel/(dashboard)/urunler/**`, `kategoriler/**`, `src/app/panel/_lib/products.ts`,
`src/lib/panel/products/**`, `src/lib/panel/categories/**`, `src/components/panel/products/**`,
`src/components/panel/categories/**`.

**List**
- Search by name, SKU and barcode; filters for status, category, type and low stock.
- Thumbnail, variant count, price range, total stock with a low-stock badge, status.
- Drag to reorder (position).
- Bulk status change.
- Inline quick stock edit per variant (staff+, guarded by the stock the user saw).

**New** (`/panel/urunler/yeni`): TR name, type and category. Creates a draft with a slug and one default
variant, then opens the editor.

**Editor** (sections or tabs). One save action with the whole product, locked by `updatedAt`.
- **Genel:** names, subtitle, short description, rich description, category, type, status, featured,
  businessOnly.
- **Görünüm:** accent color, with a live palette and contrast preview via `src/lib/theme/engine.ts`,
  and the themeOverrides tint.
- **İçerik:** scent notes, usage, warnings, ingredients (INCI, not translated), claims, specs.
- **Görseller:** add from MediaPicker, reorder, role, link to a variant, quick alt text.
- **Seçenekler & Varyantlar:** option axes and values; a variants table covering every column. Also:
  - generate missing combinations;
  - SKU unique (case-insensitive);
  - EAN-13 check digit when a barcode is given;
  - price > 0; compare-at > price (warn otherwise);
  - weight needed for shipping (warn);
  - exactly one default;
  - deactivate rather than delete variants that orders or carts reference.
- **Fiyatlandırma:** tier prices (product or variant, optional group) and group prices.
- **Set içeriği** for bundles.
- **İlişkili ürünler.**
- **SEO:** title and description per locale, og image, noIndex, a Google-style preview. Changing the
  slug calls `recordMove`.

**Other actions**
- **Duplicate:** draft, "-kopya" slug, SKUs suffixed so they stay unique.
- **Archive.**
- **Delete:** only drafts that no order references. Otherwise suggest archive.

**Categories**
- List with drag reorder.
- Create and edit: localized name and description, slug (with `recordMove`), image, accent color,
  visibility, SEO.
- Delete only when no product uses the category; otherwise offer to move the products first.

**Tags and tests**
- Tags: `products`, `product:<slug>` (old and new), `categories`.
- DB tests: conflict on stale `updatedAt`; SKU uniqueness; default-variant invariant; slug change
  creates a redirect; stock guard.

### CONTENT — `/panel/sayfalar`, `/panel/menuler`, `/panel/duyurular`
Owns: those route folders, `src/lib/panel/content/**`, `src/components/panel/sections/**`,
`src/components/panel/menus/**`, `src/components/panel/announcements/**`.

**Pages list**
- Title, slug, kind, published, section count, updated.
- Create custom pages.
- Delete custom pages only (never home, legal or the reserved slugs `kurumsal`, `numune`, `iletisim`).

**Page editor**
- Meta: localized title, slug (not for home or reserved pages, with `recordMove`), published, SEO.
- Sections:
  - drag reorder;
  - add from a picker (Turkish label and description; insert at a position);
  - duplicate, delete (confirm), hide/show;
  - schedule (start/end), audience (all/retail/business);
  - edit with a generic `SectionFieldsEditor` that renders `fields` specs.
- Saving validates each section with its zod schema on the server, saves the page and all its
  sections in one action locked by the page's `updatedAt`, and invalidates `pages` and `page:<slug>`.
- "Sitede gör" link (home → `/`, custom → `/sayfa/<slug>`, reserved → their route).

**Menus**
- The four menus (header, footer_shop, footer_corporate, footer_legal).
- Each item: localized label, `LinkInput`, highlight, one level of children (header only).
- Reorder. Tag `menus`.

**Announcements**
- List with reorder.
- Create and edit: localized text, link, variant, active, schedule; a live preview of the bar.
- Tag `announcements`.

Tests: payloads for every section type validate; unknown types and unsafe hrefs are rejected.

### THEME-TEXTS — `/panel/tema`, `/panel/metinler`
Owns: those route folders, `src/lib/theme/**`, `src/lib/panel/theme/**`, `src/lib/panel/ui-strings/**`,
`src/components/panel/theme/**`, `src/components/panel/ui-strings/**`, and `src/i18n/get-messages.ts`
when needed.

**Themes**
- Cards with swatches, a default badge and status ("Şu an aktif", "Planlandı", "Bitti").
- Create (copy of the default).
- Editor:
  - colors (brand, accent, background, surface, text) plus dark overrides, radius, and fonts (only
    fonts already loaded in `src/lib/fonts.ts`);
  - a live preview of storefront UI (header bar, buttons, product card with price and badge, an
    announcement) in light and dark, side by side, using `themeVars()`;
  - a contrast report (AA pass/fail per pair);
  - schedule (scheduled flag, start/end in Istanbul time, priority).
- Set default (exactly one, in a transaction).
- Delete: not the default; clear `campaigns.themeId` references first.
- Tag `theme`.

**Campaign-linked themes**
- `getActiveTheme` also considers themes linked to an active campaign (in window, `isActive`). The
  candidates are scheduled themes in window plus campaign-linked themes. Highest theme priority wins;
  ties go to the latest start.
- Use a short `cacheLife` when a change is upcoming. Tags `theme` and `campaigns`.
- Extract the choice into a pure function with unit tests.

**UI texts**
- Every message key from `src/i18n/messages/tr.ts`, grouped with Turkish group names, searchable by key
  or text.
- Each key shows the default TR/EN/AR and override inputs, plus "Varsayılana dön".
- An override must keep exactly the default's `{placeholders}` and plural syntax (validate on the
  server).
- Tag `ui-strings`.

### SETTINGS-LEGAL — `/panel/ayarlar/*`, `/panel/yasal`
Owns: those route folders, `src/lib/panel/settings/**`, `src/lib/panel/legal/**`,
`src/components/panel/settings/**`, `src/components/panel/legal/**`, and `src/lib/settings/types.ts`
(additive changes only).

**Settings**

One page per key with its own save (locked by `settings.updatedAt`, validated with `settingsSchemas`
plus stricter panel rules, tag `settings`):

| Page | Contents |
|---|---|
| genel | logo pickers, MERSİS, tax office and number, KEP, e-mail, phone, address, map, social |
| kargo | flat fee, threshold, heavy surcharge, carriers repeater (tracking URL must contain `{code}`), estimated days |
| odeme | card settings (note that real providers arrive on day 4); bank accounts repeater with TR IBAN validation and grouped display; havale discount and instructions; kapıda ödeme fee and limit |
| seo | title template must contain `%s` |
| diller | only if the storefront honours `locales.enabled`; otherwise leave it out and report |
| kurumsal | B2B settings |
| numune | sample settings |
| bulten | newsletter settings |
| whatsapp | WhatsApp settings |

Add inline hints that explain the effect, e.g. "Banka hesabı eklenince havale ödeme sayfasında
görünür."

**Legal documents**
- List of keys with the current version and date.
- Editor: localized title and rich body. Keep any placeholders the renderer uses, and show the list
  of available placeholders (read `src/lib/orders/legal-render.ts`).
- "Yeni sürüm olarak yayınla": new version label; old `isCurrent=false`, new `true`, in one
  transaction.
- Version history with view and "restore" (publishes a copy as a new version).
- A banner says the texts are drafts until a lawyer approves them.
- Tags `legal` and `pages`. Orders keep their stored snapshots.

Tests: IBAN, carrier `{code}`, title template, exactly one current version per key.

### MARKETING — `/panel/kampanyalar`, `/panel/kuponlar`, `/panel/e-bulten` + storefront campaign display
Owns: those route folders, `src/lib/panel/marketing/**`, `src/components/panel/marketing/**`,
`src/lib/campaigns/**`, campaign-related edits in `src/lib/cart/compute.ts`,
`src/lib/pricing/resolve.ts`, `src/lib/data/catalog.ts`, `src/components/store/PriceTag.tsx`,
`ProductCard.tsx` and the price area components of the product page, and the newsletter export
route handler.

**Campaigns**
- List with status chips.
- Editor: name, localized badge label, percent 1–90, products/categories (match the cart engine's
  semantics exactly), customer groups, schedule, priority, active, optional theme.
- Preview of affected variants with old → new price.
- Tag `campaigns`.

**Storefront campaign display**
- Cards and the product page show the campaign badge and the campaign price with the regular price
  struck through.
- Only campaigns without customer groups are shown (static pages are not personalised); group
  campaigns apply in the cart only.
- Extract the campaign choice and rounding into `src/lib/campaigns/pick.ts`, used by both the cart
  engine and the display, with a parity unit test: display price == cart unit price.
- `getActiveCampaigns()` is `"use cache"` with tag `campaigns`, `cacheLife("minutes")` when a start
  or end is upcoming, `"max"` otherwise.
- Product, listing, category and home pages must stay static.

**Coupons**
- List (code, type, value, used/max, window, status).
- Editor covers every column. Codes are upper-cased and unique case-insensitively; there is a random
  code generator.
- Delete only unused coupons; otherwise deactivate.

**Newsletter**
- Subscribers table with search and filters; unsubscribe; delete (KVKK erasure, confirm).
- CSV export: admin only, a route handler with auth, a UTF-8 BOM for Excel, and an audit entry.

### BLOG-MEDIA — `/panel/medya`, `/panel/blog`, storefront `/blog`
Owns: those panel route folders, `src/lib/panel/blog/**`, `src/components/panel/media/**`,
`src/components/panel/blog/**`, `src/app/[locale]/blog/**`, `src/lib/data/blog.ts`, storefront blog
components, the `blog` messages group, and the blog lines in `src/app/sitemap.ts` /
`src/lib/data/sitemap.ts`.

**Media library**
- Grid with paging, drag-and-drop multi-upload with progress, folders (filter and move), and search.
- Detail drawer: preview, size, URL copy, alt text TR/EN/AR, and a usage list with links.
- Delete is blocked while the item is in use.
- Tags: `media`, `products`, `pages`, `categories`, `blog`.

**Blog panel**
- List.
- Editor: title, slug (`recordMove`), excerpt, localized rich body, cover, author, tags, related
  products, draft/published, publish date (a future date means scheduled), SEO. Reading minutes are
  computed from the TR body.
- Tags `blog` and `post:<slug>`.

**Storefront blog**
- `/[locale]/blog`: listing with an elegant empty state ("Yakında").
- `/[locale]/blog/[slug]`: sanitized article, cover, related product cards, JSON-LD Article,
  hreflang, sitemap entries.
- Both pages are static: `generateStaticParams` must return at least one param, so use a placeholder
  slug that calls `notFound()` when there are no posts.
- Scheduled posts appear on time (short `cacheLife` when one is upcoming).
- Do not invent brand content; no seeded posts.

### SITE-PAGES — storefront `/kurumsal`, `/numune`, `/iletisim`, contact form, `/panel/mesajlar`
Owns: `src/app/[locale]/kurumsal/**`, `numune/**`, `iletisim/**`, new section types `contact_info`
and `contact_form` (entries in `schemas.ts` with `fields`, registry entries, components),
`src/app/panel/(dashboard)/mesajlar/**`, `src/lib/panel/messages/**`, the `contact` messages group,
`scripts/seed.ts` / `scripts/seed-data/*` additions, `src/lib/notifications/index.ts` (new event
type), the reserved-slug handling in `src/app/[locale]/sayfa/[slug]/page.tsx`, and the new routes'
lines in the sitemap files.

**The three pages**
- Each renders the CMS page with that slug (`kurumsal`, `numune`, `iletisim`) through
  `SectionRenderer`. Static, with SEO from the page.
- `/sayfa/<reserved>` permanently redirects to the dedicated route.

**Seed** (idempotent, added to the seed data; never run the seed yourself — the final checker does)
- Tasteful default sections built from existing section types and real company facts only:
  - **kurumsal:** benefits for hotels, spas, offices and restaurants, the 5 L and 20 L sizes, a CTA to
    `/iletisim?konu=teklif`, and a FAQ;
  - **numune:** how samples work, a FAQ, and a CTA to `/iletisim?konu=numune`;
  - **iletisim:** `contact_info` and `contact_form`.

**New section types**
- `contact_info` reads phone, e-mail, address, map and WhatsApp from settings at render time.
- `contact_form` has a title, an intro and localized subjects with keys
  `general | quote | sample | other`. `?konu=` preselects the subject on the client (inside Suspense),
  so the page stays static.

**Contact form**
- Server action with the locale passed explicitly; zod; a honeypot field.
- Rate limits: 5 per hour per IP and 20 per day per e-mail (`src/lib/rate-limit.ts`).
- Stored in `contact_messages`; notification stub event `contact_message`.
- KVKK notice link; no PII in logs.

**Inbox** (`/panel/mesajlar`, staff+)
- List with unread markers, subject filter and search.
- Detail with mark read/unread, a reply link (mailto), and delete (confirm).
- An unread badge in the nav.

### TEAM — `/panel/ekip`, `/panel/islem-kaydi`, dashboard, storefront polish
Owns: those route folders, `src/app/panel/(dashboard)/page.tsx`, `src/app/panel/_lib/dashboard.ts`,
`src/lib/panel/team/**`, `src/components/panel/team/**`, `src/components/panel/audit/**`,
`src/components/panel/dashboard/**`, `src/components/store/AddToCartButton.tsx`,
`src/components/cart/**` (polish only).

**Team** (admin)
- Staff list.
- Create a user (name, e-mail, role). A strong random password is shown once in a copy box.
- Change role.
- Deactivate (ban + revoke sessions) and reactivate.
- Reset password (shown once; revokes sessions).
- Admins cannot demote or ban themselves, and at least one admin must remain.
- Audited, without secrets.

**Audit log** (admin)
- Filters: entity, user, date.
- Before/after diff with the changed fields highlighted.
- Paging and entity links.

**Dashboard**
- Revenue (paid, processing, shipped, delivered) for today, 7 and 30 days; order count; average order
  value.
- Things to do: awaiting transfer, to ship, pending payment.
- Low-stock variants, recent orders, unread messages, quick links.

**Polish**
1. The "Sepete eklendi" label is cut off on the product page button. Fix it at every width and in
   tr/en/ar.
2. In the cart drawer, when the "added" notice disappears, the content below jumps (the sample list
   moves under the user's pointer). Remove the layout shift.

## Storefront rules (everyone)
- Product, category, listing, home, legal and blog pages stay static (○ in `next build`). Panel saves
  invalidate tags with `updateTag` (Server Actions) or `revalidateTag(tag, "max")` (route handlers).
- Everything the storefront renders from panel input is sanitized (rich text with `sanitizeHtml`,
  links with the href rules) — on save and again on render.
- Build links with `href` / `localizePath`; money only through `formatPrice`.

## Shared rules for all builders
- Every action and route handler checks the session and role itself. Validate all input with zod.
  Never trust ids from the client: re-read and check ownership or relations on the server.
- Concurrency: every edit is guarded by the `updatedAt` it loaded (stock by the value it saw).
- Every mutation writes an audit entry and invalidates the right tags.
- Destructive actions use `ConfirmDialog`; references are checked first (`in_use`).
- Panel UX bar: inline errors next to fields plus a toast, a sticky save bar, keyboard usable, labels
  for screen readers, works at 375 px, skeletons while loading, empty states with a next step. Times
  are shown in Europe/Istanbul.
- Messages: storefront strings only, in your own group, same shape in tr/en/ar, Edit tool only.
- Shared files are edited only with the Edit tool after re-reading them: `schemas.ts`, `nav-config.ts`,
  the messages files, the sitemap files. Do not touch files another builder owns; report what you
  need instead.
- Never run `npm run db:seed` or migrations (core does migrations; the final checker reseeds).
  Restore every row you change while testing; delete every row and user you create. Run only your own
  DB test files while others are working (`npx tsx --test --conditions=react-server
  --env-file=.env.local tests/db/<yours>.test.ts`); the integrator runs the full suite.
- No new npm dependencies unless truly necessary (say why). No git. No connected accounts. No
  generated images.
