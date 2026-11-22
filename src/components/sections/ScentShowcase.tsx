// Server half of the scent showcase: resolves products, images and per-product color scopes, then
// hands plain serializable data to the interactive client component.
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import { listProducts } from "@/lib/data/catalog";
import { getMediaByIds } from "@/lib/data/media";
import { productScopeStyle } from "@/lib/theme/engine";
import ScentShowcaseClient, { type ScentItem } from "./ScentShowcaseClient";
import type { ScentShowcaseContent } from "./schemas";
import { ids, SectionHeading, type SectionProps } from "./ui";

const FALLBACK_ACCENT = "#DDA82A";

export default async function ScentShowcase({ content, locale }: SectionProps<ScentShowcaseContent>) {
  const productIds = ids(...content.items.map((i) => i.productId));
  if (productIds.length === 0) return null;
  const [products, media] = await Promise.all([
    listProducts({ ids: productIds, includeTypes: ["standard", "bundle"] }),
    getMediaByIds(ids(...content.items.map((i) => i.imageId))),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));

  const items: ScentItem[] = content.items.flatMap((item) => {
    const product = item.productId ? byId.get(item.productId) : undefined;
    if (!product) return [];
    const image = (item.imageId ? media[item.imageId] : undefined) ?? product.image;
    const accent = product.accentColor ?? FALLBACK_ACCENT;
    const name = localize(product.name, locale);
    return [
      {
        id: product.id,
        name,
        subtitle: localize(product.subtitle, locale),
        tagline: localize(item.tagline, locale),
        description: localize(product.shortDescription, locale),
        href: href(locale, "product", { slug: product.slug }),
        accent,
        scopeStyle: productScopeStyle(accent),
        image: image ?? null,
        imageAlt: image ? localize(image.alt, locale) || name : name,
      },
    ];
  });
  if (items.length === 0) return null;

  return (
    <ScentShowcaseClient
      items={items}
      label={localize(content.title, locale)}
      ctaLabel={localize(content.ctaLabel, locale)}
      locale={locale}
      heading={
        <SectionHeading eyebrow={content.eyebrow} title={content.title} intro={content.intro} locale={locale} align="center" />
      }
    />
  );
}
