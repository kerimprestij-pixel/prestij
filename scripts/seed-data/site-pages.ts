// Content of the dedicated storefront pages /kurumsal, /numune and /iletisim (page-builder pages with
// reserved slugs, see src/lib/reserved-pages.ts), in tr / en / ar. Built only from real facts: the four
// scents, the 500 ml pump bottle and the 5 L / 20 L canisters, manufacture in Kayseri, free samples,
// invoiced (corporate) checkout, the label specs. Contact data is NOT copied here: the contact_info
// section reads it from settings. "@media:<stem>" / "@product:<slug>" are replaced with ids by the seed.
// Day 5 (CONTENT-CATALOG): keyword-led SEO texts for the three pages (no pump volume in new copy), the
// copy page of /urunler (slug "urunler": title, SEO texts and the sections below the product grid) and
// the new page /sayfa/hakkimizda. scripts/content-day5.ts adds the same to existing databases.
import type { PageKind, SeoFields } from "@/db/schema";
import type { LocalizedText } from "@/db/schema/common";
import type { FixPath, LocaleFixes } from "./content-fixes";
import type { PositionedSeedSection, SeedSection } from "./home-page";

type L = LocalizedText;
const t = (tr: string, en: string, ar: string): L => ({ tr, en, ar });
const cta = (label: L, href: string) => ({ label, href });

export type SitePageSeed = {
  /** Reserved pages, the /urunler copy page and (day 5) the about page at /sayfa/hakkimizda. */
  slug: "kurumsal" | "numune" | "iletisim" | "urunler" | "hakkimizda";
  kind: PageKind;
  title: L;
  seo: SeoFields;
  sections: PositionedSeedSection[];
};

const positioned = (sections: SeedSection[]): PositionedSeedSection[] => sections.map((s, position) => ({ ...s, position }));

// The request forms live on the pages themselves (REQUESTS, day 4): quote_form on /kurumsal (#teklif) and
// sample_request_form on /numune (#numune-formu). CTAs point at those anchors (full paths, so the same
// links also work from other pages and when shared).
const QUOTE_HREF = "/kurumsal#teklif";
const SAMPLE_HREF = "/numune#numune-formu";

const REQUEST_QUOTE = t("Teklif isteyin", "Request a quote", "اطلب عرض سعر");
const REQUEST_SAMPLES = t("Numune isteyin", "Request samples", "اطلب عيّنات");
const SAMPLES_NOT_FOR_SALE = t("Numuneler satılmaz.", "Samples are not for sale.", "العيّنات ليست للبيع.");
const FAQ_EYEBROW = t("Sıkça sorulanlar", "FAQ", "الأسئلة الشائعة");

// ---------------------------------------------------------------------------------------------
// Request forms (REQUESTS, day 4). Also inserted into live databases by scripts/content-day4.ts.

/** The quote form on /kurumsal (anchor #teklif). Empty productIds = every active product. */
export const QUOTE_FORM_SECTION: SeedSection = {
  type: "quote_form",
  content: {
    eyebrow: t("Teklif talebi", "Quote request", "طلب عرض سعر"),
    title: t("İşletmenize özel teklif alın.", "Get a quote for your business.", "احصل على عرض سعر لمنشأتك."),
    intro: t(
      "Hangi ürünlere, hangi boyda ve yaklaşık ne kadar ihtiyacınız olduğunu yazın; talebinizi inceleyip size özel fiyatlarla dönüş yapalım.",
      "Tell us which products you need, in which sizes and roughly how many; we will review your request and come back with pricing tailored to you.",
      "أخبرنا بالمنتجات التي تحتاجها وأحجامها والكميات التقريبية، وسنراجع طلبك ونعود إليك بأسعار مخصّصة لمنشأتك.",
    ),
    points: [
      t("Talebinizi ekibimiz inceler.", "Our team reviews your request.", "يراجع فريقنا طلبك."),
      t("Size özel teklifimizi e-postayla göndeririz.", "We email you a quote tailored to your business.", "نرسل إليك عرض سعر مخصّصًا عبر البريد الإلكتروني."),
      t(
        "Teklifte birim fiyatlar, toplam ve geçerlilik tarihi yer alır.",
        "The quote lists unit prices, the total and how long it is valid.",
        "يتضمّن العرض أسعار الوحدات والإجمالي ومدة الصلاحية.",
      ),
      t("Karar vermeden önce ücretsiz numune de isteyebilirsiniz.", "You can also request free samples before you decide.", "ويمكنك أيضًا طلب عيّنات مجانية قبل أن تقرّر."),
    ],
    productIds: [],
    allowCustomLines: true,
    privacyHref: "/sayfa/kvkk",
  },
};

/** The free sample form on /numune (anchor #numune-formu). Empty productIds = every active scent. */
export const SAMPLE_REQUEST_FORM_SECTION: SeedSection = {
  type: "sample_request_form",
  content: {
    eyebrow: t("Numune formu", "Sample request", "نموذج طلب العيّنات"),
    title: t("Numunelerinizi isteyin.", "Request your samples.", "اطلب عيّناتك."),
    intro: t(
      "Denemek istediğiniz kokuları seçin ve gönderim adresinizi yazın. Numuneler işletmelere ücretsiz gönderilir.",
      "Choose the scents you would like to try and tell us where to send them. Samples are sent to businesses free of charge.",
      "اختر الروائح التي ترغب في تجربتها وأخبرنا بعنوان الإرسال. تُرسَل العيّنات إلى المنشآت مجانًا.",
    ),
    points: [
      t("Talebinizi inceleyip onaylarız.", "We review and approve your request.", "نراجع طلبك ونوافق عليه."),
      t("Numunelerinizi ücretsiz kargoya veririz.", "We ship your samples free of charge.", "نشحن عيّناتك مجانًا."),
      t("Takip numarasını e-postayla göndeririz.", "We email you the tracking number.", "نرسل إليك رقم التتبّع عبر البريد الإلكتروني."),
    ],
    productIds: [],
    privacyHref: "/sayfa/kvkk",
  },
};

// ---------------------------------------------------------------------------------------------
// /kurumsal

