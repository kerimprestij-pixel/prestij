// STORE-UI (day 5): the product page's heading ("Lavanta Sıvı El Sabunu" as one <h1>), the image alt
// fallbacks (name + type + size) and the `?varyant=` preselection / address update of the variant island.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { productGalleryImages, productHeading, productImageAlt } from "@/components/store/product-heading";
import { addressWithVariant, resolveSelectedVariant, useVariantSelection, VariantProvider } from "@/components/store/VariantContext";
import type { ProductDetail } from "@/lib/data/catalog";
import type { MediaLike } from "@/lib/media/types";

const t = (tr: string, en?: string, ar?: string) => ({ tr, ...(en ? { en } : {}), ...(ar ? { ar } : {}) });

function media(id: number, alt: ReturnType<typeof t> | null): MediaLike {
  return { id, url: `/media/x-${id}.webp`, width: 1200, height: 1500, alt, blurDataUrl: null, dominantColor: null, variants: null };
}

type Source = Parameters<typeof productGalleryImages>[0];

function product(overrides: Partial<Source> = {}): Source {
  return {
    name: t("Lavanta", "Lavender", "اللافندر"),
    subtitle: t("Sıvı El Sabunu", "Liquid Hand Soap", "صابون سائل لليدين"),
    category: { id: 1, slug: "el-sabunu", name: t("El Sabunu", "Hand Soap", "صابون اليدين") },
    options: [
      {
        id: 1,
        name: t("Ambalaj"),
        display: "buttons",
        values: [
          { id: 10, value: t("Pompalı Şişe", "Pump Bottle", "زجاجة بمضخة"), swatchColor: null, swatchMediaId: null },
          { id: 11, value: t("5 L Bidon", "5 L Canister", "عبوة 5 لترات"), swatchColor: null, swatchMediaId: null },
        ],
      },
    ],
    variants: [{ id: 4, optionValueIds: [10] }, { id: 5, optionValueIds: [11] }] as ProductDetail["variants"],
    media: [],
    ...overrides,
  };
}

describe("productHeading", () => {
  test("name + type read as one heading; the category eyebrow is dropped (it would repeat the type)", () => {
    assert.deepEqual(productHeading(product(), "tr"), { name: "Lavanta", type: "Sıvı El Sabunu", eyebrow: "", text: "Lavanta Sıvı El Sabunu" });
    assert.equal(productHeading(product(), "en").text, "Lavender Liquid Hand Soap");
    assert.equal(productHeading(product(), "ar").text, "اللافندر صابون سائل لليدين");
  });

  test("a missing translation falls back to Turkish like the rest of the page", () => {
    const p = product({ subtitle: t("Duş Jeli"), name: t("Okyanus", "Ocean") });
    assert.equal(productHeading(p, "en").text, "Ocean Duş Jeli");
  });

  test("without a type the category stays as the eyebrow and the heading is the name alone", () => {
    const h = productHeading(product({ subtitle: null }), "tr");
    assert.deepEqual(h, { name: "Lavanta", type: "", eyebrow: "El Sabunu", text: "Lavanta" });
    assert.equal(productHeading(product({ subtitle: null, category: null }), "tr").eyebrow, "");
  });

  test("a name that already contains the type does not repeat it (Turkish casing: İ/ı)", () => {
    const p = product({ name: t("Lavanta SIVI EL SABUNU"), subtitle: t("sıvı el sabunu") });
    assert.deepEqual(productHeading(p, "tr"), { name: "Lavanta SIVI EL SABUNU", type: "", eyebrow: "El Sabunu", text: "Lavanta SIVI EL SABUNU" });
    const bundle = product({ name: t("Dört Koku Koleksiyonu"), subtitle: t("4 × 5 L Bidon Seti"), category: null });
    assert.equal(productHeading(bundle, "tr").text, "Dört Koku Koleksiyonu 4 × 5 L Bidon Seti");
  });
});

