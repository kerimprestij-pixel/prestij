"use client";

// Free sample request form: business and contact, the scents to try (checkbox cards), the delivery
// address (il / ilçe / adres), estimated monthly litres, message and KVKK consent. Progressively
// enhanced: it posts to the Server Action without JS too (the prefill needs JS).
import { ArrowRight, Check } from "lucide-react";
import { useActionState, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Locale } from "@/i18n/config";
import Img from "@/lib/media/Img";
import type { MediaLike } from "@/lib/media/types";
import { sendSampleRequest } from "@/lib/requests/actions";
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
  SuccessPanel,
  useRequestPrefill,
  type RequestLabels,
} from "./request-form-ui";

export type SampleProductOption = { id: number; name: string; subtitle: string | null; accent: string | null; image: MediaLike | null };

type Props = {
  locale: Locale;
  labels: RequestLabels;
  optionalLabel: string;
  products: SampleProductOption[];
  provinces: string[];
  successTitle: string;
  successText: string;
  privacyHref: string;
};

const FORM = "sample";
const FIELD_ORDER = ["companyName", "sector", "contactName", "email", "phone", "productIds", "city", "district", "line1", "estimatedMonthlyLiters", "message", "consent"];

export default function SampleRequestFormClient(props: Props) {
  const [round, setRound] = useState(0);
  return <SampleFormBody key={round} {...props} onReset={() => setRound((r) => r + 1)} />;
}

