"use client";
// The gift wheel dialog (lazy chunk, opened by WheelLauncher with the wheel already loaded): a native
// <dialog> (top layer, the page inert, Escape, focus kept inside and returned by the launcher), the SVG
// wheel, the spin, the result, the claim, and a CSS-only celebration.
//
//   spin   → a short wind-up while POST /api/wheel/spin answers, then one CSS transform transition
//            (~4.6 s, slowing glide) to the server's slice, with the pointer flicking at every stud
//            (a transform-only Web Animation computed from the same easing). Reduced motion: no spin,
//            no flicks, no confetti; the wheel is simply shown at the result.
//   result → the prize and its conditions (from the server), then "Hediyemi al" (signed in) or
//            "ücretsiz üye olun" / "Giriş yapın" (guest, back to this page afterwards); a guest whose spin is
//            already bound to a new account (pending) is asked to verify the e-mail address by the hold end.
//   claim  → claimWheel: the coupon is issued and, when the cart allows, applied (the cart surfaces
//            update through publishCartView); the code, its real expiry and the way to the cart.
// Scroll lock keeps the scrollbar's space (no layout shift when the dialog opens by itself). On phones and
// short landscape windows the wheel is sized by the height too and each step's main action sits in a bar
// pinned to the bottom of the text column (sticky, .pw-actions), so it is on screen without scrolling
// (iPhone SE in Safari, 320×568, 844×390).
import { Check, Copy, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { publishCartView } from "@/components/cart/cart-store";
import { localeDir, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { href, safeReturnPath, signInHref } from "@/i18n/paths";
import { formatPrice } from "@/lib/pricing/money";
import { validityText } from "@/lib/wheel/prize";
import type { WheelActivePrize, WheelClaimResult, WheelDisplaySlice, WheelEligibilityReason, WheelErrorCode, WheelSpinView } from "@/lib/wheel/types";
import { cn } from "@/lib/utils";
import { formatWheelDate } from "./countdown";
import { WHEEL_DIALOG_FALLBACK, type WheelDialogLabels } from "./labels";
import { useWheelApi } from "./wheel-api";
import { landingRotation, pointerTickKeyframes, sliceAngle } from "./wheel-geometry";
import type { WheelDialogData } from "./wheel-storage";
import WheelGraphic from "./WheelGraphic";

export type GiftWheelDialogProps = {
  locale: Locale;
  signedIn: boolean;
  /** The loaded wheel; null when it could not be loaded (the dialog says so). */
  data: WheelDialogData | null;
  /** Accessible name while nothing else is known ("Hediye çarkı"). */
  dialogLabel: string;
  neverShowLabel: string;
  /** Closed (Escape, ×, backdrop, a link); `claimed` when a prize was claimed in this dialog. */
  onClose: (claimed: WheelActivePrize | null) => void;
  /** The wheel stopped on a prize (the launcher remembers it for the teaser). */
  onSpun: (spin: WheelSpinView) => void;
  onClaimed: (prize: WheelActivePrize) => void;
  /** The server refused for a lasting reason (limit, closed, already claimed…): the teaser goes away. */
  onRefused: (reason: WheelEligibilityReason) => void;
  onNeverShow: () => void;
};

export const WHEEL_SPIN_MS = 4600;
const WIND_UP_MS = 320;
const WIND_UP_DEG = 10;

/** Refusals that will not change by trying again now: the teaser goes away after them. */
const LASTING: readonly WheelEligibilityReason[] = ["disabled", "not_started", "ended", "staff", "business", "has_ordered", "already_claimed", "spin_limit", "claim_limit"];
const isLasting = (code: WheelErrorCode): code is Exclude<WheelEligibilityReason, "eligible"> => (LASTING as readonly string[]).includes(code);

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

type Claimed = { prize: WheelActivePrize & { summary?: string }; applied: boolean | null };
type Phase = "idle" | "spinning" | "landed";

export default function GiftWheelDialog({ locale, signedIn, data, dialogLabel, neverShowLabel, onClose, onSpun, onClaimed, onRefused, onNeverShow }: GiftWheelDialogProps) {
  const api = useWheelApi();
  const dir = localeDir(locale);
  const state = data?.state ?? null;
  const L = data?.labels ?? null;
  const fallback = WHEEL_DIALOG_FALLBACK[locale];
  const slices = state?.slices ?? [];
  const count = slices.length;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLElement | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const claimedRef = useRef<WheelActivePrize | null>(null);
  const timers = useRef<number[]>([]);
  const tick = useRef<Animation | null>(null);
  const closing = useRef(false);
  const titleId = useId();
  const descId = useId();

  const [phase, setPhase] = useState<Phase>("idle");
  // A spin the visitor already has: the wheel rests on its slice (no animation).
  const [rotation, setRotation] = useState(() => {
    const index = state?.spin?.sliceIndex ?? -1;
    return index >= 0 && index < count ? landingRotation(index, count, { turns: 0 }) : 0;
  });
  const [spinMs, setSpinMs] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const [freshSpin, setFreshSpin] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [returnTo] = useState(() => safeReturnPath(window.location.pathname + window.location.search));

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  // Open as a modal; keep the scrollbar's space while the page is locked; close on browser Back.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    if (window.innerWidth - root.clientWidth > 0) root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    primaryRef.current?.focus({ preventScroll: true });
    const onPopState = () => {
      if (dialog.open) dialog.close();
    };
    window.addEventListener("popstate", onPopState);
    const pending = timers.current;
    return () => {
      window.removeEventListener("popstate", onPopState);
      for (const t of pending) window.clearTimeout(t);
      tick.current?.cancel();
      if (dialog.open) dialog.close();
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.gutter;
    };
  }, []);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open || closing.current) return;
    closing.current = true;
    if (prefersReducedMotion()) {
      dialog.close();
      return;
    }
    dialog.setAttribute("data-closing", "");
    window.setTimeout(() => dialog.close(), 170);
  }, []);

  const view: "error" | "ready" | "spinning" | "result" | "claimed" | "blocked" = claimed
    ? "claimed"
    : phase === "spinning"
      ? "spinning"
      : !state || !L
        ? "error"
        : state.activePrize
          ? "claimed"
          : state.spin
            ? "result"
            : state.eligible
              ? "ready"
              : "blocked";

  // The main action of each step gets the focus (the spin button keeps it while the wheel turns).
  useEffect(() => {
    if (view !== "spinning") primaryRef.current?.focus({ preventScroll: true });
  }, [view]);

  const say = (text: string) => setAnnounce(text);

  const spin = async () => {
    if (!state || !L || phase !== "idle" || view !== "ready") return;
    const reduce = prefersReducedMotion();
    const from = rotation;
    setError(null);
    setPhase("spinning");
    say(L.dialog.spinning);
    if (!reduce) {
      setSpinMs(WIND_UP_MS);
      setRotation(from - WIND_UP_DEG);
    }
    const started = performance.now();
    const response = await api.spin({ locale, path: window.location.pathname, website: honeypotRef.current?.value ?? "" });
    if (!response.ok) {
      const message = response.message || L.errors[response.error] || L.errors.unavailable;
      setSpinMs(reduce ? 0 : WIND_UP_MS);
      setRotation(from);
      setPhase("idle");
      setError(message);
      say(message);
      if (isLasting(response.error)) onRefused(response.error);
      return;
    }
    const index = response.sliceIndex;
    // The result is a fact once the server has answered: hand it over now, so closing the dialog mid-spin
    // still leaves the teaser and the next opening on the won prize (the "spinning" view stays until it lands).
    onSpun({ sliceIndex: index, prize: response.prize, holdUntil: response.holdUntil, claim: response.claim, ...(response.pending ? { pending: true } : {}) });
    const land = (animate: boolean) => {
      tick.current = null;
      setSpinMs(0); // drop the transition (and will-change) so the face is painted crisply at rest
      setPhase("landed");
      setFreshSpin(!response.repeated);
      setCelebrate(animate);
      say(format(L.result.announcement, { prize: response.prize.label }));
    };
    if (reduce || index < 0 || index >= count) {
      setSpinMs(0);
      if (index >= 0 && index < count) setRotation(landingRotation(index, count, { from, turns: 0 }));
      land(false);
      return;
    }
    await wait(Math.max(0, WIND_UP_MS - (performance.now() - started)));
    const base = from - WIND_UP_DEG;
    // Stop somewhere inside the slice (not always dead centre), well clear of its edges.
    const jitter = (Math.random() - 0.5) * sliceAngle(count) * 0.56;
    const target = landingRotation(index, count, { from: base, turns: 6 }) + jitter;
    setSpinMs(WHEEL_SPIN_MS);
    setRotation(target);
    const pointer = stageRef.current?.querySelector<SVGSVGElement>("[data-wheel-pointer]");
    if (pointer && typeof pointer.animate === "function") {
      tick.current = pointer.animate(pointerTickKeyframes(base, target, count), { duration: WHEEL_SPIN_MS, easing: "linear" });
    }
    later(() => land(true), WHEEL_SPIN_MS + 60);
  };

  const claim = async () => {
    if (!L || claiming) return;
    setClaiming(true);
    setError(null);
    say(L.claim.claiming);
    let result: WheelClaimResult;
    try {
      result = await api.claim(locale);
    } catch {
      result = { ok: false, error: "network", message: "" };
    }
    setClaiming(false);
    if (!result.ok) {
      const message = result.message || L.errors[result.error] || L.errors.unavailable;
      setError(message);
      say(message);
      if (isLasting(result.error)) onRefused(result.error);
      return;
    }
    if (result.cart) publishCartView(result.cart);
    const prize: WheelActivePrize = { code: result.prize.code, label: result.prize.label, endsAt: result.prize.endsAt };
    claimedRef.current = prize;
    setClaimed({ prize: result.prize, applied: result.applied });
    say(`${L.claim.claimedTitle}. ${result.applied ? L.claim.applied : L.claim.kept}`);
    onClaimed(prize);
  };

  const copy = async (code: string) => {
    if (!L) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      say(L.claim.copied);
      later(() => setCopied(false), 2500);
    } catch {
      // No clipboard permission: select the code so it can be copied by hand.
      const node = dialogRef.current?.querySelector("[data-wheel-code]");
      if (node) window.getSelection()?.selectAllChildren(node);
    }
  };

  const setPrimary = (node: HTMLElement | null) => {
    primaryRef.current = node;
  };

  const resting = phase === "idle" && state?.spin && state.spin.sliceIndex >= 0 && state.spin.sliceIndex < count ? state.spin.sliceIndex : null;
  const landedIndex = phase === "landed" && state?.spin && state.spin.sliceIndex >= 0 ? state.spin.sliceIndex : null;
  const highlight = landedIndex ?? resting;
  const shownPrize: Claimed | null = claimed ?? (state?.activePrize ? { prize: state.activePrize, applied: null } : null);
  // The small "Hediye çarkı" line above the title only when the title says something else (e.g. a panel title).
  const titleEyebrow = !!L && !!state && state.texts.title.toLocaleLowerCase(locale) !== L.dialog.label.toLocaleLowerCase(locale);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        // A close queued by an effect cleanup that re-ran (Strict Mode, a remount) while the dialog was
        // shown again: not a real close.
        if (dialogRef.current?.open) return;
        onClose(claimedRef.current);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className="pw-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100%-2rem),56rem)] max-w-none overflow-visible bg-transparent p-0 text-text max-sm:mb-0 max-sm:max-h-[94dvh] max-sm:w-full"
    >
      <style href="prestij-wheel-dialog" precedence="default">
        {DIALOG_CSS}
      </style>
      <div className="pw-panel relative grid h-[min(calc(100dvh-2rem),35rem)] max-h-[inherit] overflow-hidden max-sm:h-[min(94dvh,44rem)] rounded-xl bg-surface shadow-[0_40px_90px_-30px_rgb(2_21_56/0.65)] ring-1 ring-gold-300/35 max-sm:grid-rows-[auto_minmax(0,1fr)] max-sm:rounded-b-none sm:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* The stage: the wheel on deep navy with a soft gold glow (the same in light and dark mode). */}
        <div ref={stageRef} className="pw-stage relative flex items-center justify-center overflow-hidden px-8 pt-6 pb-4 sm:px-10 sm:py-14">
          <div className={cn("pw-wheel relative w-[min(66vw,16.5rem,32dvh)] sm:w-full sm:max-w-[22.5rem]", celebrate ? "pw-pop" : undefined)}>
            {count > 0 ? (
              <WheelGraphic slices={slices} rotation={rotation} spinDurationMs={spinMs} highlightIndex={highlight} dir={dir} centerLabel="PRESTİJ" />
            ) : (
              <div aria-hidden className="aspect-square w-full rounded-full border-[10px] border-gold-300/60 bg-brand-900/60" />
            )}
            {celebrate ? <Celebration /> : null}
          </div>
        </div>

        <div className="pw-col relative flex min-h-0 flex-col overflow-y-auto px-6 pt-6 sm:px-10 sm:pt-12 sm:pb-9">
          {view === "error" || !L || !state ? (
            <>
              <h2 id={titleId} className="pe-10 font-heading text-3xl leading-tight text-text">
                {dialogLabel}
              </h2>
              <p id={descId} className="mt-3 text-sm leading-relaxed text-text-muted">
                {data?.state === null && L ? L.errors.unavailable : fallback.network}
              </p>
              <button ref={setPrimary} type="button" onClick={requestClose} className={cn(secondaryClass, "mt-8 self-start")}>
                {L?.dialog.close ?? fallback.close}
              </button>
            </>
          ) : view === "claimed" && shownPrize ? (
            <ClaimedView
              L={L}
              locale={locale}
              titleId={titleId}
              descId={descId}
              claimed={shownPrize}
              copied={copied}
              onCopy={copy}
              setPrimary={setPrimary}
              cartHref={href(locale, "cart")}
              onLeave={requestClose}
            />
          ) : view === "result" && state.spin ? (
            <div className={freshSpin ? "pw-reveal" : undefined}>
              <p className="eyebrow">{L.dialog.label}</p>
              <h2 id={titleId} className="mt-3 pe-10 font-heading text-4xl leading-tight text-text">
                {L.result.title}
              </h2>
              <PrizeLine template={L.result.prize} label={state.spin.prize.label} />
              <p id={descId} className="mt-3 text-sm leading-relaxed text-text-muted">
                {state.spin.prize.summary}
              </p>
              {!freshSpin ? <p className="mt-3 text-sm leading-relaxed text-text-muted">{L.result.alreadySpun}</p> : null}
              {state.spin.claim === "claim" && signedIn ? (
                <div className={cn(actionBarClass, "mt-7")}>
                  <button ref={setPrimary} type="button" onClick={() => void claim()} aria-disabled={claiming || undefined} className={cn(goldClass, "w-full")}>
                    {claiming ? L.claim.claiming : state.texts.claimCta}
                  </button>
                  {error ? <ErrorNote>{error}</ErrorNote> : null}
                </div>
              ) : state.spin.pending ? (
                <>
                  {/* Signed up on this device, e-mail not verified yet: no sign-up / sign-in offer, only what is missing. */}
                  <p className="mt-5 rounded-md border border-border border-s-4 border-s-gold bg-surface-2 px-4 py-3 text-sm leading-relaxed text-text">
                    {format(L.result.pending, { date: formatWheelDate(state.spin.holdUntil, locale) })} {L.result.checkInbox}
                  </p>
                  <div className={cn(actionBarClass, "mt-7")}>
                    <button ref={setPrimary} type="button" onClick={requestClose} className={cn(secondaryClass, "w-full")}>
                      {L.dialog.close}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-4 text-xs leading-relaxed text-text-muted">{format(L.result.holdUntil, { date: formatWheelDate(state.spin.holdUntil, locale) })}</p>
                  <div className={cn(actionBarClass, "mt-6 flex flex-col gap-3")}>
                    <Link ref={setPrimary} href={registerHref(locale, returnTo)} onClick={requestClose} className={cn(goldClass, "w-full")}>
                      {state.texts.registerCta}
                    </Link>
                    <Link href={signInHref(locale, returnTo)} onClick={requestClose} className={cn(secondaryClass, "w-full")}>
                      {state.texts.signInCta}
                    </Link>
                    {error ? <ErrorNote>{error}</ErrorNote> : null}
                  </div>
                </>
              )}
            </div>
          ) : view === "blocked" ? (
            <>
              {titleEyebrow ? <p className="eyebrow">{L.dialog.label}</p> : null}
              <h2 id={titleId} className={cn("pe-10 font-heading text-4xl leading-tight text-text", titleEyebrow ? "mt-3" : undefined)}>
                {state.texts.title}
              </h2>
              <p id={descId} className="mt-4 text-sm leading-relaxed text-text-muted">
                {state.reason !== "eligible" ? L.errors[state.reason] : L.errors.unavailable}
              </p>
              <button ref={setPrimary} type="button" onClick={requestClose} className={cn(secondaryClass, "mt-8 self-start")}>
                {L.dialog.close}
              </button>
            </>
          ) : (
            <>
              {titleEyebrow ? <p className="eyebrow">{L.dialog.label}</p> : null}
              <h2 id={titleId} className={cn("pe-10 font-heading text-4xl leading-tight text-text", titleEyebrow ? "mt-3" : undefined)}>
                {state.texts.title}
              </h2>
              <p id={descId} className="mt-3 leading-relaxed text-text-muted">
                {state.texts.subtitle}
              </p>
              <ul className="mt-6 space-y-2.5 text-sm leading-relaxed text-text">
                {[L.dialog.everySliceWins, validityText(state.validityHours, locale, L.result), minOrderNote(slices, locale, L)].filter((line): line is string => Boolean(line)).map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <Check aria-hidden className="mt-1 size-3.5 shrink-0 text-gold-text" strokeWidth={2.4} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <h3 className="sr-only">{L.dialog.prizes}</h3>
              <ul className="sr-only">
                {slices.map((s) => (
                  <li key={s.key}>{s.minOrderTotal ? `${s.label}: ${format(L.result.minOrder, { amount: formatPrice(s.minOrderTotal, locale) }, locale)}` : s.label}</li>
                ))}
              </ul>
              <input ref={honeypotRef} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="sr-only" defaultValue="" />
              <div className={cn(actionBarClass, "mt-8")}>
                <button
                  ref={setPrimary}
                  type="button"
                  onClick={() => void spin()}
                  aria-disabled={view === "spinning" || undefined}
                  className={cn(goldClass, "w-full", view === "spinning" ? "cursor-progress" : undefined)}
                >
                  {view === "spinning" ? L.dialog.spinning : L.dialog.spin}
                </button>
                {error ? <ErrorNote>{error}</ErrorNote> : null}
              </div>
              <div className="mt-6 space-y-1.5 text-xs leading-relaxed text-text-muted">
                <p>
                  {withLink(L.dialog.terms, <NewTabLink href={state.links.terms} label={L.dialog.termsLink} hint={L.opensInNewTab} />)}
                </p>
                <p>
                  {withLink(L.dialog.privacy, <NewTabLink href={state.links.privacy} label={L.dialog.privacyLink} hint={L.opensInNewTab} />)}
                </p>
              </div>
              {view === "ready" ? (
                <button
                  type="button"
                  onClick={() => {
                    onNeverShow();
                    requestClose();
                  }}
                  className="mt-6 self-start text-xs text-text-muted underline decoration-border underline-offset-4 transition-colors hover:text-text hover:decoration-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {neverShowLabel}
                </button>
              ) : null}
            </>
          )}
          {/* Phones / short windows: room under the last line (no bottom padding on the column there, so the action bar sits flush). */}
          <div aria-hidden className="pw-spacer h-6 shrink-0" />
          <p aria-live="polite" className="sr-only">
            {announce}
          </p>
        </div>

        <button
          type="button"
          onClick={requestClose}
          aria-label={L?.dialog.close ?? fallback.close}
          className="absolute end-3 top-3 grid size-10 place-items-center rounded-full text-gold-100 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-text-muted sm:hover:bg-surface-2 sm:hover:text-text"
        >
          <X aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
      </div>
    </dialog>
  );
}

