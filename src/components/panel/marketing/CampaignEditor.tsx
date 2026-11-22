"use client";
// Campaign editor (new and existing). One save with the whole campaign, locked by `updatedAt`; a live
// preview of the affected prices on the side.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  createCampaignAction,
  deleteCampaignAction,
  saveCampaignAction,
} from "@/app/panel/(dashboard)/kampanyalar/actions";
import Card from "@/components/panel/Card";
import {
  CategoryPicker,
  Field,
  FieldGroup,
  LocalizedInput,
  NumberInput,
  PercentInput,
  ProductPicker,
  SaveBar,
  ScheduleInput,
  Select,
  Switch,
  TextInput,
  usePanelForm,
} from "@/components/panel/form";
import PageHeader from "@/components/panel/PageHeader";
import { Button, ConfirmDialog } from "@/components/panel/ui";
import StatusBadge from "@/components/panel/StatusBadge";
import type { LocalizedText } from "@/db/schema/common";
import { campaignBadgeText } from "@/lib/campaigns/display";
import type { CampaignStatus } from "@/lib/panel/marketing/queries";
import CampaignPreview from "./CampaignPreview";
import GroupChecklist, { type GroupOption } from "./GroupChecklist";
import { CAMPAIGN_STATUS } from "./labels";
import { useActionRunner } from "./use-action-runner";

export type CampaignState = {
  id: number | null;
  name: string;
  label: LocalizedText | null;
  discountPercent: number | null;
  productIds: number[];
  categoryIds: number[];
  customerGroupIds: number[];
  schedule: { startsAt: string | null; endsAt: string | null };
  priority: number | null;
  isActive: boolean;
  themeId: number | null;
  updatedAt: string | null;
};

export const NEW_CAMPAIGN: CampaignState = {
  id: null,
  name: "",
  label: null,
  discountPercent: 10,
  productIds: [],
  categoryIds: [],
  customerGroupIds: [],
  schedule: { startsAt: null, endsAt: null },
  priority: 0,
  isActive: true,
  themeId: null,
  updatedAt: null,
};

type ThemeOption = { id: number; name: string; isDefault: boolean };

const LIST_PATH = "/panel/kampanyalar";