function SampleFormBody({
  locale,
  labels,
  optionalLabel,
  products,
  provinces,
  successTitle,
  successText,
  privacyHref,
  onReset,
}: Props & { onReset: () => void }) {
  const [state, formAction, pending] = useActionState<RequestFormState, FormData>(sendSampleRequest, INITIAL_REQUEST_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const prefilled = useRequestPrefill(formRef, ["companyName", "contactName", "email", "phone", "sector"]);

  useEffect(() => {
    if (state.attempt === 0) return;
    if (state.status === "success") {
      successRef.current?.focus();
      return;
    }
    const first = FIELD_ORDER.find((f) => state.fieldErrors?.[f]);
    const target = first === "productIds" ? document.querySelector<HTMLInputElement>(`input[name="productIds"]`) : first ? document.getElementById(requestFieldId(FORM, first)) : null;
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
  const chosen = new Set((Array.isArray(values.productIds) ? values.productIds : []).map(String));
  const err = (path: string) => requestErrorText(state.fieldErrors?.[path], path, labels, locale);
  const s = labels.sample;
  const productsError = err("productIds");
  const productsErrorId = `${requestFieldId(FORM, "productIds")}-error`;

  return (
    <form ref={formRef} action={formAction} noValidate className="space-y-10">
      <input type="hidden" name="locale" value={locale} />
      <Honeypot />
      <ErrorBanner text={bannerText(state, labels, locale)} alertRef={alertRef} />

      <div key={state.attempt} className="space-y-10">
        <FormStep index={1} title={s.contactTitle}>
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
              options={BUSINESS_SECTORS.map((v) => ({ value: v, label: labels.sectors[v] }))}
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
              placeholder={labels.phonePlaceholder}
              autoComplete="tel"
              inputMode="tel"
              maxLength={REQUEST_LIMITS.phone}
              defaultValue={value("phone")}
              required
              dir="ltr"
              hint={s.phoneHint}
              error={err("phone")}
            />
          </div>
        </FormStep>

        <FormStep index={2} title={s.productsTitle} hint={s.productsHint}>
          <div role="group" aria-label={s.productsTitle} aria-describedby={productsError ? productsErrorId : undefined}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {products.map((p) => (
                <ScentChoice key={p.id} product={p} defaultChecked={chosen.has(String(p.id))} invalid={Boolean(productsError)} locale={locale} />
              ))}
            </ul>
            <FieldMessage id={requestFieldId(FORM, "productIds")} error={productsError} />
          </div>
        </FormStep>

        <FormStep index={3} title={s.addressTitle}>
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
            <RequestSelect
              form={FORM}
              name="city"
              label={s.city}
              placeholder={s.cityPlaceholder}
              options={provinces.map((p) => ({ value: p, label: p }))}
              defaultValue={value("city")}
              autoComplete="address-level1"
              required
              error={err("city")}
            />
            <RequestInput
              form={FORM}
              name="district"
              label={s.district}
              placeholder={s.districtPlaceholder}
              autoComplete="address-level2"
              maxLength={REQUEST_LIMITS.district}
              defaultValue={value("district")}
              required
              error={err("district")}
            />
            <RequestInput
              form={FORM}
              name="line1"
              label={s.line1}
              placeholder={s.line1Placeholder}
              autoComplete="street-address"
              maxLength={REQUEST_LIMITS.line1}
              defaultValue={value("line1")}
              required
              error={err("line1")}
              className="sm:col-span-2"
            />
          </div>
        </FormStep>

        <FormStep index={4} title={labels.message}>
          <RequestInput
            form={FORM}
            name="estimatedMonthlyLiters"
            label={s.liters}
            optional={optionalLabel}
            inputMode="numeric"
            maxLength={9}
            defaultValue={value("estimatedMonthlyLiters")}
            dir="ltr"
            suffix={s.litersUnit}
            hint={s.litersHint}
            error={err("estimatedMonthlyLiters")}
            className="sm:max-w-[calc(50%-0.625rem)]"
          />
          <RequestTextarea
            form={FORM}
            name="message"
            label={labels.message}
            optional={optionalLabel}
            placeholder={s.messagePlaceholder}
            maxLength={REQUEST_LIMITS.message}
            defaultValue={value("message")}
            error={err("message")}
          />
        </FormStep>

        <ConsentField form={FORM} labels={labels} privacyHref={privacyHref} error={err("consent")} defaultChecked={value("consent") === "on"} />
      </div>

      <div className="border-t border-border pt-7">
        <button type="submit" disabled={pending} aria-disabled={pending || undefined} className={buttonClass("primary", "w-full sm:w-auto")}>
          <span>{pending ? labels.submitting : s.submit}</span>
          <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
        </button>
      </div>
    </form>
  );
}

/** One scent as a selectable card: thumbnail, name and subtitle; the product colour marks the choice. */
function ScentChoice({ product, defaultChecked, invalid, locale }: { product: SampleProductOption; defaultChecked: boolean; invalid: boolean; locale: Locale }) {
  const accent = product.accent ?? "var(--gold)";
  return (
    <li className="relative">
      <label className="group relative flex min-h-20 cursor-pointer items-center gap-4 rounded-md border border-border bg-bg/40 p-3 pe-12 transition-colors duration-200 hover:border-gold has-[:checked]:border-[var(--choice)] has-[:checked]:bg-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring motion-reduce:transition-none" style={{ "--choice": accent } as CSSProperties}>
        <input
          type="checkbox"
          name="productIds"
          value={product.id}
          defaultChecked={defaultChecked}
          aria-invalid={invalid || undefined}
          className="peer sr-only"
        />
        <span className="relative size-14 shrink-0 overflow-hidden rounded-full border border-border" style={{ backgroundColor: product.accent ?? undefined }}>
          {product.image && <Img media={product.image} alt="" locale={locale} sizes="56px" fill placeholder={false} />}
        </span>
        <span className="min-w-0">
          <span className="block font-heading text-lg leading-tight text-text">{product.name}</span>
          {product.subtitle && <span className="mt-0.5 block text-xs leading-snug text-text-muted">{product.subtitle}</span>}
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute end-4 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full border border-border text-transparent transition-colors",
            "peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-contrast",
          )}
        >
          <Check className="size-3.5" strokeWidth={2.25} />
        </span>
      </label>
    </li>
  );
}
