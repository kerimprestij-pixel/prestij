// CONTENT area rules: page kinds (fixed slugs, deletable pages, storefront paths), the menus payload
// (link rule, header-only dropdowns, limits) and the announcement payload and status window.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { announcementStatus } from "@/lib/panel/content/announcements";
import { MENU_DEFS } from "@/lib/panel/content/menus";
import { canDeletePage, isAlwaysPublished, isFixedSlugPage, isReservedSlug, pageAddressNote, pageGroup, pageSitePath } from "@/lib/panel/content/pages";
import { announcementSaveSchema, menusSaveSchema, pageCreateSchema } from "@/lib/panel/content/schemas";

describe("page rules", () => {
  const home = { slug: "home", kind: "home" };
  const legal = { slug: "kvkk", kind: "legal" };
  const corporate = { slug: "kurumsal", kind: "b2b" };
  const custom = { slug: "hakkimizda", kind: "custom" };

  test("only custom pages can be deleted or moved", () => {
    assert.deepEqual([home, legal, corporate, custom].map(canDeletePage), [false, false, false, true]);
    assert.deepEqual([home, legal, corporate, custom].map(isFixedSlugPage), [true, true, true, false]);
    assert.deepEqual([home, legal, corporate, custom].map(isAlwaysPublished), [true, true, false, false]);
  });

  test("storefront paths: home, routed pages and /sayfa/<slug>", () => {
    assert.equal(pageSitePath(home), "/");
    assert.equal(pageSitePath(corporate), "/kurumsal");
    assert.equal(pageSitePath({ slug: "iletisim", kind: "custom" }), "/iletisim");
    assert.equal(pageSitePath(legal), "/sayfa/kvkk");
    assert.equal(pageSitePath(custom), "/sayfa/hakkimizda");
    assert.equal(pageSitePath({ slug: "urunler", kind: "custom" }), "/urunler", "the products page copy shows on /urunler");
    assert.equal(pageAddressNote({ slug: "urunler", kind: "custom" }), "Bu içerik /urunler adresinde gösterilir.");
  });

  test("groups and reserved slugs", () => {
    assert.deepEqual([home, legal, corporate, custom].map(pageGroup), ["site", "legal", "site", "custom"]);
    for (const slug of ["home", "kurumsal", "numune", "iletisim", "urunler"]) assert.ok(isReservedSlug(slug), slug);
    assert.equal(isReservedSlug("hakkimizda"), false);
  });

  test("new page payload: Turkish title and a clean slug", () => {
    assert.ok(pageCreateSchema.safeParse({ title: { tr: "Hakkımızda" }, slug: "hakkimizda" }).success);
    const bad = pageCreateSchema.safeParse({ title: { tr: " " }, slug: "Hakkımızda!" });
    assert.equal(bad.success, false);
    const paths = !bad.success ? bad.error.issues.map((i) => i.path.join(".")) : [];
    assert.ok(paths.includes("title.tr"));
    assert.ok(paths.includes("slug"));
  });
});

const menus = (overrides: Record<string, unknown> = {}) => ({
  menus: Object.fromEntries(MENU_DEFS.map((d) => [d.key, { items: [], updatedAt: null, ...(overrides[d.key] as object | undefined) }])),
});

describe("menus payload", () => {
  test("valid items pass; footer children are dropped; highlight kept", () => {
    const parsed = menusSaveSchema.safeParse(
      menus({
        header: {
          items: [{ label: { tr: "Ürünler", en: "Products" }, href: "/urunler", children: [{ label: { tr: "El Sabunu" }, href: "/kategori/el-sabunu", highlight: true }] }],
          updatedAt: "2026-11-06T15:29:14.891Z",
        },
        footer_shop: { items: [{ label: { tr: "Tüm Ürünler" }, href: "/urunler", children: [{ label: { tr: "x" }, href: "/x" }] }] },
      }),
    );
    assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    type Item = { children?: { highlight?: boolean }[] };
    assert.equal((parsed.data.menus.header.items[0] as Item).children?.[0].highlight, true);
    assert.equal((parsed.data.menus.footer_shop.items[0] as Item).children, undefined, "footer menus have no dropdowns");
    assert.ok(parsed.data.menus.header.updatedAt instanceof Date);
  });

  test("unsafe links and empty labels are refused at their paths", () => {
    const parsed = menusSaveSchema.safeParse(
      menus({
        header: { items: [{ label: { tr: "Kötü" }, href: "javascript:alert(1)" }, { label: { tr: "" }, href: "/urunler" }] },
        footer_legal: { items: [{ label: { tr: "Eski" }, href: "http://example.com" }] },
      }),
    );
    assert.equal(parsed.success, false);
    const paths = !parsed.success ? parsed.error.issues.map((i) => i.path.join(".")) : [];
    assert.ok(paths.includes("menus.header.items.0.href"), paths.join(", "));
    assert.ok(paths.includes("menus.header.items.1.label.tr"), paths.join(", "));
    assert.ok(paths.includes("menus.footer_legal.items.0.href"), paths.join(", "));
  });

  test("the header holds at most 8 links", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ label: { tr: `Bağlantı ${i}` }, href: "/urunler" }));
    const parsed = menusSaveSchema.safeParse(menus({ header: { items } }));
    assert.equal(parsed.success, false);
    assert.deepEqual(!parsed.success && parsed.error.issues[0].path, ["menus", "header", "items"]);
  });
});

describe("announcements", () => {
  const base = {
    id: null,
    text: { tr: "Ücretsiz kargo", en: "Free shipping" },
    href: "",
    variant: "brand",
    isActive: true,
    schedule: { startsAt: null, endsAt: null },
    updatedAt: null,
  };

  test("payload: empty link → null, unsafe link refused, variant checked", () => {
    const ok = announcementSaveSchema.safeParse(base);
    assert.ok(ok.success);
    assert.equal(ok.data.href, null);
    for (const href of ["javascript:alert(1)", "http://example.com", "//evil.example"]) {
      const bad = announcementSaveSchema.safeParse({ ...base, href });
      assert.equal(bad.success, false, href);
      assert.deepEqual(!bad.success && bad.error.issues[0].path, ["href"]);
    }
    assert.equal(announcementSaveSchema.safeParse({ ...base, variant: "pink" }).success, false);
    assert.equal(announcementSaveSchema.safeParse({ ...base, text: { tr: "" } }).success, false);
  });

  test("status follows the storefront window rule", () => {
    const now = Date.parse("2026-11-09T12:00:00.000Z");
    assert.equal(announcementStatus({ isActive: true, startsAt: null, endsAt: null }, now), "live");
    assert.equal(announcementStatus({ isActive: false, startsAt: null, endsAt: null }, now), "off");
    assert.equal(announcementStatus({ isActive: true, startsAt: "2026-11-10T00:00:00.000Z", endsAt: null }, now), "scheduled");
    assert.equal(announcementStatus({ isActive: true, startsAt: null, endsAt: "2026-11-09T12:00:00.000Z" }, now), "ended");
    assert.equal(announcementStatus({ isActive: true, startsAt: "2026-11-09T12:00:00.000Z", endsAt: "2026-11-09T13:00:00.000Z" }, now), "live");
  });
});
