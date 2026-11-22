"use client";
// The floating gift wheel control (lazy chunk, loaded by GiftWheelIsland after idle): the teaser pill at
// the bottom-start corner (WhatsApp owns bottom-end), the minimized gift icon, the reminder chip with a
// real countdown for a signed-in visitor's unused prize, the automatic opening (desktop only: delay or
// exit intent, once per cooldown) and the lazy dialog.
//
// Rules (contract §1.1): appears after idle + viewer + teaserDelaySeconds, only on eligible pages
// (route rules on every client navigation, the rendered page checked too); signed-in visitors are asked
// the server first (staff, business, already claimed, ordered before), guests when they open it; phones
// never open it by themselves; closing shrinks it to the gift icon, "Bir daha gösterme" hides it for 30
// days; position: fixed and transform/opacity only (no layout shift).
import { Gift, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useId, useRef, useState, useSyncExternalStore, type ComponentType, type Ref } from "react";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { href } from "@/i18n/paths";
import type { WheelActivePrize, WheelEligibilityReason, WheelSpinView, WheelTeaser } from "@/lib/wheel/types";
import { cn } from "@/lib/utils";
import { formatCountdown, formatWheelDate } from "./countdown";
import type { GiftWheelDialogProps } from "./GiftWheelDialog";
import type { WheelTeaserLabels } from "./labels";
import { launcherMode, teaserPrizeLabel } from "./launcher-model";
import { isWheelSpendPath, wheelBlockedByPage, wheelRouteAllowed } from "./route-rules";
import { useNowSeconds } from "./use-countdown";
import { useWheelApi, type WheelApi } from "./wheel-api";
import {
  canAutoOpen,
  clearCachedWheelData,
  parseWheelStore,
  readCachedWheelData,
  readWheelStoreRaw,
  subscribeWheelStore,
  withChipHidden,
  withCollapsed,
  withNeverShow,
  withoutPrize,
  withPrize,
  withPrompted,
  writeCachedWheelData,
  writeWheelStore,
  type WheelDialogData,
  type WheelStore,
} from "./wheel-storage";
import { isTeaserInSchedule } from "./wheel-teaser";
import WheelMark from "./WheelMark";

/** The layout's teaser without the panel text (already resolved into labels.label). */
export type IslandTeaser = Omit<WheelTeaser, "teaserText">;
export type WheelLauncherProps = { locale: Locale; teaser: IslandTeaser; labels: WheelTeaserLabels; signedIn: boolean };

/** Shown instead of the dialog when its chunk cannot be loaded: closes again at once. */
function DialogUnavailable({ onClose }: GiftWheelDialogProps) {
  useEffect(() => onClose(null), [onClose]);
  return null;
}

const dialogModule = () => import("./GiftWheelDialog");
const GiftWheelDialog = lazy<ComponentType<GiftWheelDialogProps>>(() => dialogModule().catch(() => ({ default: DialogUnavailable })));
const prefetchDialog = () => {
  void dialogModule().catch(() => {});
};

/**
 * Desktop pointer on a desktop-sized viewport (the only place the dialog may open by itself): a mouse on a
 * phone-sized window or a renderer emulating only a phone viewport never gets the full-screen modal.
 */
const isDesktopPointer = () => window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 768px)").matches;