const businessSections: SeedSection[] = [
  {
    type: "hero",
    content: {
      layout: "split",
      height: "tall",
      align: "start",
      overlay: 35,
      imageId: "@media:PRESTIJ_Lavanta_Pompali_otel_fume_cam",
      // The eyebrow is the first line of the page's <h1> (Hero): the page's keyword (docs/DAY5-SEO.md §1).
      eyebrow: t("Toptan Sıvı Sabun ve Duş Jeli", "Bulk Liquid Soap and Shower Gel", "صابون سائل وجل استحمام بالجملة"),
      // Short words on purpose: the split hero sets the headline very large in a narrow column.
      headline: t("Her misafire özenli bir dokunuş.", "A touch your guests remember.", "لمسة عناية لكل ضيف."),
      // The first paragraph names the keyword in its own words, not as a copy of the <h1> line above it.
      subline: t(
        "Oteller, spa merkezleri, ofisler ve restoranlar için doğrudan üreticisinden toptan sıvı sabun tedariki. Pompalı şişeden 20 litrelik bidona el sabunu ve duş jeli, işletmenize özel fiyatla.",
        "For hotels, spas, offices and restaurants: bulk liquid soap supplied directly by the maker. Hand soap and shower gel, from the pump bottle to the 20-litre canister, priced for your business.",
        "توريد صابون سائل بالجملة للفنادق ومراكز السبا والمكاتب والمطاعم، مباشرةً من المُصنِّع. صابون لليدين وجل استحمام من الزجاجة بالمضخة إلى عبوة 20 لترًا، بأسعار مخصّصة لمنشأتك.",
      ),
      primaryCta: cta(REQUEST_QUOTE, QUOTE_HREF),
      secondaryCta: cta(t("Ücretsiz numune", "Free samples", "عيّنات مجانية"), "/numune"),
    },
  },
  {
    type: "packaging",
    content: {
      eyebrow: t("Kimler için", "Who it is for", "لمن صُمّمت"),
      title: t("Her mekânın kendi ritüeli var.", "Every space has its own ritual.", "لكل مكان طقوسه الخاصة."),
      intro: t(
        "Lobideki lavabodan spa duşuna, ofis mutfağından restoranın misafir lavabosuna; dört koku ve üç boy, her alana uygun bir seçenek sunar.",
        "From the lobby washbasin to the spa shower, from the office kitchen to a restaurant's guest washroom: four scents and three sizes offer the right choice for every space.",
        "من مغسلة الردهة إلى دشّ السبا، ومن مطبخ المكتب إلى مغسلة ضيوف المطعم: أربعة عطور وثلاثة أحجام تقدّم الخيار المناسب لكل مساحة.",
      ),
      items: [
        {
          imageId: "@media:PRESTIJ_Okyanus_Pompali_otel_dus_nisi",
          audience: t("Oteller", "Hotels", "الفنادق"),
          title: t("Odadan lobiye tek imza", "One signature, room to lobby", "توقيع واحد من الغرفة إلى الردهة"),
          description: t(
            "Oda banyolarında pompalı şişe, kat hizmetleri için 5 L ve 20 L dolum bidonları. Okyanus duş jeli duşta, el sabunları lavabo başında.",
            "Pump bottles in guest bathrooms, 5 L and 20 L refill canisters for housekeeping. Ocean shower gel in the shower, the hand soaps at the basin.",
            "زجاجات بمضخة في حمّامات الغرف، وعبوات تعبئة سعة 5 و20 لترًا لخدمة الغرف. جل الاستحمام المحيط في الدش، وصابون اليدين عند المغسلة.",
          ),
        },
        {
          imageId: "@media:PRESTIJ_Lavanta_Pompali_spa_mat_ametist",
          audience: t("Spa ve wellness", "Spas & wellness", "السبا والعافية"),
          title: t("Sakinliği tamamlayan koku", "A scent that completes the calm", "عطر يُكمِل السكينة"),
          description: t(
            "Lavanta Latte'nin kremsi dinginliği ya da Okyanus'un serin ferahlığı; duşlarda ve soyunma alanlarında ritüelin bir parçası.",
            "The creamy calm of Lavender Latte or the cool freshness of Ocean: part of the ritual in showers and changing areas.",
            "هدوء لاتيه اللافندر الكريمي أو انتعاش المحيط البارد؛ جزء من الطقوس في الدشات وغرف تبديل الملابس.",
          ),
        },
        {
          imageId: "@media:PRESTIJ_Lavanta_Latte_Pompali_kullanim_lila_buzlu_cam",
          audience: t("Ofisler", "Offices", "المكاتب"),
          title: t("Her gün, her molada", "Every day, every break", "في كل يوم وكل استراحة"),
          description: t(
            "Yoğun kullanılan lavabolar için 5 L bidonla pratik dolum; ekibinize ve misafirlerinize gün boyu özenli bir karşılama.",
            "Easy refilling with the 5 L canister for busy washrooms, and a considered welcome for your team and visitors all day long.",
            "تعبئة عملية بعبوة 5 لترات للمغاسل كثيفة الاستخدام، واستقبال مدروس لفريقك وزوّارك طوال اليوم.",
          ),
        },
        {
          imageId: "@media:PRESTIJ_Portakal_Pompali_mutfak_krem_seramik",
          audience: t("Restoran ve kafeler", "Restaurants & cafés", "المطاعم والمقاهي"),
          title: t("Yemekten sonra ferah bir his", "A fresh feel after the meal", "إحساس منعش بعد الطعام"),
          description: t(
            "Misafir lavabosunda Portakal'ın canlı narenciye kokusu; mutfakta 5 L ve 20 L bidonlarla kesintisiz kullanım.",
            "The bright citrus of Orange at the guest washbasin, and uninterrupted use in the kitchen with 5 L and 20 L canisters.",
            "رائحة البرتقال الحمضية المنعشة عند مغسلة الضيوف، واستخدام متواصل في المطبخ بعبوات 5 و20 لترًا.",
          ),
        },
      ],
    },
  },
  {
    type: "story",
    content: {
      eyebrow: t("Ambalaj seçenekleri", "Sizes", "أحجام العبوات"),
      title: t("Yoğun kullanım için doğru boy.", "The right size for heavy use.", "الحجم المناسب للاستخدام الكثيف."),
      body: t(
        "Her koku üç boyda sunulur. 500 ml pompalı şişe lavabonun başında zarif bir obje gibi durur; 5 L ve 20 L bidonlar ise pompalı şişeleri, dispenserleri ve sabunlukları yeniden doldurmak için tasarlandı.\n\nAynı formül, aynı koku: misafiriniz odada da lobide de aynı PRESTİJ deneyimini yaşar. Tüketimin yüksek olduğu alanlarda büyük bidon, daha seyrek sipariş ve daha az ambalaj demektir.",
        "Every scent comes in three sizes. The 500 ml pump bottle sits on the basin like an elegant object, while the 5 L and 20 L canisters are made for refilling pump bottles, dispensers and soap holders.\n\nThe same formula, the same scent: your guests enjoy the same PRESTİJ experience in the room and in the lobby. Where consumption is high, the large canister means fewer orders and less packaging.",
        "يتوفّر كل عطر بثلاثة أحجام. تستقرّ زجاجة المضخة سعة 500 مل على المغسلة كقطعة أنيقة، بينما صُمّمت عبوتا 5 و20 لترًا لإعادة تعبئة زجاجات المضخة والموزّعات وحاويات الصابون.\n\nالتركيبة نفسها والعطر نفسه: يعيش ضيفك تجربة PRESTİJ ذاتها في الغرفة وفي الردهة. وحيث يرتفع الاستهلاك، تعني العبوة الكبيرة طلبات أقل وتغليفًا أقل.",
      ),
      imageId: "@media:PRESTIJ_Lavanta_Latte_20L_yatay_etiket_oniks",
      imagePosition: "end",
      stats: [
        { value: t("500 ml", "500 ml", "500 مل"), label: t("Pompalı şişe", "Pump bottle", "زجاجة بمضخة") },
        { value: t("5 L", "5 L", "5 لترات"), label: t("Dolum bidonu", "Refill canister", "عبوة تعبئة") },
        { value: t("20 L", "20 L", "20 لترًا"), label: t("Büyük bidon", "Large canister", "عبوة كبيرة") },
      ],
      cta: cta(t("Ürünleri inceleyin", "Browse the products", "تصفّح المنتجات"), "/urunler"),
    },
  },
  {
    type: "b2b_cta",
    content: {
      eyebrow: t("Kurumsal çalışma", "Working with us", "العمل معنا"),
      title: t("Size özel fiyat, düzenli tedarik.", "Tailored pricing, dependable supply.", "أسعار مخصّصة وتوريد منتظم."),
      body: t(
        "İhtiyacınızı birlikte planlayalım: kullandığınız alanları, tercih ettiğiniz kokuları ve yaklaşık tüketiminizi paylaşın, işletmenize uygun teklifi hazırlayalım.",
        "Let us plan your needs together: tell us about your spaces, the scents you prefer and your approximate consumption, and we will prepare the right offer for your business.",
        "لنخطّط لاحتياجاتك معًا: أخبرنا عن مساحاتك والروائح التي تفضّلها واستهلاكك التقريبي، وسنُعِدّ العرض المناسب لمنشأتك.",
      ),
      bullets: [
        t("İşletmenize özel fiyat teklifi", "A price quote tailored to your business", "عرض سعر مخصّص لمنشأتك"),
        t("Toplu alımda kademeli fiyat", "Tiered pricing on volume orders", "أسعار متدرّجة للطلبات الكبيرة"),
        t("Kurumsal faturayla satış", "Invoiced sales to your company", "بيع بفاتورة باسم شركتك"),
        t("Karar öncesi ücretsiz numune", "Free samples before you decide", "عيّنات مجانية قبل أن تقرّر"),
        t("Kayseri'deki üreticiden doğrudan", "Direct from the maker in Kayseri", "مباشرةً من المُصنِّع في قيصري"),
        t("Dört koku, üç boy, tek tedarikçi", "Four scents, three sizes, one supplier", "أربعة عطور وثلاثة أحجام ومورّد واحد"),
      ],
      cta: cta(REQUEST_QUOTE, QUOTE_HREF),
      secondaryCta: cta(t("Ücretsiz numune isteyin", "Request free samples", "اطلب عيّنات مجانية"), SAMPLE_HREF),
      imageId: "@media:PRESTIJ_Lavanta_Latte_5L_spa_servis_arabasi",
    },
  },
  QUOTE_FORM_SECTION,
  {
    type: "faq",
    content: {
      eyebrow: FAQ_EYEBROW,
      title: t(
        "Toptan sıvı sabun ve duş jeli alımı hakkında",
        "About buying bulk liquid soap and shower gel",
        "حول شراء الصابون السائل وجل الاستحمام بالجملة",
      ),
      items: [
        {
          question: t("Kurumsal fiyat teklifini nasıl alabilirim?", "How do I get a business quote?", "كيف أحصل على عرض سعر للشركات؟"),
          answer: t(
            "Bu sayfadaki teklif formunda işletmenizi, ilgilendiğiniz ürünleri, boyları ve yaklaşık adetleri belirtin. Talebinizi inceleyip size özel teklifimizi e-postayla gönderelim. Dilerseniz bizi telefonla da arayabilirsiniz.",
            "Use the quote form on this page to tell us about your business, the products and sizes you are interested in and approximate quantities. We will review your request and email you a tailored quote. You are also welcome to call us.",
            "استخدم نموذج طلب عرض السعر في هذه الصفحة لتخبرنا عن منشأتك والمنتجات والأحجام التي تهمّك والكميات التقريبية، وسنراجع طلبك ونرسل إليك عرضًا مخصّصًا عبر البريد الإلكتروني. ويمكنك أيضًا الاتصال بنا هاتفيًا.",
          ),
        },
        {
          question: t("Hangi kokular ve boylar var?", "Which scents and sizes are available?", "ما الروائح والأحجام المتوفّرة؟"),
          answer: t(
            "Lavanta Latte, Lavanta ve Portakal sıvı el sabunu, Okyanus ise duş jelidir. Her biri 500 ml pompalı şişe, 5 L ve 20 L bidon olarak sunulur. Dört kokuyu 5 litrelik bidonlarda bir araya getiren Dört Koku Koleksiyonu da var.",
            "Lavender Latte, Lavender and Orange are liquid hand soaps; Ocean is a shower gel. Each comes as a 500 ml pump bottle and in 5 L and 20 L canisters. The Four-Scent Collection brings all four together in 5 L canisters.",
            "لاتيه اللافندر واللافندر والبرتقال صابون سائل لليدين، والمحيط جل استحمام. يتوفّر كلٌّ منها في زجاجة بمضخة سعة 500 مل وفي عبوات 5 و20 لترًا، كما تجمع «مجموعة الروائح الأربع» العطور الأربعة في عبوات 5 لترات.",
          ),
        },
        {
          question: t("Bidonlar ne için kullanılır?", "What are the canisters for?", "ما الغرض من العبوات الكبيرة؟"),
          answer: t(
            "5 L ve 20 L bidonlar; pompalı şişeleri, dispenserleri ve sabunlukları yeniden doldurmak için tasarlandı. Aynı formülü ve kokuyu taşıdıkları için misafirleriniz her noktada aynı deneyimi yaşar.",
            "The 5 L and 20 L canisters are made for refilling pump bottles, dispensers and soap holders. They carry the same formula and scent, so your guests enjoy the same experience everywhere.",
            "صُمّمت عبوتا 5 و20 لترًا لإعادة تعبئة زجاجات المضخة والموزّعات وحاويات الصابون. ولأنهما تحملان التركيبة والعطر نفسيهما، يعيش ضيوفك التجربة ذاتها في كل مكان.",
          ),
        },
        {
          question: t("Satın almadan önce deneyebilir miyim?", "Can I try before I buy?", "هل يمكنني التجربة قبل الشراء؟"),
          answer: t(
            "Elbette. İşletmelere ücretsiz numune gönderiyoruz; kokuyu, köpüğü ve ellerde bıraktığı hissi kendi mekânınızda deneyebilirsiniz. Ayrıntılar Numune sayfasında.",
            "Of course. We send free samples to businesses, so you can try the scent, the lather and the feel on your hands in your own space. See the Samples page for details.",
            "بالتأكيد. نرسل عيّنات مجانية إلى المنشآت لتجرّب العطر والرغوة والإحساس الذي يتركه على اليدين في مكانك. التفاصيل في صفحة العيّنات.",
          ),
        },
        {
          question: t("Faturalı alım yapabilir miyim?", "Can I buy with a company invoice?", "هل يمكنني الشراء بفاتورة باسم الشركة؟"),
          answer: t(
            "Evet. Sipariş verirken ödeme adımında faturanın firmanız adına düzenlenmesini seçip firma unvanınızı, vergi dairenizi ve vergi numaranızı girebilirsiniz.",
            "Yes. At checkout, choose to have the invoice issued in your company's name and enter your company name, tax office and tax number.",
            "نعم. في خطوة الدفع، اختر إصدار الفاتورة باسم شركتك وأدخل اسم الشركة ومكتب الضرائب والرقم الضريبي.",
          ),
        },
        {
          question: t("Ürünler nerede üretiliyor?", "Where are the products made?", "أين تُصنَّع المنتجات؟"),
          answer: t(
            "PRESTİJ ürünleri Kayseri'de, PRESTİJ Buklet Kozmetik tarafından üretilir. Menşei Türkiye'dir; açıldıktan sonra 12 ay içinde kullanılması önerilir.",
            "PRESTİJ products are made in Kayseri by PRESTİJ Buklet Kozmetik. They are of Turkish origin and best used within 12 months of opening.",
            "تُصنَّع منتجات PRESTİJ في قيصري لدى شركة PRESTİJ Buklet Kozmetik. منشؤها تركيا، ويُفضَّل استخدامها خلال 12 شهرًا من فتح العبوة.",
          ),
        },
      ],
    },
  },
  {
    type: "sample_cta",
    content: {
      eyebrow: t("Önce deneyin", "Try first", "جرّب أولًا"),
      title: t("Kokuları kendi mekânınızda deneyin.", "Try the scents in your own space.", "جرّب العطور في مكانك."),
      body: t(
        "Karar vermeden önce dört kokuyu misafirlerinizin kullanacağı lavabolarda deneyin. Numuneler işletmelere ücretsiz gönderilir.",
        "Before you decide, try the four scents at the basins your guests will use. Samples are sent to businesses free of charge.",
        "قبل أن تقرّر، جرّب العطور الأربعة على المغاسل التي سيستخدمها ضيوفك. تُرسَل العيّنات إلى المنشآت مجانًا.",
      ),
      note: SAMPLES_NOT_FOR_SALE,
      cta: cta(REQUEST_SAMPLES, SAMPLE_HREF),
      imageId: "@media:PRESTIJ_Lavanta_Latte_5L_ustten_cekim",
    },
  },
];

