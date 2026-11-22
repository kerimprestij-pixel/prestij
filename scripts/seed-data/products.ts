// Product catalog content. Label texts (usage, warnings, ingredients) are copied exactly as printed,
// typos included: the client will correct them in the panel. One addition: the hand-soap warnings start
// with the eye-contact caution the printed label lacks (day-5 verification). Prices are PLACEHOLDERS.
// Day 5 (CONTENT-CATALOG): each description is the day-1 `story` followed by the factual sections in
// catalog-copy.ts (PRODUCT_DETAILS), and `seo` holds the page title and meta description.
import type { LocalizedText } from "@/db/schema/common";
import { PRODUCT_DETAILS, PRODUCT_SEO, type ProductCopySlug } from "./catalog-copy";
import type { LocaleFixes } from "./content-fixes";
import type { Ambalaj, Urun } from "./image-list";

export type L = LocalizedText;

export const BRAND = "PRESTİJ";

export type PackKey = "pump" | "5l" | "20l";

export const PACKAGING: Record<
  PackKey,
  { label: L; skuSuffix: string; price: number; volumeMl: number; weightGrams: number }
> = {
  pump: {
    label: { tr: "Pompalı Şişe 500 ml", en: "Pump Bottle 500 ml", ar: "زجاجة بمضخة 500 مل" },
    skuSuffix: "500",
    price: 14990,
    volumeMl: 500,
    weightGrams: 750,
  },
  "5l": {
    label: { tr: "5 L Bidon", en: "5 L Canister", ar: "عبوة 5 لترات" },
    skuSuffix: "5L",
    price: 44990,
    volumeMl: 5000,
    weightGrams: 5300,
  },
  "20l": {
    label: { tr: "20 L Bidon", en: "20 L Canister", ar: "عبوة 20 لترًا" },
    skuSuffix: "20L",
    price: 149990,
    volumeMl: 20000,
    weightGrams: 21000,
  },
};

export const PACK_ORDER: readonly PackKey[] = ["pump", "5l", "20l"];

/** Which variant a CSV image belongs to. */
export function packOf(ambalaj: Ambalaj): PackKey {
  return ambalaj === "pump" ? "pump" : ambalaj === "5l" ? "5l" : "20l";
}

export const OPTION_NAME: L = { tr: "Ambalaj", en: "Packaging", ar: "العبوة" };

export const CLAIMS = ["effective_cleaning", "skin_caring", "fresh_scent", "soft_feel"];

const HAND_SOAP = {
  subtitle: { tr: "Sıvı El Sabunu", en: "Liquid Hand Soap", ar: "صابون سائل لليدين" },
  usage: {
    tr: "El temizliğinde kullanılır. Yeterli miktarda ürün ıslak ele alınır, ovalayarak köpürtülür. Su ile durulanır.",
    en: "For cleansing hands. Apply a sufficient amount to wet hands and lather by rubbing. Rinse with water.",
    ar: "يُستخدم لتنظيف اليدين. توضع كمية كافية من المنتج على اليدين المبللتين وتُفرك حتى تتكوّن الرغوة، ثم تُشطف بالماء.",
  },
  // The printed label text, after the eye-contact caution the label lacks (day-5 verification,
  // HAND_SOAP_WARNINGS_FIXES): the "Uyarılar" panel must not be weaker than the description's usage text.
  warnings: {
    tr: "Göz ile temasından kaçının; temas hâlinde bol suyla durulayın. Isı ve direkt güneş ışığından uzakta ve çocukların ulaşamayacağı yerde muhafaza edilir.",
    en: "Avoid contact with the eyes; in case of contact, rinse with plenty of water. Store away from heat and direct sunlight, out of the reach of children.",
    ar: "تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء. يُحفظ بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.",
  },
  ingredients:
    "Aqua, Sodium Laureth Sulfate, Glycerin, Cocamidopropyl Betaine, Tetrasodium EDTA, Sodium Chloride, Citrus Sinensis Peel Oil, Sodium Benzoate, CI 45370, Citric Acid.",
} satisfies { subtitle: L; usage: L; warnings: L; ingredients: string };

