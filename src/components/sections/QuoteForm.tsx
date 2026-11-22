// The quote request section (anchor #teklif): editorial intro and "what happens next" points on one
// side, the form card on the other. Products come from a cached catalog read, so the page stays static;
// the form itself (lines, prefill for signed-in visitors) is a client island.
import { localize } from "@/i18n/localize";
import { getRequestCatalog, pickCatalogProducts } from "@/lib/requests/catalog";
import QuoteFormClient, { type QuoteProductOption } from "./QuoteFormClient";
import { resolveLink } from "./links";
import type { QuoteFormContent } from "./schemas";
import { PointList } from "./request-form-ui";
import { GoldRule, Paragraphs, type SectionProps } from "./ui";

export default async function QuoteForm({ content, locale, messages }: SectionProps<QuoteFormContent>) {
  const catalog = pickCatalogProducts(await getRequestCatalog(), content.productIds);
  const products: QuoteProductOption[] = catalog.map((p) => ({
    id: p.id,
    name: localize(p.name, locale),
    accent: p.accentColor,
    variants: p.variants.map((v) => ({ id: v.id, label: v.labels.map((l) => localize(l, locale)).filter(Boolean).join(" · ") })),
  }));
  const eyebrow = localize(content.eyebrow, locale);
  const m = messages.requests;
  const points = content.points.map((p) => localize(p, locale)).filter(Boolean);

  return (
    <section id="teklif" className="scroll-mt-28 py-16 md:py-24">
      <div className="container-x grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5 lg:pt-4">
          <div className="lg:sticky lg:top-28">
            {eyebrow && <p className="eyebrow mb-5">{eyebrow}</p>}
            <h2 className="font-heading text-4xl leading-[1.05] tracking-tight text-balance text-text md:text-5xl">{localize(content.title, locale)}</h2>
            <GoldRule className="my-8" />
            {content.intro && (
              <div className="max-w-md space-y-4 text-base leading-relaxed text-pretty text-text-muted md:text-lg">
                <Paragraphs text={content.intro} locale={locale} />
              </div>
            )}
            <PointList points={points} />
          </div>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <div className="rounded-md border border-border bg-surface p-5 shadow-[0_24px_60px_-40px_rgb(3_38_95/0.35)] sm:p-10">
            <QuoteFormClient
              locale={locale}
              labels={m}
              optionalLabel={messages.common.optional}
              products={products}
              allowCustomLines={content.allowCustomLines}
              successTitle={localize(content.successTitle, locale) || m.quote.successTitle}
              successText={localize(content.successText, locale) || m.quote.success}
              privacyHref={resolveLink(locale, content.privacyHref || "/sayfa/kvkk")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