// ---------------------------------------------------------------------------------------------
// /numune

const sampleSections: SeedSection[] = [
  {
    type: "hero",
    content: {
      layout: "split",
      height: "tall",
      align: "start",
      overlay: 35,
      imageId: "@media:PRESTIJ_Portakal_Pompali_kullanim_buzlu_amber",
      eyebrow: t("Ücretsiz numune", "Free samples", "عيّنات مجانية"),
      headline: t("Karar vermeden önce kendiniz deneyin.", "Try it yourself before you decide.", "جرّبه بنفسك قبل أن تقرّر."),
      subline: t(
        "Bir sabunu, ellerinizde bıraktığı his anlatır. İşletmenize ücretsiz sıvı sabun numunesi gönderelim; kokuyu, köpüğü ve dokuyu kendi mekânınızda deneyimleyin.",
        "A soap is judged by how it feels on your hands. Let us send free liquid soap samples to your business, so you can experience the scent, the lather and the texture in your own space.",
        "الإحساس الذي يتركه الصابون على يديك هو ما يعرّفك به. دعنا نرسل عيّنات صابون سائل مجانية إلى منشأتك، لتختبر العطر والرغوة والملمس في مكانك.",
      ),
      primaryCta: cta(REQUEST_SAMPLES, SAMPLE_HREF),
      secondaryCta: cta(t("Kokuları keşfedin", "Discover the scents", "اكتشف العطور"), "/urunler"),
    },
  },
  {
    type: "packaging",
    content: {
      eyebrow: t("Nasıl işler?", "How it works", "كيف تتم العملية؟"),
      title: t("Üç adımda numuneniz yolda.", "Your samples in three steps.", "عيّناتك في ثلاث خطوات."),
      intro: t(
        "Talebinizi iletmeniz yeterli; gerisini biz hallederiz.",
        "Just send us your request; we take care of the rest.",
        "يكفي أن ترسل طلبك، ونتولّى نحن الباقي.",
      ),
      items: [
        {
          imageId: "@media:PRESTIJ_Lavanta_Latte_Pompali_studyo_fasetli_cam",
          audience: t("Adım 1", "Step 1", "الخطوة 1"),
          title: t("Talebinizi iletin", "Send your request", "أرسل طلبك"),
          description: t(
            "Bu sayfadaki numune formunu doldurun; işletmenizi, denemek istediğiniz kokuları ve gönderim adresini yazın.",
            "Fill in the sample form on this page with your business, the scents you would like to try and the delivery address.",
            "املأ نموذج طلب العيّنات في هذه الصفحة بمعلومات منشأتك والروائح التي ترغب في تجربتها وعنوان الإرسال.",
          ),
          cta: cta(t("Formu açın", "Open the form", "افتح النموذج"), SAMPLE_HREF),
        },
        {
          imageId: "@media:PRESTIJ_Koleksiyon_5L_dikey_koleksiyon",
          audience: t("Adım 2", "Step 2", "الخطوة 2"),
          title: t("Numuneleriniz hazırlansın", "We prepare your samples", "نجهّز عيّناتك"),
          description: t(
            "Talebinizi inceliyor, numunelerinizi hazırlıyor ve ücretsiz olarak kargoya veriyoruz.",
            "We review your request, prepare your samples and ship them free of charge.",
            "نراجع طلبك ونجهّز عيّناتك ونشحنها مجانًا.",
          ),
        },
        {
          imageId: "@media:PRESTIJ_Okyanus_Pompali_dus_jeli_kullanim",
          audience: t("Adım 3", "Step 3", "الخطوة 3"),
          title: t("Kendi mekânınızda deneyin", "Try them in your space", "جرّبها في مكانك"),
          description: t(
            "Kokuyu, köpüğü ve ellerde bıraktığı yumuşaklığı misafirlerinizden önce siz deneyimleyin; size uygun boyu birlikte seçelim.",
            "Experience the scent, the lather and the softness it leaves on the hands before your guests do, then let us choose the right size together.",
            "اختبر العطر والرغوة والنعومة التي يتركها على اليدين قبل ضيوفك، ثم لنختر معًا الحجم المناسب.",
          ),
        },
      ],
    },
  },
  {
    type: "scent_showcase",
    content: {
      eyebrow: t("Deneyebileceğiniz kokular", "Scents to try", "عطور يمكنك تجربتها"),
      title: t("Dört koku, dört karakter.", "Four scents, four characters.", "أربعة عطور، أربع شخصيات."),
      intro: t(
        "Numune talebinizde denemek istediğiniz kokuları belirtmeniz yeterli.",
        "Simply name the scents you would like to try in your request.",
        "يكفي أن تذكر في طلبك الروائح التي ترغب في تجربتها.",
      ),
      ctaLabel: t("Ürünü inceleyin", "View the product", "عرض المنتج"),
      items: [
        {
          productId: "@product:lavanta-latte",
          imageId: "@media:PRESTIJ_Lavanta_Latte_5L_inci_sampanya_studyo",
          tagline: t("Kremsi, yumuşak ve sakinleştirici", "Creamy, soft and soothing", "كريمي، ناعم ومهدّئ"),
        },
        {
          productId: "@product:lavanta",
          imageId: "@media:PRESTIJ_Lavanta_5L_ametist_altin_studyo",
          tagline: t("Dingin, aromatik ve zamansız", "Calm, aromatic and timeless", "هادئ، عطري وخالد"),
        },
        {
          productId: "@product:portakal",
          imageId: "@media:PRESTIJ_Portakal_5L_amber_gunisigi_studyo",
          tagline: t("Güneşli, canlı ve enerjik", "Sunny, bright and energising", "مشمس، منعش ومفعم بالحيوية"),
        },
        {
          productId: "@product:okyanus",
          imageId: "@media:PRESTIJ_Okyanus_5L_safir_su_isigi_studyo",
          tagline: t("Serin, berrak ve ferahlatıcı", "Cool, clear and refreshing", "بارد، صافٍ ومنعش"),
        },
      ],
    },
  },
  SAMPLE_REQUEST_FORM_SECTION,
  {
    type: "faq",
    content: {
      eyebrow: FAQ_EYEBROW,
      title: t("Numune hakkında", "About samples", "حول العيّنات"),
      items: [
        {
          question: t("Numuneler ücretli mi?", "Do samples cost anything?", "هل العيّنات مدفوعة؟"),
          answer: t(
            "Hayır. Numuneler ücretsizdir ve satılmaz; amacı, karar vermeden önce ürünü tanımanızdır.",
            "No. Samples are free and not for sale; they are there so you can get to know the product before you decide.",
            "لا. العيّنات مجانية وليست للبيع، والغاية منها أن تتعرّف على المنتج قبل أن تقرّر.",
          ),
        },
        {
          question: t("Kimler numune isteyebilir?", "Who can request samples?", "من يمكنه طلب العيّنات؟"),
          answer: t(
            "Oteller, spa merkezleri, ofisler, restoranlar ve kafeler gibi işletmeler bu sayfadaki formdan numune isteyebilir. Kendiniz için alışveriş yapıyorsanız sepetinize ücretsiz numune ekleyebilirsiniz.",
            "Businesses such as hotels, spas, offices, restaurants and cafés can request samples with the form on this page. When shopping for yourself, you can add free samples to your cart.",
            "يمكن للمنشآت مثل الفنادق ومراكز السبا والمكاتب والمطاعم والمقاهي طلب العيّنات عبر النموذج في هذه الصفحة. أما عند التسوّق لنفسك، فيمكنك إضافة عيّنات مجانية إلى سلّتك.",
          ),
        },
        {
          question: t("Hangi kokulardan numune alabilirim?", "Which scents can I sample?", "ما الروائح التي يمكنني تجربتها؟"),
          answer: t(
            "Lavanta Latte, Lavanta ve Portakal sıvı el sabunları ile Okyanus duş jelinden numune isteyebilirsiniz.",
            "You can request samples of the Lavender Latte, Lavender and Orange liquid hand soaps and the Ocean shower gel.",
            "يمكنك طلب عيّنات من صابون اليدين السائل لاتيه اللافندر واللافندر والبرتقال، ومن جل الاستحمام المحيط.",
          ),
        },
        {
          question: t("Numunem ne zaman ulaşır?", "When will my samples arrive?", "متى تصل عيّناتي؟"),
          answer: t(
            "Talebinizi inceledikten sonra numunelerinizi kargoya veririz. Sorunuz olursa bize telefonla ya da WhatsApp'tan ulaşabilirsiniz.",
            "Once we have reviewed your request, we ship your samples. If you have any questions, you can reach us by phone or on WhatsApp.",
            "بعد مراجعة طلبك نشحن عيّناتك. وإذا كان لديك أي سؤال، يمكنك التواصل معنا هاتفيًا أو عبر واتساب.",
          ),
        },
        {
          question: t("Denedikten sonra nasıl sipariş verebilirim?", "How do I order after trying?", "كيف أطلب بعد التجربة؟"),
          answer: t(
            "Beğendiğiniz kokuyu mağazamızdan hemen sipariş edebilirsiniz. Düzenli ya da yüksek hacimli alımlar için kurumsal teklif isteyin; işletmenize özel fiyatla dönüş yapalım.",
            "You can order the scent you like straight from our shop. For regular or high-volume purchases, request a business quote and we will get back to you with pricing tailored to your business.",
            "يمكنك طلب العطر الذي أعجبك مباشرةً من متجرنا. وللمشتريات المنتظمة أو الكبيرة، اطلب عرض سعر للشركات وسنعود إليك بأسعار مخصّصة لمنشأتك.",
          ),
        },
      ],
    },
  },
  {
    type: "sample_cta",
    content: {
      eyebrow: t("Numune talebi", "Sample request", "طلب عيّنات"),
      title: t(
        "Kokunuzu kâğıt üzerinde değil, lavabonun başında seçin.",
        "Choose your scent at the basin, not on paper.",
        "اختر عطرك عند المغسلة، لا على الورق.",
      ),
      body: t(
        "Kısa formu doldurun; numunelerinizi ücretsiz gönderelim.",
        "Fill in the short form and we will send your samples free of charge.",
        "املأ النموذج القصير وسنرسل إليك عيّناتك مجانًا.",
      ),
      note: SAMPLES_NOT_FOR_SALE,
      cta: cta(t("Numune talep edin", "Request samples", "اطلب العيّنات"), SAMPLE_HREF),
      imageId: "@media:PRESTIJ_Lavanta_5L_mermer_banyo",
    },
  },
];

