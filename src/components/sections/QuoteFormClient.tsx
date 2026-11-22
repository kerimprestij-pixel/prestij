"use client";

// Quote request form: contact details, product lines (product + size and quantity, rows added and
// removed freely, optional free-text rows), message and KVKK consent. Posts to the Server Action with
// the lines as JSON in a hidden field; field errors come back per row ("lines.2.quantity").
import { ArrowRight, Plus, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { inputClass } from "@/components/checkout/fields";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { sendQuoteRequest } from "@/lib/requests/actions";
import { readQuoteLines } from "@/lib/requests/schema";
import { BUSINESS_SECTORS, INITIAL_REQUEST_STATE, REQUEST_LIMITS, type RequestFormState } from "@/lib/requests/types";
import { cn } from "@/lib/utils";
import { buttonClass } from "./button-styles";
import {
  bannerText,
  ConsentField,
  ErrorBanner,
  FieldMessage,
  FormStep,
  Honeypot,
  RequestInput,
  RequestSelect,
  RequestTextarea,
  requestErrorText,
  requestFieldId,
  SelectChevron,
  SuccessPanel,
  useRequestPrefill,
  type RequestLabels,
} from "./request-form-ui";

export type QuoteProductOption = {
  id: number;
  name: string;
  accent: string | null;
  variants: { id: number; label: string }[];
};

type Props = {
  locale: Locale;
  labels: RequestLabels;
  optionalLabel: string;
  products: QuoteProductOption[];
  allowCustomLines: boolean;
  successTitle: string;
  successText: string;
  privacyHref: string;
};

const FORM = "quote";
const CONTACT_ORDER = ["companyName", "sector", "contactName", "email", "phone"];

export default function QuoteFormClient(props: Props) {
  const [round, setRound] = useState(0);
  return <QuoteFormBody key={round} {...props} onReset={() => setRound((r) => r + 1)} />;
}

function QuoteFormBody({
  locale,
  labels,
  optionalLabel,
  products,
  allowCustomLines,
  successTitle,
  successText,
  privacyHref,
  onReset,
}: Props & { onReset: () => void }) {
  const [state, formAction, pending] = useActionState<RequestFormState, FormData>(sendQuoteRequest, INITIAL_REQUEST_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const prefilled = useRequestPrefill(formRef, ["companyName", "contactName", "email", "phone", "sector"]);

  // After each answer: focus the success heading, the first invalid field or the banner.
  useEffect(() => {
    if (state.attempt === 0) return;
    if (state.status === "success") {
      successRef.current?.focus();
      return;
    }
    const errors = state.fieldErrors ?? {};
    const lineKeys = Object.keys(errors)
      .filter((k) => k.startsWith("lines."))
      .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]));
    const first = CONTACT_ORDER.find((f) => errors[f]) ?? lineKeys[0] ?? (errors.lines ? "lines" : null) ?? ["message", "consent"].find((f) => errors[f]);
    const byId = (path: string) => document.getElementById(requestFieldId(FORM, path)) ?? document.getElementById(requestFieldId(FORM, path.replace(/\.label$/, ".variantId")));
    const target = first === "lines" ? document.getElementById(requestFieldId(FORM, "add-product")) : first ? byId(first) : null;
    if (target) target.focus();
    else alertRef.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <SuccessPanel
        title={successTitle}
        text={successText}
        reference={state.reference}
        referenceLabel={labels.reference}
        againLabel={labels.sendAnother}
        onAgain={onReset}
        headingRef={successRef}
      />
    );
  }

  const values = state.values ?? {};
  const value = (name: string) => (typeof values[name] === "string" ? (values[name] as string) : "");
  const err = (path: string) => requestErrorText(state.fieldErrors?.[path], path, labels, locale);
  const q = labels.quote;

  return (
    <form ref={formRef} action={formAction} noValidate className="space-y-10">
      <input type="hidden" name="locale" value={locale} />
      <Honeypot />
      <ErrorBanner text={bannerText(state, labels, locale)} alertRef={alertRef} />

      {/* Keyed by attempt: after an error the fields remount with the echoed values. */}
      <div key={state.attempt} className="space-y-10">
        <FormStep index={1} title={q.contactTitle}>
          {prefilled && <p className="-mt-2 text-sm text-text-muted">{labels.prefilled}</p>}
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
            <RequestInput
              form={FORM}
              name="companyName"
              label={labels.companyName}
              placeholder={labels.companyPlaceholder}
              autoComplete="organization"
              maxLength={REQUEST_LIMITS.company}
              defaultValue={value("companyName")}
              required
              error={err("companyName")}
            />
            <RequestSelect
              form={FORM}
              name="sector"
              label={labels.sector}
              placeholder={labels.sectorPlaceholder}
              options={BUSINESS_SECTORS.map((s) => ({ value: s, label: labels.sectors[s] }))}
              defaultValue={value("sector")}
              required
              error={err("sector")}
            />
            <RequestInput
              form={FORM}
              name="contactName"
              label={labels.contactName}
              placeholder={labels.contactPlaceholder}
              autoComplete="name"
              maxLength={REQUEST_LIMITS.name}
              defaultValue={value("contactName")}
              required
              error={err("contactName")}
            />
            <RequestInput
              form={FORM}
              name="email"
              type="email"
              label={labels.email}
              placeholder={labels.emailPlaceholder}
              autoComplete="email"
              inputMode="email"
              maxLength={REQUEST_LIMITS.email}
              defaultValue={value("email")}
              required
              dir="ltr"
              spellCheck={false}
              autoCapitalize="none"
              error={err("email")}
            />
            <RequestInput
              form={FORM}
              name="phone"
              type="tel"
              label={labels.phone}
              optional={optionalLabel}
              placeholder={labels.phonePlaceholder}
              autoComplete="tel"
              inputMode="tel"
              maxLength={REQUEST_LIMITS.phone}
              defaultValue={value("phone")}
              dir="ltr"
              hint={q.phoneHint}
              error={err("phone")}
            />
          </div>
        </FormStep>

        <FormStep index={2} title={q.linesTitle} hint={q.linesHint}>
          <LinesEditor
            initial={value("lines")}
            products={products}
            allowCustomLines={allowCustomLines}
            labels={labels}
            locale={locale}
            errorFor={err}
          />
        </FormStep>

        <FormStep index={3} title={labels.message}>
          <RequestTextarea
            form={FORM}
            name="message"
            label={labels.message}
            optional={optionalLabel}
            placeholder={q.messagePlaceholder}
            maxLength={REQUEST_LIMITS.message}
            defaultValue={value("message")}
            error={err("message")}
          />
        </FormStep>

        <ConsentField form={FORM} labels={labels} privacyHref={privacyHref} error={err("consent")} defaultChecked={value("consent") === "on"} />
      </div>

      <div className="border-t border-border pt-7">
        <button type="submit" disabled={pending} aria-disabled={pending || undefined} className={buttonClass("primary", "w-full sm:w-auto")}>
          <span>{pending ? labels.submitting : q.submit}</span>
          <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Product lines

type Line = { key: number; kind: "product" | "custom"; variantId: number | null; label: string; quantity: string };

/** The row kinds the browser sent along with the lines (the server ignores them). */
function echoedKinds(echoed: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(echoed);
    return Array.isArray(parsed) ? parsed.map((row) => (row && typeof row === "object" ? (row as { kind?: unknown }).kind : undefined)) : [];
  } catch {
    return [];
  }
}

