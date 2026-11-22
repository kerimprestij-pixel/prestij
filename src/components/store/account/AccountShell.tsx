// The frame of every /hesap page (except the auth pages): the account navigation beside the content
// on desktop, a scrollable row of links above it on phones. Static (no session reads), so it renders
// in the page's static shell while the personal content streams in. B2B (/hesap/kurumsal) and
// SUBSCRIPTIONS (/hesap/abonelikler) get it through the layout.tsx in their folders.
import { Building2, Heart, LayoutGrid, MapPin, Package, Repeat, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/get-messages";
import { href, type StaticRoute } from "@/i18n/paths";
import { getSettings } from "@/lib/settings/get-settings";
import { cn } from "@/lib/utils";
import SignOutButton from "./SignOutButton";

export type AccountNavKey = "overview" | "orders" | "favorites" | "addresses" | "subscriptions" | "business" | "profile";

const ITEMS: { key: AccountNavKey; route: StaticRoute; icon: LucideIcon }[] = [
  { key: "overview", route: "account", icon: LayoutGrid },
  { key: "orders", route: "accountOrders", icon: Package },
  { key: "favorites", route: "accountFavorites", icon: Heart },
  { key: "addresses", route: "accountAddresses", icon: MapPin },
  { key: "subscriptions", route: "accountSubscriptions", icon: Repeat },
  { key: "business", route: "accountBusiness", icon: Building2 },
  { key: "profile", route: "accountProfile", icon: UserRound },
];

export default async function AccountShell({ locale, active, children }: { locale: Locale; active: AccountNavKey; children: ReactNode }) {
  const [messages, b2b, subscriptions] = await Promise.all([getMessages(locale), getSettings("b2b"), getSettings("subscriptions")]);
  const m = messages.account;
  // Hidden sections: business accounts when B2B is off, subscriptions when they are switched off
  // (the current page always stays visible).
  const items = ITEMS.filter(
    (item) => item.key === active || (item.key !== "business" || b2b.enabled) && (item.key !== "subscriptions" || subscriptions.enabled),
  );

  return (
    <div className="relative isolate">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-72 bg-linear-to-b from-gold/8 to-transparent" />
      <div className="container-x grid gap-8 py-8 md:py-12 lg:grid-cols-12 lg:gap-12 lg:py-16 xl:gap-16">
        <nav aria-label={m.nav.label} className="min-w-0 lg:col-span-3">
          <div className="lg:sticky lg:top-28">
            <p className="eyebrow mb-4 hidden lg:block">{m.title}</p>
            <ul className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0 [&::-webkit-scrollbar]:hidden">
              {items.map(({ key, route, icon: Icon }) => {
                const current = key === active;
                return (
                  <li key={key} className="shrink-0 snap-start">
                    <Link
                      href={href(locale, route)}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-full border px-4 text-sm whitespace-nowrap transition-colors duration-200 motion-reduce:transition-none lg:rounded-control lg:border-0 lg:px-3",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        current
                          ? "border-brand bg-brand text-brand-contrast lg:bg-surface lg:text-text lg:shadow-[inset_2px_0_0_var(--gold)] rtl:lg:shadow-[inset_-2px_0_0_var(--gold)]"
                          : "border-border text-text-muted hover:border-gold hover:text-text lg:hover:bg-surface-2",
                      )}
                    >
                      <Icon aria-hidden className={cn("size-4 shrink-0", current ? "lg:text-gold-text" : "")} strokeWidth={1.6} />
                      {m.nav[key]}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 hidden border-t border-border pt-4 lg:block">
              <SignOutButton locale={locale} label={m.signOut} pendingLabel={m.signingOut} className="px-3" />
            </div>
          </div>
        </nav>
        <div className="min-w-0 lg:col-span-9">
          {children}
          <div className="mt-12 border-t border-border pt-6 lg:hidden">
            <SignOutButton locale={locale} label={m.signOut} pendingLabel={m.signingOut} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Title block at the top of an account page. */
export function AccountPageHeader({ eyebrow, title, intro, actions }: { eyebrow?: string; title: string; intro?: string; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-5 md:mb-10 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className={cn("font-heading text-4xl leading-[1.05] text-balance text-text md:text-5xl", eyebrow && "mt-3")}>{title}</h1>
        {intro ? <p className="mt-3 max-w-2xl text-base leading-relaxed text-pretty text-text-muted">{intro}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

/** Placeholder while an account page's personal content streams in. */
export function AccountContentSkeleton() {
  return (
    <div aria-hidden className="animate-pulse motion-reduce:animate-none">
      <div className="h-3 w-24 rounded bg-surface-2" />
      <div className="mt-4 h-11 w-2/3 rounded bg-surface-2" />
      <div className="mt-4 h-4 w-1/2 rounded bg-surface-2" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="h-36 rounded-md bg-surface-2" />
        <div className="h-36 rounded-md bg-surface-2" />
        <div className="h-36 rounded-md bg-surface-2" />
        <div className="h-36 rounded-md bg-surface-2" />
      </div>
    </div>
  );
}
