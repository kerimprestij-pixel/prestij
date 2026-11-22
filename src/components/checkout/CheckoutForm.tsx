"use client";
// The one-page checkout: contact, delivery address, invoice, payment method, consents and note, with
// the order summary beside it. The server (placeOrderAction → core placeOrder) validates and prices
// everything again; this component only shows pre-computed CartView values and collects input.

import Link from "next/link";
import { AlertTriangle, Briefcase, Building2, CreditCard, Landmark, Loader2, Lock, MapPin, Plus, Truck, User, type LucideIcon } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { placeOrderAction, previewLegalAction } from "@/app/[locale]/odeme/actions";
import { buttonClass } from "@/components/sections/button-styles";
import { publishCartCount } from "@/components/store/cart-count";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { SAVE_ADDRESS_FIELD, type CheckoutAccount, type CheckoutGuestPrompt } from "@/lib/account/checkout-types";
import type { PaymentMethod } from "@/lib/cart/types";
import type { CartView, PaymentMethodView, SummaryRow } from "@/lib/cart/view";
import type { LegalPreview } from "@/lib/orders/legal-preview";
import { cn } from "@/lib/utils";
import { isValidTckn, isValidVkn, normalizeTrPhone, TR_PROVINCES } from "@/lib/validation/tr";
import { CheckboxField, FieldError, fieldId, SelectField, TextAreaField, TextField } from "./fields";
import LegalModal, { type LegalDocKey } from "./LegalModal";
import OrderSummary from "./OrderSummary";
import { CART_CHANGE_CODES, type CheckoutLabels, type CheckoutState, type CommonLabels } from "./types";

type CheckoutFormProps = {
  locale: Locale;
  initialView: CartView;
  labels: CheckoutLabels;
  common: CommonLabels;
  cartHref: string;
  kvkkHref: string;
  /** Withdrawal right and its exception, shown right above the order button (MSY m.6(2)(a)). */
  withdrawal: { title: string; text: string; contact: string };
  /** False when a contract text is missing: no order can be placed (placeOrder refuses legal_unavailable). */
  legalReady: boolean;
  /** Label of the optional, unticked newsletter opt-in box (NOTIFY); null hides it (newsletter off). */
  newsletterOptIn?: string | null;
  /** ACCOUNTS: the signed-in customer (account e-mail, saved addresses, "Bu adresi kaydet"); null for guests. */
  account?: CheckoutAccount | null;
  /** ACCOUNTS: "Üye misiniz? Giriş yapın" for guests. */
  guestPrompt?: CheckoutGuestPrompt | null;
};

type ErrorCode = keyof CheckoutLabels["errors"];

const INITIAL_STATE: CheckoutState = { status: "idle", attempt: 0 };
const NOTE_MAX = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (v: string) => v.replace(/[\s-]/g, "");

/** Provinces A→Z in Turkish collation (the stored value is the canonical name). */
const PROVINCE_OPTIONS = [...TR_PROVINCES]
  .sort((a, b) => a.name.localeCompare(b.name, "tr"))
  .map((p) => ({ value: p.name, label: p.name }));

/** Instant checks on blur (the server repeats them). Empty values are left to the server. */
function validateOnBlur(name: string, value: string): ErrorCode | null {
  if (name === "contact.email") return EMAIL_RE.test(value) ? null : "invalid_email";
  if (name === "contact.phone") return normalizeTrPhone(value) ? null : "invalid_phone";
  if (name.endsWith(".postalCode")) return /^\d{5}$/.test(value) ? null : "invalid_postal_code";
  if (name === "invoice.nationalId") return isValidTckn(digits(value)) ? null : "invalid_tckn";
  if (name === "invoice.taxNumber") return isValidVkn(digits(value)) || isValidTckn(digits(value)) ? null : "invalid_tax_number";
  return null;
}

const METHOD_ICONS: Record<PaymentMethod, LucideIcon> = {
  card: CreditCard,
  bank_transfer: Landmark,
  cash_on_delivery: Truck,
  deferred: Briefcase,
};

/** Fills a template's placeholder (e.g. "{link}") with a React node. */
function withPlaceholder(template: string, placeholder: string, node: ReactNode): ReactNode {
  const index = template.indexOf(placeholder);
  if (index === -1) return template;
  return (
    <>
      {template.slice(0, index)}
      {node}
      {template.slice(index + placeholder.length)}
    </>
  );
}

/** Fills a template's {link} placeholder with a React node. */
const withLink = (template: string, link: ReactNode): ReactNode => withPlaceholder(template, "{link}", link);

