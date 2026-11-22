import { Mail, MapPin, Phone } from "lucide-react";
import { cacheLife } from "next/cache";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import { mapHref } from "@/lib/contact/links";
import { getMediaById, getMenus, localizeMenu, type NavItem } from "@/lib/data/site";
import { paytrEnv } from "@/lib/payments/config";
import { paytrNoticeInFooter } from "@/lib/payments/paytr-notice";
import { isSimulatorEnabled } from "@/lib/payments/simulator-gateway";
import { samplesSwitchedOff, withoutSamplesMenuItems } from "@/lib/samples/visibility";
import { getSettings } from "@/lib/settings/get-settings";
import { sellerIdentityRows } from "@/lib/settings/seller";
import { cn } from "@/lib/utils";
import FooterCopyright from "./FooterCopyright";
import Logo from "./Logo";
import { fallbackFooterCorporate, fallbackFooterShop } from "./nav-fallback";
import NewsletterForm from "./NewsletterForm";
import PaytrNotice from "./PaytrNotice";
import SellerIdentity from "./SellerIdentity";
import { spacedCaps } from "./shell-styles";
import SmartLink from "./SmartLink";
import SocialLinks from "./SocialLinks";

/** The current year, computed inside a cache scope so the footer stays prerenderable. */
async function getCopyrightYear(): Promise<number> {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

/** "0352 353 30 70" → "tel:+903523533070" (Turkish trunk prefix becomes +90). */
function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.startsWith("00")) return `tel:+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `tel:+90${digits.slice(1)}`;
  return `tel:${digits}`;
}

const headingClass = cn("text-[0.6875rem] font-semibold text-gold", spacedCaps);
const linkClass =
  "rounded-sm text-sm text-brand-contrast/75 transition-colors hover:text-brand-contrast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

function LinkColumn({ title, items, newTabHint }: { title: string; items: NavItem[]; newTabHint: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h2 className={headingClass}>{title}</h2>
      <ul className="mt-5 space-y-3">
        {items.map((item, index) => (
          <li key={`${item.href}-${index}`}>
            <SmartLink
              href={item.href}
              external={item.external}
              newTabHint={newTabHint}
              className={cn(linkClass, item.highlight && "text-gold hover:text-gold")}
            >
              {item.label}
            </SmartLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

type FooterProps = { locale: Locale; messages: Messages };

/**
 * Editorial navy footer: newsletter band, brand + contact block, menu columns, legal line.
 * The band hides itself (globals.css) on pages that already render a newsletter section.
 */
export default async function Footer({ locale, messages }: FooterProps) {
  const [general, newsletter, menus, year, payments, samples] = await Promise.all([
    getSettings("general"),
    getSettings("newsletter"),
    getMenus(),
    getCopyrightYear(),
    getSettings("payments"),
    getSettings("samples"),
  ]);
  // PayTR-fix IMPL-B (S7): PayTR's contract notice while customers can really pay by card through PayTR (rule and
  // reasons: src/lib/payments/paytr-notice.ts). Cached settings plus the deployment's environment, so the footer
  // stays in the static shell; a payments save in the panel refreshes it (TAGS.settings).
  const showPaytr = paytrNoticeInFooter({ card: payments.card, paytrConfigured: paytrEnv() !== null, simulator: isSimulatorEnabled() });
  const [logoDark, paytrLogo] = await Promise.all([
    getMediaById(general.logo.darkId),
    showPaytr ? getMediaById(payments.paytrLogoImageId) : null,
  ]);

  // PayTR-fix IMPL-B (S17): no links to /numune while free samples are switched off (the menus are not changed).
  const visible = samplesSwitchedOff(samples) ? withoutSamplesMenuItems : (items: NavItem[]) => items;
  const shopMenu = visible(menus.footer_shop.length ? localizeMenu(menus.footer_shop, locale) : fallbackFooterShop(locale, messages));
  const corporate = visible(
    menus.footer_corporate.length ? localizeMenu(menus.footer_corporate, locale) : fallbackFooterCorporate(locale, messages),
  );
  const legal = visible(localizeMenu(menus.footer_legal, locale));
  // Order tracking is a store function (like the cart), not menu content: it is appended to the shop
  // column after the panel's items, unless a footer menu already links to the lookup page.
  const orderLookup = href(locale, "orderLookup");
  const linksToLookup = (items: NavItem[]) => items.some((item) => item.href.split(/[?#]/)[0] === orderLookup);
  const shop =
    linksToLookup(shopMenu) || linksToLookup(corporate) || linksToLookup(legal)
      ? shopMenu
      : [...shopMenu, { label: messages.order.footerLink, href: orderLookup, external: false, highlight: false, children: [] }];

  const tagline = localize(general.tagline, locale);
  const incentive = localize(newsletter.incentive, locale) || messages.newsletter.subtitle;
  const { address } = general;
  const addressLines = [address.line, [address.district, address.city].filter(Boolean).join(" / "), address.country].filter(
    Boolean,
  );
  const newTab = messages.common.opensInNewTab;
  // Re-checked on render (only a plain https:// link), like every other link from settings.
  const mapLink = general.mapUrl ? mapHref(general.mapUrl, "") : null;
  // MERSİS, KEP, chamber, trademark (the legal name is printed first, above the address).
  const sellerRows = sellerIdentityRows(general, locale, messages.footer.seller, { legalName: false });

  return (
    <footer className="surface-inverse mt-auto bg-brand text-brand-contrast">
      <div className="container-x">
        {newsletter.enabled ? (
          <section
            aria-labelledby="footer-newsletter-title"
            data-footer-newsletter
            className="grid grid-cols-1 gap-10 border-b border-brand-contrast/15 py-16 md:py-20 lg:grid-cols-12 lg:items-end lg:gap-16"
          >
            <div className="min-w-0 lg:col-span-6">
              <p className={headingClass}>{messages.footer.newsletter}</p>
              <h2
                id="footer-newsletter-title"
                className="mt-4 max-w-xl text-balance font-heading text-3xl leading-[1.15] md:text-4xl lg:text-[2.75rem]"
              >
                {messages.newsletter.title}
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-brand-contrast/70">{incentive}</p>
            </div>
            <div className="min-w-0 lg:col-span-6 lg:ps-8 xl:col-span-5 xl:col-start-8 xl:ps-0">
              <NewsletterForm locale={locale} labels={messages.newsletter} source="footer" tone="inverse" />
            </div>
          </section>
        ) : null}

        <div className="grid grid-cols-1 gap-14 py-16 md:py-20 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <Logo locale={locale} siteName={general.siteName} logo={null} logoDark={logoDark} tone="inverse" />
            {tagline ? <p className="mt-6 max-w-xs text-sm leading-relaxed text-brand-contrast/70">{tagline}</p> : null}

            {/* Go-live CF-9: the seller's identity under a visible "İletişim" heading on every page (home page included). */}
            <h2 className={cn(headingClass, "mt-8")}>{messages.footer.contact}</h2>
            <address className="mt-5 space-y-3 text-sm not-italic text-brand-contrast/75">
              {general.legalName.trim() ? (
                <p className="font-medium text-brand-contrast/90">
                  <span className="sr-only">{messages.footer.seller.legalName}: </span>
                  <bdi>{general.legalName.trim()}</bdi>
                </p>
              ) : null}
              {addressLines.length > 0 ? (
                <p className="flex gap-3">
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" strokeWidth={1.5} />
                  <span>
                    <span className="sr-only">{messages.footer.address}: </span>
                    {mapLink ? (
                      <a href={mapLink} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        <bdi>{addressLines.join(", ")}</bdi>
                        <span className="sr-only"> {newTab}</span>
                      </a>
                    ) : (
                      <bdi>{addressLines.join(", ")}</bdi>
                    )}
                  </span>
                </p>
              ) : null}
              {general.phone ? (
                <p className="flex items-center gap-3">
                  <Phone aria-hidden className="size-4 shrink-0 text-gold" strokeWidth={1.5} />
                  <span className="sr-only">{messages.footer.phone}: </span>
                  <a href={telHref(general.phone)} className={linkClass} dir="ltr">
                    {general.phone}
                  </a>
                </p>
              ) : null}
              {general.email ? (
                <p className="flex items-center gap-3">
                  <Mail aria-hidden className="size-4 shrink-0 text-gold" strokeWidth={1.5} />
                  <span className="sr-only">{messages.footer.email}: </span>
                  <a href={`mailto:${general.email}`} className={linkClass} dir="ltr">
                    {general.email}
                  </a>
                </p>
              ) : null}
              <SellerIdentity
                rows={sellerRows}
                rulesLabel={messages.footer.seller.chamberRules}
                newTabHint={newTab}
                linkClassName={linkClass}
                labelClassName="text-brand-contrast/60"
              />
            </address>

            <SocialLinks
              social={general.social}
              label={messages.footer.followUs}
              newTabHint={newTab}
              className="mt-8"
              linkClassName="border-brand-contrast/20 text-brand-contrast/80 hover:border-gold hover:text-gold focus-visible:outline-gold"
            />
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-8 lg:col-start-6 xl:col-span-7 xl:col-start-6">
            <LinkColumn title={messages.footer.shop} items={shop} newTabHint={newTab} />
            <LinkColumn title={messages.footer.corporate} items={corporate} newTabHint={newTab} />
            <LinkColumn title={messages.footer.legal} items={legal} newTabHint={newTab} />
          </div>
        </div>

        {showPaytr ? (
          <PaytrNotice
            locale={locale}
            labels={messages.footer.paytr}
            newTabHint={newTab}
            logo={paytrLogo}
            tone="inverse"
            className="border-t border-brand-contrast/15 py-5 text-xs leading-relaxed text-brand-contrast/70"
          />
        ) : null}
        <div className="flex flex-col gap-2 border-t border-brand-contrast/15 py-7 text-xs text-brand-contrast/60 md:flex-row md:items-center md:justify-between">
          <FooterCopyright year={year} holder={general.legalName || general.siteName} rights={messages.footer.rights} />
          <p>{messages.footer.madeIn}</p>
        </div>
      </div>
    </footer>
  );
}
