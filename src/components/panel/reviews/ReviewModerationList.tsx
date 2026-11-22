"use client";
// /panel/yorumlar list: read each review in full, approve (one or many), reject, reply, delete.
// Every action re-renders the page from the server (updateTag) and the storefront follows on the next
// request (tags reviews:<id>, product:<slug>, products).
import { BadgeCheck, Check, ExternalLink, MessageSquareReply, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveReviewsAction, deleteReviewAction, rejectReviewAction, replyReviewAction } from "@/app/panel/(dashboard)/yorumlar/actions";
import Field from "@/components/panel/form/Field";
import Textarea from "@/components/panel/form/Textarea";
import { formatDateTime, formatNumber } from "@/components/panel/labels";
import StatusBadge from "@/components/panel/StatusBadge";
import { Button, Dialog, toast, useConfirm } from "@/components/panel/ui";
import { focusRingClass } from "@/components/panel/ui/styles";
import { href } from "@/i18n/paths";
import { toPayloadFormData } from "@/lib/panel/action-types";
import type { PanelReviewRow } from "@/lib/reviews/panel-queries";
import { REVIEW_LIMITS, REVIEWS_ANCHOR } from "@/lib/reviews/types";
import { cn } from "@/lib/utils";
import { LOCALE_LABEL, REVIEW_STATUS } from "./labels";

type Props = { rows: PanelReviewRow[] };

export default function ReviewModerationList({ rows }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<PanelReviewRow | null>(null);
  const [, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  const selectable = rows.filter((r) => r.status !== "approved").map((r) => r.id);
  const chosen = selectable.filter((id) => selected.has(id));
  const allChosen = chosen.length > 0 && chosen.length === selectable.length;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const conflictToast = (error: string, code: string) =>
    toast.error(error, code === "conflict" || code === "not_found" ? { action: { label: "Sayfayı yenile", onClick: () => router.refresh() } } : undefined);

  const approve = (ids: number[], key: string) => {
    if (ids.length === 0) return;
    setBusy(key);
    startTransition(async () => {
      // Each decision names the version on screen: a review its author edited meanwhile is refused (conflict).
      const reviews = ids.flatMap((id) => {
        const row = rows.find((r) => r.id === id);
        return row ? [{ id, updatedAt: row.updatedAt }] : [];
      });
      const result = await approveReviewsAction(null, toPayloadFormData({ reviews }));
      setBusy(null);
      if (result.ok) {
        toast.success(result.message ?? "Onaylandı.");
        setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      } else conflictToast(result.error, result.code);
    });
  };

  const reject = async (row: PanelReviewRow) => {
    if (row.status === "approved") {
      const ok = await confirm({
        title: "Yayındaki yorum reddedilsin mi?",
        description: "Yorum ürün sayfasından kalkar ve ürünün puan ortalaması yeniden hesaplanır. Daha sonra yeniden onaylayabilirsiniz.",
        confirmLabel: "Reddet",
        tone: "default",
      });
      if (!ok) return;
    }
    setBusy(`reject-${row.id}`);
    startTransition(async () => {
      const result = await rejectReviewAction(null, toPayloadFormData({ id: row.id, updatedAt: row.updatedAt }));
      setBusy(null);
      if (result.ok) toast.success(result.message ?? "Reddedildi.");
      else conflictToast(result.error, result.code);
    });
  };

  const remove = async (row: PanelReviewRow) => {
    const ok = await confirm({
      title: "Yorum silinsin mi?",
      description: `“${row.authorName}” imzalı, ${row.productName} için yazılmış yorum kalıcı olarak silinir${row.status === "approved" ? " ve ürün sayfasından kalkar" : ""}. Bu işlem geri alınamaz; yorumu yalnızca yayından kaldırmak istiyorsanız “Reddet”i kullanın.`,
      confirmLabel: "Yorumu sil",
    });
    if (!ok) return;
    setBusy(`delete-${row.id}`);
    startTransition(async () => {
      const result = await deleteReviewAction(null, toPayloadFormData({ id: row.id }));
      setBusy(null);
      if (result.ok) {
        toast.success(result.message ?? "Yorum silindi.");
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      } else conflictToast(result.error, result.code);
    });
  };

  return (
    <section aria-label="Yorumlar" className="space-y-3">
      {selectable.length > 0 ? (
        <div className="flex min-h-11 flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={allChosen}
              ref={(el) => {
                if (el) el.indeterminate = chosen.length > 0 && !allChosen;
              }}
              onChange={() => setSelected(allChosen ? new Set() : new Set(selectable))}
              className={cn("size-4 accent-[var(--brand)]", focusRingClass)}
            />
            {chosen.length ? `${formatNumber(chosen.length)} yorum seçildi` : "Bu sayfadaki onaylanmamış yorumları seç"}
          </label>
          {chosen.length > 0 ? (
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Seçimi temizle
              </Button>
              <Button size="sm" variant="primary" icon={Check} pending={busy === "bulk"} pendingLabel="Onaylanıyor…" onClick={() => approve(chosen, "bulk")}>
                Seçilenleri onayla ({formatNumber(chosen.length)})
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <ReviewCard
              row={row}
              checked={selected.has(row.id)}
              onToggle={row.status !== "approved" ? () => toggle(row.id) : null}
              busy={busy}
              onApprove={() => approve([row.id], `approve-${row.id}`)}
              onReject={() => void reject(row)}
              onDelete={() => void remove(row)}
              onReply={() => setReplyFor(row)}
            />
          </li>
        ))}
      </ul>

      {replyFor ? <ReplyDialog key={replyFor.id} row={replyFor} onClose={() => setReplyFor(null)} /> : null}
      {confirmDialog}
    </section>
  );
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`5 üzerinden ${rating}`}>
      <span aria-hidden className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} className={cn("size-4", n <= rating ? "fill-gold text-gold" : "text-border-strong")} strokeWidth={1.5} />
        ))}
      </span>
      <span className="sr-only">5 üzerinden {rating} puan</span>
    </span>
  );
}

