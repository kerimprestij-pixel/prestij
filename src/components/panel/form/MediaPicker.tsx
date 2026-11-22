"use client";
import { useState } from "react";
import Link from "next/link";
import { ImageOff, ImagePlus, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import Button from "@/components/panel/ui/Button";
import SortableList, { SortableRow } from "@/components/panel/ui/SortableList";
import { focusRingClass, iconButtonClass } from "@/components/panel/ui/styles";
import { formatMediaDuration } from "@/components/panel/media/media-format";
import MediaThumb from "@/components/panel/media/MediaThumb";
import { isVideoMedia, type MediaLike } from "@/lib/media/types";
import type { MediaKindFilter, PanelMedia } from "@/lib/panel/media/types";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";
import { useMediaLookup } from "./media-cache";
import MediaPickerDialog, { formatBytes, mediaLabel } from "./MediaPickerDialog";

type Common = {
  /** Media objects for the current value, preloaded by the page (no request needed to show them). */
  items?: readonly MediaLike[];
  /** Default upload folder in the dialog, e.g. "urunler". */
  folder?: string;
  /** Preview frame ratio for a single image, e.g. "16/9", "2/3" (default "4/3"). */
  aspect?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  dialogTitle?: string;
  className?: string;
  /**
   * Day 6: what may be chosen. "image" (default: every existing image field), "video" (hero video, the
   * video section) or "all". The server re-checks kinds on save.
   */
  kind?: MediaKindFilter;
};

/** Day 6: field copy per kind ("image" keeps the texts the field always had). */
const FIELD_COPY: Record<MediaKindFilter, { choose: string; hint: string; missing: string; loading: string; Noun: string; list: string; none: string; add: string; first: string }> = {
  image: {
    choose: "Görsel seç",
    hint: "Kütüphaneden seçin veya yeni yükleyin",
    missing: "Görsel bulunamadı; silinmiş olabilir.",
    loading: "Görsel yükleniyor…",
    Noun: "Görsel",
    list: "Seçili görseller",
    none: "Henüz görsel seçilmedi.",
    add: "Görsel ekle",
    first: "Ana görsel",
  },
  video: {
    choose: "Video seç",
    hint: "Kütüphaneden seçin veya yeni yükleyin (MP4 / WebM)",
    missing: "Video bulunamadı; silinmiş olabilir.",
    loading: "Video yükleniyor…",
    Noun: "Video",
    list: "Seçili videolar",
    none: "Henüz video seçilmedi.",
    add: "Video ekle",
    first: "İlk video",
  },
  all: {
    choose: "Görsel veya video seç",
    hint: "Kütüphaneden seçin veya yeni yükleyin",
    missing: "Dosya bulunamadı; silinmiş olabilir.",
    loading: "Yükleniyor…",
    Noun: "Dosya",
    list: "Seçili dosyalar",
    none: "Henüz bir şey seçilmedi.",
    add: "Görsel veya video ekle",
    first: "Ana görsel",
  },
};

export type MediaPickerSingleProps = Common & {
  multiple?: false;
  value: number | null | undefined;
  onChange: (id: number | null, item: MediaLike | null) => void;
};

export type MediaPickerMultipleProps = Common & {
  multiple: true;
  value: readonly number[] | null | undefined;
  onChange: (ids: number[], items: MediaLike[]) => void;
  max?: number;
};

export type MediaPickerProps = MediaPickerSingleProps | MediaPickerMultipleProps;

/**
 * Media field backed by the library: preview, change/remove, alt-text hint (single), or an ordered,
 * reorderable list (multiple). The dialog offers library search, folders and uploads (direct flow,
 * images and/or videos by `kind`); videos show their cover image, a play badge and the duration.
 */
export default function MediaPicker(props: MediaPickerProps) {
  return props.multiple ? <MultiplePicker {...props} /> : <SinglePicker {...props} />;
}

/** "1920×1080 · 0:42" for a media object (duration only for videos). */
function mediaFacts(media: MediaLike & { durationMs?: number | null; bytes?: number | null }): string {
  const dims = media.width && media.height ? `${media.width}×${media.height}` : null;
  const duration = isVideoMedia(media) ? formatMediaDuration(media.durationMs) : "";
  return [dims, duration || null].filter(Boolean).join(" · ");
}

function altInfo(media: MediaLike) {
  return media.alt?.tr?.trim() ? null : (
    <p className="flex items-start gap-1.5 text-xs text-text-muted">
      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-[#B5730C]" />
      <span>
        {isVideoMedia(media) ? "Video açıklaması yok." : "Alternatif metin yok."}{" "}
        <Link href="/panel/medya" className={cn("rounded font-medium text-text underline underline-offset-4", focusRingClass)}>
          Medya kütüphanesinden ekleyin
        </Link>
        .
      </span>
    </p>
  );
}

function SinglePicker({ value, onChange, items, folder, aspect = "4/3", invalid, disabled, id, dialogTitle, className, kind = "image" }: MediaPickerSingleProps) {
  const [open, setOpen] = useState(false);
  const copy = FIELD_COPY[kind];
  const control = useFieldControl({ id, invalid });
  const current = value ?? null;
  const lookup = useMediaLookup(current ? [current] : [], items);
  const media = current ? lookup(current) : null;

  return (
    <div className={cn("min-w-0 max-w-sm space-y-2", className)}>
      {current === null ? (
        <button
          type="button"
          {...control}
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-surface-2/40 px-4 text-center transition-colors hover:border-gold/60 hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
            focusRingClass,
            invalid ? "border-[#C2413A]/60" : "border-border",
          )}
          style={{ aspectRatio: aspect }}
        >
          <span className="grid size-10 place-items-center rounded-full border border-border bg-surface text-gold-text">
            <ImagePlus aria-hidden className="size-4.5" strokeWidth={1.5} />
          </span>
          <span className="text-sm font-medium text-text">{copy.choose}</span>
          <span className="text-xs text-text-muted">{copy.hint}</span>
        </button>
      ) : (
        <>
          <div
            className={cn("relative overflow-hidden rounded-xl border bg-surface-2", invalid ? "border-[#C2413A]/60" : "border-border")}
            style={{ aspectRatio: aspect }}
          >
            {media ? (
              <MediaThumb media={media} sizes="384px" fill />
            ) : media === null ? (
              <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-text-muted">
                <ImageOff aria-hidden className="size-5" />
                {copy.missing}
              </div>
            ) : (
              <span role="status" className="block size-full animate-pulse bg-surface-2 motion-reduce:animate-none">
                <span className="sr-only">{copy.loading}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button {...control} size="sm" icon={RefreshCw} onClick={() => setOpen(true)} disabled={disabled} aria-haspopup="dialog">
              Değiştir
            </Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => onChange(null, null)} disabled={disabled}>
              Kaldır
            </Button>
            {media ? (
              <span className="ms-auto min-w-0 truncate text-xs text-text-muted" title={mediaLabel(media as PanelMedia)}>
                {mediaFacts(media)}
              </span>
            ) : null}
          </div>
          {media ? altInfo(media) : null}
        </>
      )}
      <MediaPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        currentId={current}
        folder={folder}
        title={dialogTitle}
        kind={kind}
        onSelect={([item]) => {
          setOpen(false);
          if (item) onChange(item.id, item);
        }}
      />
    </div>
  );
}

function MultiplePicker({ value, onChange, items, folder, max, invalid, disabled, id, dialogTitle, className, kind = "image" }: MediaPickerMultipleProps) {
  const [open, setOpen] = useState(false);
  const copy = FIELD_COPY[kind];
  const control = useFieldControl({ id, invalid });
  const ids = (value ?? []) as number[];
  const lookup = useMediaLookup(ids, items);
  const atMax = max !== undefined && ids.length >= max;

  const emit = (nextIds: number[]) => {
    onChange(
      nextIds,
      nextIds.map((i) => lookup(i)).filter((m): m is MediaLike => Boolean(m)),
    );
  };

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      {ids.length > 0 ? (
        <SortableList
          items={ids}
          ariaLabel={copy.list}
          disabled={disabled}
          getKey={(item) => item}
          getItemLabel={(item) => {
            const m = lookup(item);
            return m ? mediaLabel(m) : `${copy.Noun} ${item}`;
          }}
          onReorder={(next) => emit(next)}
          renderItem={(item, ctx) => {
            const m = lookup(item);
            return (
              <SortableRow
                ctx={ctx}
                actions={
                  <button
                    type="button"
                    onClick={() => emit(ids.filter((x) => x !== item))}
                    disabled={disabled}
                    aria-label={`${m ? mediaLabel(m) : `${copy.Noun} ${item}`}: kaldır`}
                    className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                }
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative block size-12 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2">
                    {m ? (
                      <MediaThumb media={m} sizes="48px" fill showDuration={false} />
                    ) : m === null ? (
                      <ImageOff aria-hidden className="m-auto mt-3.5 size-4 text-text-muted" />
                    ) : (
                      <span aria-hidden className="block size-full animate-pulse bg-surface-2 motion-reduce:animate-none" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-text">
                      {m ? mediaLabel(m) : m === null ? `${copy.Noun} bulunamadı` : "Yükleniyor…"}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {m ? [mediaFacts(m) || null, formatBytes((m as Partial<PanelMedia>).bytes)].filter(Boolean).join(" · ") : null}
                      {ctx.index === 0 ? <span className="ms-1.5 rounded-full bg-gold/15 px-1.5 py-px text-[0.625rem] font-medium text-text">{copy.first}</span> : null}
                    </span>
                  </span>
                </div>
              </SortableRow>
            );
          }}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">{copy.none}</div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button {...control} size="sm" icon={Plus} onClick={() => setOpen(true)} disabled={disabled || atMax} aria-haspopup="dialog">
          {copy.add}
        </Button>
        {max !== undefined ? (
          <span className="text-xs tabular-nums text-text-muted">
            {ids.length} / {max}
          </span>
        ) : null}
      </div>
      <MediaPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        multiple
        max={max !== undefined ? Math.max(0, max - ids.length) : undefined}
        excludeIds={ids}
        folder={folder}
        title={dialogTitle}
        kind={kind}
        onSelect={(chosen) => {
          setOpen(false);
          const nextIds = [...ids, ...chosen.map((m) => m.id).filter((i) => !ids.includes(i))];
          onChange(
            nextIds,
            nextIds.map((i) => chosen.find((m) => m.id === i) ?? lookup(i)).filter((m): m is MediaLike => Boolean(m)),
          );
        }}
      />
    </div>
  );
}
