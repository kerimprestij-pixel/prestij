// Home page content for the page builder (tr / en / ar). The seed script replaces every
// "@media:<file stem>" with that media row's id and "@product:<slug>" with the product id.
// Each block's shape is defined by its zod schema in src/components/sections/schemas.ts.
import type { SectionType } from "@/components/sections/schemas";

export type SeedSection = { type: SectionType; content: Record<string, unknown>; isVisible?: boolean };
export type PositionedSeedSection = SeedSection & { position: number };

/**
 * The home page row. Day 5 (CONTENT-CATALOG): its own title (printed as is, without the " | PRESTİJ"
 * suffix) and description, separate from the site-wide defaults in settings.seo. The day-1 values are kept
 * in catalog-seo.ts as previous defaults.
 */
export const homePageMeta = {
  slug: "home",
  kind: "home" as const,
  title: { tr: "Ana Sayfa", en: "Home", ar: "الرئيسية" },
  seo: {
    title: {
      tr: "Sıvı El Sabunu ve Duş Jeli — PRESTİJ, Kayseri",
      en: "Liquid Hand Soap and Shower Gel — PRESTİJ, Kayseri",
      ar: "صابون سائل لليدين وجل استحمام — PRESTİJ، قيصري",
    },
    description: {
      tr: "Kayseri'de üretilen PRESTİJ sıvı el sabunu ve duş jeli: Lavanta Latte, Lavanta, Portakal ve Okyanus. Pompalı şişe, 5 L ve 20 L bidon; ev ve iş yeri için.",
      en: "PRESTİJ liquid hand soap and shower gel, made in Kayseri: Lavender Latte, Lavender, Orange and Ocean, in pump bottles and 5 L or 20 L canisters.",
      ar: "صابون PRESTİJ السائل لليدين وجل الاستحمام من صنع قيصري: لاتيه اللافندر واللافندر والبرتقال والمحيط، بزجاجات بمضخة وعبوات 5 و20 لترًا.",
    },
  },
};

const t = (tr: string, en: string, ar: string) => ({ tr, en, ar });
const qa = (question: ReturnType<typeof t>, answer: ReturnType<typeof t>) => ({ question, answer });

/**
 * Day 5: questions people ask about liquid hand soap, shower gel, canister sizes, samples and business
 * supply, near the end of the page (after the story, before the newsletter). Plain-text answers, like the
 * other FAQ sections, so the panel's text fields show them as written. Also inserted into existing
 * databases by scripts/content-day5.ts (catalogSeo).
 */
