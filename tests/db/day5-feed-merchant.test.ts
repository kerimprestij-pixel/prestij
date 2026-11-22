// Day 5 FEED against the local PostgreSQL: the merchant feed built from the live catalog.
//   - every listed variant is a valid item, samples / business-only / noindex products never appear;
//   - every image link (main and additional) is a JPEG/PNG/WebP file that exists on disk (never AVIF);
//   - g:shipping equals what checkout charges for one unit, computed through the real cart pipeline
//     (loadVariantLines + loadCampaigns + loadCommerceSettings + totalsForLoadedCart), with and without a
//     throwaway campaign; with the campaign, g:sale_price equals the cart's unit price;
//   - every stored barcode of a listed variant is a valid EAN-13, so the feed publishes each GTIN.
// The route reads the catalog through the cached getProduct(); cacheLife() throws outside Next, so the
// products are read here with the same rules (active variants in position order, product media in position
// order plus unlinked variant images, retail tiers). Everything runs in a transaction that is rolled
// back; the campaigns id sequence is put back.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day5-feed-merchant.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { loadCampaigns, loadVariantLines } from "@/lib/cart/load";
import { loadCommerceSettings } from "@/lib/cart/settings";
import { totalsForLoadedCart } from "@/lib/cart/totals";
import { RETAIL_CUSTOMER } from "@/lib/cart/types";
import type { ProductMediaData, ProductOptionData, ProductVariantData, TierData } from "@/lib/data/catalog";
import { mediaColumns } from "@/lib/data/media";
import { localUploadRoot } from "@/lib/media/storage";
import { isValidEan13 } from "@/lib/panel/format";
import type { Tx } from "@/lib/panel/tx";
import { collectMerchantFeedItems, formatFeedPrice, type MerchantFeedCampaign, type MerchantFeedData, type MerchantFeedItem, type MerchantFeedProduct } from "@/lib/seo/merchant-feed";
import { parseSettings } from "@/lib/settings/types";

const ORIGIN = "http://check.localhost:3520";
const CAMPAIGN_NAME = "day5-test-feed-campaign";
const { products: P, productVariants: V, campaigns: C } = schema;

class Rollback extends Error {}
async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

type Seq = { last_value: string; is_called: boolean };
const readSeq = async (): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from campaigns_id_seq`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const campaignsSnapshot = async () => JSON.stringify(await db.select().from(C).orderBy(C.id));
let campaignSeq: Seq;
let campaignsBefore: string;

before(async () => {
  const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence('campaigns', 'id') as seq`);
  assert.equal(seq, "public.campaigns_id_seq");
  campaignSeq = await readSeq();
  campaignsBefore = await campaignsSnapshot();
});

