"use client";
// /hesap/adresler: the address cards with edit / delete / "make default", and the add-edit form in a
// modal dialog. Field rules and messages are the checkout's (TR provinces, mobile phone, TCKN / VKN).

import { Building2, MapPin, Pencil, Plus, Trash2, User, X } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { CheckboxField, SelectField, TextField } from "@/components/checkout/fields";
import { addressLines, formatPhone, maskId } from "@/components/order/format";
import { buttonClass } from "@/components/sections/button-styles";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { deleteAddressAction, saveAddressAction, setDefaultAddressAction, type AccountFormState } from "@/lib/account/actions";
import type { SavedAddress } from "@/lib/account/addresses";
import { cn } from "@/lib/utils";
import { TR_PROVINCES } from "@/lib/validation/tr";
import { focusFormProblem, FormAlert, SubmitButton, submitWithoutReset } from "./ui";

const PROVINCES = [...TR_PROVINCES].sort((a, b) => a.name.localeCompare(b.name, "tr")).map((p) => ({ value: p.name, label: p.name }));

export type AddressBookLabels = {
  book: Messages["account"]["addressBook"];
  form: Messages["checkout"]["form"];
  phone: string;
  individual: string;
  corporate: string;
  optional: string;
  close: string;
  maxAddresses: number;
};

type Editing = { mode: "new" } | { mode: "edit"; address: SavedAddress } | null;