export const HOME_FAQ_SECTION: SeedSection = {
  type: "faq",
  content: {
    eyebrow: t("Sıkça sorulanlar", "FAQ", "الأسئلة الشائعة"),
    title: t("Sıvı sabun ve duş jeli hakkında", "About liquid soap and shower gel", "عن الصابون السائل وجل الاستحمام"),
    items: [
      qa(
        t(
          "Sıvı el sabunu ile duş jeli arasındaki fark nedir?",
          "What is the difference between liquid hand soap and shower gel?",
          "ما الفرق بين الصابون السائل لليدين وجل الاستحمام؟",
        ),
        t(
          "Sıvı el sabunu lavabonun başında ellerin temizliği için, duş jeli ise duşta vücut temizliği için kullanılır. PRESTİJ'de Lavanta Latte, Lavanta ve Portakal sıvı el sabunu; Okyanus ise duş jelidir.",
          "Liquid hand soap is for washing hands at the basin, while shower gel is for cleansing the body in the shower. At PRESTİJ, Lavender Latte, Lavender and Orange are liquid hand soaps, and Ocean is a shower gel.",
          "يُستخدم الصابون السائل لليدين لتنظيف اليدين عند المغسلة، أما جل الاستحمام فلتنظيف الجسم في الدش. ولدى PRESTİJ، لاتيه اللافندر واللافندر والبرتقال صابون سائل لليدين، والمحيط جل استحمام.",
        ),
      ),
      qa(
        t(
          "Pompalı şişe, 5 L ve 20 L bidon arasında nasıl seçim yapmalıyım?",
          "How do I choose between the pump bottle and the 5 L and 20 L canisters?",
          "كيف أختار بين الزجاجة بالمضخة وعبوتي 5 و20 لترًا؟",
        ),
        t(
          "Ev ve misafir banyosu için pompalı şişe yeterlidir. Şişelerinizi ve dispenserlerinizi kendiniz doldurmak isterseniz 5 L bidonu, otel, ofis ve restoran gibi tüketimin yüksek olduğu yerlerde 20 L bidonu tercih edebilirsiniz. Üç boyda da formül ve koku aynıdır.",
          "A pump bottle is all you need for the family and guest bathrooms. Choose the 5 L canister if you refill your own bottles and dispensers, and the 20 L canister where consumption is high, such as hotels, offices and restaurants. The formula and scent are the same in all three sizes.",
          "تكفي الزجاجة بالمضخة لحمّام المنزل وحمّام الضيوف. اختر عبوة 5 لترات إذا كنت تعيد تعبئة زجاجاتك وموزّعاتك بنفسك، وعبوة 20 لترًا في الأماكن كثيفة الاستهلاك مثل الفنادق والمكاتب والمطاعم. والتركيبة والرائحة واحدة في الأحجام الثلاثة.",
        ),
      ),
      qa(
        t("Ücretsiz numune alabilir miyim?", "Can I get free samples?", "هل يمكنني الحصول على عيّنات مجانية؟"),
        t(
          "Evet. Oteller, ofisler ve restoranlar gibi işletmeler numune sayfamızdaki formdan ücretsiz numune isteyebilir. Kendiniz için alışveriş yapıyorsanız sepetinize ücretsiz numune ekleyebilirsiniz. Numuneler ücretsizdir ve satılmaz.",
          "Yes. Businesses such as hotels, offices and restaurants can request free samples with the form on our samples page. When shopping for yourself, you can add free samples to your cart. Samples are free and not for sale.",
          "نعم. يمكن للمنشآت مثل الفنادق والمكاتب والمطاعم طلب عيّنات مجانية من خلال النموذج في صفحة العيّنات. وإذا كنت تتسوّق لنفسك، يمكنك إضافة عيّنات مجانية إلى سلّتك. العيّنات مجانية وليست للبيع.",
        ),
      ),
      qa(
        t(
          "İşletmeler için toptan sıvı sabun satışı var mı?",
          "Do you sell liquid soap in bulk to businesses?",
          "هل تبيعون الصابون السائل بالجملة للشركات؟",
        ),
        t(
          "Var. Oteller, spa merkezleri, ofisler, restoranlar ve okullar gibi işletmeler için 5 L ve 20 L bidonlarda toptan sıvı sabun ve duş jeli sunuyoruz. Kurumsal sayfamızdan size özel teklif isteyebilir, firmanız adına faturalı alım yapabilirsiniz.",
          "Yes. We supply liquid soap and shower gel in bulk, in 5 L and 20 L canisters, for businesses such as hotels, spas, offices, restaurants and schools. Request a tailored quote on our business page, and buy with an invoice in your company's name.",
          "نعم. نوفّر الصابون السائل وجل الاستحمام بالجملة في عبوات 5 و20 لترًا لمنشآت مثل الفنادق ومراكز السبا والمكاتب والمطاعم والمدارس. اطلب عرض سعر مخصّصًا من صفحة الشركات، واشترِ بفاتورة باسم شركتك.",
        ),
      ),
      qa(
        t("PRESTİJ ürünleri nerede üretiliyor?", "Where are PRESTİJ products made?", "أين تُصنع منتجات PRESTİJ؟"),
        t(
          "PRESTİJ sıvı el sabunu ve duş jeli, Kayseri'de PRESTİJ Buklet Kozmetik tarafından üretilir.",
          "PRESTİJ liquid hand soap and shower gel are made in Kayseri, Türkiye, by PRESTİJ Buklet Kozmetik.",
          "يُصنع صابون PRESTİJ السائل لليدين وجل الاستحمام في قيصري بتركيا لدى شركة PRESTİJ Buklet Kozmetik.",
        ),
      ),
    ],
  },
};

