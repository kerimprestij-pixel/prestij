"use client";
// Volume tiers (product or variant, optionally per customer group) and explicit group prices.
// Same semantics as the cart engine (src/lib/pricing/resolve.ts): group price beats the group's
// blanket discount, then the best reached tier applies on top.
import { Plus, X } from "lucide-react";
import Field from "@/components/panel/form/Field";
import { MoneyInput, NumberInput, PercentInput } from "@/components/panel/form/NumberInput";
import Select from "@/components/panel/form/Select";
import Button from "@/components/panel/ui/Button";
import { iconButtonClass } from "@/components/panel/ui/styles";
import { formatTryAmount } from "@/lib/panel/format";
import { newKey, variantTitle, type GroupPriceState, type TierState } from "@/lib/panel/products/types";
import { cn } from "@/lib/utils";
import { Section, Warning, type TabProps } from "./shared";

export default function PricingTab({ form, ctx }: TabProps) {
  const { state, setField, errorsUnder } = form;
  const variantLabel = (key: string | null) => {
    const v = state.variants.find((x) => x.key === key);
    return v ? variantTitle(v, state.options) || v.sku : "—";
  };
  const variantOptions = state.variants.map((v) => ({ value: v.key, label: [variantTitle(v, state.options) || v.sku, v.isActive ? null : "(pasif)"].filter(Boolean).join(" ") }));
  const groupOptions = ctx.customerGroups.map((g) => ({ value: g.id, label: g.name }));

  const tiers = state.tiers;
  const setTiers = (next: TierState[]) => setField("tiers", next);
  const updateTier = (i: number, patch: Partial<TierState>) => setTiers(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const prices = state.groupPrices;
  const setPrices = (next: GroupPriceState[]) => setField("groupPrices", next);
  const updatePrice = (i: number, patch: Partial<GroupPriceState>) => setPrices(prices.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  return (
    <div className="space-y-6">
      <Section
        title="Adet indirimleri"
        description="Belirli bir adetten fazla alana yüzde indirim. En yüksek ulaşılan indirim uygulanır; kampanya indirimi bunun üstüne eklenir."
        actions={
          <Button size="sm" icon={Plus} onClick={() => setTiers([...tiers, { key: newKey(), variantKey: null, groupId: null, minQuantity: null, discountPercent: null }])} disabled={tiers.length >= 50}>
            İndirim ekle
          </Button>
        }
      >
        {tiers.length === 0 ? <p className="text-sm text-text-muted">Adet indirimi yok. Örnek: 10 adet ve üzeri %5, 50 adet ve üzeri %10.</p> : null}
        {tiers.map((t, i) => {
          const errs = errorsUnder(`tiers.${i}`);
          return (
            <div key={t.key} className={cn("grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_8rem_auto]", Object.keys(errs).length ? "border-[#B3261E]/50" : "border-border")}>
              <Field label="Kapsam" error={errs.variantKey} name={`tiers.${i}.variantKey`}>
                <Select<string> size="sm" value={t.variantKey ?? ""} onChange={(v) => updateTier(i, { variantKey: v || null })} options={[{ value: "", label: "Tüm varyantlar" }, ...variantOptions]} />
              </Field>
              <Field label="Müşteri grubu" error={errs.groupId} name={`tiers.${i}.groupId`}>
                <Select<number> size="sm" value={t.groupId ?? 0} onChange={(v) => updateTier(i, { groupId: v || null })} options={[{ value: 0, label: "Herkes" }, ...groupOptions]} />
              </Field>
              <Field label="En az adet" error={errs.minQuantity} name={`tiers.${i}.minQuantity`}>
                <NumberInput size="sm" value={t.minQuantity} onChange={(minQuantity) => updateTier(i, { minQuantity })} min={2} max={100_000} suffix="adet" />
              </Field>
              <Field label="İndirim" error={errs.discountPercent} name={`tiers.${i}.discountPercent`}>
                <PercentInput size="sm" value={t.discountPercent} onChange={(discountPercent) => updateTier(i, { discountPercent })} min={1} max={90} />
              </Field>
              <div className="flex items-end justify-end sm:col-span-2 lg:col-span-1 lg:pt-6">
                <button type="button" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label={`İndirim satırı ${i + 1}: kaldır`} className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}>
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              {t.minQuantity && t.discountPercent ? (
                <p className="text-xs text-text-muted sm:col-span-2 lg:col-span-5">
                  {t.variantKey ? variantLabel(t.variantKey) : "Tüm varyantlarda"} {t.minQuantity} adet ve üzeri alımda %{t.discountPercent} indirim
                  {t.groupId ? ` (${ctx.customerGroups.find((g) => g.id === t.groupId)?.name ?? "grup"} müşterileri)` : ""}.
                </p>
              ) : null}
            </div>
          );
        })}
      </Section>

      <Section
        title="Grup fiyatları"
        description="Belirli bir müşteri grubu için varyantın sabit fiyatı. Tanımlı değilse grubun genel indirimi uygulanır."
        actions={
          <Button
            size="sm"
            icon={Plus}
            disabled={state.variants.length === 0 || groupOptions.length === 0}
            onClick={() => setPrices([...prices, { key: newKey(), variantKey: state.variants.find((v) => v.isDefault)?.key ?? state.variants[0].key, groupId: groupOptions.find((g) => !prices.some((p) => p.groupId === g.value))?.value ?? null, price: null }])}
          >
            Grup fiyatı ekle
          </Button>
        }
      >
        {ctx.customerGroups.length ? (
          <p className="text-xs text-text-muted">
            Grupların genel indirimleri: {ctx.customerGroups.map((g) => `${g.name} %${g.discountPercent}`).join(" · ")}
          </p>
        ) : null}
        {prices.length === 0 ? <p className="text-sm text-text-muted">Grup fiyatı yok; her grup kendi genel indirimiyle alır.</p> : null}
        {prices.map((g, i) => {
          const errs = errorsUnder(`groupPrices.${i}`);
          const variant = state.variants.find((v) => v.key === g.variantKey);
          const group = ctx.customerGroups.find((x) => x.id === g.groupId);
          const reference = variant?.price && group ? Math.round((variant.price * (100 - group.discountPercent)) / 100) : null;
          return (
            <div key={g.key} className={cn("grid items-start gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_10rem_auto]", Object.keys(errs).length ? "border-[#B3261E]/50" : "border-border")}>
              <Field label="Varyant" error={errs.variantKey} name={`groupPrices.${i}.variantKey`}>
                <Select<string> size="sm" value={g.variantKey} onChange={(variantKey) => updatePrice(i, { variantKey })} options={variantOptions} />
              </Field>
              <Field label="Müşteri grubu" error={errs.groupId} name={`groupPrices.${i}.groupId`}>
                <Select<number> size="sm" value={g.groupId} onChange={(groupId) => updatePrice(i, { groupId })} options={groupOptions} placeholder="Grup seçin" />
              </Field>
              <Field label="Fiyat (KDV dahil)" error={errs.price} name={`groupPrices.${i}.price`}>
                <MoneyInput size="sm" value={g.price} onChange={(price) => updatePrice(i, { price })} />
              </Field>
              <div className="flex items-end justify-end sm:col-span-2 lg:col-span-1 lg:pt-6">
                <button type="button" onClick={() => setPrices(prices.filter((_, j) => j !== i))} aria-label={`Grup fiyatı ${i + 1}: kaldır`} className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}>
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              {variant?.price ? (
                <p className="text-xs text-text-muted sm:col-span-2 lg:col-span-4">
                  Perakende {formatTryAmount(variant.price, { symbol: true })}
                  {reference !== null && group ? ` · ${group.name} genel indirimiyle ${formatTryAmount(reference, { symbol: true })}` : ""}
                </p>
              ) : null}
              {g.price !== null && variant?.price && g.price >= variant.price ? (
                <Warning className="sm:col-span-2 lg:col-span-4">Grup fiyatı perakende fiyattan düşük değil.</Warning>
              ) : null}
            </div>
          );
        })}
      </Section>
    </div>
  );
}
