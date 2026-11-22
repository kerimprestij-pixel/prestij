# Day 3 core API (panel kit)

What CORE (CORE-SERVER + CORE-UI, reconciled and verified by CORE-CHECK) ships for the eight day-3
builders. Read `docs/DAY3-PANEL.md` (the contract) first; this file documents the code that implements
its CORE section. **pure** = no DB, no Next request APIs: safe in client components and unit tests.

Everything below was exercised end to end on 2026-11-09 (see §17). If a signature here disagrees with
the code, the code wins: tell the integrator.

## 0. File map

| File | What |
|---|---|
| `src/lib/panel/action.ts` | `panelAction`, `getPanelActor`, `requirePanelActor` (server) |
| `src/lib/panel/action-core.ts` | session-free `executePanelAction` for DB tests, error mapping |
| `src/lib/panel/action-types.ts` (pure) | `ActionResult`, `PAYLOAD_FIELD`, `toPayloadFormData` |
| `src/lib/panel/errors.ts` (pure) | `PanelError`, `fieldError`, codes and default messages |
| `src/lib/panel/roles.ts` (pure) | `hasRole`, `STAFF_ROLE_ORDER`, `STAFF_ROLE_LABELS`, `isStaffRole` |
| `src/lib/panel/concurrency.ts` (pure) | `assertFresh`, `assertUnchanged`, `sameInstant`, `CONFLICT_MESSAGE` |
| `src/lib/panel/audit.ts` | `writeAudit`, `auditChanges`, `scrubAudit`, `AuditEntry` |
| `src/lib/panel/tx.ts` (types) | `Tx` = `db` or a transaction |
| `src/lib/panel/schemas.ts` (pure, zod) | zod building blocks for action schemas |
| `src/lib/panel/format.ts` (pure) | slugs, TRY ↔ kuruş, EAN-13, Istanbul times, search folding |
| `src/lib/safe-href.ts` (pure, no zod) | `isSafeHref`, `HREF_MESSAGE`: the one link rule (save **and** render) |
| `src/lib/panel/redirects.ts` | `recordMove`, `dropRedirectsTo`, `canonicalPath`, `normalizeRedirectPath` |
| `src/lib/data/redirects.ts` | storefront `findRedirect` (cached), `redirectIfMoved` |
| `src/lib/panel/media/*` | types, upload validation, queries, service, Server Actions |
| `src/app/panel/api/media/route.ts` | `POST /panel/api/media` (multipart upload) |
| `src/app/uploads/[...key]/route.ts` | `GET /uploads/<key>` (local-driver uploads) |
| `src/lib/media/storage.ts` | storage adapters (+ `getUploadStorage`, `storageForMediaUrl`, `localUploadRoot`) |
| `src/lib/panel/pickers.ts` (`"use server"`) | `pickerProducts`, `pickerCategories`, `linkTargets` |
| `src/lib/panel/search.ts` (`"use server"`) | `panelSearch` (command palette) |
| `src/components/panel/ui/*` | `Button`, `Badge`, `Dialog`, `ConfirmDialog`, `Tabs`, toasts, `SortableList`, command palette, class recipes |
| `src/components/panel/form/*` | `Field`, inputs, localized inputs, rich text, pickers, `Repeater`, `SaveBar`, `usePanelForm` |
| `src/components/sections/field-spec.ts` (pure) | `FieldSpec` union + helpers |
| `src/components/sections/schemas.ts` | section zod schemas + `sectionMeta` (now with `description`, `fields`) |
| `src/components/panel/nav-config.ts` (pure) | `PANEL_NAV`, `minRole`, `canSeeNavItem`, `navForRole`, `findNavItem` |
| `scripts/panel-test-user.ts` | throwaway panel users for testing |
| `drizzle/0002_day3_panel.sql` | the day's only migration (applied) |
| `src/lib/auth-limits.ts` (pure) | per-e-mail sign-in lock, closed `/api/auth/admin/*` paths, Better Auth IP headers (FIXER) |
| `cache-handler.cjs` | self-hosted route-cache handler: consistent tag stamps, 404s kept in memory only (FIXER) |
| `src/lib/panel/discount-scope.ts` | `detachFromDiscounts`, `scopeWithout`: campaign/coupon scopes on category/product delete (FIXER) |
| `src/components/panel/form/dirty-registry.ts` | unsaved drafts across hidden routes, palette and sign-out guards (FIXER) |
| `src/components/panel/ui/use-reorder-saver.ts` | `useReorderSaver`: one save per drag / settled keyboard moves (FIXER) |
| `src/lib/seo/localized.ts` (pure), `src/lib/seo/not-found-metadata.ts` | locale-first SEO texts; localized 404 metadata (FIXER) |
| `src/components/sections/localize-links.ts` (pure) | `localizeBodyLinks`, `localizedRichTextHtml` for every rich-text renderer (FIXER) |
| `src/i18n/locales.ts` (pure) | `LOCALES`, `Locale`, `LocalizedText` without drizzle (client code imports from here) (FIXER) |

Imports: UI from `@/components/panel/ui` (client-safe barrel; `PanelCommandPalette` is server-only and
not in it), form kit from `@/components/panel/form`.

## 1. Schema changes (migration `0002_day3_panel.sql`, applied — builders never change the schema)

- `media.original_name text` (null for seeded images).
- `contact_messages.locale text not null default 'tr'`; indexes `(is_read, created_at)` and `(created_at)`.
- `product_variants_sku_upper_unique` on `upper(sku)`: SKUs are unique **ignoring case**.
- `legal_documents_one_current` unique partial on `(key) where is_current`: when publishing, set the old
  row `is_current = false` **first**, then insert the new current row (same transaction).
- `themes_single_default` unique partial on `(is_default) where is_default`: unset the old default first.
- Indexes `redirects(to_path)`, `audit_log(user_id, created_at)`.
- A unique violation comes back from `panelAction` as `code: "invalid"` with a generic message: catch
  the expected ones yourself first (e.g. check the SKU and throw `fieldError("variants.2.sku", …)`).

## 2. Roles and session

| Area | Min role |
|---|---|
| Orders, messages inbox, product list, quick stock edit | `staff` |
| Products (create/edit/delete), categories, pages/sections, menus, announcements, blog, media, theme, UI texts, campaigns, coupons, newsletter list | `editor` |
| Newsletter CSV export, settings (all tabs), legal documents, team, audit log | `admin` |

Nav items (in `nav-config.ts`): Genel Bakış, Siparişler, Mesajlar, Müşteriler, Kurumsal Hesaplar, Teklif
Talepleri, Numune Talepleri, Ürünler → staff; Kategoriler, Yorumlar, Kampanyalar, Kuponlar, E-bülten,
Sayfalar & Bölümler, Tema & Renkler, Menüler, Duyurular, Arayüz Metinleri, Blog, Medya → editor; Yasal
Metinler, Ayarlar, Ekip, İşlem Kaydı → admin. The sidebar and the command palette hide items above the
viewer's role (cosmetic; the server check is what counts). Flip `ready: true` on your own items with the
Edit tool once the pages exist (until then `/panel/<x>/**` is served by the "Hazırlanıyor" placeholder;
afterwards unbuilt sub-paths 404).

```ts
// src/lib/session.ts (day 1)
requireStaff(minRole?: StaffRole = "staff"): Promise<StaffSession>
// no session/not staff → redirect /panel/giris; role too low → redirect /panel?yetki=yetersiz. Use it in PAGES (inside Suspense).
const { user, staffRole } = await requireStaff("editor");

// src/lib/panel/action.ts
getPanelActor(): Promise<StaffSession | null>              // no redirects: for route handlers
const actor = await getPanelActor(); if (!actor) return Response.json({ error: "…" }, { status: 401 });
requirePanelActor(minRole?: StaffRole = "staff"): Promise<StaffSession>
// for "use server" READ functions that are not panelAction: no session → redirect login; role too low → throws PanelError("forbidden")
export async function loadThing(id: number) { await requirePanelActor("editor"); /* … */ }

// src/lib/panel/roles.ts (pure)
hasRole(role: StaffRole | null | undefined, minRole: StaffRole): boolean   // hasRole("editor", "staff") === true
STAFF_ROLE_ORDER: readonly StaffRole[]            // ["staff", "editor", "admin"]
STAFF_ROLE_LABELS: Record<StaffRole, string>      // { staff: "Personel", editor: "Editör", admin: "Yönetici" }
isStaffRole(value: unknown): value is StaffRole
```