const sections: SeedSection[] = [
  {
    type: "hero",
    content: {
      layout: "split",
      height: "full",
      align: "start",
      overlay: 35,
      imageId: "@media:PRESTIJ_Lavanta_Latte_Pompali_spa_buzlu_cam",
      eyebrow: { tr: "Sıvı El Sabunu · Duş Jeli", en: "Liquid Hand Soap · Shower Gel", ar: "صابون سائل لليدين · جل استحمام" },
      headline: { tr: "Her dokunuşta prestij.", en: "Prestige in every touch.", ar: "فخامة في كل لمسة." },
      subline: {
        tr: "Lavanta Latte, Lavanta, Portakal ve Okyanus. Evinizin, otelinizin ve spa'nızın lavabosuna yakışan dört imza koku.",
        en: "Lavender Latte, Lavender, Orange and Ocean. Four signature scents made for the basins of your home, hotel and spa.",
        ar: "لاتيه اللافندر واللافندر والبرتقال والمحيط. أربعة عطور مميزة تليق بمغاسل منزلك وفندقك ومنتجعك.",
      },
      primaryCta: { label: { tr: "Koleksiyonu keşfet", en: "Explore the collection", ar: "اكتشف المجموعة" }, href: "/urunler" },
      secondaryCta: { label: { tr: "İşletmeler için", en: "For businesses", ar: "للشركات" }, href: "/kurumsal" },
    },
  },
  {
    type: "scent_showcase",
    content: {
      eyebrow: { tr: "İmza kokular", en: "Signature scents", ar: "عطور مميزة" },
      title: { tr: "Dört koku, tek imza.", en: "Four scents, one signature.", ar: "أربعة عطور، توقيع واحد." },
      intro: {
        tr: "Bir koku seçin; sayfa onun rengine bürünsün.",
        en: "Choose a scent and watch the page take on its colour.",
        ar: "اختر عطراً وشاهد الصفحة تكتسي بلونه.",
      },
      ctaLabel: { tr: "Keşfet", en: "Discover", ar: "اكتشف" },
      items: [
        {
          productId: "@product:lavanta-latte",
          imageId: "@media:PRESTIJ_Lavanta_Latte_Pompali_studyo_fasetli_cam",
          tagline: { tr: "Kremsi, yumuşak ve sakinleştirici", en: "Creamy, soft and soothing", ar: "كريمي، ناعم ومهدّئ" },
        },
        {
          productId: "@product:lavanta",
          imageId: "@media:PRESTIJ_Lavanta_Pompali_studyo_fasetli_cam",
          tagline: { tr: "Dingin, aromatik ve zamansız", en: "Calm, aromatic and timeless", ar: "هادئ، عطري وخالد" },
        },
        {
          productId: "@product:portakal",
          imageId: "@media:PRESTIJ_Portakal_Pompali_studyo_fasetli_cam",
          tagline: { tr: "Güneşli, canlı ve enerjik", en: "Sunny, bright and energising", ar: "مشمس، منعش ومفعم بالحيوية" },
        },
        {
          productId: "@product:okyanus",
          imageId: "@media:PRESTIJ_Okyanus_Pompali_su_yansimali_studyo",
          tagline: { tr: "Serin, berrak ve ferahlatıcı", en: "Cool, clear and refreshing", ar: "بارد، صافٍ ومنعش" },
        },
      ],
    },
  },
  {
    type: "featured_products",
    content: {
      eyebrow: { tr: "Koleksiyon", en: "The collection", ar: "المجموعة" },
      title: { tr: "Banyonuzun yeni imzası", en: "Your bathroom's new signature", ar: "التوقيع الجديد لحمّامك" },
      intro: {
        tr: "Zengin köpük, yumuşak bir his ve kalıcı bir ferahlık.",
        en: "A rich lather, a soft feel and a lingering freshness.",
        ar: "رغوة غنية، ملمس ناعم وانتعاش يدوم.",
      },
      productIds: [],
      limit: 8,
      columns: 4,
      viewAllCta: { label: { tr: "Tüm ürünler", en: "All products", ar: "جميع المنتجات" }, href: "/urunler" },
    },
  },
  {
    type: "packaging",
    content: {
      eyebrow: { tr: "Ambalaj seçenekleri", en: "Formats", ar: "خيارات العبوات" },
      title: { tr: "Her mekâna doğru boy.", en: "The right size for every space.", ar: "الحجم المناسب لكل مكان." },
      intro: {
        tr: "Zarif pompalı şişeden ekonomik 20 litrelik bidona; aynı formül, aynı koku.",
        en: "From the elegant pump bottle to the economical 20 L canister: the same formula, the same scent.",
        ar: "من زجاجة المضخة الأنيقة إلى عبوة 20 لتراً الاقتصادية؛ التركيبة نفسها والعطر نفسه.",
      },
      items: [
        {
          imageId: "@media:PRESTIJ_Okyanus_Pompali_su_yansimali_studyo",
          title: { tr: "Pompalı Şişe", en: "Pump Bottle", ar: "زجاجة بمضخة" },
          audience: { tr: "Ev ve misafir banyosu", en: "Home & guest bathroom", ar: "المنزل وحمّام الضيوف" },
          description: {
            tr: "Lavabonuzda bir dekor objesi gibi duran, cam ve seramik seçenekli zarif şişe.",
            en: "An elegant glass or ceramic bottle that sits on your basin like a décor piece.",
            ar: "زجاجة أنيقة من الزجاج أو السيراميك تزيّن مغسلتك كقطعة ديكور.",
          },
          cta: { label: { tr: "Şişeleri gör", en: "See the bottles", ar: "تصفّح الزجاجات" }, href: "/urunler" },
        },
        {
          imageId: "@media:PRESTIJ_Koleksiyon_5L_yatay_koleksiyon",
          title: { tr: "5 Litre", en: "5 Litres", ar: "5 لترات" },
          audience: { tr: "Ofis, kafe ve restoran", en: "Office, café & restaurant", ar: "المكاتب والمقاهي والمطاعم" },
          description: {
            tr: "Dispenserleri ve şişeleri pratikçe doldurmak için ekonomik yedek bidon.",
            en: "An economical refill canister for topping up dispensers and bottles with ease.",
            ar: "عبوة تعبئة اقتصادية لملء الموزّعات والزجاجات بسهولة.",
          },
          cta: { label: { tr: "5 L ürünler", en: "Shop 5 L", ar: "تسوّق 5 لترات" }, href: "/urunler" },
        },
        {
          imageId: "@media:PRESTIJ_Portakal_20L_yatay_etiket_traverten",
          title: { tr: "20 Litre", en: "20 Litres", ar: "20 لتراً" },
          audience: { tr: "Otel, spa ve büyük tesisler", en: "Hotels, spas & large venues", ar: "الفنادق والمنتجعات والمنشآت الكبيرة" },
          description: {
            tr: "Yüksek tüketimli işletmeler için en avantajlı litre fiyatı ve faturalı alım.",
            en: "The best price per litre for high-volume venues, with invoiced purchasing.",
            ar: "أفضل سعر لكل لتر للمنشآت ذات الاستهلاك العالي، مع الشراء بفاتورة.",
          },
          cta: { label: { tr: "Kurumsal teklif", en: "Get a business quote", ar: "اطلب عرض سعر" }, href: "/kurumsal" },
        },
      ],
    },
  },
  {
    type: "lifestyle_gallery",
    content: {
      eyebrow: { tr: "Yaşam alanlarında", en: "In everyday spaces", ar: "في المساحات اليومية" },
      title: {
        tr: "Mermerden mutfağa, otelden spa'ya.",
        en: "From marble to kitchen, hotel to spa.",
        ar: "من الرخام إلى المطبخ، ومن الفندق إلى المنتجع.",
      },
      items: [
        {
          imageId: "@media:PRESTIJ_Lavanta_Latte_Pompali_beyaz_mermer_yivli_cam",
          caption: { tr: "Beyaz mermer banyoda Lavanta Latte", en: "Lavender Latte in a white marble bathroom", ar: "لاتيه اللافندر في حمّام من الرخام الأبيض" },
          href: "/urunler/lavanta-latte",
        },
        {
          imageId: "@media:PRESTIJ_Lavanta_Pompali_otel_fume_cam",
          caption: { tr: "Lüks bir otel lavabosunda Lavanta", en: "Lavender at a luxury hotel basin", ar: "اللافندر على مغسلة فندق فاخر" },
          href: "/urunler/lavanta",
        },
        {
          imageId: "@media:PRESTIJ_Portakal_Pompali_mutfak_krem_seramik",
          caption: { tr: "Aydınlık bir mutfakta Portakal", en: "Orange in a sunlit kitchen", ar: "البرتقال في مطبخ مشمس" },
          href: "/urunler/portakal",
        },
        {
          imageId: "@media:PRESTIJ_Okyanus_Pompali_deniz_manzarali_banyo",
          caption: { tr: "Deniz manzaralı banyoda Okyanus", en: "Ocean in a sea-view bathroom", ar: "المحيط في حمّام مطل على البحر" },
          href: "/urunler/okyanus",
        },
        {
          imageId: "@media:PRESTIJ_Lavanta_5L_butik_otel_aksam",
          caption: { tr: "Butik otelde akşam ışığı", en: "Evening light at a boutique hotel", ar: "ضوء المساء في فندق بوتيك" },
        },
        {
          imageId: "@media:PRESTIJ_Portakal_Pompali_spa_amber_cam",
          caption: { tr: "Doğal spa ortamında amber cam", en: "Amber glass in a natural spa setting", ar: "زجاج كهرماني في أجواء منتجع طبيعي" },
        },
        {
          imageId: "@media:PRESTIJ_Okyanus_Pompali_resort_seramik",
          caption: { tr: "Açık hava resort duşunda", en: "At an open-air resort shower", ar: "في دشّ منتجع في الهواء الطلق" },
        },
        {
          imageId: "@media:PRESTIJ_Lavanta_Latte_5L_spa_servis_arabasi",
          caption: { tr: "Spa servis arabasında 5 litre", en: "The 5 L on a spa service trolley", ar: "عبوة 5 لترات على عربة خدمة في المنتجع" },
        },
      ],
    },
  },
  {
    type: "b2b_cta",
    content: {
      eyebrow: { tr: "PRESTİJ Kurumsal", en: "PRESTİJ for Business", ar: "PRESTİJ للشركات" },
      title: {
        tr: "Misafirleriniz farkı ilk dokunuşta hisseder.",
        en: "Your guests feel the difference at first touch.",
        ar: "يشعر ضيوفك بالفرق من اللمسة الأولى.",
      },
      body: {
        tr: "Oteller, spa merkezleri, ofisler ve restoranlar için 5 L ve 20 L ekonomik ambalajlar, size özel fiyatlar ve düzenli tedarik.",
        en: "Economical 5 L and 20 L formats, tailored pricing and dependable supply for hotels, spas, offices and restaurants.",
        ar: "عبوات اقتصادية بسعة 5 و20 لتراً، وأسعار مخصّصة لك، وتوريد منتظم للفنادق والمنتجعات والمكاتب والمطاعم.",
      },
      bullets: [
        { tr: "Size özel kurumsal fiyat", en: "Business pricing tailored to you", ar: "أسعار خاصة بالشركات" },
        { tr: "Toplu alımda kademeli indirim", en: "Tiered discounts on volume orders", ar: "خصومات متدرّجة على الكميات" },
        { tr: "Faturalı satış ve kurumsal hesap", en: "Invoiced sales and a business account", ar: "بيع بفاتورة وحساب للشركات" },
        { tr: "Ücretsiz numune gönderimi", en: "Free samples, delivered", ar: "عيّنات مجانية تصلك" },
      ],
      cta: { label: { tr: "Kurumsal teklif alın", en: "Get a business quote", ar: "اطلب عرض سعر" }, href: "/kurumsal" },
      secondaryCta: { label: { tr: "Ücretsiz numune isteyin", en: "Request free samples", ar: "اطلب عيّنات مجانية" }, href: "/numune" },
      imageId: "@media:PRESTIJ_Lavanta_Latte_Pompali_otel_fume_cam",
    },
  },
  {
    type: "sample_cta",
    content: {
      eyebrow: { tr: "Ücretsiz numune", en: "Free samples", ar: "عيّنات مجانية" },
      title: {
        tr: "Kokuları önce kendi mekânınızda deneyin.",
        en: "Try the scents in your own space first.",
        ar: "جرّب العطور في مكانك أولاً.",
      },
      body: {
        tr: "Otel, spa, ofis ya da restoran fark etmez: formu doldurun, seçtiğiniz kokuların numunelerini ücretsiz gönderelim. Karar vermeden önce köpüğü, kokuyu ve cildinizde bıraktığı hissi deneyimleyin.",
        en: "Hotel, spa, office or restaurant: fill in the form and we will send samples of the scents you choose, free of charge. Experience the lather, the fragrance and the feel on your skin before you decide.",
        ar: "سواء كنت فندقاً أو منتجعاً أو مكتباً أو مطعماً: املأ النموذج وسنرسل إليك عيّنات مجانية من العطور التي تختارها. جرّب الرغوة والعطر والإحساس على بشرتك قبل أن تقرّر.",
      },
      note: { tr: "Numuneler para ile satılmaz.", en: "Samples are not for sale.", ar: "العيّنات ليست للبيع." },
      cta: { label: { tr: "Numune talep edin", en: "Request samples", ar: "اطلب العيّنات" }, href: "/numune" },
      imageId: "@media:PRESTIJ_Lavanta_5L_sabunluga_dolum_son",
    },
  },
  {
    type: "story",
    content: {
      eyebrow: { tr: "Hikâyemiz", en: "Our story", ar: "قصتنا" },
      title: { tr: "Kayseri'den, özenle.", en: "From Kayseri, with care.", ar: "من قيصري، بعناية." },
      body: {
        tr: "PRESTİJ, gündelik bir alışkanlığı küçük bir ritüele dönüştürme fikriyle doğdu. Ellerinizi yıkadığınız o birkaç saniyenin de özenle tasarlanmayı hak ettiğine inanıyoruz.\n\nFormüllerimizi Kayseri'de üretiyor; zengin köpüğü, yumuşak dokuyu ve kalıcı kokuyu bir araya getiriyoruz. Lavanta Latte'nin kremsi sakinliğinden Okyanus'un serin ferahlığına, her koku kendi rengini ve karakterini taşıyor.\n\nEvinizde ya da misafirlerinizi ağırladığınız mekânda; PRESTİJ temizliği bir his hâline getirir.",
        en: "PRESTİJ was born from a simple idea: turning an everyday habit into a small ritual. We believe the few seconds you spend washing your hands deserve to be designed with care.\n\nWe make our formulas in Kayseri, bringing together a rich lather, a soft texture and a lasting scent. From the creamy calm of Lavender Latte to the cool freshness of Ocean, each scent carries its own colour and character.\n\nAt home or wherever you welcome your guests, PRESTİJ turns clean into a feeling.",
        ar: "وُلدت PRESTİJ من فكرة بسيطة: تحويل عادة يومية إلى طقس صغير. نؤمن بأن الثواني القليلة التي تغسل فيها يديك تستحق أن تُصمَّم بعناية.\n\nنُنتج تركيباتنا في قيصري، لنجمع بين الرغوة الغنية والملمس الناعم والعطر الذي يدوم. من هدوء لاتيه اللافندر الكريمي إلى انتعاش المحيط البارد، يحمل كل عطر لونه وشخصيته الخاصة.\n\nفي منزلك أو حيثما تستقبل ضيوفك، تجعل PRESTİJ النظافة إحساساً.",
      },
      imageId: "@media:PRESTIJ_Koleksiyon_5L_dikey_koleksiyon",
      imagePosition: "start",
      stats: [
        { value: { tr: "4" }, label: { tr: "İmza koku", en: "Signature scents", ar: "عطور مميزة" } },
        { value: { tr: "3" }, label: { tr: "Ambalaj boyu", en: "Formats", ar: "أحجام العبوات" } },
        { value: { tr: "Kayseri", en: "Kayseri", ar: "قيصري" }, label: { tr: "Üretim yeri", en: "Made in", ar: "مكان الإنتاج" } },
      ],
      signature: { tr: "PRESTİJ ailesi", en: "The PRESTİJ family", ar: "عائلة PRESTİJ" },
      cta: { label: { tr: "Bize ulaşın", en: "Get in touch", ar: "تواصل معنا" }, href: "/iletisim" },
    },
  },
  HOME_FAQ_SECTION,
  {
    type: "newsletter",
    content: {
      eyebrow: { tr: "Bülten", en: "Newsletter", ar: "النشرة البريدية" },
      imageId: "@media:PRESTIJ_Portakal_5L_amber_gunisigi_studyo",
    },
  },
];

/** In display order; position is the array index. */
export const homeSections: PositionedSeedSection[] = sections.map((section, position) => ({ ...section, position }));