/** "Bazı hediyelerde en az sepet tutarı aranır: 50 TL indirim için 300,00 ₺, …" (null when no slice has one). */
function minOrderNote(slices: readonly WheelDisplaySlice[], locale: Locale, L: WheelDialogLabels): string | null {
  const items = slices
    .filter((s) => (s.minOrderTotal ?? 0) > 0)
    .map((s) => format(L.dialog.minOrderItem, { prize: s.label, amount: formatPrice(s.minOrderTotal ?? 0, locale) }, locale));
  return items.length ? format(L.dialog.minOrderNote, { list: items.join(locale === "ar" ? "، " : ", ") }, locale) : null;
}

function registerHref(locale: Locale, returnTo: string | null): string {
  return href(locale, "register") + (returnTo ? `?sonra=${encodeURIComponent(returnTo)}` : "");
}

/** Fills a template's {link} with a node (the terms/privacy sentence). */
function withLink(template: string, link: ReactNode): ReactNode {
  const i = template.indexOf("{link}");
  if (i === -1) return template;
  return (
    <>
      {template.slice(0, i)}
      {link}
      {template.slice(i + "{link}".length)}
    </>
  );
}

function NewTabLink({ href: target, label, hint }: { href: string | null; label: string; hint: string }) {
  if (!target) return <>{label}</>;
  return (
    <a href={target} target="_blank" rel="noopener" className="font-medium text-text underline decoration-gold underline-offset-4 hover:decoration-2">
      {label}
      <span className="sr-only"> {hint}</span>
    </a>
  );
}