export default function AddressBook({ locale, addresses, labels }: { locale: Locale; addresses: SavedAddress[]; labels: AddressBookLabels }) {
  const b = labels.book;
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<SavedAddress | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const full = addresses.length >= labels.maxAddresses;

  const setDefault = (address: SavedAddress, kind: "shipping" | "billing") =>
    startTransition(async () => {
      const r = await setDefaultAddressAction({ id: address.id, kind, locale });
      setStatus(r.ok ? { tone: "success", text: r.message ?? b.defaultSet } : { tone: "error", text: r.error });
    });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p role="status" aria-live="polite" className="min-h-6 text-sm">
          {status ? <span className={status.tone === "error" ? "text-red-700 dark:text-red-400" : "text-emerald-800 dark:text-emerald-300"}>{status.text}</span> : null}
        </p>
        {addresses.length > 0 ? (
          <button type="button" onClick={() => setEditing({ mode: "new" })} disabled={full} className={buttonClass("primary", "min-h-11 px-6 rtl:tracking-normal")}>
            <Plus aria-hidden className="size-4" strokeWidth={1.75} />
            {b.add}
          </button>
        ) : null}
      </div>
      {full ? <p className="mb-6 text-sm text-text-muted">{format(b.limit, { max: labels.maxAddresses }, locale)}</p> : null}

      {addresses.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface p-8 text-center sm:p-12">
          <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-gold/12 text-gold-text">
            <MapPin className="size-5" strokeWidth={1.5} />
          </span>
          <p className="mt-4 font-heading text-2xl text-text">{b.empty}</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">{b.emptyHint}</p>
          <button type="button" onClick={() => setEditing({ mode: "new" })} className={buttonClass("primary", "mt-6 rtl:tracking-normal")}>
            <Plus aria-hidden className="size-4" strokeWidth={1.75} />
            {b.add}
          </button>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-busy={pending}>
          {addresses.map((address) => (
            <AddressCard
              key={address.id}
              address={address}
              labels={labels}
              onEdit={() => setEditing({ mode: "edit", address })}
              onDelete={() => setRemoving(address)}
              onDefault={(kind) => setDefault(address, kind)}
              disabled={pending}
            />
          ))}
        </ul>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.mode === "edit" ? b.formTitleEdit : b.formTitleNew} closeLabel={labels.close} size="lg">
        {editing ? (
          <AddressForm
            key={editing.mode === "edit" ? `edit-${editing.address.id}-${editing.address.updatedAt}` : "new"}
            locale={locale}
            address={editing.mode === "edit" ? editing.address : null}
            first={addresses.length === 0}
            labels={labels}
            onCancel={() => setEditing(null)}
            onSaved={(text) => {
              setEditing(null);
              setStatus({ tone: "success", text });
            }}
          />
        ) : null}
      </Modal>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={b.deleteTitle} closeLabel={labels.close} role="alertdialog">
        {removing ? (
          <DeleteConfirm
            text={format(b.deleteText, { title: removing.title }, locale)}
            labels={b}
            onCancel={() => setRemoving(null)}
            onConfirm={async () => {
              const r = await deleteAddressAction({ id: removing.id, locale });
              setRemoving(null);
              setStatus(r.ok ? { tone: "success", text: r.message ?? b.deleted } : { tone: "error", text: r.error });
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function AddressCard({
  address,
  labels,
  onEdit,
  onDelete,
  onDefault,
  disabled,
}: {
  address: SavedAddress;
  labels: AddressBookLabels;
  onEdit: () => void;
  onDelete: () => void;
  onDefault: (kind: "shipping" | "billing") => void;
  disabled: boolean;
}) {
  const b = labels.book;
  const inv = address.invoice;
  const corporate = inv?.type === "corporate";
  return (
    <li className={cn("flex flex-col rounded-md border bg-surface p-5 sm:p-6", address.isDefaultShipping ? "border-gold/60" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-heading text-xl leading-tight text-text">{address.title}</p>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={onEdit} className="grid size-10 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${b.edit}: ${address.title}`}>
            <Pencil aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={onDelete} className="grid size-10 place-items-center rounded-full text-text-muted transition-colors hover:bg-red-700/8 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-ring dark:hover:text-red-400" aria-label={`${b.delete}: ${address.title}`}>
            <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {address.isDefaultShipping || address.isDefaultBilling ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {address.isDefaultShipping ? <Badge>{b.defaultShipping}</Badge> : null}
          {address.isDefaultBilling ? <Badge>{b.defaultBilling}</Badge> : null}
        </div>
      ) : null}
      <div className="mt-4 space-y-1 text-sm leading-relaxed text-text">
        <p className="font-medium">{address.data.fullName}</p>
        {addressLines(address.data).map((line) => (
          <p key={line} className="text-text-muted">
            {line}
          </p>
        ))}
        <p className="text-text-muted">
          <bdi dir="ltr">{formatPhone(address.data.phone)}</bdi>
        </p>
      </div>
      <div className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-sm text-text-muted">
        {corporate ? <Building2 aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} /> : <User aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.6} />}
        <div className="min-w-0">
          <p className="text-text">{corporate ? b.invoiceCorporate : b.invoiceIndividual}</p>
          {corporate && inv ? (
            <>
              <p>{inv.companyName}</p>
              <p>
                <bdi>{format(b.taxInfo, { office: inv.taxOffice ?? "", number: inv.taxNumber ?? "" })}</bdi>
              </p>
            </>
          ) : inv?.nationalId ? (
            <p>{format(b.nationalIdSaved, { masked: maskId(inv.nationalId) ?? "" })}</p>
          ) : null}
        </div>
      </div>
      {!address.isDefaultShipping || !address.isDefaultBilling ? (
        <div className="mt-auto flex flex-wrap gap-x-5 gap-y-1 pt-4">
          {!address.isDefaultShipping ? (
            <button type="button" disabled={disabled} onClick={() => onDefault("shipping")} className="min-h-11 text-sm text-text underline decoration-border underline-offset-4 hover:decoration-gold disabled:opacity-60">
              {b.makeDefaultShipping}
            </button>
          ) : null}
          {!address.isDefaultBilling ? (
            <button type="button" disabled={disabled} onClick={() => onDefault("billing")} className="min-h-11 text-sm text-text underline decoration-border underline-offset-4 hover:decoration-gold disabled:opacity-60">
              {b.makeDefaultBilling}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-gold/12 px-2.5 py-1 text-xs font-medium text-gold-text">{children}</span>;
}

const INITIAL: AccountFormState = { status: "idle", attempt: 0 };

function AddressForm({
  locale,
  address,
  first,
  labels,
  onCancel,
  onSaved,
}: {
  locale: Locale;
  address: SavedAddress | null;
  first: boolean;
  labels: AddressBookLabels;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(saveAddressAction, INITIAL);
  const b = labels.book;
  const f = labels.form;
  const alertRef = useRef<HTMLDivElement>(null);
  const echoed = state.values;
  const v = (name: string, stored: string | undefined) => (echoed ? echoed[name] : stored) ?? "";
  const inv = address?.invoice;
  const [type, setType] = useState<"individual" | "corporate">(() => (echoed?.["invoice.type"] ?? inv?.type) === "corporate" ? "corporate" : "individual");
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.status === "success") onSaved(state.message ?? b.saved);
    else if (state.status === "error") focusFormProblem(alertRef.current, Boolean(state.formError));
  }, [state, onSaved, b.saved]);

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} noValidate className="space-y-6" aria-busy={pending}>
      <input type="hidden" name="locale" value={locale} />
      {address ? <input type="hidden" name="id" value={address.id} /> : null}
      <div ref={alertRef} tabIndex={-1} aria-live="assertive" className="focus:outline-none empty:hidden">
        {state.status === "error" && state.formError ? <FormAlert tone="error">{state.formError}</FormAlert> : null}
      </div>

      <TextField name="title" label={b.titleLabel} optionalLabel={labels.optional} maxLength={40} placeholder={b.titlePlaceholder} hint={b.titleHint} defaultValue={v("title", address?.title)} error={errors.title} />

      <fieldset className="space-y-5">
        <legend className="mb-4 font-heading text-xl text-text">{b.contactSection}</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="address.fullName" label={f.fullName} autoComplete="shipping name" maxLength={100} required defaultValue={v("address.fullName", address?.data.fullName)} error={errors["address.fullName"]} />
          <TextField
            name="address.phone"
            label={labels.phone}
            type="tel"
            inputMode="tel"
            autoComplete="shipping tel"
            dir="ltr"
            maxLength={20}
            placeholder={f.phonePlaceholder}
            required
            defaultValue={v("address.phone", address ? formatPhone(address.data.phone) : undefined)}
            error={errors["address.phone"]}
          />
          <SelectField
            name="address.city"
            label={f.province}
            placeholder={f.provincePlaceholder}
            options={PROVINCES}
            autoComplete="shipping address-level1"
            required
            defaultValue={v("address.city", address?.data.city)}
            error={errors["address.city"]}
          />
          <TextField name="address.district" label={f.district} autoComplete="shipping address-level2" maxLength={60} required defaultValue={v("address.district", address?.data.district)} error={errors["address.district"]} />
          <TextField
            name="address.neighbourhood"
            label={f.neighbourhood}
            optionalLabel={labels.optional}
            autoComplete="shipping address-level3"
            maxLength={80}
            defaultValue={v("address.neighbourhood", address?.data.neighbourhood)}
            error={errors["address.neighbourhood"]}
            className="sm:col-span-2"
          />
          <TextField
            name="address.line1"
            label={f.line1}
            autoComplete="shipping address-line1"
            maxLength={250}
            placeholder={f.line1Placeholder}
            required
            defaultValue={v("address.line1", address?.data.line1)}
            error={errors["address.line1"]}
            className="sm:col-span-2"
          />
          <TextField
            name="address.postalCode"
            label={f.postalCode}
            optionalLabel={labels.optional}
            inputMode="numeric"
            autoComplete="shipping postal-code"
            dir="ltr"
            maxLength={5}
            pattern="[0-9]{5}"
            defaultValue={v("address.postalCode", address?.data.postalCode)}
            error={errors["address.postalCode"]}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5 border-t border-border pt-6">
        <legend className="float-start mb-4 w-full font-heading text-xl text-text">{b.invoiceSection}</legend>
        <div className="clear-both grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={f.invoiceTypeLegend}>
          {(["individual", "corporate"] as const).map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-14 cursor-pointer items-start gap-3 rounded-md border bg-surface p-4 transition-[border-color,box-shadow] duration-200",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                type === option ? "border-brand shadow-[inset_0_0_0_1px_var(--brand)]" : "border-border hover:border-border-strong/60",
              )}
            >
              <input type="radio" name="invoice.type" value={option} checked={type === option} onChange={() => setType(option)} className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand dark:accent-gold" />
              <span>
                <span className="block text-sm font-medium text-text">{option === "individual" ? labels.individual : labels.corporate}</span>
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">{option === "individual" ? f.individualHint : f.corporateHint}</span>
              </span>
            </label>
          ))}
        </div>
        {type === "individual" ? (
          <TextField
            name="invoice.nationalId"
            label={f.nationalId}
            optionalLabel={labels.optional}
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            maxLength={11}
            pattern="[0-9]*"
            hint={f.nationalIdHint}
            defaultValue={v("invoice.nationalId", inv?.type === "individual" ? inv.nationalId : undefined)}
            error={errors["invoice.nationalId"]}
            className="sm:max-w-sm"
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField name="invoice.companyName" label={f.companyName} autoComplete="organization" maxLength={200} required defaultValue={v("invoice.companyName", inv?.companyName)} error={errors["invoice.companyName"]} className="sm:col-span-2" />
            <TextField name="invoice.taxOffice" label={f.taxOffice} autoComplete="off" maxLength={100} required defaultValue={v("invoice.taxOffice", inv?.taxOffice)} error={errors["invoice.taxOffice"]} />
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
              defaultValue={v("invoice.taxNumber", inv?.taxNumber)}
              error={errors["invoice.taxNumber"]}
            />
            <CheckboxField name="invoice.eInvoice" label={f.eInvoice} hint={f.eInvoiceHint} defaultChecked={echoed ? echoed["invoice.eInvoice"] === "on" : Boolean(inv?.eInvoice)} className="sm:col-span-2" />
          </div>
        )}
      </fieldset>

      {!first ? (
        <fieldset className="space-y-3 border-t border-border pt-6">
          <legend className="mb-3 text-sm font-medium text-text">{b.defaultsSection}</legend>
          <CheckboxField name="isDefaultShipping" label={b.defaultShipping} defaultChecked={echoed ? echoed.isDefaultShipping === "on" : Boolean(address?.isDefaultShipping)} />
          <CheckboxField name="isDefaultBilling" label={b.defaultBilling} defaultChecked={echoed ? echoed.isDefaultBilling === "on" : Boolean(address?.isDefaultBilling)} />
        </fieldset>
      ) : null}

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "rtl:tracking-normal")}>
          {b.cancel}
        </button>
        <SubmitButton pending={pending} label={b.save} pendingLabel={b.saving} className="sm:w-auto" />
      </div>
    </form>
  );
}

function DeleteConfirm({ text, labels, onCancel, onConfirm }: { text: string; labels: AddressBookLabels["book"]; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-6">
      <p className="text-base leading-relaxed text-text-muted">{text}</p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={buttonClass("secondary", "rtl:tracking-normal")} autoFocus>
          {labels.cancel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(onConfirm)}
          className={cn(buttonClass("primary", "rtl:tracking-normal"), "bg-red-700 hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-700")}
        >
          {pending ? labels.deleting : labels.deleteConfirm}
        </button>
      </div>
    </div>
  );
}

/** Native modal <dialog>: focus trap, Escape, focus back to the opener. Content mounts only while open. */
export function Modal({
  open,
  onClose,
  title,
  closeLabel,
  children,
  size = "md",
  role = "dialog",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  size?: "md" | "lg";
  role?: "dialog" | "alertdialog";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-md border border-border bg-bg p-0 text-text shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]",
        size === "lg" ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open ? (
        <div className="p-5 sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-heading text-3xl leading-tight text-text">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label={closeLabel} className="-me-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring">
              <X aria-hidden className="size-5" strokeWidth={1.75} />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
