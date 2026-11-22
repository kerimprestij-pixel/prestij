// The gift wheel prize on the account overview (/hesap): the active code with a live countdown to its
// real end and its minimum basket (prize texts state their conditions), or a short note that it was used
// or ran out (for 30 days after its end). Day 6 follow-up (D15): above it, a won prize the account has
// not taken yet (held spin, also after the campaign end within its hold) with "Hediyemi al"
// (AccountHeldSpinCard, a client card on the existing claimWheel action). Server component inside the
// overview's request-time boundary; nothing renders when the account has neither.
import Link from "next/link";
import { connection } from "next/server";
import { buttonClass } from "@/components/sections/button-styles";
import { panelClass } from "@/components/store/account/styles";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { href } from "@/i18n/paths";
import { getAccountWheelPrize, type AccountWheelPrize } from "@/lib/data/wheel";
import { getAccountHeldSpin, type AccountHeldSpin } from "@/lib/data/wheel-held";
import { safeErrorInfo } from "@/lib/db-errors";
import { formatPrice } from "@/lib/pricing/money";
import { cn } from "@/lib/utils";
import AccountHeldSpinCard from "./AccountHeldSpinCard";
import { formatWheelDate } from "./countdown";
import { heldSpinCardLabels, heldSpinCardModel } from "./held-spin-card";
import { wheelPrizeLabel } from "./prize-label";
import WheelMark from "./WheelMark";
import { CopyCodeButton, WheelCountdownText } from "./WheelLive";

export default async function AccountWheelCard({ locale, messages, userId }: { locale: Locale; messages: Messages; userId: string }) {
  await connection(); // reads the clock: request time only
  const now = new Date();
  const [prize, held] = await Promise.all([
    getAccountWheelPrize(userId, now).catch((error: unknown): AccountWheelPrize | null => {
      console.error("[wheel] account prize failed", safeErrorInfo(error));
      return null;
    }),
    getAccountHeldSpin(userId, now).catch((error: unknown): AccountHeldSpin | null => {
      console.error("[wheel] account held spin failed", safeErrorInfo(error));
      return null;
    }),
  ]);
  const heldCard = held ? (
    <AccountHeldSpinCard
      locale={locale}
      model={heldSpinCardModel(held, locale, messages.wheel)}
      labels={heldSpinCardLabels(messages.wheel)}
      cartHref={href(locale, "cart")}
    />
  ) : null;
  if (!prize) return heldCard;

  const m = messages.wheel.account;
  const label = wheelPrizeLabel(prize, locale, messages.wheel.prize);
  const active = prize.status === "active";
  const expiry = formatWheelDate(prize.endsAt, locale);

  return (
    <>
      {heldCard}
      <section aria-labelledby="account-wheel" className={cn(panelClass, "mb-12 border-gold-300/60", active ? "bg-gold-50/40 dark:bg-gold-950/30" : undefined)}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <WheelMark className={cn("size-11 shrink-0", active ? undefined : "opacity-60 grayscale")} />
            <div className="min-w-0">
              {/* Focusable: the held card moves focus here after "already claimed" refreshed the overview (ACCOUNT_WHEEL_HEADING_ID). */}
              <h2 id="account-wheel" tabIndex={-1} className="font-medium text-text focus:outline-none">
                {m.title}
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-muted">
                {active ? format(m.active, { prize: label }) : prize.status === "used" ? m.used : m.expired}
                {active && prize.minOrderTotal > 0 ? (
                  <> {format(messages.wheel.result.minOrder, { amount: formatPrice(prize.minOrderTotal, locale) }, locale)}</>
                ) : null}
              </p>
              {active ? (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="text-xs font-medium text-text-muted">{m.code}</span>
                    <bdi dir="ltr" className="rounded-sm border border-dashed border-gold-300/70 bg-surface px-3 py-1.5 font-mono text-base font-semibold tracking-[0.14em] text-text select-all">
                      {prize.code}
                    </bdi>
                    <CopyCodeButton code={prize.code} copyLabel={messages.wheel.claim.copy} copiedLabel={messages.wheel.claim.copied} />
                  </div>
                  <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text">
                    <WheelCountdownText
                      endsAt={prize.endsAt}
                      locale={locale}
                      template={m.timeLeft}
                      labels={messages.wheel.countdown}
                      serverSeconds={Math.floor(now.getTime() / 1000)}
                    />
                    <span className="text-text-muted">{format(m.expiresAt, { date: expiry })}</span>
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-text-muted">
                  <bdi dir="ltr" className="font-mono">
                    {prize.code}
                  </bdi>{" "}
                  · {format(m.expiresAt, { date: expiry })}
                </p>
              )}
            </div>
          </div>
          {active ? (
            <Link href={href(locale, "products")} className={buttonClass("secondary", "shrink-0 rtl:tracking-normal")}>
              {m.shop}
            </Link>
          ) : null}
        </div>
      </section>
    </>
  );
}
