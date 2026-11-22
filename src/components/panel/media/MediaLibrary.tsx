"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckSquare, CloudUpload, Film, FolderInput, Image as ImageIcon, Images, LayoutGrid, RefreshCw, Search, SearchX, TriangleAlert, Upload, X } from "lucide-react";
import { Field, Select, TextInput } from "@/components/panel/form";
import { primeMedia } from "@/components/panel/form/media-cache";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import Tabs from "@/components/panel/ui/Tabs";
import { toast } from "@/components/panel/ui/toast-store";
import { controlGroupClass, groupInputClass, iconButtonClass } from "@/components/panel/ui/styles";
import { isVideoMedia } from "@/lib/media/types";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { getMediaItemsAction, getMediaUsageCountsAction, listMediaAction, moveMediaAction } from "@/lib/panel/media/actions";
import { MEDIA_UPLOAD, type MediaKindFilter, type MediaListResult, type PanelMedia } from "@/lib/panel/media/types";
import { cn } from "@/lib/utils";
import MediaDetailDrawer from "./MediaDetailDrawer";
import { formatBytes, formatMediaDuration, mediaLabel } from "./media-format";
import MediaThumb from "./MediaThumb";
import MediaUploadDialog, { folderProblem, UploadQueueList } from "./MediaUploadDialog";
import { useUploadQueue } from "./useUploadQueue";

type Status = "ready" | "loading" | "more" | "error";

const inFolder = (itemFolder: string, filter: string) => !filter || itemFolder === filter || itemFolder.startsWith(`${filter}/`);
/** Day 6: a row belongs to the tab being viewed. */
const inKind = (media: PanelMedia, kind: MediaKindFilter) => kind === "all" || (kind === "video") === isVideoMedia(media);

/** Day 6: the library tabs and their Turkish copy. */
const KIND_TABS: { value: MediaKindFilter; label: string; icon: typeof Images }[] = [
  { value: "all", label: "Tümü", icon: LayoutGrid },
  { value: "image", label: "Fotoğraflar", icon: ImageIcon },
  { value: "video", label: "Videolar", icon: Film },
];
const KIND_NOUN: Record<MediaKindFilter, string> = { all: "dosya", image: "görsel", video: "video" };
const sortFolders = (list: Iterable<string>) => [...new Set(list)].sort((a, b) => a.localeCompare(b, "tr"));

/**
 * The media library: Tümü / Fotoğraflar / Videolar tabs, search, folder filter, paging, drag-and-drop
 * multi-upload anywhere on the page (images and videos, one file per request straight to the storage),
 * multi-select to move folders, and a detail drawer (alt texts, video cover, usage, guarded delete).
 * `focusId` opens that file's drawer on arrival (links from "where used", e.g. a video's cover image).
 */