/** Nothing else is in the way: tab visible, no other dialog or sheet open, nobody typing, an eligible page. */
function politeToOpen(): boolean {
  if (document.visibilityState !== "visible") return false;
  if (document.querySelector("dialog[open]")) return false;
  if (document.documentElement.style.overflow === "hidden") return false; // cart sheet, mobile menu, legal modal
  const active = document.activeElement;
  if (active instanceof HTMLElement && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return false;
  return wheelRouteAllowed(window.location.pathname) && !wheelBlockedByPage(document);
}

/** The cached answer (signed-in visitors, per tab) or a fresh one. */
async function loadWheelData(api: WheelApi, locale: Locale, signature: string, useCache: boolean): Promise<WheelDialogData> {
  if (useCache) {
    const cached = readCachedWheelData(signature, Date.now());
    if (cached) return cached;
  }
  const fresh = await api.load(locale);
  if (useCache && fresh.state) writeCachedWheelData(signature, fresh, Date.now());
  return fresh;
}

const LAUNCHER_CSS = `
.pw-mark-face{transform-box:view-box;transform-origin:50% 50%}
.pw-mark-in .pw-mark-face{animation:pw-mark-in 1.3s cubic-bezier(.3,.1,.1,1) .15s both}
.pw-mark-busy .pw-mark-face{animation:pw-mark-busy .8s linear infinite}
@keyframes pw-mark-in{from{transform:rotate(-320deg)}to{transform:rotate(0)}}
@keyframes pw-mark-busy{from{transform:rotate(0)}to{transform:rotate(360deg)}}
`;

const pillClass =
  "relative flex min-h-12 items-center gap-2.5 rounded-full bg-brand-950 text-sm font-medium text-gold-50 shadow-[0_16px_36px_-16px_rgb(2_21_56/0.75)] ring-1 ring-gold-300/70 transition-[translate,box-shadow] duration-300 ease-luxe hover:-translate-y-0.5 hover:ring-gold-300 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring motion-reduce:transition-none";
const closeDotClass =
  "absolute -end-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-surface text-text-muted shadow-sm ring-1 ring-border transition-colors before:absolute before:-inset-2 before:content-[''] hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/**
 * The minimized icon's "Bir daha gösterme" dot: no enlarged hit area and set a little further out, so a tap
 * on the 48 px gift icon (its centre included) always opens the wheel instead of hiding it for 30 days.
 */
const collapsedDotClass =
  "absolute -end-2 -top-2 grid size-6 place-items-center rounded-full bg-surface text-text-muted shadow-sm ring-1 ring-border transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function WheelLauncher({ locale, teaser, labels, signedIn }: WheelLauncherProps) {
  const api = useWheelApi();
  const pathname = usePathname();
  const raw = useSyncExternalStore(subscribeWheelStore, readWheelStoreRaw, () => null);
  const store = parseWheelStore(raw, teaser.signature);

  const [now, setNow] = useState(0);
  const [data, setData] = useState<WheelDialogData | null>(null);
  const [open, setOpen] = useState<{ auto: boolean; failed: boolean; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageBlocked, setPageBlocked] = useState(false);
  const buttonRef = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const loading = useRef<Promise<WheelDialogData> | null>(null);
  const stale = useRef(false);
  const mountedAt = useRef(0);

  const routeOk = wheelRouteAllowed(pathname) && !pageBlocked;
  const mode = launcherMode({ signedIn, data, store, now, routeOk, inSchedule: now > 0 && isTeaserInSchedule(teaser, now) });
  const prizeLabel = teaserPrizeLabel({ signedIn, data, store, now });

  const updateStore = useCallback(
    (change: (s: WheelStore) => WheelStore) => writeWheelStore(change(parseWheelStore(readWheelStoreRaw(), teaser.signature))),
    [teaser.signature],
  );

  /** Loads the wheel once (in flight requests are shared); `fresh` drops the per-tab cache first. */
  const loadData = useCallback(
    (fresh = false): Promise<WheelDialogData> => {
      if (fresh) {
        clearCachedWheelData();
        loading.current = null;
      }
      if (!loading.current) {
        const request = loadWheelData(api, locale, teaser.signature, signedIn);
        loading.current = request;
        request.catch(() => {
          if (loading.current === request) loading.current = null;
        });
      }
      return loading.current;
    },
    [api, locale, teaser.signature, signedIn],
  );

  // The teaser appears after its delay (the island already waited for idle and the viewer).
  useEffect(() => {
    mountedAt.current = Date.now();
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, teaser.teaserDelaySeconds) * 1000);
    return () => window.clearTimeout(timer);
  }, [teaser.teaserDelaySeconds]);

  // Keep the clock for hold/hide expiries roughly current while the page stays open.
  useEffect(() => {
    if (now === 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [now]);

  // Every navigation: check the rendered page (legal text, 404) once it has committed and again a
  // little later (streamed content); remember visits to cart/checkout/order (a prize may be spent).
  useEffect(() => {
    if (isWheelSpendPath(pathname)) {
      stale.current = true;
      clearCachedWheelData();
    }
    const check = () => setPageBlocked(wheelBlockedByPage(document));
    const first = window.setTimeout(check, 0);
    const second = window.setTimeout(check, 900);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [pathname]);

  // Signed-in visitors: ask the server before showing anything (and again after a possible spend).
  useEffect(() => {
    if (!signedIn) {
      clearCachedWheelData(); // a signed-out page load forgets the previous account's answer
      return;
    }
    if (!routeOk) return;
    const fresh = stale.current;
    stale.current = false;
    let alive = true;
    loadData(fresh)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [signedIn, routeOk, loadData]);

  // The device hint about a guest's won prize goes once the server has none to show (claimed, expired, or
  // another person's on a shared browser) and whenever the visitor is signed in (a held spin is then the
  // account's and comes from the server), so the next person never sees someone else's prize label.
  const hintedPrize = Boolean(store.prize);
  useEffect(() => {
    if (!hintedPrize || !data?.state) return;
    if (signedIn || !data.state.spin) updateStore(withoutPrize);
  }, [hintedPrize, data, signedIn, updateStore]);

  // Warm the dialog chunk when the browser is idle once the teaser is up, so opening is instant.
  useEffect(() => {
    if (mode !== "teaser" && mode !== "collapsed") return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (h: number) => void };
    if (typeof w.requestIdleCallback !== "function") {
      const timer = window.setTimeout(prefetchDialog, 2500);
      return () => window.clearTimeout(timer);
    }
    const handle = w.requestIdleCallback(prefetchDialog);
    return () => w.cancelIdleCallback?.(handle);
  }, [mode]);

  const requestOpen = async (auto: boolean) => {
    if (open || busy) return;
    restoreFocus.current = !auto;
    setBusy(!auto);
    let loaded: WheelDialogData | null = data;
    try {
      const [d] = await Promise.all([loaded ? Promise.resolve(loaded) : loadData(), dialogModule().catch(() => null)]);
      loaded = d;
      setData(d);
    } catch {
      loaded = null;
    }
    setBusy(false);
    if (auto) {
      // Never pop up a refusal by itself, and re-check that nothing got in the way meanwhile.
      if (!loaded?.state || (!loaded.state.eligible && !loaded.state.spin) || !politeToOpen()) return;
    }
    updateStore((s) => withPrompted(s, Date.now()));
    // The teaser keeps the text it had while the dialog is open (a change under the backdrop would
    // shift the pill in RTL without any input; on close the shift belongs to the click).
    setOpen({ auto, failed: !loaded, label: prizeLabel ?? labels.label });
  };
  const openByItself = useEffectEvent(() => void requestOpen(true));

  // Desktop only: open by itself after autoOpenSeconds or on exit intent, at most once per cooldown.
  useEffect(() => {
    if (mode !== "teaser" || open || prizeLabel) return;
    if (teaser.autoOpenSeconds <= 0 && !teaser.exitIntent) return;
    if (!isDesktopPointer() || !canAutoOpen(parseWheelStore(readWheelStoreRaw(), teaser.signature), Date.now(), teaser.autoOpenCooldownDays)) return;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      openByItself();
    };
    let timer: number | undefined;
    if (teaser.autoOpenSeconds > 0) {
      const due = mountedAt.current + teaser.autoOpenSeconds * 1000 - Date.now();
      timer = window.setTimeout(fire, Math.max(1000, due));
    }
    const onMouseOut = (event: MouseEvent) => {
      if (!event.relatedTarget && event.clientY <= 0) fire();
    };
    if (teaser.exitIntent) document.addEventListener("mouseout", onMouseOut);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseout", onMouseOut);
    };
  }, [mode, open, prizeLabel, teaser.autoOpenSeconds, teaser.exitIntent, teaser.autoOpenCooldownDays, teaser.signature]);

  // Dialog callbacks (used in its event handlers only, so they need no stable identity).
  const onClose = (claimed: WheelActivePrize | null) => {
    setOpen(null);
    if (!claimed) updateStore(withCollapsed);
    if (restoreFocus.current) {
      restoreFocus.current = false;
      window.requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
    }
  };

  const onSpun = (spin: WheelSpinView) => {
    setData((d) => (d?.state ? { ...d, state: { ...d.state, spin } } : d));
    if (signedIn) clearCachedWheelData();
    else updateStore((s) => withPrize(s, { label: spin.prize.label, holdUntil: spin.holdUntil }));
  };

  const onClaimed = (prize: WheelActivePrize) => {
    if (!data?.state) return;
    const next: WheelDialogData = { ...data, state: { ...data.state, activePrize: prize, spin: null, eligible: false } };
    writeCachedWheelData(teaser.signature, next, Date.now());
    setData(next);
  };

  const onRefused = (reason: WheelEligibilityReason) => {
    setData((d) => (d?.state ? { ...d, state: { ...d.state, eligible: false, reason } } : d));
  };

  const onNeverShow = () => updateStore((s) => withNeverShow(s, Date.now()));

  const prefetch = () => {
    prefetchDialog();
    if (!signedIn && !data) loadData().then((d) => setData(d), () => {});
  };

  const setButton = (node: HTMLElement | null) => {
    buttonRef.current = node;
  };

  return (
    <>
      <style href="prestij-wheel-launcher" precedence="default">
        {LAUNCHER_CSS}
      </style>
      {mode !== "none" ? (
        <div className="fixed start-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 md:start-6 print:hidden">
          {mode === "teaser" ? (
            <div className="relative motion-safe:animate-fade-up">
              <button
                ref={setButton}
                data-wheel-teaser=""
                type="button"
                aria-haspopup="dialog"
                aria-label={prizeLabel && !open ? `${labels.collapsed}: ${prizeLabel}` : undefined}
                aria-busy={busy || undefined}
                onClick={() => void requestOpen(false)}
                onPointerEnter={prefetch}
                onFocus={prefetch}
                className={cn(pillClass, "max-w-[min(20rem,calc(100vw-6.5rem))] py-1.5 ps-1.5 pe-5 text-start", busy ? "pw-mark-busy" : "pw-mark-in")}
              >
                <WheelMark className="size-9 shrink-0" />
                <span className="truncate">{open?.label ?? prizeLabel ?? labels.label}</span>
              </button>
              <button type="button" aria-label={labels.hide} onClick={() => updateStore(withCollapsed)} className={closeDotClass}>
                <X aria-hidden className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          ) : mode === "collapsed" ? (
            <div role="group" aria-label={labels.collapsed} className="relative motion-safe:animate-fade-in">
              <button
                ref={setButton}
                data-wheel-teaser="collapsed"
                type="button"
                aria-haspopup="dialog"
                aria-label={prizeLabel ? `${labels.open}: ${prizeLabel}` : labels.open}
                aria-busy={busy || undefined}
                onClick={() => void requestOpen(false)}
                onPointerEnter={prefetch}
                onFocus={prefetch}
                className={cn(pillClass, "size-12 justify-center p-0", busy ? "pw-mark-busy" : undefined)}
              >
                <WheelMark className="size-9" />
              </button>
              <button type="button" aria-label={labels.neverShow} title={labels.neverShow} onClick={onNeverShow} className={collapsedDotClass}>
                <X aria-hidden className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          ) : data?.state?.activePrize ? (
            <PrizeChip
              prize={data.state.activePrize}
              locale={locale}
              data={data}
              hideLabel={labels.hide}
              cartHref={href(locale, "cart")}
              linkRef={setButton}
              onHide={() => updateStore((s) => withChipHidden(s, Date.now()))}
            />
          ) : null}
        </div>
      ) : null}
      {open ? (
        <Suspense fallback={null}>
          <GiftWheelDialog
            locale={locale}
            signedIn={signedIn}
            data={open.failed ? null : data}
            dialogLabel={labels.collapsed}
            neverShowLabel={labels.neverShow}
            onClose={onClose}
            onSpun={onSpun}
            onClaimed={onClaimed}
            onRefused={onRefused}
            onNeverShow={onNeverShow}
          />
        </Suspense>
      ) : null}
    </>
  );
}

