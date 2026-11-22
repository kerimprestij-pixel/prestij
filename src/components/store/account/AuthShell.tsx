// Frame of the auth pages (sign-in, register, forgot / reset password, verify): an editorial brand
// panel beside the form on large screens, the form alone on phones. Static (no session reads).
import { Check, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import type { Messages } from "@/i18n/messages";
import { cn } from "@/lib/utils";

export default function AuthShell({ messages, children, wide = false }: { messages: Messages; children: ReactNode; wide?: boolean }) {
  const m = messages.auth.layout;
  const benefits = [m.benefitOrders, m.benefitCheckout, m.benefitFavorites, m.benefitBusiness];
  return (
    <div className="relative isolate">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[55vh] bg-linear-to-b from-gold/10 to-transparent" />
      <div className="container-x grid items-start gap-10 py-10 md:py-16 lg:grid-cols-12 lg:gap-14 lg:py-20 xl:gap-20">
        <aside className="relative hidden overflow-hidden rounded-md bg-brand-900 p-10 text-white lg:col-span-5 dark:border dark:border-border dark:bg-surface lg:block xl:p-12">
          <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 size-72 rounded-full border border-gold/25" />
          <div aria-hidden className="pointer-events-none absolute -end-10 -top-10 size-44 rounded-full border border-gold/20" />
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-gold-200 rtl:tracking-normal">{m.eyebrow}</p>
          <p className="mt-6 font-heading text-4xl leading-[1.08] text-balance xl:text-5xl">{m.title}</p>
          <p className="mt-6 max-w-md text-base leading-relaxed text-white/80">{m.text}</p>
          <span aria-hidden className="mt-10 block h-px w-16 bg-gold/70" />
          <ul className="mt-10 space-y-4">
            {benefits.map((text) => (
              <li key={text} className="flex items-start gap-3 text-sm leading-relaxed text-white/90">
                <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-gold/60 text-gold-200">
                  <Check className="size-3" strokeWidth={2.25} />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-12 flex items-start gap-2.5 border-t border-white/15 pt-6 text-xs leading-relaxed text-white/70">
            <LockKeyhole aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {m.secure}
          </p>
        </aside>
        <div className={cn("mx-auto w-full lg:col-span-7 lg:mx-0", wide ? "max-w-2xl" : "max-w-xl")}>{children}</div>
      </div>
    </div>
  );
}

/** Placeholder of an auth card while its form streams in. */
export function AuthCardSkeleton() {
  return (
    <div aria-hidden className="animate-pulse rounded-md border border-border bg-surface p-6 motion-reduce:animate-none sm:p-10">
      <div className="h-3 w-28 rounded bg-surface-2" />
      <div className="mt-4 h-10 w-4/5 rounded bg-surface-2" />
      <div className="mt-4 h-4 w-full rounded bg-surface-2" />
      <div className="mt-10 h-12 w-full rounded bg-surface-2" />
      <div className="mt-6 h-12 w-full rounded bg-surface-2" />
      <div className="mt-8 h-12 w-full rounded bg-surface-2" />
    </div>
  );
}

/** Eyebrow + serif heading + intro at the top of an auth card. */
export function AuthHeading({ eyebrow, heading, intro, id }: { eyebrow: string; heading: string; intro?: string; id?: string }) {
  return (
    <header className="mb-8">
      <p className="eyebrow">{eyebrow}</p>
      <h1 id={id} className="mt-3 font-heading text-4xl leading-[1.08] text-balance text-text md:text-[2.75rem]">
        {heading}
      </h1>
      {intro ? <p className="mt-4 text-base leading-relaxed text-pretty text-text-muted">{intro}</p> : null}
    </header>
  );
}
