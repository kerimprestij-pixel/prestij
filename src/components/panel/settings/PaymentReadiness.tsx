// /panel/ayarlar/odeme: card provider readiness (server component). Shows only whether each environment
// variable is set, never a value; the URLs to give the providers; what the client must do to go live; when a
// payment method is on while a sales contract is still a draft, that the checkout takes no orders; and refused PayTR
// notifications of the last 72 hours (PayTR-fix IMPL-A2, src/lib/payments/alerts.ts).
// PayTR-fix IMPL-B (C9, S8, C1, C11, C12): the PayTR steps use PayTR's current page names and order: keys under
// Destek & Kurulum > Entegrasyon Bilgileri (formerly "Bilgi", still so in PayTR's English FAQ; PayTR documents no user
// roles for it: PayTR-fix R-UX4); the Bildirim URL exactly as shown, protocol HTTPS, never a *.vercel.app
// address; test payment, then "Evet, Entegrasyonu Tamamladım", then "Canlı Moda Geçiş Talebi Gönder", then PayTR's
// SMS or e-mail, only then test mode off, then one small real payment and its refund (010 on the first day is not a
// site bug); no PayTR Havale/EFT product and no interim notification URL.
import Link from "next/link";
import { CircleCheck, CircleDashed, ExternalLink, TriangleAlert } from "lucide-react";
import CopyButton from "@/components/panel/orders/CopyButton";
import StatusBadge from "@/components/panel/StatusBadge";
import { formatNumber } from "@/components/panel/labels";
import type { NotifyRefusalKind, NotifyRefusalSummary } from "@/lib/payments/alerts";
import { formatIstanbul } from "@/lib/panel/format";
import type { PaymentReadiness as Readiness } from "@/lib/payments/readiness";
import { cn } from "@/lib/utils";

const PROVIDER_NAMES = { iyzico: "iyzico", paytr: "PayTR" } as const;

const ENDPOINT_LABEL = {
  sandbox: "Test ortamı (sandbox)",
  live: "Canlı ortam",
  local: "Yerel test sunucusu (payment-mock)",
  custom: "Özel adres",
} as const;

function Section({ title, description, children, className }: { title: string; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]", className)}>
      <header className="border-b border-border px-5 py-4 sm:px-6">
        <h3 className="text-[0.9375rem] font-semibold text-text">{title}</h3>
        {description ? <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{description}</p> : null}
      </header>
      <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

function Banner({ tone, children }: { tone: "success" | "warning" | "neutral"; children: React.ReactNode }) {
  const Icon = tone === "success" ? CircleCheck : tone === "neutral" ? CircleDashed : TriangleAlert;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm leading-relaxed text-text",
        tone === "success" ? "border-[#2F8F5B]/30 bg-[#2F8F5B]/10" : tone === "neutral" ? "border-border bg-surface-2" : "border-[#D68A12]/35 bg-[#D68A12]/10",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "success" ? "text-[#2F8F5B] dark:text-[#5CC08A]" : tone === "neutral" ? "text-text-muted" : "text-[#B5730C] dark:text-[#E9B45C]",
        )}
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const REFUSAL_REASONS: Record<NotifyRefusalKind, string> = {
  bad_hash: "imza (hash) tutmadı: sunucudaki PAYTR_MERCHANT_KEY ve PAYTR_MERCHANT_SALT, bildirimi gönderen PayTR mağazasının bilgileriyle aynı olmalı",
  missing_fields: "eksik alanlar (imza ya da tutar yok)",
  not_configured: "PayTR anahtarları bu sunucuda tanımlı değil",
};

