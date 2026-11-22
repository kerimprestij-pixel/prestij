import { Search } from "lucide-react";
import Link from "next/link";
import AccountLink from "@/components/store/account/AccountLink";
import { accountWidthPrePaintScript } from "@/components/store/account/account-link-width";
import ThemeToggle from "@/components/store/ThemeToggle";
import { localeNames, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-messages";
import { LOCALE_CODES, href } from "@/i18n/paths";
import { getMediaById, getMenus, localizeMenu } from "@/lib/data/site";
import { samplesSwitchedOff, withoutSamplesMenuItems } from "@/lib/samples/visibility";
import { getSettings } from "@/lib/settings/get-settings";
import CartLink from "./CartLink";
import DesktopNav from "./DesktopNav";
import HeaderScrollShell from "./HeaderScrollShell";
import LanguageSwitcher, { type LanguageOption } from "./LanguageSwitcher";
import Logo from "./Logo";
import MobileMenu from "./MobileMenu";
import { fallbackHeaderNav } from "./nav-fallback";
import { iconButton } from "./shell-styles";

type HeaderProps = { locale: Locale; messages: Messages };

/** Enabled languages from settings (the current one is always offered so the switcher never hides it). */
async function getLanguageOptions(locale: Locale): Promise<LanguageOption[]> {
  const { enabled } = await getSettings("locales");
  return LOCALE_CODES.filter((code) => code === locale || enabled.includes(code)).map((code) => ({
    code,
    name: localeNames[code],
  }));
}

/** Sticky storefront header: logo, primary navigation, search/account/cart, language and theme. */
export default async function Header({ locale, messages }: HeaderProps) {
  const [general, menus, languages, samples] = await Promise.all([
    getSettings("general"),
    getMenus(),
    getLanguageOptions(locale),
    getSettings("samples"),
  ]);
  const [logo, logoDark] = await Promise.all([
    getMediaById(general.logo.lightId),
    getMediaById(general.logo.darkId),
  ]);

  const menu = menus.header.length > 0 ? localizeMenu(menus.header, locale) : fallbackHeaderNav(locale, messages);
  // PayTR-fix IMPL-B (S17): no "Numune" item while free samples are switched off (cached settings read: the
  // panel's save brings it back). The menu itself is not changed.
  const items = samplesSwitchedOff(samples) ? withoutSamplesMenuItems(menu) : menu;
  const showLanguages = languages.length > 1;

  return (
    <>
      {/* Before the account link is parsed: reserves the signed-in visitor's greeting width before
          first paint (see account-link-width.ts), so the navigation never moves when it appears. */}
      <script dangerouslySetInnerHTML={{ __html: accountWidthPrePaintScript() }} />
      <HeaderScrollShell>
        <div className="container-x grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-3 md:h-20 lg:flex lg:gap-8">
          {/* Start: menu trigger on small screens */}
          <div className="flex items-center lg:hidden">
            <MobileMenu
              items={items}
              secondary={[
                { label: messages.header.account, href: href(locale, "account") },
                { label: messages.header.orderLookup, href: href(locale, "orderLookup") },
                { label: messages.nav.contact, href: href(locale, "contact") },
              ]}
              labels={{
                open: messages.header.openMenu,
                close: messages.header.closeMenu,
                title: messages.common.menu,
                navigation: messages.nav.mainNavigation,
                newTab: messages.common.opensInNewTab,
              }}
              footer={
                <>
                  {showLanguages ? (
                    <LanguageSwitcher variant="list" current={locale} languages={languages} label={messages.language.label} />
                  ) : null}
                  <ThemeToggle labels={messages.theme} label={messages.header.theme} />
                </>
              }
            />
          </div>

          {/* Logo: centred on small screens, leading on desktop */}
          <div className="flex justify-center lg:justify-start">
            <Logo locale={locale} siteName={general.siteName} logo={logo} logoDark={logoDark} eager />
          </div>

          <div className="hidden flex-1 justify-center lg:flex">
            <DesktopNav items={items} label={messages.nav.mainNavigation} newTabHint={messages.common.opensInNewTab} />
          </div>

          {/* End: actions */}
          <div className="flex items-center justify-end gap-0.5 sm:gap-1">
            <Link href={href(locale, "products")} aria-label={messages.common.search} className={iconButton}>
              <Search aria-hidden className="size-5" strokeWidth={1.5} />
            </Link>
            {showLanguages ? (
              <LanguageSwitcher
                current={locale}
                languages={languages}
                label={messages.language.label}
                className="hidden lg:block"
              />
            ) : null}
            <div className="hidden lg:flex">
              <ThemeToggle labels={messages.theme} label={messages.header.theme} />
            </div>
            {/* Account (client island: the viewer is loaded after hydration, the header stays static).
                Guests find the order lookup on the sign-in page and in the menu. */}
            <AccountLink
              locale={locale}
              labels={{
                signIn: messages.account.signIn,
                account: messages.header.account,
                signedIn: messages.account.headerSignedIn,
                greeting: messages.account.headerGreeting,
              }}
            />
            <CartLink
              href={href(locale, "cart")}
              label={messages.header.cart}
              labelWithCount={messages.header.cartWithCount}
              locale={locale}
            />
          </div>
        </div>
      </HeaderScrollShell>
    </>
  );
}