after(async () => {
  try {
    await db.delete(C).where(eq(C.name, CAMPAIGN_NAME)); // never committed; defensive
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from campaigns`));
    if (max === null || Number(max) <= Number(campaignSeq.last_value)) {
      await db.execute(sql`select setval('campaigns_id_seq'::regclass, ${campaignSeq.last_value}::bigint, ${campaignSeq.is_called})`);
    }
    assert.deepEqual(await readSeq(), campaignSeq, "campaigns id sequence restored");
    assert.equal(await campaignsSnapshot(), campaignsBefore, "campaigns unchanged");
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------
// The catalog as getProduct() returns it (the fields the feed reads), uncached

async function readFeedProducts(tx: Tx): Promise<MerchantFeedProduct[]> {
  const rows = await tx
    .select({
      id: P.id,
      slug: P.slug,
      type: P.type,
      name: P.name,
      subtitle: P.subtitle,
      shortDescription: P.shortDescription,
      description: P.description,
      seo: P.seo,
      businessOnly: P.businessOnly,
      categoryId: P.categoryId,
    })
    .from(P)
    // listProductSlugs(): every active standard/bundle product (the builder drops business-only and noindex ones).
    .where(and(eq(P.status, "active"), inArray(P.type, ["standard", "bundle"])))
    .orderBy(asc(P.position), asc(P.id));
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const [categories, variants, links, options, values, productMedia, tiers] = await Promise.all([
    tx.select({ id: schema.categories.id, slug: schema.categories.slug, name: schema.categories.name }).from(schema.categories),
    tx
      .select({
        productId: V.productId,
        id: V.id,
        sku: V.sku,
        barcode: V.barcode,
        price: V.price,
        compareAtPrice: V.compareAtPrice,
        vatRate: V.vatRate,
        stock: V.stock,
        trackStock: V.trackStock,
        allowBackorder: V.allowBackorder,
        lowStockThreshold: V.lowStockThreshold,
        volumeMl: V.volumeMl,
        weightGrams: V.weightGrams,
        minQuantity: V.minQuantity,
        maxQuantity: V.maxQuantity,
        imageId: V.imageId,
        isDefault: V.isDefault,
      })
      .from(V)
      .where(and(inArray(V.productId, ids), eq(V.isActive, true)))
      .orderBy(asc(V.productId), asc(V.position), asc(V.id)),
    tx.select().from(schema.variantOptionValues),
    tx.select().from(schema.productOptions).where(inArray(schema.productOptions.productId, ids)).orderBy(asc(schema.productOptions.position), asc(schema.productOptions.id)),
    tx.select().from(schema.productOptionValues).orderBy(asc(schema.productOptionValues.position), asc(schema.productOptionValues.id)),
    tx
      .select({ productId: schema.productMedia.productId, variantId: schema.productMedia.variantId, role: schema.productMedia.role, media: mediaColumns })
      .from(schema.productMedia)
      .innerJoin(schema.media, eq(schema.productMedia.mediaId, schema.media.id))
      .where(inArray(schema.productMedia.productId, ids))
      .orderBy(asc(schema.productMedia.productId), asc(schema.productMedia.position), asc(schema.productMedia.id)),
    tx
      .select({ productId: schema.tierPrices.productId, variantId: schema.tierPrices.variantId, minQuantity: schema.tierPrices.minQuantity, discountPercent: schema.tierPrices.discountPercent })
      .from(schema.tierPrices)
      .where(isNull(schema.tierPrices.groupId)),
  ]);
  const variantImageIds = variants.map((v) => v.imageId).filter((id): id is number => id != null);
  const variantImages = variantImageIds.length ? await tx.select(mediaColumns).from(schema.media).where(inArray(schema.media.id, variantImageIds)) : [];

  return rows.map((row) => {
    const own: ProductVariantData[] = variants
      .filter((v) => v.productId === row.id)
      .map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        vatRate: v.vatRate,
        stock: v.stock,
        trackStock: v.trackStock,
        allowBackorder: v.allowBackorder,
        lowStockThreshold: v.lowStockThreshold,
        volumeMl: v.volumeMl,
        weightGrams: v.weightGrams,
        minQuantity: v.minQuantity,
        maxQuantity: v.maxQuantity,
        imageId: v.imageId,
        isDefault: v.isDefault,
        optionValueIds: links
          .filter((l) => l.variantId === v.id)
          .map((l) => l.optionValueId)
          .sort((a, b) => a - b),
      }));
    const media: ProductMediaData[] = productMedia.filter((m) => m.productId === row.id).map(({ media: m, variantId, role }) => ({ media: m, variantId, role }));
    const known = new Set(media.map((m) => m.media.id));
    for (const v of own) {
      const m = v.imageId != null && !known.has(v.imageId) ? variantImages.find((x) => x.id === v.imageId) : undefined;
      if (m) {
        media.push({ media: m, variantId: v.id, role: "packshot" });
        known.add(m.id);
      }
    }
    const productOptions: ProductOptionData[] = options
      .filter((o) => o.productId === row.id)
      .map((o) => ({
        id: o.id,
        name: o.name,
        display: o.display,
        values: values.filter((val) => val.optionId === o.id).map((val) => ({ id: val.id, value: val.value, swatchColor: val.swatchColor, swatchMediaId: val.swatchMediaId })),
      }));
    const variantIds = new Set(own.map((v) => v.id));
    const productTiers: TierData[] = tiers
      .filter((t) => t.productId === row.id || (t.variantId != null && variantIds.has(t.variantId)))
      .map((t) => ({ variantId: t.variantId, minQuantity: t.minQuantity, discountPercent: t.discountPercent }))
      .sort((a, b) => a.minQuantity - b.minQuantity);
    const category = categories.find((c) => c.id === row.categoryId) ?? null;
    return { ...row, category, options: productOptions, variants: own, media, tiers: productTiers };
  });
}

/** The feed input the route builds, from the transaction (campaigns filtered to live ones like getActiveCampaigns). */
async function readFeedData(tx: Tx, asOf: number): Promise<MerchantFeedData> {
  const [products, rows, settingRows] = await Promise.all([
    readFeedProducts(tx),
    loadCampaigns(tx),
    tx.select().from(schema.settings).where(inArray(schema.settings.key, ["general", "seo", "shipping"])),
  ]);
  const value = (key: string) => settingRows.find((r) => r.key === key)?.value;
  const live: MerchantFeedCampaign[] = rows.filter((c) => (!c.startsAt || c.startsAt.getTime() <= asOf) && (!c.endsAt || asOf < c.endsAt.getTime()));
  return {
    products,
    campaigns: { campaigns: live, asOf },
    general: parseSettings("general", value("general")),
    seo: parseSettings("seo", value("seo")),
    shipping: parseSettings("shipping", value("shipping")),
  };
}

/** What checkout computes for one unit of a variant: the cart pipeline itself (retail guest, no coupon). */
async function checkoutQuote(tx: Tx, variantId: number, now: Date): Promise<{ shipping: number; unitPrice: number }> {
  const [lines, campaigns, settings] = await Promise.all([loadVariantLines(tx, [{ variantId, quantity: 1 }], RETAIL_CUSTOMER), loadCampaigns(tx), loadCommerceSettings(tx)]);
  assert.equal(lines.length, 1);
  const totals = totalsForLoadedCart({ cart: null, customer: RETAIL_CUSTOMER, lines, coupon: null, campaigns, sampleOffers: [] }, settings, { now });
  assert.ok(totals.lines[0].included, `variant ${variantId} can be bought`);
  return { shipping: totals.shipping.total, unitPrice: totals.lines[0].unitPrice };
}

/** The file behind a local image URL, or null for remote storage (not fetched: no network in tests). */
function localFile(url: string): string | null {
  const pathname = url.slice(ORIGIN.length).split(/[?#]/)[0];
  if (!url.startsWith(ORIGIN)) return null;
  if (pathname.startsWith("/media/")) return path.resolve("public", ...decodeURIComponent(pathname).slice(1).split("/"));
  if (pathname.startsWith("/uploads/")) return path.join(localUploadRoot(), ...decodeURIComponent(pathname).slice("/uploads/".length).split("/"));
  return null;
}

// ---------------------------------------------------------------------------------------------------

describe("merchant feed from the live catalog", () => {
  test("every sellable variant becomes a valid item; samples, business-only and noindex products never appear", async () => {
    await inRollback(async (tx) => {
      const data = await readFeedData(tx, Date.now());
      const { items, skipped } = collectMerchantFeedItems(data, ORIGIN);
      assert.ok(items.length > 0, "the live catalog lists something");

      const listable = data.products.filter((p) => !p.businessOnly && !p.seo?.noIndex);
      const expected = listable.flatMap((p) => p.variants.filter((v) => v.price > 0 && v.minQuantity <= 1).map((v) => v.sku));
      assert.deepEqual(items.map((i) => i.id).sort(), [...expected].sort(), "one item per sellable variant");
      assert.deepEqual(skipped.filter((s) => s.reason === "no_image" || s.reason === "invalid_price"), [], "no live variant is dropped for a missing image or price");
      assert.equal(new Set(items.map((i) => i.id)).size, items.length, "ids are unique");

      const samples = await tx.select({ sku: V.sku }).from(V).innerJoin(P, eq(P.id, V.productId)).where(eq(P.type, "sample"));
      for (const { sku } of samples) assert.ok(!items.some((i) => i.id === sku), `sample ${sku} is not listed`);
      const hidden = await tx
        .select({ sku: V.sku })
        .from(V)
        .innerJoin(P, eq(P.id, V.productId))
        .where(or(eq(P.businessOnly, true), sql`coalesce((${P.seo} ->> 'noIndex')::boolean, false)`, sql`${P.status} <> 'active'`));
      for (const { sku } of hidden) assert.ok(!items.some((i) => i.id === sku), `${sku} (business-only, noindex or inactive) is not listed`);

      for (const item of items) {
        assert.ok(item.title && Array.from(item.title).length <= 150, `${item.id} title`);
        assert.ok(item.description && Array.from(item.description).length <= 5000, `${item.id} description`);
        assert.match(item.price, /^\d+\.\d{2} TRY$/);
        assert.match(item.link, /^http:\/\/check\.localhost:3520\/tr\/urunler\/[a-z0-9-]+(\?varyant=\d+)?$/);
        assert.ok(item.brand, `${item.id} brand`);
        assert.ok(item.mpn, `${item.id} mpn`);
        assert.equal(item.shipping.country, "TR");
      }
    });
  });

  test("every image link is an existing JPEG/PNG/WebP file (never AVIF), main and additional", async () => {
    await inRollback(async (tx) => {
      const { items } = collectMerchantFeedItems(await readFeedData(tx, Date.now()), ORIGIN);
      let checked = 0;
      for (const item of items) {
        for (const url of [item.imageLink, ...item.additionalImageLinks]) {
          assert.match(url, /\.(webp|jpe?g|png)(\?|$)/i, `${item.id}: ${url} is a format Google accepts`);
          const file = localFile(url);
          if (!file) continue;
          assert.ok(existsSync(file), `${item.id}: ${url} exists (${file})`);
          assert.ok(statSync(file).size > 0, `${item.id}: ${url} is not empty`);
          checked++;
        }
        assert.ok(item.additionalImageLinks.length <= 10);
        assert.ok(!item.additionalImageLinks.includes(item.imageLink), "the main image is not repeated");
      }
      assert.ok(checked > 0, "at least one local file was checked");
    });
  });

  test("every stored barcode of a listed variant is a valid EAN-13, so each one is published as g:gtin", async () => {
    await inRollback(async (tx) => {
      const data = await readFeedData(tx, Date.now());
      const { items } = collectMerchantFeedItems(data, ORIGIN);
      for (const p of data.products) {
        for (const v of p.variants) {
          const item = items.find((i) => i.id === v.sku);
          if (!item || !v.barcode?.trim()) continue;
          assert.ok(isValidEan13(v.barcode.trim()), `${v.sku}: stored barcode ${v.barcode} is a valid EAN-13`);
          assert.equal(item.gtin, v.barcode.trim());
        }
      }
    });
  });
});

describe("shipping and sale price match checkout", () => {
  const compare = async (tx: Tx, now: Date): Promise<MerchantFeedItem[]> => {
    const data = await readFeedData(tx, now.getTime());
    const { items } = collectMerchantFeedItems(data, ORIGIN);
    const variants = new Map(data.products.flatMap((p) => p.variants.map((v) => [v.sku, v] as const)));
    for (const item of items) {
      const variant = variants.get(item.id);
      assert.ok(variant);
      const quote = await checkoutQuote(tx, variant.id, now);
      assert.equal(item.shipping.price, formatFeedPrice(quote.shipping), `${item.id}: g:shipping = checkout shipping for one unit`);
      assert.equal(item.salePrice ?? item.price, formatFeedPrice(quote.unitPrice), `${item.id}: the price Google shows = the cart's unit price`);
    }
    return items;
  };

  test("without campaigns (or with the live ones): every item's shipping and price equal the cart's", async () => {
    await inRollback(async (tx) => {
      const items = await compare(tx, new Date());
      assert.ok(items.length > 0);
    });
  });

  test("a throwaway campaign (rolled back): sale price, date window and the shipping it changes all match checkout", async () => {
    await inRollback(async (tx) => {
      const now = new Date();
      const [target] = await tx
        .select({ id: P.id, maxPrice: sql<number>`max(${V.price})`.mapWith(Number) })
        .from(P)
        .innerJoin(V, eq(V.productId, P.id))
        .where(and(eq(P.status, "active"), inArray(P.type, ["standard", "bundle"]), eq(P.businessOnly, false), eq(V.isActive, true)))
        .groupBy(P.id)
        .orderBy(sql`max(${V.price}) desc`)
        .limit(1);
      assert.ok(target, "a listable product exists");
      const before = await compare(tx, now);
      // 30 % for an hour and a day: a high price usually crosses the free-shipping threshold, so shipping changes too.
      await tx.insert(C).values({
        name: CAMPAIGN_NAME,
        discountPercent: 30,
        productIds: [target.id],
        priority: 1000,
        isActive: true,
        startsAt: new Date(now.getTime() - 3_600_000),
        endsAt: new Date(now.getTime() + 86_400_000),
      });
      const items = await compare(tx, now);
      const onSale = items.filter((i) => i.salePrice);
      assert.ok(onSale.length > 0, "the campaign shows as a sale price");
      for (const item of onSale) {
        assert.match(item.salePriceEffectiveDate ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+0300\/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+0300$/);
        assert.equal(item.price, before.find((b) => b.id === item.id)?.price, `${item.id}: g:price stays the regular price`);
      }
      // On the live catalog the dearest item (the 1,599.90 set) ships free; 30 % off takes it below the
      // threshold, so its shipping must change, and (checked above) still equal checkout's.
      const { freeThreshold } = (await readFeedData(tx, now.getTime())).shipping;
      if (freeThreshold > 0 && target.maxPrice >= freeThreshold && target.maxPrice * 0.7 < freeThreshold) {
        const shippingBefore = new Map(before.map((b) => [b.id, b.shipping.price]));
        assert.ok(
          onSale.some((i) => shippingBefore.get(i.id) !== i.shipping.price),
          "the sale price crossed the free-shipping threshold and the feed's shipping followed",
        );
      }
    });
  });
});
