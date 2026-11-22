"use client";
// Coupon editor (new and existing): every column of `coupons`; the usage counter is read-only (orders
// maintain it). Delete only while unused, otherwise the dialog offers to deactivate instead.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Ban, Dices, Trash2 } from "lucide-react";
import { createCouponAction, deleteCouponAction, saveCouponAction, setCouponActiveAction } from "@/app/panel/(dashboard)/kuponlar/actions";
import Card from "@/components/panel/Card";
import {
  CategoryPicker,
  Field,
  FieldGroup,
  MoneyInput,
  NumberInput,
  PercentInput,
  ProductPicker,
  SaveBar,
  ScheduleInput,
  Switch,
  Textarea,
  TextInput,
  usePanelForm,
} from "@/components/panel/form";
import { formatNumber } from "@/components/panel/labels";
import PageHeader from "@/components/panel/PageHeader";
import StatusBadge from "@/components/panel/StatusBadge";
import { Button, ConfirmDialog } from "@/components/panel/ui";
import type { CouponType } from "@/db/schema/commerce";
import type { ScheduleStatus } from "@/lib/panel/marketing/status";
import { cn } from "@/lib/utils";
import GroupChecklist, { type GroupOption } from "./GroupChecklist";
import { COUPON_STATUS, COUPON_TYPE } from "./labels";
import { useActionRunner } from "./use-action-runner";

export type CouponState = {
  id: number | null;
  code: string;
  description: string;
  type: CouponType;
  /** Percent for "percent", kuruş for "fixed"; ignored for "free_shipping". */
  value: number | null;
  minOrderTotal: number | null;
  maxUses: number | null;
  perCustomerLimit: number | null;
  productIds: number[];
  categoryIds: number[];
  customerGroupIds: number[];
  schedule: { startsAt: string | null; endsAt: string | null };
  isActive: boolean;
  updatedAt: string | null;
};

export const NEW_COUPON: CouponState = {
  id: null,
  code: "",
  description: "",
  type: "percent",
  value: 10,
  minOrderTotal: null,
  maxUses: null,
  perCustomerLimit: 1,
  productIds: [],
  categoryIds: [],
  customerGroupIds: [],
  schedule: { startsAt: null, endsAt: null },
  isActive: true,
  updatedAt: null,
};

const LIST_PATH = "/panel/kuponlar";
// No 0/O, 1/I/L: codes are read aloud and typed from print.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  const bytes = new Uint32Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const TYPES: { value: CouponType; label: string; hint: string }[] = [
  { value: "percent", label: COUPON_TYPE.percent, hint: "Uygun ürünlerin toplamından yüzde düşer." },
  { value: "fixed", label: COUPON_TYPE.fixed, hint: "Uygun ürünlerin toplamından sabit tutar düşer (toplamı aşamaz)." },
  { value: "free_shipping", label: COUPON_TYPE.free_shipping, hint: "Kargo ücreti alınmaz; ağır gönderi ek ücreti yine uygulanır." },
];

