"use client";
// Product images and videos: add from the media library, reorder, role, link to one variant, quick alt
// text. Day 6: "Video ekle" adds videos (at most MAX_PRODUCT_VIDEOS, each with a cover image): a video
// row shows its cover with a play badge and duration, has no role choice and an "Otomatik oynat
// (sessiz)" switch. The first row must be an image (cards, shares and the product page's first slide use
// it): the editor warns at once, the save refuses it (same messages, productMediaKindErrors).
import { useState } from "react";
import Link from "next/link";
import { Film, ImageOff, Plus, Type, X } from "lucide-react";
import { updateMediaAltAction } from "@/lib/panel/media/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedInput } from "@/components/panel/form/LocalizedInput";
import MediaPickerDialog from "@/components/panel/form/MediaPickerDialog";
import Select from "@/components/panel/form/Select";
import Switch from "@/components/panel/form/Switch";
import MediaThumb, { formatMediaDuration } from "@/components/panel/media/MediaThumb";
import { VIDEO_SPEECH_TIP } from "@/components/panel/media/video-guidance";
import Button from "@/components/panel/ui/Button";
import Dialog from "@/components/panel/ui/Dialog";
import SortableList from "@/components/panel/ui/SortableList";
import { focusRingClass, iconButtonClass } from "@/components/panel/ui/styles";
import { toast } from "@/components/panel/ui/toast-store";
import type { LocalizedText } from "@/db/schema/common";
import type { ProductMediaRole } from "@/db/schema/catalog";
import { isVideoMedia, type MediaLike } from "@/lib/media/types";
import { toPayloadFormData } from "@/lib/panel/action-types";
import type { PanelMedia } from "@/lib/panel/media/types";
import {
  MAX_PRODUCT_VIDEOS,
  MEDIA_ROLE_OPTIONS,
  newKey,
  productMediaKindErrors,
  variantTitle,
  type ProductMediaState,
} from "@/lib/panel/products/types";
import { cn } from "@/lib/utils";
import { Section, Warning, type TabProps } from "./shared";

/** Max rows (images + videos) per product, as the save schema allows. */
const MAX_ROWS = 60;

type RowMedia = MediaLike & Partial<PanelMedia>;