function ReviewCard({
  row,
  checked,
  onToggle,
  busy,
  onApprove,
  onReject,
  onDelete,
  onReply,
}: {
  row: PanelReviewRow;
  checked: boolean;
  onToggle: (() => void) | null;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onReply: () => void;
}) {
  const status = REVIEW_STATUS[row.status];
  const anyBusy = busy !== null;
  const productHref = `${href("tr", "product", { slug: row.productSlug })}#${REVIEWS_ANCHOR}`;
  return (
    <article
      aria-labelledby={`review-${row.id}-title`}
      className={cn(
        "rounded-xl border bg-surface px-4 py-4 transition-colors sm:px-5",
        checked ? "border-gold/60 bg-gold/[0.04]" : row.status === "pending" ? "border-[#D68A12]/35" : "border-border",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {onToggle ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`${row.authorName} yorumunu seç`}
            className={cn("size-4 shrink-0 accent-[var(--brand)]", focusRingClass)}
          />
        ) : null}
        <RatingStars rating={row.rating} />
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {row.verified ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#2F8F5B] dark:text-[#6BC394]">
            <BadgeCheck aria-hidden className="size-3.5" />
            Doğrulanmış alım
          </span>
        ) : null}
        <time dateTime={row.createdAt} className="ms-auto text-xs tabular-nums text-text-muted">
          {formatDateTime(row.createdAt)}
        </time>
      </header>

      <div className="mt-3 min-w-0">
        <h3 id={`review-${row.id}-title`} className="text-[0.9375rem] font-semibold text-text" dir="auto">
          {row.title || <span className="font-normal italic text-text-muted">Başlıksız</span>}
        </h3>
        {row.body ? (
          <p className="mt-1.5 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-text" dir="auto">
            {row.body}
          </p>
        ) : (
          <p className="mt-1.5 text-sm italic text-text-muted">Yalnızca puan verildi.</p>
        )}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        <span>
          <span className="font-medium text-text" dir="auto">
            {row.authorName}
          </span>
          {row.accountEmail ? (
            <>
              {" · "}
              <span dir="ltr">{row.accountEmail}</span>
            </>
          ) : (
            " · e-posta bağlantısıyla"
          )}
        </span>
        {row.locale !== "tr" ? (
          <span className="rounded border border-border px-1.5 text-[0.6875rem] font-medium uppercase leading-5" title={`${LOCALE_LABEL[row.locale] ?? row.locale} sayfadan`}>
            {row.locale}
          </span>
        ) : null}
        {row.orderId && row.orderNumber ? (
          <Link href={`/panel/siparisler/${row.orderId}`} className={cn("rounded underline-offset-4 hover:text-text hover:underline", focusRingClass)}>
            Sipariş {row.orderNumber}
          </Link>
        ) : null}
        <a
          href={productHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("inline-flex items-center gap-1 rounded underline-offset-4 hover:text-text hover:underline", focusRingClass)}
        >
          {row.productAccent ? <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: row.productAccent }} /> : null}
          {row.productName}
          <ExternalLink aria-hidden className="size-3" />
          <span className="sr-only">(ürün sayfası yeni sekmede açılır)</span>
        </a>
      </p>

      {row.reply ? (
        <div className="mt-3 rounded-lg border-s-2 border-gold bg-surface-2/60 px-3 py-2">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-gold-text">Yanıtınız{row.status !== "approved" ? " (yorum yayınlanınca görünür)" : ""}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-text">{row.reply}</p>
        </div>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {row.status !== "approved" ? (
          <Button size="sm" variant="primary" icon={Check} pending={busy === `approve-${row.id}`} pendingLabel="Onaylanıyor…" disabled={anyBusy} onClick={onApprove}>
            Onayla
          </Button>
        ) : null}
        {row.status !== "rejected" ? (
          <Button size="sm" variant="secondary" icon={X} pending={busy === `reject-${row.id}`} pendingLabel="Reddediliyor…" disabled={anyBusy} onClick={onReject}>
            Reddet
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" icon={MessageSquareReply} disabled={anyBusy} onClick={onReply}>
          {row.reply ? "Yanıtı düzenle" : "Yanıtla"}
        </Button>
        <Button
          size="sm"
          variant="danger-outline"
          icon={Trash2}
          pending={busy === `delete-${row.id}`}
          pendingLabel="Siliniyor…"
          disabled={anyBusy}
          onClick={onDelete}
          className="ms-auto"
        >
          Sil
        </Button>
      </footer>
    </article>
  );
}

function ReplyDialog({ row, onClose }: { row: PanelReviewRow; onClose: () => void }) {
  const router = useRouter();
  const [reply, setReply] = useState(row.reply ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (value: string) => {
    setError(null);
    startTransition(async () => {
      const result = await replyReviewAction(null, toPayloadFormData({ id: row.id, reply: value, updatedAt: row.updatedAt }));
      if (result.ok) {
        toast.success(result.message ?? "Kaydedildi.");
        onClose();
        return;
      }
      if (result.fieldErrors?.reply) setError(result.fieldErrors.reply);
      else if (result.code === "conflict") {
        toast.error(result.error, { action: { label: "Sayfayı yenile", onClick: () => router.refresh() }, duration: 0 });
      } else toast.error(result.error);
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={row.reply ? "Yanıtı düzenle" : "Yoruma yanıt ver"}
      description="Yanıtınız ürün sayfasında yorumun hemen altında, mağaza adıyla herkese görünür."
      size="lg"
      footer={
        <>
          {row.reply ? (
            <Button variant="danger-outline" disabled={pending} onClick={() => save("")} className="me-auto">
              Yanıtı kaldır
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button variant="primary" pending={pending} pendingLabel="Kaydediliyor…" disabled={!reply.trim() && !row.reply} onClick={() => save(reply)}>
            Yanıtı kaydet
          </Button>
        </>
      }
    >
      <blockquote className="rounded-lg border border-border bg-surface-2/50 px-4 py-3 text-sm">
        <RatingStars rating={row.rating} />
        {row.title ? (
          <p className="mt-2 font-semibold text-text" dir="auto">
            {row.title}
          </p>
        ) : null}
        {row.body ? (
          <p className="mt-1 line-clamp-6 whitespace-pre-line text-text-muted" dir="auto">
            {row.body}
          </p>
        ) : null}
        <footer className="mt-2 text-xs text-text-muted">— {row.authorName}</footer>
      </blockquote>
      <div className="mt-5">
        <Field label="Yanıtınız" name="reply" error={error} help="Kısa, nazik ve kişisel tutun. Müşterinin adını veya sipariş bilgilerini yazmayın.">
          <Textarea value={reply} onChange={setReply} rows={5} maxLength={REVIEW_LIMITS.reply} placeholder="Değerli yorumunuz için teşekkür ederiz…" />
        </Field>
      </div>
    </Dialog>
  );
}