## 3. The action pattern

### 3.1 API

```ts
// src/lib/panel/action-types.ts (pure)
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code: PanelErrorCode; fieldErrors?: Record<string, string>; sessionExpired?: true };
export const PAYLOAD_FIELD = "payload";
export function toPayloadFormData(value: unknown): FormData;      // form.set("payload", JSON.stringify(value))
export const SESSION_EXPIRED_MESSAGE: string;                     // text of the sessionExpired result (code "forbidden")
export function panelLoginHref(path: string): string;             // "/panel/giris?next=<path>"

// src/lib/panel/action.ts
export function panelAction<S extends z.ZodType, T = undefined>(opts: {
  minRole: StaffRole;
  schema: S;
  run: (input: z.output<S>, ctx: { actor: StaffSession; tx: Tx }) => Promise<PanelRunResult<T>>;
}): (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

export type PanelRunResult<T> = {
  data?: T;                                   // returned to the client (keep it narrow and serializable)
  message?: string;                           // Turkish success toast
  tags?: string[];                            // updateTag() once per distinct tag after commit
  audit?: AuditEntry | AuditEntry[];          // written in the same transaction; actorId defaults to the session user
  afterCommit?: () => void | Promise<void>;   // DEVIATION from the contract: runs after a successful commit (e.g. delete files); errors are logged, not returned
};
```

What one call does, in order:
1. Session: none → `{ ok: false, code: "forbidden", sessionExpired: true, error: SESSION_EXPIRED_MESSAGE }`
   (FIXER: no redirect any more, so the editor keeps the draft; usePanelForm shows a toast that opens
   `panelLoginHref(current path)` in a new tab); banned/not staff → `redirect("/panel/giris?hata=yetki")`;
   role below `minRole` → `{ ok: false, code: "forbidden" }`.
2. Reads the single form field `payload` (JSON, ≤ 1 000 000 chars; unreadable → `invalid`).
3. `schema.safeParseAsync` → zod issues become `fieldErrors` with dotted paths (`variants.2.price`,
   `title.en`) and the first message per path; an issue without a path becomes `error`.
4. `db.transaction`: `run(input, { actor, tx })`, then the audit rows. Anything thrown rolls back
   rows **and** audit. An `update` entry whose `before` and `after` are both `{}` (nothing changed) is
   not written (`isNoopAudit`, FIXER).
5. After commit: `afterCommit()`, then `updateTag(tag)` for each distinct tag (read-your-own-writes: the
   action response already carries the re-rendered page), or `refresh()` when no tags were returned.

Error mapping: a thrown `PanelError` is returned as is (code, message, fieldErrors). SQLSTATE 23505 →
`invalid` ("Bu değer başka bir kayıtta zaten kullanılıyor…"), 23503 → `in_use`, 40001/40P01/55P03 →
`conflict`, 22001/22003 → `invalid`; anything else → `server` with a generic Turkish message, logged with
`safeErrorInfo` only. `redirect()`/`notFound()` thrown inside `run` propagate to Next.

Rules: business logic goes in `src/lib/panel/<area>/service.ts` taking `(tx, input, actor)` and never
touching Next APIs; the action file only wires schema + service + tags + audit. Re-read every row by id
inside the transaction (`.for("update")`), never trust ids or relations from the client. Never
`Promise.all` several actions from the client: do the parallel work inside one action.

```ts
// src/lib/panel/action-core.ts — session-free half, for DB tests
executePanelAction(opts: { schema; run }, actor: StaffSession, input: FormData | unknown, { label }?): Promise<{ result: ActionResult<T>; tags: string[] }>
const { result, tags } = await executePanelAction({ schema, run }, FAKE_ACTOR, { id: 1, name: { tr: "X" } });
// also: zodFieldErrors(issues), readPayload(formDataOrValue), errorToResult(error, label?), isNextControlFlowError(error)
```

### 3.2 Full minimal editor (copy this shape)

`src/lib/panel/things/service.ts` (DB-testable, no Next imports):
```ts
import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { assertFresh } from "@/lib/panel/concurrency";
import { auditChanges, type AuditEntry } from "@/lib/panel/audit";
import { fieldError, PanelError } from "@/lib/panel/errors";
import { ensureMediaExist } from "@/lib/panel/media/queries";
import type { Tx } from "@/lib/panel/tx";
import type { LocalizedText } from "@/db/schema/common";

export type ThingInput = { id: number; name: LocalizedText; price: number; imageId: number | null; updatedAt: Date };

export async function saveThing(tx: Tx, input: ThingInput): Promise<{ updatedAt: Date; audit: AuditEntry }> {
  const t = schema.things;                                              // (illustrative table)
  const [row] = await tx.select().from(t).where(eq(t.id, input.id)).for("update");
  if (!row) throw new PanelError("not_found");
  assertFresh(row.updatedAt, input.updatedAt);                          // → code "conflict"
  if (input.price > 1_000_000_00) throw fieldError("price", "Fiyat çok yüksek görünüyor.");
  await ensureMediaExist(tx, [input.imageId], "imageId");
  const next = { name: input.name, price: input.price, imageId: input.imageId };
  const [saved] = await tx.update(t).set({ ...next, updatedAt: new Date() }).where(eq(t.id, input.id)).returning({ updatedAt: t.updatedAt });
  return { updatedAt: saved.updatedAt, audit: { action: "update", entity: "thing", entityId: input.id, ...auditChanges(row, { ...row, ...next }) } };
}
```

`src/app/panel/(dashboard)/things/actions.ts`:
```ts
"use server";
import { z } from "zod";
import { TAGS } from "@/lib/cache-tags";
import { panelAction } from "@/lib/panel/action";
import { idInput, localizedTextOf, mediaIdInput, positiveKurusInput, updatedAtInput } from "@/lib/panel/schemas";
import { saveThing } from "@/lib/panel/things/service";

export const saveThingAction = panelAction({
  minRole: "editor",
  schema: z.object({ id: idInput, name: localizedTextOf({ max: 120 }), price: positiveKurusInput, imageId: mediaIdInput, updatedAt: updatedAtInput }),
  run: async (input, { tx }) => {
    const { updatedAt, audit } = await saveThing(tx, input);
    return { data: { updatedAt: updatedAt.toISOString() }, message: "Kaydedildi.", tags: [TAGS.products], audit };
  },
});
```

`src/app/panel/(dashboard)/things/[id]/page.tsx` (the shell stays static; the session read sits in Suspense):
```tsx
import { Suspense } from "react";
import { requireStaff } from "@/lib/session";
import { DetailSkeleton } from "@/components/panel/Skeleton";
import ThingEditor, { type ThingState } from "@/components/panel/things/ThingEditor";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<DetailSkeleton />}><Editor params={params} /></Suspense>;
}
async function Editor({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff("editor");
  const { id } = await params;
  const row = await loadThing(Number(id));                     // your query; notFound() when missing
  const initial: ThingState = { id: row.id, name: row.name, price: row.price, imageId: row.imageId, updatedAt: row.updatedAt.toISOString() };
  return <ThingEditor initial={initial} />;                    // Dates → ISO strings for the client state
}
```