/** "Kazandığın hediye: <big prize>" with the template's wording around the prize in every language. */
function PrizeLine({ template, label }: { template: string; label: string }) {
  const [before, after = ""] = template.split("{prize}");
  return (
    <p className="mt-5">
      {before.trim() ? <span className="block text-sm text-text-muted">{before.trim()}</span> : null}
      <span className="mt-1 block font-heading text-[2.6rem] leading-[1.05] text-gold-text">{label}</span>
      {after.trim() ? <span className="block text-sm text-text-muted">{after.trim()}</span> : null}
    </p>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-md border border-border border-s-4 border-s-gold bg-surface-2 px-4 py-3 text-sm leading-relaxed text-text">{children}</p>;
}

function ClaimedView({
  L,
  locale,
  titleId,
  descId,
  claimed,
  copied,
  onCopy,
  setPrimary,
  cartHref,
  onLeave,
}: {
  L: WheelDialogLabels;
  locale: Locale;
  titleId: string;
  descId: string;
  claimed: Claimed;
  copied: boolean;
  onCopy: (code: string) => void;
  setPrimary: (node: HTMLElement | null) => void;
  cartHref: string;
  onLeave: () => void;
}) {
  const { prize, applied } = claimed;
  return (
    <div className="pw-reveal">
      <p className="eyebrow">{L.dialog.label}</p>
      <h2 id={titleId} className="mt-3 pe-10 font-heading text-4xl leading-tight text-text">
        {L.claim.claimedTitle}
      </h2>
      <p className="mt-4 font-heading text-[2.2rem] leading-[1.05] text-gold-text">{prize.label}</p>
      {prize.summary ? <p className="mt-2 text-sm leading-relaxed text-text-muted">{prize.summary}</p> : null}
      <div className="mt-6 rounded-lg border border-dashed border-gold-300/70 bg-surface-2 p-4">
        <p className="text-xs font-medium text-text-muted">{L.claim.code}</p>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
          <bdi dir="ltr" data-wheel-code="" className="font-mono text-xl font-semibold tracking-[0.16em] text-text select-all">
            {prize.code}
          </bdi>
          <button
            type="button"
            onClick={() => onCopy(prize.code)}
            className="inline-flex min-h-10 items-center gap-2 rounded-control border border-border px-3.5 text-sm text-text transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {copied ? <Check aria-hidden className="size-4 text-gold-text" /> : <Copy aria-hidden className="size-4" />}
            {copied ? L.claim.copied : L.claim.copy}
          </button>
        </div>
      </div>
      <p id={descId} className="mt-4 text-sm leading-relaxed text-text">
        {applied ? L.claim.applied : L.claim.kept}
      </p>
      <p className="mt-1 text-xs text-text-muted">{format(L.claim.expires, { date: formatWheelDate(prize.endsAt, locale) })}</p>
      <div className={cn(actionBarClass, "mt-7 flex flex-col gap-3")}>
        <Link ref={setPrimary} href={cartHref} onClick={onLeave} className={goldClass}>
          {L.claim.goToCart}
        </Link>
        <button type="button" onClick={onLeave} className={secondaryClass}>
          {L.claim.continueShopping}
        </button>
      </div>
    </div>
  );
}

/** Confetti pieces (deterministic): a burst from the hub that drifts down and fades. */
const CONFETTI_COLORS = ["var(--gold-300)", "var(--gold-100)", "#ffffff", "var(--gold-200)", "var(--gold-50)", "var(--brand-300)"];
const CONFETTI = Array.from({ length: 30 }, (_, i) => {
  const rnd = (k: number) => {
    const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const angle = (i / 30) * Math.PI * 2 + (rnd(1) - 0.5) * 0.6;
  const distance = 120 + rnd(2) * 95;
  const shape = i % 3;
  return {
    "--x": `${Math.round(Math.cos(angle) * distance)}px`,
    "--y": `${Math.round(Math.sin(angle) * distance * 0.8 - 26)}px`,
    "--rot": `${Math.round((rnd(3) - 0.5) * 900)}deg`,
    "--fall": `${Math.round(70 + rnd(6) * 90)}px`,
    "--w": shape === 1 ? "7px" : shape === 2 ? "4px" : "6px",
    "--h": shape === 1 ? "7px" : shape === 2 ? "14px" : "10px",
    "--r": shape === 1 ? "50%" : "1.5px",
    "--c": CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    animationDelay: `${Math.round(rnd(4) * 140)}ms`,
    animationDuration: `${1300 + Math.round(rnd(5) * 650)}ms`,
  } as CSSProperties;
});

function Celebration() {
  return (
    <div aria-hidden className="pw-confetti pointer-events-none absolute inset-0">
      <span className="pw-ring" />
      {CONFETTI.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </div>
  );
}

const goldClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-gold-300 px-6 text-center text-sm font-semibold tracking-[0.06em] text-brand-950 uppercase shadow-[0_10px_24px_-12px_rgb(161_124_40/0.9)] transition-[background-color,box-shadow,translate] duration-200 hover:bg-gold-200 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring aria-disabled:cursor-progress aria-disabled:opacity-80 motion-reduce:transition-none rtl:tracking-normal rtl:normal-case";
/**
 * The step's main action. Phones and short windows: pinned to the bottom of the scrolling text column
 * (sticky; rules in DIALOG_CSS), full width, on the surface colour with a soft edge, above the home
 * indicator; otherwise in the flow.
 */
const actionBarClass = "pw-actions";
const secondaryClass =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-border px-6 text-center text-sm font-medium text-text transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring motion-reduce:transition-none";

const DIALOG_CSS = `
.pw-dialog::backdrop{background:rgb(2 21 56/.62);backdrop-filter:blur(3px);animation:pw-fade .3s ease-out both}
.pw-dialog[data-closing]::backdrop{animation:pw-fade-out .17s ease-in both}
.pw-panel{animation:pw-in .45s cubic-bezier(.22,1,.36,1) both}
.pw-dialog[data-closing] .pw-panel{animation:pw-out .17s ease-in both}
@media (max-width:639.98px){.pw-panel{animation-name:pw-sheet}.pw-dialog[data-closing] .pw-panel{animation-name:pw-sheet-out}}
@keyframes pw-fade{from{opacity:0}}
@keyframes pw-fade-out{to{opacity:0}}
@keyframes pw-in{from{opacity:0;transform:translateY(16px) scale(.985)}}
@keyframes pw-out{to{opacity:0;transform:translateY(10px) scale(.99)}}
@keyframes pw-sheet{from{transform:translateY(100%)}}
@keyframes pw-sheet-out{to{transform:translateY(100%)}}
.pw-stage{background:radial-gradient(58% 52% at 50% 52%,color-mix(in srgb,var(--gold-300) 24%,transparent),transparent 74%),radial-gradient(130% 100% at 50% 0%,var(--brand-800),var(--brand-950) 72%)}
.pw-pop{animation:pw-pop .75s cubic-bezier(.2,.8,.2,1)}
@keyframes pw-pop{38%{transform:scale(1.035)}}
.pw-reveal{animation:pw-reveal .6s cubic-bezier(.22,1,.36,1) both}
@keyframes pw-reveal{from{opacity:0;transform:translateY(10px)}}
.pw-confetti i{position:absolute;left:50%;top:50%;width:var(--w);height:var(--h);margin:calc(var(--h)/-2) 0 0 calc(var(--w)/-2);background:var(--c);border-radius:var(--r);opacity:0;animation-name:pw-burst;animation-timing-function:cubic-bezier(.12,.7,.3,1);animation-fill-mode:forwards}
@keyframes pw-burst{0%{opacity:0;transform:translate(0,0) rotate(0) scale(.4)}10%{opacity:1}55%{opacity:1;transform:translate(var(--x),var(--y)) rotate(var(--rot)) scale(1)}100%{opacity:0;transform:translate(calc(var(--x)*1.12),calc(var(--y) + var(--fall))) rotate(calc(var(--rot)*1.7)) scale(.85)}}
.pw-ring{position:absolute;left:50%;top:50%;width:44%;aspect-ratio:1;margin:-22% 0 0 -22%;border-radius:50%;border:2px solid var(--gold-200);opacity:0;animation:pw-ring 1.1s cubic-bezier(.2,.7,.2,1) .04s forwards}
@keyframes pw-ring{0%{opacity:.95;transform:scale(.4)}100%{opacity:0;transform:scale(2)}}
@media (prefers-reduced-motion:reduce){.pw-confetti{display:none}}
.pw-dialog .pw-spacer{display:none}
@media (max-width:639.98px){.pw-dialog .pw-col{padding-bottom:0}.pw-dialog .pw-spacer{display:block}.pw-dialog .pw-actions{position:sticky;bottom:0;z-index:10;margin-inline:-1.5rem;padding:.75rem 1.5rem max(1rem,env(safe-area-inset-bottom));background:var(--surface);box-shadow:0 -14px 14px -12px rgb(2 21 56/.22)}}
@media (min-width:640px) and (max-height:32rem){.pw-dialog .pw-stage{padding-block:1.25rem}.pw-dialog .pw-wheel{max-width:min(22.5rem,calc(100dvh - 6rem))}.pw-dialog .pw-col{padding-top:2rem;padding-bottom:0}.pw-dialog .pw-spacer{display:block}.pw-dialog .pw-actions{position:sticky;bottom:0;z-index:10;margin-inline:-2.5rem;padding:.75rem 2.5rem 1rem;background:var(--surface);box-shadow:0 -14px 14px -12px rgb(2 21 56/.22)}}
`;
