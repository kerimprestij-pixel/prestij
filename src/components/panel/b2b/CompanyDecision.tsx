"use client";
// Approve / reject a business application, edit the group and payment terms of an approved company,
// or revoke the approval. Admin only (the page renders this only for admins; the actions re-check).
import { BadgeCheck, CircleX, Settings2 } from "lucide-react";
import { useState } from "react";
import { approveCompanyAction, rejectCompanyAction, updateCompanyTermsAction } from "@/app/panel/(dashboard)/kurumsal-hesaplar/actions";
import { Field, NumberInput, Select, Switch, Textarea } from "@/components/panel/form";
import { useActionRunner } from "@/components/panel/marketing/use-action-runner";
import { Button, Dialog } from "@/components/panel/ui";
import type { LocalizedText } from "@/db/schema/common";
import type { CompanyStatus } from "@/db/schema/commerce";
import { BUSINESS_LIMITS, DEFERRED_DAYS } from "@/lib/b2b/application";

export type DecisionGroup = { id: number; name: LocalizedText; isBusiness: boolean; discountPercent: number; showPricesExVat: boolean };

type Props = {
  company: { id: number; name: string; status: CompanyStatus; updatedAt: string; groupId: number | null; paymentTerms: { allowDeferred?: boolean; days?: number } | null };
  groups: DecisionGroup[];
  /** Preselected group for a new approval (settings.b2b.defaultGroupSlug). */
  defaultGroupId: number | null;
  /** Who will get the e-mail ("ayse@otel.com"), or null when nobody can be reached. */
  recipient: string | null;
};

const groupOption = (g: DecisionGroup) => ({
  value: g.id,
  label: `${g.name.tr}${g.discountPercent ? ` · %${g.discountPercent} indirim` : ""}${g.showPricesExVat ? " · KDV hariç fiyat" : ""}${g.isBusiness ? "" : " · bireysel grup"}`,
});

