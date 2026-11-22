"use client";
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, FileWarning, ListChecks, Send, ShoppingBag } from "lucide-react";
import { publishLegalVersionAction } from "@/app/panel/(dashboard)/yasal/actions";
import Field from "@/components/panel/form/Field";
import { LocalizedInput } from "@/components/panel/form/LocalizedInput";
import LocalizedRichText from "@/components/panel/form/LocalizedRichText";
import SaveBar from "@/components/panel/form/SaveBar";
import Switch from "@/components/panel/form/Switch";
import TextInput from "@/components/panel/form/TextInput";
import usePanelForm from "@/components/panel/form/usePanelForm";
import { useConfirm } from "@/components/panel/ui/ConfirmDialog";
import type { LocalizedText } from "@/db/schema/common";
import { formatIstanbul } from "@/lib/panel/format";
import type { LegalPublishData, LegalVersionSummary } from "@/lib/panel/legal/service";
import { isDraftLegalVersion } from "@/lib/panel/legal/draft";
import { findMissingFields } from "@/lib/panel/legal/schemas";
import LegalHistory from "./LegalHistory";

export type LegalEditorState = {
  key: string;
  /** The current version the edit starts from (optimistic lock: id + updatedAt). */
  baseId: number | null;
  baseUpdatedAt: string | null;
  /** Label of the version this publish creates. */
  version: string;
  title: LocalizedText;
  showNotice: boolean;
  /** Draft notice HTML per locale (stored as <aside class="legal-draft"> before the body). */
  notice: LocalizedText;
  body: LocalizedText;
};

export type LegalPageLink = { slug: string; title: string; href: string; isPublished: boolean };

const cardClass = "min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]";

