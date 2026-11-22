"use client";
// Müşteri Grupları: list, create, edit and delete customer groups (admin; staff see the list only).
// Delete is refused while anything uses the group (companies, customers, group prices, tiers,
// campaigns, coupons, the default business group setting).
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { createGroupAction, deleteGroupAction, updateGroupAction } from "@/app/panel/(dashboard)/kurumsal-hesaplar/actions";
import EmptyState from "@/components/panel/EmptyState";
import { Field, LocalizedInput, PercentInput, SlugInput, Switch } from "@/components/panel/form";
import { useActionRunner } from "@/components/panel/marketing/use-action-runner";
import StatusBadge from "@/components/panel/StatusBadge";
import { tableClass, tdClass, thClass, theadClass, trClass } from "@/components/panel/table";
import { Button, Dialog, iconButtonClass, useConfirm } from "@/components/panel/ui";
import type { LocalizedText } from "@/db/schema/common";

export type GroupManagerRow = {
  id: number;
  slug: string;
  name: LocalizedText;
  isBusiness: boolean;
  discountPercent: number;
  showPricesExVat: boolean;
  updatedAt: string;
  /** "3 firma ve 2 müşteri" or null when unused. */
  usage: string | null;
  isDefault: boolean;
};

type Draft = { id: number | null; updatedAt: string | null; slug: string; name: LocalizedText; isBusiness: boolean; discountPercent: number | null; showPricesExVat: boolean };

const EMPTY: Draft = { id: null, updatedAt: null, slug: "", name: { tr: "" }, isBusiness: true, discountPercent: 10, showPricesExVat: true };

export default function GroupManager({ groups, canEdit }: { groups: GroupManagerRow[]; canEdit: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useActionRunner();
  const { confirm, confirmDialog } = useConfirm();

  const open = (row: GroupManagerRow | null) => {
    setErrors({});
    setDraft(
      row
        ? { id: row.id, updatedAt: row.updatedAt, slug: row.slug, name: row.name, isBusiness: row.isBusiness, discountPercent: row.discountPercent, showPricesExVat: row.showPricesExVat }
        : { ...EMPTY },
    );
  };

  const save = async () => {
    if (!draft) return;
    const fields = { slug: draft.slug, name: draft.name, isBusiness: draft.isBusiness, discountPercent: draft.discountPercent ?? 0, showPricesExVat: draft.showPricesExVat };
    const result =
      draft.id == null ? await run(createGroupAction, fields) : await run(updateGroupAction, { ...fields, id: draft.id, updatedAt: draft.updatedAt });
    if (result.ok) setDraft(null);
    else setErrors(result.fieldErrors ?? {});
  };

  const remove = async (row: GroupManagerRow) => {
    const ok = await confirm({
      title: `“${row.name.tr}” grubu silinsin mi?`,
      description: "Grup kalıcı olarak silinir. Bu işlem geri alınamaz.",
      confirmLabel: "Grubu sil",
    });
    if (!ok) return;
    await run(deleteGroupAction, { id: row.id, updatedAt: row.updatedAt });
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-muted">
          Grup fiyatı tanımlı varyantlarda o fiyat, diğerlerinde grubun indirimi uygulanır. Kurumsal fiyatlar yalnızca onaylı firmalara bağlı müşterilere
          gösterilir (Ayarlar › Kurumsal).
        </p>
        {canEdit ? (
          <Button variant="primary" icon={Plus} onClick={() => open(null)}>
            Yeni grup
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        {groups.length === 0 ? (
          <EmptyState icon={Users} title="Henüz müşteri grubu yok" description="Kurumsal başvuruları onaylamak için en az bir grup oluşturun." />
        ) : (
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={thClass}>
                  Grup
                </th>
                <th scope="col" className={thClass}>
                  Tür
                </th>
                <th scope="col" className={thClass}>
                  İndirim
                </th>
                <th scope="col" className={thClass}>
                  Fiyat gösterimi
                </th>
                <th scope="col" className={thClass}>
                  Kullanım
                </th>
                {canEdit ? (
                  <th scope="col" className={thClass}>
                    <span className="sr-only">İşlemler</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className={trClass}>
                  <td className={tdClass}>
                    <span className="font-medium">{g.name.tr}</span>
                    <span className="mt-0.5 block font-mono text-xs text-text-muted">{g.slug}</span>
                    {g.isDefault ? (
                      <StatusBadge tone="gold" className="mt-1.5">
                        Varsayılan kurumsal grup
                      </StatusBadge>
                    ) : null}
                  </td>
                  <td className={tdClass}>{g.isBusiness ? "Kurumsal" : "Bireysel"}</td>
                  <td className={`${tdClass} tabular-nums`}>{g.discountPercent ? `%${g.discountPercent}` : "—"}</td>
                  <td className={tdClass}>{g.showPricesExVat ? "KDV hariç" : "KDV dahil"}</td>
                  <td className={`${tdClass} min-w-48 text-xs text-text-muted`}>{g.usage ?? "Kullanılmıyor"}</td>
                  {canEdit ? (
                    <td className={`${tdClass} whitespace-nowrap text-end`}>
                      <button type="button" className={iconButtonClass("sm")} onClick={() => open(g)} aria-label={`${g.name.tr} grubunu düzenle`} disabled={pending}>
                        <Pencil aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClass("sm", "ms-1 text-[#C2413A] disabled:cursor-not-allowed disabled:opacity-40")}
                        onClick={() => remove(g)}
                        aria-label={`${g.name.tr} grubunu sil`}
                        title={g.usage ? `Silinemez: ${g.usage}` : "Grubu sil"}
                        disabled={pending || Boolean(g.usage)}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id == null ? "Yeni müşteri grubu" : "Müşteri grubunu düzenle"}
        description="Değişiklikler sepette ve ödemede hemen uygulanır."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              Vazgeç
            </Button>
            <Button variant="primary" pending={pending} pendingLabel="Kaydediliyor…" onClick={save}>
              Kaydet
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-5">
            <LocalizedInput
              label="Grup adı"
              required
              value={draft.name}
              onChange={(v) => set("name", v)}
              error={{ tr: errors["name.tr"], en: errors["name.en"], ar: errors["name.ar"] }}
              maxLength={80}
              name="name"
            />
            <Field label="Kısa ad" required error={errors.slug} name="slug" help="Ayarlar › Kurumsal'daki varsayılan grup bu kısa adla seçilir.">
              <SlugInput value={draft.slug} onChange={(v) => set("slug", v)} source={draft.name.tr} auto={draft.id == null && !draft.slug} />
            </Field>
            <Field label="İndirim" error={errors.discountPercent} name="discountPercent" help="Grup fiyatı tanımlanmamış varyantlarda perakende fiyattan düşülür (%0–90).">
              <PercentInput value={draft.discountPercent} onChange={(v) => set("discountPercent", v)} max={90} />
            </Field>
            <Switch checked={draft.isBusiness} onChange={(v) => set("isBusiness", v)} label="Kurumsal grup" description="Bu gruptaki müşteriler “Kurumsal fiyatınız” etiketini ve kurumsal ürünleri görür." />
            <Switch
              checked={draft.showPricesExVat}
              onChange={(v) => set("showPricesExVat", v)}
              label="Fiyatları KDV hariç göster"
              description="Ürün sayfasındaki kurumsal fiyat KDV hariç gösterilir; sepet ve fatura her zaman KDV dahil toplamı kullanır."
            />
          </div>
        ) : null}
      </Dialog>
      {confirmDialog}
    </>
  );
}