export default function CampaignEditor({
  initial,
  groups,
  themes,
  status: savedStatus,
}: {
  initial: CampaignState;
  groups: GroupOption[];
  themes: ThemeOption[];
  /** Status of the saved campaign now (server clock); null for a new one. */
  status: CampaignStatus | null;
}) {
  const router = useRouter();
  const form = usePanelForm(initial);
  const { state, setField, errorFor, formRef } = form;
  const isNew = state.id == null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const runner = useActionRunner();

  const payload = (s: CampaignState) => ({
    ...(s.id != null ? { id: s.id, updatedAt: s.updatedAt } : {}),
    name: s.name,
    label: s.label,
    discountPercent: s.discountPercent,
    productIds: s.productIds,
    categoryIds: s.categoryIds,
    customerGroupIds: s.customerGroupIds,
    schedule: s.schedule,
    priority: s.priority ?? 0,
    isActive: s.isActive,
    themeId: s.themeId,
  });

  const save = async () => {
    if (isNew) {
      await form.submit(createCampaignAction, {
        payload,
        // Routes stay mounted (hidden) after navigation: leave the "new" form blank for next time.
        resetTo: () => initial,
        onSuccess: (data) => {
          if (data) router.replace(`${LIST_PATH}/${data.id}`);
        },
      });
    } else {
      await form.submit(saveCampaignAction, {
        payload,
        resetTo: (sent, data) => ({ ...sent, updatedAt: data?.updatedAt ?? sent.updatedAt }),
      });
    }
  };

  const remove = () =>
    runner.run(deleteCampaignAction, { id: state.id, updatedAt: form.saved.updatedAt }, {
      onSuccess: () => {
        setConfirmDelete(false);
        form.reset(form.state); // nothing unsaved any more: leave without the guard
        router.push(LIST_PATH);
      },
    });

  const saved = form.saved;
  const status = savedStatus ? CAMPAIGN_STATUS[savedStatus] : null;
  const badgeText = campaignBadgeText({ percent: state.discountPercent ?? 0, label: state.label }, "tr");
  const themeChoices = themes.filter((t) => !t.isDefault).map((t) => ({ value: t.id, label: t.name }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={LIST_PATH}
          className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Kampanyalar
        </Link>
      </div>
      <PageHeader
        eyebrow="Pazarlama"
        title={isNew ? "Yeni kampanya" : saved.name || "Kampanya"}
        description={
          isNew
            ? "Seçtiğiniz ürünlere kod gerekmeden otomatik indirim uygulanır; vitrinde rozet ve üstü çizili fiyatla görünür."
            : "Değişiklikler kaydedildiğinde vitrin ve sepet fiyatları güncellenir."
        }
        actions={
          isNew ? null : (
            <>
              {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
              <Button variant="danger-outline" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Sil
              </Button>
            </>
          )
        }
      />

      <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate className="grid gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Kampanya" description="Adı yalnızca panelde görünür; rozet metni müşterilere gösterilir.">
            <div className="space-y-5">
              <Field label="Kampanya adı" required error={errorFor("name")} name="name" help="Örn. “Bahar 2027 – 5 L ürünler”. Yalnızca panelde görünür.">
                <TextInput value={state.name} onChange={(v) => setField("name", v)} maxLength={120} placeholder="Kampanya adı" />
              </Field>
              <LocalizedInput
                label="Rozet metni"
                value={state.label}
                onChange={(v) => setField("label", v)}
                error={form.localizedError("label")}
                maxLength={32}
                placeholder="Örn. Bahar İndirimi"
                name="label"
                help="Ürün kartında ve ürün sayfasında fiyatın yanında görünür (en fazla 32 karakter). Boş bırakılan dillerde indirim oranı gösterilir, örneğin −%15."
              />
              <FieldGroup columns={2}>
                <Field
                  label="İndirim oranı"
                  required
                  error={errorFor("discountPercent")}
                  name="discountPercent"
                  help="1 ile 90 arasında. Normal fiyata uygulanır ve sepetle aynı şekilde kuruşa yuvarlanır."
                >
                  <PercentInput value={state.discountPercent} onChange={(v) => setField("discountPercent", v)} min={1} max={90} />
                </Field>
                <Field
                  label="Öncelik"
                  error={errorFor("priority")}
                  name="priority"
                  help="Bir ürüne aynı anda birden fazla kampanya uyarsa önceliği yüksek olan, eşitse indirimi büyük olan uygulanır. Kampanyalar toplanmaz."
                >
                  <NumberInput value={state.priority} onChange={(v) => setField("priority", v)} min={0} max={100} nullable={false} />
                </Field>
              </FieldGroup>
              <Field label="Durum" error={errorFor("isActive")} name="isActive">
                <Switch
                  checked={state.isActive}
                  onChange={(v) => setField("isActive", v)}
                  label={state.isActive ? "Etkin" : "Durduruldu"}
                  description={state.isActive ? "Zamanlama içindeyken uygulanır." : "Zamanlama ne olursa olsun uygulanmaz; ayarları saklanır."}
                />
              </Field>
            </div>
          </Card>

          <Card title="Kapsam" description="Hiçbir ürün veya kategori seçmezseniz kampanya tüm ürünlere uygulanır.">
            <div className="space-y-5">
              <Field
                label="Ürünler"
                optional
                error={errorFor("productIds")}
                name="productIds"
                help="Seçilen ürünlerin tüm boyları (varyantları) indirimli olur. Numune ürünler kampanyaya dahil edilmez."
              >
                <ProductPicker multiple value={state.productIds} onChange={(ids) => setField("productIds", ids)} max={500} placeholder="Ürün ekleyin" dialogTitle="Kampanyaya ürün ekle" />
              </Field>
              <Field
                label="Kategoriler"
                optional
                error={errorFor("categoryIds")}
                name="categoryIds"
                help="Doğrudan bu kategorilere bağlı ürünler indirimli olur; alt kategorileri ayrıca seçin. Ürün ve kategori birlikte seçilirse ikisinden birine uyan ürünler indirimli olur."
              >
                <CategoryPicker multiple value={state.categoryIds} onChange={(ids) => setField("categoryIds", ids)} />
              </Field>
              <GroupChecklist
                legend="Müşteri grupları"
                help="Boş bırakırsanız herkes yararlanır. Grup seçerseniz indirim yalnızca bu gruptaki müşterilerin sepetinde uygulanır ve vitrinde gösterilmez."
                groups={groups}
                value={state.customerGroupIds}
                onChange={(ids) => setField("customerGroupIds", ids)}
                error={errorFor("customerGroupIds")}
                name="customerGroupIds"
              />
            </div>
          </Card>

          <Card title="Zamanlama">
            <ScheduleInput
              label="Geçerlilik"
              value={state.schedule}
              onChange={(v) => setField("schedule", v)}
              error={form.errorsUnder("schedule")}
              name="schedule"
              startLabel="Başlangıç"
              endLabel="Bitiş"
              help="Türkiye saatiyle. Başlangıç boşsa hemen, bitiş boşsa süresiz geçerlidir. Vitrin birkaç dakika içinde güncellenir; sepet fiyatı her zaman anında doğrudur."
            />
          </Card>

          <Card title="Tema" description="İsteğe bağlı: kampanya süresince sitenin görünümünü değiştirin.">
            <Field
              label="Kampanya teması"
              optional
              error={errorFor("themeId")}
              name="themeId"
              help={
                themeChoices.length
                  ? "Kampanya geçerliyken bu tema etkin olur. Birden fazla tema aynı anda geçerliyse tema önceliği belirleyicidir."
                  : "Varsayılan dışında tema yok. Tema & Renkler bölümünden yeni bir tema oluşturabilirsiniz."
              }
            >
              <Select
                value={state.themeId}
                onChange={(v) => setField("themeId", v)}
                options={themeChoices}
                placeholder="Tema değişmesin"
                allowEmpty
                onClear={() => setField("themeId", null)}
                disabled={themeChoices.length === 0 && state.themeId == null}
              />
            </Field>
          </Card>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <CampaignPreview
            badgeText={badgeText}
            request={{
              id: state.id,
              discountPercent: state.discountPercent,
              productIds: state.productIds,
              categoryIds: state.categoryIds,
              customerGroupIds: state.customerGroupIds,
              schedule: state.schedule,
              priority: state.priority ?? 0,
            }}
          />
        </aside>

        <SaveBar
          className="lg:col-span-2"
          dirty={form.dirty}
          pending={form.pending}
          errorCount={Object.keys(form.errors).length}
          onSave={save}
          onReset={isNew ? undefined : () => form.reset()}
          allowCleanSave={isNew}
          saveLabel={isNew ? "Kampanyayı oluştur" : "Kaydet"}
          pendingLabel={isNew ? "Oluşturuluyor…" : "Kaydediliyor…"}
          savedNote={isNew ? "Henüz kaydedilmedi" : undefined}
        />
      </form>

      {isNew ? null : (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
          pending={runner.pending}
          title="Kampanya silinsin mi?"
          description={`“${saved.name}” kalıcı olarak silinir; vitrindeki rozet ve indirimli fiyatlar kalkar. Verilmiş siparişlerin fiyatları değişmez.`}
          confirmLabel="Kampanyayı sil"
        />
      )}
    </div>
  );
}