`src/components/panel/things/ThingEditor.tsx`:
```tsx
"use client";
import { Field, LocalizedInput, MediaPicker, MoneyInput, SaveBar, usePanelForm } from "@/components/panel/form";
import { saveThingAction } from "@/app/panel/(dashboard)/things/actions";
import type { LocalizedText } from "@/db/schema/common";

export type ThingState = { id: number; name: LocalizedText; price: number | null; imageId: number | null; updatedAt: string };

export default function ThingEditor({ initial }: { initial: ThingState }) {
  const form = usePanelForm(initial);
  const { state, setField, errorFor, formRef } = form;     // destructure formRef (see §16)
  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-6 pb-24">
      <LocalizedInput label="Ad" required value={state.name} onChange={(v) => setField("name", v)} error={form.localizedError("name")} name="name" />
      <Field label="Fiyat" required error={errorFor("price")} name="price">
        <MoneyInput value={state.price} onChange={(v) => setField("price", v)} />
      </Field>
      <Field label="Görsel" error={errorFor("imageId")} name="imageId">
        <MediaPicker value={state.imageId} onChange={(id) => setField("imageId", id)} folder="urunler" />
      </Field>
      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={() => form.reset()}
        onSave={() => form.submit(saveThingAction, { resetTo: (sent, data) => ({ ...sent, updatedAt: data?.updatedAt ?? sent.updatedAt }) })}
      />
    </form>
  );
}
```
After a successful save the action's `updateTag` re-renders the page with fresh `initial`; `usePanelForm`
adopts it (also when it arrives while the save is still pending). Return the new `updatedAt` in `data`
(and use `resetTo`) when the editor stays open, otherwise the next save is a false conflict if the page
data did not re-render.

## 4. Errors, optimistic locking, audit

```ts
// errors.ts (pure)
type PanelErrorCode = "invalid" | "forbidden" | "not_found" | "conflict" | "in_use" | "server";
class PanelError extends Error { constructor(code: PanelErrorCode, message?: string, fieldErrors?: Record<string, string>) }
throw new PanelError("in_use", "Bu kategoride 3 ürün var. Önce ürünleri taşıyın.");
fieldError(path: string, message: string): PanelError        // code "invalid", fieldErrors { [path]: message }
throw fieldError("slug", "Bu kısa ad başka bir sayfada kullanılıyor.");
PANEL_ERROR_MESSAGES: Record<PanelErrorCode, string>; PANEL_ERROR_CODES; isPanelError(e): e is PanelError

// concurrency.ts (pure)
assertFresh(rowUpdatedAt: Date | string | number | null | undefined, expectedUpdatedAt: same): void   // mismatch or missing → PanelError("conflict", CONFLICT_MESSAGE)
assertFresh(row.updatedAt, input.updatedAt);
assertUnchanged<T>(current: T, expected: T, message?: string): void      // stock quick edit: assertUnchanged(row.stock, input.seenStock)
sameInstant(a, b): boolean;  CONFLICT_MESSAGE = "Bu kayıt siz düzenlerken başka biri tarafından değiştirildi. Sayfayı yenileyin."

// audit.ts
type AuditEntry = { action: string; entity: string; entityId?: string | number | null; before?: unknown; after?: unknown; actorId?: string | null };
writeAudit(tx: Tx, entry: AuditEntry & { actorId: string | null }): Promise<void>   // only outside panelAction (route handlers); panelAction writes `audit` for you
await writeAudit(tx, { actorId: actor.user.id, action: "export", entity: "newsletter", after: { rows: 120 } });
auditChanges(before, after, { ignore?: string[] = ["updatedAt", "createdAt"] }): { before; after }   // only changed top-level keys; key order never counts (jsonb returns ar,en,tr)
isNoopAudit(entry): boolean   // "update" with before = after = {}: skipped by executePanelAction
audit: { action: "update", entity: "category", entityId: id, ...auditChanges(oldRow, newRow) }
scrubAudit(value: unknown): unknown   // drops password/secret/token/hash/apiKey/cookie/session/credential/card keys at any depth, strings > 4000 chars cut, ≤ 200 array items
```
Audit `action` vocabulary: `create | update | delete | publish | archive | duplicate | upload | move |
reorder | status | export | restore`; `entity` is the table-ish name (`product`, `category`, `page`,
`menu`, `announcement`, `theme`, `ui_string`, `settings`, `legal_document`, `campaign`, `coupon`,
`newsletter_subscriber`, `media`, `blog_post`, `contact_message`, `user`). Never put secrets in before/after.

## 5. Validation building blocks (`src/lib/panel/schemas.ts`, pure)

Messages are Turkish. Optional variants accept a **missing key** (zod 4), `""` and `null`.

```ts
textInput(opts?: { max?: number = 500; requiredMessage?: string }): ZodType<string>            // trimmed, no control chars, required
textInput({ required: false, max?: number }): ZodType<string | null>                            // "" / null / missing → null
note: textInput({ required: false, max: 1000 })

localizedTextOf({ max = 2000, requiredMessage }?)   // { tr (required), en?, ar? } trimmed; empty en/ar are dropped
localizedTextInput                                  // = localizedTextOf()
optionalLocalizedTextOf({ max }?) / optionalLocalizedTextInput   // all empty → null; en/ar without tr → error at "<field>.tr"
name: localizedTextOf({ max: 120 }), alt: optionalLocalizedTextOf({ max: 250 })

slugInput                                           // trimmed, lower-cased, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, ≤ 80
hrefInput / optionalHrefInput                       // isSafeHref (below); optional: "" / null → null
isSafeHref(raw: unknown): boolean; HREF_MESSAGE     // re-exported from src/lib/safe-href.ts

kurusInput                                          // integer kuruş ≥ 0 ≤ MAX_KURUS (2e9); also "1.499,90" → 149990
positiveKurusInput                                  // > 0 (prices)
percentInput / percentInputRange(min = 0, max = 100)   // whole percent; campaigns: percentInputRange(1, 90)
idInput                                             // positive int (numeric strings coerced)

hexColorInput / optionalHexColorInput               // "#abc" → "#AABBCC"
dateTimeInput                                       // Date | ISO with zone | "YYYY-MM-DDTHH:mm" (read as Istanbul) | ""/null → Date | null
scheduleInput                                       // { startsAt, endsAt } → Dates; end ≤ start → error at "endsAt"
updatedAtInput                                      // required ISO-with-zone string (or Date) → Date; missing → "Kayıt sürümü eksik…"

mediaIdInput                                        // id | numeric string | ""/null → number | null (existence: ensureMediaExist in the service)
mediaIdsInput(max = 100)                            // de-duplicated, order kept
folderInput; FOLDER_PATTERN                         // a–z0–9-_ segments, up to 3 levels ("urunler/lavanta_latte")
```
TR validators live in `src/lib/validation/tr.ts` (`isValidIban`, `formatIban`, `isValidTckn`,
`isValidVkn`, `normalizeTrPhone`): use `z.string().refine(isValidIban, "Geçerli bir TR IBAN girin.")`.

## 6. Formatting helpers (`src/lib/panel/format.ts`, pure)

```ts
slugify(text: string | null | undefined, maxLength = 80): string     // slugify("Lavanta Latte Şişe & Jel") === "lavanta-latte-sise-ve-jel"
parseTryAmount(input: string | number | null | undefined): number | null   // "1.499,90" → 149990, "149" → 14900, 149.9 → 14990
formatTryAmount(kurus, { symbol = false }?): string                  // 149990 → "1.499,90"; { symbol: true } → "1.499,90 ₺" (NBSP). Storefront money: formatPrice only
isValidEan13(value: unknown): boolean                                // check digit
istanbulDateTimeLocal(value: Date | string | number | null | undefined): string   // → "2026-11-09T14:30" for <input type="datetime-local">
parseIstanbulDateTimeLocal(value: string | null | undefined): Date | null          // inverse; impossible dates → null
formatIstanbul(value, { time = true }?): string                      // "9 Kas 2026 14:30"
foldText(value: string): string; escapeLike(value: string): string   // Turkish-insensitive LIKE search:
sql`lower(translate(coalesce(${col}, ''), ${FOLD_FROM}, ${FOLD_TO})) like ${`%${escapeLike(foldText(q))}%`}`
PANEL_TIME_ZONE = "Europe/Istanbul"; SLUG_PATTERN; SLUG_MAX_LENGTH = 80
```

## 7. Cache tags

