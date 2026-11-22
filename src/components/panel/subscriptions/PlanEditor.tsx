"use client";

// The "Planlar" tab (admin): subscription plans with their rhythm, subscriber discount and status.
// Create and edit in a dialog; delete only when no subscription uses the plan (otherwise switch it
// off: existing subscriptions keep renewing, new customers no longer see it).
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createPlanAction, deletePlanAction, savePlanAction } from "@/app/panel/(dashboard)/abonelikler/actions";
import { formatNumber } from "@/components/panel/labels";
import Field from "@/components/panel/form/Field";
import { LocalizedInput } from "@/components/panel/form/LocalizedInput";
import { NumberInput, PercentInput } from "@/components/panel/form/NumberInput";
import Select from "@/components/panel/form/Select";
import Switch from "@/components/panel/form/Switch";
import StatusBadge from "@/components/panel/StatusBadge";
import { Button, ConfirmDialog, Dialog, toast } from "@/components/panel/ui";
import type { LocalizedText } from "@/i18n/locales";
import { toPayloadFormData, type ActionResult } from "@/lib/panel/action-types";
import { rhythmLabel } from "./labels";

export type PlanRow = {
  id: number;
  name: LocalizedText;
  interval: "week" | "month";
  intervalCount: number;
  discountPercent: number;
  isActive: boolean;
  position: number;
  updatedAt: string;
  inUse: number;
  activeUse: number;
};

type Draft = { id: number | null; updatedAt: string | null; name: LocalizedText; interval: "week" | "month"; intervalCount: number | null; discountPercent: number | null; isActive: boolean; position: number | null };

const emptyDraft = (position: number): Draft => ({ id: null, updatedAt: null, name: { tr: "" }, interval: "month", intervalCount: 1, discountPercent: 5, isActive: true, position });