/** "PayTR bildirimleri reddediliyor" (the dashboard to-do says the same). */
function NotifyRefusalBanner({ summary }: { summary: NotifyRefusalSummary }) {
  return (
    <Banner tone="warning">
      <strong>PayTR bildirimleri reddediliyor: Bildirim URL&rsquo;sini ve anahtarları kontrol edin.</strong> Son {summary.windowHours} saatte{" "}
      {formatNumber(summary.count)} kez reddedildi; son: {formatIstanbul(summary.lastAt)}. Neden: {summary.kinds.map((k) => REFUSAL_REASONS[k]).join("; ")}.
      {summary.merchantOid ? (
        <>
          {" "}
          Son bildirimin PayTR sipariş no&rsquo;su:{" "}
          <code className="font-mono text-xs" dir="ltr">
            {summary.merchantOid}
          </code>
          .
        </>
      ) : null}{" "}
      Yalnızca sitedeki bir ödeme denemesinin PayTR sipariş no&rsquo;sunu taşıyan bildirimler sayılır. Reddedilen bildirimlerin ödemeleri
      siparişlere işlenmez. Sorunu giderdikten sonra PayTR Mağaza Paneli&rsquo;nde <strong className="font-medium">Mağaza Bildirimleri</strong>{" "}
      sayfasından duran bildirimleri yeniden başlatın. Uyarı, son reddedilen bildirimden {summary.windowHours} saat sonra kendiliğinden kalkar;
      bu numarayı bilen biri sahte bildirim gönderdiğinde de görünebilir (o durumda siparişler etkilenmez).
    </Banner>
  );
}

/** A *.vercel.app address: temporary, may sit behind Vercel's protection, and is not the shop's domain. */
export function isVercelAppUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "vercel.app" || host.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function UrlRow({ label, url, help }: { label: string; url: string; help: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-2/50 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text">{label}</p>
        <CopyButton text={url} label="Kopyala" srLabel={`${label}: kopyala`} />
      </div>
      <p className="mt-1.5 break-all font-mono text-xs text-text" dir="ltr">
        {url}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{help}</p>
    </div>
  );
}

