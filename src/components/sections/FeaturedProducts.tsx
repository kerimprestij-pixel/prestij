import ProductGrid from "@/components/store/ProductGrid";
import { listProducts } from "@/lib/data/catalog";
import type { FeaturedProductsContent } from "./schemas";
import { CtaLink, SectionHeading, type SectionProps } from "./ui";

export default async function FeaturedProducts({ content, locale, messages }: SectionProps<FeaturedProductsContent>) {
  const explicit = content.productIds.length > 0;
  const all = await listProducts(explicit ? { ids: content.productIds } : {});
  const order = new Map(content.productIds.map((id, i) => [id, i]));
  const products = (explicit ? [...all].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : all).slice(
    0,
    content.limit,
  );
  if (products.length === 0) return null;

  return (
    <section className="py-20 md:py-28">
      <div className="container-x">
        <div className="mb-12 flex flex-col gap-8 md:mb-16 md:flex-row md:items-end md:justify-between">
          <SectionHeading eyebrow={content.eyebrow} title={content.title} intro={content.intro} locale={locale} />
          {content.viewAllCta && <CtaLink cta={content.viewAllCta} locale={locale} variant="link" className="shrink-0" />}
        </div>
        <ProductGrid products={products} locale={locale} fromLabel={messages.product.from} regularPriceLabel={messages.campaign.regularPrice} columns={content.columns} />
      </div>
    </section>
  );
}