/**
 * The first render's lines, keyed 1…n. The keys are rendered (data-line-key), so they must be the same
 * in the prerendered HTML and in the browser: a module-level counter differed (the prerender renders
 * every locale in one process; React dev renders initializers twice) and broke hydration and focus.
 */
function initialLines(echoed: string, products: QuoteProductOption[], allowCustom: boolean): Line[] {
  const drafts = echoed ? readQuoteLines(echoed) : [];
  const kinds = echoed ? echoedKinds(echoed) : [];
  if (drafts.length > 0) {
    return drafts.map((d, i) => ({
      key: i + 1,
      kind: d.variantId === null && allowCustom && (kinds[i] === "custom" || (kinds[i] === undefined && d.label !== "")) ? "custom" : "product",
      variantId: d.variantId,
      label: d.label,
      quantity: d.quantity,
    }));
  }
  const kind: Line["kind"] = products.length > 0 || !allowCustom ? "product" : "custom";
  return [{ key: 1, kind, variantId: null, label: "", quantity: "" }];
}

function LinesEditor({
  initial,
  products,
  allowCustomLines,
  labels,
  locale,
  errorFor,
}: {
  initial: string;
  products: QuoteProductOption[];
  allowCustomLines: boolean;
  labels: RequestLabels;
  locale: Locale;
  errorFor: (path: string) => string | null;
}) {
  const [lines, setLines] = useState<Line[]>(() => initialLines(initial, products, allowCustomLines));
  const [focusKey, setFocusKey] = useState<number | null>(null);
  /** Highest key handed out so far: a removed line's key is never reused. */
  const lastKey = useRef(0);
  const q = labels.quote;
  const accentOf = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, p.accent] as const)));
  const full = lines.length >= REQUEST_LIMITS.maxLines;

  useEffect(() => {
    if (focusKey === null) return;
    document.querySelector<HTMLElement>(`[data-line-key="${focusKey}"] select, [data-line-key="${focusKey}"] input[type="text"]`)?.focus();
  }, [focusKey]);

  const update = (key: number, patch: Partial<Line>) => setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (kind: Line["kind"]) => {
    if (full) return;
    const key = Math.max(lastKey.current, ...lines.map((l) => l.key)) + 1;
    lastKey.current = key;
    setLines((list) => [...list, { key, kind, variantId: null, label: "", quantity: "" }]);
    setFocusKey(key);
  };
  const remove = (key: number) => setLines((list) => (list.length > 1 ? list.filter((l) => l.key !== key) : list));

  const serialized = JSON.stringify(
    lines.map((l) => ({ kind: l.kind, variantId: l.kind === "product" ? l.variantId : null, label: l.kind === "custom" ? l.label : "", quantity: l.quantity })),
  );
  const listError = errorFor("lines");

  return (
    <div>
      <input type="hidden" name="lines" value={serialized} />
      <ol className="divide-y divide-border border-y border-border">
        {lines.map((line, index) => {
          const n = index + 1;
          const base = `lines.${index}`;
          const selectId = requestFieldId(FORM, `${base}.variantId`);
          const labelId = requestFieldId(FORM, `${base}.label`);
          const qtyId = requestFieldId(FORM, `${base}.quantity`);
          // A product row left without a product comes back as a missing label (the server sees a free-text row).
          const choiceError = line.kind === "product" ? (errorFor(`${base}.variantId`) ?? errorFor(`${base}.label`)) : errorFor(`${base}.label`);
          const qtyError = errorFor(`${base}.quantity`);
          const accent = line.variantId ? accentOf.get(line.variantId) : null;
          return (
            <li key={line.key} data-line-key={line.key} className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-4 py-5 sm:grid-cols-[minmax(0,1fr)_7.5rem_auto] sm:gap-x-4">
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <label htmlFor={line.kind === "product" ? selectId : labelId} className="mb-2 flex items-center gap-2 text-sm font-medium text-text">
                  <span aria-hidden className="font-heading text-xs text-gold-text tabular-nums" dir="ltr">
                    {String(n).padStart(2, "0")}
                  </span>
                  <span>{line.kind === "product" ? q.product : q.customLabel}</span>
                  <span className="sr-only">{format(q.line, { n }, locale)}</span>
                </label>
                {line.kind === "product" ? (
                  <div className="relative">
                    <span
                      aria-hidden
                      className={cn("pointer-events-none absolute start-4 top-1/2 size-2.5 -translate-y-1/2 rounded-full border border-border", !accent && "bg-surface-2")}
                      style={accent ? { backgroundColor: accent, borderColor: accent } : undefined}
                    />
                    <select
                      id={selectId}
                      value={line.variantId ?? ""}
                      onChange={(e) => update(line.key, { variantId: e.target.value ? Number(e.target.value) : null })}
                      aria-invalid={choiceError ? true : undefined}
                      aria-describedby={choiceError ? `${selectId}-error` : undefined}
                      className={cn(inputClass, "cursor-pointer appearance-none ps-10 pe-11")}
                    >
                      <option value="">{q.productPlaceholder}</option>
                      {products.map((p) =>
                        p.variants.length === 1 && !p.variants[0].label ? (
                          <option key={p.id} value={p.variants[0].id}>
                            {p.name}
                          </option>
                        ) : (
                          <optgroup key={p.id} label={p.name}>
                            {p.variants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.label ? `${p.name} · ${v.label}` : p.name}
                              </option>
                            ))}
                          </optgroup>
                        ),
                      )}
                    </select>
                    <SelectChevron />
                  </div>
                ) : (
                  <input
                    id={labelId}
                    type="text"
                    value={line.label}
                    onChange={(e) => update(line.key, { label: e.target.value })}
                    maxLength={REQUEST_LIMITS.lineLabel}
                    placeholder={q.customPlaceholder}
                    aria-invalid={choiceError ? true : undefined}
                    aria-describedby={choiceError ? `${labelId}-error` : undefined}
                    className={inputClass}
                  />
                )}
                <FieldMessage id={line.kind === "product" ? selectId : labelId} error={choiceError} />
              </div>
              <div className="min-w-0">
                <label htmlFor={qtyId} className="mb-2 block text-sm font-medium text-text">
                  {q.quantity}
                  <span className="sr-only"> · {format(q.line, { n }, locale)}</span>
                </label>
                <input
                  id={qtyId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  value={line.quantity}
                  onChange={(e) => update(line.key, { quantity: e.target.value.replace(/[^\d.\s]/g, "").slice(0, 9) })}
                  aria-invalid={qtyError ? true : undefined}
                  aria-describedby={qtyError ? `${qtyId}-error` : undefined}
                  className={cn(inputClass, "tabular-nums rtl:text-right")}
                  placeholder="0"
                />
                <FieldMessage id={qtyId} error={qtyError} />
              </div>
              <div className="pt-7">
                {lines.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => remove(line.key)}
                    className="grid size-12 place-items-center rounded-control text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <X aria-hidden className="size-4" strokeWidth={1.75} />
                    <span className="sr-only">{format(q.removeLine, { n }, locale)}</span>
                  </button>
                ) : (
                  <span aria-hidden className="block size-12" />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {listError && <FieldMessage id={requestFieldId(FORM, "lines")} error={listError} />}
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
        {products.length > 0 && (
          <button
            id={requestFieldId(FORM, "add-product")}
            type="button"
            onClick={() => add("product")}
            disabled={full}
            aria-describedby={listError ? `${requestFieldId(FORM, "lines")}-error` : undefined}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-text underline decoration-gold/60 underline-offset-4 transition-colors hover:decoration-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus aria-hidden className="size-4 text-gold-text" strokeWidth={1.75} />
            {q.addProduct}
          </button>
        )}
        {allowCustomLines && (
          <button
            id={products.length === 0 ? requestFieldId(FORM, "add-product") : undefined}
            type="button"
            onClick={() => add("custom")}
            disabled={full}
            className="inline-flex min-h-11 items-center gap-2 text-sm text-text-muted underline decoration-border underline-offset-4 transition-colors hover:text-text hover:decoration-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus aria-hidden className="size-4" strokeWidth={1.75} />
            {q.addCustom}
          </button>
        )}
      </div>
    </div>
  );
}
