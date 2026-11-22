import { Scale } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The texts are drafts until a lawyer approves them: shown on the list and in the editor. Also says how the
 * site recognises an approved text (the version label must not start with "taslak"), because the checkout
 * stays closed while a sales contract carries a "taslak…" label (src/lib/orders/legal-ready.ts).
 * `checkout`: the editor of a sales contract (default: the list, which shows every text).
 */
export default function LegalDraftBanner({ className, checkout }: { className?: string; checkout?: boolean }) {
  return (
    <div
      role="note"
      className={cn("flex items-start gap-3 rounded-xl border border-[#D68A12]/40 bg-[#D68A12]/10 px-4 py-3.5 text-sm text-text", className)}
    >
      <Scale aria-hidden className="mt-0.5 size-4 shrink-0 text-[#B5730C] dark:text-[#E9B45C]" strokeWidth={1.75} />
      <p className="min-w-0 leading-relaxed">
        <strong className="font-semibold">Bu metinler taslaktır.</strong> Bir hukukçu inceleyip onaylayana kadar taslak kabul edilmelidir. Onaylanan
        metni yeni bir sürüm olarak yayınlayın: metindeki taslak uyarısını kapatın ve “taslak” ile başlamayan bir sürüm adı kullanın (ör.
        “2026-11 v1”).{" "}
        {checkout === false ? null : (
          <>
            Ön Bilgilendirme Formu ile Mesafeli Satış Sözleşmesinin sürüm adı “taslak” ile başladığı sürece site bu metinleri taslak sayar ve
            ödeme sayfası sipariş almaz.
          </>
        )}
      </p>
    </div>
  );
}
