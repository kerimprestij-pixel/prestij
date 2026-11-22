// Product page texts shared by the <h1>, the image alts and the metadata fallbacks: "Lavanta" +
// "Sıvı El Sabunu" read as one heading, "Lavanta Sıvı El Sabunu" (in Arabic as one noun phrase,
// productPhrase). Pure (unit-tested).
import type { LocalizedText } from "@/db/schema/common";
import { intlLocale, type Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import type { ProductDetail } from "@/lib/data/catalog";
import { ownLocaleText } from "@/lib/seo/localized";
import type { GalleryImage } from "./ProductGallery";

export type ProductHeading = {
  /** The product name, the heading's first (large) line. */
  name: string;
  /** The product type ("Sıvı El Sabunu"), its second (small) line; "" when none or already in the name. */
  type: string;
  /** Category label above the heading: only when there is no type line (it would repeat it). */
  eyebrow: string;
  /** The whole heading as one line: "Lavanta Sıvı El Sabunu". */
  text: string;
};

type HeadingSource = Pick<ProductDetail, "name" | "subtitle" | "category">;

export function productHeading(product: HeadingSource, locale: Locale): ProductHeading {
  const name = localize(product.name, locale);
  const subtitle = localize(product.subtitle, locale);
  const lower = (s: string) => s.toLocaleLowerCase(intlLocale(locale));
  // A name that already says what it is ("Lavanta Sıvı El Sabunu") does not repeat the type.
  const type = subtitle && !lower(name).includes(lower(subtitle)) ? subtitle : "";
  const category = product.category ? localize(product.category.name, locale) : "";
  return {
    name,
    type,
    eyebrow: type ? "" : category,
    text: [name, type].filter(Boolean).join(" "),
  };
}

type PhraseSource = Pick<ProductDetail, "name" | "subtitle"> & {
  /** The product's SEO title (product editor); its part before " — " names the product in full. */
  seoTitle?: LocalizedText | null;
};

/**
 * The product as one noun phrase, for image alts and share texts. Turkish and English put the type after
 * the name, so it is the heading as one line: "Lavanta Sıvı El Sabunu", "Lavender Liquid Hand Soap".
 * Arabic puts the head noun first and takes the name into it (idafa): "صابون اللافندر السائل لليدين".
 * There name + type reads as a sentence ("اللافندر صابون سائل لليدين", "lavender is liquid hand soap"), and
 * the idafa cannot be built from the two fields. So Arabic uses the phrase the product's own Arabic SEO
 * title starts with (the text before its first " — "), when that phrase contains the name and says more
 * than the name. Otherwise it uses "name — type", the label form of the structured data.
 */
export function productPhrase(product: PhraseSource, locale: Locale): string {
  const heading = productHeading({ ...product, category: null }, locale);
  if (locale !== "ar") return heading.text;
  const stem = titleStem(ownLocaleText(product.seoTitle, locale));
  if (stem && stem !== heading.name && stem.includes(heading.name)) return stem;
  return [heading.name, heading.type].filter(Boolean).join(" — ");
}

/** "صابون اللافندر السائل لليدين — زجاجة بمضخة…" → "صابون اللافندر السائل لليدين"; a title without a separator stays whole. */
function titleStem(title: string): string {
  return title.split(/\s[—–|-]\s/u)[0].trim();
}

/**
 * Product card image alt: the product phrase ("Lavanta Sıvı El Sabunu", "صابون اللافندر السائل لليدين"),
 * so image search knows what the photo shows. The card hides the image from screen readers, because
 * its link already reads the type and the name.
 */
export function productCardImageAlt(product: PhraseSource, locale: Locale): string {
  return productPhrase(product, locale);
}

/** "Lavanta Sıvı El Sabunu, 5 L Bidon" (Arabic comma on /ar); the phrase alone without a size. */
export function productImageAlt(heading: string, size: string | null | undefined, locale: Locale): string {
  return size ? `${heading}${locale === "ar" ? "، " : ", "}${size}` : heading;
}

type GallerySource = HeadingSource & Pick<ProductDetail, "media" | "variants" | "options"> & Partial<Pick<ProductDetail, "seo" | "videos">>;

/**
 * Gallery items with their alt text: the item's own alt in the visitor's language, else the product
 * phrase plus the size of the variant the item belongs to (its option labels, e.g. "5 L Bidon").
 * Day 6: the product's videos are placed at their `slot` among the images (the owner's order); a video
 * item shows its cover image (`media`) and carries the file in `video`. Its alt is the video's own
 * description, with the same fallback (the thumbnail adds "Video" for screen readers).
 */
export function productGalleryImages(product: GallerySource, locale: Locale): GalleryImage[] {
  const phrase = productPhrase({ ...product, seoTitle: product.seo?.title }, locale);
  const sizeOf = (variantId: number | null): string => {
    const variant = variantId == null ? undefined : product.variants.find((v) => v.id === variantId);
    if (!variant) return "";
    // Option order, as the variant picker lists them.
    return product.options
      .map((o) => o.values.find((v) => variant.optionValueIds.includes(v.id)))
      .map((v) => (v ? localize(v.value, locale) : ""))
      .filter(Boolean)
      .join(" · ");
  };
  const images: GalleryImage[] = product.media.map((m) => ({
    media: m.media,
    variantId: m.variantId,
    alt: ownLocaleText(m.media.alt, locale) || productImageAlt(phrase, sizeOf(m.variantId), locale),
  }));
  const videos = [...(product.videos ?? [])].sort((a, b) => a.slot - b.slot);
  if (videos.length === 0) return images;

  const out: GalleryImage[] = [];
  let next = 0;
  for (const v of videos) {
    while (out.length < v.slot && next < images.length) out.push(images[next++]);
    out.push({
      media: v.poster,
      variantId: v.variantId,
      alt: ownLocaleText(v.alt, locale) || productImageAlt(phrase, sizeOf(v.variantId), locale),
      video: { id: v.id, src: v.url, mime: v.mime, durationMs: v.durationMs, autoplay: v.autoplay },
    });
  }
  while (next < images.length) out.push(images[next++]);
  return out;
}