export default function CouponEditor({
  initial,
  groups,
  usage,
  status: savedStatus,
}: {
  initial: CouponState;
  groups: GroupOption[];
  /** Existing coupons: the usage counter and the orders that reference the coupon. */
  usage: { usedCount: number; orderCount: number } | null;
  /** Status of the saved coupon now (server clock); null for a new one. */
  status: ScheduleStatus | null;
}) {
  const router = useRouter();
  const form = usePanelForm(initial);
  const { state, setField, errorFor, formRef } = form;
  const isNew = state.id == null;
  const runner = useActionRunner();
  const [dialog, setDialog] = useState<"delete" | "deactivate" | null>(null);
  const used = usage ? Math.max(usage.usedCount, usage.orderCount) : 0;

  const payload = (s: CouponState) => ({
    ...(s.id != null ? { id: s.id, updatedAt: s.updatedAt } : {}),
    code: s.code,
    description: s.description,
    type: s.type,
    value: s.type === "free_shipping" ? 0 : s.value,
    minOrderTotal: s.minOrderTotal ?? 0,
    maxUses: s.maxUses,
    perCustomerLimit: s.perCustomerLimit,
    productIds: s.productIds,
    categoryIds: s.categoryIds,
    customerGroupIds: s.customerGroupIds,
    schedule: s.schedule,
    isActive: s.isActive,
  });

  const save = async () => {
    if (isNew) {
      await form.submit(createCouponAction, {
        payload,
        // Routes stay mounted (hidden) after navigation: leave the "new" form blank for next time.
        resetTo: () => initial,
        onSuccess: (data) => {
          if (data) router.replace(`${LIST_PATH}/${data.id}`);
        },
      });
    } else {
      await form.submit(saveCouponAction, {
        payload,
        resetTo: (sent, data) => ({ ...sent, code: sent.code.trim().replace(/\s+/g, "").toUpperCase(), updatedAt: data?.updatedAt ?? sent.updatedAt }),
      });
    }
  };

  const remove = () =>
    runner.run(deleteCouponAction, { id: state.id, updatedAt: form.saved.updatedAt }, {
      onSuccess: () => {
        setDialog(null);
        form.reset(form.state);
        router.push(LIST_PATH);
      },
    });

  const deactivate = () =>
    runner.run(setCouponActiveAction, { id: state.id, isActive: false, updatedAt: form.saved.updatedAt }, {
      onSuccess: (data) => {
        setDialog(null);
        const next = { ...form.saved, isActive: false, updatedAt: data?.updatedAt ?? form.saved.updatedAt };
        form.reset(next);
      },
    });

  const saved = form.saved;
  const status = savedStatus ? COUPON_STATUS[savedStatus] : null;
  const typeHint = TYPES.find((t) => t.value === state.type)?.hint;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={LIST_PATH}
          className="inline-flex items-center gap-1.5 rounded text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Kuponlar
        </Link>
      </div>
      <PageHeader
        eyebrow="Pazarlama"
        title={isNew ? "Yeni kupon" : <span className="font-mono tracking-wide">{saved.code}</span>}
        description={
          isNew
            ? "Müşterinin sepette yazacağı indirim kodu. Kodlar büyük-küçük harf ayırt edilmeden eşleşir."
            : usage
              ? `${formatNumber(usage.usedCount)} kez kullanıldı${saved.maxUses != null ? ` (limit ${formatNumber(saved.maxUses)})` : ""}.`
              : undefined
        }
        actions={
          isNew ? null : (
            <>
              {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
              <Button
                variant="danger-outline"
                icon={used > 0 ? Ban : Trash2}
                disabled={form.dirty || (used > 0 && !saved.isActive)}
                title={form.dirty ? "Önce değişiklikleri kaydedin veya vazgeçin." : undefined}
                onClick={() => setDialog(used > 0 ? "deactivate" : "delete")}
              >
                {used > 0 ? "Pasifleştir" : "Sil"}
              </Button>
            </>
          )
        }
      />

      <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate className="mx-auto max-w-3xl space-y-6 pb-28">
        <Card title="Kod ve indirim">
          <div className="space-y-5">
            <Field
              label="Kupon kodu"
              required
              error={errorFor("code")}
              name="code"
              help="3–32 karakter: İngilizce büyük harf, rakam, tire veya alt çizgi. Boşluklar kaldırılır."
              labelAside={
                <button
                  type="button"
                  onClick={() => setField("code", randomCode())}
                  className="inline-flex items-center gap-1 rounded text-xs font-medium text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Dices aria-hidden className="size-3.5" />
                  Rastgele kod üret
                </button>
              }
            >
              <TextInput
                value={state.code}
                onChange={(v) => setField("code", v.replace(/\s+/g, "").toUpperCase())}
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                placeholder="Örn. BAHAR15"
                className="font-mono tracking-wider"
              />
            </Field>
            <Field label="Açıklama" optional error={errorFor("description")} name="description" help="Yalnızca panelde görünür: kupon kime, hangi kanal için verildi?">
              <Textarea value={state.description} onChange={(v) => setField("description", v)} maxLength={300} rows={2} />
            </Field>

            <fieldset className="min-w-0">
              <legend className="text-sm font-medium text-text">İndirim türü</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {TYPES.map((t) => {
                  const checked = state.type === t.value;
                  return (
                    <label
                      key={t.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                        checked ? "border-brand bg-brand/5 font-medium text-text" : "border-border bg-surface text-text-muted hover:border-text/30 hover:text-text",
                      )}
                    >
                      <input
                        type="radio"
                        name="coupon-type"
                        value={t.value}
                        checked={checked}
                        onChange={() => {
                          setField("type", t.value);
                          setField("value", t.value === "percent" ? 10 : null);
                        }}
                        className="size-4 accent-[var(--brand)]"
                      />
                      {t.label}
                    </label>
                  );
                })}
              </div>
              {typeHint ? <p className="mt-2 text-xs text-text-muted">{typeHint}</p> : null}
            </fieldset>

            <FieldGroup columns={2}>
              {state.type === "percent" ? (
                <Field label="İndirim oranı" required error={errorFor("value")} name="value">
                  <PercentInput value={state.value} onChange={(v) => setField("value", v)} min={1} max={100} />
                </Field>
              ) : state.type === "fixed" ? (
                <Field label="İndirim tutarı" required error={errorFor("value")} name="value" help="KDV dahil.">
                  <MoneyInput value={state.value} onChange={(v) => setField("value", v)} min={1} />
                </Field>
              ) : null}
              <Field
                label="En düşük sepet tutarı"
                optional
                error={errorFor("minOrderTotal")}
                name="minOrderTotal"
                help="Ürün ara toplamı (kargo hariç) bu tutarın altındaysa kupon geçmez. Boş = sınır yok."
              >
                <MoneyInput value={state.minOrderTotal} onChange={(v) => setField("minOrderTotal", v)} />
              </Field>
            </FieldGroup>
          </div>
        </Card>

        <Card title="Kullanım limitleri">
          <FieldGroup columns={2}>
            <Field label="Toplam kullanım" optional error={errorFor("maxUses")} name="maxUses" help={usage ? `Şu ana kadar ${formatNumber(usage.usedCount)} kez kullanıldı. Boş = sınırsız.` : "Boş = sınırsız."}>
              <NumberInput value={state.maxUses} onChange={(v) => setField("maxUses", v)} min={1} suffix="kez" />
            </Field>
            <Field label="Müşteri başına" optional error={errorFor("perCustomerLimit")} name="perCustomerLimit" help="Aynı e-posta adresiyle en fazla kaç siparişte kullanılabilir. Boş = sınırsız.">
              <NumberInput value={state.perCustomerLimit} onChange={(v) => setField("perCustomerLimit", v)} min={1} suffix="kez" />
            </Field>
          </FieldGroup>
        </Card>

        <Card title="Kapsam" description="Ürün veya kategori seçmezseniz sepetteki tüm ürünlere uygulanır (numuneler hariç).">
          <div className="space-y-5">
            <Field label="Ürünler" optional error={errorFor("productIds")} name="productIds" help="İndirim yalnızca bu ürünlerin tutarından düşer.">
              <ProductPicker multiple value={state.productIds} onChange={(ids) => setField("productIds", ids)} max={500} placeholder="Ürün ekleyin" dialogTitle="Kupona ürün ekle" />
            </Field>
            <Field
              label="Kategoriler"
              optional
              error={errorFor("categoryIds")}
              name="categoryIds"
              help="Doğrudan bu kategorilere bağlı ürünler. Ürün ve kategori birlikte seçilirse ikisinden birine uyan ürünler indirimli olur."
            >
              <CategoryPicker multiple value={state.categoryIds} onChange={(ids) => setField("categoryIds", ids)} />
            </Field>
            <GroupChecklist
              legend="Müşteri grupları"
              help="Boş bırakırsanız herkes kullanabilir. Grup seçerseniz yalnızca bu gruplardaki üyeler kullanabilir."
              groups={groups}
              value={state.customerGroupIds}
              onChange={(ids) => setField("customerGroupIds", ids)}
              error={errorFor("customerGroupIds")}
              name="customerGroupIds"
            />
          </div>
        </Card>

        <Card title="Zamanlama ve durum">
          <div className="space-y-5">
            <ScheduleInput
              label="Geçerlilik"
              value={state.schedule}
              onChange={(v) => setField("schedule", v)}
              error={form.errorsUnder("schedule")}
              name="schedule"
              startLabel="Başlangıç"
              endLabel="Bitiş"
              help="Türkiye saatiyle. Başlangıç boşsa hemen, bitiş boşsa süresiz geçerlidir."
            />
            <Field label="Durum" error={errorFor("isActive")} name="isActive">
              <Switch
                checked={state.isActive}
                onChange={(v) => setField("isActive", v)}
                label={state.isActive ? "Etkin" : "Pasif"}
                description={state.isActive ? "Koşullar sağlanınca sepette kullanılabilir." : "Kod sepette kabul edilmez; ayarları saklanır."}
              />
            </Field>
          </div>
        </Card>

        <SaveBar
          dirty={form.dirty}
          pending={form.pending}
          errorCount={Object.keys(form.errors).length}
          onSave={save}
          onReset={isNew ? undefined : () => form.reset()}
          allowCleanSave={isNew}
          saveLabel={isNew ? "Kuponu oluştur" : "Kaydet"}
          pendingLabel={isNew ? "Oluşturuluyor…" : "Kaydediliyor…"}
          savedNote={isNew ? "Henüz kaydedilmedi" : undefined}
        />
      </form>

      {isNew ? null : (
        <>
          <ConfirmDialog
            open={dialog === "delete"}
            onClose={() => setDialog(null)}
            onConfirm={remove}
            pending={runner.pending}
            title="Kupon silinsin mi?"
            description={`“${saved.code}” hiç kullanılmadı ve kalıcı olarak silinecek. Kodu bilen müşteriler artık kullanamaz.`}
            confirmLabel="Kuponu sil"
          />
          <ConfirmDialog
            open={dialog === "deactivate"}
            onClose={() => setDialog(null)}
            onConfirm={deactivate}
            pending={runner.pending}
            tone="default"
            title="Kupon pasifleştirilsin mi?"
            description={`“${saved.code}” ${formatNumber(used)} siparişte kullanıldığı için silinemez (siparişler kupon bağlantısını korur). Pasifleştirirseniz kod artık sepette kabul edilmez; istediğinizde yeniden etkinleştirebilirsiniz.`}
            confirmLabel="Pasifleştir"
          />
        </>
      )}
    </div>
  );
}