export default function PaymentReadiness({ readiness }: { readiness: Readiness }) {
  const r = readiness;
  const selectedName = PROVIDER_NAMES[r.selected];
  return (
    <div className="space-y-6">
      {r.checkoutClosedByContracts ? (
        <Banner tone="warning">
          <strong>Ödeme sayfası şu an sipariş almıyor.</strong> Bir ödeme yöntemi açık, ancak Ön Bilgilendirme Formu veya Mesafeli Satış Sözleşmesi
          yürürlükte değil ya da sürüm adı “taslak” ile başlıyor; site bu metinleri taslak sayar ve müşteriler “Online siparişler şu an kapalı”
          notunu görür. Avukat onaylı metinleri{" "}
          <Link href="/panel/yasal" className="font-medium underline decoration-border underline-offset-4 hover:decoration-gold">
            Yasal Metinler
          </Link>
          &rsquo;de taslak uyarısını kapatıp “taslak” ile başlamayan bir sürüm adıyla (ör. “2026-11 v1”) yayınlayın.
        </Banner>
      ) : null}
      <Section
        title="Kart ödeme altyapısı"
        description="Ödeme kuruluşu anahtarları sunucuda ortam değişkeni olarak tutulur; panelde yalnızca tanımlı olup olmadıkları görünür."
      >
        {r.simulator ? (
          <Banner tone="warning">
            Bu sunucuda <strong>ödeme simülatörü</strong> açık (PAYMENT_SIMULATOR=true): kart ödemeleri yerel test ekranına gider, iyzico ve PayTR
            kullanılmaz. Canlı sunucuda bu değişken tanımlanmamalıdır.
          </Banner>
        ) : !r.cardEnabled ? (
          <Banner tone="neutral">
            <strong>Kartla ödeme kapalı.</strong> Müşteriler kart seçeneğini görmez. Seçili kuruluş: {selectedName}
            {r.active ? " (anahtarlar hazır)" : " (anahtarlar henüz tanımlı değil)"}. Açmak için aşağıdaki ödeme ayarlarında “Kartla ödeme”yi
            açıp kaydedin.
          </Banner>
        ) : r.active ? (
          <Banner tone="success">
            Yeni kart ödemeleri <strong>{PROVIDER_NAMES[r.active as keyof typeof PROVIDER_NAMES]}</strong> üzerinden alınıyor
            {r.testMode ? " — test modu açık, gerçek para çekilmez." : " — canlı mod: gerçek ödemeler alınır."}
            {r.testModeStaffOnly
              ? " Test modu açıkken kartla ödeme yalnızca panele giriş yapmış ekip üyelerine görünür; müşteriler kart seçeneğini kullanılamıyor olarak görür. Test ödemeleri siparişte kırmızı “TEST ÖDEMESİ – para çekilmedi” etiketiyle işaretlenir."
              : null}
          </Banner>
        ) : (
          <Banner tone="warning">
            Seçili ödeme kuruluşu ({selectedName}) için anahtarlar tanımlı değil. Kart seçeneği ödeme sayfasında “kullanılamıyor” olarak görünür;
            müşteriler havale veya kapıda ödeme ile sipariş verebilir.
          </Banner>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {r.providers.map((p) => {
            const selected = p.provider === r.selected;
            return (
              <div key={p.provider} className={cn("min-w-0 rounded-lg border px-4 py-4", selected ? "border-gold/50 bg-gold/5" : "border-border")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-text">{PROVIDER_NAMES[p.provider]}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected ? <StatusBadge tone="gold">Seçili</StatusBadge> : null}
                    <StatusBadge tone={p.ready ? "success" : "warning"}>{p.ready ? "Hazır" : "Anahtar eksik"}</StatusBadge>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {p.variables.map((v) => {
                    const optional = v.name.endsWith("_BASE_URL");
                    return (
                      <li key={v.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                        <code className="break-all font-mono text-text" dir="ltr">
                          {v.name}
                        </code>
                        <span className={cn("inline-flex items-center gap-1", v.defined ? "text-[#2F8F5B] dark:text-[#5CC08A]" : "text-text-muted")}>
                          {v.defined ? <CircleCheck aria-hidden className="size-3.5" /> : <CircleDashed aria-hidden className="size-3.5" />}
                          {v.defined ? "tanımlı" : optional ? "tanımlı değil (isteğe bağlı)" : "tanımlı değil"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 border-t border-border pt-3 text-xs text-text-muted">
                  Bağlantı:{" "}
                  {p.endpoint.problem ? (
                    <span className="text-[#B5730C] dark:text-[#E9B45C]">adres geçersiz — {p.endpoint.problem}</span>
                  ) : (
                    <>
                      <span className="text-text">{ENDPOINT_LABEL[p.endpoint.kind]}</span>{" "}
                      <span className="block break-all font-mono" dir="ltr">
                        {p.endpoint.url}
                      </span>
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>

        {r.iyzicoKeyMismatch === "live_keys_in_test" ? (
          <Banner tone="warning">
            iyzico anahtarı canlı anahtara benziyor, ancak test modu açık: ödemeler iyzico test ortamına (sandbox) gider ve başarısız olur.
            Canlıya geçiyorsanız aşağıdan test modunu hemen kapatın; test yapıyorsanız sandbox anahtarlarını girin.
          </Banner>
        ) : r.iyzicoKeyMismatch === "sandbox_keys_live" ? (
          <Banner tone="warning">
            iyzico anahtarı bir test (sandbox) anahtarı, ancak test modu kapalı: ödemeler canlı ortama gider ve başarısız olur. Canlı anahtarları girin
            ya da test modunu yeniden açın.
          </Banner>
        ) : null}
        {r.urls.siteOriginProblem ? <Banner tone="warning">{r.urls.siteOriginProblem} (NEXT_PUBLIC_SITE_URL: {r.urls.siteOrigin})</Banner> : null}
        {r.notifyRefusals ? <NotifyRefusalBanner summary={r.notifyRefusals} /> : null}
        {isVercelAppUrl(r.urls.paytrNotify) ? (
          <Banner tone="warning">
            <strong>Bu adresi PayTR&rsquo;ye girmeyin.</strong> Site şu an geçici bir <span dir="ltr">vercel.app</span> adresiyle çalışıyor.
            Önce NEXT_PUBLIC_SITE_URL değerini sitenin asıl adresi (<span dir="ltr">https://www.alanadınız</span>) yapın ve siteyi yeniden
            yayınlayın. Sonra buradaki adresi kopyalayın.
          </Banner>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <UrlRow
            label="iyzico geri dönüş adresi"
            url={r.urls.iyzicoCallback}
            help="Her ödemede iyzico'ya otomatik gönderilir; iyzico panelinde ayrıca tanımlamanız gerekmez."
          />
          <UrlRow
            label="PayTR bildirim URL'si"
            url={r.urls.paytrNotify}
            help={
              <>
                PayTR Mağaza Paneli › Destek &amp; Kurulum › Ayarlar › <strong className="font-medium text-text">Bildirim URL Ayarları</strong>{" "}
                bölümüne bu adresi aynen yapıştırın. Protokolü <strong className="font-medium text-text">HTTPS</strong> seçin. Sonuna “/” eklemeyin,
                başka bir adres (ör. <span dir="ltr">vercel.app</span> adresi) yazmayın. PayTR ödeme sonucunu bu adrese bildirir; adres yanlışsa
                siparişler ödendi olarak işaretlenmez. Alan adı değişirse bu ayarı da güncelleyin.
              </>
            }
          />
        </div>
      </Section>

      <Section title="Canlıya geçiş" description="Gerçek kart ödemesi almaya başlamak için sırasıyla yapılacaklar.">
        <ol className="list-decimal space-y-3 ps-5 text-sm leading-relaxed text-text marker:font-medium marker:text-gold-text">
          <li>
            Seçtiğiniz kuruluşla (iyzico veya PayTR) <strong className="font-medium">üye işyeri başvurusunu</strong> tamamlayın. Kuruluş şirket
            evraklarını ve sitedeki yasal metinleri (mesafeli satış sözleşmesi, ön bilgilendirme formu, KVKK, iade koşulları) kontrol eder. PayTR
            formunda ürün olarak <strong className="font-medium">Sanal POS</strong>, şirket türü olarak <strong className="font-medium">Limited Şirket</strong>{" "}
            seçin; web sitesine <span dir="ltr">https://www.alanadınız</span> yazın. Temsilciye “kendi yazılımımız, iFrame API” deyin.
          </li>
          <li>
            Önce <strong className="font-medium">test için API bilgilerini</strong> alın: iyzico&rsquo;da test ortamı (sandbox) hesabındaki API anahtarı ve
            güvenlik anahtarı (“sandbox-” ile başlar); PayTR&rsquo;da Mağaza Paneli › Destek &amp; Kurulum ›{" "}
            <strong className="font-medium">Entegrasyon Bilgileri</strong> (eski adı: Bilgi) sayfasındaki mağaza no, mağaza parola (key) ve mağaza gizli
            anahtar (salt). Bu sayfayı göremiyorsanız mağazanın ana kullanıcısıyla girin ya da PayTR&rsquo;ye sorun. PayTR test ve canlı için aynı
            bilgileri kullanır.
          </li>
          <li>
            Bu bilgileri sitenin barındırıldığı paneldeki <strong className="font-medium">ortam değişkenlerine</strong> girin (iyzico:{" "}
            <code className="font-mono text-xs" dir="ltr">IYZICO_API_KEY</code>, <code className="font-mono text-xs" dir="ltr">IYZICO_SECRET_KEY</code>;
            PayTR: <code className="font-mono text-xs" dir="ltr">PAYTR_MERCHANT_ID</code>, <code className="font-mono text-xs" dir="ltr">PAYTR_MERCHANT_KEY</code>,{" "}
            <code className="font-mono text-xs" dir="ltr">PAYTR_MERCHANT_SALT</code>) ve siteyi yeniden yayınlayın. Anahtarları e-posta veya mesajla
            paylaşmayın; bu panele de yazılmaz.
          </li>
          <li>
            PayTR kullanacaksanız yukarıdaki bildirim URL&rsquo;sini PayTR paneline girin (protokol HTTPS). PayTR&rsquo;nin{" "}
            <strong className="font-medium">Havale/EFT</strong> ürününü açmayın ve ara bildirim adresi tanımlamayın: site yalnızca kart
            bildirimlerini işler. Havaleyi sitenin kendi Havale / EFT yöntemiyle alın. iyzico için ek adres gerekmez.
          </li>
          <li>
            Canlı sunucuda <code className="font-mono text-xs" dir="ltr">PAYMENT_SIMULATOR</code>,{" "}
            <code className="font-mono text-xs" dir="ltr">IYZICO_BASE_URL</code> ve <code className="font-mono text-xs" dir="ltr">PAYTR_BASE_URL</code>{" "}
            tanımlı olmamalıdır.
          </li>
          <li>
            <strong className="font-medium">Test modu</strong> açıkken (varsayılan) kuruluşun test kartlarıyla bir ödeme yapın. Siparişin “Ödendi”
            olduğunu görün, sonra sipariş sayfasından “Kart iadesi yap” ile iade edin.
          </li>
          <li>
            Canlıya geçiş: <strong className="font-medium">iyzico</strong> kullanıyorsanız üye işyeri panelinden canlı API anahtarlarını alın, ortam
            değişkenlerindeki sandbox anahtarlarının yerine yazıp siteyi yeniden yayınlayın ve <strong className="font-medium">hemen ardından</strong>{" "}
            aşağıdan test modunu kapatıp kaydedin. Canlı anahtarlar test modunda, sandbox anahtarları canlı modda çalışmaz; aradaki sürede kart ödemeleri
            başarısız olur, bu yüzden iki adımı art arda yapın. <strong className="font-medium">PayTR</strong>&rsquo;da anahtarlar aynı kalır. Canlı
            moda PayTR&rsquo;nin onayıyla geçilir, sıra şöyle:
            <ol className="mt-2 list-[lower-alpha] space-y-1.5 ps-5 marker:text-text-muted">
              <li>
                Test ödemesi sitede “Ödendi” görününce (bildirim URL&rsquo;si çalışıyor demektir) PayTR Mağaza Paneli › Destek &amp; Kurulum ›{" "}
                <strong className="font-medium">Canlı Mod</strong> sayfasında “Evet, Entegrasyonu Tamamladım”a basın.
              </li>
              <li>Test kontrolü başarılı olunca aynı sayfada “Canlı Moda Geçiş Talebi Gönder”e basın.</li>
              <li>PayTR talebi inceler ve SMS ve e-postayla haber verir. Bu haberi bekleyin.</li>
              <li>
                Haber gelince aşağıdan <strong className="font-medium">test modunu kapatıp kaydedin</strong>. Daha önce kapatmayın: müşteriler kart
                seçeneğini görür ama ödeme yapamaz.
              </li>
            </ol>
            PayTR test modundayken gelen ödemeler gerçek değildir: siparişte “TEST ÖDEMESİ” olarak işaretlenir. Test modunu kapattıktan sonra PayTR bir
            ödemeyi test ödemesi olarak bildirirse sipariş ödendi sayılmaz ve ana panelde uyarı çıkar.
          </li>
          <li>
            Son kontrol: küçük tutarlı gerçek bir sipariş verin, sonra sipariş sayfasındaki “Kart iadesi yap” ile iade edin. İlk gün iade “PayTR
            010” (bakiye yetersiz) hatası verebilir. Bu bir site hatası değildir: iadeyi ertesi gün yeniden deneyin ya da PayTR&rsquo;ye sorun.
          </li>
        </ol>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
          <ExternalLink aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            Teknik dokümanlar: <span dir="ltr">docs.iyzico.com</span> ve <span dir="ltr">dev.paytr.com</span>. Taksit seçenekleri kart ve banka
            anlaşmalarına göre kuruluşun ödeme sayfasında gösterilir.
          </span>
        </p>
      </Section>
    </div>
  );
}