function AltDialog({ media, onClose, onSaved }: { media: PanelMedia; onClose: () => void; onSaved: (m: PanelMedia) => void }) {
  const [alt, setAlt] = useState<LocalizedText | null>(media.alt);
  const [error, setError] = useState<string | { tr?: string; en?: string; ar?: string } | undefined>();
  const [pending, setPending] = useState(false);
  const video = isVideoMedia(media);
  async function save() {
    setPending(true);
    const result = await updateMediaAltAction(null, toPayloadFormData({ id: media.id, alt, updatedAt: media.updatedAt }));
    setPending(false);
    if (result.ok && result.data) {
      toast.success(result.message ?? (video ? "Video açıklaması kaydedildi." : "Alternatif metin kaydedildi."));
      // Keep the cover the row already shows (the action returns the row without it).
      onSaved({ ...result.data, poster: result.data.poster ?? media.poster ?? null });
      onClose();
    } else if (!result.ok) {
      const fe = result.fieldErrors ?? {};
      setError(fe.alt ?? (fe["alt.tr"] || fe["alt.en"] || fe["alt.ar"] ? { tr: fe["alt.tr"], en: fe["alt.en"], ar: fe["alt.ar"] } : undefined));
      toast.error(result.error);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={video ? "Video açıklaması" : "Alternatif metin"}
      description={
        video
          ? "Videonun kısa tarifi: ekran okuyucular videoyu bu adla duyurur, arama motorları video başlığı olarak kullanır. Videonun kullanıldığı her yerde geçerlidir."
          : "Görme engelli ziyaretçiler ve arama motorları için görselin kısa tarifi. Görselin kullanıldığı her yerde geçerlidir."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={save} pending={pending} pendingLabel="Kaydediliyor…">
            Kaydet
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative mx-auto aspect-[4/3] w-full max-w-xs overflow-hidden rounded-lg border border-border bg-surface-2">
          <MediaThumb media={media} alt="" sizes="320px" fill />
        </div>
        <LocalizedInput
          label={video ? "Video açıklaması" : "Alternatif metin"}
          value={alt}
          onChange={setAlt}
          error={error}
          maxLength={250}
          placeholder={video ? "ör. Lavanta Latte sıvı el sabunu pompalı şişeden avuca dökülüyor" : "ör. Lavanta Latte sıvı el sabunu, 500 ml pompalı şişe"}
        />
      </div>
    </Dialog>
  );
}

export default function MediaTab({ form, media }: TabProps) {
  const { state, setField, errorsUnder } = form;
  const [picking, setPicking] = useState<null | "image" | "video">(null);
  const [altFor, setAltFor] = useState<PanelMedia | null>(null);
  const rows = state.media;
  const variantOptions = [
    { value: "", label: "Tüm varyantlar" },
    ...state.variants.map((v) => ({ value: v.key, label: [variantTitle(v, state.options) || v.sku, v.isActive ? null : "(pasif)"].filter(Boolean).join(" ") })),
  ];
  const update = (index: number, patch: Partial<ProductMediaState>) => setField("media", rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const rowMedia = (r: ProductMediaState) => media.get(r.mediaId) as RowMedia | undefined;
  const isVideoRow = (r: ProductMediaState) => isVideoMedia(rowMedia(r));
  const videoCount = rows.filter(isVideoRow).length;
  const firstImage = rows.findIndex((r) => !isVideoRow(r));
  const hasPackshot = rows.some((r) => !isVideoRow(r) && r.role === "packshot");
  // Instant feedback with the media the editor has loaded; the save checks the same rules again.
  const localErrors = productMediaKindErrors(rows, (id) => {
    const m = media.get(id) as RowMedia | undefined;
    return m ? { video: isVideoMedia(m), hasPoster: Boolean(m.poster) } : undefined;
  });
  const listError = form.errors.media ?? localErrors.media;
  const videosLeft = Math.max(0, MAX_PRODUCT_VIDEOS - videoCount);

  return (
    <div className="space-y-6">
      <Section
        title="Görseller ve videolar"
        description="İlk görsel kartlarda ve paylaşımlarda kullanılır; listenin başında her zaman bir görsel olmalı. Bir varyanta bağlanan görsel veya video, o varyant seçilince öne gelir."
        actions={
          <>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setPicking("image")} aria-haspopup="dialog" disabled={rows.length >= MAX_ROWS}>
              Görsel ekle
            </Button>
            <Button
              size="sm"
              icon={Film}
              onClick={() => setPicking("video")}
              aria-haspopup="dialog"
              disabled={videosLeft === 0 || rows.length >= MAX_ROWS}
              title={videosLeft === 0 ? `Bir ürüne en fazla ${MAX_PRODUCT_VIDEOS} video eklenebilir.` : undefined}
            >
              Video ekle
            </Button>
          </>
        }
      >
        {/* D16: right under "Video ekle", above the media list (which can be long). */}
        <p className="text-xs text-text-muted" data-video-tip="">
          {VIDEO_SPEECH_TIP}
        </p>
        {listError ? <p className="text-xs font-medium text-[#B3261E] dark:text-[#F28B82]">{listError}</p> : null}
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm text-text">Henüz görsel yok.</p>
            <p className="mt-1 text-xs text-text-muted">Kütüphaneden seçin veya yeni görsel yükleyin. Görsel yoksa kartlarda ürün rengi gösterilir.</p>
          </div>
        ) : (
          <SortableList
            items={rows}
            ariaLabel="Ürün görselleri ve videoları (sürükleyerek sıralayın)"
            getKey={(r) => r.key}
            getItemLabel={(r, i) => {
              const m = rowMedia(r);
              return m?.alt?.tr || `${isVideoMedia(m) ? "Video" : "Görsel"} ${i + 1}`;
            }}
            onReorder={(next) => setField("media", next)}
            renderItem={(r, ctx) => {
              const index = ctx.index;
              const m = rowMedia(r);
              const video = isVideoMedia(m);
              const errs = errorsUnder(`media.${index}`);
              const kindError = errs.mediaId ?? localErrors[`media.${index}.mediaId`];
              const label = m?.alt?.tr || `${video ? "Video" : "Görsel"} ${index + 1}`;
              const duration = video ? formatMediaDuration(m?.durationMs) : "";
              return (
                <div className={cn("rounded-xl border bg-surface p-2.5", Object.keys(errs).length || kindError ? "border-[#B3261E]/50" : "border-border")}>
                  <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                    <div className="flex items-center gap-1">{ctx.handle}</div>
                    <span className="relative block size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2">
                      {m ? <MediaThumb media={m} alt="" sizes="64px" fill showDuration={false} /> : <ImageOff aria-hidden className="m-auto mt-6 size-4 text-text-muted" />}
                      {index === firstImage ? (
                        <span className="absolute inset-x-0 bottom-0 bg-black/55 py-px text-center text-[0.5625rem] font-medium text-white">Ana görsel</span>
                      ) : null}
                    </span>
                    <div className="grid min-w-0 flex-1 basis-56 gap-2 sm:grid-cols-2">
                      {video ? (
                        <div className="flex min-w-0 flex-col justify-center gap-2">
                          <p className="text-xs font-medium text-text">
                            Video{duration ? <span className="ms-1.5 font-normal text-text-muted tabular-nums">{duration}</span> : null}
                          </p>
                          <Switch
                            size="sm"
                            checked={r.autoplay === true}
                            onChange={(autoplay) => update(index, { autoplay })}
                            label="Otomatik oynat (sessiz)"
                            description="Açıkken video seçildiğinde sessiz ve döngülü oynar; kapalıyken oynatma düğmesiyle açılır."
                          />
                        </div>
                      ) : (
                        <Field label="Rol" error={errs.role} name={`media.${index}.role`}>
                          <Select<ProductMediaRole>
                            size="sm"
                            value={r.role}
                            onChange={(role) => update(index, { role })}
                            options={MEDIA_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                          />
                        </Field>
                      )}
                      <Field label="Varyant" error={errs.variantKey} name={`media.${index}.variantKey`}>
                        <Select<string> size="sm" value={r.variantKey ?? ""} onChange={(v) => update(index, { variantKey: v || null })} options={variantOptions} />
                      </Field>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 sm:flex-col sm:items-end">
                      <span className="hidden sm:inline-flex">{ctx.moveButtons}</span>
                      <span className="inline-flex">
                        <button
                          type="button"
                          onClick={() => m && m.updatedAt && setAltFor(m as PanelMedia)}
                          disabled={!m?.updatedAt}
                          aria-label={`${label}: ${video ? "video açıklamasını" : "alternatif metni"} düzenle`}
                          title={video ? "Video açıklaması" : "Alternatif metin"}
                          className={iconButtonClass("sm")}
                        >
                          <Type aria-hidden className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setField("media", rows.filter((_, i) => i !== index))}
                          aria-label={`${label}: üründen kaldır`}
                          className={cn(iconButtonClass("sm"), "hover:text-[#B3261E] dark:hover:text-[#F28B82]")}
                        >
                          <X aria-hidden className="size-4" />
                        </button>
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ps-1 text-xs text-text-muted">
                    {!m ? (
                      <span className="text-[#B3261E] dark:text-[#F28B82]">{errs.mediaId ?? "Görsel kütüphanede bulunamadı; kaldırın."}</span>
                    ) : (
                      <>
                        {kindError ? <span className="font-medium text-[#B3261E] dark:text-[#F28B82]">{kindError}</span> : null}
                        {m.alt?.tr ? (
                          <span className="min-w-0 truncate">
                            {video ? "Açıklama" : "Alternatif metin"}: {m.alt.tr}
                          </span>
                        ) : (
                          <Warning>{video ? "Video açıklaması yok." : "Alternatif metin yok."}</Warning>
                        )}
                        {m.width && m.height ? (
                          <span className="tabular-nums">
                            {m.width}×{m.height}
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              );
            }}
          />
        )}
        {rows.length > 0 && !hasPackshot && firstImage >= 0 ? <Warning>Kartlarda beyaz zeminli bir “Ürün çekimi” görseli daha şık durur.</Warning> : null}
        <p className="text-xs text-text-muted">
          Yeni görselleri buradan yükleyebilir; videoları, kırpmayı ve klasörleri{" "}
          <Link href="/panel/medya" className={cn("rounded font-medium text-text underline underline-offset-4", focusRingClass)}>
            Medya kütüphanesinden
          </Link>{" "}
          yönetebilirsiniz. Ürüne en fazla {MAX_PRODUCT_VIDEOS} video eklenebilir; her videonun bir kapak görseli olmalı.
        </p>
      </Section>
      <MediaPickerDialog
        open={picking !== null}
        onClose={() => setPicking(null)}
        multiple
        kind={picking ?? "image"}
        max={Math.max(1, picking === "video" ? Math.min(videosLeft, MAX_ROWS - rows.length) : MAX_ROWS - rows.length)}
        excludeIds={rows.map((r) => r.mediaId)}
        folder="urunler"
        title={picking === "video" ? "Ürüne video ekle" : "Ürüne görsel ekle"}
        onSelect={(items) => {
          setPicking(null);
          media.add(items);
          const fresh = items.filter((m) => !rows.some((r) => r.mediaId === m.id));
          let images = rows.filter((r) => !isVideoRow(r)).length;
          setField("media", [
            ...rows,
            ...fresh.map((m): ProductMediaState => {
              const video = isVideoMedia(m);
              // The very first image becomes the card image ("Ürün çekimi"); videos are always gallery rows.
              const role: ProductMediaRole = !video && images === 0 ? "packshot" : "gallery";
              if (!video) images += 1;
              return { key: newKey(), id: null, mediaId: m.id, role, variantKey: null, autoplay: false };
            }),
          ]);
        }}
      />
      {altFor ? (
        <AltDialog
          media={altFor}
          onClose={() => setAltFor(null)}
          onSaved={(m) => {
            media.add([m]);
          }}
        />
      ) : null}
    </div>
  );
}
