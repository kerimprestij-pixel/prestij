"use client";

// The customer's subscriptions on /hesap/abonelikler: one card each (plan, next order, items, address,
// payment, orders) with skip / pause / resume / plan / address / cancel. Every change goes through the
// changeMySubscription Server Action, which re-renders the page with the saved state.
import { CalendarClock, CircleAlert, CircleCheck, MapPin, PackageOpen, Repeat, SkipForward } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { inputClass, SelectField, TextField } from "@/components/checkout/fields";
import { buttonClass } from "@/components/sections/button-styles";
import type { AddressData } from "@/db/schema/commerce";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import Img from "@/lib/media/Img";
import type { MediaLike } from "@/lib/media/types";
import { changeMySubscription, type SubscriptionActionResult } from "@/lib/subscriptions/actions";
import type { SubscriptionStatus } from "@/lib/subscriptions/types";
import { cn } from "@/lib/utils";

type AccountLabels = Messages["subscriptions"]["account"] & { planSaving: string; optional: string; select: string };

export type AccountSubscriptionCard = {
  id: number;
  status: SubscriptionStatus;
  statusLabel: string;
  title: string;
  planId: number;
  planName: string;
  percent: number;
  nextRunLabel: string;
  skipNext: boolean;
  skippedNote: string | null;
  failed: boolean;
  startedLabel: string;
  cancelledNote: string | null;
  paymentLabel: string;
  items: { variantId: number; name: string; detail: string | null; quantity: number; image: MediaLike | null; accentColor: string | null; href: string | null }[];
  address: AddressData;
  addressLines: string[];
  orders: { orderNumber: string; href: string; statusLabel: string; totalLabel: string; dateLabel: string; kindLabel: string }[];
};

export type SkipPrompt = { valid: true; subscriptionId: number; token: string; text: string } | { valid: false; text: string };

type Props = {
  locale: Locale;
  subscriptions: AccountSubscriptionCard[];
  plans: { id: number; name: string; percent: number }[];
  provinces: string[];
  skipPrompt: SkipPrompt | null;
  productsHref: string;
  labels: AccountLabels;
};

type Change =
  | { kind: "pause" | "resume" | "unskip" | "cancel" }
  | { kind: "skip"; token?: string }
  | { kind: "plan"; planId: number }
  | { kind: "address"; address: Record<string, string> };

type Feedback = { tone: "success" | "error"; text: string; id: number } | null;

function useChange(locale: Locale, subscriptionId: number) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const run = (change: Change, onDone?: (ok: boolean) => void) => {
    startTransition(async () => {
      let result: SubscriptionActionResult;
      try {
        result = await changeMySubscription({ locale, subscriptionId, change });
      } catch {
        result = { ok: false, error: "" };
      }
      setFieldErrors(result.ok ? {} : (result.fieldErrors ?? {}));
      setFeedback(result.ok ? { tone: "success", text: result.message, id: Date.now() } : { tone: "error", text: result.error, id: Date.now() });
      onDone?.(result.ok);
    });
  };
  return { pending, feedback, fieldErrors, run };
}

const STATUS_TONE: Record<SubscriptionStatus, string> = {
  active: "border-emerald-700/25 bg-emerald-700/5 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  paused: "border-gold/40 bg-gold/10 text-text",
  past_due: "border-red-700/25 bg-red-700/5 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300",
  cancelled: "border-border bg-surface-2 text-text-muted",
};

