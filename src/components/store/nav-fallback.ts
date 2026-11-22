// Navigation used only while the panel's menus are still empty, so a fresh install never shows a bare
// header or footer. Labels come from the UI dictionary; slugs follow the seed conventions.
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-messages";
import { href } from "@/i18n/paths";
import type { NavItem } from "@/lib/data/site";

const link = (label: string, path: string, children: NavItem[] = []): NavItem => ({
  label,
  href: path,
  external: false,
  highlight: false,
  children,
});

function categoryLinks(locale: Locale, messages: Messages): NavItem[] {
  return [
    link(messages.nav.handSoap, href(locale, "category", { slug: "el-sabunu" })),
    link(messages.nav.showerGel, href(locale, "category", { slug: "dus-jeli" })),
    link(messages.nav.giftSets, href(locale, "category", { slug: "hediye-setleri" })),
  ];
}

export function fallbackHeaderNav(locale: Locale, messages: Messages): NavItem[] {
  return [
    link(messages.nav.products, href(locale, "products"), categoryLinks(locale, messages)),
    link(messages.nav.business, href(locale, "business")),
    link(messages.nav.samples, href(locale, "samples")),
    link(messages.nav.blog, href(locale, "blog")),
    link(messages.nav.contact, href(locale, "contact")),
  ];
}

export function fallbackFooterShop(locale: Locale, messages: Messages): NavItem[] {
  return [link(messages.category.allProducts, href(locale, "products")), ...categoryLinks(locale, messages)];
}

export function fallbackFooterCorporate(locale: Locale, messages: Messages): NavItem[] {
  return [
    link(messages.nav.business, href(locale, "business")),
    link(messages.nav.samples, href(locale, "samples")),
    link(messages.nav.blog, href(locale, "blog")),
    link(messages.nav.contact, href(locale, "contact")),
  ];
}