/**
 * The hand-soap warnings as days 1–4 seeded them (the printed label text alone) became the text above.
 * scripts/content-day5.ts (catalogSeo) updates the three hand soaps and their samples only while their
 * warnings still equal the label text; the client should add the caution to the printed label as well.
 */
export const HAND_SOAP_WARNINGS_FIXES: LocaleFixes = {
  tr: [{ round: 2, before: "Isı ve direkt", after: "Göz ile temasından kaçının; temas hâlinde bol suyla durulayın. Isı ve direkt" }],
  en: [{ round: 2, before: "Store away from heat", after: "Avoid contact with the eyes; in case of contact, rinse with plenty of water. Store away from heat" }],
  ar: [{ round: 2, before: "يُحفظ بعيدًا", after: "تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء. يُحفظ بعيدًا" }],
};

const SHOWER_GEL = {
  subtitle: { tr: "Duş Jeli", en: "Shower Gel", ar: "جل الاستحمام" },
  usage: {
    tr: "Vücut temizliği içindir. Islak cilde veya life uygulayıp köpürtün. Bol suyla durulayın.",
    en: "For body cleansing. Apply to wet skin or a washcloth and lather. Rinse thoroughly with water.",
    ar: "لتنظيف الجسم. يوضع على البشرة المبللة أو على الليفة ويُفرك حتى تتكوّن الرغوة، ثم يُشطف جيدًا بالماء.",
  },
  warnings: {
    tr: "Harici kullanım içindir. Gözle temasından kaçının; temas halinde bol suyla durulayın. Tahriş oluşursa kullanımı bırakın. Çocukların ulaşamayacağı, serin ve güneş almayan yerde saklayın.",
    en: "For external use only. Avoid contact with eyes; in case of contact, rinse thoroughly with water. Discontinue use if irritation occurs. Keep out of the reach of children and store in a cool place away from sunlight.",
    ar: "للاستخدام الخارجي فقط. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما جيدًا بالماء. أوقف الاستخدام في حال حدوث تهيّج. يُحفظ بعيدًا عن متناول الأطفال في مكان بارد بعيدًا عن أشعة الشمس.",
  },
  ingredients:
    "Aqua, Sodyum Laurent Sülfate, Cocamidoprppyl Betaine, Sodyım Clorıde, Parfum, Glycerin, Sitrik Asit, Etilen Diamin Tetra Asetik asit.",
} satisfies { subtitle: L; usage: L; warnings: L; ingredients: string };

/** Spec rows printed on every label. */
const LABEL_SPECS: { label: L; value: L }[] = [
  { label: { tr: "Menşei", en: "Origin", ar: "بلد المنشأ" }, value: { tr: "Türkiye", en: "Türkiye", ar: "تركيا" } },
  {
    label: { tr: "Açıldıktan sonra kullanım", en: "Period after opening", ar: "مدة الاستخدام بعد الفتح" },
    value: { tr: "12 ay", en: "12 months", ar: "12 شهرًا" },
  },
];

export type ScentProduct = {
  urun: Exclude<Urun, "collection">;
  slug: string;
  skuCode: string;
  category: "el-sabunu" | "dus-jeli";
  name: L;
  accentColor: string;
  barcodes: Record<PackKey, string | null>;
  shortDescription: L;
  /** The seeded description until day 4: the poetic paragraphs that open `description`. */
  story: L;
  /** `story` + the day-5 sections (Ürün özellikleri, Günlük kullanım, Bidonlar ve yeniden doldurma). */
  description: L;
  /** Page title (without the " | PRESTİJ" suffix) and meta description. */
  seo: { title: L; description: L };
  subtitle: L;
  usage: L;
  warnings: L;
  ingredients: string;
  specs: { label: L; value: L }[];
};

const p = (...paragraphs: string[]) => paragraphs.map((t) => `<p>${t}</p>`).join("");

/** The story followed by the day-5 sections, per locale. */
export function withDetails(story: L, slug: ProductCopySlug): L {
  const details = PRODUCT_DETAILS[slug];
  return { tr: story.tr + details.tr, en: (story.en ?? "") + (details.en ?? ""), ar: (story.ar ?? "") + (details.ar ?? "") };
}

