"use client";
// The product editor: one form with the whole product (tabs), saved by one action locked by the
// product's updatedAt. The server returns the fresh state (new rows get their ids) and the form adopts it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Copy, ExternalLink, Trash2 } from "lucide-react";
import {
  deleteProductAction,
  duplicateProductAction,
  saveProductAction,
  setProductStatusAction,
} from "@/app/panel/(dashboard)/urunler/actions";
import SaveBar from "@/components/panel/form/SaveBar";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { PRODUCT_STATUS, PRODUCT_TYPE } from "@/components/panel/labels";
import ProductThumb from "@/components/panel/ProductThumb";
import StatusBadge from "@/components/panel/StatusBadge";
import Button from "@/components/panel/ui/Button";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import { buttonClass } from "@/components/panel/ui/styles";
import Tabs from "@/components/panel/ui/Tabs";
import { toast } from "@/components/panel/ui/toast-store";
import { href } from "@/i18n/paths";
import { isVideoMedia, type MediaLike } from "@/lib/media/types";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { productSaveSchema } from "@/lib/panel/products/schema";
import type { ProductEditorContext, ProductEditorState } from "@/lib/panel/products/types";
import AppearanceTab from "./editor/AppearanceTab";
import BundleTab from "./editor/BundleTab";
import ContentTab from "./editor/ContentTab";
import GeneralTab from "./editor/GeneralTab";
import MediaTab from "./editor/MediaTab";
import PricingTab from "./editor/PricingTab";
import RelatedTab from "./editor/RelatedTab";
import SeoTab from "./editor/SeoTab";
import type { MediaLookup } from "./editor/shared";
import VariantsTab from "./editor/VariantsTab";

/** Which top-level state keys live in which tab (error markers, jump to the first invalid tab). */
const TAB_FIELDS: Record<string, string[]> = {
  genel: ["name", "subtitle", "shortDescription", "description", "categoryId", "type", "status", "isFeatured", "businessOnly", "allowSubscription"],
  gorunum: ["accentColor", "tint", "tintDark"],
  icerik: ["scentTop", "scentHeart", "scentBase", "usage", "warnings", "ingredients", "claims", "specs"],
  gorseller: ["media"],
  varyantlar: ["options", "variants"],
  fiyat: ["tiers", "groupPrices"],
  set: ["bundleItems"],
  iliskili: ["relatedIds"],
  seo: ["seo", "slug"],
};
const TAB_ORDER = Object.keys(TAB_FIELDS);

function tabOf(path: string): string | undefined {
  const head = path.split(".")[0];
  return TAB_ORDER.find((t) => TAB_FIELDS[t].includes(head));
}

