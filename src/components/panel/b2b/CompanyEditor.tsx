"use client";
// Company data editor on /panel/kurumsal-hesaplar/<id> (admin). The server validates with the same
// rules as the storefront application (VKN/TCKN check digit, phone, province…).
import { updateCompanyAction } from "@/app/panel/(dashboard)/kurumsal-hesaplar/actions";
import { Field, FieldGroup, SaveBar, Select, TextInput, Textarea, usePanelForm } from "@/components/panel/form";
import type { BusinessSector } from "@/db/schema/commerce";
import { BUSINESS_LIMITS, BUSINESS_SECTORS, SECTOR_LABELS_TR } from "@/lib/b2b/application";

export type CompanyEditorState = {
  id: number;
  updatedAt: string;
  adminNote: string;
  fields: {
    companyName: string;
    sector: BusinessSector;
    taxOffice: string;
    taxNumber: string;
    phone: string;
    email: string;
    website: string;
    address: { city: string; district: string; line1: string; postalCode: string };
  };
};

export default function CompanyEditor({ initial, provinces }: { initial: CompanyEditorState; provinces: string[] }) {
  const form = usePanelForm(initial);
  const { state, setField, errorFor, formRef } = form;
  const f = state.fields;
  const cityOptions = provinces.includes(f.address.city) || !f.address.city ? provinces : [f.address.city, ...provinces];

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-8 pb-20">
      <FieldGroup title="Firma" columns={2}>
        <Field label="Firma unvanı" required error={errorFor("fields.companyName")} name="fields.companyName" className="sm:col-span-2">
          <TextInput value={f.companyName} onChange={(v) => setField("fields.companyName", v)} maxLength={BUSINESS_LIMITS.companyName} />
        </Field>
        <Field label="Sektör" required error={errorFor("fields.sector")} name="fields.sector">
          <Select value={f.sector} onChange={(v) => setField("fields.sector", v)} options={BUSINESS_SECTORS.map((s) => ({ value: s, label: SECTOR_LABELS_TR[s] }))} />
        </Field>
        <Field label="Web sitesi" optional error={errorFor("fields.website")} name="fields.website">
          <TextInput value={f.website} onChange={(v) => setField("fields.website", v)} dir="ltr" placeholder="www.firma.com" maxLength={BUSINESS_LIMITS.website} />
        </Field>
        <Field label="Vergi dairesi" required error={errorFor("fields.taxOffice")} name="fields.taxOffice">
          <TextInput value={f.taxOffice} onChange={(v) => setField("fields.taxOffice", v)} maxLength={BUSINESS_LIMITS.taxOffice} />
        </Field>
        <Field label="Vergi no / T.C. kimlik no" required error={errorFor("fields.taxNumber")} name="fields.taxNumber" help="VKN 10, T.C. kimlik no 11 hane.">
          <TextInput value={f.taxNumber} onChange={(v) => setField("fields.taxNumber", v)} dir="ltr" inputMode="numeric" maxLength={14} />
        </Field>
        <Field label="Telefon" required error={errorFor("fields.phone")} name="fields.phone">
          <TextInput value={f.phone} onChange={(v) => setField("fields.phone", v)} dir="ltr" inputMode="tel" maxLength={22} />
        </Field>
        <Field label="Firma e-postası" required error={errorFor("fields.email")} name="fields.email">
          <TextInput value={f.email} onChange={(v) => setField("fields.email", v)} dir="ltr" inputMode="email" maxLength={BUSINESS_LIMITS.email} />
        </Field>
      </FieldGroup>

      <FieldGroup title="Adres" columns={2}>
        <Field label="İl" required error={errorFor("fields.address.city")} name="fields.address.city">
          <Select value={f.address.city || null} onChange={(v) => setField("fields.address.city", v)} options={cityOptions.map((p) => ({ value: p, label: p }))} placeholder="İl seçin" />
        </Field>
        <Field label="İlçe" required error={errorFor("fields.address.district")} name="fields.address.district">
          <TextInput value={f.address.district} onChange={(v) => setField("fields.address.district", v)} maxLength={BUSINESS_LIMITS.district} />
        </Field>
        <Field label="Adres" required error={errorFor("fields.address.line1")} name="fields.address.line1" className="sm:col-span-2">
          <TextInput value={f.address.line1} onChange={(v) => setField("fields.address.line1", v)} maxLength={BUSINESS_LIMITS.line1} />
        </Field>
        <Field label="Posta kodu" optional error={errorFor("fields.address.postalCode")} name="fields.address.postalCode">
          <TextInput value={f.address.postalCode} onChange={(v) => setField("fields.address.postalCode", v)} dir="ltr" inputMode="numeric" maxLength={5} />
        </Field>
      </FieldGroup>

      <FieldGroup title="Yönetici notu">
        <Field label="Not" optional help="Yalnızca panelde görünür; müşteriye gösterilmez." error={errorFor("adminNote")} name="adminNote">
          <Textarea value={state.adminNote} onChange={(v) => setField("adminNote", v)} rows={3} maxLength={BUSINESS_LIMITS.adminNote} />
        </Field>
      </FieldGroup>

      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={() => form.reset()}
        onSave={() =>
          form.submit<{ updatedAt: string }>(updateCompanyAction, {
            payload: (s) => ({ id: s.id, updatedAt: s.updatedAt, adminNote: s.adminNote, fields: s.fields }),
            resetTo: (sent, data) => ({ ...sent, updatedAt: data?.updatedAt ?? sent.updatedAt }),
          })
        }
      />
    </form>
  );
}