`TAGS` (`src/lib/cache-tags.ts`): `settings, theme, menus, announcements, uiStrings ("ui-strings"),
pages, page(slug), products, product(slug), categories, reviews(id), blog, post(slug), legal, media,
campaigns, redirects`. Server Actions return `tags` (panelAction calls `updateTag`); route handlers call
`revalidateTag(tag, "max")` themselves. Every storefront cached read must list every tag whose data it
embeds (do not rely on nested `use cache` calls to carry tags outward).

What the storefront reads today: `getProduct` → products, product:<slug>, categories, media;
`listProducts` → products, categories, media; `listCategories` → categories, products, media;
`getPage` → pages, page:<slug>; `getLegalDocument` → legal; `getMenus` → menus;
`getActiveAnnouncements` → announcements; `getMediaByIds`/`getMediaById` → media; `getSettings` → settings;
`getActiveTheme` → theme; `getMessages` → ui-strings; sitemap → products, categories, pages;
`findRedirect` → redirects.

| Mutation | Tags to return |
|---|---|
| Product save | `products`, `product:<oldSlug>`, `product:<newSlug>`; `categories` when the category changed; `redirects` when `recordMove` returned true |
| Product create / duplicate (draft) | `products` |
| Product archive, bulk status, delete | `products`, `product:<slug>` each, `categories`; delete also `dropRedirectsTo(canonicalPath.product(slug))` + `redirects`, and `campaigns` (+ `theme`) when campaign scopes changed |
| Quick stock edit, product reorder | `products` (+ `product:<slug>` for stock) |
| Category save / reorder / delete | `categories`, `products`; `redirects` when the slug moved; delete also `campaigns` (+ `theme`) when campaign scopes changed |
| Page save (meta + sections) | `pages`, `page:<oldSlug>`, `page:<newSlug>`; `redirects` when moved |
| Page delete | `pages`, `page:<slug>`, `redirects` (after `dropRedirectsTo`) |
| Menus | `menus` |
| Announcements | `announcements` |
| Theme save / set default / delete | `theme` (+ `campaigns` when campaign `themeId`s were cleared) |
| UI text override | `ui-strings` |
| Settings (any key) | `settings` |
| Legal publish / restore | `legal`, `pages` |
| Campaign create/save/delete | `campaigns` (and `theme` when a theme is linked/unlinked) |
| Coupon, newsletter subscriber, contact message, team, role | none (never cached; panelAction then calls `refresh()`) |
| Blog post save / delete | `blog`, `post:<oldSlug>`, `post:<newSlug>`; `redirects` when moved |
| Media alt edit / delete | `media`, `products`, `pages`, `categories`, `blog` (done by `media/actions.ts`) |
| Media upload / move folder | none (new rows are unreferenced; folders are labels) |

## 8. Redirects (moved slugs)

```ts
// src/lib/panel/redirects.ts (server; run in the same tx as the slug change)
canonicalPath.product(slug) → "/urunler/<slug>"; .category → "/kategori/<slug>"; .page → "/sayfa/<slug>"; .post → "/blog/<slug>"
recordMove(tx: Tx, fromPath: string, toPath: string): Promise<boolean>
if (await recordMove(tx, canonicalPath.product(old.slug), canonicalPath.product(input.slug))) tags.push(TAGS.redirects);
dropRedirectsTo(tx: Tx, path: string): Promise<number>          // on delete: old links 404 instead of redirecting to a 404
normalizeRedirectPath(path: string): string                     // throws PanelError("invalid") for non-canonical paths
// src/lib/data/redirects.ts (storefront)
findRedirect(folderPath: string): Promise<string | null>        // "use cache", cacheLife("max"), tag redirects
redirectIfMoved(locale: Locale, folderPath: string): Promise<void>   // permanentRedirect(localizePath(locale, to)) when a row exists
```
`recordMove` stores locale-less Turkish folder paths, drops a redirect *from* the new path (it is live
again), re-points every redirect that targeted the old path (x→a + a→b = x→b), deletes self-loops, then
upserts old→new. It returns true when it changed anything: add `TAGS.redirects` then. Already wired in the
not-found branches of `/[locale]/urunler/[slug]`, `/kategori/[slug]`, `/sayfa/[slug]`; BLOG-MEDIA wires
`await redirectIfMoved(locale, canonicalPath.post(slug))` (or `"/blog/" + slug`) into the blog post
page the same way, right before `notFound()`. With `ensureStatic = "navigation"` (gotcha 15) the page
renders as a whole and a moved slug answers a real 308 with Location (measured for a category slug); only a
route that streams the redirect from inside Suspense gets a client redirect after a 200.

**Deletes (FIXER).** `deleteCategory` and `deleteProduct` refuse with `in_use` while menus, announcements or
section hrefs link to `/kategori/<slug>` / `/urunler/<slug>` (`findLinksTo`), and remove the id from
campaign/coupon scopes in the same transaction (`detachFromDiscounts`, one audit row each); a discount whose
whole scope disappears is switched off instead of widening to every product. Category, product and blog
deletes send the loaded `updatedAt` (`categoryDeleteSchema`, `productDeleteSchema`, `blogDeleteInput`;
services `deleteProduct(tx, { id, updatedAt })`, `deleteBlogPost(tx, { id, updatedAt })`): a stale view is a
`conflict`. Legal pages (`kind = "legal"`): `savePage` requires exactly one visible, unscheduled
`legal_document` section for everyone with the page's own key; a changed `legal_document` key must exist.

## 9. Media

### 9.1 Storage (local vs Supabase)

| | `STORAGE_DRIVER=local` (default) | `STORAGE_DRIVER=supabase` |
|---|---|---|
| Seeded/imported media (`scripts/import-media.ts`) | `public/media/<key>` → `/media/<key>` | bucket → `…/object/public/<bucket>/<key>` |
| Panel uploads | `storage/uploads/<key>` (`LOCAL_UPLOAD_DIR` overrides; gitignored) → `/uploads/<key>`, served by `src/app/uploads/[...key]/route.ts` | same bucket; `/uploads/*` always 404s |
| Env | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` (default `media`, public) |

Why not `public/`: `next start` indexes `public/` once at boot, so files written later 404 until a
restart. The uploads route validates the key (`assertValidKey` + containment), serves only
avif/webp/png/jpg with the right type, `Cache-Control: public, max-age=31536000, immutable`, nosniff, no
listing. Every upload gets a new random stem (the optimized-image cache cannot be purged), so URLs are
immutable. The proxy skips `/uploads` and `/panel/api` (it would cut bodies at 10 MB).

```ts
// src/lib/media/storage.ts
getStorage(): StorageAdapter; getUploadStorage(): StorageAdapter; storageForMediaUrl(url: string): StorageAdapter
localUploadRoot(): string; LOCAL_UPLOADS_BASE_URL = "/uploads"; assertValidKey(key: string): void
interface StorageAdapter { driver: "local" | "supabase"; put(key, data, contentType); delete(key); publicUrl(key); stat(key) }
```

### 9.2 Upload route `POST /panel/api/media`

Multipart, field `files` (repeat per file, ≤ 10) and optional `folder` (default `genel`, `folderInput`
rules). Checks in order: same origin (Origin host = Host, `Sec-Fetch-Site`) → 403; session → 401; editor+
→ 403; multipart → 415; Content-Length present → 411 and ≤ 10×15 MB + 1 MB → 413; per file ≤ 15 MB → 413;
real type sniffed by sharp (JPEG/PNG/WebP/AVIF; SVG/GIF/HEIC/TIFF refused with a specific Turkish
message) and ≤ 50 MP → 400. All files are validated before anything is stored; files are removed again if
the DB step fails. Writes one `upload` audit row per image. Response: `200 { items: PanelMedia[] }` or
`{ error: string }` (Turkish). Use `MediaPicker`/`UploadPanel`; a hand-written client:
```ts
const form = new FormData(); for (const f of files) form.append(MEDIA_UPLOAD.fileField, f); form.set(MEDIA_UPLOAD.folderField, "urunler");
const res = await fetch(MEDIA_UPLOAD.endpoint, { method: "POST", body: form }); const body = (await res.json()) as MediaUploadResponse;
```

### 9.3 Types and functions

```ts
// media/types.ts (type-only + constants, client-safe)
type PanelMedia = MediaLike & { id; folder: string; alt: LocalizedText | null; width; height; bytes: number | null; createdAt: string; updatedAt: string; originalName: string | null; mime: string };
type MediaUsage = { kind: "product" | "product_media" | "variant" | "option_swatch" | "category" | "section" | "settings" | "blog" | "legal"; label: string; detail: string; href: string | null };
type MediaListInput = { q?: string; folder?: string; cursor?: number | null }; type MediaListResult = { items: PanelMedia[]; nextCursor: number | null; folders: string[] };
MEDIA_UPLOAD = { endpoint: "/panel/api/media", fileField: "files", folderField: "folder", maxFiles: 10, maxFileBytes: 15 MB, maxPixels: 50_000_000, accept, defaultFolder: "genel" }
MEDIA_PAGE_SIZE = 48; type MediaUploadResponse = { items: PanelMedia[] } | { error: string }