// ---------------------------------------------------------------------------------------------
// /iletisim (the route shows the page title and SEO description as its header)

const contactSections: SeedSection[] = [
  {
    type: "contact_info",
    content: { showPhone: true, showWhatsapp: true, showEmail: true, showAddress: true },
  },
  {
    type: "contact_form",
    content: {
      eyebrow: t("Mesaj gönderin", "Send a message", "أرسل رسالة"),
      title: t("Size nasıl yardımcı olabiliriz?", "How can we help?", "كيف يمكننا مساعدتك؟"),
      intro: t(
        "Ürünlerimiz, siparişiniz ya da işletmenize özel bir teklif hakkında yazın; mesajınızı okuyup size en kısa sürede dönüş yapalım.\n\nKurumsal teklif ve numune talepleri için ilgili konuyu seçmeniz yeterli.",
        "Write to us about our products, your order or a quote for your business; we will read your message and get back to you as soon as possible.\n\nFor business quotes and sample requests, simply choose the matching subject.",
        "راسلنا بشأن منتجاتنا أو طلبك أو عرض سعر مخصّص لمنشأتك، وسنقرأ رسالتك ونعود إليك في أقرب وقت.\n\nلطلبات عروض الأسعار والعيّنات، يكفي أن تختار الموضوع المناسب.",
      ),
      subjects: [
        { key: "general", label: t("Genel soru", "General question", "سؤال عام") },
        { key: "quote", label: t("Kurumsal teklif", "Business quote", "عرض سعر للشركات") },
        { key: "sample", label: t("Numune talebi", "Sample request", "طلب عيّنات") },
        { key: "other", label: t("Diğer", "Other", "موضوع آخر") },
      ],
      privacyHref: "/sayfa/kvkk",
    },
  },
];