export default function ProductEditor({ initial, context }: { initial: ProductEditorState; context: ProductEditorContext }) {
  const router = useRouter();
  const form = usePanelForm(initial);
  const { formRef } = form;
  const { state } = form;
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState("genel");
  const [busy, setBusy] = useState<null | "duplicate" | "archive" | "delete">(null);

  // Media objects for every id the editor shows (server-preloaded, plus anything picked/uploaded here).
  const [extraMedia, setExtraMedia] = useState<Map<number, MediaLike>>(() => new Map());
  const media: MediaLookup = {
    get: (id) => (id ? (extraMedia.get(id) ?? context.media.find((m) => m.id === id)) : undefined),
    add: (items) =>
      setExtraMedia((prev) => {
        const next = new Map(prev);
        for (const m of items) next.set(m.id, m);
        return next;
      }),
  };

  const hasTabErrors = (t: string) => TAB_FIELDS[t].some((key) => form.hasErrors(key));
  const save = () =>
    form.submit(saveProductAction, {
      validate: productSaveSchema,
      resetTo: (sent, data) => data?.state ?? sent,
      onError: (result) => {
        const paths = Object.keys(result.fieldErrors ?? {});
        if (paths.length === 0) return;
        if (paths.some((p) => tabOf(p) === tab)) return;
        const target = TAB_ORDER.find((t) => paths.some((p) => tabOf(p) === t));
        if (target) setTab(target);
      },
    });

  const saved = form.saved;
  const name = saved.name.tr || "Adsız ürün";
  const status = PRODUCT_STATUS[saved.status];
  // The first image row (day 6: never a video), else the default variant's image.
  const firstImageRow = saved.media.find((r) => !isVideoMedia(media.get(r.mediaId)));
  const cover = media.get(firstImageRow?.mediaId ?? saved.variants.find((v) => v.isDefault)?.imageId) ?? null;
  const storeLink = saved.status === "active" && saved.type !== "sample" ? href("tr", "product", { slug: saved.slug }) : null;

  async function duplicate() {
    if (form.dirty) return toast.info("Önce değişiklikleri kaydedin veya vazgeçin.");
    setBusy("duplicate");
    const result = await duplicateProductAction(null, toPayloadFormData({ id: saved.id }));
    setBusy(null);
    if (result.ok && result.data) {
      toast.success(result.message ?? "Kopya oluşturuldu.");
      router.push(`/panel/urunler/${result.data.id}`);
    } else if (!result.ok) toast.error(result.error);
  }

  async function archive() {
    if (form.dirty) return toast.info("Önce değişiklikleri kaydedin veya vazgeçin.");
    const ok = await confirm({
      title: `"${name}" arşivlensin mi?`,
      description: "Ürün mağazadan kalkar ve ürün sayfası açılmaz. Sipariş geçmişi korunur; istediğiniz zaman yeniden yayına alabilirsiniz.",
      confirmLabel: "Arşivle",
      tone: "default",
    });
    if (!ok) return;
    setBusy("archive");
    const result = await setProductStatusAction(null, toPayloadFormData({ ids: [saved.id], status: "archived" }));
    setBusy(null);
    if (result.ok) {
      toast.success(result.message ?? "Ürün arşivlendi.");
      router.refresh();
    } else toast.error(result.error);
  }

  async function remove() {
    const ok = await confirm({
      title: `"${name}" silinsin mi?`,
      description: "Taslak ürün, varyantları, fiyatları ve görsel bağlantılarıyla birlikte kalıcı olarak silinir. Görseller medya kütüphanesinde kalır. Bu işlem geri alınamaz.",
      confirmLabel: "Kalıcı olarak sil",
    });
    if (!ok) return;
    setBusy("delete");
    const result = await deleteProductAction(null, toPayloadFormData({ id: saved.id, updatedAt: saved.updatedAt }));
    if (result.ok) {
      toast.success(result.message ?? "Ürün silindi.");
      router.push("/panel/urunler");
      return;
    }
    setBusy(null);
    toast.error(result.error, result.code === "in_use" && saved.status !== "archived" ? { action: { label: "Arşivle", onClick: () => void archive() }, duration: 10000 } : undefined);
  }

  const tabProps = { form, ctx: context, media };
  const items = [
    { value: "genel", label: "Genel", invalid: hasTabErrors("genel"), content: <GeneralTab {...tabProps} /> },
    { value: "gorunum", label: "Görünüm", invalid: hasTabErrors("gorunum"), content: <AppearanceTab {...tabProps} /> },
    { value: "icerik", label: "İçerik", invalid: hasTabErrors("icerik"), content: <ContentTab {...tabProps} /> },
    { value: "gorseller", label: "Görseller", badge: state.media.length || undefined, invalid: hasTabErrors("gorseller"), content: <MediaTab {...tabProps} /> },
    { value: "varyantlar", label: "Seçenekler & Varyantlar", badge: state.variants.length, invalid: hasTabErrors("varyantlar"), content: <VariantsTab {...tabProps} /> },
    { value: "fiyat", label: "Fiyatlandırma", invalid: hasTabErrors("fiyat"), content: <PricingTab {...tabProps} /> },
    ...(state.type === "bundle" || state.bundleItems.length
      ? [{ value: "set", label: "Set içeriği", badge: state.bundleItems.length || undefined, invalid: hasTabErrors("set"), content: <BundleTab {...tabProps} /> }]
      : []),
    { value: "iliskili", label: "İlişkili ürünler", invalid: hasTabErrors("iliskili"), content: <RelatedTab {...tabProps} /> },
    { value: "seo", label: "SEO", invalid: hasTabErrors("seo"), content: <SeoTab {...tabProps} /> },
  ];
  const activeTab = items.some((i) => i.value === tab) ? tab : "genel";

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate className="space-y-6 pb-28">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <ProductThumb media={cover} accentColor={saved.accentColor} size={64} className="rounded-xl" />
          <div className="min-w-0">
            <p className="eyebrow">{PRODUCT_TYPE[saved.type]}</p>
            <h1 className="mt-1 truncate font-heading text-3xl font-medium text-text sm:text-4xl">{name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              {saved.isFeatured ? <StatusBadge tone="gold">Öne çıkan</StatusBadge> : null}
              {saved.businessOnly ? <StatusBadge tone="info">Yalnızca kurumsal</StatusBadge> : null}
              {context.inOrders ? <StatusBadge>Siparişlerde var</StatusBadge> : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {storeLink ? (
            <a href={storeLink} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
              Mağazada gör
              <ExternalLink aria-hidden className="size-4" />
            </a>
          ) : null}
          <Button icon={Copy} onClick={duplicate} pending={busy === "duplicate"} pendingLabel="Kopyalanıyor…">
            Kopyala
          </Button>
          {saved.status !== "archived" ? (
            <Button icon={Archive} onClick={archive} pending={busy === "archive"} pendingLabel="Arşivleniyor…">
              Arşivle
            </Button>
          ) : null}
          {saved.status === "draft" ? (
            <Button
              variant="danger-outline"
              icon={Trash2}
              onClick={remove}
              pending={busy === "delete"}
              pendingLabel="Siliniyor…"
              title={context.inOrders ? "Siparişlerde geçen ürün silinemez; arşivleyin." : undefined}
            >
              Sil
            </Button>
          ) : null}
        </div>
      </header>

      {saved.status !== "active" ? (
        <p className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm text-text-muted">
          {saved.status === "draft"
            ? "Bu ürün taslak: mağazada görünmez. Hazır olduğunda Genel sekmesinden durumu “Yayında” yapıp kaydedin."
            : "Bu ürün arşivde: mağazada görünmez, sipariş geçmişinde kalır. Yeniden satmak için durumu “Yayında” yapın."}
        </p>
      ) : null}

      <Tabs ariaLabel="Ürün bölümleri" items={items} value={activeTab} onValueChange={setTab} />

      <SaveBar
        dirty={form.dirty}
        pending={form.pending}
        errorCount={Object.keys(form.errors).length}
        onReset={() => form.reset()}
        onSave={() => void save()}
      />
      {confirmDialog}
    </form>
  );
}
