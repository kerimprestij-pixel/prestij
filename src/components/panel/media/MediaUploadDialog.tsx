"use client";
import { useId, useState } from "react";
import { Ban, Check, CloudUpload, FileWarning, Film, FolderOpen, LoaderCircle, Upload, X } from "lucide-react";
// Direct imports (not the form barrel): the picker dialog in that barrel imports this module.
import Field from "@/components/panel/form/Field";
import TextInput from "@/components/panel/form/TextInput";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import { MEDIA_UPLOAD, type MediaKindFilter } from "@/lib/panel/media/types";
import { acceptFor } from "@/lib/panel/media/upload-rules";
import { FOLDER_PATTERN } from "@/lib/panel/schemas";
import { cn } from "@/lib/utils";
import { formatBytes } from "./media-format";
import { canCancelUpload, type QueueItem } from "./upload-queue-model";
import { VIDEO_SPEECH_TIP } from "./video-guidance";

const MB = 1024 * 1024;

export function folderProblem(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return "Klasör adı girin.";
  return FOLDER_PATTERN.test(v) ? null : "Yalnızca küçük harf, rakam, tire ve alt çizgi kullanın (alt klasör için /).";
}

const PHASE_LABEL: Record<NonNullable<QueueItem["phase"]>, string> = {
  preparing: "Hazırlanıyor…",
  poster: "Kapak hazırlanıyor…",
  uploading: "",
  processing: "İşleniyor…",
};

function statusText(item: QueueItem): string {
  if (item.status !== "uploading") return formatBytes(item.size);
  if (item.phase === "uploading") return item.progress >= 1 ? PHASE_LABEL.processing : `%${Math.round(item.progress * 100)}`;
  return item.phase ? PHASE_LABEL[item.phase] : "";
}

