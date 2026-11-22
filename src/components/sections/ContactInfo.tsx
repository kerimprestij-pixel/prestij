// Contact channels (phone, WhatsApp, e-mail, address + map) read from settings at render time, so a
// change in Ayarlar shows up here without editing the page. Cached reads only: the page stays static.
import { ArrowRight, Clock, Mail, MapPin, Phone } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { WhatsAppIcon } from "@/components/store/BrandIcons";
import { jsonLd } from "@/components/store/format";
import SellerIdentity from "@/components/store/SellerIdentity";
import { localize } from "@/i18n/localize";
import { absoluteUrl, href as sitePath } from "@/i18n/paths";
import { formatInternationalPhone, mapHref, telHref, whatsappHref } from "@/lib/contact/links";
import { ORG_ID, SCHEMA_CONTEXT, countryCode, phoneE164 } from "@/lib/seo/structured-data";
import { getSettings } from "@/lib/settings/get-settings";
import { sellerIdentityRows } from "@/lib/settings/seller";
import { cn } from "@/lib/utils";
import type { ContactInfoContent } from "./schemas";
import { Paragraphs, SectionHeading, type SectionProps } from "./ui";

type Channel = {
  key: string;
  label: string;
  value: string;
  /** Long values (the address) use body type instead of the display face. */
  long?: boolean;
  ltr?: boolean;
  href: string;
  action: string;
  external?: boolean;
  Icon: ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number }>;
};

const GRID: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "md:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
};

export default async function ContactInfo({ content, locale, messages }: SectionProps<ContactInfoContent>) {
  const [general, whatsapp] = await Promise.all([getSettings("general"), getSettings("whatsapp")]);
  const m = messages.contact;
  const newTab = messages.common.opensInNewTab;

  const { address } = general;
  const addressText = [address.line, [address.district, address.city].filter(Boolean).join(" / "), address.country]
    .filter(Boolean)
    .join(", ");

  const channels: Channel[] = [];
  const phoneLink = telHref(general.phone);
  if (content.showPhone && phoneLink) {
    channels.push({ key: "phone", label: m.phone, value: general.phone, ltr: true, href: phoneLink, action: m.call, Icon: Phone });
  }
  const waLink = whatsapp.enabled ? whatsappHref(whatsapp.phone, localize(whatsapp.message, locale)) : null;
  if (content.showWhatsapp && waLink) {
    channels.push({
      key: "whatsapp",
      label: m.whatsapp,
      value: formatInternationalPhone(whatsapp.phone),
      ltr: true,
      href: waLink,
      action: m.writeOnWhatsapp,
      external: true,
      Icon: WhatsAppIcon,
    });
  }
  const email = general.email.trim();
  if (content.showEmail && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    channels.push({ key: "email", label: m.email, value: email, ltr: true, href: `mailto:${email}`, action: m.sendEmail, Icon: Mail });
  }
  const mapLink = mapHref(general.mapUrl, addressText);
  if (content.showAddress && addressText && mapLink) {
    channels.push({ key: "address", label: m.address, value: addressText, long: true, href: mapLink, action: m.map, external: true, Icon: MapPin });
  }

  const hours = localize(content.hours, locale);
  // Go-live CF-9: legal name, MERSİS no, KEP address, chamber + rules link, trademark (each only when filled).
  const sellerRows = sellerIdentityRows(general, locale, messages.footer.seller);
  if (channels.length === 0 && !hours && sellerRows.length === 0) return null;

  // Organization structured data with the same settings-driven contact data the visitor sees. Same @id and
  // type as the home page's OnlineStore (src/lib/seo/structured-data.ts), so search engines read one entity.
  const telephone = phoneE164(general.phone);
  const addressCountry = countryCode(address.country);
  const structured = {
    "@context": SCHEMA_CONTEXT,
    "@type": "OnlineStore",
    "@id": ORG_ID(),
    name: general.siteName,
    ...(general.legalName && general.legalName !== general.siteName ? { legalName: general.legalName } : {}),
    url: absoluteUrl(sitePath(locale, "home")),
    ...(telephone ? { telephone } : {}),
    ...(email ? { email } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: address.line,
      addressLocality: address.district,
      addressRegion: address.city,
      ...(addressCountry ? { addressCountry } : {}),
    },
  };

  return (
    <section className="py-16 md:py-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <div className="container-x">
        <SectionHeading eyebrow={content.eyebrow} title={content.title} intro={content.intro} locale={locale} className="mb-12 md:mb-16" />
        {channels.length > 0 && (
          <ul
            aria-label={m.channels}
            className={cn(
              "grid gap-px overflow-hidden rounded-md border border-border bg-border shadow-[0_1px_2px_rgb(3_38_95/0.04)]",
              GRID[Math.min(channels.length, 4)],
            )}
          >
            {channels.map(({ key, label, value, long, ltr, href, action, external, Icon }) => (
              <li
                key={key}
                className="group relative flex min-w-0 flex-col bg-surface p-6 transition-colors duration-300 focus-within:bg-surface-2/60 hover:bg-surface-2/60 sm:p-9 motion-reduce:transition-none"
              >
                <span className="grid size-11 place-items-center rounded-full border border-gold/40 text-gold-text transition-colors duration-300 group-hover:border-gold sm:size-12 motion-reduce:transition-none">
                  <Icon aria-hidden className="size-5" strokeWidth={1.5} />
                </span>
                <p className="eyebrow mt-5 sm:mt-7">{label}</p>
                <p
                  className={cn(
                    "mt-3 break-words text-text",
                    long ? "max-w-xs text-base leading-relaxed" : "font-heading text-2xl leading-tight md:text-[1.75rem]",
                  )}
                >
                  {ltr ? (
                    <span dir="ltr" className="inline-block">
                      {value}
                    </span>
                  ) : (
                    value
                  )}
                </p>
                <a
                  href={href}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="mt-auto inline-flex items-center gap-2 pt-5 text-sm sm:pt-7 font-medium text-text underline decoration-gold/60 underline-offset-[6px] transition-colors after:absolute after:inset-0 after:content-[''] group-hover:decoration-gold focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-3px] focus-visible:after:outline-ring"
                >
                  <span>
                    {action}
                    <span className="sr-only">
                      {": "}
                      {value}
                      {external ? ` ${newTab}` : ""}
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="size-4 transition-transform duration-300 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1 motion-reduce:transition-none"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
        {hours && (
          <div className="mt-8 flex items-start gap-4 text-text-muted">
            <Clock aria-hidden className="mt-1 size-5 shrink-0 text-gold-text" strokeWidth={1.5} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text rtl:tracking-normal">{m.hours}</p>
              <div className="mt-2 space-y-2 text-base leading-relaxed">
                <Paragraphs text={content.hours} locale={locale} />
              </div>
            </div>
          </div>
        )}
        {sellerRows.length > 0 && (
          <div className="mt-10 border-t border-border pt-8">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-text rtl:tracking-normal">{messages.footer.seller.title}</h3>
            <div className="mt-4 grid gap-x-10 gap-y-2 text-sm leading-relaxed text-text-muted sm:grid-cols-2">
              <SellerIdentity
                rows={sellerRows}
                rulesLabel={messages.footer.seller.chamberRules}
                newTabHint={newTab}
                labelClassName="text-text"
                linkClassName="text-text underline decoration-gold/60 underline-offset-4 transition-colors hover:decoration-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