// media/actions.ts ("use server", editor+)
listMediaAction(input?: MediaListInput): Promise<MediaListResult>           // newest first; q: file name/alt/key/folder/tags; folder includes sub-folders
getMediaItemsAction(ids: number[]): Promise<PanelMedia[]>                    // in the given order, missing skipped
getMediaUsageAction(id: number): Promise<MediaUsage[]>
getMediaUsageCountsAction(ids: number[]): Promise<Record<number, number>>
updateMediaAltAction   // panelAction, payload { id, alt: LocalizedText | null, updatedAt } → data: PanelMedia; tags MEDIA (§7)
moveMediaAction        // payload { ids: number[], folder } → data: { moved, folder }
deleteMediaAction      // payload { id } → in_use with the list of places, else deletes row, files after commit
const r = await deleteMediaAction(null, toPayloadFormData({ id }));

// media/queries.ts (server; pass `tx` inside services)
listMedia(input?, executor = db, pageSize = 48); listMediaFolders(executor = db); getPanelMedia(ids, executor = db)
ensureMediaExist(executor: Tx, ids: (number | null | undefined)[], field = "media"): Promise<void>   // throws invalid with fieldErrors[field]
mediaUsage(id, executor = db): Promise<MediaUsage[]>; collectMediaUsage(ids, executor = db): Promise<Map<number, MediaUsage[]>>
mediaIdsInJson(value): Set<number>    // keys matching /(image|media)ids?$/i anywhere in JSON (section content, settings)
describeUsage(usage, max = 4): string // "Lavanta Latte (Galeri görseli), Ana Sayfa (Bölüm: Kapak) ve 3 yer daha"

// media/service.ts (server, no Next APIs)
uploadMediaFiles(files: { name; data: Buffer }[], { folder, actorId, storage? }): Promise<PanelMedia[]>
updateMediaAlt(tx, { id, alt, updatedAt }): Promise<{ media: PanelMedia; before }>
moveMedia(tx, { ids, folder }): Promise<{ id; from }[]>
deleteMediaRow(tx, id, { storage? }): Promise<{ before: PanelMedia; removeFiles: () => Promise<void> }>   // call removeFiles in afterCommit
// media/upload.ts: sniffImage(data, fileName), checkUploadSize({ name, size }), isSameOriginRequest(headers), sanitizeFileName(name), MAX_UPLOAD_REQUEST_BYTES
```
`mediaUsage` covers product images, variant images, option swatches, category image + SEO image, page
section content (any `*imageId(s)`/`*mediaId(s)` key), page SEO images, settings (logos + any media key),
blog covers + SEO images, legal SEO images. **New JSON that stores media ids must use keys ending in
`imageId`, `imageIds`, `mediaId` or `mediaIds`**, or deleting the image will not be blocked. Usage
`href`s point to `/panel/urunler/<id>`, `/panel/kategoriler/<id>`, `/panel/sayfalar/<id>`,
`/panel/blog/<id>`, `/panel/ayarlar/genel|seo`, `/panel/yasal`: build those routes.

## 10. Pickers and search (`"use server"`, uncached)

```ts
pickerProducts(q?: string): Promise<PickerProduct[]>      // editor+; name/subtitle (any locale), slug, SKU, barcode; active first; ≤ 30
type PickerProduct = { id; name: string /* Turkish */; subtitle: string | null; slug; sku?: string /* matched or default variant */; status; type; thumb: MediaLike | null };
pickerCategories(): Promise<PickerCategory[]>             // { id, name (TR), slug, isVisible }[], position order
linkTargets(): Promise<LinkTargetGroup[]>                 // [{ label: "Sayfalar"|"Ürünler"|"Kategoriler"|"Özel sayfalar"|"Yasal metinler"|"Blog yazıları", items: { label, href }[] }]
panelSearch(q: string): Promise<{ products: Hit[]; orders: Hit[]; pages: Hit[] }>   // staff+ (pages editor+); q ≥ 2 chars; ≤ 6 each
type Hit = { id: string | number; title: string; subtitle?: string; href: string /* /panel/urunler/<id>, /panel/siparisler/<id>, /panel/sayfalar/<id> */ };
```
Client caches (from `@/components/panel/form`): `loadAllProducts(force?)`, `searchProducts(q)`,
`loadCategories(force?)`, `loadLinkTargets(force?)`, `rememberProducts(list)`, `useProductLookup(ids, known?)`;
media: `primeMedia(items)`, `requestMedia(ids)`, `useMediaLookup(ids, known?)`. Pass preloaded `items` /
`categories` to the pickers when the page already has them (no request).

Link hrefs are canonical, locale-less Turkish paths (`/urunler/lavanta`, `/kategori/el-sabunu`,
`/sayfa/kvkk`, `/kurumsal`). The storefront localizes them with `localizePath` / `resolveLink`.

## 11. UI kit (`@/components/panel/ui`)

```tsx
Button({ variant?: "primary"|"secondary"|"ghost"|"danger"|"danger-outline"|"gold" = "secondary", size?: "sm"|"md"|"lg" = "md", icon?: LucideIcon, pending?, pendingLabel?, ...buttonProps })   // type defaults to "button"
<Button variant="primary" icon={Save} pending={pending} pendingLabel="Kaydediliyor…" onClick={save}>Kaydet</Button>

Badge({ tone?: Tone = "neutral", variant?: "dot"|"soft" = "dot", size?: "sm"|"md", title? })   // Tone from components/panel/labels
<Badge tone="success">Yayında</Badge>

buttonClass(variant?, size?, className?): string; iconButtonClass(size?: "sm"|"md", className?)   // PANEL recipes (the storefront has its own buttonClass in sections/button-styles)
<Link href="/panel/urunler/yeni" className={buttonClass("primary")}>Yeni ürün</Link>
controlClass, controlGroupClass, groupInputClass, affixClass, labelClass, helpClass, errorClass, errorTextClass, focusRingClass

Dialog({ open, onClose, title, description?, size?: "sm"|"md"|"lg"|"xl" = "md", placement?: "center"|"top", footer?, initialFocusRef?, dismissible? = true, hideCloseButton?, hideHeader?, role?: "dialog"|"alertdialog", describedBy?, className?, bodyClassName?, children })
<Dialog open={open} onClose={() => setOpen(false)} title="Varyant ekle" footer={<Button variant="primary" onClick={add}>Ekle</Button>}>…</Dialog>
// native modal <dialog>: focus trap, Escape, scroll lock, focus returns to the opener; content mounts only while open

ConfirmDialog({ open, onClose, onConfirm: () => void | Promise<unknown>, title, description?, children?, confirmLabel?, cancelLabel? = "Vazgeç", tone?: "danger"|"default" = "danger", pending?, confirmDisabled? })
<ConfirmDialog open={open} onClose={close} onConfirm={remove} title="Kategori silinsin mi?" description="Bu işlem geri alınamaz." />
useConfirm(): { confirm(options: ConfirmOptions): Promise<boolean>; confirmDialog: ReactNode }
const { confirm, confirmDialog } = useConfirm(); if (await confirm({ title: "Silinsin mi?" })) … ; return <>{confirmDialog}…</>