// ---------------------------------------------------------------------------------------------
// /urunler (day 5): the products route shows the page title as its h1 and the SEO description as the
// intro above the grid; these sections render below the grid.

/** The short personal-care guide below the product grid on /urunler. */
export const PRODUCTS_GUIDE_SECTION: SeedSection = {
  type: "rich_text",
  content: {
    eyebrow: t("Kişisel temizlik rehberi", "Personal care guide", "دليل النظافة الشخصية"),
    title: t("Hangi ürün, nerede?", "Which product, where?", "أي منتج، وأين؟"),
    width: "narrow",
    html: t(
      [
        `<p>PRESTİJ'in kişisel temizlik ürünleri iki ana gruptan oluşur. <a href="/kategori/el-sabunu">Sıvı el sabunu</a> çeşitlerimiz Lavanta Latte, Lavanta ve Portakal, lavabonun başında el temizliği içindir. <a href="/kategori/dus-jeli">Duş jeli</a> kategorimizdeki Okyanus ise duşta vücut temizliği için hazırlandı. Dört kokuyu birlikte almak isteyenler için <a href="/kategori/hediye-setleri">hediye setleri</a> sayfamızda Dört Koku Koleksiyonu yer alıyor.</p>`,
        `<h2>Doğru boyu seçin</h2>`,
        `<p>Her koku pompalı şişe, 5 L ve 20 L bidon olarak sunulur. Evde günlük kullanım için pompalı şişe, şişeleri ve dispenserleri yeniden doldurmak için 5 L bidon, otel, okul, ofis ve spor salonu gibi yoğun kullanılan alanlar için 20 L bidon pratik bir seçimdir. Üç boyda da formül ve koku aynıdır.</p>`,
        `<h2>İşletmeler ve numune</h2>`,
        `<p>Düzenli ve yüksek hacimli alımlar için <a href="/kurumsal">toptan sıvı sabun ve duş jeli</a> teklifi isteyebilirsiniz. Kokuları önce denemek isteyen işletmelere <a href="/numune">ücretsiz numune</a> gönderiyoruz; numuneler satılmaz.</p>`,
      ].join(""),
      [
        `<p>PRESTİJ personal care products come in two main groups. Our <a href="/kategori/el-sabunu">liquid hand soap</a> range, Lavender Latte, Lavender and Orange, is for washing hands at the basin. Ocean, in our <a href="/kategori/dus-jeli">shower gel</a> category, is made for cleansing the body in the shower. If you would like all four scents together, the Four-Scent Collection is on our <a href="/kategori/hediye-setleri">gift sets</a> page.</p>`,
        `<h2>Choose the right size</h2>`,
        `<p>Every scent comes as a pump bottle and in 5 L and 20 L canisters. The pump bottle suits everyday use at home, the 5 L canister refills bottles and dispensers, and the 20 L canister is a practical choice for busy places such as hotels, schools, offices and gyms. The formula and scent are the same in all three sizes.</p>`,
        `<h2>Businesses and samples</h2>`,
        `<p>For regular, high-volume orders, request a quote for <a href="/kurumsal">bulk liquid soap and shower gel</a>. We send <a href="/numune">free samples</a> to businesses that would like to try the scents first; samples are not for sale.</p>`,
      ].join(""),
      [
        `<p>تنقسم منتجات PRESTİJ للنظافة الشخصية إلى مجموعتين رئيسيتين. تشمل مجموعة <a href="/kategori/el-sabunu">الصابون السائل لليدين</a> روائح لاتيه اللافندر واللافندر والبرتقال، وهي لتنظيف اليدين عند المغسلة. أما المحيط، في فئة <a href="/kategori/dus-jeli">جل الاستحمام</a>، فقد صُمّم لتنظيف الجسم في الدش. ولمن يرغب في الروائح الأربع معًا، تجد مجموعة الروائح الأربع في صفحة <a href="/kategori/hediye-setleri">مجموعات الهدايا</a>.</p>`,
        `<h2>اختر الحجم المناسب</h2>`,
        `<p>تتوفّر كل رائحة في زجاجة بمضخة وفي عبوات 5 و20 لترًا. الزجاجة بالمضخة للاستخدام اليومي في المنزل، وعبوة 5 لترات لإعادة تعبئة الزجاجات والموزّعات، وعبوة 20 لترًا خيار عملي للأماكن المزدحمة مثل الفنادق والمدارس والمكاتب والصالات الرياضية. والتركيبة والرائحة واحدة في الأحجام الثلاثة.</p>`,
        `<h2>الشركات والعيّنات</h2>`,
        `<p>للطلبات المنتظمة والكبيرة، اطلب عرض سعر لشراء <a href="/kurumsal">الصابون السائل وجل الاستحمام بالجملة</a>. ونرسل <a href="/numune">عيّنات مجانية</a> إلى المنشآت التي ترغب في تجربة الروائح أولًا، والعيّنات ليست للبيع.</p>`,
      ].join(""),
    ),
  },
};

