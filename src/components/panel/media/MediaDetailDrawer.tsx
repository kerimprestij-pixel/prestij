"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Camera, Check, Copy, FolderInput, FolderOpen, ImagePlus, Link2, LoaderCircle, ShieldAlert, Trash2, X } from "lucide-react";
import { Field, LocalizedInput, MediaPickerDialog, TextInput, usePanelForm } from "@/components/panel/form";
import Button from "@/components/panel/ui/Button";
import ConfirmDialog, { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import Dialog from "@/components/panel/ui/Dialog";
import { toast } from "@/components/panel/ui/toast-store";
import { errorClass } from "@/components/panel/ui/styles";
import type { LocalizedText } from "@/db/schema/common";
import Img from "@/lib/media/Img";
import { isVideoMedia, variantUrl, type MediaLike } from "@/lib/media/types";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { formatIstanbul } from "@/lib/panel/format";
import { deleteMediaAction, getMediaUsageAction, moveMediaAction, updateMediaAltAction, updateMediaPosterAction } from "@/lib/panel/media/actions";
import type { MediaUsage, PanelMedia } from "@/lib/panel/media/types";
import { FOLDER_PATTERN } from "@/lib/panel/schemas";
import { cn } from "@/lib/utils";
import { formatBytes, formatLabel, formatMediaDuration, mediaLabel } from "./media-format";
import MediaThumb from "./MediaThumb";
import { posterFileName, uploadDirect, UploadFailure } from "./upload-client";
import { captureVideoFrame } from "./video-meta";

export type MediaDetailDrawerProps = {
  media: PanelMedia | null;
  onClose: () => void;
  folders: string[];
  onUpdated: (item: PanelMedia) => void;
  /** Day 6: new rows made in the drawer (a cover image captured from the video). */
  onAdded?: (items: PanelMedia[]) => void;
  onMoved: (ids: number[], folder: string) => void;
  /** Ids of the deleted rows (a video may take its auto-captured cover image with it). */
  onDeleted: (ids: number[]) => void;
  /** Usage counts known to the grid (updated after the drawer loads the full list). */
  onUsageCount: (id: number, count: number) => void;
};

const NETWORK_ERROR = "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.";

/** A moderate WebP of a cover image for <video poster> (never the 1800 px original). */
function posterSource(poster: MediaLike | null | undefined): string | undefined {
  if (!poster) return undefined;
  const webp = (poster.variants ?? []).filter((v) => v.format === "webp").sort((a, b) => a.width - b.width);
  const pick = webp.find((v) => v.width >= 768) ?? webp[webp.length - 1];
  return pick ? variantUrl(poster, pick.key) : poster.url;
}

/** Side drawer with everything about one file: preview, facts, URL, alt text, video cover, folder, usage and delete. */
export default function MediaDetailDrawer({ media, onClose, ...rest }: MediaDetailDrawerProps) {
  const video = media ? isVideoMedia(media) : false;
  return (
    <Dialog
      open={media !== null}
      onClose={onClose}
      title={media ? mediaLabel(media) : "Dosya"}
      description={video ? "Video ayrıntıları" : "Görsel ayrıntıları"}
      className="my-0 me-0 ms-auto h-dvh max-h-dvh w-[min(32rem,100vw)] max-w-none rounded-none border-y-0 border-e-0 sm:rounded-s-2xl starting:open:translate-x-6 starting:open:translate-y-0"
      bodyClassName="p-0 sm:p-0"
    >
      {media ? <DrawerBody key={media.id} media={media} onClose={onClose} {...rest} /> : null}
    </Dialog>
  );
}

function DrawerBody({ media, onClose, folders, onUpdated, onAdded, onMoved, onDeleted, onUsageCount }: MediaDetailDrawerProps & { media: PanelMedia }) {
  const [usage, setUsage] = useState<{ id: number; list: MediaUsage[] } | { id: number; error: true } | null>(null);
  const [copied, setCopied] = useState(false);
  const [folder, setFolder] = useState(media.folder);
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const listId = useId();
  const altForm = usePanelForm<{ alt: LocalizedText | null }>({ alt: media.alt });
  const video = isVideoMedia(media);
  const noun = video ? "video" : "görsel";
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let alive = true;
    getMediaUsageAction(media.id)
      .then((list) => {
        if (!alive) return;
        setUsage({ id: media.id, list });
        onUsageCount(media.id, list.length);
      })
      .catch(() => alive && setUsage({ id: media.id, error: true }));
    return () => {
      alive = false;
    };
    // Load once per file (the body is keyed by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id]);

  const usageList = usage && "list" in usage ? usage.list : null;
  const inUse = (usageList?.length ?? 0) > 0;
  const absoluteUrl = typeof window === "undefined" ? media.url : new URL(media.url, window.location.origin).href;
  const folderValue = folder.trim().toLowerCase();
  const folderError = folderValue && !FOLDER_PATTERN.test(folderValue) ? "Yalnızca küçük harf, rakam, tire ve alt çizgi (alt klasör için /)." : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      toast.success("Bağlantı kopyalandı.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopyalanamadı. Bağlantıyı seçip elle kopyalayın.");
    }
  };

  const saveAlt = () =>
    altForm.submit(updateMediaAltAction, {
      payload: (s) => ({ id: media.id, alt: s.alt, updatedAt: media.updatedAt }),
      onSuccess: (data) => {
        if (data) onUpdated(data);
      },
    });

  const move = async () => {
    if (!folderValue || folderError || folderValue === media.folder) return;
    setMoving(true);
    try {
      const result = await moveMediaAction(null, toPayloadFormData({ ids: [media.id], folder: folderValue }));
      if (result.ok) {
        toast.success(result.message ?? "Dosya taşındı.");
        onMoved([media.id], folderValue);
      } else {
        toast.error(result.fieldErrors?.folder ?? result.error);
      }
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setMoving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const result = await deleteMediaAction(null, toPayloadFormData({ id: media.id }));
      if (result.ok) {
        toast.success(result.message ?? (video ? "Video silindi." : "Görsel silindi."));
        setConfirmDelete(false);
        onDeleted([media.id, ...(result.data?.alsoDeleted ?? [])]);
        onClose();
      } else {
        setConfirmDelete(false);
        toast.error(result.error, { duration: result.code === "in_use" ? 0 : undefined });
        if (result.code === "in_use") getMediaUsageAction(media.id).then((list) => setUsage({ id: media.id, list })).catch(() => undefined);
      }
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setDeleting(false);
    }
  };

  const facts: [string, React.ReactNode][] = [
    ["Dosya adı", media.originalName ?? <span className="text-text-muted">Siteyle birlikte yüklendi</span>],
    ["Boyut", media.width && media.height ? `${media.width} × ${media.height} px` : "—"],
    ...(video ? [["Süre", formatMediaDuration(media.durationMs) || "—"] as [string, React.ReactNode]] : []),
    ["Dosya boyutu", formatBytes(media.bytes) || "—"],
    ["Biçim", `${formatLabel(media.mime)}${!video && media.variants?.length ? ` · ${media.variants.length} boyut (AVIF + WebP)` : ""}`],
    ["Yüklenme", formatIstanbul(media.createdAt)],
  ];

  return (
    <div className="flex flex-col">
      <div className="border-b border-border bg-[conic-gradient(var(--surface-2)_25%,transparent_0_50%,var(--surface-2)_0_75%,transparent_0)] bg-[length:20px_20px] p-4 sm:p-5">
        <div className="relative mx-auto aspect-[4/3] max-h-72 w-full">
          {video ? (
            <VideoPreview media={media} videoRef={videoRef} />
          ) : (
            <Img media={media} alt="" sizes="(min-width: 640px) 30rem, 100vw" fill placeholder={false} className="object-contain" />
          )}
        </div>
      </div>

      <div className="space-y-7 px-5 py-5 sm:px-6">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-muted">{label}</dt>
              <dd className="min-w-0 break-words text-text">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-text">
            <Link2 aria-hidden className="size-4 text-text-muted" />
            Bağlantı
          </p>
          <div className="flex items-stretch gap-2">
            <input
              readOnly
              value={absoluteUrl}
              aria-label={video ? "Video bağlantısı" : "Görsel bağlantısı"}
              onFocus={(e) => e.currentTarget.select()}
              dir="ltr"
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface-2/60 px-3 font-mono text-xs text-text-muted focus:border-brand focus:outline-none focus:ring-4 focus:ring-gold/20"
            />
            <Button icon={copied ? Check : Copy} onClick={copy}>
              {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
          </div>
        </div>

        {video ? (
          <PosterSection
            media={media}
            videoRef={videoRef}
            usage={usage === null ? "loading" : "error" in usage ? "error" : usage.list}
            onUpdated={onUpdated}
            onAdded={onAdded}
            onDeleted={onDeleted}
          />
        ) : null}

        <section className="space-y-3">
          <LocalizedInput
            label={video ? "Video açıklaması" : "Alternatif metin"}
            name="alt"
            maxLength={250}
            value={altForm.state.alt}
            onChange={(v) => altForm.setField("alt", v)}
            error={altForm.localizedError("alt")}
            help={
              video
                ? "Videoyu bir iki cümleyle anlatın: ekran okuyucular ve arama motorları bu metni kullanır (ürün sayfasındaki video açıklaması)."
                : "Görme engelli ziyaretçiler ve arama motorları için görseli kısaca anlatın. Süs amaçlı görsellerde boş bırakın."
            }
          />
          <div className="flex items-center justify-end gap-2">
            {altForm.dirty ? (
              <Button size="sm" variant="ghost" onClick={() => altForm.reset()} disabled={altForm.pending}>
                Vazgeç
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={saveAlt} disabled={!altForm.dirty} pending={altForm.pending} pendingLabel="Kaydediliyor…">
              {video ? "Açıklamayı kaydet" : "Alternatif metni kaydet"}
            </Button>
          </div>
        </section>

        <Field label="Klasör" error={folderError} help={`Klasör yalnızca düzen içindir; ${video ? "videonun" : "görselin"} adresi değişmez.`}>
          <div className="flex gap-2">
            <TextInput value={folder} onChange={setFolder} list={`${listId}-folders`} prefix={<FolderOpen aria-hidden className="size-4" />} spellCheck={false} className="min-w-0 flex-1" />
            <Button icon={FolderInput} onClick={move} disabled={!folderValue || Boolean(folderError) || folderValue === media.folder} pending={moving} pendingLabel="Taşınıyor…">
              Taşı
            </Button>
          </div>
        </Field>
        <datalist id={`${listId}-folders`}>
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>

        <section className="space-y-2" aria-labelledby={`${listId}-usage`}>
          <h3 id={`${listId}-usage`} className="text-sm font-medium text-text">
            Kullanıldığı yerler
          </h3>
          {usage === null ? (
            <p role="status" className="flex items-center gap-2 text-sm text-text-muted">
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              Kontrol ediliyor…
            </p>
          ) : "error" in usage ? (
            <p className={errorClass}>Kullanım bilgisi alınamadı. Silmeden önce sayfayı yenileyin.</p>
          ) : usage.list.length === 0 ? (
            <p className="text-sm text-text-muted">Hiçbir yerde kullanılmıyor.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {usage.list.map((u, i) => (
                <li key={`${u.kind}-${u.label}-${u.detail}-${i}`}>
                  {u.href ? (
                    <Link
                      href={u.href}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-text">{u.label}</span>
                        <span className="block truncate text-xs text-text-muted">{u.detail}</span>
                      </span>
                      <ArrowUpRight aria-hidden className="size-4 shrink-0 text-text-muted" />
                    </Link>
                  ) : (
                    <span className="block px-3 py-2.5 text-sm">
                      <span className="block truncate font-medium text-text">{u.label}</span>
                      <span className="block truncate text-xs text-text-muted">{u.detail}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className={cn("rounded-lg border p-4", inUse ? "border-[#D68A12]/35 bg-[#D68A12]/[0.06]" : "border-border")}>
          {inUse ? (
            <p className="flex items-start gap-2 text-sm text-text">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[#B5730C]" />
              Bu {noun} kullanımda olduğu için silinemez. Önce yukarıdaki yerlerden kaldırın.
            </p>
          ) : (
            <p className="text-sm text-text-muted">
              {video
                ? "Silinen video kalıcı olarak kaldırılır; onun için otomatik oluşturulan kapak görseli başka yerde kullanılmıyorsa o da silinir."
                : "Silinen görsel ve tüm boyutları kalıcı olarak kaldırılır."}
            </p>
          )}
          <Button variant="danger-outline" icon={Trash2} className="mt-3" onClick={() => setConfirmDelete(true)} disabled={usage === null || inUse || "error" in (usage ?? {})}>
            {video ? "Videoyu sil" : "Görseli sil"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (deleting ? undefined : setConfirmDelete(false))}
        onConfirm={remove}
        pending={deleting}
        title={video ? "Video silinsin mi?" : "Görsel silinsin mi?"}
        description={
          video
            ? `“${mediaLabel(media)}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`
            : `“${mediaLabel(media)}” ve tüm boyutları kalıcı olarak silinecek. Bu işlem geri alınamaz.`
        }
        confirmLabel={video ? "Videoyu sil" : "Görseli sil"}
      />
    </div>
  );
}

/** The drawer's video player ("Bu kareyi kapak yap" reads its current frame through `videoRef`). */
function VideoPreview({ media, videoRef }: { media: PanelMedia; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  return (
    <video
      ref={videoRef}
      src={media.url}
      poster={posterSource(media.poster)}
      controls
      preload="metadata"
      playsInline
      crossOrigin="anonymous"
      aria-label={`${mediaLabel(media)} önizlemesi`}
      className="absolute inset-0 size-full rounded-md bg-black object-contain"
    />
  );
}

/** Day 6: the cover image of a video — capture the current frame, pick one from the library, or remove it. */
function PosterSection({
  media,
  videoRef,
  usage,
  onUpdated,
  onAdded,
  onDeleted,
}: {
  media: PanelMedia;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Where the video is used: a used video keeps a cover (replace only; the server refuses a removal too). */
  usage: "loading" | "error" | MediaUsage[];
  onUpdated: (item: PanelMedia) => void;
  onAdded?: (items: PanelMedia[]) => void;
  onDeleted: (ids: number[]) => void;
}) {
  const [busy, setBusy] = useState<"capture" | "pick" | "remove" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [status, setStatus] = useState("");
  const { confirm, confirmDialog } = useConfirm();
  const headingId = useId();
  const updatedAt = useRef(media.updatedAt);
  const inUse = Array.isArray(usage) && usage.length > 0;
  const canRemove = Array.isArray(usage) && usage.length === 0;
  useEffect(() => {
    updatedAt.current = media.updatedAt;
  }, [media.updatedAt]);

  const save = async (posterId: number | null): Promise<boolean> => {
    const result = await updateMediaPosterAction(null, toPayloadFormData({ id: media.id, posterId, updatedAt: updatedAt.current }));
    if (!result.ok) {
      toast.error(result.fieldErrors?.posterId ?? result.error);
      return false;
    }
    if (result.data) {
      updatedAt.current = result.data.media.updatedAt;
      onUpdated(result.data.media);
      if (result.data.removed.length > 0) onDeleted(result.data.removed);
    }
    toast.success(result.message ?? "Kapak görseli güncellendi.");
    setStatus(posterId ? "Kapak görseli güncellendi." : "Kapak görseli kaldırıldı.");
    return true;
  };

  const capture = async () => {
    const element = videoRef.current;
    if (!element) return;
    setBusy("capture");
    setStatus("Kare kapak olarak kaydediliyor…");
    try {
      const blob = await captureVideoFrame(element);
      if (!blob) {
        toast.error("Bu kare alınamadı. Videoyu istediğiniz yere getirip (gerekirse bir an oynatıp) tekrar deneyin.");
        setStatus("");
        return;
      }
      const file = new File([blob], posterFileName(media.originalName ?? `video-${media.id}.mp4`), { type: "image/jpeg" });
      const { item } = await uploadDirect(file, { name: file.name, kind: "image", mime: "image/jpeg", folder: media.folder, purpose: "poster" });
      onAdded?.([item]);
      if (!(await save(item.id))) {
        // The new cover is unused: do not leave it behind.
        void deleteMediaAction(null, toPayloadFormData({ id: item.id }))
          .then((r) => r.ok && onDeleted([item.id]))
          .catch(() => undefined);
      }
    } catch (error) {
      toast.error(error instanceof UploadFailure ? error.message : NETWORK_ERROR);
      setStatus("");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Kapak görseli kaldırılsın mı?",
      description:
        "Video kapaksız kalır. Kapak videodan otomatik alınmışsa ve başka bir yerde kullanılmıyorsa kalıcı olarak silinir; kütüphaneden seçilmiş bir görsel kütüphanede kalır.",
      confirmLabel: "Kapağı kaldır",
    });
    if (ok) await run("remove", null);
  };

  const run = async (kind: "pick" | "remove", posterId: number | null) => {
    setBusy(kind);
    try {
      await save(posterId);
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="text-sm font-medium text-text">
          Kapak görseli
        </h3>
        <p className="mt-0.5 text-xs text-text-muted">Video oynatılmadan önce görünür; ürün sayfasında ve arama sonuçlarında da kullanılır.</p>
      </div>
      <div className="flex items-start gap-3">
        <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2">
          {media.poster ? (
            <MediaThumb media={media.poster} sizes="112px" fill alt="Mevcut kapak görseli" />
          ) : (
            <span className="grid size-full place-items-center px-2 text-center text-[0.6875rem] text-text-muted">Kapak yok</span>
          )}
        </span>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button size="sm" icon={Camera} onClick={capture} pending={busy === "capture"} pendingLabel="Kaydediliyor…" disabled={busy !== null && busy !== "capture"}>
            Bu kareyi kapak yap
          </Button>
          <Button size="sm" icon={ImagePlus} onClick={() => setPickerOpen(true)} pending={busy === "pick"} pendingLabel="Kaydediliyor…" disabled={busy !== null && busy !== "pick"} aria-haspopup="dialog">
            Kütüphaneden seç
          </Button>
          {media.posterId && canRemove ? (
            <Button size="sm" variant="ghost" icon={X} onClick={() => void remove()} pending={busy === "remove"} pendingLabel="Kaldırılıyor…" disabled={busy !== null && busy !== "remove"}>
              Kaldır
            </Button>
          ) : null}
        </div>
      </div>
      {media.posterId && inUse ? (
        <p className="text-xs text-text-muted">Bu video kullanımda olduğu için kapağı kaldırılamaz; yalnızca değiştirilebilir.</p>
      ) : null}
      <p className="text-xs text-text-muted">İpucu: yukarıdaki videoyu istediğiniz kareye getirip “Bu kareyi kapak yap” düğmesine basın.</p>
      {confirmDialog}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      <MediaPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        currentId={media.posterId ?? null}
        folder={media.folder}
        kind="image"
        title="Kapak görseli seç"
        onSelect={([item]) => {
          setPickerOpen(false);
          if (item && item.id !== media.posterId) void run("pick", item.id);
        }}
      />
    </section>
  );
}