Tabs({ items: { value, label, icon?, badge?, invalid?, disabled?, content? }[], value?, defaultValue?, onValueChange?, ariaLabel, variant?: "underline"|"pills", keepMounted? = true })
<Tabs ariaLabel="Ürün bölümleri" items={[{ value: "genel", label: "Genel", invalid: form.hasErrors("name"), content: <General /> }]} />

toast(message, { tone?, description?, duration?, action?: { label, onClick }, id? }): number; toast.success / .error / .info / .warning (message, options?); toast.dismiss(id)
toast.success("Kaydedildi."); toast.error(result.error, { action: { label: "Sayfayı yenile", onClick: () => location.reload() }, duration: 0 });
useToast(); dismissToast(id); clearToasts()    // <Toaster/> is already mounted in PanelShell (top layer: shows above dialogs)

SortableList<T>({ items: T[], getKey(item, i), getItemLabel(item, i), onReorder(next: T[], { from, to, dragging? }), onDragEnd?(), renderItem(item, ctx), ariaLabel, disabled?, as?: "ul"|"ol", className?, itemClassName? })
// dragging: a live swap during a pointer drag (onDragEnd follows at the drop); keyboard/button moves put focus back on the moved item's control
useReorderSaver(rows, save: (next) => Promise<boolean>): { order, saving, reorder(next, move?), commit() }
// lists that save on reorder: one save per drag, keyboard moves debounced 700 ms, saves never overlap; wire reorder → onReorder, commit → onDragEnd
// ctx = { index, count, handle, moveButtons, moveUp, moveDown, isDragging }; pointer drag on the handle, ↑/↓ keys, move buttons, screen-reader announcements
<SortableList items={rows} getKey={(r) => r.id} getItemLabel={(r) => r.name} ariaLabel="Kategoriler" onReorder={setRows}
  renderItem={(r, ctx) => <SortableRow ctx={ctx} actions={ctx.moveButtons}>{r.name}</SortableRow>} />
SortableRow({ ctx, children, actions?, className? }); moveItem(list, from, to)

CommandPalette({ role }); openCommandPalette(); useCommandShortcutLabel()   // already mounted by the dashboard layout (PanelCommandPalette, server)
```

## 12. Form kit (`@/components/panel/form`)

Every input takes `value` + `onChange(value)` (not events) and passes plain input props through. Inside
a `Field`, controls get `id`, `aria-describedby`, `aria-invalid`, `aria-required` automatically. Give
`Field` the dotted `name` so the first invalid field is focused after a failed save.

```tsx
Field({ label, help?, error?: string | null, required?, optional?, hideLabel?, labelAside?, id?, name?, className?, children })
<Field label="SKU" required error={errorFor("variants.0.sku")} name="variants.0.sku"><TextInput value={v.sku} onChange={…} /></Field>
FieldGroup({ title?, description?, columns?: 1|2|3, className?, children }); useFieldControl(own?); useFieldLabelId(); useInField()

TextInput({ value, onChange(string), prefix?, suffix?, invalid?, size?: "sm"|"md", ...input })
Textarea({ value, onChange(string), invalid?, autoGrow? = true, maxRows?, showCount? = true, ...textarea })
NumberInput({ value: number | null, onChange(number | null), min?, max?, step? = 1, decimals? = 0, prefix?, suffix?, nullable? = true })
MoneyInput({ value: kuruş | null, onChange(kuruş | null), min? = 0, max? })          // shows "1.499,90 ₺"
PercentInput({ value, onChange, min? = 0, max? = 100, decimals? = 0 })
Switch({ checked, onChange(boolean), label?, description?, invalid?, size? })
Select<V extends string | number>({ value: V | null, onChange(V), options: { value: V; label; disabled?; group? }[], placeholder?, allowEmpty?, onClear?, invalid?, size? })
<Select value={state.type} onChange={(v) => setField("type", v)} options={[{ value: "liquid_soap", label: "Sıvı sabun" }]} />

LocalizedInput / LocalizedTextarea({ label, value: LocalizedText | null, onChange(LocalizedText), help?, error?: string | { tr?, en?, ar? }, required?, placeholder?, maxLength?, rows? (textarea), hideLabel?, name? })
<LocalizedInput label="Ad" required value={state.name} onChange={(v) => setField("name", v)} error={form.localizedError("name")} name="name" />
// TR/EN/AR tabs with filled dots; a field error on "name.en" switches to the EN tab and marks it; Arabic gets dir="rtl" lang="ar"; "TR'den kopyala"; empty en/ar keys removed
LocalizedRichText({ label, value, onChange, help?, error?, required?, placeholder?, minHeight? = 12, name? })
RichTextEditor({ value: html, onChange(html), placeholder?, disabled?, invalid?, minHeight? = 10, lang?, dir? })
// emits clean HTML (p, br, strong, em, a, h2, h3, ul, ol, li, blockquote, hr) through sanitizeHtml; Ctrl+K = link dialog. Sanitize again on the server: z.string().transform(sanitizeHtml)

ColorInput({ value: "#RRGGBB" | "", onChange(hex), against? = "#F9F8F5", againstLabel?, usage?: "text"|"fill", allowEmpty?, placeholder?, invalid? })   // AA badge
ScheduleInput({ value: { startsAt: string | null; endsAt: string | null }, onChange, label?, help?, error?: string | { startsAt?, endsAt? }, startLabel?, endLabel?, requireStart?, requireEnd?, name? })
<ScheduleInput label="Yayın zamanı" value={state.schedule} onChange={(v) => setField("schedule", v)} error={form.errorsUnder("schedule")} />
// values are ISO UTC strings, entered in Istanbul time; the server's scheduleInput accepts them
SlugInput({ value, onChange, source /* TR name */, prefix? /* "/urunler/" */, auto?, original? /* saved slug → "eski adres yönlendirilecek" note */, invalid? })
LinkInput({ value, onChange(href), placeholder?, invalid?, hideOpen? }); LinkPickerDialog({ open, onClose, onSelect(target), current? }); useLinkTargets(enabled?)
hrefError(value): string | null; tidyHref(value): string; HREF_HINT
CtaInput({ label, value?: { label: LocalizedText; href } , onChange(v | undefined), optional?, help?, errors?: Record<relPath, msg>, required?, name? })
<CtaInput label="Buton" optional value={state.cta} onChange={(v) => setField("cta", v)} errors={form.errorsUnder("cta")} />
LocalizedListInput({ label, value: LocalizedText[], onChange, help?, itemLabel? = "Madde", max?, errors?, maxLength?, name? })

MediaPicker single:   { value: number | null, onChange(id | null, item | null), items?: MediaLike[], folder?, aspect? = "4/3", invalid?, disabled?, dialogTitle? }
MediaPicker multiple: { multiple: true, value: number[], onChange(ids, items), max?, items?, folder? }     // reorderable; first = "Ana görsel"
<MediaPicker multiple value={state.mediaIds} onChange={(ids) => setField("mediaIds", ids)} folder="urunler" max={20} />
MediaPickerDialog({ open, onClose, onSelect(items: PanelMedia[]), multiple?, max?, currentId?, excludeIds?, folder?, title? }); UploadPanel({ folders, defaultFolder, onUploaded })
ProductPicker single: { value, onChange(id | null, product | null), items?: PickerProduct[], placeholder?, dialogTitle? }; multiple: { multiple: true, value: number[], onChange(ids, products), max? }
CategoryPicker single (select): { value, onChange(id | null), categories?, allowEmpty? = true, placeholder? }; multiple (chips): { multiple: true, value: number[], onChange(ids) }

