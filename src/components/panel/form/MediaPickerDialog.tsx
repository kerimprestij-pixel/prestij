"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CloudUpload, Images, RefreshCw, Search, TriangleAlert, Upload } from "lucide-react";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import Tabs from "@/components/panel/ui/Tabs";
import { toast } from "@/components/panel/ui/toast-store";
import { controlGroupClass, groupInputClass } from "@/components/panel/ui/styles";
import { formatBytes, formatMediaDuration, mediaLabel } from "@/components/panel/media/media-format";
import MediaThumb from "@/components/panel/media/MediaThumb";
import { UploadDropzone, VideoSpeechTip } from "@/components/panel/media/MediaUploadDialog";
import { useUploadQueue } from "@/components/panel/media/useUploadQueue";
import { isVideoMedia } from "@/lib/media/types";
import { listMediaAction } from "@/lib/panel/media/actions";
import { MEDIA_UPLOAD, type MediaKindFilter, type PanelMedia } from "@/lib/panel/media/types";
import { cn } from "@/lib/utils";
import { primeMedia } from "./media-cache";
import Select from "./Select";

// Kept here for existing imports (the form barrel re-exports them).
export { formatBytes, mediaLabel };

export type MediaPickerDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Chosen items in selection order (single mode: one item). */
  onSelect: (items: PanelMedia[]) => void;
  multiple?: boolean;
  /** Most items that may be chosen in this round (multiple mode). */
  max?: number;
  /** Highlighted as the current choice (single mode). */
  currentId?: number | null;
  /** Already in the list: shown as "Eklendi" and not selectable (multiple mode). */
  excludeIds?: readonly number[];
  /** Default folder for uploads (and the library filter's suggestion). */
  folder?: string;
  title?: string;
  /**
   * Day 6: what the library offers and the upload tab accepts. "image" (default: every image field),
   * "video" (video fields) or "all" (the product gallery).
   */
  kind?: MediaKindFilter;
};

/** Day 6: Turkish copy per kind filter. */
const KIND_COPY: Record<
  MediaKindFilter,
  { pick: string; add: string; pickOne: string; pickMany: string; noun: string; accusative: string; many: string; search: string; loading: string; emptyTitle: string; empty: string; upload: string }
> = {
  image: {
    pick: "Görsel seç",
    add: "Görsel ekle",
    pickOne: "Bir görsel seçin.",
    pickMany: "Eklemek istediğiniz görselleri seçin.",
    noun: "görsel",
    accusative: "görseli",
    many: "Görseller",
    search: "Görsellerde ara",
    loading: "Görseller yükleniyor…",
    emptyTitle: "Henüz görsel yok",
    empty: "İlk görselinizi yükleyerek başlayın.",
    upload: "Görsel yükle",
  },
  video: {
    pick: "Video seç",
    add: "Video ekle",
    pickOne: "Bir video seçin.",
    pickMany: "Eklemek istediğiniz videoları seçin.",
    noun: "video",
    accusative: "videoyu",
    many: "Videolar",
    search: "Videolarda ara",
    loading: "Videolar yükleniyor…",
    emptyTitle: "Henüz video yok",
    empty: "Kütüphanede henüz video yok. MP4 (H.264) veya WebM bir video yükleyerek başlayın.",
    upload: "Video yükle",
  },
  all: {
    pick: "Görsel veya video seç",
    add: "Görsel veya video ekle",
    pickOne: "Bir görsel veya video seçin.",
    pickMany: "Eklemek istediğiniz görselleri ve videoları seçin.",
    noun: "dosya",
    accusative: "dosyayı",
    many: "Görseller ve videolar",
    search: "Görsellerde ve videolarda ara",
    loading: "Kütüphane yükleniyor…",
    emptyTitle: "Kütüphane boş",
    empty: "İlk görselinizi veya videonuzu yükleyerek başlayın.",
    upload: "Yükle",
  },
};

/** A row fits the dialog's kind filter (uploads added locally are filtered the same way as the server list). */
const fitsKind = (media: PanelMedia, kind: MediaKindFilter) => kind === "all" || (kind === "video") === isVideoMedia(media);

