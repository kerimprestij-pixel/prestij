"use client";
// The /hesap/kurumsal application form. Posts to the Server Action (works without JS too), shows field
// errors under the fields, focuses the first invalid field (or the error banner) after each answer and
// keeps the typed values on errors. Success redirects to the status view.
import { AlertCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitBusinessApplicationAction } from "@/app/[locale]/hesap/kurumsal/actions";
import { INITIAL_BUSINESS_FORM_STATE, type BusinessFormState } from "@/app/[locale]/hesap/kurumsal/state";
import { fieldId, SelectField, TextAreaField, TextField } from "@/components/checkout/fields";
import { buttonClass } from "@/components/sections/button-styles";
import type { Messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { BUSINESS_FORM_FIELDS, BUSINESS_LIMITS, BUSINESS_SECTORS, MONTHLY_VOLUMES } from "@/lib/b2b/application";
import { cn } from "@/lib/utils";

export type BusinessFormLabels = Omit<Messages["b2b"]["account"], "status">;

export default function BusinessApplicationForm({
  locale,
  labels,
  defaults,
  provinces,
  privacyHref,
}: {
  locale: Locale;
  labels: BusinessFormLabels;
  defaults: Record<string, string>;
  /** Province names (81, plate order). */
  provinces: string[];
  privacyHref: string;
}) {
  const [state, formAction] = useActionState<BusinessFormState, FormData>(submitBusinessApplicationAction, INITIAL_BUSINESS_FORM_STATE);
  const alertRef = useRef<HTMLDivElement>(null);
  const values = state.values ?? defaults;
  const [noteLength, setNoteLength] = useState((values.note ?? "").length);

  useEffect(() => {
    if (state.attempt === 0) return;
    const invalid = BUSINESS_FORM_FIELDS.find((f) => state.fieldErrors?.[f]);
    const target = invalid ? document.getElementById(fieldId(invalid)) : null;
    if (target) target.focus();
    else alertRef.current?.focus();
  }, [state]);

  const err = (name: string) => state.fieldErrors?.[name] ?? null;
  const [privacyBefore, privacyAfter = ""] = labels.privacy.split("{link}");
  const sectionTitle = "font-heading text-2xl text-text md:text-[1.7rem]";

  return (
    <form
      action={formAction}
      noValidate
      className="space-y-10"
      onInput={(e) => {
        const target = e.target as HTMLTextAreaElement;
        if (target.name === "note") setNoteLength(target.value.length);
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      {/* Honeypot: hidden from people and assistive tech. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Fax
          <input type="text" name="fax" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div
        ref={alertRef}
        tabIndex={-1}
        aria-live="polite"
        className={cn(
          "focus:outline-none",
          state.formError &&
            "flex items-start gap-3 rounded-md border border-red-700/30 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200",
        )}
      >
        {state.formError && (
          <>
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            <span>{state.formError}</span>
          </>
        )}
      </div>

      {/* Keyed by attempt: after an error the inputs remount with the echoed values. */}
      <div key={state.attempt} className="space-y-10">
        <fieldset className="space-y-6">
          <legend className={cn(sectionTitle, "mb-6")}>{labels.companySection}</legend>
          <TextField
            name="companyName"
            label={labels.companyName}
            placeholder={labels.companyNamePlaceholder}
            autoComplete="organization"
            maxLength={BUSINESS_LIMITS.companyName}
            defaultValue={values.companyName ?? ""}
            required
            error={err("companyName")}
          />
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
            <SelectField
              name="sector"
              label={labels.sector}
              placeholder={labels.sectorPlaceholder}
              options={BUSINESS_SECTORS.map((s) => ({ value: s, label: labels.sectors[s] }))}
              defaultValue={values.sector ?? ""}
              required
              error={err("sector")}
            />
            <TextField
              name="website"
              label={labels.website}
              optionalLabel={labels.optional}
              placeholder={labels.websitePlaceholder}
              autoComplete="url"
              inputMode="url"
              maxLength={BUSINESS_LIMITS.website}
              defaultValue={values.website ?? ""}
              dir="ltr"
              spellCheck={false}
              autoCapitalize="none"
              error={err("website")}
            />
          </div>
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
            <TextField
              name="taxOffice"
              label={labels.taxOffice}
              maxLength={BUSINESS_LIMITS.taxOffice}
              defaultValue={values.taxOffice ?? ""}
              required
              error={err("taxOffice")}
            />
            <TextField
              name="taxNumber"
              label={labels.taxNumber}
              inputMode="numeric"
              maxLength={14}
              defaultValue={values.taxNumber ?? ""}
              required
              dir="ltr"
              hint={labels.taxNumberHint}
              error={err("taxNumber")}
            />
          </div>
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
            <TextField
              name="phone"
              type="tel"
              label={labels.phone}
              autoComplete="tel"
              inputMode="tel"
              maxLength={22}
              defaultValue={values.phone ?? ""}
              required
              dir="ltr"
              hint={labels.phoneHint}
              error={err("phone")}
            />
            <TextField
              name="email"
              type="email"
              label={labels.email}
              autoComplete="email"
              inputMode="email"
              maxLength={BUSINESS_LIMITS.email}
              defaultValue={values.email ?? ""}
              required
              dir="ltr"
              spellCheck={false}
              autoCapitalize="none"
              hint={labels.emailHint}
              error={err("email")}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-6">
          <legend className={cn(sectionTitle, "mb-6")}>{labels.addressSection}</legend>
          <div className="grid gap-6 sm:grid-cols-2 sm:gap-5">
            <SelectField
              name="address.city"
              label={labels.city}
              placeholder={labels.cityPlaceholder}
              options={provinces.map((p) => ({ value: p, label: p }))}
              autoComplete="address-level1"
              defaultValue={values["address.city"] ?? ""}
              required
              error={err("address.city")}
            />
            <TextField
              name="address.district"
              label={labels.district}
              autoComplete="address-level2"
              maxLength={BUSINESS_LIMITS.district}
              defaultValue={values["address.district"] ?? ""}
              required
              error={err("address.district")}
            />
          </div>
          <TextField
            name="address.line1"
            label={labels.line1}
            placeholder={labels.line1Placeholder}
            autoComplete="street-address"
            maxLength={BUSINESS_LIMITS.line1}
            defaultValue={values["address.line1"] ?? ""}
            required
            error={err("address.line1")}
          />
          <TextField
            name="address.postalCode"
            label={labels.postalCode}
            optionalLabel={labels.optional}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={5}
            defaultValue={values["address.postalCode"] ?? ""}
            dir="ltr"
            className="sm:max-w-[calc(50%-0.625rem)]"
            error={err("address.postalCode")}
          />
        </fieldset>

        <fieldset className="space-y-6">
          <legend className={cn(sectionTitle, "mb-6")}>{labels.needsSection}</legend>
          <SelectField
            name="monthlyVolume"
            label={labels.monthlyVolume}
            optionalLabel={labels.optional}
            placeholder={labels.monthlyVolumePlaceholder}
            options={MONTHLY_VOLUMES.map((v) => ({ value: v, label: labels.volumes[v] }))}
            defaultValue={values.monthlyVolume ?? ""}
            className="sm:max-w-[calc(50%-0.625rem)]"
            error={err("monthlyVolume")}
          />
          <TextAreaField
            name="note"
            label={labels.note}
            optionalLabel={labels.optional}
            placeholder={labels.notePlaceholder}
            maxLength={BUSINESS_LIMITS.note}
            rows={4}
            defaultValue={values.note ?? ""}
            counter={`${noteLength}/${BUSINESS_LIMITS.note}`}
            error={err("note")}
          />
        </fieldset>
      </div>

      <div className="flex flex-col gap-5 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs leading-relaxed text-text-muted">
          {privacyBefore}
          <Link href={privacyHref} className="text-text underline decoration-gold underline-offset-4 hover:decoration-2">
            {labels.privacyLink}
          </Link>
          {privacyAfter}
        </p>
        <SubmitButton label={labels.submit} pendingLabel={labels.submitting} />
      </div>
    </form>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={buttonClass("primary", "w-full shrink-0 sm:w-auto rtl:tracking-normal")}>
      {pending ? pendingLabel : label}
      {!pending && <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />}
    </button>
  );
}
