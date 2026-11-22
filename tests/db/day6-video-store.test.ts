// Day 6 VIDEO-STORE against the local PostgreSQL:
//   - every image consumer of product_media / media skips videos (storefront cards and gallery loader,
//     cart thumbnails = order snapshot source, sample/quote form and request mail images, panel thumbnails,
//     image sitemap, SEO Kontrol), even when a video sits in the first row (written straight to the table);
//   - the product page gallery loader returns the videos with their covers and slots (a video without a
//     cover is left out), the video sitemap entries, the section video reader;
//   - the product save's kind rules (first row an image, at most three videos, each with a cover; no video
//     as variant image, swatch or share image), `autoplay` saved, diffed and duplicated, video role forced
//     to "gallery", image rows never autoplay;
//   - the page save refuses a video in an image field and an image in a video field.
// Everything happens inside transactions that are rolled back (test data: day6-test-video-… /
// DAY6TEST…); the id sequences those writes advance are put back and the touched tables compared.
//   npx tsx --test --conditions=react-server --env-file=.env.local tests/db/day6-video-store.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { queryVideoMedia } from "@/components/sections/video-media";
import { loadVariantLines } from "@/lib/cart/load";
import { RETAIL_CUSTOMER } from "@/lib/cart/types";
import { loadProductGallery, loadProductMedia, queryCards } from "@/lib/data/catalog";
import { querySitemapData } from "@/lib/data/sitemap";
import { MEDIA_KIND_MESSAGES, createPage, savePage } from "@/lib/panel/content/pages-service";
import { getPageEditorData } from "@/lib/panel/content/queries";
import { pageSaveSchema } from "@/lib/panel/content/schemas";
import { PanelError } from "@/lib/panel/errors";
import { firstMediaByProduct, loadProductState } from "@/lib/panel/products/queries";
import { productSaveSchema } from "@/lib/panel/products/schema";
import { duplicateProduct, saveProduct } from "@/lib/panel/products/service";
import { PRODUCT_MEDIA_MESSAGES, newKey, type ProductEditorState, type ProductMediaState } from "@/lib/panel/products/types";
import { loadSeoSource } from "@/lib/panel/seo/queries";
import type { Tx } from "@/lib/panel/tx";
import { loadRequestCatalog } from "@/lib/requests/catalog";
import { loadRequestDisplay } from "@/lib/requests/emails";

const RUN = randomBytes(3).toString("hex");
const FOLDER = `day6-test-video-${RUN}`;
const SLUG = `day6-test-video-${RUN}`;
const NOW = new Date();

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

/** The PanelError `fn` throws (asserted), for its message and field errors. */
async function panelError(fn: () => Promise<unknown>): Promise<PanelError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof PanelError) return error;
    throw error;
  }
  assert.fail("expected a PanelError");
}

type Seq = { last_value: string; is_called: boolean };
const SEQUENCES = ["media_id_seq", "products_id_seq", "product_variants_id_seq", "product_media_id_seq", "pages_id_seq", "page_sections_id_seq"] as const;
const SNAPSHOT_TABLES = ["media", "products", "product_variants", "product_media", "pages", "page_sections"] as const;
const seqBefore = new Map<string, Seq>();
const tablesBefore = new Map<string, string>();
const readSeq = async (name: string): Promise<Seq> => {
  const [row] = await db.execute<Seq>(sql.raw(`select last_value::text, is_called from ${name}`));
  return { last_value: row.last_value, is_called: row.is_called };
};
const tableHash = async (table: string): Promise<string> => {
  const [row] = await db.execute<{ h: string }>(sql.raw(`select count(*)::text || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from "${table}" t`));
  return row.h;
};

before(async () => {
  for (const name of SEQUENCES) seqBefore.set(name, await readSeq(name));
  for (const t of SNAPSHOT_TABLES) tablesBefore.set(t, await tableHash(t));
  const [left] = await db.execute<{ n: string }>(sql`select (select count(*) from media where folder like 'day6-test-video-%') + (select count(*) from products where slug like 'day6-test-video-%') as n`);
  assert.equal(Number(left.n), 0, "no leftovers from an earlier run");
});