export default function MediaLibrary({
  initial,
  initialCounts,
  focusId = null,
}: {
  initial: MediaListResult;
  initialCounts: Record<number, number>;
  focusId?: number | null;
}) {
  const [items, setItems] = useState(initial.items);
  const [folders, setFolders] = useState(initial.folders);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [counts, setCounts] = useState<Record<number, number>>(initialCounts);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [kind, setKind] = useState<MediaKindFilter>("all");
  const [status, setStatus] = useState<Status>("ready");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  // Deep link (?medya=<id>): a file on the first page opens at once; another one is fetched below.
  const [detailId, setDetailId] = useState<number | null>(() => (focusId && initial.items.some((m) => m.id === focusId) ? focusId : null));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ticket = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const filters = useRef<{ q: string; folder: string; kind: MediaKindFilter }>({ q: "", folder: "", kind: "all" });
  const modalOpen = useRef(false);

  const refreshCounts = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    getMediaUsageCountsAction(ids)
      .then((next) => setCounts((prev) => ({ ...prev, ...next })))
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    (q: string, folderFilter: string, kindFilter: MediaKindFilter) => {
      filters.current = { q, folder: folderFilter, kind: kindFilter };
      const t = ++ticket.current;
      setStatus("loading");
      listMediaAction({ q: q || undefined, folder: folderFilter || undefined, cursor: null, kind: kindFilter })
        .then((result) => {
          if (t !== ticket.current) return;
          setItems(result.items);
          setFolders(result.folders);
          setNextCursor(result.nextCursor);
          setStatus("ready");
          refreshCounts(result.items.map((m) => m.id));
        })
        .catch(() => t === ticket.current && setStatus("error"));
    },
    [refreshCounts],
  );

  const loadMore = () => {
    if (nextCursor === null || status !== "ready") return;
    const t = ++ticket.current;
    setStatus("more");
    listMediaAction({ q: filters.current.q || undefined, folder: filters.current.folder || undefined, cursor: nextCursor, kind: filters.current.kind })
      .then((result) => {
        if (t !== ticket.current) return;
        setItems((prev) => [...prev, ...result.items.filter((m) => !prev.some((p) => p.id === m.id))]);
        setNextCursor(result.nextCursor);
        setStatus("ready");
        refreshCounts(result.items.map((m) => m.id));
      })
      .catch(() => {
        if (t !== ticket.current) return;
        setStatus("ready");
        toast.error("Daha fazla dosya yüklenemedi.");
      });
  };

  const onUploaded = useCallback((uploaded: PanelMedia[], extras: PanelMedia[]) => {
    const all = [...uploaded, ...extras];
    primeMedia(all);
    const shown = all.filter((m) => inFolder(m.folder, filters.current.folder) && inKind(m, filters.current.kind));
    setItems((prev) => [...shown, ...prev.filter((p) => !all.some((u) => u.id === p.id))]);
    setFolders((prev) => sortFolders([...prev, ...all.map((m) => m.folder)]));
    // A new cover image is used by its video from the start.
    setCounts((prev) => ({ ...prev, ...Object.fromEntries(uploaded.map((m) => [m.id, 0])), ...Object.fromEntries(extras.map((m) => [m.id, 1])) }));
  }, []);

  const uploads = useUploadQueue(onUploaded);
  const uploadFolder = folder || MEDIA_UPLOAD.defaultFolder;
  const startRef = useRef(uploads.start);
  useEffect(() => {
    startRef.current = uploads.start;
    modalOpen.current = uploadOpen || moveOpen || detailId !== null;
  });

  // Drop files anywhere on the page (outside dialogs): upload into the folder being viewed.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || modalOpen.current) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e) || modalOpen.current) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e) || modalOpen.current || e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      setUploadOpen(true);
      startRef.current(files, filters.current.folder || MEDIA_UPLOAD.defaultFolder);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Deep link (?medya=<id>) changing while the page stays mounted (a "where used" link inside the drawer):
  // open the target at once when it is loaded (state adjusted during render, React's pattern for props).
  const [focusSeen, setFocusSeen] = useState(focusId);
  if (focusId !== focusSeen) {
    setFocusSeen(focusId);
    if (focusId && items.some((m) => m.id === focusId)) setDetailId(focusId);
  }
  // A target that is not loaded (not on the first page, or another tab): fetch it, then open it.
  const loadedIds = useRef<Set<number>>(new Set());
  useEffect(() => {
    loadedIds.current = new Set(items.map((m) => m.id));
  }, [items]);
  useEffect(() => {
    if (!focusId || loadedIds.current.has(focusId)) return;
    let alive = true;
    getMediaItemsAction([focusId])
      .then(([found]) => {
        if (!alive) return;
        if (!found) {
          toast.error("Dosya bulunamadı; silinmiş olabilir.");
          return;
        }
        setItems((prev) => (prev.some((m) => m.id === found.id) ? prev : [found, ...prev]));
        setDetailId(found.id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [focusId]);

  const onSearch = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(value.trim(), filters.current.folder, filters.current.kind), 250);
  };
  const onFolder = (value: string) => {
    setFolder(value);
    setSelected([]);
    load(filters.current.q, value, filters.current.kind);
  };
  const onKind = (value: string) => {
    const next = KIND_TABS.find((t) => t.value === value)?.value ?? "all";
    setKind(next);
    setSelected([]);
    load(filters.current.q, filters.current.folder, next);
  };
  const clearFilters = () => {
    setQuery("");
    setFolder("");
    load("", "", filters.current.kind);
  };

  const toggleSelected = (id: number) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const exitSelect = () => {
    setSelectMode(false);
    setSelected([]);
  };

  const onMoved = (ids: number[], target: string) => {
    const moved = new Set(ids);
    setItems((prev) =>
      prev.flatMap((m) => (moved.has(m.id) ? (inFolder(target, filters.current.folder) ? [{ ...m, folder: target }] : []) : [m])),
    );
    setFolders((prev) => sortFolders([...prev, target]));
    if (detailId !== null && moved.has(detailId) && !inFolder(target, filters.current.folder)) setDetailId(null);
    // A move bumps updatedAt on the server: take the fresh rows, or the next alt-text save is a false conflict.
    getMediaItemsAction(ids)
      .then((fresh) => {
        const byId = new Map(fresh.map((m) => [m.id, m]));
        setItems((prev) => prev.map((m) => byId.get(m.id) ?? m));
      })
      .catch(() => undefined);
  };

  const detail = useMemo(() => items.find((m) => m.id === detailId) ?? null, [items, detailId]);
  const filtered = Boolean(query.trim() || folder);
  const noun = KIND_NOUN[kind];

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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className={cn(controlGroupClass, "sm:max-w-sm")}>
            <span aria-hidden className="flex items-center ps-3 text-text-muted">
              <Search className="size-4" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Dosya adı, alternatif metin veya klasör…"
              aria-label="Medyada ara"
              className={cn(groupInputClass, "h-10 ps-2 [&::-webkit-search-cancel-button]:hidden")}
            />
            {query ? (
              <button type="button" onClick={() => onSearch("")} className={iconButtonClass("sm", "my-auto me-1 size-7")}>
                <X aria-hidden className="size-3.5" />
                <span className="sr-only">Aramayı temizle</span>
              </button>
            ) : null}
          </div>
          <Select
            value={folder}
            onChange={onFolder}
            aria-label="Klasör"
            className="sm:w-60"
            options={[{ value: "", label: "Tüm klasörler" }, ...folders.map((f) => ({ value: f, label: f }))]}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selectMode ? (
            <Button icon={X} onClick={exitSelect}>
              Seçimi bitir
            </Button>
          ) : (
            <Button icon={CheckSquare} onClick={() => setSelectMode(true)} disabled={items.length === 0}>
              Seç
            </Button>
          )}
          <Button variant="primary" icon={Upload} onClick={() => setUploadOpen(true)}>
            Yükle
          </Button>
        </div>
      </div>

      <Tabs
        variant="pills"
        ariaLabel="Dosya türü"
        value={kind}
        onValueChange={onKind}
        items={KIND_TABS.map((t) => ({ value: t.value, label: t.label, icon: t.icon }))}
      />

      {uploads.queue.length > 0 && !uploadOpen ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-text">{uploads.busy ? "Dosyalar yükleniyor…" : "Son yükleme"}</p>
            {!uploads.busy ? (
              <Button size="sm" variant="ghost" icon={X} onClick={uploads.clear}>
                Gizle
              </Button>
            ) : null}
          </div>
          <UploadQueueList queue={uploads.queue} onCancel={uploads.cancel} className="max-h-60 overflow-y-auto" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-text-muted">
        <p aria-live="polite">
          {status === "loading"
            ? "Yükleniyor…"
            : `${items.length.toLocaleString("tr-TR")}${nextCursor !== null ? "+" : ""} ${noun}${folder ? ` · ${folder}` : ""}`}
        </p>
        <p className="hidden text-xs sm:block">
          İpucu: görselleri ve videoları bu sayfanın herhangi bir yerine sürükleyip bırakarak da yükleyebilirsiniz ({uploadFolder} klasörüne).
        </p>
      </div>

      {status === "loading" ? (
        <div role="status" className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          <span className="sr-only">Kütüphane yükleniyor…</span>
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} aria-hidden className="space-y-2">
              <span className="block aspect-square animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none" />
              <span className="block h-3 w-3/4 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
            </span>
          ))}
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-4 py-14 text-center">
          <TriangleAlert aria-hidden className="size-6 text-[#B5730C]" />
          <p className="text-sm text-text-muted">Kütüphane yüklenemedi.</p>
          <Button size="sm" icon={RefreshCw} onClick={() => load(filters.current.q, filters.current.folder, filters.current.kind)}>
            Tekrar dene
          </Button>
        </div>
      ) : items.length === 0 ? (
        filtered ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full border border-border bg-surface-2 text-gold-text">
              <SearchX aria-hidden className="size-5" strokeWidth={1.5} />
            </span>
            <p className="font-heading text-lg text-text">Sonuç bulunamadı</p>
            <p className="max-w-sm text-sm text-text-muted">Aramayı veya klasör filtresini değiştirin{kind !== "all" ? " ya da “Tümü” sekmesine bakın" : ""}.</p>
            <Button size="sm" onClick={clearFilters}>
              Filtreleri temizle
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface px-6 py-16 text-center transition-colors hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="grid size-14 place-items-center rounded-full border border-border bg-surface-2 text-gold-text">
              <Images aria-hidden className="size-6" strokeWidth={1.5} />
            </span>
            <span className="font-heading text-xl text-text">{kind === "video" ? "Henüz video yok" : kind === "image" ? "Henüz görsel yok" : "Kütüphane boş"}</span>
            <span className="max-w-sm text-sm text-text-muted">
              {kind === "video"
                ? `MP4 (H.264) veya WebM videolarınızı yüklemek için tıklayın ya da buraya sürükleyin (en fazla ${MEDIA_UPLOAD.video.maxBytes / 1024 / 1024} MB, ${MEDIA_UPLOAD.video.maxDurationMs / 1000} saniye).`
                : "İlk dosyalarınızı yüklemek için tıklayın ya da buraya sürükleyin."}
            </span>
          </button>
        )
      ) : (
        <>
          <ul ref={gridRef} onKeyDown={onGridKey} aria-label={KIND_TABS.find((t) => t.value === kind)?.label ?? "Medya"} className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {items.map((media) => {
              const label = mediaLabel(media);
              const used = counts[media.id] ?? 0;
              const hasAlt = Boolean(media.alt?.tr?.trim());
              const isSelected = selected.includes(media.id);
              const dims = media.width && media.height ? `${media.width}×${media.height}` : null;
              const video = isVideoMedia(media);
              const duration = video ? formatMediaDuration(media.durationMs) : "";
              return (
                <li key={media.id} className="min-w-0">
                  <button
                    type="button"
                    data-media
                    onClick={() => (selectMode ? toggleSelected(media.id) : setDetailId(media.id))}
                    aria-pressed={selectMode ? isSelected : undefined}
                    aria-label={[selectMode ? `Seç: ${label}` : label, video ? `video${duration ? ` ${duration}` : ""}` : null, dims, used > 0 ? `${used} yerde kullanılıyor` : null, hasAlt ? null : "alternatif metin yok"]
                      .filter(Boolean)
                      .join(", ")}
                    className={cn(
                      "group relative block aspect-square w-full overflow-hidden rounded-lg border bg-surface-2 transition-[box-shadow,border-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none",
                      isSelected ? "border-gold ring-2 ring-gold" : "border-border hover:border-gold/60",
                    )}
                  >
                    <MediaThumb media={media} sizes="(min-width: 1280px) 13vw, (min-width: 768px) 22vw, (min-width: 640px) 30vw, 46vw" fill className="transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
                    {selectMode ? (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute start-2 top-2 grid size-6 place-items-center rounded-md border shadow-sm",
                          isSelected ? "border-gold bg-gold text-gold-contrast" : "border-white/80 bg-black/25 text-transparent",
                        )}
                      >
                        <Check className="size-4" strokeWidth={3} />
                      </span>
                    ) : null}
                    {used > 0 ? (
                      <span aria-hidden className="absolute end-2 top-2 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[0.625rem] font-medium text-text shadow-sm backdrop-blur-sm">
                        <span className="size-1.5 rounded-full bg-gold" />
                        {used} yerde
                      </span>
                    ) : null}
                  </button>
                  <p className="mt-2 truncate text-xs font-medium text-text" title={label}>
                    {label}
                  </p>
                  <p className="flex items-center gap-1.5 truncate text-[0.6875rem] text-text-muted">
                    <span className="truncate">{[dims, duration || null, formatBytes(media.bytes)].filter(Boolean).join(" · ") || media.folder}</span>
                    {!hasAlt ? (
                      <span
                        className="inline-flex shrink-0 items-center gap-0.5 text-[#9A5F00] dark:text-[#E9A944]"
                        title={video ? "Ekran okuyucular ve arama motorları için videoyu kısaca anlatın." : "Görme engelli ziyaretçiler ve arama motorları için görsel açıklaması ekleyin."}
                      >
                        <TriangleAlert aria-hidden className="size-3" />
                        Açıklama yok
                      </span>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
          {nextCursor !== null ? (
            <div className="flex justify-center pt-2">
              <Button onClick={loadMore} pending={status === "more"} pendingLabel="Yükleniyor…">
                Daha fazla göster
              </Button>
            </div>
          ) : null}
        </>
      )}

      {selectMode ? (
        <div className="sticky bottom-4 z-20 mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-[0_12px_32px_-12px_rgb(3_38_95/0.35)] backdrop-blur">
          <p className="text-sm text-text" aria-live="polite">
            {selected.length > 0 ? `${selected.length} dosya seçildi` : "Taşımak istediğiniz dosyaları seçin"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(selected.length === items.length ? [] : items.map((m) => m.id))}>
              {selected.length === items.length ? "Seçimi kaldır" : "Tümünü seç"}
            </Button>
            <Button size="sm" variant="primary" icon={FolderInput} disabled={selected.length === 0} onClick={() => setMoveOpen(true)}>
              Klasöre taşı
            </Button>
          </div>
        </div>
      ) : null}

      {dragging ? (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-[#03265F]/35 p-6 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-gold bg-surface px-10 py-10 text-center shadow-2xl">
            <CloudUpload className="size-8 text-gold-text" strokeWidth={1.5} />
            <p className="font-heading text-2xl text-text">Bırakın, yükleyelim</p>
            <p className="text-sm text-text-muted">Dosyalar “{uploadFolder}” klasörüne eklenecek.</p>
          </div>
        </div>
      ) : null}

      <MediaUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        folders={folders}
        defaultFolder={uploadFolder}
        queue={uploads.queue}
        busy={uploads.busy}
        onStart={uploads.start}
        onCancel={uploads.cancel}
      />

      <MoveDialog
        open={moveOpen}
        count={selected.length}
        folders={folders}
        onClose={() => setMoveOpen(false)}
        onMove={async (target) => {
          const ids = selected;
          const result = await moveMediaAction(null, toPayloadFormData({ ids, folder: target }));
          if (!result.ok) return result.fieldErrors?.folder ?? result.error;
          toast.success(result.message ?? "Görseller taşındı.");
          onMoved(ids, target);
          setMoveOpen(false);
          exitSelect();
          return null;
        }}
      />

      <MediaDetailDrawer
        media={detail}
        onClose={() => setDetailId(null)}
        folders={folders}
        onUpdated={(item) => setItems((prev) => prev.map((m) => (m.id === item.id ? item : m)))}
        onAdded={(added) => {
          primeMedia(added);
          setItems((prev) => [...added.filter((m) => inFolder(m.folder, filters.current.folder) && inKind(m, filters.current.kind)), ...prev]);
          setCounts((prev) => ({ ...prev, ...Object.fromEntries(added.map((m) => [m.id, 1])) }));
        }}
        onMoved={onMoved}
        onDeleted={(ids) => {
          setItems((prev) => prev.filter((m) => !ids.includes(m.id)));
          setSelected((prev) => prev.filter((x) => !ids.includes(x)));
        }}
        onUsageCount={(id, count) => setCounts((prev) => (prev[id] === count ? prev : { ...prev, [id]: count }))}
      />
    </div>
  );
}

function MoveDialog({
  open,
  count,
  folders,
  onClose,
  onMove,
}: {
  open: boolean;
  count: number;
  folders: string[];
  onClose: () => void;
  onMove: (folder: string) => Promise<string | null>;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Klasöre taşı" description={`${count} dosya seçili. Klasör yalnızca düzen içindir; dosyaların adresi değişmez.`} size="sm">
      {open ? <MoveBody folders={folders} onClose={onClose} onMove={onMove} /> : null}
    </Dialog>
  );
}

function MoveBody({ folders, onClose, onMove }: { folders: string[]; onClose: () => void; onMove: (folder: string) => Promise<string | null> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async () => {
    const problem = folderProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    try {
      setError(await onMove(value.trim().toLowerCase()));
    } catch {
      setError("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      className="space-y-5"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      }}
    >
      <Field label="Hedef klasör" required error={error} help="Var olan bir klasörü seçin veya yeni bir ad yazın (ör. blog, urunler/lavanta).">
        <TextInput
          value={value}
          onChange={(v) => {
            setValue(v);
            setError(null);
          }}
          list="media-move-folders"
          spellCheck={false}
          autoComplete="off"
          data-autofocus
        />
      </Field>
      <datalist id="media-move-folders">
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Vazgeç</Button>
        <Button variant="primary" icon={FolderInput} onClick={submit} pending={pending} pendingLabel="Taşınıyor…">
          Taşı
        </Button>
      </div>
    </div>
  );
}