const SCENT_SEEDS: (Omit<ScentProduct, "description" | "seo"> & { slug: ProductCopySlug })[] = [
  {
    urun: "lavanta_latte",
    slug: "lavanta-latte",
    skuCode: "LVL",
    category: "el-sabunu",
    name: { tr: "Lavanta Latte", en: "Lavender Latte", ar: "لاتيه اللافندر" },
    accentColor: "#C2ADD1",
    // The 5 L label repeats the 20 L barcode (8685317540085); left empty until the client confirms it.
    barcodes: { pump: null, "5l": null, "20l": "8685317540085" },
    shortDescription: {
      tr: "Lavanta dallarının sakinliği, sıcak fildişi tonlarıyla buluşuyor.",
      en: "The calm of lavender sprigs, wrapped in warm ivory tones.",
      ar: "سكينة أغصان اللافندر تلتقي بدفء درجات العاج.",
    },
    story: {
      tr: p(
        "Lavanta Latte, lavanta dallarının dingin zarafetini sıcak fildişi tonlarının yumuşaklığıyla bir araya getirir. Sedefli dokulardan ilham alan bu koku, lavabonun başında geçen kısa anı küçük bir dinlenme molasına dönüştürür.",
        "Evde, otel odalarında ya da spa alanlarında; sakin ve zamansız bir dokunuş isteyen her mekâna yakışır. Pompalı şişe günlük kullanım için, 5 L ve 20 L bidonlar ise yoğun kullanılan alanların dolumu için hazırdır.",
      ),
      en: p(
        "Lavender Latte brings together the quiet elegance of lavender sprigs and the softness of warm ivory tones. Inspired by pearlescent textures, it turns the brief moment at the basin into a small pause.",
        "At home, in hotel rooms or in spa areas, it suits every space that calls for a calm, timeless touch. The pump bottle is made for everyday use; the 5 L and 20 L canisters are ready for refilling busy spaces.",
      ),
      ar: p(
        "يجمع لاتيه اللافندر بين الأناقة الهادئة لأغصان اللافندر ونعومة درجات العاج الدافئة. مستوحى من الملمس اللؤلؤي، يحوّل اللحظة القصيرة عند المغسلة إلى استراحة صغيرة.",
        "في المنزل أو غرف الفنادق أو مساحات السبا، يناسب كل مكان يحتاج إلى لمسة هادئة وخالدة. الزجاجة بالمضخة للاستخدام اليومي، وعبوتا 5 لترات و20 لترًا جاهزتان لإعادة التعبئة في الأماكن كثيفة الاستخدام.",
      ),
    },
    ...HAND_SOAP,
    specs: LABEL_SPECS,
  },
  {
    urun: "lavanta",
    slug: "lavanta",
    skuCode: "LAV",
    category: "el-sabunu",
    name: { tr: "Lavanta", en: "Lavender", ar: "اللافندر" },
    accentColor: "#8E61B6",
    barcodes: { pump: null, "5l": "8685317540009", "20l": "8685317540030" },
    shortDescription: {
      tr: "Lavanta çiçekleri, ametist tonları ve altın detaylarla klasik bir zarafet.",
      en: "Lavender blossoms, amethyst hues and golden details: a classic elegance.",
      ar: "زهور اللافندر ودرجات الجمشت وتفاصيل ذهبية: أناقة كلاسيكية.",
    },
    story: {
      tr: p(
        "Lavanta, adını aldığı çiçeğin tanıdık huzurunu ametist tonları ve altın detaylarla yeniden yorumlar. Derin mor renkler ve ışıltılı ayrıntılar, her kullanımda klasik bir zarafet hissi bırakır.",
        "Ev banyosundan misafir lavabosuna, butik otellerden ofislere kadar; köklü ve güven veren bir atmosfer isteyen mekânlar için tasarlandı.",
      ),
      en: p(
        "Lavender reinterprets the familiar serenity of its namesake flower with amethyst hues and golden details. Deep purple tones and luminous accents leave a sense of classic elegance with every use.",
        "From the family bathroom to the guest washroom, from boutique hotels to offices, it was designed for spaces that call for a rooted, reassuring atmosphere.",
      ),
      ar: p(
        "يعيد اللافندر تفسير السكينة المألوفة للزهرة التي يحمل اسمها، بدرجات الجمشت وتفاصيل ذهبية. ألوان بنفسجية عميقة ولمسات متألقة تترك إحساسًا بأناقة كلاسيكية مع كل استخدام.",
        "من حمّام المنزل إلى مغسلة الضيوف، ومن الفنادق البوتيكية إلى المكاتب، صُمّم للأماكن التي تحتاج إلى أجواء أصيلة تبعث على الطمأنينة.",
      ),
    },
    ...HAND_SOAP,
    specs: LABEL_SPECS,
  },
  {
    urun: "portakal",
    slug: "portakal",
    skuCode: "POR",
    category: "el-sabunu",
    name: { tr: "Portakal", en: "Orange", ar: "البرتقال" },
    accentColor: "#E9952E",
    barcodes: { pump: null, "5l": "8685317540023", "20l": "8685317540016" },
    shortDescription: {
      tr: "Narenciyenin canlılığı, amber yansımalar ve gün ışığının sıcaklığı.",
      en: "The brightness of citrus, amber reflections and the warmth of daylight.",
      ar: "حيوية الحمضيات وانعكاسات الكهرمان ودفء ضوء النهار.",
    },
    story: {
      tr: p(
        "Portakal, narenciyenin canlı enerjisini amber yansımalar ve gün ışığının sıcaklığıyla buluşturur. Güne aydınlık bir başlangıç ya da öğleden sonra ferah bir mola için ilham veren bir eşlikçi.",
        "Aydınlık mutfaklarda, güneş alan banyolarda ve misafirlerin ağırlandığı her mekânda sıcak, davetkâr bir atmosfer yaratır.",
      ),
      en: p(
        "Orange pairs the lively energy of citrus with amber reflections and the warmth of daylight: an inspiring companion for a bright start to the day or a fresh afternoon pause.",
        "In sunlit kitchens, bright bathrooms and every space where guests are welcomed, it creates a warm, inviting atmosphere.",
      ),
      ar: p(
        "يجمع البرتقال بين طاقة الحمضيات النابضة وانعكاسات الكهرمان ودفء ضوء النهار، رفيقًا ملهمًا لبداية يوم مشرقة أو لاستراحة منعشة بعد الظهر.",
        "في المطابخ المضيئة والحمّامات المشمسة وكل مكان يُستقبل فيه الضيوف، يخلق أجواءً دافئة ومرحّبة.",
      ),
    },
    ...HAND_SOAP,
    specs: LABEL_SPECS,
  },
  {
    urun: "okyanus",
    slug: "okyanus",
    skuCode: "OKY",
    category: "dus-jeli",
    name: { tr: "Okyanus", en: "Ocean", ar: "المحيط" },
    accentColor: "#329BC0",
    barcodes: { pump: null, "5l": "8685317540078", "20l": "8685317540061" },
    shortDescription: {
      tr: "Suyun berraklığı, köpüğün hafifliği ve safir mavisinin derinliği.",
      en: "The clarity of water, the lightness of foam and the depth of sapphire blue.",
      ar: "صفاء الماء وخفّة الرغوة وعمق الأزرق الياقوتي.",
    },
    story: {
      tr: p(
        "Okyanus, suyun berraklığını, köpüğün hafifliğini ve safir mavisinin derinliğini duş ritüelinize taşır. Her duşta denizin ferahlığını hatırlatan sakin bir an.",
        "Ev banyolarından otel duşlarına, spa ve resort alanlarına kadar; serin ve aydınlık bir atmosfer arayan mekânlar için. Pompalı şişe günlük kullanım için, 5 L ve 20 L bidonlar yoğun kullanılan alanların dolumu için.",
      ),
      en: p(
        "Ocean brings the clarity of water, the lightness of foam and the depth of sapphire blue to your shower ritual: a calm moment that recalls the freshness of the sea.",
        "From home bathrooms to hotel showers, spas and resorts, it is made for spaces seeking a cool, luminous atmosphere. The pump bottle suits everyday use; the 5 L and 20 L canisters make refilling busy spaces easy.",
      ),
      ar: p(
        "يحمل المحيط صفاء الماء وخفّة الرغوة وعمق الأزرق الياقوتي إلى طقوس استحمامك، لحظة هادئة تذكّر بانتعاش البحر.",
        "من حمّامات المنازل إلى دشات الفنادق ومساحات السبا والمنتجعات، صُمّم للأماكن التي تبحث عن أجواء منعشة ومضيئة. الزجاجة بالمضخة للاستخدام اليومي، وعبوتا 5 لترات و20 لترًا لإعادة التعبئة بسهولة في الأماكن كثيفة الاستخدام.",
      ),
    },
    ...SHOWER_GEL,
    specs: LABEL_SPECS,
  },
];

