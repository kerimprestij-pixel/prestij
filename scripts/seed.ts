// Idempotent reseed of the catalog and site content (settings, themes, media, products, pages, …).
//   npx tsx --conditions=react-server --env-file=.env.local scripts/seed.ts   (or: npm run db:seed)
// Media files are reused when they already exist; pass --force-media to re-encode them.
//
// Safety: refuses NODE_ENV=production, refuses a non-local DATABASE_URL, and refuses when the
// TRUNCATE … CASCADE would also empty tables holding other data (orders, companies, reviews, …),
// unless --i-know-this-wipes-data is passed. Everything runs in one transaction, so a failure
// leaves the previous content in place. Auth tables are kept; users' group links are remapped by slug.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { count, eq, getTableName, inArray, is, isNotNull, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import type { ProductMediaRole } from "@/db/schema/catalog";
import { formatMediaReport, importAllMedia, type ImportedImage } from "./import-media";
import { createScriptDb, type ScriptDb } from "./seed-data/db";
import { LEGAL_DOCUMENTS, LEGAL_VERSION } from "./seed-data/legal";
import {
  BUNDLE,
  CLAIMS,
  OPTION_NAME,
  PACK_ORDER,
  PACKAGING,
  SAMPLE,
  SCENTS,
  packOf,
  type PackKey,
  type ScentProduct,
} from "./seed-data/products";
import {
  ANNOUNCEMENTS,
  CATEGORIES,
  CUSTOMER_GROUPS,
  LEGAL_PAGES,
  legalPageSeo,
  MENUS,
  SUBSCRIPTION_PLANS,
  THEMES,
  buildSettings,
} from "./seed-data/site";
import { homePageMeta } from "./seed-data/home-page";
import { SITE_PAGES } from "./seed-data/site-pages";
import { seedBlogPosts } from "./seed-data/blog";

const AUTH_TABLES = new Set(["user", "session", "account", "verification"]);
const WIPE_FLAG = "--i-know-this-wipes-data";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const {
  announcements,
  blogPosts,
  companies,
  media,
  user,
  bundleItems,
  categories,
  customerGroups,
  legalDocuments,
  menus,
  pageSections,
  pages,
  productMedia,
  productOptionValues,
  productOptions,
  productRelations,
  productVariants,
  products,
  settings,
  subscriptionPlans,
  themes,
  variantOptionValues,
} = schema;

function domainTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable) && !AUTH_TABLES.has(getTableName(v)));
}

/** Tables this script owns and rebuilds from scratch. Nothing else is truncated directly. */
const SEED_TABLES: PgTable[] = [
  settings,
  themes,
  media,
  customerGroups,
  categories,
  subscriptionPlans,
  products,
  productOptions,
  productOptionValues,
  productVariants,
  variantOptionValues,
  productMedia,
  bundleItems,
  productRelations,
  menus,
  announcements,
  legalDocuments,
  pages,
  pageSections,
  // Seeded since day 5 (scripts/seed-data/blog.ts). blog_posts.cover_id references media, so the media
  // TRUNCATE … CASCADE empties it anyway; listing it keeps a reseed from refusing over its own posts.
  blogPosts,
];

function assertSafeTarget() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed with NODE_ENV=production.");
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    // createScriptDb reports a missing/invalid DATABASE_URL.
  }
  if (host && !LOCAL_HOSTS.has(host) && !process.argv.includes(WIPE_FLAG)) {
    throw new Error(
      `DATABASE_URL points at "${host}", not a local database. The seed replaces the catalog and site content there; ` +
        `re-run with ${WIPE_FLAG} only if that is really intended.`,
    );
  }
}

/**
 * Tables outside SEED_TABLES that TRUNCATE … CASCADE would also empty (foreign-key dependents,
 * transitively), with their current row counts. Only non-empty ones are returned.
 */