export default function PlanEditor({ plans, canEdit }: { plans: PlanRow[]; canEdit: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<PlanRow | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (plan?: PlanRow) => {
    setErrors({});
    setDraft(
      plan
        ? { id: plan.id, updatedAt: plan.updatedAt, name: plan.name, interval: plan.interval, intervalCount: plan.intervalCount, discountPercent: plan.discountPercent, isActive: plan.isActive, position: plan.position }
        : emptyDraft(plans.length ? Math.max(...plans.map((p) => p.position)) + 1 : 0),
    );
  };

  const report = (result: ActionResult<unknown>, onOk: () => void) => {
    if (result.ok) {
      toast.success(result.message ?? "Kaydedildi.");
      onOk();
    } else {
      setErrors(result.fieldErrors ?? {});
      toast.error(result.error, result.code === "conflict" ? { action: { label: "Sayfayı yenile", onClick: () => location.reload() }, duration: 0 } : undefined);
    }
  };

  const save = () => {
    if (!draft) return;
    const payload = {
      name: draft.name,
      interval: draft.interval,
      intervalCount: draft.intervalCount,
      discountPercent: draft.discountPercent ?? 0,
      isActive: draft.isActive,
      position: draft.position ?? 0,
      ...(draft.id != null ? { id: draft.id, updatedAt: draft.updatedAt } : {}),
    };
    startTransition(async () => {
      const result = draft.id != null ? await savePlanAction(null, toPayloadFormData(payload)) : await createPlanAction(null, toPayloadFormData(payload));
      report(result, () => setDraft(null));
    });
  };

  const remove = (plan: PlanRow) =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await deletePlanAction(null, toPayloadFormData({ id: plan.id, updatedAt: plan.updatedAt }));
        report(result, () => undefined);
        setRemoving(null);
        resolve();
      });
    });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(next)) if (k === key || k.startsWith(`${String(key)}.`)) delete next[k];
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button variant="primary" icon={Plus} onClick={() => open()}>
            Yeni plan
          </Button>
        </div>
      ) : null}

      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {plans.length === 0 ? <li className="px-5 py-6 text-sm text-text-muted">Henüz plan yok. Müşterilerin seçebileceği bir teslimat sıklığı ekleyin (ör. Her ay, %5 indirim).</li> : null}
        {plans.map((plan) => (
          <li key={plan.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                {plan.name.tr}
                <StatusBadge tone={plan.isActive ? "success" : "neutral"}>{plan.isActive ? "Sunuluyor" : "Pasif"}</StatusBadge>
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {[
                  rhythmLabel(plan.interval, plan.intervalCount),
                  plan.discountPercent > 0 ? `%${plan.discountPercent} abone indirimi` : "İndirimsiz",
                  plan.inUse > 0 ? `${formatNumber(plan.activeUse)} aktif / ${formatNumber(plan.inUse)} toplam abonelik` : "Kullanılmıyor",
                ].join(" · ")}
              </p>
            </div>
            {canEdit ? (
              <div className="flex gap-2">
                <Button size="sm" icon={Pencil} onClick={() => open(plan)}>
                  Düzenle
                </Button>
                <Button size="sm" variant="danger-outline" icon={Trash2} onClick={() => setRemoving(plan)} disabled={pending}>
                  Sil
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-text-muted">
        Abone indirimi, ürünün güncel fiyatına uygulanır ve otomatik kampanyalarla birleşmez: hangisi daha avantajlıysa o geçerli olur. Kuponlar her zamanki gibi ayrıca kullanılabilir.
        Pasif planlar yeni müşterilere gösterilmez; mevcut abonelikler aynı indirimle yenilenmeye devam eder. Bir planın indirimini veya sıklığını
        değiştirmek ise o plandaki mevcut aboneliklerin sonraki yenilemelerini de etkiler.
      </p>

      {draft ? (
        <Dialog
          open
          onClose={() => setDraft(null)}
          title={draft.id != null ? "Planı düzenle" : "Yeni plan"}
          description="Müşteriler ürün sayfasında ve hesaplarında bu planı seçer."
          footer={
            <>
              <Button onClick={() => setDraft(null)}>Vazgeç</Button>
              <Button variant="primary" onClick={save} pending={pending} pendingLabel="Kaydediliyor…">
                Kaydet
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <LocalizedInput label="Plan adı" required value={draft.name} onChange={(v) => set("name", v)} error={localizedError(errors, "name")} name="name" maxLength={60} placeholder="Her ay" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sıklık" required error={errors.intervalCount ?? errors.interval ?? null} name="intervalCount" help="Ör. 2 + Hafta = 2 haftada bir.">
                <div className="flex gap-2">
                  <NumberInput value={draft.intervalCount} onChange={(v) => set("intervalCount", v)} min={1} max={12} nullable={false} />
                  <Select<"week" | "month">
                    value={draft.interval}
                    onChange={(v) => set("interval", v)}
                    options={[
                      { value: "week", label: "Hafta" },
                      { value: "month", label: "Ay" },
                    ]}
                  />
                </div>
              </Field>
              <Field label="Abone indirimi" error={errors.discountPercent ?? null} name="discountPercent" help="0 = indirimsiz plan.">
                <PercentInput value={draft.discountPercent} onChange={(v) => set("discountPercent", v)} min={0} max={50} />
              </Field>
              <Field label="Sıra" error={errors.position ?? null} name="position" help="Küçük sayı önce gösterilir.">
                <NumberInput value={draft.position} onChange={(v) => set("position", v)} min={0} max={999} nullable={false} />
              </Field>
              <Field label="Durum" name="isActive">
                <Switch checked={draft.isActive} onChange={(v) => set("isActive", v)} label="Yeni müşterilere sun" />
              </Field>
            </div>
            {(() => {
              const current = draft.id != null ? plans.find((p) => p.id === draft.id) : undefined;
              if (!current || current.activeUse === 0) return null;
              const changed = current.discountPercent !== (draft.discountPercent ?? 0) || current.interval !== draft.interval || current.intervalCount !== (draft.intervalCount ?? 1);
              return (
                <p role="note" className={changed ? "rounded-lg border border-[#D68A12]/40 bg-[#D68A12]/10 px-3 py-2.5 text-xs leading-relaxed text-text" : "text-xs leading-relaxed text-text-muted"}>
                  Bu plan {formatNumber(current.activeUse)} aktif abonelikte kullanılıyor. İndirim veya sıklık değişikliği bu abonelerin sonraki
                  yenilemelerinden itibaren onlara da uygulanır ve abonelere ayrıca e-posta gönderilmez. Yalnızca yeni müşterilerin teklifini
                  değiştirmek istiyorsanız yeni bir plan oluşturup bu planı pasif yapın.
                </p>
              );
            })()}
            <p className="text-xs text-text-muted">Önizleme: {draft.name.tr || "Plan"} · {rhythmLabel(draft.interval, draft.intervalCount ?? 1)}{(draft.discountPercent ?? 0) > 0 ? ` · %${draft.discountPercent} indirim` : ""}</p>
          </div>
        </Dialog>
      ) : null}

      {removing ? (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
          title={`“${removing.name.tr}” planı silinsin mi?`}
          description={
            removing.inUse > 0
              ? `Bu plan ${removing.inUse} abonelikte kullanıldığı için silinemez; bunun yerine pasifleştirebilirsiniz.`
              : "Plan ürün sayfalarından kalkar. Bu işlem geri alınamaz."
          }
          confirmLabel="Sil"
          confirmDisabled={removing.inUse > 0}
          pending={pending}
        />
      ) : null}
    </div>
  );
}

function localizedError(errors: Record<string, string>, key: string): string | { tr?: string; en?: string; ar?: string } | undefined {
  if (errors[key]) return errors[key];
  const out: { tr?: string; en?: string; ar?: string } = {};
  for (const l of ["tr", "en", "ar"] as const) if (errors[`${key}.${l}`]) out[l] = errors[`${key}.${l}`];
  return Object.keys(out).length ? out : undefined;
}
