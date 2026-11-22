// The free sample request section (anchor #numune-formu). Scents come from a cached catalog read and
// the on/off switch from cached settings (Ayarlar → Numune → numune talep formu), so the page stays
// static. While the form is switched off, a calm note with a link to the contact page is shown.
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { href } from "@/i18n/paths";
import { localize } from "@/i18n/localize";
import { getRequestCatalog, pickCatalogProducts } from "@/lib/requests/catalog";
import { getSettings } from "@/lib/settings/get-settings";
import { TR_PROVINCES } from "@/lib/validation/tr";
import SampleRequestFormClient, { type SampleProductOption } from "./SampleRequestFormClient";
import { buttonClass } from "./button-styles";
import { resolveLink } from "./links";
import type { SampleRequestFormContent } from "./schemas";
import { PointList } from "./request-form-ui";
import { GoldRule, Paragraphs, type SectionProps } from "./ui";

const PROVINCES = [...TR_PROVINCES].map((p) => p.name).sort((a, b) => a.localeCompare(b, "tr"));

export default async function SampleRequestForm({ content, locale, messages }: SectionProps<SampleRequestFormContent>) {
  const [catalog, samples] = await Promise.all([getRequestCatalog(), getSettings("samples")]);
  const scents = pickCatalogProducts(
    catalog.filter((p) => p.type === "standard"),
    content.productIds,
  );
  const products: SampleProductOption[] = scents.map((p) => ({
    id: p.id,
    name: localize(p.name, locale),
    subtitle: localize(p.subtitle, locale) || null,
    accent: p.accentColor,
    image: p.image,
  }));
  const eyebrow = localize(content.eyebrow, locale);
  const m = messages.requests;
  const points = content.points.map((p) => localize(p, locale)).filter(Boolean);
  const open = samples.requestFormEnabled && products.length > 0;

  return (
    <section id="numune-formu" className="scroll-mt-28 py-16 md:py-24">
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
            {open && <PointList points={points} />}
          </div>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <div className="rounded-md border border-border bg-surface p-5 shadow-[0_24px_60px_-40px_rgb(3_38_95/0.35)] sm:p-10">
            {open ? (
              <SampleRequestFormClient
                locale={locale}
                labels={m}
                optionalLabel={messages.common.optional}
                products={products}
                provinces={PROVINCES}
                successTitle={localize(content.successTitle, locale) || m.sample.successTitle}
                successText={localize(content.successText, locale) || m.sample.success}
                privacyHref={resolveLink(locale, content.privacyHref || "/sayfa/kvkk")}
              />
            ) : (
              <div className="flex flex-col items-start gap-8 py-4 sm:py-8">
                <p className="max-w-md text-lg leading-relaxed whitespace-pre-line text-text">{localize(content.closedText, locale) || m.sample.closed}</p>
                <Link href={href(locale, "contact")} className={buttonClass("secondary")}>
                  <span>{m.sample.closedCta}</span>
                  <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