Repeater<T>({ items, onChange(items), createItem(), renderItem(item, { index, update }), noun, itemSummary?, ariaLabel, min?, max?, addLabel?, collapsible? = true, defaultCollapsed?, confirmRemove? = true, allowDuplicate?, itemHasError?(i), emptyText? })
<Repeater items={state.carriers} onChange={(v) => setField("carriers", v)} noun="Kargo firması" ariaLabel="Kargo firmaları"
  createItem={() => ({ key: "", name: "", trackingUrl: "" })} itemHasError={(i) => form.hasErrors(`carriers.${i}`)}
  renderItem={(c, { index, update }) => <TextInput value={c.name} onChange={(name) => update({ ...c, name })} />} />

SaveBar({ dirty, pending, onSave, onReset?, saveLabel? = "Kaydet", pendingLabel?, resetLabel? = "Vazgeç", errorCount?, savedNote?, allowCleanSave?, guard? = true })
// sticky; Ctrl/⌘+S (ignored while a dialog is open); guard: beforeunload + confirm on same-origin link clicks. One per page.
// FIXER: a confirmed leave calls onReset (the hidden route would show the edits again). Back/swipe-back cannot be
// intercepted: dirty-registry keeps the hidden draft guarded (reload/close warning, a "Düzenlemeye dön" toast);
// confirmLeaveCurrent() (command palette) and confirmLeaveDrafts() (sign-out) ask first.

usePanelForm<V>(initial: V, { successMessage? }?): PanelForm<V>
// { state, setState, setField(path, v), getField(path), bind(path) → { name, value, onChange, error }, dirty, reset(next?), saved,
//   errors, errorFor(path), errorsUnder(path), localizedError(path), hasErrors(path), setErrors, pending, formRef,
//   submit(action, { payload?(state), validate?: zodLike, successMessage?: string | false, errorToast? = true, resetTo?, onSuccess?, onError? }) }
await form.submit(saveAction, { payload: (s) => ({ ...s, extra: undefined }), validate: clientSchema });
```
`submit` posts `payload` = JSON, maps dotted `fieldErrors` back (cleared per path on edit), focuses the
first visible invalid field, toasts the result (a `conflict` toast stays and offers "Sayfayı yenile"),
keeps the state on failure, and follows fresh `initial` data from the server when the form is clean.
Helpers: `getIn`, `setIn`, `splitPath`, `joinPath`, `looselyEqual`, `errorsUnder`, `parseTrNumber`,
`formatTrNumber`, `cleanRichHtml`, `toEditorHtml`, `richProseClass`, `PANEL_LOCALES`, `LOCALE_LABELS`,
`hasText`, `setLocale`, `formatBytes`, `mediaLabel`.

## 13. Section field specs (`src/components/sections/field-spec.ts`, pure)

Every `sectionMeta` entry has `label`, `description` (one line for the section picker), `schema`,
`defaults` (parse with their own schema) and `fields: FieldSpec[]` covering every schema key (unit test:
`tests/unit/section-fields.test.ts`). SITE-PAGES' `contact_info` / `contact_form` must include both
`description` and `fields` or the type check and that test fail.

| `type` | Value at `key` | Extra spec props | Kit component |
|---|---|---|---|
| `text` | string (optional: undefined when empty) | `placeholder?`, `maxLength?` | `TextInput` |
| `localized` | LocalizedText | `placeholder?`, `maxLength?` | `LocalizedInput` |
| `localizedLong` | LocalizedText (blank line = paragraph) | `rows?`, `maxLength?` | `LocalizedTextarea` |
| `localizedRich` | LocalizedText of HTML | — | `LocalizedRichText` |
| `media` | media id or null | `folder?`, `aspect?` | `MediaPicker` |
| `product` | product id or null | — | `ProductPicker` |
| `products` | product id[] (ordered) | `max?` | `ProductPicker multiple` |
| `number` | number | `min?`, `max?`, `step?`, `suffix?` | `NumberInput` |
| `percent` | number | `min?`, `max?` | `PercentInput` |
| `select` | one of `options[].value` | `options: { value, label }[]` | `Select` |
| `switch` | boolean | — | `Switch` |
| `link` | href string (canonical TR path, #anchor, https, mailto, tel) | — | `LinkInput` |
| `cta` | `{ label: LocalizedText; href }` or undefined | `optional?` | `CtaInput` |
| `localizedList` | LocalizedText[] | `max?`, `itemLabel?` | `LocalizedListInput` |
| `repeater` | object[] following nested `fields` | `itemLabel`, `min?`, `max?`, `fields` | `Repeater` (recurse) |

Common props: `key`, `label` (Turkish), `help?`, `required?` (mark only; zod decides). Helpers:
`emptyValueFor(spec)`, `emptyItemFor(fields)`, `flattenFieldSpecs(fields)`, `FIELD_TYPES`.
Section schemas now enforce the link rule: every `cta.href`, gallery `href` (`""` = no link) and hero
`videoUrl` (`/path` or `https://` only) fail with `HREF_MESSAGE` when unsafe. Validate each section with
`sectionMeta[type].schema` on save; the storefront `SectionRenderer` parses with the same schema, so an
invalid section renders nothing.

## 14. Storefront link rule (save and render)

`isSafeHref(raw): boolean` (`src/lib/safe-href.ts`): `/path` (not `//`), `#anchor`, `https://` (host
with a dot, no userinfo), `mailto:`, `tel:`. Refused: `javascript:`/`data:`/`vbscript:` in any case or
spacing, entity-encoded schemes, `http://`, `//host`, backslashes, whitespace/control/zero-width
characters. Save side: `hrefInput` / `optionalHrefInput` / section schemas. Render side (CORE-CHECK):
`resolveLink` (sections) maps unsafe → home page, `localizeMenu` (menus) unsafe → home page,
`AnnouncementBar` unsafe → no link. Links inside rich text go through `sanitizeHtml`, which keeps
`http(s)://`, `mailto:`, `tel:`, `/path`, `#` (FIXER: hrefs with named character references other than
`&amp; &quot; &apos; &lt; &gt;`, and "/" followed by a backslash, are dropped). FIXER: every rich-text renderer
(RichText, Faq, LegalDocument, ProductInfoAccordion, blog) localizes internal paths for the reader with
`localizedRichTextHtml(text, locale)` / `localizeBodyLinks(html, locale)` (`src/components/sections/localize-links.ts`).

## 15. Test users, browser and DB tests

```bash
node scripts/db-server.mjs start                                      # idempotent
npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts create <you>@test.local editor   # prints a generated password
npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts cookie <you>@test.local <password> http://<you>.localhost:<port>
#   → prints better-auth.session_token=…  ; in your tab: document.cookie = "<name=value>; path=/"; then open /panel
npx tsx --conditions=react-server --env-file=.env.local scripts/panel-test-user.ts delete <you>@test.local   # also deletes its audit_log rows
```
- Dev server per builder: `NEXT_DIST_DIR=.next/dev-<you> npx next dev -p <port>` and browse
  `http://<you>.localhost:<port>` (own cookie jar). Never port 3000. Afterwards delete `.next/dev-<you>`
  and remove the `.next/dev-<you>/…` lines `next dev` adds to `tsconfig.json` `include`; `next build`
  (integrator) rewrites `next-env.d.ts`.
- Refuses production and non-local DBs and e-mails outside `@test.local`. Never read or type `ADMIN_PASSWORD`.
- DB tests: call services with a `tx` from `db.transaction`, or `executePanelAction({ schema, run }, FAKE_ACTOR, plainValue)`
  with `const FAKE_ACTOR = { user: { id: "<you>-test-actor", name, email: "<you>@test.local", role: "editor", banned: false }, session: { id: "x" }, staffRole: "editor" } as unknown as StaffSession;`
  (`audit_log.user_id` has no FK). Snapshot the counts, every `updated_at` you touch and the id sequences
  in `before`, restore them in `after` and assert they match (see `tests/db/panel-core.test.ts`,
  `tests/db/orders.test.ts`). Run only your file while others work:
  `npx tsx --test --conditions=react-server --env-file=.env.local --import ./tests/db/setup/local-only.ts tests/db/<yours>.test.ts`
  (every DB test file also imports `./setup/local-only` first: a `DATABASE_URL` that is not localhost is refused).

