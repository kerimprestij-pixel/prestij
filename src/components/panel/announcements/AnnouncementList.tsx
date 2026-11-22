"use client";
// Announcements in display order: drag (or ↑/↓) to reorder, then save the order. Each row opens its editor.
import Link from "next/link";
import { BellRing, Link2, Plus } from "lucide-react";
import { SaveBar, usePanelForm } from "@/components/panel/form";
import EmptyState from "@/components/panel/EmptyState";
import Badge from "@/components/panel/ui/Badge";
import SortableList, { SortableRow } from "@/components/panel/ui/SortableList";
import { buttonClass } from "@/components/panel/ui/styles";
import { reorderAnnouncementsAction } from "@/app/panel/(dashboard)/duyurular/actions";
import {
  ANNOUNCEMENT_STATUS,
  ANNOUNCEMENT_VARIANT_CLASS,
  ANNOUNCEMENT_VARIANT_OPTIONS,
  announcementStatus,
} from "@/lib/panel/content/announcements";
import type { PanelAnnouncement } from "@/lib/panel/content/types";
import { formatIstanbul } from "@/lib/panel/format";
import { cn } from "@/lib/utils";

type ListState = { items: PanelAnnouncement[] };

function windowLabel(a: PanelAnnouncement): string | null {
  if (a.startsAt && a.endsAt) return `${formatIstanbul(a.startsAt)} – ${formatIstanbul(a.endsAt)}`;
  if (a.startsAt) return `${formatIstanbul(a.startsAt)} itibarıyla`;
  if (a.endsAt) return `${formatIstanbul(a.endsAt)} tarihine kadar`;
  return null;
}

export default function AnnouncementList({ initial }: { initial: PanelAnnouncement[] }) {
  const form = usePanelForm<ListState>({ items: initial });
  const { formRef } = form;
  const items = form.state.items;

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          icon={BellRing}
          title="Henüz duyuru yok"
          description="Ücretsiz kargo, yeni koku veya kampanya gibi kısa bir mesajı sitenin en üstünde gösterin."
          action={
            <Link href="/panel/duyurular/yeni" className={buttonClass("primary")}>
              <Plus aria-hidden className="size-4" />
              İlk duyuruyu oluştur
            </Link>
          }
        />
      </div>
    );
  }

  const live = items.filter((a) => announcementStatus(a) === "live").length;

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="space-y-3 pb-28">
      <p className="text-sm text-text-muted">
        {live === 0
          ? "Şu an sitede görünen duyuru yok."
          : live === 1
            ? "Şu an sitede 1 duyuru görünüyor."
            : `Şu an sitede ${live} duyuru sırayla dönüyor (her biri 6 saniye).`}{" "}
        Sıralamayı değiştirmek için tutamaktan sürükleyin veya okları kullanın.
      </p>
      <SortableList
        items={items}
        ariaLabel="Duyurular"
        getKey={(a) => a.id}
        getItemLabel={(a) => a.text.tr}
        onReorder={(next) => form.setField("items", next)}
        renderItem={(a, ctx) => {
          const status = announcementStatus(a);
          const variant = ANNOUNCEMENT_VARIANT_OPTIONS.find((o) => o.value === a.variant);
          const when = windowLabel(a);
          return (
            <SortableRow ctx={ctx} className="items-start py-3">
              <Link
                href={`/panel/duyurular/${a.id}`}
                className="group block min-w-0 rounded-lg px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="flex items-start gap-3">
                  <span
                    aria-hidden
                    title={variant?.label}
                    className={cn("mt-0.5 h-5 w-8 shrink-0 rounded-md border border-border", ANNOUNCEMENT_VARIANT_CLASS[a.variant])}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text group-hover:underline group-hover:underline-offset-4">
                      {a.text.tr}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                      <Badge tone={ANNOUNCEMENT_STATUS[status].tone} size="sm">
                        {ANNOUNCEMENT_STATUS[status].label}
                      </Badge>
                      {variant ? <span>{variant.label}</span> : null}
                      {when ? <span>{when}</span> : null}
                      {a.href ? (
                        <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                          <Link2 aria-hidden className="size-3 shrink-0" />
                          <span className="truncate">{a.href}</span>
                        </span>
                      ) : null}
                      {!a.text.en || !a.text.ar ? <span>Çeviri eksik</span> : null}
                    </span>
                  </span>
                </span>
              </Link>
            </SortableRow>
          );
        }}
      />
      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        onReset={() => form.reset()}
        onSave={() => form.submit(reorderAnnouncementsAction, { payload: (s) => ({ ids: s.items.map((a) => a.id) }) })}
        saveLabel="Sıralamayı kaydet"
        savedNote="Sıralama kayıtlı."
      />
    </form>
  );
}