describe("image alt fallbacks", () => {
  test("productImageAlt: heading, size after a comma (Arabic comma on /ar)", () => {
    assert.equal(productImageAlt("Lavanta Sıvı El Sabunu", "5 L Bidon", "tr"), "Lavanta Sıvı El Sabunu, 5 L Bidon");
    assert.equal(productImageAlt("اللافندر صابون سائل لليدين", "عبوة 5 لترات", "ar"), "اللافندر صابون سائل لليدين، عبوة 5 لترات");
    assert.equal(productImageAlt("Lavanta Sıvı El Sabunu", "", "tr"), "Lavanta Sıvı El Sabunu");
    assert.equal(productImageAlt("Lavanta Sıvı El Sabunu", null, "en"), "Lavanta Sıvı El Sabunu");
  });

  test("the image's own alt in the visitor's language wins; otherwise name + type + the image's variant size", () => {
    const p = product({
      media: [
        { media: media(1, t("PRESTİJ Lavanta, mermer banyoda", "PRESTİJ Lavender, marble bathroom")), variantId: 4, role: "gallery" },
        { media: media(2, null), variantId: 5, role: "gallery" },
        { media: media(3, null), variantId: null, role: "gallery" },
        // Turkish-only alt: on /en the English fallback is used instead of a Turkish text.
        { media: media(4, t("PRESTİJ Lavanta, 5 litre")), variantId: 5, role: "gallery" },
      ] as ProductDetail["media"],
    });
    const tr = productGalleryImages(p, "tr");
    assert.deepEqual(
      tr.map((i) => i.alt),
      ["PRESTİJ Lavanta, mermer banyoda", "Lavanta Sıvı El Sabunu, 5 L Bidon", "Lavanta Sıvı El Sabunu", "PRESTİJ Lavanta, 5 litre"],
    );
    assert.deepEqual(
      productGalleryImages(p, "en").map((i) => i.alt),
      ["PRESTİJ Lavender, marble bathroom", "Lavender Liquid Hand Soap, 5 L Canister", "Lavender Liquid Hand Soap", "Lavender Liquid Hand Soap, 5 L Canister"],
    );
    assert.deepEqual(
      tr.map((i) => [i.media.id, i.variantId]),
      [
        [1, 4],
        [2, 5],
        [3, null],
        [4, 5],
      ],
    );
  });

  test("an image tied to an unknown variant gets the heading alone", () => {
    const p = product({ media: [{ media: media(9, null), variantId: 99, role: "gallery" }] as ProductDetail["media"] });
    assert.equal(productGalleryImages(p, "tr")[0].alt, "Lavanta Sıvı El Sabunu");
  });
});

describe("?varyant= preselection", () => {
  test("the visitor's choice wins, then a valid link, then the default", () => {
    assert.equal(resolveSelectedVariant(null, null, [4, 5, 6], 4), 4);
    assert.equal(resolveSelectedVariant(null, 6, [4, 5, 6], 4), 6);
    assert.equal(resolveSelectedVariant(null, 99, [4, 5, 6], 4), 4, "another product's variant is ignored");
    assert.equal(resolveSelectedVariant(5, 6, [4, 5, 6], 4), 5);
    assert.equal(resolveSelectedVariant(null, null, [], null), null);
  });

  test("the address keeps its path, other parameters and hash; unchanged → null", () => {
    assert.equal(addressWithVariant("https://prestij.com.tr/tr/urunler/lavanta", 5), "/tr/urunler/lavanta?varyant=5");
    assert.equal(
      addressWithVariant("https://prestij.com.tr/en/products/lavanta?utm_source=x&varyant=4#satin-al", 6),
      "/en/products/lavanta?utm_source=x&varyant=6#satin-al",
    );
    assert.equal(addressWithVariant("https://prestij.com.tr/ar/products/lavanta?varyant=6", 6), null);
  });

  test("the server render always shows the default variant (the static HTML is the same for every link)", () => {
    function Probe() {
      return createElement("output", null, String(useVariantSelection().selectedId));
    }
    const props = { defaultVariantId: 4, variantIds: [4, 5, 6] } as ComponentProps<typeof VariantProvider>;
    const html = renderToStaticMarkup(createElement(VariantProvider, props, createElement(Probe)));
    assert.equal(html, "<output>4</output>");
  });
});
