"use client";

// The offer editor of a quote request: one unit price per line (with the current list price and the
// reference group's price as a guide), quantities, extra lines, validity date and a note, a live total,
// then "Teklifi gönder" (confirm) → quote_offer e-mail in the requester's language, status "quoted".
import { Plus, Send, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { sendQuoteOfferAction } from "@/app/panel/(dashboard)/teklifler/actions";
import { Field, MoneyInput, NumberInput, Select, Textarea, TextInput, usePanelForm } from "@/components/panel/form";
import { Button, useConfirm } from "@/components/panel/ui";
import { formatTryAmount } from "@/lib/panel/format";
import type { QuoteOffer } from "@/db/schema/commerce";
import type { OfferVariantOption, QuoteDetailLine } from "@/lib/requests/queries";
import { cn } from "@/lib/utils";
import { LANGUAGE_LABEL } from "./labels";

type Line = {
  key: number;
  variantId: number | null;
  label: string;
  detail: string | null;
  accent: string | null;
  quantity: number | null;
  unitPrice: number | null;
  listPrice: number | null;
  groupPrice: number | null;
};

type State = { lines: Line[]; validUntil: string; note: string };

type Props = {
  id: number;
  updatedAt: string;
  status: string;
  email: string;
  locale: string;
  lines: QuoteDetailLine[];
  offer: QuoteOffer | null;
  quotedAt: string | null;
  variantOptions: OfferVariantOption[];
  priceGroup: { name: string; discountPercent: number; isCompanyGroup: boolean } | null;
  /** Today + 30 days (Istanbul), computed on the server. */
  defaultValidUntil: string;
  /** Today (Istanbul): the date input's minimum. */
  today: string;
  /** Sending is possible in this status (new, in_review, quoted). */
  canSend: boolean;
};

const money = (kurus: number | null | undefined) => (kurus == null ? "—" : formatTryAmount(kurus, { symbol: true }));

function initialState(props: Props): State {
  let key = 0;
  const byVariant = new Map(props.variantOptions.map((o) => [o.variantId, o]));
  if (props.offer) {
    return {
      lines: props.offer.lines.map((l) => {
        const option = l.variantId ? byVariant.get(l.variantId) : undefined;
        const requested = l.variantId ? props.lines.find((r) => r.variantId === l.variantId) : undefined;
        return {
          key: ++key,
          variantId: l.variantId ?? null,
          label: requested?.label ?? l.label,
          detail: requested?.detail ?? null,
          accent: requested?.accent ?? null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          listPrice: option?.listPrice ?? null,
          groupPrice: requested?.groupPrice ?? option?.groupPrice ?? null,
        };
      }),
      validUntil: props.offer.validUntil ?? props.defaultValidUntil,
      note: props.offer.note ?? "",
    };
  }
  return {
    lines: props.lines.map((l) => ({
      key: ++key,
      variantId: l.variantId,
      label: l.label,
      detail: l.detail,
      accent: l.accent,
      quantity: l.quantity,
      unitPrice: l.groupPrice ?? l.listPrice,
      listPrice: l.listPrice,
      groupPrice: l.groupPrice,
    })),
    validUntil: props.defaultValidUntil,
    note: "",
  };
}

export default function QuoteOfferEditor(props: Props) {
  const form = usePanelForm<State>(initialState(props));
  const { state, setField, setState, errorFor, formRef } = form;
  const { confirm, confirmDialog } = useConfirm();
  const [pick, setPick] = useState<number | null>(null);
  const language = LANGUAGE_LABEL[props.locale] ?? props.locale;
  const total = state.lines.reduce((sum, l) => sum + (l.unitPrice ?? 0) * (l.quantity ?? 0), 0);
  const revised = props.status === "quoted";
  const nextKey = () => Math.max(0, ...state.lines.map((l) => l.key)) + 1;

  const addVariant = (variantId: number | null) => {
    const option = props.variantOptions.find((o) => o.variantId === variantId);
    if (!option) return;
    const [name, ...size] = option.label.split(" · ");
    setState((s) => ({
      ...s,
      lines: [
        ...s.lines,
        { key: nextKey(), variantId: option.variantId, label: name, detail: size.join(" · ") || null, accent: null, quantity: 1, unitPrice: option.groupPrice ?? option.listPrice, listPrice: option.listPrice, groupPrice: option.groupPrice },
      ],
    }));
    setPick(null);
  };
  const addCustom = () =>
    setState((s) => ({ ...s, lines: [...s.lines, { key: nextKey(), variantId: null, label: "", detail: null, accent: null, quantity: 1, unitPrice: null, listPrice: null, groupPrice: null }] }));
  const removeLine = (key: number) => setState((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));

  const send = async () => {
    const ok = await confirm({
      title: revised ? "Revize teklif gönderilsin mi?" : "Teklif gönderilsin mi?",
      description: `${state.lines.length} kalem, toplam ${money(total)} (KDV dahil). Teklif ${props.email} adresine ${language} olarak e-postayla gönderilir ve talep “Teklif verildi” olur.${revised ? " Müşteri önceki teklifin yerine bu teklifi alır." : ""}`,
      confirmLabel: revised ? "Revize teklifi gönder" : "Teklifi gönder",
      tone: "default",
    });
    if (!ok) return;
    await form.submit(sendQuoteOfferAction, {
      payload: (s) => ({
        id: props.id,
        updatedAt: props.updatedAt,
        lines: s.lines.map((l) => ({ variantId: l.variantId, label: l.label, quantity: l.quantity, unitPrice: l.unitPrice })),
        validUntil: s.validUntil || null,
        note: s.note,
      }),
    });
  };

  const groupLabel = props.priceGroup
    ? `${props.priceGroup.name}${props.priceGroup.discountPercent ? ` (−%${props.priceGroup.discountPercent})` : ""}`
    : null;

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-6">
      {props.priceGroup ? (
        <p className="text-sm text-text-muted">
          Satırlarda liste fiyatının yanında <strong className="font-medium text-text">{groupLabel}</strong> grubunun fiyatı gösterilir
          {props.priceGroup.isCompanyGroup ? " (talep sahibinin onaylı firmasının grubu)." : " (varsayılan kurumsal grup)."} Fiyatlar KDV dahildir.
        </p>
      ) : (
        <p className="text-sm text-text-muted">Fiyatlar KDV dahildir.</p>
      )}

      <ol className="divide-y divide-border rounded-xl border border-border" aria-label="Teklif kalemleri">
        {state.lines.map((line, index) => {
          const lineTotal = (line.unitPrice ?? 0) * (line.quantity ?? 0);
          return (
            <li key={line.key} className="relative grid grid-cols-2 gap-x-3 gap-y-3 p-4 md:grid-cols-[minmax(0,1fr)_6.5rem_9.5rem_2.25rem] md:items-start md:gap-x-4">
              <div className="col-span-2 min-w-0 pe-10 md:col-span-1 md:pe-0">
                {line.variantId ? (
                  <>
                    <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-text md:mt-7">
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full border border-border" style={line.accent ? { backgroundColor: line.accent, borderColor: line.accent } : undefined} />
                      <span className="truncate">{line.label}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                      {line.detail ? <span className="font-medium text-text">{line.detail}</span> : null}
                      <span>Liste: {money(line.listPrice)}</span>
                      {line.groupPrice != null && groupLabel ? (
                        <span>
                          {groupLabel}: <span className="font-medium text-text">{money(line.groupPrice)}</span>
                        </span>
                      ) : null}
                      {line.groupPrice != null && line.unitPrice !== line.groupPrice ? (
                        <button
                          type="button"
                          onClick={() => setField(`lines.${index}.unitPrice`, line.groupPrice)}
                          className="inline-flex items-center gap-1 rounded text-xs font-medium text-text underline decoration-gold/60 underline-offset-4 hover:decoration-gold focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <Wand2 aria-hidden className="size-3" />
                          Grup fiyatını uygula
                        </button>
                      ) : null}
                    </p>
                  </>
                ) : (
                  <Field label={`Kalem ${index + 1} (serbest)`} error={errorFor(`lines.${index}.label`)} name={`lines.${index}.label`}>
                    <TextInput value={line.label} onChange={(v) => setField(`lines.${index}.label`, v)} maxLength={160} placeholder="Kalemin adı, ör. Dispenser montajı" />
                  </Field>
                )}
              </div>
              <Field label="Adet" error={errorFor(`lines.${index}.quantity`)} name={`lines.${index}.quantity`}>
                <NumberInput value={line.quantity} onChange={(v) => setField(`lines.${index}.quantity`, v)} min={1} max={100000} />
              </Field>
              <Field label="Birim fiyat" error={errorFor(`lines.${index}.unitPrice`)} name={`lines.${index}.unitPrice`}>
                <MoneyInput value={line.unitPrice} onChange={(v) => setField(`lines.${index}.unitPrice`, v)} />
              </Field>
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                className="absolute end-3 top-3 grid size-9 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-[#C2413A] focus-visible:outline-2 focus-visible:outline-ring md:static md:col-start-4 md:row-start-1 md:mt-6"
              >
                <Trash2 aria-hidden className="size-4" />
                <span className="sr-only">{index + 1}. kalemi kaldır</span>
              </button>
              <p className="col-span-2 text-sm text-text-muted md:col-span-4 md:text-end">
                Satır toplamı: <span className="font-medium text-text tabular-nums">{money(lineTotal)}</span>
              </p>
            </li>
          );
        })}
        {state.lines.length === 0 ? <li className="p-4 text-sm text-text-muted">Teklifte kalem yok. Aşağıdan ürün veya serbest kalem ekleyin.</li> : null}
      </ol>
      {errorFor("lines") ? <p className="text-sm text-[#C2413A]">{errorFor("lines")}</p> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Ürün ekle" className="min-w-0 flex-1">
          <Select<number>
            value={pick}
            onChange={(v) => {
              setPick(v);
              addVariant(v);
            }}
            placeholder="Ürün ve boy seçin"
            options={props.variantOptions.map((o) => ({ value: o.variantId, label: `${o.label} · ${money(o.listPrice)}` }))}
          />
        </Field>
        <Button icon={Plus} onClick={addCustom}>
          Serbest kalem ekle
        </Button>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Geçerlilik tarihi" help="Bu tarihe kadar geçerli; e-postada gösterilir." error={errorFor("validUntil")} name="validUntil">
          <input
            type="date"
            value={state.validUntil}
            min={props.today}
            onChange={(e) => setField("validUntil", e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20"
          />
        </Field>
        <div className="flex flex-col justify-end rounded-xl bg-surface-2/60 px-4 py-3 sm:items-end">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">Toplam (KDV dahil)</span>
          <span className="font-heading text-2xl text-text tabular-nums">{money(total)}</span>
        </div>
      </div>

      <Field
        label="Müşteriye not"
        optional
        help={props.locale === "tr" ? "E-postada teklifin altında gösterilir." : `E-postada teklifin altında gösterilir. Talep ${language} sayfadan geldi; notu da ${language} yazın.`}
        error={errorFor("note")}
        name="note"
      >
        <Textarea value={state.note} onChange={(v) => setField("note", v)} maxLength={2000} rows={3} placeholder="Ör. teslimat koşulları, ödeme vadesi…" />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <p className={cn("text-sm text-text-muted", !props.quotedAt && "sr-only")}>
          {props.quotedAt ? `Son teklif ${new Date(props.quotedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" })} tarihinde gönderildi.` : ""}
        </p>
        <Button variant="primary" icon={Send} pending={form.pending} pendingLabel="Gönderiliyor…" onClick={send} disabled={!props.canSend || state.lines.length === 0}>
          {revised ? "Revize teklifi gönder" : "Teklifi gönder"}
        </Button>
      </div>
      {confirmDialog}
    </form>
  );
}