/** Per-file progress list (shared by the dialog, the picker and the inline status card). */
export function UploadQueueList({ queue, className, onCancel }: { queue: QueueItem[]; className?: string; onCancel?: (key: string) => void }) {
  if (queue.length === 0) return null;
  return (
    <ul className={cn("divide-y divide-border rounded-xl border border-border bg-surface", className)} aria-label="Yükleme durumu">
      {queue.map((item) => {
        const percent = Math.round((item.status === "done" ? 1 : item.phase === "uploading" ? item.progress : 0) * 100);
        const indeterminate = item.status === "uploading" && item.phase !== "uploading";
        return (
          <li key={item.key} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-2 text-text-muted">
              {item.status === "done" ? (
                <Check aria-hidden className="size-4 text-[#2F8F5B]" />
              ) : item.status === "error" ? (
                <FileWarning aria-hidden className="size-4 text-[#B3261E] dark:text-[#F28B82]" />
              ) : item.status === "cancelled" ? (
                <Ban aria-hidden className="size-4" />
              ) : item.status === "uploading" ? (
                <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              ) : item.kind === "video" ? (
                <Film aria-hidden className="size-4" />
              ) : (
                <Upload aria-hidden className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-text" dir="auto">
                  {item.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-muted">{statusText(item)}</span>
              </div>
              {item.status === "cancelled" ? (
                <p className="mt-0.5 text-xs text-text-muted">{item.error}</p>
              ) : item.status === "error" ? (
                <p role="alert" className="mt-0.5 text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">
                  {item.error}
                </p>
              ) : (
                <div
                  role="progressbar"
                  aria-label={`${item.name} yükleniyor`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={indeterminate ? undefined : percent}
                  aria-valuetext={indeterminate ? statusText(item) : undefined}
                  className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none",
                      item.status === "done" ? "bg-[#2F8F5B]" : "bg-gold",
                      indeterminate && "w-1/3 animate-pulse motion-reduce:animate-none",
                    )}
                    style={indeterminate ? undefined : { width: `${percent}%` }}
                  />
                </div>
              )}
            </div>
            {onCancel && canCancelUpload(item) ? (
              <button
                type="button"
                onClick={() => onCancel(item.key)}
                aria-label={`${item.name} yüklemesini iptal et`}
                title="İptal"
                className="grid size-8 shrink-0 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden className="size-4" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const ACCEPT_COPY: Record<MediaKindFilter, { drop: string; hint: string; folderHelp: string }> = {
  image: {
    drop: "Görselleri buraya sürükleyin veya seçmek için tıklayın",
    hint: `JPEG, PNG, WebP veya AVIF · görsel başına en fazla ${MEDIA_UPLOAD.maxFileBytes / MB} MB · birden çok dosya seçebilirsiniz`,
    folderHelp: "Görseller bu klasöre eklenir. Yeni bir ad yazarak klasör oluşturabilirsiniz (ör. blog veya urunler/lavanta).",
  },
  video: {
    drop: "Videoları buraya sürükleyin veya seçmek için tıklayın",
    hint: `MP4 (H.264) veya WebM · en fazla ${MEDIA_UPLOAD.video.maxBytes / MB} MB ve ${MEDIA_UPLOAD.video.maxDurationMs / 1000} saniye · MOV/HEVC için önce MP4 (H.264) olarak dışa aktarın`,
    folderHelp: "Videolar ve kapak görselleri bu klasöre eklenir. Yeni bir ad yazarak klasör oluşturabilirsiniz (ör. urunler/lavanta).",
  },
  all: {
    drop: "Görselleri veya videoları buraya sürükleyin ya da seçmek için tıklayın",
    hint: `Görsel: JPEG, PNG, WebP, AVIF (en fazla ${MEDIA_UPLOAD.maxFileBytes / MB} MB) · Video: MP4 (H.264) veya WebM (en fazla ${MEDIA_UPLOAD.video.maxBytes / MB} MB, ${MEDIA_UPLOAD.video.maxDurationMs / 1000} saniye)`,
    folderHelp: "Dosyalar bu klasöre eklenir. Yeni bir ad yazarak klasör oluşturabilirsiniz (ör. blog veya urunler/lavanta).",
  },
};

export type UploadDropzoneProps = {
  folders: string[];
  defaultFolder: string;
  queue: QueueItem[];
  busy: boolean;
  onStart: (files: File[], folder: string) => void;
  /** What may be uploaded here (default: images and videos). */
  accept?: MediaKindFilter;
  className?: string;
  /** Cancels a waiting or uploading file (the list shows an "İptal" button per file). */
  onCancel?: (key: string) => void;
  /**
   * D16: the id of a video tip shown elsewhere. The media picker shows the tip once above its tabs (so the
   * library and the upload tab both have it) and passes its id: the file input links to it instead of a
   * second copy here.
   */
  videoTipId?: string;
};

/** D16: the video tip (speech and subtitles) as the upload area and the media picker show it. */
export function VideoSpeechTip({ id, className }: { id?: string; className?: string }) {
  return (
    <p id={id} className={cn("flex items-start gap-2 text-xs leading-relaxed text-text-muted", className)} data-video-tip="">
      <Film aria-hidden className="mt-px size-3.5 shrink-0 text-gold-text" strokeWidth={1.75} />
      <span>{VIDEO_SPEECH_TIP}</span>
    </p>
  );
}

/** Folder field, drop zone / file browser and the progress list (the dialog's body; the picker's upload tab). */
export function UploadDropzone({ folders, defaultFolder, queue, busy, onStart, accept = "all", className, onCancel, videoTipId }: UploadDropzoneProps) {
  const [folder, setFolder] = useState(defaultFolder);
  const [dragging, setDragging] = useState(false);
  const listId = useId();
  const hintId = useId();
  const ownTipId = useId();
  const error = folder.trim() ? folderProblem(folder) : null;
  const copy = ACCEPT_COPY[accept];
  // D16: where videos may be uploaded, the tip about speech and subtitles (no captions feature); shown
  // here unless the caller already shows it (videoTipId), and linked to the file input either way.
  const videoTip = accept !== "image";
  const ownTip = videoTip && !videoTipId;
  const tipId = videoTipId ?? ownTipId;

  const start = (files: File[]) => {
    if (files.length === 0 || busy || error) return;
    onStart(files, folder.trim().toLowerCase() || MEDIA_UPLOAD.defaultFolder);
  };

  return (
    <div className={cn("space-y-5", className)}>
      <Field label="Klasör" error={error} help={copy.folderHelp} className="max-w-sm">
        <TextInput value={folder} onChange={setFolder} list={listId} prefix={<FolderOpen aria-hidden className="size-4" />} spellCheck={false} autoComplete="off" />
      </Field>
      <datalist id={listId}>
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <label
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          start(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none",
          dragging ? "border-gold bg-gold/10" : "border-border bg-surface-2/40 hover:border-gold/50",
          (busy || error) && "pointer-events-none opacity-60",
        )}
      >
        <span className="grid size-12 place-items-center rounded-full border border-border bg-surface text-gold-text">
          <CloudUpload aria-hidden className="size-5" strokeWidth={1.5} />
        </span>
        <span className="text-sm font-medium text-text">{busy ? "Yükleniyor…" : copy.drop}</span>
        <span id={hintId} className="max-w-md text-xs text-text-muted">
          {copy.hint}
        </span>
        <input
          type="file"
          multiple
          accept={acceptFor(accept)}
          disabled={busy || Boolean(error)}
          aria-describedby={videoTip ? `${hintId} ${tipId}` : hintId}
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            start(files);
          }}
        />
      </label>
      {ownTip ? <VideoSpeechTip id={tipId} /> : null}

      <UploadQueueList queue={queue} onCancel={onCancel} />
    </div>
  );
}

/** Upload dialog of the media library: target folder, a drop zone / file browser and the progress list. */
export default function MediaUploadDialog({
  open,
  onClose,
  folders,
  defaultFolder,
  queue,
  busy,
  onStart,
  onCancel,
}: {
  open: boolean;
  onClose: () => void;
  folders: string[];
  defaultFolder: string;
  queue: QueueItem[];
  busy: boolean;
  onStart: (files: File[], folder: string) => void;
  /** Cancels one file, or (no key) every file that can still be cancelled. */
  onCancel?: (key?: string) => void;
}) {
  const cancellable = queue.some(canCancelUpload);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Görsel veya video yükle"
      description="Görseller AVIF ve WebP olarak birkaç boyutta hazırlanır. Videolar olduğu gibi saklanır; ilk saniyesinden bir kapak görseli oluşturulur."
      size="lg"
      footer={
        <>
          {busy && onCancel && cancellable ? (
            <Button variant="ghost" icon={Ban} onClick={() => onCancel()}>
              Yüklemeyi durdur
            </Button>
          ) : null}
          <Button variant={busy ? "secondary" : "primary"} onClick={onClose}>
            {busy ? "Arka planda devam et" : "Kapat"}
          </Button>
        </>
      }
    >
      {open ? <UploadDropzone folders={folders} defaultFolder={defaultFolder} queue={queue} busy={busy} onStart={onStart} onCancel={onCancel} /> : null}
    </Dialog>
  );
}