function Card({ title, description, icon: Icon, aside, children }: { title: string; description?: React.ReactNode; icon?: typeof Send; aside?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className={cardClass}>
      <header className={children ? "flex items-start gap-3 border-b border-border px-5 py-4" : "flex items-start gap-3 px-5 py-4"}>
        {Icon ? <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text" /> : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-semibold text-text">{title}</h2>
          {description ? <div className="mt-1 text-xs leading-relaxed text-text-muted">{description}</div> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>
      {children ? <div className="space-y-5 px-5 py-5">{children}</div> : null}
    </section>
  );
}

/** What the checkout prepends to this text on its own (src/lib/orders/legal-render.ts orderBlock). */
const AUTO_BLOCK = [
  { label: "Satıcı bilgileri", detail: "unvan, adres, telefon, e-posta, KEP, MERSİS ve vergi bilgileri", href: "/panel/ayarlar/genel" },
  { label: "Alıcı, teslimat ve fatura bilgileri", detail: "ödeme formunda girilenler" },
  { label: "Ürünler, adet ve fiyatlar", detail: "KDV dahil birim ve satır tutarı" },
  { label: "Tutarlar", detail: "ara toplam, indirimler, kargo, ödeme ücreti, KDV, genel toplam" },
  { label: "Ödeme yöntemi ve sipariş tarihi" },
  { label: "Kargoya verme süresi", href: "/panel/ayarlar/kargo" },
  { label: "Cayma hakkı özeti" },
];

/** What a "taslak…" version label means for this text (warning under the label and in the publish dialog). */
const DRAFT_LABEL_EFFECT = {
  checkout: "Sürüm adı “taslak” ile başladığı için bu metin taslak sayılır: ödeme sayfası kapalı kalır ve sipariş alınamaz.",
  wheel: "Sürüm adı “taslak” ile başladığı için kampanya koşulları onaylı sayılmaz; SEO Kontrol'deki avukat onayı adımı açık kalır.",
} as const;

export type LegalDraftEffect = keyof typeof DRAFT_LABEL_EFFECT;

export default function LegalEditor({
  initial,
  title,
  checkout,
  draftEffect,
  suggestions,
  current,
  versions,
  pages,
}: {
  initial: LegalEditorState;
  /** Turkish title of the document (for messages). */
  title: string;
  checkout: boolean;
  /** What a "taslak…" label blocks for this key (null: nothing, only a name). */
  draftEffect: LegalDraftEffect | null;
  /** Suggested labels for the next publish: `draft` while the draft notice is on, `approved` once it is off. */
  suggestions: { approved: string; draft: string };
  current: { version: string; createdAt: string } | null;
  versions: LegalVersionSummary[];
  pages: LegalPageLink[];
}) {
  const form = usePanelForm<LegalEditorState>(initial);
  const { formRef, state, setField, errorFor, localizedError, dirty, pending, errors, reset, submit } = form;
  const { confirm, confirmDialog } = useConfirm();
  const [suggested, setSuggested] = useState(suggestions);
  const missing = findMissingFields(state.body.tr, state.showNotice ? state.notice.tr : "");
  const where = [checkout ? "ödeme sayfası" : null, pages.length ? "sitedeki sayfa" : null].filter(Boolean).join(" ve ");
  const draftLabel = isDraftLegalVersion(state.version);
  const draftWarning = draftEffect && draftLabel ? DRAFT_LABEL_EFFECT[draftEffect] : null;
  // A non-draft label with the draft notice still on: the site would treat a text marked as a draft as approved.
  const approvedWhileNotice = draftEffect === "checkout" && !draftLabel && state.showNotice && state.version.trim() !== "";

  // The label follows the draft notice while it is still one of the two suggestions (never overwrites a typed label).
  const toggleNotice = (on: boolean) => {
    setField("showNotice", on);
    const label = state.version.trim();
    if (label === suggested.approved || label === suggested.draft) setField("version", on ? suggested.draft : suggested.approved);
  };

  const publish = async () => {
    const ok = await confirm({
      title: `“${state.version.trim() || "Yeni sürüm"}” yayınlansın mı?`,
      description: `${where ? `${where.charAt(0).toLocaleUpperCase("tr")}${where.slice(1)} hemen bu sürümü gösterir. ` : ""}Önceki siparişler, onaylandıkları sürümün kopyasını korur.${draftWarning ? ` ${draftWarning}` : ""}`,
      confirmLabel: "Yayınla",
      tone: "default",
    });
    if (!ok) return;
    await submit<LegalPublishData>(publishLegalVersionAction, {
      resetTo: (sent, data) => {
        if (!data) return sent;
        setSuggested({ approved: data.nextVersion, draft: data.nextDraftVersion });
        return { ...sent, baseId: data.id, baseUpdatedAt: data.updatedAt, version: sent.showNotice ? data.nextDraftVersion : data.nextVersion };
      },
    });
  };

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate className="grid gap-6 pb-28 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
      <div className="min-w-0 space-y-6">
        <Card title="Başlık ve metin" description="Metindeki köşeli parantezli yerler ([e-posta adresi] gibi) henüz doldurulmamış bilgileri gösterir.">
          <LocalizedInput
            label="Başlık"
            required
            name="title"
            value={state.title}
            onChange={(v) => setField("title", v)}
            error={localizedError("title")}
            maxLength={160}
            help={pages.length ? "Sitedeki sayfanın başlığı da (sayfa düzenleyicide değiştirilmediyse) bununla birlikte güncellenir." : undefined}
          />
          <LocalizedRichText
            label="Metin"
            required
            name="body"
            value={state.body}
            onChange={(v) => setField("body", v)}
            error={localizedError("body")}
            minHeight={26}
            help="Türkçe metin bağlayıcıdır. İngilizce veya Arapça metin girerseniz o dildeki ziyaretçiye çeviri gösterilir; ödeme sayfasında çevirinin ardından bağlayıcı Türkçe metin de yer alır."
          />
        </Card>

        <Card
          title="Taslak uyarısı"
          icon={FileWarning}
          description={
            checkout
              ? "Sitedeki sayfada metnin üstünde vurgulu bir not olarak, ödeme sayfasındaki metinde ise metnin başında düz bir paragraf olarak yer alır. Hukukçu onayından sonra kapatın."
              : "Sitedeki sayfada metnin üstünde vurgulu bir not olarak görünür. Hukukçu onayından sonra kapatın."
          }
          aside={<Switch checked={state.showNotice} onChange={toggleNotice} label={<span className="sr-only">Taslak uyarısını göster</span>} />}
        >
          {state.showNotice ? (
            <LocalizedRichText
              label="Uyarı metni"
              required
              name="notice"
              value={state.notice}
              onChange={(v) => setField("notice", v)}
              error={localizedError("notice")}
              minHeight={5}
            />
          ) : null}
        </Card>
      </div>

      <aside className="min-w-0 space-y-6">
        <Card
          title="Yayın"
          icon={Send}
          description={
            current ? (
              <>
                Yürürlükteki sürüm <strong className="font-medium text-text">{current.version}</strong>, {formatIstanbul(current.createdAt)}.
              </>
            ) : (
              "Bu metnin yürürlükte bir sürümü yok."
            )
          }
        >
          <Field
            label="Yeni sürüm adı"
            required
            name="version"
            error={errorFor("version")}
            help={
              draftEffect
                ? "Müşterinin onayladığı sürüm olarak siparişe kaydedilir. Her ad bir kez kullanılır. “taslak” ile başlayan bir ad metni taslak olarak işaretler; avukat onaylı metinde kullanmayın."
                : "Müşterinin onayladığı sürüm olarak siparişe kaydedilir. Her ad bir kez kullanılır."
            }
          >
            <TextInput value={state.version} onChange={(v) => setField("version", v)} maxLength={40} />
          </Field>
          {draftWarning ? (
            <p role="status" className="rounded-lg border border-[#D68A12]/35 bg-[#D68A12]/10 px-3 py-2.5 text-xs leading-relaxed text-text">
              {draftWarning} Avukat onaylı metni taslak uyarısını kapatıp “taslak” ile başlamayan bir adla yayınlayın (ör. “{suggested.approved}”).
            </p>
          ) : approvedWhileNotice ? (
            <p role="status" className="rounded-lg border border-[#D68A12]/35 bg-[#D68A12]/10 px-3 py-2.5 text-xs leading-relaxed text-text">
              Taslak uyarısı açık, ama sürüm adı “taslak” ile başlamıyor: ödeme sayfası bu metni onaylı sayar. Metin henüz onaylı değilse “
              {suggested.draft}” gibi bir ad kullanın; onaylıysa taslak uyarısını kapatın.
            </p>
          ) : null}
          <p className="text-xs leading-relaxed text-text-muted">
            Düzenlemeyi bitirince alttaki <strong className="font-medium text-text">Yeni sürüm olarak yayınla</strong> düğmesine basın. Eski sürüm
            geçmişte kalır.
          </p>
        </Card>

        <Card title="Nerede görünür" icon={ExternalLink}>
          <ul className="space-y-3 text-sm">
            {checkout ? (
              <li className="flex items-start gap-2.5">
                <ShoppingBag aria-hidden className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <span>
                  <span className="font-medium text-text">Ödeme sayfası</span>
                  <span className="block text-xs text-text-muted">Sipariş onayından önce okunur ve onaylanan metin siparişle birlikte saklanır.</span>
                </span>
              </li>
            ) : null}
            {pages.map((page) => (
              <li key={page.slug} className="flex items-start gap-2.5">
                <ExternalLink aria-hidden className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <span className="min-w-0">
                  <a
                    href={page.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-text underline decoration-border underline-offset-4 hover:decoration-gold"
                  >
                    /sayfa/{page.slug}
                    <span className="sr-only"> (yeni sekmede açılır)</span>
                  </a>
                  <span className="block text-xs text-text-muted">{page.isPublished ? "Sitedeki yasal sayfa" : "Sayfa yayında değil"}</span>
                </span>
              </li>
            ))}
            {!checkout && pages.length === 0 ? <li className="text-xs text-text-muted">Bu metin şu an hiçbir sayfada gösterilmiyor.</li> : null}
          </ul>
        </Card>

        {checkout ? (
          <Card
            title="Otomatik eklenen bölüm"
            icon={ListChecks}
            description="Ödeme sayfası bu metnin üstüne siparişe özel bir bölüm ekler. Aşağıdakileri metne yazmanız gerekmez; metinde yer tutucu da yoktur."
          >
            <ul className="space-y-2 text-sm">
              {AUTO_BLOCK.map((item) => (
                <li key={item.label} className="flex items-start gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-gold" />
                  <span className="min-w-0">
                    {item.href ? (
                      <Link href={item.href} className="text-text underline decoration-border underline-offset-4 hover:decoration-gold">
                        {item.label}
                      </Link>
                    ) : (
                      <span className="text-text">{item.label}</span>
                    )}
                    {item.detail ? <span className="block text-xs text-text-muted">{item.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {missing.length > 0 ? (
          <Card
            title={`Doldurulacak yerler (${missing.length})`}
            icon={FileWarning}
            description="Türkçe metinde köşeli parantezle bırakılmış bilgiler. Yayından önce gerçek bilgilerle değiştirin."
          >
            <ul className="flex flex-wrap gap-1.5">
              {missing.map((label) => (
                <li key={label} className="rounded-md border border-[#D68A12]/35 bg-[#D68A12]/10 px-2 py-1 text-xs text-text">
                  [{label}]
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <LegalHistory
          versions={versions}
          docKey={state.key}
          base={{ id: state.baseId, updatedAt: state.baseUpdatedAt }}
          suggestion={state.version}
          restoreBlocked={dirty}
          checkout={checkout}
        />
      </aside>

      <SaveBar
        dirty={dirty}
        pending={pending}
        errorCount={Object.keys(errors).length}
        onReset={() => reset()}
        onSave={() => void publish()}
        saveLabel="Yeni sürüm olarak yayınla"
        pendingLabel="Yayınlanıyor…"
        savedNote={`${title}: değişiklik yok.`}
        className="xl:col-span-2"
      />
      {confirmDialog}
    </form>
  );
}