function Note({ tone, children, live }: { tone: "success" | "error" | "info"; children: ReactNode; live?: boolean }) {
  const Icon = tone === "error" ? CircleAlert : tone === "success" ? CircleCheck : CalendarClock;
  return (
    <p
      role={live ? "status" : undefined}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm leading-relaxed",
        tone === "error" && "border-red-700/25 bg-red-700/5 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300",
        tone === "success" && "border-emerald-700/25 bg-emerald-700/5 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
        tone === "info" && "border-gold/40 bg-gold/8 text-text",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const smallButton = (variant: "primary" | "secondary" | "danger" = "secondary") =>
  cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-xs font-medium uppercase tracking-[0.12em] transition-colors rtl:tracking-normal",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-progress disabled:opacity-60",
    variant === "primary" && "bg-brand text-brand-contrast hover:bg-brand-800",
    variant === "secondary" && "border border-text/20 text-text hover:border-gold",
    variant === "danger" && "border border-red-700/30 text-red-800 hover:border-red-700 dark:border-red-400/40 dark:text-red-300",
  );

export default function AccountSubscriptions({ locale, subscriptions, plans, provinces, skipPrompt, productsHref, labels }: Props) {
  if (subscriptions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center sm:p-12">
        <PackageOpen aria-hidden className="mx-auto size-10 text-gold-text dark:text-gold" strokeWidth={1.25} />
        <h2 className="mt-5 font-heading text-3xl text-text">{labels.empty}</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">{labels.emptyText}</p>
        <Link href={productsHref} className={buttonClass("primary", "mt-8")}>
          {labels.emptyCta}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {skipPrompt && !skipPrompt.valid ? <Note tone="info">{skipPrompt.text}</Note> : null}
      {subscriptions.map((s) => (
        <SubscriptionCard
          key={s.id}
          locale={locale}
          sub={s}
          plans={plans}
          provinces={provinces}
          labels={labels}
          skipPrompt={skipPrompt?.valid && skipPrompt.subscriptionId === s.id ? skipPrompt : null}
        />
      ))}
    </div>
  );
}

function SubscriptionCard({
  locale,
  sub,
  plans,
  provinces,
  labels,
  skipPrompt,
}: {
  locale: Locale;
  sub: AccountSubscriptionCard;
  plans: Props["plans"];
  provinces: string[];
  labels: AccountLabels;
  skipPrompt: Extract<SkipPrompt, { valid: true }> | null;
}) {
  const { pending, feedback, fieldErrors, run } = useChange(locale, sub.id);
  const [panel, setPanel] = useState<"plan" | "address" | "cancel" | null>(null);
  const [planId, setPlanId] = useState(sub.planId);
  const [skipDone, setSkipDone] = useState(false);
  const headingId = useId();
  const a = labels.actions;
  const active = sub.status === "active";
  const cancelled = sub.status === "cancelled";
  const otherPlans = plans.filter((p) => p.id !== sub.planId);
  const close = () => setPanel(null);

  const submitAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Field names are "sub-<id>.<field>" (unique ids per card); the action takes the plain field keys.
    const prefix = `sub-${sub.id}.`;
    const data: Record<string, string> = {};
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (key.startsWith(prefix) && typeof value === "string") data[key.slice(prefix.length)] = value;
    }
    run({ kind: "address", address: data }, (ok) => ok && close());
  };

  return (
    <article aria-labelledby={headingId} className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_30px_60px_-45px_rgb(2_21_56/0.3)]" data-subscription-id={sub.id}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-5 sm:px-7">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2">
            <Repeat aria-hidden className="size-3.5" strokeWidth={1.75} />
            {sub.title}
          </p>
          <h2 id={headingId} className="mt-2 font-heading text-2xl text-text sm:text-3xl">
            {sub.planName}
            {sub.percent > 0 ? <span className="ms-3 align-middle text-sm font-normal text-gold-text dark:text-gold">{format(labels.planSaving, { percent: sub.percent }, locale)}</span> : null}
          </h2>
        </div>
        <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium", STATUS_TONE[sub.status])}>{sub.statusLabel}</span>
      </header>

      <div className="flex flex-col gap-6 px-5 py-6 sm:px-7">
        {skipPrompt && !skipDone ? (
          <div className="rounded-md border border-gold/50 bg-gold/10 p-4 sm:p-5">
            <p className="font-heading text-xl text-text">{labels.skipLink.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">{skipPrompt.text}</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => run({ kind: "skip", token: skipPrompt.token }, (ok) => setSkipDone(ok))}
              className={cn(smallButton("primary"), "mt-4")}
            >
              <SkipForward aria-hidden className="size-4" strokeWidth={1.75} />
              {pending ? a.saving : labels.skipLink.confirm}
            </button>
          </div>
        ) : null}

        {feedback ? (
          <Note key={feedback.id} tone={feedback.tone} live>
            {feedback.text}
          </Note>
        ) : null}

        <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
          {!cancelled ? (
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-text-muted">{labels.nextOrder}</dt>
              <dd className={cn("mt-1 text-text", sub.skipNext && "line-through decoration-text-muted/60")}>{sub.status === "paused" ? "—" : sub.nextRunLabel}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-text-muted">{labels.payment}</dt>
            <dd className="mt-1 text-text">{sub.paymentLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-text-muted">{labels.started}</dt>
            <dd className="mt-1 text-text">{sub.startedLabel}</dd>
          </div>
        </dl>

        {sub.skippedNote ? <Note tone="info">{sub.skippedNote}</Note> : null}
        {sub.status === "paused" ? <Note tone="info">{labels.pausedNote}</Note> : null}
        {sub.cancelledNote ? <Note tone="info">{sub.cancelledNote}</Note> : null}
        {sub.failed ? <Note tone="error">{labels.failedNote}</Note> : null}

        <div className="grid gap-6 md:grid-cols-5">
          <section className="md:col-span-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-text-muted">{labels.items}</h3>
            <ul className="mt-3 divide-y divide-border">
              {sub.items.map((item) => (
                <li key={item.variantId} className="flex items-center gap-4 py-3">
                  <div className="relative aspect-[4/5] w-14 shrink-0 overflow-hidden rounded-sm bg-surface-2" style={item.image?.dominantColor ? { backgroundColor: item.image.dominantColor } : undefined}>
                    {item.image ? <Img media={item.image} alt={item.name} locale={locale} sizes="56px" fill /> : null}
                    <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5" style={{ backgroundColor: item.accentColor ?? "var(--gold)" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-heading text-lg leading-snug text-text">
                      {item.href ? (
                        <Link href={item.href} className="hover:text-gold-text dark:hover:text-gold">
                          {item.name}
                        </Link>
                      ) : (
                        item.name
                      )}
                    </p>
                    {item.detail ? <p className="truncate text-xs text-text-muted">{item.detail}</p> : null}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-text-muted">× {item.quantity}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">{labels.priceNote}</p>
          </section>
          <section className="md:col-span-2">
            <h3 className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-text-muted">
              <MapPin aria-hidden className="size-3.5" strokeWidth={1.75} />
              {labels.address}
            </h3>
            <address className="mt-3 text-sm not-italic leading-relaxed text-text">
              {sub.addressLines.map((line, i) => (
                <span key={i} className="block" dir={i === sub.addressLines.length - 1 && line.startsWith("+") ? "ltr" : undefined}>
                  {line}
                </span>
              ))}
            </address>
          </section>
        </div>

        {!cancelled ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            {active && !sub.skipNext ? (
              <button type="button" disabled={pending} onClick={() => run({ kind: "skip" })} className={smallButton()}>
                <SkipForward aria-hidden className="size-4" strokeWidth={1.75} />
                {a.skip}
              </button>
            ) : null}
            {active && sub.skipNext ? (
              <button type="button" disabled={pending} onClick={() => run({ kind: "unskip" })} className={smallButton()}>
                {a.unskip}
              </button>
            ) : null}
            {sub.status === "active" || sub.status === "past_due" ? (
              <button type="button" disabled={pending} onClick={() => run({ kind: "pause" })} className={smallButton()}>
                {a.pause}
              </button>
            ) : null}
            {sub.status === "paused" ? (
              <button type="button" disabled={pending} onClick={() => run({ kind: "resume" })} className={smallButton("primary")}>
                {a.resume}
              </button>
            ) : null}
            {otherPlans.length > 0 ? (
              <button type="button" aria-expanded={panel === "plan"} onClick={() => setPanel(panel === "plan" ? null : "plan")} className={smallButton()}>
                {a.changePlan}
              </button>
            ) : null}
            <button type="button" aria-expanded={panel === "address"} onClick={() => setPanel(panel === "address" ? null : "address")} className={smallButton()}>
              {a.changeAddress}
            </button>
            <button type="button" aria-expanded={panel === "cancel"} onClick={() => setPanel(panel === "cancel" ? null : "cancel")} className={smallButton("danger")}>
              {a.cancel}
            </button>
          </div>
        ) : null}

        {panel === "plan" ? (
          <form
            className="flex flex-col gap-4 rounded-md border border-border bg-bg p-4 sm:flex-row sm:items-end sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              run({ kind: "plan", planId }, (ok) => ok && close());
            }}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm text-text">
              <span>{labels.plan}</span>
              <select value={planId} onChange={(e) => setPlanId(Number(e.target.value))} className={cn(inputClass, "cursor-pointer")}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.percent > 0 ? `${p.name} · ${format(labels.planSaving, { percent: p.percent }, locale)}` : p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={pending || planId === sub.planId} className={smallButton("primary")}>
                {pending ? a.saving : a.save}
              </button>
              <button type="button" onClick={close} className={smallButton()}>
                {a.close}
              </button>
            </div>
          </form>
        ) : null}

        {panel === "address" ? (
          <AddressForm sub={sub} provinces={provinces} labels={labels} pending={pending} errors={fieldErrors} onSubmit={submitAddress} onCancel={close} />
        ) : null}

        {panel === "cancel" ? (
          <div role="alertdialog" aria-labelledby={`${headingId}-cancel`} className="rounded-md border border-red-700/25 bg-red-700/5 p-4 dark:border-red-400/30 dark:bg-red-400/10 sm:p-5">
            <p id={`${headingId}-cancel`} className="font-heading text-xl text-text">
              {labels.cancelDialog.title}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">{labels.cancelDialog.text}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => run({ kind: "cancel" }, (ok) => ok && close())} className={smallButton("danger")}>
                {pending ? a.saving : labels.cancelDialog.confirm}
              </button>
              <button type="button" onClick={close} className={smallButton()} autoFocus>
                {labels.cancelDialog.keep}
              </button>
            </div>
          </div>
        ) : null}

        <section>
          <h3 className="text-xs uppercase tracking-[0.14em] text-text-muted">{labels.orders}</h3>
          {sub.orders.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">{labels.noOrders}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {sub.orders.map((o) => (
                <li key={o.orderNumber}>
                  <Link href={o.href} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-surface-2/60">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium tracking-wide text-text" dir="ltr">
                        {o.orderNumber}
                      </span>
                      <span className="text-xs text-text-muted">
                        {o.kindLabel} · {o.dateLabel}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-xs text-text-muted">
                      <span>{o.statusLabel}</span>
                      <span className="text-sm tabular-nums text-text">{o.totalLabel}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  );
}

function AddressForm({
  sub,
  provinces,
  labels,
  pending,
  errors,
  onSubmit,
  onCancel,
}: {
  sub: AccountSubscriptionCard;
  provinces: string[];
  labels: AccountLabels;
  pending: boolean;
  errors: Record<string, string>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const f = labels.addressForm;
  const a = sub.address;
  const prefix = `sub-${sub.id}`;
  const name = (field: string) => `${prefix}.${field}`;
  const optional = `(${f.optional})`;
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 rounded-md border border-border bg-bg p-4 sm:grid-cols-2 sm:p-5">
      {/* The action reads plain keys; the ids stay unique per card. */}
      <TextField name={name("fullName")} label={f.fullName} defaultValue={a.fullName} autoComplete="name" required error={errors.fullName} className="sm:col-span-2" />
      <TextField name={name("phone")} label={f.phone} type="tel" dir="ltr" inputMode="tel" defaultValue={a.phone} autoComplete="tel" required error={errors.phone} />
      <SelectField
        name={name("city")}
        label={f.city}
        placeholder={labels.select}
        options={provinces.map((p) => ({ value: p, label: p }))}
        defaultValue={provinces.includes(a.city) ? a.city : ""}
        required
        error={errors.city}
      />
      <TextField name={name("district")} label={f.district} defaultValue={a.district} required error={errors.district} />
      <TextField name={name("neighbourhood")} label={f.neighbourhood} optionalLabel={optional} defaultValue={a.neighbourhood ?? ""} error={errors.neighbourhood} />
      <TextField name={name("line1")} label={f.line1} defaultValue={a.line1} autoComplete="street-address" required error={errors.line1} className="sm:col-span-2" />
      <TextField name={name("postalCode")} label={f.postalCode} optionalLabel={optional} inputMode="numeric" dir="ltr" maxLength={5} defaultValue={a.postalCode ?? ""} error={errors.postalCode} />
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className={smallButton("primary")}>
          {pending ? labels.actions.saving : labels.actions.save}
        </button>
        <button type="button" onClick={onCancel} className={smallButton()}>
          {labels.actions.close}
        </button>
      </div>
    </form>
  );
}