export default function CompanyDecision({ company, groups, defaultGroupId, recipient }: Props) {
  const [open, setOpen] = useState<"approve" | "terms" | "reject" | null>(null);
  const { pending, run } = useActionRunner();
  const approved = company.status === "approved";

  const [groupId, setGroupId] = useState<number | null>(company.groupId ?? defaultGroupId);
  const [allowDeferred, setAllowDeferred] = useState(Boolean(company.paymentTerms?.allowDeferred));
  const [days, setDays] = useState<number | null>(company.paymentTerms?.days ?? DEFERRED_DAYS.default);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const openDialog = (which: "approve" | "terms" | "reject") => {
    setErrors({});
    setGroupId(company.groupId ?? defaultGroupId);
    setAllowDeferred(Boolean(company.paymentTerms?.allowDeferred));
    setDays(company.paymentTerms?.days ?? DEFERRED_DAYS.default);
    setReason("");
    setOpen(which);
  };

  const submitTerms = async () => {
    const action = open === "terms" ? updateCompanyTermsAction : approveCompanyAction;
    const result = await run(action, { id: company.id, groupId, allowDeferred, days: allowDeferred ? days : null, updatedAt: company.updatedAt });
    if (result.ok) setOpen(null);
    else setErrors(result.fieldErrors ?? {});
  };

  const submitReject = async () => {
    const result = await run(rejectCompanyAction, { id: company.id, reason, updatedAt: company.updatedAt });
    if (result.ok) setOpen(null);
    else setErrors(result.fieldErrors ?? {});
  };

  const selected = groups.find((g) => g.id === groupId) ?? null;
  const termsForm = (
    <div className="space-y-5">
      <Field label="Müşteri grubu" required error={errors.groupId} name="groupId" help="Firmanın üyeleri bu grubun fiyatlarını görür (grup fiyatı, yoksa grup indirimi).">
        <Select value={groupId} onChange={(v) => setGroupId(v)} options={groups.map(groupOption)} placeholder="Grup seçin" />
      </Field>
      {selected && !selected.isBusiness ? (
        <p className="rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2 text-xs text-text">
          Bu grup kurumsal olarak işaretli değil. Firmalar için genellikle “Kurumsal” veya “Otel Partner” gibi bir grup seçilir.
        </p>
      ) : null}
      <Field label="Vadeli ödeme (cari hesap)" name="allowDeferred">
        <Switch
          checked={allowDeferred}
          onChange={setAllowDeferred}
          description="Açıksa ödeme adımında “Vadeli ödeme (cari hesap)” görünür; sipariş peşin ödeme olmadan hazırlanır."
        />
      </Field>
      {allowDeferred ? (
        <Field label="Vade (gün)" required error={errors.days} name="days" help={`${DEFERRED_DAYS.min}–${DEFERRED_DAYS.max} gün. Müşteri ödeme adımında ve e-postalarda bu süreyi görür.`}>
          <NumberInput value={days} onChange={setDays} min={DEFERRED_DAYS.min} max={DEFERRED_DAYS.max} suffix="gün" />
        </Field>
      ) : null}
    </div>
  );

  return (
    <>
      {approved ? (
        <>
          <Button variant="secondary" icon={Settings2} onClick={() => openDialog("terms")} disabled={pending}>
            Koşulları düzenle
          </Button>
          <Button variant="danger-outline" icon={CircleX} onClick={() => openDialog("reject")} disabled={pending}>
            Onayı kaldır
          </Button>
        </>
      ) : (
        <>
          <Button variant="primary" icon={BadgeCheck} onClick={() => openDialog("approve")} disabled={pending}>
            Onayla
          </Button>
          {company.status === "pending" ? (
            <Button variant="danger-outline" icon={CircleX} onClick={() => openDialog("reject")} disabled={pending}>
              Reddet
            </Button>
          ) : null}
        </>
      )}

      <Dialog
        open={open === "approve" || open === "terms"}
        onClose={() => setOpen(null)}
        title={open === "terms" ? "Grup ve ödeme koşulları" : `${company.name} onaylansın mı?`}
        description={
          open === "terms"
            ? "Değişiklik firmanın bütün üyelerine hemen uygulanır; müşteriye e-posta gitmez."
            : recipient
              ? `Onay e-postası ${recipient} adresine gider ve firmanın üyeleri kurumsal fiyatları hemen görür.`
              : "Firmanın üyeleri kurumsal fiyatları hemen görür. Firmaya ulaşılacak bir e-posta adresi yok."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)} disabled={pending}>
              Vazgeç
            </Button>
            <Button variant="primary" icon={BadgeCheck} pending={pending} pendingLabel="Kaydediliyor…" onClick={submitTerms}>
              {open === "terms" ? "Kaydet" : "Onayla"}
            </Button>
          </>
        }
      >
        {termsForm}
      </Dialog>

      <Dialog
        open={open === "reject"}
        onClose={() => setOpen(null)}
        role="alertdialog"
        title={approved ? "Kurumsal onay kaldırılsın mı?" : "Başvuru reddedilsin mi?"}
        description={
          approved
            ? "Firmanın üyeleri hemen perakende fiyatlara döner ve vadeli ödeme kapanır. Yazdığınız gerekçe müşteriye e-postayla gider."
            : recipient
              ? `Yazdığınız gerekçe ${recipient} adresine e-postayla gider ve müşterinin hesabında görünür.`
              : "Yazdığınız gerekçe müşterinin hesabında görünür."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)} disabled={pending}>
              Vazgeç
            </Button>
            <Button variant="danger" icon={CircleX} pending={pending} pendingLabel="Kaydediliyor…" onClick={submitReject}>
              {approved ? "Onayı kaldır" : "Reddet"}
            </Button>
          </>
        }
      >
        <Field label="Gerekçe" required error={errors.reason} name="reason" help="Kibar ve açık yazın; müşteri bilgilerini düzeltip yeniden başvurabilir.">
          <Textarea value={reason} onChange={setReason} rows={4} maxLength={BUSINESS_LIMITS.rejectionReason} placeholder="Ör. Vergi levhanızdaki unvan ile başvurudaki firma adı eşleşmiyor." />
        </Field>
      </Dialog>
    </>
  );
}