## 16. Gotchas found today

1. **`ref={form.formRef}` breaks lint.** The React Compiler rule `react-hooks/refs` then treats the
   whole `form` object as a ref and flags every `form.dirty`, `form.pending`, `form.errors`… Destructure
   it: `const { formRef } = form;` + `<form ref={formRef}>` (verified: 6 errors → 0).
2. **Hidden browser pane = no Suspense reveal.** React 19.3 reveals streamed Suspense boundaries on an
   animation frame; while the built-in browser pane is hidden, every boundary stays as its fallback
   (content waits in `div[hidden][id^="S:"]`). Take a `computer` screenshot (forces a frame) before
   reading the DOM, or bring the pane to front.
3. `textInput()` used to be typed `string | null` even when required: it now has overloads
   (required → `string`, `{ required: false }` → `string | null`).
4. Send `updatedAt` as an ISO string with zone (`toISOString()`); keep Dates out of client state
   (ScheduleInput expects ISO strings, `looselyEqual` compares strings).
5. Unique violations become a generic `invalid` without a field: check SKU/slug/code uniqueness in the
   service and throw `fieldError(path, …)` so the message lands next to the field.
6. Publishing legal versions and switching the default theme must clear the old flag **before** setting
   the new one (partial unique indexes, §1).
7. `panelSearch` shows the default variant's SKU in the palette subtitle even when another variant's SKU
   matched (`pickerProducts` shows the matched one).
8. A product/category/page edit invalidates by tag only: the storefront updates on the next request,
   but a visitor's client router cache may show the old page for up to `stale` (5 min).
9. Server actions are POSTs to the current page: the proxy lets a POST without a session through so
   `panelAction` can redirect to the login page itself.
10. `requireStaff()` redirects (pages); `requirePanelActor()` throws `PanelError("forbidden")` (read
    functions); `panelAction` returns `{ code: "forbidden" }`; route handlers use `getPanelActor()` and
    answer 401/403 JSON.
11. The command palette navigates with `router.push`, which skips the SaveBar's link guard: it now asks
    through `confirmLeaveCurrent()` and resets the editor on "yes" (FIXER).
12. While a modal dialog is open, a toast's close button cannot be clicked (toasts still time out).
13. The rich text editor relies on the deprecated `document.execCommand` (no new dependency allowed);
    its emitted value is always clean even if the live DOM briefly holds browser markup.
14. FIXER: `getActiveAnnouncements` follows the schedule like campaigns (`campaignCacheProfile`): "minutes"
    only while a start/end is under an hour away, longer further out, "max" when nothing is scheduled, so
    storefront pages no longer revalidate every minute.
15. **`[slug]` storefront pages export `ensureStatic = "navigation"` (INTEGRATOR).** Without it, Next
    16.4.5 answered the first request after a panel edit to a product/category/`sayfa`/blog page that
    was not yet in the server's memory (e.g. after a restart) by resuming the route's `[slug]` fallback
    shell, whose build-time `"use cache"` results (incl. `listProducts`) are reused without a tag check:
    the old name/price showed once (`NEXT_PRIVATE_DEBUG_CACHE=1` logs "Resume Data Cache entry found").
    With `"navigation"` there is no fallback shell; an invalidated or unlisted slug waits for the complete
    static page (verified: first request after a save is a blocking `MISS` with fresh data). Give any new
    dynamic storefront route with `generateStaticParams` the same export.
16. `/sayfa/kurumsal|numune|iletisim` (and `/page/…`) get a real 308 from `src/proxy.ts`; the page's own
    `permanentRedirect` inside Suspense remains as a fallback (200 + meta refresh).
17. **FIXER: self-hosted route cache (`cache-handler.cjs`, `next.config.ts` `cacheHandler`, not on Vercel).**
    Next 16.4.5 stamps a tag invalidation twice: the "use cache" handler with `performance.timeOrigin +
    performance.now()`, then FileSystemCache with `Date.now()`. In a long-running process the two clocks
    drift (measured +1.3 s) and the second stamp could be the earlier one, so a "use cache" entry refilled
    just before a save was never expired by it. The handler keeps the later stamp. It also keeps rendered
    404s only in the in-memory LRU (no `.next/server/route-cache` files per unknown slug). Residual: when
    the performance clock is *behind* `Date.now()`, an invalidation takes effect that much later (as before).
18. **FIXER: auth.** `/api/auth/admin/*` answers 404 over HTTP (team actions call `auth.api.*` in-process);
    the admin role no longer has impersonate/delete/set-email/set-phone/update. Failed e-mail sign-ins are
    counted per address (10 per 15 min → 429 `TOO_MANY_FAILED_SIGN_INS`, from any IP). Self-hosting: set
    `AUTH_IP_HEADER` / `TRUSTED_IP_HEADER` to the header the proxy overwrites (optional
    `AUTH_TRUSTED_PROXIES`); otherwise X-Forwarded-For is read from the right past private ranges. The
    contact form also has a DB-backed site-wide cap (50 messages per 10 min).
19. **FIXER: cached reads trust no arguments.** Next registers every "use cache" function as a callable
    server reference: `listProducts` only returns listable types, never business-only products.
    **Day 5 (AUDIENCE-PERF):** `getPage` now returns sections of every audience. The static pages render
    them all and the client `<AudienceGate>` (src/components/sections/AudienceGate.tsx) shows business
    sections only to approved business customers and hides retail ones from them, so business sections
    are in every visitor's page payload: they must never hold confidential content (the panel says so).

## 17. What CORE-CHECK verified (2026-11-09)

- Gates: `npx tsc --noEmit` clean; `npx eslint src scripts tests --quiet` clean; `npm test` 218/218;
  `npm run test:db` 44/44 with the DB identical before/after (row hashes + sequences); `npx next build`
  OK — 48/57 storefront paths fully static (all home, listing, product, category and `sayfa` pages);
  only `sepet`, `odeme`, `odeme/simulator` are partial, as before.
- Browser (dev on `corecheck.localhost:3302`, throwaway editor): the sidebar and palette hide the four
  admin items (20 of 24 shown, desktop and 375 px, no sideways scroll); Ctrl+K palette search by name
  ("lavanta" → 4 products, distinct SKUs) and SKU ("por-20"); a temporary editor page built from
  `LocalizedInput`, `RichTextEditor`, `MoneyInput`, `MediaPicker`, `SortableList`, `SaveBar`,
  `usePanelForm` + a `panelAction`: server zod errors `title.tr` + `price` mapped to the fields (TR tab
  focused, "2 alan düzeltilmeli"), a service `fieldError("items.1.label")` mapped and focused, Ctrl+S,
  a sharp-generated JPEG uploaded through the dialog (served from `/uploads/…` as AVIF/WebP with the
  immutable header), picked, reordered, saved: one audit row with the sanitized body
  (`<p>Merhaba <strong>kalın</strong> metin.</p>`), kuruş price and new order, and the page's cached
  timestamp changed in the same response (`updateTag`). `deleteMediaAction` then removed the row and
  both files. No console errors. Temporary page, media, files, test user, audit rows removed; sequences
  restored.

## 18. Final check (FINAL CHECKER, 2026-11-09)

- Gates after the last change and the reseed: `tsc` clean, `eslint src scripts tests --quiet` clean,
  `npm test` 456/456, `npm run test:db` 145/145 (DB identical before/after, sequences included),
  `next build` OK (storefront pages ○ except `sepet`, `odeme`, `odeme/simulator`, `siparis/[orderNumber]`
  and `[...rest]`).
- The signatures in this file were checked against the code; every name it documents exists (the `Thing*`
  names are the illustrative example). Only UI change: the audit log names settings rows by their
  Turkish page title ("Ayarlar · Kargo") instead of `#shipping`.
- `npm run db:seed` imports media in a non-deterministic order: a reseed can swap the ids of a few media
  rows (references move with them, so nothing visible changes). Never hard-code media ids.