/** Shopping questions on /urunler (the home page and the categories have their own). */
export const PRODUCTS_FAQ_SECTION: SeedSection = {
  type: "faq",
  content: {
    eyebrow: FAQ_EYEBROW,
    title: t("Sipariş vermeden önce", "Before you order", "قبل أن تطلب"),
    items: [
      {
        question: t(
          "Dört kokuyu birden denemek istiyorum; ne önerirsiniz?",
          "I would like to try all four scents. What do you suggest?",
          "أرغب في تجربة الروائح الأربع معًا، فبماذا تنصحون؟",
        ),
        answer: t(
          "Dört Koku Koleksiyonu, dört kokuyu 5 L bidonlarda bir araya getirir. Önce küçük bir deneme isterseniz siparişinize ücretsiz numune ekleyebilirsiniz (numuneler satılmaz); işletmeler numune sayfamızdaki formdan da numune isteyebilir.",
          "The Four-Scent Collection brings all four scents together in 5 L canisters. If you would rather start with a small trial, add a free sample to your order (samples are not for sale); businesses can also request samples with the form on our samples page.",
          "تجمع مجموعة الروائح الأربع الروائح كلها في عبوات 5 لترات. وإذا كنت تفضّل البدء بتجربة صغيرة، أضف عيّنة مجانية إلى طلبك (العيّنات ليست للبيع)، ويمكن للمنشآت أيضًا طلب العيّنات من خلال النموذج في صفحة العيّنات.",
        ),
      },
      {
        question: t("Şirketim adına fatura alabilir miyim?", "Can I get an invoice in my company's name?", "هل يمكنني الحصول على فاتورة باسم شركتي؟"),
        answer: t(
          "Evet. Ödeme adımında faturanın firmanız adına düzenlenmesini seçin; firma unvanını, vergi dairesini ve vergi numarasını girmeniz yeterli.",
          "Yes. At checkout, choose to have the invoice issued in your company's name and enter the company name, tax office and tax number.",
          "نعم. في خطوة الدفع، اختر إصدار الفاتورة باسم شركتك، ثم أدخل اسم الشركة ومكتب الضرائب والرقم الضريبي.",
        ),
      },
      {
        question: t("Ürünleri nasıl saklamalıyım?", "How should I store the products?", "كيف أحفظ المنتجات؟"),
        answer: t(
          "Isı ve doğrudan güneş ışığından uzakta, çocukların ulaşamayacağı bir yerde saklayın. Açıldıktan sonra 12 ay içinde kullanmanızı öneririz.",
          "Store them away from heat and direct sunlight, out of the reach of children. We recommend using them within 12 months of opening.",
          "احفظها بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال. ننصح باستخدامها خلال 12 شهرًا من فتح العبوة.",
        ),
      },
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// /sayfa/hakkimizda (day 5): who PRESTİJ is, from the facts in docs/DAY5-SEO.md only. The /sayfa route
// shows the title as h1 and the SEO description as the intro, so the page starts with the story.

/**
 * Corrections to the story body after content-day5.ts first wrote /sayfa/hakkimizda (day-5 review/FIX,
 * 2026-11-11): the opening no longer repeats the intro above it (the SEO description, "PRESTİJ … markasıdır"),
 * the label claims are a list of nouns (en/ar) and the English aim reads naturally. Round 2 (day-5
 * verification): the opening has a proper subject, says where the company is and that the products are
 * made in Kayseri (not that they are made at the head office), and the Arabic drops the legal suffix whose
 * final dot broke the right-to-left order. The catalogSeo step updates the live section only while its
 * body is still one of the versions it wrote earlier (./content-fixes.ts, SECTION_COPY_FIXES below).
 */
export const ABOUT_STORY_BODY_FIXES: LocaleFixes = {
  tr: [
    { before: "PRESTİJ, PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti.'nin markasıdır. Merkezimiz Kayseri'nin Kocasinan ilçesindedir; sıvı el sabunu ve duş jelimizi Kayseri'de üretiyoruz ve ürünlerimizin menşei Türkiye'dir.", after: "PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti. olarak merkezimiz Kayseri'nin Kocasinan ilçesindedir. Sıvı el sabunu ve duş jelimizi burada üretiyoruz; ürünlerimizin menşei Türkiye'dir." },
    { round: 2, before: "PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti. olarak merkezimiz Kayseri'nin Kocasinan ilçesindedir. Sıvı el sabunu ve duş jelimizi burada üretiyoruz; ürünlerimizin menşei Türkiye'dir.", after: "Şirketimiz PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti., Kayseri'nin Kocasinan ilçesinde yer alır. Sıvı el sabunu ve duş jelimiz Kayseri'de üretilir; ürünlerimizin menşei Türkiye'dir." },
  ],
  en: [
    { before: "PRESTİJ is the brand of PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti. Our company is based in the Kocasinan district of Kayseri; we make our liquid hand soap and shower gel in Kayseri, and our products are of Turkish origin.", after: "As PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti., we are based in the Kocasinan district of Kayseri. We make our liquid hand soap and shower gel here, and our products are of Turkish origin." },
    { before: "effective cleansing, skin-caring, a fresh scent and a soft feel.", after: "effective cleansing, care for the skin, a fresh scent and a soft feel." },
    { before: "Our aim is simple: to turn the hand washing and showers repeated many times a day into a carefully prepared experience, at home and at work.", after: "Our aim is simple: to make the everyday moments of washing your hands and showering a little more special, at home and at work." },
    { round: 2, before: "As PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti., we are based in the Kocasinan district of Kayseri. We make our liquid hand soap and shower gel here, and our products are of Turkish origin.", after: "Our company, PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti., is based in the Kocasinan district of Kayseri. Our liquid hand soap and shower gel are made in Kayseri, Türkiye." },
  ],
  ar: [
    { before: "PRESTİJ علامة تجارية لشركة PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti. يقع مقرّنا في منطقة قوجاسنان بمدينة قيصري، ونصنع الصابون السائل لليدين وجل الاستحمام في قيصري، ومنشأ منتجاتنا تركيا.", after: "يقع مقرّ شركة PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti. في منطقة قوجاسنان بمدينة قيصري، وفيها نصنع الصابون السائل لليدين وجل الاستحمام، ومنشأ منتجاتنا تركيا." },
    { before: "ما نبحث عنه في كل منتج: تنظيف فعّال، ويحمي البشرة، ورائحة منعشة، وملمس ناعم.", after: "ما نبحث عنه في كل منتج: تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم." },
    { round: 2, before: "يقع مقرّ شركة PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti. في منطقة قوجاسنان بمدينة قيصري، وفيها نصنع الصابون السائل لليدين وجل الاستحمام، ومنشأ منتجاتنا تركيا.", after: "يقع مقرّ شركة PRESTİJ Buklet Kozmetik في منطقة قوجاسنان بمدينة قيصري، وتُصنع منتجاتنا من الصابون السائل لليدين وجل الاستحمام في قيصري، ومنشؤها تركيا." },
  ],
};

const aboutSections: SeedSection[] = [
  {
    type: "story",
    content: {
      // Arabic: not "من نحن", the page title (the route prints it as the <h1> above this section).
      eyebrow: t("Biz kimiz", "Who we are", "تعرّف إلينا"),
      title: t("Kayseri'de üretilen sıvı sabun ve duş jeli.", "Liquid soap and shower gel, made in Kayseri.", "صابون سائل وجل استحمام من صنع قيصري."),
      body: t(
        "Şirketimiz PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti., Kayseri'nin Kocasinan ilçesinde yer alır. Sıvı el sabunu ve duş jelimiz Kayseri'de üretilir; ürünlerimizin menşei Türkiye'dir.\n\nKoleksiyonumuz dört kokudan oluşur: Lavanta Latte, Lavanta ve Portakal sıvı el sabunları ile Okyanus duş jeli. Etiketlerimizdeki dört özellik, her üründe aradığımız şeyi özetler: etkili temizlik, cildi koruyan yapı, ferah koku ve yumuşak his.\n\nAmacımız basit: gün içinde defalarca tekrarlanan el yıkama ve duş anını, evde de iş yerinde de özenle hazırlanmış bir deneyime dönüştürmek.",
        "Our company, PRESTİJ Buklet Kozmetik San. Tic. Ltd. Şti., is based in the Kocasinan district of Kayseri. Our liquid hand soap and shower gel are made in Kayseri, Türkiye.\n\nOur collection has four scents: Lavender Latte, Lavender and Orange liquid hand soaps, and Ocean shower gel. The four features on our labels sum up what we look for in every product: effective cleansing, care for the skin, a fresh scent and a soft feel.\n\nOur aim is simple: to make the everyday moments of washing your hands and showering a little more special, at home and at work.",
        "يقع مقرّ شركة PRESTİJ Buklet Kozmetik في منطقة قوجاسنان بمدينة قيصري، وتُصنع منتجاتنا من الصابون السائل لليدين وجل الاستحمام في قيصري، ومنشؤها تركيا.\n\nتتكوّن مجموعتنا من أربع روائح: صابون لاتيه اللافندر واللافندر والبرتقال السائل لليدين، وجل الاستحمام المحيط. وتلخّص الخصائص الأربع على ملصقاتنا ما نبحث عنه في كل منتج: تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم.\n\nهدفنا بسيط: أن نحوّل لحظات غسل اليدين والاستحمام التي تتكرّر مرات كثيرة في اليوم إلى تجربة مُعدّة بعناية، في المنزل وفي العمل.",
      ),
      imageId: "@media:PRESTIJ_Koleksiyon_5L_dikey_koleksiyon",
      imagePosition: "start",
      stats: [
        { value: t("4", "4", "4"), label: t("Koku", "Scents", "روائح") },
        { value: t("3", "3", "3"), label: t("Ambalaj seçeneği", "Formats", "خيارات العبوة") },
        { value: t("Kayseri", "Kayseri", "قيصري"), label: t("Üretim yeri", "Made in", "مكان الإنتاج") },
      ],
    },
  },
  {
    type: "packaging",
    content: {
      eyebrow: t("Ne üretiyoruz", "What we make", "ماذا نصنع"),
      title: t("Sıvı el sabunu, duş jeli ve dolum bidonları.", "Liquid hand soap, shower gel and refill canisters.", "صابون سائل لليدين وجل استحمام وعبوات تعبئة."),
      intro: t(
        "Her koku pompalı şişe ile 5 L ve 20 L bidon olarak sunulur; aynı formül, aynı koku.",
        "Every scent comes as a pump bottle and in 5 L and 20 L canisters: the same formula, the same scent.",
        "تتوفّر كل رائحة في زجاجة بمضخة وفي عبوات 5 و20 لترًا: التركيبة نفسها والرائحة نفسها.",
      ),
      items: [
        {
          imageId: "@media:PRESTIJ_Lavanta_Pompali_mermer_yivli_cam",
          title: t("Sıvı El Sabunu", "Liquid Hand Soap", "صابون سائل لليدين"),
          audience: t("Lavanta Latte · Lavanta · Portakal", "Lavender Latte · Lavender · Orange", "لاتيه اللافندر · اللافندر · البرتقال"),
          description: t(
            "Lavabonun başında el temizliği için üç koku; ev banyosundan otel lobisine.",
            "Three scents for washing hands at the basin, from the family bathroom to the hotel lobby.",
            "ثلاث روائح لتنظيف اليدين عند المغسلة، من حمّام المنزل إلى ردهة الفندق.",
          ),
          cta: cta(t("Sıvı el sabunları", "Liquid hand soaps", "الصابون السائل لليدين"), "/kategori/el-sabunu"),
        },
        {
          imageId: "@media:PRESTIJ_Okyanus_Pompali_spa_buzlu_turkuaz",
          title: t("Duş Jeli", "Shower Gel", "جل الاستحمام"),
          audience: t("Okyanus", "Ocean", "المحيط"),
          description: t(
            "Duşta vücut temizliği için serin ve ferah bir koku; evlerden otel ve spa duşlarına.",
            "A cool, fresh scent for cleansing the body in the shower, from homes to hotel and spa showers.",
            "رائحة باردة منعشة لتنظيف الجسم في الدش، من المنازل إلى دشات الفنادق ومراكز السبا.",
          ),
          cta: cta(t("Duş jeli", "Shower gel", "جل الاستحمام"), "/kategori/dus-jeli"),
        },
        {
          imageId: "@media:PRESTIJ_Lavanta_5L_sabunluga_dolum_son",
          title: t("5 L ve 20 L Bidon", "5 L and 20 L Canisters", "عبوات 5 و20 لترًا"),
          audience: t("Dolum ve işletmeler", "Refills and businesses", "التعبئة والشركات"),
          description: t(
            "Pompalı şişeleri ve dispenserleri yeniden doldurmak için; tüketimin yüksek olduğu işletmelerde daha az ambalaj.",
            "For refilling pump bottles and dispensers, with less packaging where consumption is high.",
            "لإعادة تعبئة زجاجات المضخة والموزّعات، مع تغليف أقل في الأماكن كثيفة الاستهلاك.",
          ),
          cta: cta(t("Toptan sıvı sabun", "Bulk liquid soap", "صابون سائل بالجملة"), "/kurumsal"),
        },
      ],
    },
  },
  {
    type: "rich_text",
    content: {
      eyebrow: t("Kimler için", "Who we serve", "لمن نعمل"),
      title: t("Evler ve işletmeler için", "For homes and businesses", "للمنازل والشركات"),
      width: "narrow",
      html: t(
        [
          `<p>PRESTİJ ürünlerini bu siteden bireysel olarak sipariş edebilirsiniz. Oteller, spa merkezleri, ofisler, restoranlar ve kafeler gibi işletmeler için <a href="/kurumsal">kurumsal satış</a> sayfamızda işletmeye özel fiyat teklifi, kurumsal hesap ve faturalı alım seçenekleri yer alır.</p>`,
          `<p>Kokularımızı satın almadan önce tanımanızı isteriz. İşletmelere <a href="/numune">ücretsiz numune</a> gönderiyoruz; bireysel siparişlerinize de ücretsiz numune ekleyebilirsiniz. Numuneler ücretsizdir ve satılmaz.</p>`,
          `<p>Tüm ürünlerimizi <a href="/urunler">ürünler</a> sayfasında bulabilir, sorularınız için <a href="/iletisim">iletişim</a> sayfamızdan bize yazabilirsiniz.</p>`,
        ].join(""),
        [
          `<p>You can order PRESTİJ products for yourself on this website. For businesses such as hotels, spas, offices, restaurants and cafés, our <a href="/kurumsal">business sales</a> page offers tailored price quotes, a business account and invoiced purchasing.</p>`,
          `<p>We would like you to get to know our scents before you buy. We send <a href="/numune">free samples</a> to businesses, and you can add free samples to your own orders. Samples are free and not for sale.</p>`,
          `<p>You will find our full range on the <a href="/urunler">products</a> page, and you can write to us with any questions on our <a href="/iletisim">contact</a> page.</p>`,
        ].join(""),
        [
          `<p>يمكنك طلب منتجات PRESTİJ لنفسك من هذا الموقع. أما المنشآت مثل الفنادق ومراكز السبا والمكاتب والمطاعم والمقاهي، فتجد في صفحة <a href="/kurumsal">مبيعات الشركات</a> عروض أسعار مخصّصة وحسابًا للشركات وإمكانية الشراء بفاتورة.</p>`,
          `<p>نودّ أن تتعرّف إلى روائحنا قبل الشراء. لذلك نرسل <a href="/numune">عيّنات مجانية</a> إلى المنشآت، ويمكنك أيضًا إضافة عيّنات مجانية إلى طلباتك الشخصية. العيّنات مجانية وليست للبيع.</p>`,
          `<p>تجد مجموعتنا كاملة في صفحة <a href="/urunler">المنتجات</a>، ويمكنك مراسلتنا بأي سؤال من صفحة <a href="/iletisim">اتصل بنا</a>.</p>`,
        ].join(""),
      ),
    },
  },
  {
    type: "contact_info",
    content: {
      eyebrow: t("İletişim", "Contact", "اتصل بنا"),
      title: t("Bize ulaşın", "Get in touch", "تواصل معنا"),
      showPhone: true,
      showWhatsapp: true,
      showEmail: true,
      showAddress: true,
    },
  },
];

export const SITE_PAGES: SitePageSeed[] = [
  {
    slug: "kurumsal",
    kind: "b2b",
    title: t("Kurumsal", "For Business", "للشركات"),
    seo: {
      title: t(
        "Toptan Sıvı Sabun ve Duş Jeli — 5 L ve 20 L Bidon",
        "Bulk Liquid Soap and Shower Gel — 5 L and 20 L Canisters",
        "صابون سائل وجل استحمام بالجملة — عبوات 5 و20 لترًا",
      ),
      description: t(
        "Oteller, ofisler ve restoranlar için toptan sıvı sabun ve duş jeli: 5 L ve 20 L bidon, size özel fiyat teklifi ve ücretsiz numune. Kayseri'de üretilir.",
        "Bulk liquid hand soap and shower gel for hotels, offices and restaurants: 5 L and 20 L canisters, a quote tailored to your business and free samples.",
        "صابون سائل لليدين وجل استحمام بالجملة للفنادق والمكاتب والمطاعم: عبوات 5 و20 لترًا، وعرض سعر مخصّص لمنشأتك، وعيّنات مجانية.",
      ),
    },
    sections: positioned(businessSections),
  },
  {
    slug: "numune",
    kind: "landing",
    title: t("Ücretsiz Numune", "Free Samples", "عيّنات مجانية"),
    seo: {
      title: t(
        "Ücretsiz Sıvı Sabun Numunesi: Kokuları Önce Deneyin",
        "Free Liquid Soap Samples: Try the Scents First",
        "عيّنات صابون سائل مجانية: جرّب الروائح أولًا",
      ),
      description: t(
        "İşletmenize ücretsiz sıvı el sabunu ve duş jeli numunesi: Lavanta Latte, Lavanta, Portakal ve Okyanus'u kendi mekânınızda deneyin. Numuneler satılmaz.",
        "Free liquid hand soap and shower gel samples for your business: try Lavender Latte, Lavender, Orange and Ocean in your own space. Samples are not for sale.",
        "عيّنات مجانية من الصابون السائل لليدين وجل الاستحمام لمنشأتك: جرّب لاتيه اللافندر واللافندر والبرتقال والمحيط في مكانك. العيّنات ليست للبيع.",
      ),
    },
    sections: positioned(sampleSections),
  },
  {
    slug: "iletisim",
    kind: "landing",
    title: t("İletişim", "Contact", "اتصل بنا"),
    seo: {
      title: t("İletişim: Sipariş, Kurumsal Teklif ve Numune", "Contact Us: Orders, Business Quotes and Samples", "اتصل بنا: الطلبات وعروض الأسعار والعيّنات"),
      description: t(
        "Sorularınız, siparişleriniz, kurumsal teklif ve numune talepleriniz için Kayseri'deki PRESTİJ ekibine telefonla, WhatsApp'tan ya da bu formdan ulaşın.",
        "Contact the PRESTİJ team in Kayseri by phone, on WhatsApp or with this form for questions, orders, business quotes and sample requests.",
        "تواصل مع فريق PRESTİJ في قيصري هاتفيًا أو عبر واتساب أو من خلال هذا النموذج لأسئلتك وطلباتك وعروض الأسعار وطلبات العيّنات.",
      ),
    },
    sections: positioned(contactSections),
  },
  {
    slug: "urunler",
    kind: "landing",
    title: t("Tüm Ürünler", "All Products", "جميع المنتجات"),
    seo: {
      title: t(
        "Temizlik Ürünleri: Sıvı El Sabunu ve Duş Jeli",
        "Cleaning & Personal Care Products: Hand Soap, Shower Gel",
        "منتجات التنظيف والعناية الشخصية: صابون سائل وجل استحمام",
      ),
      description: t(
        "PRESTİJ kişisel temizlik ürünleri: Lavanta Latte, Lavanta ve Portakal sıvı el sabunu, Okyanus duş jeli ve dört kokulu set; pompalı şişe, 5 L ve 20 L bidon.",
        "PRESTİJ personal care products: Lavender Latte, Lavender and Orange liquid hand soap, Ocean shower gel and a four-scent set, in pump bottles and canisters.",
        "منتجات PRESTİJ للنظافة الشخصية: صابون سائل لليدين بروائح لاتيه اللافندر واللافندر والبرتقال، وجل الاستحمام المحيط، وطقم الروائح الأربع.",
      ),
    },
    sections: positioned([PRODUCTS_GUIDE_SECTION, PRODUCTS_FAQ_SECTION]),
  },
  {
    slug: "hakkimizda",
    kind: "custom",
    title: t("Hakkımızda", "About Us", "من نحن"),
    seo: {
      title: t(
        "Hakkımızda: Kayseri'de Üretilen Sıvı Sabun ve Duş Jeli",
        "About Us: Liquid Soap and Shower Gel Made in Kayseri",
        "من نحن: صابون سائل وجل استحمام من صنع قيصري",
      ),
      description: t(
        "PRESTİJ, Kayseri'de sıvı el sabunu ve duş jeli üreten PRESTİJ Buklet Kozmetik'in markasıdır: dört koku, pompalı şişe, 5 L ve 20 L bidon.",
        "PRESTİJ is the brand of PRESTİJ Buklet Kozmetik, which makes liquid hand soap and shower gel in Kayseri, in four scents and three formats.",
        "PRESTİJ علامة شركة PRESTİJ Buklet Kozmetik التي تصنع الصابون السائل لليدين وجل الاستحمام في قيصري: أربع روائح بزجاجات بمضخة وعبوات 5 و20 لترًا.",
      ),
    },
    sections: positioned(aboutSections),
  },
];

// ---------------------------------------------------------------------------------------------
// Corrections to texts of existing page sections (the seed above holds the corrected text)

/**
 * One corrected text inside a page section: the first section of `type` on page `page` (ordered by
 * position, id, the way content-day4.ts finds them), localized text at `path` in its content.
 */
export type SectionCopyFix = { page: SitePageSeed["slug"]; type: SeedSection["type"]; path: FixPath; fixes: LocaleFixes };

/**
 * Every corrected section text. The catalogSeo step (scripts/content-day5.ts) replaces a stored text with
 * the seed text only while it still equals one of the versions written earlier (the seed text with the
 * later rounds undone, ./content-fixes.ts); a text the client edited in the panel is reported and kept.
 * Round 2 (day-5 verification, 2026-11-11):
 *   - /kurumsal: the keyword "toptan sıvı sabun" (en "bulk liquid soap", ar "صابون سائل … بالجملة") in the
 *     hero eyebrow (the first line of the <h1>), the first paragraph (hero subline, now without the pump
 *     bottle volume) and the FAQ heading;
 *   - /numune: "sıvı sabun numunesi" in the hero subline (and no "en iyi" / "best" in its first sentence);
 *   - /urunler: the first FAQ answer says the free samples are not for sale;
 *   - /sayfa/hakkimizda: the story body (ABOUT_STORY_BODY_FIXES) and the Arabic eyebrow, which repeated the
 *     page title "من نحن".
 * Round 3 (second review, REVIEW2 / FIX2, 2026-11-11):
 *   - /kurumsal: the hero subline no longer repeats the <h1> keyword line word for word. It names the keyword
 *     in its own words ("toptan sıvı sabun tedariki", en "bulk liquid soap supplied…", ar "توريد صابون سائل
 *     بالجملة") with the supporting terms (tedarik, 20 litre, el sabunu);
 *   - /numune (en): "…to your business, so you can experience the scent…" (was "…, and experience…").
 */
export const SECTION_COPY_FIXES: readonly SectionCopyFix[] = [
  {
    page: "kurumsal",
    type: "hero",
    path: ["eyebrow"],
    fixes: {
      tr: [{ round: 2, before: "PRESTİJ Kurumsal", after: "Toptan Sıvı Sabun ve Duş Jeli" }],
      en: [{ round: 2, before: "PRESTİJ for Business", after: "Bulk Liquid Soap and Shower Gel" }],
      ar: [{ round: 2, before: "PRESTİJ للشركات", after: "صابون سائل وجل استحمام بالجملة" }],
    },
  },
  {
    page: "kurumsal",
    type: "hero",
    path: ["subline"],
    fixes: {
      tr: [
        {
          round: 2,
          before: "Oteller, spa merkezleri, ofisler ve restoranlar için sıvı el sabunu ve duş jeli. 500 ml pompalı şişeden 20 litrelik bidona,",
          after: "Oteller, spa merkezleri, ofisler ve restoranlar için toptan sıvı sabun ve duş jeli. Pompalı şişeden 5 L ve 20 L bidona,",
        },
        {
          round: 3,
          before:
            "Oteller, spa merkezleri, ofisler ve restoranlar için toptan sıvı sabun ve duş jeli. Pompalı şişeden 5 L ve 20 L bidona, işletmenize özel fiyatla ve doğrudan üreticisinden.",
          after:
            "Oteller, spa merkezleri, ofisler ve restoranlar için doğrudan üreticisinden toptan sıvı sabun tedariki. Pompalı şişeden 20 litrelik bidona el sabunu ve duş jeli, işletmenize özel fiyatla.",
        },
      ],
      en: [
        {
          round: 2,
          before: "Liquid hand soap and shower gel for hotels, spas, offices and restaurants. From the 500 ml pump bottle to the 20-litre canister,",
          after: "Bulk liquid soap and shower gel for hotels, spas, offices and restaurants. From the pump bottle to the 5 L and 20 L canisters,",
        },
        {
          round: 3,
          before:
            "Bulk liquid soap and shower gel for hotels, spas, offices and restaurants. From the pump bottle to the 5 L and 20 L canisters, priced for your business and supplied directly by the maker.",
          after:
            "For hotels, spas, offices and restaurants: bulk liquid soap supplied directly by the maker. Hand soap and shower gel, from the pump bottle to the 20-litre canister, priced for your business.",
        },
      ],
      ar: [
        {
          round: 2,
          before: "صابون سائل لليدين وجل استحمام للفنادق ومراكز السبا والمكاتب والمطاعم. من زجاجة المضخة سعة 500 مل إلى عبوة 20 لترًا،",
          after: "صابون سائل لليدين وجل استحمام بالجملة للفنادق ومراكز السبا والمكاتب والمطاعم. من الزجاجة بالمضخة إلى عبوتي 5 و20 لترًا،",
        },
        {
          round: 3,
          before:
            "صابون سائل لليدين وجل استحمام بالجملة للفنادق ومراكز السبا والمكاتب والمطاعم. من الزجاجة بالمضخة إلى عبوتي 5 و20 لترًا، بأسعار مخصّصة لمنشأتك ومباشرةً من المُصنِّع.",
          after:
            "توريد صابون سائل بالجملة للفنادق ومراكز السبا والمكاتب والمطاعم، مباشرةً من المُصنِّع. صابون لليدين وجل استحمام من الزجاجة بالمضخة إلى عبوة 20 لترًا، بأسعار مخصّصة لمنشأتك.",
        },
      ],
    },
  },
  {
    page: "kurumsal",
    type: "faq",
    path: ["title"],
    fixes: {
      tr: [{ round: 2, before: "Kurumsal alım hakkında", after: "Toptan sıvı sabun ve duş jeli alımı hakkında" }],
      en: [{ round: 2, before: "About business orders", after: "About buying bulk liquid soap and shower gel" }],
      ar: [{ round: 2, before: "حول طلبات الشركات", after: "حول شراء الصابون السائل وجل الاستحمام بالجملة" }],
    },
  },
  {
    page: "numune",
    type: "hero",
    path: ["subline"],
    fixes: {
      tr: [
        {
          round: 2,
          before: "Bir sabunu en iyi, ellerinizde bıraktığı his anlatır. İşletmenize PRESTİJ numunelerini ücretsiz gönderelim;",
          after: "Bir sabunu, ellerinizde bıraktığı his anlatır. İşletmenize ücretsiz sıvı sabun numunesi gönderelim;",
        },
      ],
      en: [
        {
          round: 2,
          before: "The best way to judge a soap is how it feels on your hands. Let us send free PRESTİJ samples to your business,",
          after: "A soap is judged by how it feels on your hands. Let us send free liquid soap samples to your business,",
        },
        { round: 3, before: "to your business, and experience the scent,", after: "to your business, so you can experience the scent," },
      ],
      ar: [
        {
          round: 2,
          before: "أفضل ما يُعرِّفك بالصابون هو الإحساس الذي يتركه على يديك. دعنا نرسل عيّنات PRESTİJ مجانًا إلى منشأتك،",
          after: "الإحساس الذي يتركه الصابون على يديك هو ما يعرّفك به. دعنا نرسل عيّنات صابون سائل مجانية إلى منشأتك،",
        },
      ],
    },
  },
  {
    page: "urunler",
    type: "faq",
    path: ["items", 0, "answer"],
    fixes: {
      tr: [{ round: 2, before: "siparişinize ücretsiz numune ekleyebilirsiniz;", after: "siparişinize ücretsiz numune ekleyebilirsiniz (numuneler satılmaz);" }],
      en: [{ round: 2, before: "add a free sample to your order;", after: "add a free sample to your order (samples are not for sale);" }],
      ar: [{ round: 2, before: "أضف عيّنة مجانية إلى طلبك،", after: "أضف عيّنة مجانية إلى طلبك (العيّنات ليست للبيع)،" }],
    },
  },
  { page: "hakkimizda", type: "story", path: ["body"], fixes: ABOUT_STORY_BODY_FIXES },
  {
    page: "hakkimizda",
    type: "story",
    path: ["eyebrow"],
    fixes: { ar: [{ round: 2, before: "من نحن", after: "تعرّف إلينا" }] },
  },
];