async function cascadeVictims(db: ScriptDb): Promise<{ table: string; rows: number }[]> {
  const seedNames = SEED_TABLES.map((t) => getTableName(t));
  const deps = await db.execute<{ relname: string }>(sql`
    with recursive dep(oid) as (
      select c.oid from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relname in (${sql.join(
        seedNames.map((n) => sql`${n}`),
        sql`, `,
      )})
      union
      select con.conrelid from pg_constraint con join dep on con.confrelid = dep.oid where con.contype = 'f'
    )
    select c.relname from pg_class c join dep on dep.oid = c.oid`);
  const others = [...deps].map((r) => r.relname).filter((name) => !seedNames.includes(name));
  const counted = await Promise.all(
    others.map(async (table) => {
      const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`);
      return { table, rows: Number(row?.n ?? 0) };
    }),
  );
  return counted.filter((c) => c.rows > 0);
}

async function truncateSeedTables(db: ScriptDb) {
  const victims = await cascadeVictims(db);
  if (victims.length > 0 && !process.argv.includes(WIPE_FLAG)) {
    const list = victims.map((v) => `${v.table} (${v.rows})`).join(", ");
    throw new Error(`Reseeding would also empty: ${list}. Nothing was changed. Re-run with ${WIPE_FLAG} to wipe them.`);
  }
  const names = SEED_TABLES.map((t) => `"${getTableName(t)}"`);
  await db.execute(sql.raw(`TRUNCATE TABLE ${names.join(", ")} RESTART IDENTITY CASCADE`));
}

/** User → customer group slug, read before the groups are renumbered. */
async function readGroupMemberships(db: ScriptDb): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ userId: user.id, slug: customerGroups.slug })
    .from(user)
    .innerJoin(customerGroups, eq(user.customerGroupId, customerGroups.id));
  const bySlug = new Map<string, string[]>();
  for (const r of rows) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), r.userId]);
  return bySlug;
}

/** Points users at the new group ids (by slug) and clears links to rows that no longer exist. */
async function relinkUsers(db: ScriptDb, memberships: Map<string, string[]>, groups: { id: number; slug: string }[]) {
  await db.update(user).set({ customerGroupId: null }).where(isNotNull(user.customerGroupId));
  for (const group of groups) {
    const userIds = memberships.get(group.slug);
    if (userIds?.length) await db.update(user).set({ customerGroupId: group.id }).where(inArray(user.id, userIds));
  }
  await db
    .update(user)
    .set({ companyId: null })
    .where(sql`${user.companyId} is not null and not exists (select 1 from ${companies} where ${companies.id} = ${user.companyId})`);
}

// ---------------------------------------------------------------------------------------------
// Product images

const roleOf = (img: ImportedImage): ProductMediaRole =>
  img.stem.toLowerCase().includes("studyo") ? "packshot" : img.ambalaj === "20l_graphic" ? "gallery" : "lifestyle";

/** Pump first (studio shot at position 0), then 5 L, then 20 L; studio shots lead each packaging group. */
function orderedImages(images: ImportedImage[]): ImportedImage[] {
  const rank = (i: ImportedImage) =>
    PACK_ORDER.indexOf(packOf(i.ambalaj)) * 10 + (i.ambalaj === "20l_graphic" ? 5 : 0) + (roleOf(i) === "packshot" ? 0 : 1);
  return images
    .map((img, index) => ({ img, index }))
    .sort((a, b) => rank(a.img) - rank(b.img) || a.index - b.index)
    .map(({ img }) => img);
}

// ---------------------------------------------------------------------------------------------
// Catalog

type Ctx = {
  db: ScriptDb;
  categoryIds: Record<string, number>;
  images: ImportedImage[];
};

async function insertScentProduct(ctx: Ctx, scent: ScentProduct, position: number) {
  const { db } = ctx;
  const images = orderedImages(ctx.images.filter((i) => i.urun === scent.urun));
  const firstImage = (pack: PackKey) => images.find((i) => packOf(i.ambalaj) === pack)?.mediaId ?? null;

  const [product] = await db
    .insert(products)
    .values({
      slug: scent.slug,
      type: "standard",
      status: "active",
      name: scent.name,
      subtitle: scent.subtitle,
      shortDescription: scent.shortDescription,
      description: scent.description,
      categoryId: ctx.categoryIds[scent.category],
      accentColor: scent.accentColor,
      usage: scent.usage,
      warnings: scent.warnings,
      ingredients: scent.ingredients,
      claims: CLAIMS,
      specs: scent.specs,
      seo: scent.seo,
      isFeatured: true,
      allowSubscription: true,
      position,
    })
    .returning({ id: products.id });

  const [option] = await db
    .insert(productOptions)
    .values({ productId: product.id, name: OPTION_NAME, display: "buttons", position: 0 })
    .returning({ id: productOptions.id });

  const values = await db
    .insert(productOptionValues)
    .values(PACK_ORDER.map((pack, i) => ({ optionId: option.id, value: PACKAGING[pack].label, position: i })))
    .returning({ id: productOptionValues.id });

  const variants = await db
    .insert(productVariants)
    .values(
      PACK_ORDER.map((pack, i) => ({
        productId: product.id,
        sku: `PR-${scent.skuCode}-${PACKAGING[pack].skuSuffix}`,
        barcode: scent.barcodes[pack],
        price: PACKAGING[pack].price,
        vatRate: 20,
        stock: 100,
        volumeMl: PACKAGING[pack].volumeMl,
        weightGrams: PACKAGING[pack].weightGrams,
        imageId: firstImage(pack),
        isDefault: pack === "pump",
        position: i,
      })),
    )
    .returning({ id: productVariants.id });

  await db.insert(variantOptionValues).values(variants.map((v, i) => ({ variantId: v.id, optionValueId: values[i].id })));

  const variantId = Object.fromEntries(PACK_ORDER.map((pack, i) => [pack, variants[i].id])) as Record<PackKey, number>;
  if (images.length) {
    await db.insert(productMedia).values(
      images.map((img, position) => ({
        productId: product.id,
        mediaId: img.mediaId,
        variantId: variantId[packOf(img.ambalaj)],
        role: roleOf(img),
        position,
      })),
    );
  }
  return { productId: product.id, variantId, packshotId: firstImage("pump") };
}

async function insertBundle(ctx: Ctx, fiveLiterVariantIds: number[], position: number) {
  const { db } = ctx;
  const images = ctx.images.filter((i) => i.urun === "collection");
  const portrait = images.find((i) => i.height >= i.width) ?? images[0];
  const [product] = await db
    .insert(products)
    .values({
      slug: BUNDLE.slug,
      type: "bundle",
      status: "active",
      name: BUNDLE.name,
      subtitle: BUNDLE.subtitle,
      shortDescription: BUNDLE.shortDescription,
      description: BUNDLE.description,
      categoryId: ctx.categoryIds["hediye-setleri"],
      accentColor: BUNDLE.accentColor,
      claims: CLAIMS,
      specs: SCENTS[0].specs.slice(0, 1),
      seo: BUNDLE.seo,
      isFeatured: true,
      allowSubscription: false,
      position,
    })
    .returning({ id: products.id });

  const [variant] = await db
    .insert(productVariants)
    .values({
      productId: product.id,
      sku: BUNDLE.sku,
      price: BUNDLE.price,
      vatRate: 20,
      stock: 100,
      volumeMl: PACKAGING["5l"].volumeMl * fiveLiterVariantIds.length,
      weightGrams: PACKAGING["5l"].weightGrams * fiveLiterVariantIds.length,
      imageId: portrait?.mediaId ?? null,
      isDefault: true,
    })
    .returning({ id: productVariants.id });

  await db
    .insert(bundleItems)
    .values(fiveLiterVariantIds.map((variantId, i) => ({ bundleProductId: product.id, variantId, quantity: 1, position: i })));

  if (images.length) {
    await db.insert(productMedia).values(
      [portrait, ...images.filter((i) => i !== portrait)].map((img, i) => ({
        productId: product.id,
        mediaId: img.mediaId,
        variantId: variant.id,
        role: (img === portrait ? "packshot" : "hero") as ProductMediaRole,
        position: i,
      })),
    );
  }
  return product.id;
}

async function insertSample(ctx: Ctx, scent: ScentProduct, packshotId: number | null, position: number) {
  const { db } = ctx;
  const [product] = await db
    .insert(products)
    .values({
      slug: `${scent.slug}-numune`,
      type: "sample",
      status: "active",
      name: {
        tr: `${scent.name.tr} ${SAMPLE.nameSuffix.tr}`,
        en: `${scent.name.en} ${SAMPLE.nameSuffix.en}`,
        ar: `${SAMPLE.nameSuffix.ar} ${scent.name.ar}`,
      },
      subtitle: SAMPLE.subtitle,
      shortDescription: SAMPLE.shortDescription,
      categoryId: ctx.categoryIds.numune,
      accentColor: scent.accentColor,
      usage: scent.usage,
      warnings: scent.warnings,
      ingredients: scent.ingredients,
      claims: CLAIMS,
      seo: { noIndex: true },
      position,
    })
    .returning({ id: products.id });

  await db.insert(productVariants).values({
    productId: product.id,
    sku: `PR-${scent.skuCode}-NUM`,
    price: SAMPLE.price,
    vatRate: 20,
    stock: SAMPLE.stock,
    maxQuantity: 1,
    imageId: packshotId,
    isDefault: true,
  });
  if (packshotId) {
    await db.insert(productMedia).values({ productId: product.id, mediaId: packshotId, role: "packshot", position: 0 });
  }
  return product.id;
}

// ---------------------------------------------------------------------------------------------
// Pages

type SeedSection = {
  type: string;
  content: unknown;
  position: number;
  isVisible?: boolean;
  audience?: "all" | "retail" | "business";
  startsAt?: Date | null;
  endsAt?: Date | null;
};

const FALLBACK_HOME: SeedSection[] = [
  {
    type: "hero",
    position: 0,
    content: {
      eyebrow: { tr: "PRESTİJ Koleksiyonu", en: "The PRESTİJ Collection", ar: "مجموعة PRESTİJ" },
      title: { tr: "Dört koku, tek zarafet", en: "Four scents, one elegance", ar: "أربع روائح، أناقة واحدة" },
      subtitle: {
        tr: "Lavanta Latte, Lavanta, Portakal ve Okyanus.",
        en: "Lavender Latte, Lavender, Orange and Ocean.",
        ar: "لاتيه اللافندر واللافندر والبرتقال والمحيط.",
      },
      cta: { label: { tr: "Koleksiyonu keşfet", en: "Explore the collection", ar: "اكتشف المجموعة" }, href: "/urunler" },
      mediaId: "@media:PRESTIJ_Koleksiyon_5L_yatay_koleksiyon",
    },
  },
];

async function loadHomeSections(): Promise<{ sections: SeedSection[]; source: string }> {
  const file = path.join(process.cwd(), "scripts", "seed-data", "home-page.ts");
  if (!existsSync(file)) return { sections: FALLBACK_HOME, source: "fallback hero (home-page.ts not found)" };
  const mod = (await import(pathToFileURL(file).href)) as {
    homeSections?: SeedSection[];
    default?: { homeSections?: SeedSection[] };
  };
  const sections = mod.homeSections ?? mod.default?.homeSections;
  if (!Array.isArray(sections)) {
    throw new Error("scripts/seed-data/home-page.ts must export `homeSections: { type, content, position, isVisible? }[]`");
  }
  return { sections, source: "scripts/seed-data/home-page.ts" };
}

/** Replaces "@media:<stem>" and "@product:<slug>" strings (anywhere in the tree) with numeric ids. */
function resolveRefs(value: unknown, refs: { media: Map<string, number>; products: Map<string, number> }, missing: string[]): unknown {
  if (typeof value === "string") {
    const match = /^@(media|product):(.+)$/.exec(value);
    if (!match) return value;
    const id = (match[1] === "media" ? refs.media : refs.products).get(match[2]);
    if (id === undefined) missing.push(value);
    return id ?? null;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, refs, missing));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, refs, missing)]));
  }
  return value;
}

// ---------------------------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  assertSafeTarget();
  const { db: client, close } = createScriptDb();
  try {
    await client.transaction(async (db) => {
      const memberships = await readGroupMemberships(db);
      console.log("Truncating catalog and content tables…");
      await truncateSeedTables(db);

      console.log("Importing media…");
      const imported = await importAllMedia(db, { force: process.argv.includes("--force-media") });
      console.log(formatMediaReport(imported.report));
      const mediaId = (stem: string) => {
        const id = imported.byStem.get(stem);
        if (id === undefined) throw new Error(`Seed references unknown media "${stem}"`);
        return id;
      };

      console.log("Seeding settings, themes, groups, categories…");
      const settingValues = buildSettings({
        logoLightId: imported.logo.lightId,
        logoDarkId: imported.logo.darkId,
        ogImageId: imported.byStem.get("PRESTIJ_Koleksiyon_5L_yatay_koleksiyon") ?? null,
      });
      await db.insert(settings).values(Object.entries(settingValues).map(([key, value]) => ({ key, value })));
      await db.insert(themes).values(THEMES);
      const groupRows = await db
        .insert(customerGroups)
        .values(CUSTOMER_GROUPS)
        .returning({ id: customerGroups.id, slug: customerGroups.slug });
      await relinkUsers(db, memberships, groupRows);
      const categoryRows = await db
        .insert(categories)
        .values(
          CATEGORIES.map((c, position) => ({
            slug: c.slug,
            name: c.name,
            description: c.description,
            body: c.body,
            faq: c.faq,
            seo: c.seo,
            accentColor: c.accentColor,
            imageId: c.image ? mediaId(c.image) : null,
            isVisible: c.isVisible,
            position,
          })),
        )
        .returning({ id: categories.id, slug: categories.slug });
      const categoryIds = Object.fromEntries(categoryRows.map((c) => [c.slug, c.id]));
      await db.insert(subscriptionPlans).values(SUBSCRIPTION_PLANS.map((p, position) => ({ ...p, position })));

      console.log("Seeding products…");
      const ctx: Ctx = { db, categoryIds, images: imported.images };
      const productIds = new Map<string, number>();
      const scentResults = [];
      for (const [i, scent] of SCENTS.entries()) {
        const result = await insertScentProduct(ctx, scent, i);
        productIds.set(scent.slug, result.productId);
        scentResults.push({ scent, ...result });
      }
      const bundleId = await insertBundle(
        ctx,
        scentResults.map((r) => r.variantId["5l"]),
        SCENTS.length,
      );
      productIds.set(BUNDLE.slug, bundleId);
      for (const [i, r] of scentResults.entries()) {
        productIds.set(`${r.scent.slug}-numune`, await insertSample(ctx, r.scent, r.packshotId, 10 + i));
      }
      const scentIds = scentResults.map((r) => r.productId);
      await db.insert(productRelations).values([
        ...scentIds.flatMap((id) =>
          scentIds.filter((other) => other !== id).map((other, position) => ({ productId: id, relatedProductId: other, kind: "related" as const, position })),
        ),
        ...scentIds.map((id, position) => ({ productId: bundleId, relatedProductId: id, kind: "related" as const, position })),
      ]);

      console.log("Seeding navigation, legal texts, pages…");
      await db.insert(menus).values(Object.entries(MENUS).map(([key, items]) => ({ key, items })));
      await db.insert(announcements).values(ANNOUNCEMENTS.map((a, position) => ({ ...a, isActive: true, position })));
      const legalRows = await db
        .insert(legalDocuments)
        .values(LEGAL_DOCUMENTS.map((d) => ({ ...d, version: LEGAL_VERSION, isCurrent: true })))
        .returning({ key: legalDocuments.key, title: legalDocuments.title });

      const [home] = await db
        .insert(pages)
        .values({
          slug: "home",
          kind: "home",
          title: { tr: "Ana Sayfa", en: "Home", ar: "الرئيسية" },
          seo: homePageMeta.seo,
          isPublished: true,
        })
        .returning({ id: pages.id });
      const { sections, source } = await loadHomeSections();
      const missing: string[] = [];
      const resolved = sections.map((s) => ({ ...s, content: resolveRefs(s.content, { media: imported.byStem, products: productIds }, missing) }));
      if (missing.length) throw new Error(`Home sections reference unknown ids: ${[...new Set(missing)].join(", ")}`);
      if (resolved.length) {
        await db.insert(pageSections).values(
          resolved.map((s) => ({
            pageId: home.id,
            type: s.type,
            position: s.position,
            isVisible: s.isVisible ?? true,
            content: s.content ?? {},
            audience: s.audience ?? "all",
            startsAt: s.startsAt ?? null,
            endsAt: s.endsAt ?? null,
          })),
        );
      }
      console.log(`  home sections: ${resolved.length} from ${source}`);

      for (const legal of LEGAL_PAGES) {
        const doc = legalRows.find((d) => d.key === legal.key);
        if (!doc) throw new Error(`No legal document for key "${legal.key}"`);
        const [page] = await db
          .insert(pages)
          .values({ slug: legal.slug, kind: "legal", title: doc.title, seo: legalPageSeo(legal.slug, doc.title), isPublished: true })
          .returning({ id: pages.id });
        await db.insert(pageSections).values({ pageId: page.id, type: "legal_document", position: 0, content: { key: legal.key } });
      }

      // /kurumsal, /numune, /iletisim: page-builder pages with reserved slugs (scripts/seed-data/site-pages.ts).
      for (const sitePage of SITE_PAGES) {
        const [page] = await db
          .insert(pages)
          .values({ slug: sitePage.slug, kind: sitePage.kind, title: sitePage.title, seo: sitePage.seo, isPublished: true })
          .returning({ id: pages.id });
        const missingRefs: string[] = [];
        const rows = sitePage.sections.map((s) => ({
          pageId: page.id,
          type: s.type,
          position: s.position,
          isVisible: s.isVisible ?? true,
          content: resolveRefs(s.content, { media: imported.byStem, products: productIds }, missingRefs) ?? {},
        }));
        if (missingRefs.length) throw new Error(`/${sitePage.slug} sections reference unknown ids: ${[...new Set(missingRefs)].join(", ")}`);
        if (rows.length) await db.insert(pageSections).values(rows);
      }
      console.log(`  site pages: ${SITE_PAGES.map((p) => `/${p.slug} (${p.sections.length})`).join(", ")}`);

      // Blog posts (scripts/seed-data/blog.ts): covers by media stem, related products by slug.
      console.log(`  blog posts: ${await seedBlogPosts(db, { media: imported.byStem, products: productIds })}`);
    });

    // Summary
    const tables = domainTables();
    const counts = await Promise.all(
      tables.map(async (t) => [getTableName(t), (await client.select({ n: count() }).from(t))[0].n] as const),
    );
    console.log("\nRow counts:");
    for (const [name, n] of counts.filter(([, n]) => n > 0)) console.log(`  ${name.padEnd(24)} ${n}`);
    console.log(`  (empty: ${counts.filter(([, n]) => n === 0).map(([name]) => name).join(", ")})`);
    console.log(`\nSeed finished in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