/** "Hediyeniz bekliyor · 2g 03:14": a real countdown to the coupon's end, linking to the cart. */
function PrizeChip({
  prize,
  locale,
  data,
  hideLabel,
  cartHref,
  linkRef,
  onHide,
}: {
  prize: WheelActivePrize;
  locale: Locale;
  data: WheelDialogData;
  hideLabel: string;
  cartHref: string;
  linkRef: Ref<HTMLAnchorElement>;
  onHide: () => void;
}) {
  const nowSec = useNowSeconds(null);
  const describedBy = useId();
  const end = Date.parse(prize.endsAt);
  if (nowSec === null || !Number.isFinite(end) || end <= nowSec * 1000) return null;
  const time = formatCountdown(end - nowSec * 1000, locale, data.labels.countdown);
  const [before, after = ""] = data.labels.chip.text.split("{time}");
  return (
    <div className="relative motion-safe:animate-fade-up">
      <Link ref={linkRef} href={cartHref} data-wheel-chip="" aria-describedby={describedBy} className={cn(pillClass, "py-1.5 ps-1.5 pe-5")}>
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-300 text-brand-950">
          <Gift className="size-4.5" strokeWidth={1.8} />
        </span>
        <span className="whitespace-nowrap">
          {/* Under 380 px only the countdown shows (the words stay for screen readers): WhatsApp needs the room. */}
          <span className="max-[379px]:sr-only">{before}</span>
          <bdi className="font-semibold text-gold-200 tabular-nums">{time}</bdi>
          <span className="max-[379px]:sr-only">{after}</span>
        </span>
      </Link>
      <span id={describedBy} hidden>
        {format(data.labels.chip.label, { date: formatWheelDate(prize.endsAt, locale) })}
      </span>
      <button type="button" aria-label={hideLabel} onClick={onHide} className={closeDotClass}>
        <X aria-hidden className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