/** Library dialog: grid with search, folder filter and paging, plus an upload tab with progress. */
export default function MediaPickerDialog({
  open,
  onClose,
  onSelect,
  multiple = false,
  max,
  currentId = null,
  excludeIds,
  folder,
  title,
  kind = "image",
}: MediaPickerDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title ?? (multiple ? KIND_COPY[kind].add : KIND_COPY[kind].pick)}
      size="xl"
      bodyClassName="p-0 sm:p-0"
    >
      {open ? (
        <MediaLibrary
          onClose={onClose}
          onSelect={onSelect}
          multiple={multiple}
          max={max}
          currentId={currentId}
          excludeIds={excludeIds}
          folder={folder}
          kind={kind}
        />
      ) : null}
    </Dialog>
  );
}

type LibraryProps = Omit<MediaPickerDialogProps, "open" | "title" | "kind"> & { kind: MediaKindFilter };

function MediaLibrary({ onClose, onSelect, multiple = false, max, currentId, excludeIds, folder, kind }: LibraryProps) {
  const copy = KIND_COPY[kind];
  // D16: where videos are chosen or uploaded, the tip about speech and subtitles, once above the tabs (the
  // library opens first, so the tip must not live only in the upload tab).
  const videoTipId = useId();
  const videoTip = kind !== "image";
  const [tab, setTab] = useState<"library" | "upload">("library");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("");
  const [items, setItems] = useState<PanelMedia[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "more">("loading");
  const [selected, setSelected] = useState<number[]>(() => (!multiple && currentId ? [currentId] : []));
  const [extra, setExtra] = useState<PanelMedia[]>([]);
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const ticket = ++request.current;
    listMediaAction({ q: debounced || undefined, folder: folderFilter || undefined, cursor: null, kind })
      .then((result) => {
        if (ticket !== request.current) return;
        setItems(result.items);
        setFolders(result.folders);
        setNextCursor(result.nextCursor);
        setStatus("ready");
      })
      .catch(() => ticket === request.current && setStatus("error"));
  }, [debounced, folderFilter, reload, kind]);

  const loadMore = () => {
    if (nextCursor === null) return;
    const ticket = ++request.current;
    setStatus("more");
    listMediaAction({ q: debounced || undefined, folder: folderFilter || undefined, cursor: nextCursor, kind })
      .then((result) => {
        if (ticket !== request.current) return;
        setItems((prev) => [...prev, ...result.items.filter((m) => !prev.some((p) => p.id === m.id))]);
        setNextCursor(result.nextCursor);
        setStatus("ready");
      })
      .catch(() => {
        if (ticket !== request.current) return;
        setStatus("ready");
        toast.error(`Daha fazla ${copy.noun} yüklenemedi.`);
      });
  };

  const visible = useMemo(() => {
    const ids = new Set(items.map((m) => m.id));
    return [...extra.filter((m) => !ids.has(m.id) && fitsKind(m, kind)), ...items];
  }, [items, extra, kind]);
  const byId = useMemo(() => new Map(visible.map((m) => [m.id, m])), [visible]);
  const limit = multiple ? (max ?? Infinity) : 1;

  const toggle = (media: PanelMedia) => {
    if (excluded.has(media.id)) return;
    setSelected((prev) => {
      if (!multiple) return prev[0] === media.id ? prev : [media.id];
      if (prev.includes(media.id)) return prev.filter((id) => id !== media.id);
      if (prev.length >= limit) {
        toast.info(`En fazla ${limit} ${copy.noun} seçebilirsiniz.`);
        return prev;
      }
      return [...prev, media.id];
    });
  };

  const confirm = (ids = selected) => {
    const chosen = ids.map((id) => byId.get(id)).filter((m): m is PanelMedia => Boolean(m));
    if (!multiple && ids[0] === currentId && chosen.length === 0) {
      onClose();
      return;
    }
    if (chosen.length === 0) return;
    primeMedia(chosen);
    onSelect(chosen);
  };

  // Each finished upload shows up (and the chosen kind is selected) right away; cover images made for a
  // video show up in libraries that offer images but are never selected. Back to the library when done.
  const onUploaded = useCallback(
    (uploaded: PanelMedia[], extras: PanelMedia[]) => {
      const fitting = uploaded.filter((m) => fitsKind(m, kind));
      primeMedia([...uploaded, ...extras]);
      setExtra((prev) => [...fitting, ...extras.filter((m) => fitsKind(m, kind)), ...prev]);
      setFolders((prev) => [...new Set([...prev, ...uploaded.map((m) => m.folder)])].sort((a, b) => a.localeCompare(b, "tr")));
      setSelected((prev) => {
        if (!multiple) return fitting[0] ? [fitting[0].id] : prev;
        const room = Math.max(0, limit - prev.length);
        return [...prev, ...fitting.filter((m) => !excluded.has(m.id) && !prev.includes(m.id)).slice(0, room).map((m) => m.id)];
      });
    },
    [kind, multiple, limit, excluded],
  );
  const uploads = useUploadQueue(onUploaded, { accept: kind });
  const [wasBusy, setWasBusy] = useState(false);
  if (uploads.busy !== wasBusy) {
    // Adjusting state during render (React's pattern for "state from a changed prop"): the queue just
    // finished, so show the library with the new files selected.
    setWasBusy(uploads.busy);
    if (!uploads.busy && uploads.queue.some((q) => q.status === "done")) setTab("library");
  }

  const onGridKey = (event: React.KeyboardEvent) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-media]") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || buttons.length === 0) return;
    const top = buttons[0].offsetTop;
    const columns = Math.max(1, buttons.filter((b) => b.offsetTop === top).length);
    const delta: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index + delta[event.key];
    if (next < 0 || next >= buttons.length) return;
    event.preventDefault();
    buttons[next].focus();
  };

  const selectedItems = selected.map((id) => byId.get(id)).filter(Boolean) as PanelMedia[];
  const summary =
    selected.length === 0
      ? multiple
        ? copy.pickMany
        : copy.pickOne
      : multiple
        ? `${selected.length} ${copy.noun} seçildi${limit !== Infinity ? ` (en fazla ${limit})` : ""}`
        : selectedItems[0]
          ? mediaLabel(selectedItems[0])
          : `Mevcut ${copy.noun}`;

  const library = (
    <div className="flex min-h-[22rem] flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-surface px-5 py-3 sm:flex-row sm:items-center sm:px-6">
        <div className={cn(controlGroupClass, "sm:max-w-sm")}>
          <span aria-hidden className="flex items-center ps-3 text-text-muted">
            <Search className="size-4" />
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ad veya alternatif metinde ara…"
            aria-label={copy.search}
            className={cn(groupInputClass, "h-10 ps-2")}
          />
        </div>
        <Select
          value={folderFilter}
          onChange={setFolderFilter}
          aria-label="Klasör"
          className="sm:w-56"
          options={[{ value: "", label: "Tüm klasörler" }, ...folders.map((f) => ({ value: f, label: f }))]}
        />
      </div>

      <div className="flex-1 px-5 py-4 sm:px-6">
        {status === "loading" ? (
          <div role="status" className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            <span className="sr-only">{copy.loading}</span>
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} aria-hidden className="aspect-square animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none" />
            ))}
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <TriangleAlert aria-hidden className="size-6 text-[#B5730C]" />
            <p className="text-sm text-text-muted">Kütüphane yüklenemedi.</p>
            <Button size="sm" icon={RefreshCw} onClick={() => setReload((n) => n + 1)}>
              Tekrar dene
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full border border-border bg-surface-2 text-gold-text">
              <Images aria-hidden className="size-5" strokeWidth={1.5} />
            </span>
            <p className="font-heading text-lg text-text">{debounced || folderFilter ? "Sonuç bulunamadı" : copy.emptyTitle}</p>
            <p className="max-w-sm text-sm text-text-muted">
              {debounced || folderFilter ? `Aramayı veya klasör filtresini değiştirin ya da yeni ${copy.noun} yükleyin.` : copy.empty}
            </p>
            <Button size="sm" icon={Upload} onClick={() => setTab("upload")}>
              {copy.upload}
            </Button>
          </div>
        ) : (
          <>
            <div
              ref={gridRef}
              role="group"
              aria-label={copy.many}
              onKeyDown={onGridKey}
              className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6"
            >
              {visible.map((media) => {
                const order = selected.indexOf(media.id);
                const isSelected = order >= 0;
                const isExcluded = excluded.has(media.id);
                const label = mediaLabel(media);
                const video = isVideoMedia(media);
                const duration = video ? formatMediaDuration(media.durationMs) : "";
                return (
                  <button
                    key={media.id}
                    type="button"
                    data-media
                    aria-pressed={isSelected}
                    aria-disabled={isExcluded || undefined}
                    aria-label={`${label}${video ? `, video${duration ? ` ${duration}` : ""}` : ""}${media.width && media.height ? `, ${media.width}×${media.height}` : ""}${isExcluded ? ", zaten eklendi" : ""}`}
                    title={label}
                    onClick={() => toggle(media)}
                    onDoubleClick={() => {
                      if (multiple || isExcluded) return;
                      setSelected([media.id]);
                      confirm([media.id]);
                    }}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-lg border bg-surface-2 text-start transition-[box-shadow,border-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                      isSelected ? "border-gold ring-2 ring-gold" : "border-border hover:border-gold/50",
                      isExcluded && "cursor-not-allowed opacity-45",
                    )}
                  >
                    <MediaThumb media={media} sizes="(min-width: 1024px) 160px, 30vw" fill className="transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-5 text-[0.6875rem] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      {label}
                    </span>
                    {isSelected ? (
                      <span aria-hidden className="absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-gold text-xs font-semibold text-gold-contrast shadow">
                        {multiple ? order + 1 : <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                    ) : null}
                    {isExcluded ? (
                      <span aria-hidden className="absolute start-1.5 top-1.5 rounded-full bg-surface/90 px-1.5 py-px text-[0.625rem] font-medium text-text">
                        Eklendi
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {nextCursor !== null ? (
              <div className="mt-5 flex justify-center">
                <Button size="sm" onClick={loadMore} pending={status === "more"} pendingLabel="Yükleniyor…">
                  Daha fazla göster
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col">
      {videoTip ? <VideoSpeechTip id={videoTipId} className="px-5 pt-3 sm:px-6" /> : null}
      <div className="px-5 pt-2 sm:px-6">
        <Tabs
          ariaLabel="Dosya kaynağı"
          value={tab}
          onValueChange={(v) => setTab(v as "library" | "upload")}
          items={[
            { value: "library", label: "Kütüphane", icon: Images },
            { value: "upload", label: "Yükle", icon: CloudUpload, badge: uploads.busy ? "…" : undefined },
          ]}
        />
      </div>
      <div hidden={tab !== "library"}>{library}</div>
      <div hidden={tab !== "upload"}>
        <UploadDropzone
          folders={folders}
          defaultFolder={folder ?? MEDIA_UPLOAD.defaultFolder}
          queue={uploads.queue}
          busy={uploads.busy}
          onStart={uploads.start}
          onCancel={uploads.cancel}
          accept={kind}
          videoTipId={videoTip ? videoTipId : undefined}
          className="px-5 py-5 sm:px-6"
        />
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3.5 sm:px-6">
        <p aria-live="polite" className="min-w-0 truncate text-sm text-text-muted">
          {summary}
        </p>
        <div className="ms-auto flex items-center gap-2">
          <Button onClick={onClose}>Vazgeç</Button>
          <Button variant="primary" onClick={() => confirm()} disabled={selected.length === 0 || uploads.busy}>
            {multiple && selected.length > 1 ? `${selected.length} ${copy.accusative} ekle` : "Seç"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Drag-and-drop / browse upload on the shared queue (direct flow, one file per request) for pages that
 * want an upload area without the library. `kind` limits what may be uploaded (default images).
 */
export function UploadPanel({
  folders,
  defaultFolder,
  onUploaded,
  kind = "image",
}: {
  folders: string[];
  defaultFolder: string;
  onUploaded: (items: PanelMedia[]) => void;
  kind?: MediaKindFilter;
}) {
  const uploads = useUploadQueue(onUploaded, { accept: kind });
  return (
    <UploadDropzone
      folders={folders}
      defaultFolder={defaultFolder}
      queue={uploads.queue}
      busy={uploads.busy}
      onStart={uploads.start}
      onCancel={uploads.cancel}
      accept={kind}
      className="px-5 py-5 sm:px-6"
    />
  );
}