export const SCENTS: ScentProduct[] = SCENT_SEEDS.map((scent) => ({
  ...scent,
  description: withDetails(scent.story, scent.slug),
  seo: PRODUCT_SEO[scent.slug],
}));

const BUNDLE_SEED = {
  slug: "dort-koku-koleksiyonu",
  sku: "PR-SET-4X5L",
  price: 159990,
  accentColor: "#B8974F",
  name: { tr: "Dört Koku Koleksiyonu", en: "Four-Scent Collection", ar: "مجموعة الروائح الأربع" },
  subtitle: { tr: "4 × 5 L Bidon Seti", en: "4 × 5 L Canister Set", ar: "طقم 4 عبوات × 5 لترات" },
  shortDescription: {
    tr: "Lavanta Latte, Lavanta, Portakal ve Okyanus: dört koku, 5 litrelik bidonlarda bir arada.",
    en: "Lavender Latte, Lavender, Orange and Ocean: four scents together in 5 L canisters.",
    ar: "لاتيه اللافندر واللافندر والبرتقال والمحيط: أربع روائح معًا في عبوات 5 لترات.",
  },
  story: {
    tr: p(
      "PRESTİJ koleksiyonunun dört kokusu tek bir sette: Lavanta Latte, Lavanta ve Portakal sıvı el sabunları ile Okyanus duş jeli, 5 litrelik bidonlarda.",
      "Her alana ayrı bir atmosfer kurmak isteyen evler, oteller ve işletmeler için; aynı zamanda özenle hazırlanmış bir hediye.",
    ),
    en: p(
      "The four scents of the PRESTİJ collection in a single set: Lavender Latte, Lavender and Orange liquid hand soaps with Ocean shower gel, in 5 L canisters.",
      "For homes, hotels and businesses that want a different atmosphere in every space, and a thoughtfully prepared gift.",
    ),
    ar: p(
      "روائح مجموعة PRESTİJ الأربع في طقم واحد: صابون اليدين السائل لاتيه اللافندر واللافندر والبرتقال مع جل الاستحمام المحيط، في عبوات 5 لترات.",
      "للمنازل والفنادق والشركات التي ترغب في أجواء مختلفة لكل مساحة، وهدية مُعدّة بعناية.",
    ),
  },
} as const;

export const BUNDLE = {
  ...BUNDLE_SEED,
  description: withDetails(BUNDLE_SEED.story, BUNDLE_SEED.slug),
  seo: PRODUCT_SEO[BUNDLE_SEED.slug],
} as const;

export const SAMPLE = {
  subtitle: { tr: "Ücretsiz numune", en: "Free sample", ar: "عينة مجانية" },
  nameSuffix: { tr: "Numune", en: "Sample", ar: "عينة" },
  shortDescription: {
    tr: "Satılmaz. Siparişinize ücretsiz eklenebilen deneme boyu.",
    en: "Not for sale. A trial size you can add to your order free of charge.",
    ar: "ليست للبيع. حجم تجريبي يمكن إضافته إلى طلبك مجانًا.",
  },
  price: 0,
  stock: 500,
} as const;