after(async () => {
  try {
    for (const name of SEQUENCES) {
      const seq = seqBefore.get(name)!;
      const table = name.replace(/_id_seq$/, "");
      const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${table}`));
      // Someone else may have inserted meanwhile (a parallel agent): then the sequence is theirs to keep.
      if (max === null || Number(max) <= Number(seq.last_value)) {
        await db.execute(sql`select setval(${name}::regclass, ${seq.last_value}::bigint, ${seq.is_called})`);
        assert.deepEqual(await readSeq(name), seq, `${name} restored`);
      }
    }
    for (const t of SNAPSHOT_TABLES) assert.equal(await tableHash(t), tablesBefore.get(t), `${t} unchanged`);
  } finally {
    await db.$client.end();
  }
});

// ---------------------------------------------------------------------------------------------------
// Fixtures (inside the rolled-back transaction)

type Ids = {
  productId: number;
  variantId: number;
  cover: number;
  photo: number;
  video: number;
  videoNoCover: number;
  extraVideos: number[];
};

async function insertMedia(tx: Tx, name: string, opts: { video?: boolean; posterId?: number | null; alt?: LocalizedText | null } = {}): Promise<number> {
  const video = opts.video === true;
  const key = `${FOLDER}/${name}${video ? ".mp4" : "-1200.webp"}`;
  const [row] = await tx
    .insert(schema.media)
    .values({
      storageKey: key,
      url: `/uploads/${key}`,
      mime: video ? "video/mp4" : "image/webp",
      kind: video ? "video" : "image",
      width: 1200,
      height: 1500,
      bytes: 1000,
      alt: opts.alt ?? null,
      variants: video ? null : [{ width: 1200, height: 1500, format: "webp", key, bytes: 1000 }],
      folder: FOLDER,
      durationMs: video ? 42_000 : null,
      posterId: opts.posterId ?? null,
    })
    .returning({ id: schema.media.id });
  return row.id;
}

/**
 * An active standard product whose gallery starts with a video (written straight to the table, which the
 * save would refuse), then an image, a video without a cover, and the cover image itself.
 */
async function fixture(tx: Tx): Promise<Ids> {
  const cover = await insertMedia(tx, "cover", { alt: { tr: "Kapak" } });
  const photo = await insertMedia(tx, "photo", { alt: { tr: "Ürün fotoğrafı" } });
  const video = await insertMedia(tx, "clip", { video: true, posterId: cover, alt: { tr: "Köpük yakından", en: "Lather close up" } });
  const videoNoCover = await insertMedia(tx, "clip-bare", { video: true });
  const extraVideos = [
    await insertMedia(tx, "clip-2", { video: true, posterId: cover }),
    await insertMedia(tx, "clip-3", { video: true, posterId: cover }),
    await insertMedia(tx, "clip-4", { video: true, posterId: cover }),
  ];
  const [product] = await tx
    .insert(schema.products)
    .values({ slug: SLUG, type: "standard", status: "active", name: { tr: "Day6 Video Ürünü", en: "Day6 Video Product" }, subtitle: { tr: "Sıvı El Sabunu" }, shortDescription: { tr: "Kısa tanım." }, position: 9999 })
    .returning({ id: schema.products.id });
  const [variant] = await tx
    .insert(schema.productVariants)
    .values({ productId: product.id, sku: `DAY6TEST-${RUN}-1`.toUpperCase(), price: 10_000, stock: 10, isDefault: true, isActive: true, position: 0, minQuantity: 1, lowStockThreshold: 5 })
    .returning({ id: schema.productVariants.id });
  await tx.insert(schema.productMedia).values([
    { productId: product.id, mediaId: video, role: "gallery", position: 0, autoplay: true },
    { productId: product.id, mediaId: photo, role: "gallery", position: 1 },
    { productId: product.id, mediaId: videoNoCover, role: "gallery", position: 2 },
    { productId: product.id, mediaId: cover, role: "lifestyle", position: 3 },
  ]);
  return { productId: product.id, variantId: variant.id, cover, photo, video, videoNoCover, extraVideos };
}

// ---------------------------------------------------------------------------------------------------

describe("image consumers skip product videos", () => {
  test("storefront: card images, the product page gallery and the cart/order image", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);

      const images = await loadProductMedia([ids.productId], tx);
      assert.deepEqual(
        images.map((m) => m.media.id),
        [ids.photo, ids.cover],
        "card/hover pool: images only",
      );

      const [card] = await queryCards({ categorySlug: null, featured: false, includeTypes: ["standard"], ids: [ids.productId] }, tx);
      assert.ok(card);
      assert.equal(card.image?.id, ids.photo, "the card image is the first gallery image, not the video in row 0");
      assert.equal(card.hoverImage?.id, ids.cover, "the hover image is the lifestyle image");

      const gallery = await loadProductGallery(ids.productId, tx);
      assert.deepEqual(
        gallery.media.map((m) => m.media.id),
        [ids.photo, ids.cover],
      );
      assert.equal(gallery.videos.length, 1, "the video without a cover is left out");
      const [clip] = gallery.videos;
      assert.equal(clip.id, ids.video);
      assert.equal(clip.slot, 0);
      assert.equal(clip.autoplay, true);
      assert.equal(clip.mime, "video/mp4");
      assert.equal(clip.durationMs, 42_000);
      assert.equal(clip.poster.id, ids.cover);
      assert.deepEqual(clip.alt, { tr: "Köpük yakından", en: "Lather close up" });
      assert.match(clip.uploadedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);

      const [line] = await loadVariantLines(tx, [{ variantId: ids.variantId, quantity: 1 }], RETAIL_CUSTOMER);
      assert.equal(line.display.image?.id, ids.photo, "cart thumbnail (and so the order snapshot): the first image");
    });
  });

  test("forms, request mails, panel thumbnails, image sitemap and SEO Kontrol", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);

      const offered = (await loadRequestCatalog(tx)).find((p) => p.id === ids.productId);
      assert.equal(offered?.image?.id, ids.photo, "sample/quote form thumbnail");
      const display = await loadRequestDisplay(tx, { productIds: [ids.productId] });
      assert.equal(display.products.get(ids.productId)?.image?.id, ids.photo, "request mail image");

      const thumbs = await firstMediaByProduct(tx, [ids.productId]);
      assert.equal(thumbs.get(ids.productId)?.id, ids.photo, "panel list / pickers: the first image");

      const sitemap = await querySitemapData(tx, NOW);
      const entry = sitemap.products.find((p) => p.slug === SLUG);
      assert.ok(entry);
      assert.deepEqual(entry.images, [`/uploads/${FOLDER}/photo-1200.webp`, `/uploads/${FOLDER}/cover-1200.webp`]);
      assert.equal(entry.videos?.length, 1);
      const [v] = entry.videos ?? [];
      assert.equal(v.content, `/uploads/${FOLDER}/clip.mp4`);
      assert.equal(v.thumbnail, `/uploads/${FOLDER}/cover-1200.webp`);
      assert.equal(v.durationMs, 42_000);
      assert.deepEqual(v.title, { tr: "Köpük yakından", en: "Lather close up", ar: "فيديو: Day6 Video Ürünü — Sıvı El Sabunu" });
      assert.deepEqual(v.description, { tr: "Kısa tanım.", en: "Kısa tanım.", ar: "Kısa tanım." });

      const source = await loadSeoSource(tx, NOW);
      const seoProduct = source.products.find((p) => p.id === ids.productId);
      assert.deepEqual(seoProduct?.mediaIds, [ids.photo, ids.cover], "SEO Kontrol counts images only");
      assert.equal(Object.hasOwn(source.mediaAlt, ids.video), false, "a video is not an image without alt text");
      assert.equal(Object.hasOwn(source.mediaAlt, ids.photo), true);
    });
  });

  test("section video reader: video rows with their cover; images and missing ids give null", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      const found = await queryVideoMedia(ids.video, tx);
      assert.equal(found?.video.id, ids.video);
      assert.equal(found?.video.mime, "video/mp4");
      assert.equal(found?.poster?.id, ids.cover);
      assert.equal((await queryVideoMedia(ids.videoNoCover, tx))?.poster, null);
      assert.equal(await queryVideoMedia(ids.photo, tx), null, "an image id is not a video");
      assert.equal(await queryVideoMedia(2_000_000_000, tx), null);
    });
  });
});

describe("product save: kind rules and autoplay", () => {
  const row = (mediaId: number, extra: Partial<ProductMediaState> = {}): ProductMediaState => ({ key: newKey(), id: null, mediaId, role: "gallery", variantKey: null, autoplay: false, ...extra });
  async function stateOf(tx: Tx, id: number): Promise<ProductEditorState> {
    const s = await loadProductState(tx, id);
    assert.ok(s);
    return s;
  }
  const save = (tx: Tx, payload: ProductEditorState) => saveProduct(tx, productSaveSchema.parse(payload));

  test("the stored state shows autoplay; a video in the first row is refused", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      const s = await stateOf(tx, ids.productId);
      assert.deepEqual(
        s.media.map((m) => [m.mediaId, m.autoplay]),
        [
          [ids.video, true],
          [ids.photo, false],
          [ids.videoNoCover, false],
          [ids.cover, false],
        ],
      );
      const error = await panelError(() => save(tx, { ...s, media: s.media.filter((m) => m.mediaId !== ids.videoNoCover) }));
      assert.equal(error.code, "invalid");
      assert.deepEqual(error.fieldErrors, { "media.0.mediaId": PRODUCT_MEDIA_MESSAGES.firstIsVideo });
      assert.equal(error.message, PRODUCT_MEDIA_MESSAGES.firstIsVideo);
    });
  });

  test("a video without a cover and a fourth video are refused; no video as variant image, swatch or share image", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      const s = await stateOf(tx, ids.productId);
      const byMedia = new Map(s.media.map((m) => [m.mediaId, m]));
      const ordered = [byMedia.get(ids.photo)!, byMedia.get(ids.video)!, byMedia.get(ids.videoNoCover)!, byMedia.get(ids.cover)!];
      const bare = await panelError(() => save(tx, { ...s, media: ordered }));
      assert.deepEqual(bare.fieldErrors, { "media.2.mediaId": PRODUCT_MEDIA_MESSAGES.videoWithoutPoster });

      const four = [byMedia.get(ids.photo)!, byMedia.get(ids.video)!, ...ids.extraVideos.map((id) => row(id))];
      const tooMany = await panelError(() => save(tx, { ...s, media: four }));
      assert.deepEqual(tooMany.fieldErrors, { media: PRODUCT_MEDIA_MESSAGES.tooManyVideos });

      const okMedia = [byMedia.get(ids.photo)!, byMedia.get(ids.video)!];
      const valueKey = newKey();
      const elsewhere = await panelError(() =>
        save(tx, {
          ...s,
          media: okMedia,
          seo: { ...s.seo, ogImageId: ids.video },
          variants: s.variants.map((v) => ({ ...v, imageId: ids.video, optionValueKeys: [valueKey] })),
          options: [{ key: newKey(), id: null, name: { tr: "Koku" }, display: "swatches", values: [{ key: valueKey, id: null, value: { tr: "Lavanta" }, swatchColor: "", swatchMediaId: ids.video }] }],
        }),
      );
      assert.equal(elsewhere.fieldErrors?.["seo.ogImageId"], PRODUCT_MEDIA_MESSAGES.shareImageIsVideo);
      assert.equal(elsewhere.fieldErrors?.["variants.0.imageId"], PRODUCT_MEDIA_MESSAGES.variantImageIsVideo);
      assert.equal(elsewhere.fieldErrors?.["options.0.values.0.swatchMediaId"], PRODUCT_MEDIA_MESSAGES.swatchIsVideo);
      assert.match(elsewhere.message, /3 sorun var/);
    });
  });

  test("autoplay is saved, toggled on its own, forced off for images; a video's role is gallery; duplicate copies it", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      let s = await stateOf(tx, ids.productId);
      const byMedia = new Map(s.media.map((m) => [m.mediaId, m]));
      // Valid order; the image asks for autoplay (ignored), the video asks for a card role (ignored).
      const first = await save(tx, {
        ...s,
        media: [{ ...byMedia.get(ids.photo)!, autoplay: true, role: "packshot" }, { ...byMedia.get(ids.video)!, autoplay: false, role: "lifestyle" }, byMedia.get(ids.cover)!],
      });
      assert.deepEqual(
        first.state.media.map((m) => [m.mediaId, m.role, m.autoplay]),
        [
          [ids.photo, "packshot", false],
          [ids.video, "gallery", false],
          [ids.cover, "lifestyle", false],
        ],
      );

      // Only autoplay changes: the row is still updated.
      s = await stateOf(tx, ids.productId);
      const toggled = await save(tx, { ...s, media: s.media.map((m) => (m.mediaId === ids.video ? { ...m, autoplay: true } : m)) });
      assert.equal(toggled.state.media.find((m) => m.mediaId === ids.video)?.autoplay, true);
      const [stored] = await tx.select({ autoplay: schema.productMedia.autoplay }).from(schema.productMedia).where(eq(schema.productMedia.mediaId, ids.video));
      assert.equal(stored.autoplay, true);
      assert.ok(JSON.stringify(toggled.audit).includes('"autoplay":true'), "the audit shows the switch");

      const copy = await duplicateProduct(tx, ids.productId);
      const copied = await tx
        .select({ mediaId: schema.productMedia.mediaId, autoplay: schema.productMedia.autoplay, role: schema.productMedia.role })
        .from(schema.productMedia)
        .where(eq(schema.productMedia.productId, copy.id))
        .orderBy(asc(schema.productMedia.position));
      assert.deepEqual(
        copied.map((m) => [m.mediaId, m.autoplay]),
        [
          [ids.photo, false],
          [ids.video, true],
          [ids.cover, false],
        ],
      );
    });
  });
});

describe("page save: media kinds per field", () => {
  test("a video field refuses an image, an image field refuses a video, the right kinds save", async () => {
    await inRollback(async (tx) => {
      const ids = await fixture(tx);
      const { id } = await createPage(tx, { title: { tr: "Day6 video test" }, slug: `${SLUG}-sayfa` });
      const data = await getPageEditorData(id, tx);
      assert.ok(data);
      const section = (type: string, content: Record<string, unknown>) => ({ id: null, type, isVisible: true, audience: "all", schedule: { startsAt: null, endsAt: null }, content });
      const payload = (sections: ReturnType<typeof section>[]) => pageSaveSchema.parse({ ...data.page, sections });

      const wrong = await panelError(() =>
        savePage(
          tx,
          payload([
            section("video", { videoMediaId: ids.photo, layout: "wide", playback: "click_to_play" }),
            section("hero", { headline: { tr: "Merhaba" }, imageId: ids.video, videoMediaId: ids.photo, overlay: 35, align: "start", height: "full", layout: "split" }),
          ]),
        ),
      );
      assert.deepEqual(wrong.fieldErrors, {
        "sections.0.content.videoMediaId": MEDIA_KIND_MESSAGES.video,
        "sections.1.content.imageId": MEDIA_KIND_MESSAGES.image,
        "sections.1.content.videoMediaId": MEDIA_KIND_MESSAGES.video,
      });
      assert.equal(wrong.message, "3 alanda seçilen dosyanın türü uymuyor.");

      const share = await panelError(() => savePage(tx, { ...payload([]), seo: { ...payload([]).seo, ogImageId: ids.video } }));
      assert.deepEqual(share.fieldErrors, { "seo.ogImageId": MEDIA_KIND_MESSAGES.image });

      const { result } = await savePage(
        tx,
        payload([
          section("video", { title: { tr: "Yakından" }, videoMediaId: ids.video, posterImageId: ids.photo, layout: "split", playback: "autoplay_muted" }),
          section("hero", { headline: { tr: "Merhaba" }, imageId: ids.photo, videoMediaId: ids.video, overlay: 35, align: "start", height: "full", layout: "split" }),
        ]),
      );
      assert.equal(result.sections.length, 2);
      assert.equal(result.sections[0].content.videoMediaId, ids.video);
      assert.equal(result.sections[1].content.videoMediaId, ids.video);
    });
  });

  test("a video section without a video is refused by the panel rules", async () => {
    await inRollback(async (tx) => {
      const { id } = await createPage(tx, { title: { tr: "Day6 video test" }, slug: `${SLUG}-bos` });
      const data = await getPageEditorData(id, tx);
      assert.ok(data);
      const parsed = pageSaveSchema.safeParse({ ...data.page, sections: [{ id: null, type: "video", isVisible: true, audience: "all", schedule: { startsAt: null, endsAt: null }, content: { layout: "wide" } }] });
      assert.equal(parsed.success, false);
      assert.ok(parsed.error?.issues.some((i) => i.path.join(".") === "sections.0.content.videoMediaId"), JSON.stringify(parsed.error?.issues));
    });
  });
});