export default function CheckoutForm({ locale, initialView, labels, common, cartHref, kvkkHref, withdrawal, legalReady, newsletterOptIn, account = null, guestPrompt = null }: CheckoutFormProps) {
  const [state, formAction, pending] = useActionState(placeOrderAction, INITIAL_STATE);
  // The server render the last submit was made from. With Cache Components the page stays mounted
  // (hidden by <Activity>) while the buyer edits the cart, so useActionState keeps the failed
  // submit's result. When a newer server render arrives, it wins: the failed submit's cart, error
  // banner and field errors belong to a cart that no longer exists.
  const [submitBase, setSubmitBase] = useState<CartView | null>(null);
  const stale = state.status === "error" && submitBase !== initialView;
  const view = !stale && state.view ? state.view : initialView;
  const f = labels.form;
  // ACCOUNTS: the saved address the fields were filled from (null = a new address) and the submit
  // attempt it was picked at. After a failed submit the posted values win, unless the buyer picked an
  // address since then.
  const [addressPick, setAddressPick] = useState<{ id: number | null; attempt: number }>(() => ({ id: account?.defaultAddressId ?? null, attempt: -1 }));
  const valuesOf = (id: number | null) => (account ? (account.addresses.find((a) => a.id === id)?.values ?? account.blankValues) : null);
  const pickedValues = valuesOf(addressPick.id);
  const fromPosted = Boolean(state.values) && addressPick.attempt !== state.attempt;
  const values = fromPosted ? (state.values ?? {}) : (pickedValues ?? state.values ?? {});
  const fillKey = `fill-${addressPick.id ?? "new"}-${addressPick.attempt}`;

  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  /** True from submit until an error comes back (a success navigates away). */
  const submittingRef = useRef(false);
  const ids = { contact: useId(), shipping: useId(), invoice: useId(), payment: useId(), consents: useId(), errorTitle: useId(), errorText: useId() };

  // --- Controlled parts: they change other parts of the page. ---------------------------------
  const methods = view.paymentMethods.filter((m) => m.visible);
  const [method, setMethod] = useState<PaymentMethod | null>(() => {
    const posted = values.paymentMethod;
    return (methods.find((m) => m.method === posted && m.available) ?? methods.find((m) => m.available))?.method ?? null;
  });
  // A method that stopped being available (after a refresh) is no longer selected.
  const selected: PaymentMethodView | null = methods.find((m) => m.method === method && m.available) ?? null;
  const rows = selected?.summary ?? view.summary;
  const grandTotal = selected?.totals.grandTotal ?? view.totals.grandTotal;
  const anyMethodAvailable = methods.some((m) => m.available);

  const [invoiceType, setInvoiceType] = useState<"individual" | "corporate">(() =>
    values["invoice.type"] === "corporate" || (!state.values && !pickedValues?.["invoice.type"] && view.customer.isBusiness) ? "corporate" : "individual",
  );
  const [sameAsShipping, setSameAsShipping] = useState(() =>
    state.values ? values["invoice.sameAsShipping"] === "on" : pickedValues && "invoice.sameAsShipping" in pickedValues ? pickedValues["invoice.sameAsShipping"] === "on" : true,
  );
  /** ACCOUNTS: fill the delivery, phone and invoice fields from a saved address (or empty them for a new one). */
  const pickAddress = (id: number | null) => {
    const next = valuesOf(id) ?? {};
    setAddressPick({ id, attempt: state.attempt });
    setInvoiceType(next["invoice.type"] === "corporate" ? "corporate" : "individual");
    setSameAsShipping("invoice.sameAsShipping" in next ? next["invoice.sameAsShipping"] === "on" : true);
  };
  const [consents, setConsents] = useState({ preInformation: false, distanceSales: false });
  /** Set when the consents were cleared because the payment method changed (shown next to them). */
  const [consentsReset, setConsentsReset] = useState(false);
  const [noteLength, setNoteLength] = useState(() => (values.customerNote ?? "").length);
  // The accepted texts described another cart: a changed cart (lines, quantities, coupon) clears
  // the consents, so what is stored with the order is what the buyer last accepted.
  const [consentsFor, setConsentsFor] = useState(view.revision);
  if (consentsFor !== view.revision) {
    setConsentsFor(view.revision);
    setConsents({ preInformation: false, distanceSales: false });
  }

  // --- Errors: server errors of the last submit, overridden by live edits/blur checks. ----------
  const serverErrors = stale ? {} : (state.fieldErrors ?? {});
  const [local, setLocal] = useState<{ attempt: number; errors: Record<string, string | null> }>({ attempt: 0, errors: {} });
  const localErrors = local.attempt === state.attempt ? local.errors : {};
  const errorFor = (name: string): string | null => (name in localErrors ? localErrors[name] : (serverErrors[name] ?? null));
  const setLocalError = (name: string, message: string | null) =>
    setLocal((prev) => ({ attempt: state.attempt, errors: { ...(prev.attempt === state.attempt ? prev.errors : {}), [name]: message } }));

  // Failed submit: allow the next one and move focus to the error summary.
  useEffect(() => {
    if (state.status !== "error") return;
    submittingRef.current = false;
    summaryRef.current?.focus();
  }, [state.attempt, state.status]);

  // Leaving the page while a submit is in flight means the order went through (placeOrder redirected):
  // the cart is gone, so the header badge drops to 0. (The page stays mounted, hidden, afterwards.)
  useLayoutEffect(() => {
    const submitting = submittingRef;
    return () => {
      if (submitting.current) {
        submitting.current = false;
        publishCartCount(0);
      }
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    // Dispatch ourselves (instead of the form's default action) so React does not reset the fields.
    event.preventDefault();
    if (submittingRef.current || pending) return; // double-click / double-Enter safe
    submittingRef.current = true;
    const data = new FormData(event.currentTarget);
    setSubmitBase(initialView);
    startTransition(() => formAction(data));
  };

  const handleChange = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLInputElement;
    if (!target.name) return;
    if (target.name === "customerNote") setNoteLength(target.value.length);
    if (errorFor(target.name)) setLocalError(target.name, null);
  };

  const handleBlur = (event: FocusEvent<HTMLFormElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.name) return;
    const value = target.value.trim();
    if (!value) return;
    const code = validateOnBlur(target.name, value);
    if (code) setLocalError(target.name, labels.errors[code]);
    else if (errorFor(target.name)) setLocalError(target.name, null);
  };

  // --- Legal texts modal. -----------------------------------------------------------------------
  const [legalOpen, setLegalOpen] = useState<LegalDocKey | null>(null);
  const [legal, setLegal] = useState<{ status: "idle" | "loading" | "error"; data: LegalPreview | null }>({ status: "idle", data: null });
  const legalRequest = useRef(0);

  const loadLegal = () => {
    const form = formRef.current;
    if (!form) return;
    const request = ++legalRequest.current;
    setLegal({ status: "loading", data: null });
    previewLegalAction(locale, new FormData(form)).then(
      (data) => {
        if (request === legalRequest.current) setLegal(data ? { status: "idle", data } : { status: "error", data: null });
      },
      () => {
        if (request === legalRequest.current) setLegal({ status: "error", data: null });
      },
    );
  };

  const openLegal = (key: LegalDocKey) => {
    setLegalOpen(key);
    loadLegal();
  };

  const setConsent = (key: LegalDocKey, checked: boolean) => {
    setConsents((c) => ({ ...c, [key]: checked }));
    if (checked) setConsentsReset(false);
    const name = `consents.${key}`;
    if (checked && errorFor(name)) setLocalError(name, null);
  };

  /** The texts name the payment method, its fee and the total: a new method needs a new acceptance. */
  const selectMethod = (next: PaymentMethod) => {
    if (next === selected?.method) return;
    setMethod(next);
    if (errorFor("paymentMethod")) setLocalError("paymentMethod", null);
    if (consents.preInformation || consents.distanceSales) {
      setConsents({ preInformation: false, distanceSales: false });
      setConsentsReset(true);
    }
    legalRequest.current += 1; // drop a preview still loading for the old method
    setLegal({ status: "idle", data: null });
  };

  // --- Error summary. ---------------------------------------------------------------------------
  const addressLabels = (prefix: string, section: string): Record<string, string> => ({
    [`${prefix}.fullName`]: `${section} · ${prefix.startsWith("invoice") && invoiceType === "corporate" ? f.billingContactName : f.fullName}`,
    [`${prefix}.city`]: `${section} · ${f.province}`,
    [`${prefix}.district`]: `${section} · ${f.district}`,
    [`${prefix}.neighbourhood`]: `${section} · ${f.neighbourhood}`,
    [`${prefix}.line1`]: `${section} · ${f.line1}`,
    [`${prefix}.postalCode`]: `${section} · ${f.postalCode}`,
  });
  const fieldLabels: Record<string, string> = {
    "contact.email": labels.email,
    "contact.phone": labels.phone,
    ...addressLabels("shippingAddress", labels.shippingAddress),
    "invoice.nationalId": f.nationalId,
    "invoice.companyName": f.companyName,
    "invoice.taxOffice": f.taxOffice,
    "invoice.taxNumber": f.taxNumber,
    ...addressLabels("invoice.address", f.billingAddress),
    paymentMethod: labels.paymentMethod,
    "consents.preInformation": labels.preInformation,
    "consents.distanceSales": labels.distanceSales,
    customerNote: f.note,
  };
  const order = Object.keys(fieldLabels);
  const summaryItems = Object.keys(serverErrors)
    .map((path) => ({ path, message: errorFor(path) }))
    .filter((item): item is { path: string; message: string } => Boolean(item.message))
    .sort((a, b) => (order.indexOf(a.path) + 1 || 999) - (order.indexOf(b.path) + 1 || 999));
  const cartChanged = state.code ? CART_CHANGE_CODES.includes(state.code) : false;
  // Field errors only: the list says it all (no repeated intro), and once every listed field is
  // fixed the box goes away instead of staying as an empty red frame.
  const fieldsOnly = state.code === "invalid_input";
  const showErrors = state.status === "error" && !stale && !(fieldsOnly && summaryItems.length === 0);

  const focusField = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById(fieldId(path));
    if (!el) return;
    event.preventDefault();
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const optional = common.optional.toLocaleLowerCase(locale === "tr" ? "tr-TR" : locale);
  const legalTitle = legalOpen === "distanceSales" ? labels.distanceSales : labels.preInformation;
  const legalText = legalOpen && legal.data ? legal.data[legalOpen] : null;
  const blocked = !view.checkoutAllowed;

  return (
    <div className="container-x grid gap-8 pb-20 lg:grid-cols-12 lg:gap-14 lg:pb-28 xl:gap-20">
      <aside className="lg:col-span-5 lg:col-start-8 lg:row-start-1">
        <OrderSummary
          locale={locale}
          view={view}
          rows={rows}
          grandTotalLabel={grandTotal.label}
          labels={labels}
          common={common}
          cartHref={cartHref}
        />
      </aside>

      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleSubmit}
        onChange={handleChange}
        onBlur={handleBlur}
        noValidate
        aria-busy={pending}
        className="space-y-10 lg:col-span-7 lg:col-start-1 lg:row-start-1"
      >
        <input type="hidden" name="locale" value={locale} />
        {/* What the buyer is confirming: the cart revision and the total shown for every method, so
            the server refuses a changed cart and a form posted without JavaScript is checked against
            the method actually chosen. */}
        <input type="hidden" name="expectedCart" value={view.revision} />
        {methods
          .filter((m) => m.available)
          .map((m) => (
            <input key={m.method} type="hidden" name={`expectedTotals.${m.method}`} value={m.totals.grandTotal.amount} />
          ))}

        {showErrors && (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="group"
            aria-labelledby={ids.errorTitle}
            aria-describedby={ids.errorText}
            className="scroll-mt-28 rounded-md border border-red-700/40 bg-red-50 p-5 text-text focus:outline-2 focus:outline-offset-4 focus:outline-red-700 sm:p-6 dark:border-red-400/40 dark:bg-red-950/30 dark:focus:outline-red-400"
          >
            <h2 id={ids.errorTitle} className="flex items-center gap-2.5 font-body text-base font-semibold text-red-800 dark:text-red-300">
              <AlertTriangle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
              {f.errorTitle}
            </h2>
            {!(fieldsOnly && summaryItems.length > 0) && (
              <p id={ids.errorText} className="mt-2 text-sm leading-relaxed">
                {state.formError}
              </p>
            )}
            {summaryItems.length > 0 && (
              <>
                <p id={fieldsOnly ? ids.errorText : undefined} className={cn(fieldsOnly ? "mt-2" : "mt-4", "text-sm font-medium")}>
                  {f.errorFieldsIntro}
                </p>
                <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm">
                  {summaryItems.map(({ path, message }) => (
                    <li key={path}>
                      <a
                        href={`#${fieldId(path)}`}
                        onClick={focusField(path)}
                        className="text-red-800 underline underline-offset-4 hover:decoration-2 dark:text-red-300"
                      >
                        {fieldLabels[path] ? `${fieldLabels[path]}: ${message}` : message}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {cartChanged && (
              <Link href={cartHref} className={buttonClass("secondary", "mt-5 min-h-11 bg-surface px-5 py-2.5 text-xs")}>
                {f.reviewCart}
              </Link>
            )}
          </div>
        )}

        {/* 1. Contact */}
        <Section n={1} id={ids.contact} title={labels.contact} description={f.contactHint}>
          {/* ACCOUNTS: who is ordering (signed in) or a sign-in prompt (guest). */}
          {account ? (
            <p className="flex items-start gap-2.5 rounded-sm bg-surface-2 px-4 py-3 text-sm leading-relaxed text-text">
              <User aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text" strokeWidth={1.75} />
              {account.labels.signedInAs}
            </p>
          ) : guestPrompt ? (
            <p className="text-sm leading-relaxed text-text-muted">
              {withLink(
                guestPrompt.text,
                <Link href={guestPrompt.href} className="font-medium text-text underline decoration-gold underline-offset-4 hover:decoration-2">
                  {guestPrompt.linkLabel}
                </Link>,
              )}
            </p>
          ) : null}
          <div key={fillKey} className="grid gap-5 sm:grid-cols-2">
            <TextField
              name="contact.email"
              label={labels.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              dir="ltr"
              maxLength={254}
              placeholder={f.emailPlaceholder}
              required
              readOnly={Boolean(account)}
              hint={account ? account.labels.emailLocked : undefined}
              defaultValue={account ? account.email : values["contact.email"]}
              error={errorFor("contact.email")}
            />
            <TextField
              name="contact.phone"
              label={labels.phone}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              maxLength={20}
              placeholder={f.phonePlaceholder}
              hint={f.phoneHint}
              required
              defaultValue={values["contact.phone"]}
              error={errorFor("contact.phone")}
            />
          </div>
        </Section>

        {/* 2. Delivery address */}
        <Section n={2} id={ids.shipping} title={labels.shippingAddress}>
          <p className="flex items-start gap-2.5 rounded-sm bg-surface-2 px-4 py-3 text-sm leading-relaxed text-text">
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text" strokeWidth={1.75} />
            {f.shippingNotice}
          </p>
          {/* ACCOUNTS: saved addresses fill the delivery, phone and invoice fields. */}
          {account && account.addresses.length > 0 ? (
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-text">{account.labels.savedAddresses}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {account.addresses.map((a) => (
                  <ChoiceCard
                    key={a.id}
                    name="account.addressPick"
                    value={String(a.id)}
                    checked={addressPick.id === a.id}
                    onSelect={() => pickAddress(a.id)}
                    icon={MapPin}
                    title={a.title}
                    description={a.summary}
                  />
                ))}
                <ChoiceCard
                  name="account.addressPick"
                  value="new"
                  checked={addressPick.id === null}
                  onSelect={() => pickAddress(null)}
                  icon={Plus}
                  title={account.labels.newAddress}
                  description=""
                />
              </div>
            </fieldset>
          ) : null}
          <AddressFields key={fillKey} prefix="shippingAddress" section="shipping" nameLabel={f.fullName} labels={labels} optional={optional} values={values} errorFor={errorFor} showCountry />
          {account && addressPick.id === null ? (
            <CheckboxField
              key={`save-${fillKey}`}
              name={SAVE_ADDRESS_FIELD}
              label={account.labels.saveAddress}
              hint={account.labels.saveAddressHint}
              defaultChecked={fromPosted ? values[SAVE_ADDRESS_FIELD] === "on" : account.saveByDefault}
            />
          ) : null}
        </Section>

        {/* 3. Invoice */}
        <Section n={3} id={ids.invoice} title={f.invoiceTitle}>
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-text">{f.invoiceTypeLegend}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                name="invoice.type"
                value="individual"
                checked={invoiceType === "individual"}
                onSelect={() => setInvoiceType("individual")}
                icon={User}
                title={labels.individual}
                description={f.individualHint}
              />
              <ChoiceCard
                name="invoice.type"
                value="corporate"
                checked={invoiceType === "corporate"}
                onSelect={() => setInvoiceType("corporate")}
                icon={Building2}
                title={labels.corporate}
                description={f.corporateHint}
              />
            </div>
          </fieldset>

          {invoiceType === "individual" ? (
            <TextField
              key={`nid-${fillKey}`}
              name="invoice.nationalId"
              label={f.nationalId}
              optionalLabel={optional}
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              maxLength={11}
              pattern="[0-9]*"
              hint={f.nationalIdHint}
              defaultValue={values["invoice.nationalId"]}
              error={errorFor("invoice.nationalId")}
              className="sm:max-w-sm"
            />
          ) : (
            <div key={`corp-${fillKey}`} className="grid gap-5 sm:grid-cols-2">
              <TextField
                name="invoice.companyName"
                label={f.companyName}
                autoComplete="organization"
                maxLength={200}
                required
                defaultValue={values["invoice.companyName"]}
                error={errorFor("invoice.companyName")}
                className="sm:col-span-2"
              />
              <TextField
                name="invoice.taxOffice"
                label={f.taxOffice}
                autoComplete="off"
                maxLength={100}
                required
                defaultValue={values["invoice.taxOffice"]}
                error={errorFor("invoice.taxOffice")}
              />
              <TextField
                name="invoice.taxNumber"
                label={f.taxNumber}
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                maxLength={11}
                pattern="[0-9]*"
                required
                hint={f.taxNumberHint}
                defaultValue={values["invoice.taxNumber"]}
                error={errorFor("invoice.taxNumber")}
              />
              <CheckboxField
                name="invoice.eInvoice"
                label={f.eInvoice}
                hint={f.eInvoiceHint}
                defaultChecked={values["invoice.eInvoice"] === "on"}
                className="sm:col-span-2"
              />
            </div>
          )}

          <CheckboxField name="invoice.sameAsShipping" label={f.sameAsShipping} checked={sameAsShipping} onCheckedChange={setSameAsShipping} />

          {!sameAsShipping && (
            <fieldset className="rounded-md border border-border p-4 sm:p-6">
              <legend className="px-2 font-heading text-xl text-text">{f.billingAddress}</legend>
              <AddressFields
                key={`bill-${fillKey}`}
                prefix="invoice.address"
                section="billing"
                nameLabel={invoiceType === "corporate" ? f.billingContactName : f.fullName}
                labels={labels}
                optional={optional}
                values={values}
                errorFor={errorFor}
              />
            </fieldset>
          )}
        </Section>

        {/* 4. Payment method */}
        <Section n={4} id={ids.payment} title={labels.paymentMethod} description={anyMethodAvailable ? f.paymentHint : undefined}>
          {anyMethodAvailable ? (
            <fieldset aria-describedby={errorFor("paymentMethod") ? `${fieldId("paymentMethod")}-error` : undefined}>
              <legend className="sr-only">{labels.paymentMethod}</legend>
              <div className="space-y-3">
                {methods.map((m) => (
                  <PaymentOption
                    key={m.method}
                    option={m}
                    checked={selected?.method === m.method}
                    onSelect={() => selectMethod(m.method)}
                    first={m === methods.find((x) => x.available)}
                    labels={labels}
                    deferredDays={view.customer.deferredDays}
                    locale={locale}
                  />
                ))}
              </div>
              <FieldError id={fieldId("paymentMethod")} error={errorFor("paymentMethod")} />
            </fieldset>
          ) : (
            <p role="status" className="rounded-md border border-border bg-surface-2 p-4 text-sm text-text">
              {f.noMethodAvailable}
            </p>
          )}
        </Section>

        {/* 5. Consents and note */}
        <Section n={5} id={ids.consents} title={f.consentsTitle}>
          <p role="status" className={cn("text-sm leading-relaxed text-text", consentsReset ? "rounded-sm bg-gold-50 px-4 py-3 dark:bg-gold-950" : "sr-only")}>
            {consentsReset ? f.consentsReset : ""}
          </p>
          <div className="space-y-4">
            <CheckboxField
              name="consents.preInformation"
              checked={consents.preInformation}
              onCheckedChange={(checked) => setConsent("preInformation", checked)}
              error={errorFor("consents.preInformation")}
              accessibleName={f.consentPreInformation.replace("{link}", labels.preInformation)}
              label={withLink(
                f.consentPreInformation,
                <LegalButton onOpen={() => openLegal("preInformation")}>{labels.preInformation}</LegalButton>,
              )}
            />
            <CheckboxField
              name="consents.distanceSales"
              checked={consents.distanceSales}
              onCheckedChange={(checked) => setConsent("distanceSales", checked)}
              error={errorFor("consents.distanceSales")}
              accessibleName={f.consentDistanceSales.replace("{link}", labels.distanceSales)}
              label={withLink(
                f.consentDistanceSales,
                <LegalButton onOpen={() => openLegal("distanceSales")}>{labels.distanceSales}</LegalButton>,
              )}
            />
            {newsletterOptIn ? (
              <CheckboxField name="marketing.newsletter" defaultChecked={values["marketing.newsletter"] === "on"} label={newsletterOptIn} />
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            {withLink(
              f.kvkkNotice,
              <a
                href={kvkkHref}
                target="_blank"
                rel="noopener"
                className="font-medium text-text underline decoration-gold underline-offset-4 hover:decoration-2"
              >
                {labels.kvkkLink}
                <span className="sr-only"> {common.opensInNewTab}</span>
              </a>,
            )}
          </p>
          <TextAreaField
            name="customerNote"
            label={f.note}
            optionalLabel={optional}
            placeholder={f.notePlaceholder}
            maxLength={NOTE_MAX}
            rows={3}
            defaultValue={values.customerNote}
            error={errorFor("customerNote")}
            counter={format(f.noteCounter, { count: noteLength, max: NOTE_MAX }, locale)}
          />
        </Section>

        {/* Confirm */}
        <div className="rounded-md border border-border bg-surface p-5 sm:p-7">
          {blocked && (
            <div className="mb-5 rounded-sm border border-red-700/30 bg-red-50 p-4 text-sm text-text dark:border-red-400/30 dark:bg-red-950/30">
              <p className="font-medium">{f.blockedTitle}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {view.blockingIssues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
              <Link href={cartHref} className="mt-3 inline-block font-medium underline decoration-gold underline-offset-4">
                {f.reviewCart}
              </Link>
            </div>
          )}
          {!legalReady && (
            <p role="alert" className="mb-5 rounded-sm border border-red-700/30 bg-red-50 p-4 text-sm text-text dark:border-red-400/30 dark:bg-red-950/30">
              {labels.errors.legal_unavailable}
            </p>
          )}
          <KeyInformation view={view} rows={rows} labels={labels} common={common} withdrawal={withdrawal} locale={locale} />
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-medium text-text">{f.amountDue}</span>
            <span className="font-heading text-3xl text-text">{grandTotal.label}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">{format(f.obligation, { amount: grandTotal.label }, locale)}</p>
          <button
            type="submit"
            disabled={pending || blocked || !anyMethodAvailable || !legalReady}
            className={buttonClass("primary", "mt-5 w-full rtl:tracking-normal")}
          >
            {pending ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
                {f.submitting}
              </>
            ) : (
              f.submit[selected?.method ?? "none"]
            )}
          </button>
          <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-text-muted">
            <Lock aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            {f.secureNote}
          </p>
          <p aria-live="polite" className="sr-only">
            {pending ? f.submitting : ""}
          </p>
        </div>
      </form>

      <LegalModal
        open={legalOpen}
        text={legalText}
        status={legal.status}
        fallbackTitle={legalTitle}
        labels={labels}
        common={common}
        onClose={() => setLegalOpen(null)}
        onRetry={loadLegal}
        onAccept={() => {
          if (legalOpen) setConsent(legalOpen, true);
          setLegalOpen(null);
        }}
      />
    </div>
  );
}

// -------------------------------------------------------------------------------------------------

function Section({ n, id, title, description, children }: { n: number; id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border pt-8 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border border-gold/70 font-body text-xs font-semibold text-gold-text">
          {n}
        </span>
        <h2 id={id} className="font-heading text-2xl text-text md:text-3xl">
          {title}
        </h2>
      </div>
      {description && <p className="mt-2 text-sm leading-relaxed text-text-muted sm:ps-11">{description}</p>}
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

function AddressFields({
  prefix,
  section,
  nameLabel,
  labels,
  optional,
  values,
  errorFor,
  showCountry = false,
}: {
  prefix: "shippingAddress" | "invoice.address";
  section: "shipping" | "billing";
  nameLabel: string;
  labels: CheckoutLabels;
  optional: string;
  values: Record<string, string>;
  errorFor: (name: string) => string | null;
  showCountry?: boolean;
}) {
  const f = labels.form;
  const n = (field: string) => `${prefix}.${field}`;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <TextField
        name={n("fullName")}
        label={nameLabel}
        autoComplete={`${section} name`}
        maxLength={100}
        required
        defaultValue={values[n("fullName")]}
        error={errorFor(n("fullName"))}
        className="sm:col-span-2"
      />
      <SelectField
        name={n("city")}
        label={f.province}
        placeholder={f.provincePlaceholder}
        options={PROVINCE_OPTIONS}
        autoComplete={`${section} address-level1`}
        required
        defaultValue={values[n("city")] ?? ""}
        error={errorFor(n("city"))}
      />
      <TextField
        name={n("district")}
        label={f.district}
        autoComplete={`${section} address-level2`}
        maxLength={60}
        required
        defaultValue={values[n("district")]}
        error={errorFor(n("district"))}
      />
      <TextField
        name={n("neighbourhood")}
        label={f.neighbourhood}
        optionalLabel={optional}
        autoComplete={`${section} address-level3`}
        maxLength={80}
        defaultValue={values[n("neighbourhood")]}
        error={errorFor(n("neighbourhood"))}
        className="sm:col-span-2"
      />
      <TextField
        name={n("line1")}
        label={f.line1}
        autoComplete={`${section} address-line1`}
        maxLength={250}
        placeholder={f.line1Placeholder}
        required
        defaultValue={values[n("line1")]}
        error={errorFor(n("line1"))}
        className="sm:col-span-2"
      />
      <TextField
        name={n("postalCode")}
        label={f.postalCode}
        optionalLabel={optional}
        inputMode="numeric"
        autoComplete={`${section} postal-code`}
        dir="ltr"
        maxLength={5}
        pattern="[0-9]{5}"
        defaultValue={values[n("postalCode")]}
        error={errorFor(n("postalCode"))}
      />
      {showCountry && (
        <div>
          <p className="mb-2 block text-sm font-medium text-text" id={`${fieldId(prefix)}-country`}>
            {f.country}
          </p>
          <p
            aria-labelledby={`${fieldId(prefix)}-country`}
            className="flex min-h-12 items-center rounded-control border border-dashed border-border px-4 text-base text-text-muted"
          >
            {f.countryValue}
          </p>
        </div>
      )}
    </div>
  );
}

function ChoiceCard({
  name,
  value,
  checked,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-16 cursor-pointer items-start gap-3 rounded-md border bg-surface p-4 transition-[border-color,box-shadow] duration-200",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        checked ? "border-brand shadow-[inset_0_0_0_1px_var(--brand)]" : "border-border hover:border-border-strong/60",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand focus-visible:outline-none dark:accent-gold"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium text-text">
          <Icon aria-hidden className="size-4 text-gold-text" strokeWidth={1.75} />
          {title}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-text-muted">{description}</span>
      </span>
    </label>
  );
}

function PaymentOption({
  option,
  checked,
  onSelect,
  first,
  labels,
  deferredDays,
  locale,
}: {
  option: PaymentMethodView;
  checked: boolean;
  onSelect: () => void;
  first: boolean;
  labels: CheckoutLabels;
  /** The approved company's payment days (B2B), shown on the "Vadeli ödeme" option. */
  deferredDays?: number | null;
  /** For the plural forms of the havale "pay within N days" hint (SR-2). */
  locale: Locale;
}) {
  const f = labels.form;
  const Icon = METHOD_ICONS[option.method];
  const descId = `${fieldId(`paymentMethod-${option.method}`)}-desc`;
  const t = option.totals;
  const effect =
    option.method === "bank_transfer" && t.bankTransferDiscount.amount > 0
      ? format(f.methodDiscount, { percent: option.discountPercent, amount: t.bankTransferDiscount.label })
      : option.method === "cash_on_delivery" && t.paymentFee.amount > 0
        ? format(f.methodFee, { amount: t.paymentFee.label })
        : option.method === "deferred" && deferredDays
          ? format(f.methodDeferredDays, { days: deferredDays })
          : null;
  return (
    <label
      className={cn(
        "flex gap-4 rounded-md border bg-surface p-4 transition-[border-color,box-shadow] duration-200 sm:p-5",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        !option.available
          ? "cursor-not-allowed border-dashed border-border bg-surface-2/60"
          : checked
            ? "cursor-pointer border-brand shadow-[inset_0_0_0_1px_var(--brand)]"
            : "cursor-pointer border-border hover:border-border-strong/60",
      )}
    >
      <input
        id={first ? fieldId("paymentMethod") : undefined}
        type="radio"
        name="paymentMethod"
        value={option.method}
        checked={checked}
        disabled={!option.available}
        onChange={onSelect}
        aria-describedby={descId}
        className="mt-1 size-5 shrink-0 cursor-pointer accent-brand focus-visible:outline-none disabled:cursor-not-allowed dark:accent-gold"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className={cn("flex items-center gap-2 font-medium", option.available ? "text-text" : "text-text-muted")}>
            <Icon aria-hidden className="size-4.5 shrink-0 text-gold-text" strokeWidth={1.5} />
            {option.label}
          </span>
          {option.available && (
            <span className="text-sm text-text-muted tabular-nums">{format(f.methodTotal, { amount: t.grandTotal.label })}</span>
          )}
        </span>
        <span id={descId} className="mt-1.5 block text-sm leading-relaxed text-text-muted">
          {option.available ? f.methodDescriptions[option.method] : option.reasonMessage}
          {option.available && option.method === "bank_transfer" && option.paymentDays
            ? ` ${format(f.methodBankDays, { days: option.paymentDays }, locale)}`
            : null}
          {option.available && effect && (
            <span className="mt-2.5 flex w-fit items-center rounded-full bg-gold-50 px-3 py-1 text-xs font-medium text-gold-800 dark:bg-gold-950 dark:text-gold-200">
              {effect}
            </span>
          )}
        </span>
      </span>
    </label>
  );
}

/**
 * The information MSY m.6(2)(a) wants "clearly and separately" right before the buyer takes on the
 * payment obligation: the goods (product, type, size, quantity), the price with every extra cost
 * (the rows of the chosen method), and the withdrawal right with its hygiene exception. The full
 * texts stay in the two consent modals; this block repeats the essentials beside the button.
 */
function KeyInformation({
  view,
  rows,
  labels,
  common,
  withdrawal,
  locale,
}: {
  view: CartView;
  rows: SummaryRow[];
  labels: CheckoutLabels;
  common: CommonLabels;
  withdrawal: CheckoutFormProps["withdrawal"];
  locale: Locale;
}) {
  const f = labels.form;
  const headingId = useId();
  const lines = view.lines.filter((l) => l.included);
  const costs = rows.filter((r) => r.kind !== "total" && r.kind !== "note");
  return (
    <section aria-labelledby={headingId} className="mb-6 border-b border-border pb-6 text-base leading-relaxed text-text">
      <h3 id={headingId} className="font-body text-base font-semibold">
        {f.keyInfoTitle}
      </h3>
      <p className="mt-3 text-sm font-medium text-text-muted">{f.keyInfoProducts}</p>
      <ul className="mt-1.5 space-y-1.5">
        {lines.map((line) => (
          <li key={line.lineId} className="flex justify-between gap-4">
            <span className="min-w-0">
              {line.name}
              {line.subtitle && !line.isSample ? ` — ${line.subtitle}` : ""}
              {line.variantLabel ? ` · ${line.variantLabel}` : ""}
              <span className="text-text-muted"> × {line.quantity}</span>
            </span>
            <span className="shrink-0 tabular-nums">{line.isSample ? common.free : line.lineSubtotal.label}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-border pt-3">
        {costs.map((row) => (
          <div key={row.key} className="flex justify-between gap-4">
            <dt className="text-text-muted">{row.label}</dt>
            <dd className="shrink-0 tabular-nums">{row.amountLabel}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4">
        <strong className="font-semibold">{withdrawal.title}:</strong> {withdrawal.text}{" "}
        {/* The phone keeps its digit order in Arabic (an RTL run would show "70 30 353 0352"). */}
        {withPlaceholder(format(f.withdrawalHow, {}, locale), "{contact}", <bdi dir="ltr" className="whitespace-nowrap">{withdrawal.contact}</bdi>)}
      </p>
    </section>
  );
}

function LegalButton({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault(); // inside the consent <label>: do not toggle the checkbox
        onOpen();
      }}
      aria-haspopup="dialog"
      className="inline p-0 text-start font-medium text-text underline decoration-gold underline-offset-4 hover:decoration-2"
    >
      {children}
    </button>
  );
}
