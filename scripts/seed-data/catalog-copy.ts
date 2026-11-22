// Day-5 catalog copy (CONTENT-CATALOG, docs/DAY5-SEO.md §5.5): product SEO texts and the factual sections
// appended to each product description, and the category names, SEO texts, editorial bodies and FAQs.
// Turkish first; English and Arabic are complete translations. Rules (§2): only label claims (etkili
// temizlik, cildi koruyan, ferah koku, yumuşak his), no medical claims, no invented facts, no prices and no
// pump bottle volume. Internal links are canonical Turkish paths; the storefront localizes them.
// Pure data (no DB): used by the seed definitions (products.ts, site.ts) and scripts/content-day5.ts.
import type { LocalizedText } from "@/db/schema/common";
import type { LocaleFixes, PathFixes } from "./content-fixes";

type L = LocalizedText;
type Seo = { title: L; description: L };
export type CategoryFaqSeed = { question: L; answer: L };

const t = (tr: string, en: string, ar: string): L => ({ tr, en, ar });
const html = (...parts: string[]) => parts.join("");
const h2 = (text: string) => `<h2>${text}</h2>`;
const p = (text: string) => `<p>${text}</p>`;
const ul = (...items: string[]) => `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
const row = (label: string, text: string) => `<strong>${label}:</strong> ${text}`;
const a = (href: string, text: string) => `<a href="${href}">${text}</a>`;

// ---------------------------------------------------------------------------------------------
// Products: blocks shared by the three hand soaps

const HAND_SOAP_USE = t(
  html(
    h2("Günlük kullanım"),
    p(
      "Ellerinizi ıslatın, avucunuza yeterli miktarda sabun alın ve parmak aralarınıza, tırnak diplerinize kadar en az 20 saniye köpürterek ovun. Ardından bol suyla durulayıp temiz bir havluyla kurulayın. Göz ile temasından kaçının; temas hâlinde bol suyla durulayın.",
    ),
  ),
  html(
    h2("Everyday use"),
    p(
      "Wet your hands, take a sufficient amount of soap and lather for at least 20 seconds, including between your fingers and around your nails. Then rinse thoroughly and dry with a clean towel. Avoid contact with the eyes; in case of contact, rinse with plenty of water.",
    ),
  ),
  html(
    h2("الاستخدام اليومي"),
    p(
      "بلّل يديك وضع في راحتك كمية كافية من الصابون، ثم افركهما برغوته لمدة 20 ثانية على الأقل، بما في ذلك ما بين الأصابع وحول الأظافر. اشطفهما بعد ذلك جيدًا بالماء وجفّفهما بمنشفة نظيفة. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء.",
    ),
  ),
);

const HAND_SOAP_REFILL = t(
  html(
    h2("Bidonlar ve yeniden doldurma"),
    p(
      "5 L ve 20 L bidonlar, pompalı şişeleri ve sıvı sabun dispenserlerini yeniden doldurmak içindir; aynı formülü ve aynı kokuyu taşırlar. Doldurmadan önce şişeyi tamamen boşaltın, ılık suyla temizleyip kurumaya bırakın; kalan sabunun üzerine ekleme yapmayın. Bidonun kapağını her kullanımdan sonra sıkıca kapatın ve ısı ile doğrudan güneş ışığından uzakta saklayın.",
    ),
    p(`İşletmeniz için düzenli alım planlıyorsanız ${a("/kurumsal", "toptan sıvı sabun")} sayfamızdan size özel teklif isteyebilirsiniz.`),
  ),
  html(
    h2("Canisters and refilling"),
    p(
      "The 5 L and 20 L canisters are made for refilling pump bottles and liquid soap dispensers, with the same formula and the same scent. Before refilling, empty the bottle completely, wash it with warm water and let it dry; do not top up the soap that is left. Close the canister tightly after each use and store it away from heat and direct sunlight.",
    ),
    p(`Planning regular orders for your business? Request a tailored quote on our ${a("/kurumsal", "bulk liquid soap")} page.`),
  ),
  html(
    h2("العبوات الكبيرة وإعادة التعبئة"),
    p(
      "صُمّمت عبوتا 5 و20 لترًا لإعادة تعبئة زجاجات المضخة وموزّعات الصابون السائل، وهما تحملان التركيبة نفسها والرائحة نفسها. قبل إعادة التعبئة أفرغ الزجاجة تمامًا واغسلها بالماء الدافئ واتركها تجفّ، ولا تُضِف صابونًا جديدًا فوق ما تبقّى منه. أغلق العبوة بإحكام بعد كل استخدام واحفظها بعيدًا عن الحرارة وأشعة الشمس المباشرة.",
    ),
    p(`هل تخطّط لطلبات منتظمة لمنشأتك؟ اطلب عرض سعر مخصّصًا من صفحة ${a("/kurumsal", "الصابون السائل بالجملة")}.`),
  ),
);

/** "Ürün özellikleri" list of one scent (type, scent, formats, where to use). */
function features(scent: L, places: L, type: L): L {
  return t(
    html(
      h2("Ürün özellikleri"),
      ul(
        row("Ürün türü", type.tr),
        row("Koku", scent.tr),
        row("Ambalaj seçenekleri", "pompalı şişe, 5 L bidon ve 20 L bidon"),
        row("Nerelerde kullanılır", places.tr),
      ),
    ),
    html(
      h2("Product features"),
      ul(
        row("Product type", type.en!),
        row("Scent", scent.en!),
        row("Formats", "pump bottle, 5 L canister and 20 L canister"),
        row("Where to use it", places.en!),
      ),
    ),
    html(
      h2("مواصفات المنتج"),
      ul(
        row("نوع المنتج", type.ar!),
        row("الرائحة", scent.ar!),
        row("خيارات العبوة", "زجاجة بمضخة، وعبوة 5 لترات، وعبوة 20 لترًا"),
        row("أماكن الاستخدام", places.ar!),
      ),
    ),
  );
}

const HAND_SOAP_TYPE = t("sıvı el sabunu", "liquid hand soap", "صابون سائل لليدين");
const SHOWER_GEL_TYPE = t("duş jeli", "shower gel", "جل استحمام");

const join = (...blocks: L[]): L => t(html(...blocks.map((b) => b.tr)), html(...blocks.map((b) => b.en!)), html(...blocks.map((b) => b.ar!)));

// ---------------------------------------------------------------------------------------------
// Products: what day 5 adds to each description (after the existing paragraphs) and the SEO texts

export type ProductCopySlug = "lavanta-latte" | "lavanta" | "portakal" | "okyanus" | "dort-koku-koleksiyonu";

/** Sections appended to the seeded description (the poetic paragraphs stay first). */
export const PRODUCT_DETAILS: Record<ProductCopySlug, L> = {
  "lavanta-latte": join(
    features(
      t(
        "Lavanta Latte; lavantanın dinginliği, kremsi ve yumuşak bir karakterle",
        "Lavender Latte, the calm of lavender with a creamy, soft character",
        "لاتيه اللافندر، سكينة اللافندر بطابع كريمي ناعم",
      ),
      t(
        "ev banyosu ve misafir lavabosu, otel odaları, spa alanları ve ofisler",
        "home bathrooms and guest washrooms, hotel rooms, spa areas and offices",
        "حمّامات المنازل ومغاسل الضيوف، وغرف الفنادق، ومساحات السبا، والمكاتب",
      ),
      HAND_SOAP_TYPE,
    ),
    HAND_SOAP_USE,
    HAND_SOAP_REFILL,
  ),
  lavanta: join(
    features(
      t(
        "Lavanta; lavanta çiçeklerinin tanıdık ve zamansız kokusu",
        "Lavender, the familiar, timeless scent of lavender blossoms",
        "اللافندر، الرائحة المألوفة الخالدة لزهور اللافندر",
      ),
      t(
        "ev ve misafir banyoları, butik oteller ve ofisler",
        "family and guest bathrooms, boutique hotels and offices",
        "حمّامات المنزل والضيوف، والفنادق البوتيكية، والمكاتب",
      ),
      HAND_SOAP_TYPE,
    ),
    HAND_SOAP_USE,
    HAND_SOAP_REFILL,
  ),
  portakal: join(
    features(
      t(
        "Portakal; narenciyenin canlı ve güneşli kokusu",
        "Orange, the bright, sunny scent of citrus",
        "البرتقال، رائحة الحمضيات المشرقة المفعمة بالحيوية",
      ),
      t(
        "mutfaklar, aydınlık banyolar, restoran ve kafelerin misafir lavaboları",
        "kitchens, bright bathrooms and the guest washrooms of restaurants and cafés",
        "المطابخ، والحمّامات المضيئة، ومغاسل الضيوف في المطاعم والمقاهي",
      ),
      HAND_SOAP_TYPE,
    ),
    HAND_SOAP_USE,
    HAND_SOAP_REFILL,
  ),
  okyanus: join(
    features(
      t("Okyanus; serin, berrak ve ferah", "Ocean: cool, clear and fresh", "المحيط: بارد وصافٍ ومنعش"),
      t(
        "ev banyoları, otel ve resort duşları, spa ve spor salonu soyunma odaları",
        "home bathrooms, hotel and resort showers, spa and gym changing rooms",
        "حمّامات المنازل، ودشات الفنادق والمنتجعات، وغرف تبديل الملابس في مراكز السبا والصالات الرياضية",
      ),
      SHOWER_GEL_TYPE,
    ),
    t(
      html(
        h2("Günlük kullanım"),
        p(
          "Islak cildinize ya da lifinize yeterli miktarda duş jeli alın, köpürterek uygulayın ve bol suyla durulayın. Göz ile temasından kaçının; temas hâlinde bol suyla durulayın. Tahriş oluşursa kullanımı bırakın.",
        ),
      ),
      html(
        h2("Everyday use"),
        p(
          "Apply a sufficient amount to wet skin or a washcloth, work it into a lather and rinse thoroughly with water. Avoid contact with the eyes; in case of contact, rinse with plenty of water. Discontinue use if irritation occurs.",
        ),
      ),
      html(
        h2("الاستخدام اليومي"),
        p(
          "ضع كمية كافية من جل الاستحمام على البشرة المبللة أو على الليفة، ودلّكها حتى تتكوّن الرغوة، ثم اشطفها جيدًا بالماء. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء. أوقف الاستخدام إذا حدث تهيّج.",
        ),
      ),
    ),
    t(
      html(
        h2("Bidonlar ve yeniden doldurma"),
        p(
          "5 L ve 20 L bidonlar, duş jeli dispenserlerini ve pompalı şişeleri yeniden doldurmak içindir. Doldurmadan önce dispenseri tamamen boşaltın, ılık suyla temizleyip kurumaya bırakın; kalan ürünün üzerine ekleme yapmayın. Bidonu kapağı kapalı olarak serin ve güneş almayan bir yerde saklayın.",
        ),
        p(`Otel, spa ve spor salonları için ${a("/kurumsal", "toptan duş jeli")} teklifi alabilirsiniz.`),
      ),
      html(
        h2("Canisters and refilling"),
        p(
          "The 5 L and 20 L canisters are made for refilling shower gel dispensers and pump bottles. Before refilling, empty the dispenser completely, wash it with warm water and let it dry; do not top up the gel that is left. Keep the canister closed in a cool place away from sunlight.",
        ),
        p(`Hotels, spas and gyms can request a tailored quote for ${a("/kurumsal", "bulk shower gel")}.`),
      ),
      html(
        h2("العبوات الكبيرة وإعادة التعبئة"),
        p(
          "صُمّمت عبوتا 5 و20 لترًا لإعادة تعبئة موزّعات جل الاستحمام وزجاجات المضخة. قبل إعادة التعبئة أفرغ الموزّع تمامًا واغسله بالماء الدافئ واتركه يجفّ، ولا تُضِف جلًا جديدًا فوق ما تبقّى منه. احفظ العبوة مغلقة في مكان بارد بعيد عن أشعة الشمس.",
        ),
        p(`يمكن للفنادق ومراكز السبا والصالات الرياضية طلب عرض سعر مخصّص لشراء ${a("/kurumsal", "جل الاستحمام بالجملة")}.`),
      ),
    ),
  ),
  "dort-koku-koleksiyonu": t(
    html(
      h2("Sette neler var?"),
      ul(
        `${a("/urunler/lavanta-latte", "Lavanta Latte sıvı el sabunu")}, 5 L bidon`,
        `${a("/urunler/lavanta", "Lavanta sıvı el sabunu")}, 5 L bidon`,
        `${a("/urunler/portakal", "Portakal sıvı el sabunu")}, 5 L bidon`,
        `${a("/urunler/okyanus", "Okyanus duş jeli")}, 5 L bidon`,
      ),
      h2("Kimler için?"),
      p(
        "Dört kokuyu birden denemek isteyen evler; lavabo ve duşlarda farklı kokular kullanmak isteyen oteller, ofisler ve restoranlar; özenle seçilmiş bir hediye arayanlar için.",
      ),
      h2("Günlük kullanım"),
      p(
        "Lavanta Latte, Lavanta ve Portakal el temizliği, Okyanus duş jeli vücut temizliği içindir. Bidonlarla pompalı şişeleri ve dispenserleri yeniden doldurabilirsiniz: şişeyi önce tamamen boşaltıp temizleyin, kuruduktan sonra doldurun. Göz ile temasından kaçının; temas hâlinde bol suyla durulayın. Bidonları ısı ve doğrudan güneş ışığından uzakta, çocukların ulaşamayacağı bir yerde saklayın.",
      ),
    ),
    html(
      h2("What's in the set"),
      ul(
        `${a("/urunler/lavanta-latte", "Lavender Latte liquid hand soap")}, 5 L canister`,
        `${a("/urunler/lavanta", "Lavender liquid hand soap")}, 5 L canister`,
        `${a("/urunler/portakal", "Orange liquid hand soap")}, 5 L canister`,
        `${a("/urunler/okyanus", "Ocean shower gel")}, 5 L canister`,
      ),
      h2("Who it is for"),
      p(
        "Homes that want to try all four scents; hotels, offices and restaurants that like a different scent at the basins and in the showers; and anyone looking for a thoughtfully chosen gift.",
      ),
      h2("Everyday use"),
      p(
        "Lavender Latte, Lavender and Orange are for washing hands; Ocean shower gel is for the body. Use the canisters to refill pump bottles and dispensers: empty and wash the bottle first, then refill it once it is dry. Avoid contact with the eyes; in case of contact, rinse with plenty of water. Store the canisters away from heat and direct sunlight, out of the reach of children.",
      ),
    ),
    html(
      h2("ماذا يضم الطقم؟"),
      ul(
        `${a("/urunler/lavanta-latte", "صابون لاتيه اللافندر السائل لليدين")}، عبوة 5 لترات`,
        `${a("/urunler/lavanta", "صابون اللافندر السائل لليدين")}، عبوة 5 لترات`,
        `${a("/urunler/portakal", "صابون البرتقال السائل لليدين")}، عبوة 5 لترات`,
        `${a("/urunler/okyanus", "جل الاستحمام المحيط")}، عبوة 5 لترات`,
      ),
      h2("لمن هذا الطقم؟"),
      p(
        "للمنازل التي ترغب في تجربة الروائح الأربع معًا، وللفنادق والمكاتب والمطاعم التي تفضّل رائحة مختلفة عند المغاسل وفي الدشات، ولكل من يبحث عن هدية مختارة بعناية.",
      ),
      h2("الاستخدام اليومي"),
      p(
        "لاتيه اللافندر واللافندر والبرتقال لتنظيف اليدين، وجل الاستحمام المحيط لتنظيف الجسم. استخدم العبوات لإعادة تعبئة زجاجات المضخة والموزّعات: أفرغ الزجاجة واغسلها أولًا، ثم املأها بعد أن تجفّ. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء. احفظ العبوات بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.",
      ),
    ),
  ),
};

/** Product page titles (the " | PRESTİJ" suffix is added by the title template) and meta descriptions. */
export const PRODUCT_SEO: Record<ProductCopySlug, Seo> = {
  "lavanta-latte": {
    title: t(
      "Lavanta Latte Sıvı El Sabunu — Pompalı Şişe, 5 L, 20 L",
      "Lavender Latte Liquid Hand Soap — Pump Bottle, 5 L, 20 L",
      "صابون لاتيه اللافندر السائل لليدين — عبوة بمضخة و5 و20 لترًا",
    ),
    description: t(
      "Lavanta Latte sıvı el sabunu: lavantanın dinginliği, sıcak fildişi tonlarıyla. Pompalı şişe, 5 L ve 20 L bidon seçenekleri; Kayseri'de üretilir.",
      "Lavender Latte liquid hand soap: the calm of lavender in warm ivory tones. In a pump bottle or 5 L and 20 L canisters, made in Kayseri, Türkiye.",
      "صابون لاتيه اللافندر السائل لليدين: سكينة اللافندر بدرجات العاج الدافئة. متوفّر بزجاجة بمضخة وعبوات 5 و20 لترًا، ومصنوع في قيصري.",
    ),
  },
  lavanta: {
    title: t(
      "Lavanta Sıvı El Sabunu — Pompalı Şişe, 5 L ve 20 L Bidon",
      "Lavender Liquid Hand Soap — Pump Bottle, 5 L and 20 L",
      "صابون اللافندر السائل لليدين — زجاجة بمضخة و5 و20 لترًا",
    ),
    description: t(
      "Lavanta sıvı el sabunu: lavanta çiçeklerinin tanıdık, zamansız kokusu. Pompalı şişe, 5 L ve 20 L bidon; ev, ofis ve oteller için. Kayseri'de üretilir.",
      "Lavender liquid hand soap with the familiar, timeless scent of lavender blossoms. Pump bottle, 5 L and 20 L canisters for homes, offices and hotels.",
      "صابون اللافندر السائل لليدين برائحة زهور اللافندر المألوفة الخالدة. زجاجة بمضخة وعبوات 5 و20 لترًا للمنازل والمكاتب والفنادق.",
    ),
  },
  portakal: {
    title: t(
      "Portakal Sıvı El Sabunu — Pompalı Şişe, 5 L ve 20 L Bidon",
      "Orange Liquid Hand Soap — Pump Bottle, 5 L and 20 L",
      "صابون البرتقال السائل لليدين — زجاجة بمضخة و5 و20 لترًا",
    ),
    description: t(
      "Portakal sıvı el sabunu: narenciyenin canlı, güneşli kokusu. Pompalı şişe, 5 L ve 20 L bidon; mutfak, banyo ve restoranlar için. Kayseri'de üretilir.",
      "Orange liquid hand soap with the bright, sunny scent of citrus. Pump bottle, 5 L and 20 L canisters for kitchens, bathrooms, cafés and restaurants.",
      "صابون البرتقال السائل لليدين برائحة الحمضيات المشرقة. زجاجة بمضخة وعبوات 5 و20 لترًا للمطابخ والحمّامات والمقاهي والمطاعم.",
    ),
  },
  okyanus: {
    title: t(
      "Okyanus Duş Jeli — Pompalı Şişe, 5 L ve 20 L Bidon",
      "Ocean Shower Gel — Pump Bottle, 5 L and 20 L Canisters",
      "جل الاستحمام المحيط — زجاجة بمضخة وعبوات 5 و20 لترًا",
    ),
    description: t(
      "Okyanus duş jeli: suyun berraklığını hatırlatan serin, ferah bir koku. Pompalı şişe, 5 L ve 20 L bidon; ev, otel ve spa duşları için, Kayseri'de üretilir.",
      "Ocean shower gel with a cool, fresh scent that recalls clear water. Pump bottle, 5 L and 20 L canisters for home, hotel and spa showers. Made in Kayseri.",
      "جل الاستحمام المحيط برائحة باردة منعشة تذكّر بصفاء الماء. زجاجة بمضخة وعبوات 5 و20 لترًا لدشات المنازل والفنادق والسبا، ومصنوع في قيصري.",
    ),
  },
  "dort-koku-koleksiyonu": {
    title: t(
      "Dört Koku Koleksiyonu — 4 × 5 L Sıvı Sabun ve Duş Jeli Seti",
      "Four-Scent Collection — 4 × 5 L Hand Soap and Shower Gel Set",
      "مجموعة الروائح الأربع — طقم 4 × 5 لترات صابون وجل استحمام",
    ),
    description: t(
      "Lavanta Latte, Lavanta, Portakal sıvı el sabunu ve Okyanus duş jeli 5 L bidonlarda bir arada. Evler, işletmeler ve hediye için dört kokulu sabun seti.",
      "Lavender Latte, Lavender and Orange liquid hand soaps with Ocean shower gel in 5 L canisters: a four-scent soap gift set for homes and businesses.",
      "صابون لاتيه اللافندر واللافندر والبرتقال السائل لليدين مع جل الاستحمام المحيط في عبوات 5 لترات: طقم هدايا بأربع روائح للمنازل والشركات.",
    ),
  },
};

// ---------------------------------------------------------------------------------------------
// Categories

export type CategoryCopySlug = "el-sabunu" | "dus-jeli" | "hediye-setleri";
export type CategoryCopy = { name: L; seo: Seo; body: L; faq: CategoryFaqSeed[] };

const q = (question: L, answer: L): CategoryFaqSeed => ({ question, answer });

export const CATEGORY_COPY: Record<CategoryCopySlug, CategoryCopy> = {
  "el-sabunu": {
    name: t("Sıvı El Sabunu", "Liquid Hand Soap", "صابون سائل لليدين"),
    seo: {
      title: t(
        "Sıvı El Sabunu — Lavanta Latte, Lavanta ve Portakal",
        "Liquid Hand Soap — Lavender Latte, Lavender and Orange",
        "صابون سائل لليدين — لاتيه اللافندر واللافندر والبرتقال",
      ),
      description: t(
        "Lavanta Latte, Lavanta ve Portakal sıvı el sabunu; pompalı şişe, 5 L ve 20 L bidon. Ev, ofis, otel ve restoranlar için etkili temizlik ve ferah koku.",
        "Liquid hand soap in Lavender Latte, Lavender and Orange, in pump bottles and 5 L or 20 L canisters: effective cleansing and a fresh scent for every space.",
        "صابون سائل لليدين بروائح لاتيه اللافندر واللافندر والبرتقال، بزجاجات بمضخة وعبوات 5 و20 لترًا: تنظيف فعّال ورائحة منعشة للمنازل والشركات.",
      ),
    },
    body: t(
      html(
        p(
          "Sıvı el sabunu, gün içinde lavabonun başında defalarca uzandığımız bir üründür. PRESTİJ sıvı el sabunları Lavanta Latte, Lavanta ve Portakal olmak üzere üç kokuda; pompalı şişe ile 5 L ve 20 L bidon seçenekleriyle sunulur. Hepsi Kayseri'de üretilir ve etiketlerindeki dört özellik her birinde aynıdır: etkili temizlik, cildi koruyan yapı, ferah koku ve yumuşak his.",
        ),
        h2("Sıvı el sabunu seçerken nelere bakmalı?"),
        p(
          "Önce sabunu nerede kullanacağınızı düşünün. Evde günlük kullanım için lavabonuza yakışan bir pompalı şişe yeterlidir; gün boyu el yıkanan bir ofiste, otelde ya da restoranda ise kolay dolum ve kesintisiz stok öne çıkar. Ardından kokuyu seçin: mekânın havasına uyan bir koku, ellerde kalan izlenimi de belirler. Son olarak ambalajı ihtiyacınıza göre belirleyin; aynı formülü küçük ya da büyük boyda almak hem bütçenizi hem de ambalaj sayısını etkiler.",
        ),
        h2("Pompalı şişe mi, 5 L ya da 20 L bidon mu?"),
        p(
          "<strong>Pompalı şişe</strong> ev banyosu, mutfak ve misafir lavabosu için uygundur; tek elle kolayca kullanılır. <strong>5 L bidon</strong>, pompalı şişeleri ve dispenserleri yeniden doldurmak için pratik bir yedektir; ofislerde, kafelerde ve kalabalık evlerde işinizi kolaylaştırır. <strong>20 L bidon</strong> ise oteller, okullar ve spor salonları gibi tüketimin yüksek olduğu yerlerde daha seyrek sipariş ve daha az ambalaj demektir.",
        ),
        p(
          "Bidondan dolum yaparken şişeyi ya da dispenseri önce tamamen boşaltın, temizleyip kurumaya bırakın, ardından doldurun; kalan sabunun üzerine ekleme yapmayın. Bu basit alışkanlık, şişelerin her dolumda temiz kalmasına yardımcı olur.",
        ),
        h2("Sıvı el sabunu nerelerde kullanılır?"),
        p(
          `Ev banyoları ve mutfaklar, ofislerin ve toplantı alanlarının lavaboları, otel odaları ve lobi tuvaletleri, restoran ve kafelerin misafir lavaboları, okullar, spor salonları ve spa merkezleri… PRESTİJ sıvı el sabunu, ellerin sık yıkandığı her yerde kullanılabilir. İşletmeniz için düzenli 5 L ve 20 L alımlarda ${a("/kurumsal", "toptan sıvı sabun")} sayfamızdan size özel teklif isteyebilirsiniz.`,
        ),
        h2("Kokular: Lavanta Latte, Lavanta ve Portakal"),
        p(
          `${a("/urunler/lavanta-latte", "Lavanta Latte sıvı el sabunu")}, lavantanın dinginliğini sıcak fildişi tonlarıyla buluşturan kremsi ve yumuşak bir koku. ${a("/urunler/lavanta", "Lavanta sıvı el sabunu")}, lavanta çiçeklerinin tanıdık ve zamansız kokusunu klasik bir zarafetle sunar. ${a("/urunler/portakal", "Portakal sıvı el sabunu")} ise narenciyenin canlı ve güneşli karakteriyle mutfaklara ve aydınlık banyolara enerji katar.`,
        ),
        p(
          `Hangi kokunun size uygun olduğundan emin değilseniz işletmeniz için ${a("/numune", "ücretsiz numune")} isteyebilir, bireysel siparişlerinizde ise sepetinize ücretsiz numune ekleyebilirsiniz; numuneler ücretsizdir ve satılmaz. Vücut temizliği için ${a("/kategori/dus-jeli", "Okyanus duş jelimize")} de göz atın.`,
        ),
      ),
      html(
        p(
          "Liquid hand soap is something we reach for many times a day at the basin. PRESTİJ liquid hand soaps come in three scents, Lavender Latte, Lavender and Orange, each in a pump bottle and in 5 L and 20 L canisters. All of them are made in Kayseri, and the four features on their labels are the same: effective cleansing, care for the skin, a fresh scent and a soft feel.",
        ),
        h2("How to choose a liquid hand soap"),
        p(
          "Start with where you will use it. For everyday use at home, a pump bottle that suits your basin is all you need; in an office, hotel or restaurant where hands are washed all day, easy refilling and steady stock matter most. Then choose the scent: one that suits the space also shapes the impression left on the hands. Finally, pick the format that fits your needs; buying the same formula in a small or a large size affects both your budget and the amount of packaging.",
        ),
        h2("Pump bottle, 5 L or 20 L canister?"),
        p(
          "<strong>The pump bottle</strong> suits home bathrooms, kitchens and guest washrooms and is easy to use with one hand. <strong>The 5 L canister</strong> is a practical refill for pump bottles and dispensers, well suited to offices, cafés and busy households. <strong>The 20 L canister</strong> means fewer orders and less packaging where consumption is high, such as hotels, schools and gyms.",
        ),
        p(
          "When refilling from a canister, first empty the bottle or dispenser completely, wash it and let it dry, then refill it; do not top up the soap that is left. This simple habit helps keep bottles clean at every refill.",
        ),
        h2("Where liquid hand soap is used"),
        p(
          `Home bathrooms and kitchens, office and meeting-room washrooms, hotel rooms and lobby restrooms, guest washrooms in restaurants and cafés, schools, gyms and spas: PRESTİJ liquid hand soap can be used wherever hands are washed often. For regular 5 L and 20 L orders for your business, request a tailored quote on our ${a("/kurumsal", "bulk liquid soap")} page.`,
        ),
        h2("The scents: Lavender Latte, Lavender and Orange"),
        p(
          `${a("/urunler/lavanta-latte", "Lavender Latte liquid hand soap")} is a creamy, soft scent that pairs the calm of lavender with warm ivory tones. ${a("/urunler/lavanta", "Lavender liquid hand soap")} offers the familiar, timeless scent of lavender blossoms with classic elegance. ${a("/urunler/portakal", "Orange liquid hand soap")} brings the bright, sunny character of citrus to kitchens and light-filled bathrooms.`,
        ),
        p(
          `Not sure which scent is right for you? Businesses can request ${a("/numune", "free samples")}, and you can add a free sample to your cart with your own orders; samples are free and not for sale. For the body, take a look at our ${a("/kategori/dus-jeli", "Ocean shower gel")}.`,
        ),
      ),
      html(
        p(
          "الصابون السائل لليدين منتج نمدّ أيدينا إليه مرات كثيرة في اليوم عند المغسلة. تتوفّر صابونات PRESTİJ السائلة لليدين بثلاث روائح، هي لاتيه اللافندر واللافندر والبرتقال، في زجاجة بمضخة وفي عبوات 5 و20 لترًا. وكلها مصنوعة في قيصري، وتجمعها الخصائص الأربع نفسها المذكورة على ملصقاتها: تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم.",
        ),
        h2("كيف تختار الصابون السائل لليدين؟"),
        p(
          "فكّر أولًا في مكان الاستخدام. في المنزل تكفي زجاجة بمضخة تليق بمغسلتك للاستخدام اليومي، أما في المكاتب والفنادق والمطاعم التي تُغسل فيها الأيدي طوال اليوم فتصبح سهولة التعبئة وتوفّر المخزون الدائم هي الأهم. ثم اختر الرائحة، فالرائحة المنسجمة مع أجواء المكان تحدّد أيضًا الانطباع الذي يبقى على اليدين. وأخيرًا حدّد العبوة المناسبة لاحتياجك، فشراء التركيبة نفسها بحجم صغير أو كبير يؤثّر في ميزانيتك وفي عدد العبوات معًا.",
        ),
        h2("زجاجة بمضخة أم عبوة 5 أو 20 لترًا؟"),
        p(
          "<strong>الزجاجة بالمضخة</strong> مناسبة لحمّامات المنازل والمطابخ ومغاسل الضيوف، ويسهل استخدامها بيد واحدة. <strong>وعبوة 5 لترات</strong> احتياطي عملي لإعادة تعبئة زجاجات المضخة والموزّعات، وتناسب المكاتب والمقاهي والمنازل المزدحمة. <strong>أما عبوة 20 لترًا</strong> فتعني طلبات أقل وتغليفًا أقل في الأماكن كثيفة الاستهلاك مثل الفنادق والمدارس والصالات الرياضية.",
        ),
        p(
          "عند التعبئة من العبوة الكبيرة، أفرغ الزجاجة أو الموزّع تمامًا أولًا، ثم اغسله واتركه يجفّ قبل ملئه، ولا تُضِف صابونًا جديدًا فوق ما تبقّى منه. فهذه العادة البسيطة تساعد على بقاء الزجاجات نظيفة عند كل تعبئة.",
        ),
        h2("أين يُستخدم الصابون السائل لليدين؟"),
        p(
          `حمّامات المنازل والمطابخ، ومغاسل المكاتب وقاعات الاجتماعات، وغرف الفنادق ودورات مياه الردهات، ومغاسل الضيوف في المطاعم والمقاهي، والمدارس والصالات الرياضية ومراكز السبا… يمكن استخدام صابون PRESTİJ السائل لليدين في كل مكان تُغسل فيه الأيدي كثيرًا. وللطلبات المنتظمة بعبوات 5 و20 لترًا لمنشأتك، اطلب عرض سعر مخصّصًا من صفحة ${a("/kurumsal", "الصابون السائل بالجملة")}.`,
        ),
        h2("الروائح: لاتيه اللافندر واللافندر والبرتقال"),
        p(
          `${a("/urunler/lavanta-latte", "صابون لاتيه اللافندر السائل لليدين")} رائحة كريمية ناعمة تجمع سكينة اللافندر بدفء درجات العاج. و${a("/urunler/lavanta", "صابون اللافندر السائل لليدين")} يقدّم رائحة زهور اللافندر المألوفة الخالدة بأناقة كلاسيكية. أما ${a("/urunler/portakal", "صابون البرتقال السائل لليدين")} فيضفي على المطابخ والحمّامات المضيئة طاقة الحمضيات المشرقة.`,
        ),
        p(
          `إن لم تكن متأكدًا من الرائحة المناسبة لك، يمكنك طلب ${a("/numune", "عيّنات مجانية")} لمنشأتك، أو إضافة عيّنة مجانية إلى سلّتك مع طلباتك الشخصية، فالعيّنات مجانية وليست للبيع. ولتنظيف الجسم، تعرّف أيضًا إلى ${a("/kategori/dus-jeli", "جل الاستحمام المحيط")}.`,
        ),
      ),
    ),
    faq: [
      q(
        t("Sıvı el sabunu nasıl kullanılır?", "How do I use liquid hand soap?", "كيف أستخدم الصابون السائل لليدين؟"),
        t(
          "Ellerinizi ıslatın, yeterli miktarda sıvı el sabunu alın ve ellerinizin her yerini en az 20 saniye köpürterek ovun. Ardından bol suyla durulayıp kurulayın. Göz ile temasından kaçının; temas hâlinde bol suyla durulayın.",
          "Wet your hands, take a sufficient amount of liquid hand soap and lather every part of your hands for at least 20 seconds. Then rinse thoroughly and dry. Avoid contact with the eyes; in case of contact, rinse with plenty of water.",
          "بلّل يديك وخذ كمية كافية من الصابون السائل، ثم افرك اليدين بالكامل برغوته لمدة 20 ثانية على الأقل. اشطفهما بعد ذلك جيدًا بالماء وجفّفهما. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء.",
        ),
      ),
      q(
        t("Pompalı şişe mi almalıyım, bidon mu?", "Should I buy a pump bottle or a canister?", "هل أشتري زجاجة بمضخة أم عبوة كبيرة؟"),
        t(
          "Evde günlük kullanım için pompalı şişe yeterlidir. Şişelerinizi ya da dispenserlerinizi kendiniz doldurmak istiyorsanız 5 L bidon, tüketimin yüksek olduğu işletmelerde ise 20 L bidon daha pratiktir. Üç boyda da formül ve koku aynıdır.",
          "For everyday use at home, a pump bottle is all you need. If you refill your own bottles or dispensers, the 5 L canister is more practical, and for businesses with high consumption, the 20 L canister. The formula and scent are the same in all three sizes.",
          "للاستخدام اليومي في المنزل تكفي الزجاجة بالمضخة. وإذا كنت تعيد تعبئة زجاجاتك أو موزّعاتك بنفسك فعبوة 5 لترات أكثر عملية، أما المنشآت ذات الاستهلاك المرتفع فتناسبها عبوة 20 لترًا. والتركيبة والرائحة واحدة في الأحجام الثلاثة.",
        ),
      ),
      q(
        t(
          "Dispenseri bidondan doldururken nelere dikkat etmeliyim?",
          "What should I keep in mind when refilling a dispenser from a canister?",
          "ما الذي يجب مراعاته عند تعبئة الموزّع من العبوة الكبيرة؟",
        ),
        t(
          "Dispenseri ya da şişeyi önce tamamen boşaltın, ılık suyla temizleyip kurumaya bırakın, sonra doldurun. Kalan sabunun üzerine ekleme yapmayın ve bidonun kapağını her kullanımdan sonra sıkıca kapatın.",
          "First empty the dispenser or bottle completely, wash it with warm water and let it dry, then refill it. Do not top up the soap that is left, and close the canister tightly after each use.",
          "أفرغ الموزّع أو الزجاجة تمامًا أولًا، ثم اغسله بالماء الدافئ واتركه يجفّ قبل ملئه. لا تُضِف صابونًا جديدًا فوق ما تبقّى منه، وأغلق العبوة بإحكام بعد كل استخدام.",
        ),
      ),
      q(
        t("Hangi kokular var?", "Which scents are available?", "ما الروائح المتوفّرة؟"),
        t(
          "Sıvı el sabunlarımız üç kokuda: kremsi ve yumuşak Lavanta Latte, klasik Lavanta ve canlı Portakal. Dördüncü kokumuz Okyanus ise duş jelidir.",
          "Our liquid hand soaps come in three scents: creamy, soft Lavender Latte, classic Lavender and bright Orange. Our fourth scent, Ocean, is a shower gel.",
          "تتوفّر صابوناتنا السائلة لليدين بثلاث روائح: لاتيه اللافندر الكريمي الناعم، واللافندر الكلاسيكي، والبرتقال المشرق. أما رائحتنا الرابعة، المحيط، فهي جل استحمام.",
        ),
      ),
      q(
        t("İşletmem için toptan sıvı sabun alabilir miyim?", "Can I buy liquid soap in bulk for my business?", "هل يمكنني شراء الصابون السائل بالجملة لمنشأتي؟"),
        t(
          "Evet. Oteller, ofisler, restoranlar ve diğer işletmeler için 5 L ve 20 L bidonlarda toptan sıvı sabun sunuyoruz. Kurumsal sayfamızdaki formdan ihtiyacınızı yazın; size özel teklifle dönüş yapalım.",
          "Yes. We supply liquid soap in bulk in 5 L and 20 L canisters for hotels, offices, restaurants and other businesses. Tell us what you need using the form on our business page, and we will come back with a tailored quote.",
          "نعم. نوفّر الصابون السائل بالجملة في عبوات 5 و20 لترًا للفنادق والمكاتب والمطاعم وغيرها من المنشآت. اكتب لنا احتياجك من خلال النموذج في صفحة الشركات، وسنعود إليك بعرض سعر مخصّص.",
        ),
      ),
    ],
  },
  "dus-jeli": {
    name: t("Duş Jeli", "Shower Gel", "جل الاستحمام"),
    seo: {
      title: t(
        "Duş Jeli — Evler ve Oteller İçin, 5 L ve 20 L Bidon",
        "Shower Gel — For Homes and Hotels, 5 L and 20 L Canisters",
        "جل الاستحمام — للمنازل والفنادق، عبوات 5 و20 لترًا",
      ),
      description: t(
        "Duş jeli: ev banyoları, oteller, spa merkezleri ve spor salonları için pompalı şişe, 5 litre ve 20 litre bidon seçenekleri. Serin, ferah Okyanus kokusu.",
        "Shower gel for home bathrooms, hotels, spas and gyms: a pump bottle or 5-litre and 20-litre canisters, with the cool, fresh Ocean scent. Made in Kayseri.",
        "جل الاستحمام لحمّامات المنازل والفنادق ومراكز السبا والصالات الرياضية: زجاجة بمضخة أو عبوات 5 و20 لترًا، برائحة المحيط الباردة المنعشة.",
      ),
    },
    body: t(
      html(
        p(
          "Duş jeli, günün yorgunluğunu suyla birlikte geride bıraktığınız anın bir parçası. PRESTİJ Okyanus duş jeli, suyun berraklığını ve köpüğün hafifliğini hatırlatan serin ve ferah bir kokuyla pompalı şişe, 5 L ve 20 L bidon seçenekleriyle sunulur. Kayseri'de üretilir; etiketindeki dört özellik etkili temizlik, cildi koruyan yapı, ferah koku ve yumuşak histir.",
        ),
        h2("Duş jeli seçerken nelere dikkat etmeli?"),
        p(
          "Duş jelinde kokunun yanında köpürmesi ve kolay durulanması da günlük konforu belirler. Evde kullanım için pompalı şişe, duşun başında tek elle kolayca kullanılır. Birden fazla duşun bulunduğu otel, spa ve spor salonlarında ise aynı ürünü her noktada kullanabilmek ve dispenserleri hızla doldurabilmek önem kazanır; bu yüzden büyük boy ambalajlar öne çıkar.",
        ),
        h2("5 litre ve 20 litre duş jeli: dolum ve pratiklik"),
        p(
          "5 L ve 20 L bidonlar, duş jeli dispenserlerini ve pompalı şişeleri yeniden doldurmak için tasarlandı. 5 L bidon evler ve butik işletmeler için pratik bir yedektir; 20 L bidon ise otel duşları, spa ve spor salonu soyunma odaları gibi yoğun kullanılan alanlarda daha seyrek sipariş ve daha az ambalaj demektir. Doldurmadan önce dispenseri tamamen boşaltın, temizleyip kurutun; kalan ürünün üzerine ekleme yapmayın.",
        ),
        h2("Duş jeli nasıl kullanılır?"),
        p(
          "Islak cildinize ya da lifinize yeterli miktarda duş jeli alın, köpürterek uygulayın ve bol suyla durulayın. Göz ile temasından kaçının; temas hâlinde bol suyla durulayın. Tahriş oluşursa kullanımı bırakın. Ürünü ısı ve doğrudan güneş ışığından uzakta, çocukların ulaşamayacağı bir yerde saklayın.",
        ),
        h2("Duş jeli nerelerde kullanılır?"),
        p(
          `Ev banyoları, otel odaları ve resort duşları, spa ve wellness merkezleri, spor salonları ve havuz soyunma odaları… Okyanus duş jelinin serin kokusu, ferah bir duş anı isteyen her mekâna uyum sağlar. Oteller ve spor salonları ${a("/kurumsal", "toptan duş jeli")} için teklif alabilir, karar vermeden önce ${a("/numune", "ücretsiz numune")} isteyebilir; numuneler ücretsizdir ve satılmaz.`,
        ),
        h2("Okyanus kokusu"),
        p(
          `${a("/urunler/okyanus", "Okyanus duş jeli")}, safir mavisinin derinliğini ve denizin ferahlığını hatırlatan berrak bir koku taşır. Lavabonun başında aynı özeni sürdürmek isterseniz ${a("/kategori/el-sabunu", "sıvı el sabunu")} kokularımıza, dört kokuyu birden denemek isterseniz ${a("/urunler/dort-koku-koleksiyonu", "Dört Koku Koleksiyonu")}'na göz atın.`,
        ),
      ),
      html(
        p(
          "Shower gel is part of the moment you wash the day away. PRESTİJ Ocean shower gel has a cool, fresh scent that recalls clear water and light foam, and comes in a pump bottle and in 5 L and 20 L canisters. It is made in Kayseri, and the four features on its label are effective cleansing, care for the skin, a fresh scent and a soft feel.",
        ),
        h2("How to choose a shower gel"),
        p(
          "Besides the scent, how well a shower gel lathers and rinses shapes everyday comfort. At home, a pump bottle is easy to use with one hand in the shower. In hotels, spas and gyms with several showers, using the same product everywhere and refilling dispensers quickly become important, which is why larger formats are the practical choice there.",
        ),
        h2("5-litre and 20-litre shower gel: refilling made practical"),
        p(
          "The 5 L and 20 L canisters were designed for refilling shower gel dispensers and pump bottles. The 5 L canister is a practical refill for homes and small businesses; the 20 L canister means fewer orders and less packaging in busy areas such as hotel showers and spa or gym changing rooms. Before refilling, empty the dispenser completely, wash and dry it; do not top up the gel that is left.",
        ),
        h2("How to use shower gel"),
        p(
          "Apply a sufficient amount of shower gel to wet skin or a washcloth, work it into a lather and rinse thoroughly with water. Avoid contact with the eyes; in case of contact, rinse with plenty of water. Discontinue use if irritation occurs. Store the product away from heat and direct sunlight, out of the reach of children.",
        ),
        h2("Where shower gel is used"),
        p(
          `Home bathrooms, hotel rooms and resort showers, spas and wellness centres, gyms and pool changing rooms: the cool scent of Ocean shower gel suits every space that calls for a fresh moment in the shower. Hotels and gyms can request a quote for ${a("/kurumsal", "bulk shower gel")}, and ${a("/numune", "free samples")} before deciding; samples are free and not for sale.`,
        ),
        h2("The Ocean scent"),
        p(
          `${a("/urunler/okyanus", "Ocean shower gel")} carries a clear scent that recalls the depth of sapphire blue and the freshness of the sea. To bring the same care to the basin, explore our ${a("/kategori/el-sabunu", "liquid hand soap")} scents, or try all four at once with the ${a("/urunler/dort-koku-koleksiyonu", "Four-Scent Collection")}.`,
        ),
      ),
      html(
        p(
          "جل الاستحمام جزء من اللحظة التي يغسل فيها الماء تعب اليوم. يأتي جل الاستحمام المحيط من PRESTİJ برائحة باردة منعشة تذكّر بصفاء الماء وخفّة الرغوة، في زجاجة بمضخة وفي عبوات 5 و20 لترًا. وهو مصنوع في قيصري، والخصائص الأربع على ملصقه هي: تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم.",
        ),
        h2("كيف تختار جل الاستحمام؟"),
        p(
          "إلى جانب الرائحة، تحدّد غزارة الرغوة وسهولة الشطف راحتك اليومية. في المنزل يسهل استخدام الزجاجة بالمضخة بيد واحدة في الدش. أما في الفنادق ومراكز السبا والصالات الرياضية التي تضمّ دشات عدّة، فيصبح استخدام المنتج نفسه في كل مكان وتعبئة الموزّعات بسرعة أمرًا مهمًا، ولهذا تكون العبوات الكبيرة خيارًا عمليًا.",
        ),
        h2("جل الاستحمام بعبوات 5 و20 لترًا: تعبئة عملية"),
        p(
          "صُمّمت عبوتا 5 و20 لترًا لإعادة تعبئة موزّعات جل الاستحمام وزجاجات المضخة. عبوة 5 لترات احتياطي عملي للمنازل والمنشآت الصغيرة، أما عبوة 20 لترًا فتعني طلبات أقل وتغليفًا أقل في الأماكن كثيفة الاستخدام مثل دشات الفنادق وغرف تبديل الملابس في مراكز السبا والصالات الرياضية. قبل إعادة التعبئة أفرغ الموزّع تمامًا واغسله وجفّفه، ولا تُضِف جلًا جديدًا فوق ما تبقّى منه.",
        ),
        h2("كيف يُستخدم جل الاستحمام؟"),
        p(
          "ضع كمية كافية من جل الاستحمام على البشرة المبللة أو على الليفة، ودلّكها حتى تتكوّن الرغوة، ثم اشطفها جيدًا بالماء. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء. أوقف الاستخدام إذا حدث تهيّج. احفظ المنتج بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.",
        ),
        h2("أين يُستخدم جل الاستحمام؟"),
        p(
          `حمّامات المنازل، وغرف الفنادق ودشات المنتجعات، ومراكز السبا والعافية، والصالات الرياضية وغرف تبديل الملابس عند المسابح… تنسجم رائحة جل الاستحمام المحيط الباردة مع كل مكان يبحث عن لحظة منعشة في الدش. ويمكن للفنادق والصالات الرياضية طلب عرض سعر لشراء ${a("/kurumsal", "جل الاستحمام بالجملة")}، وطلب ${a("/numune", "عيّنات مجانية")} قبل اتخاذ القرار، فالعيّنات مجانية وليست للبيع.`,
        ),
        h2("رائحة المحيط"),
        p(
          `يحمل ${a("/urunler/okyanus", "جل الاستحمام المحيط")} رائحة صافية تذكّر بعمق الأزرق الياقوتي وانتعاش البحر. ولتواصل العناية نفسها عند المغسلة، تعرّف إلى روائح ${a("/kategori/el-sabunu", "الصابون السائل لليدين")}، أو جرّب الروائح الأربع معًا مع ${a("/urunler/dort-koku-koleksiyonu", "مجموعة الروائح الأربع")}.`,
        ),
      ),
    ),
    faq: [
      q(
        t("Duş jelini el yıkamak için de kullanabilir miyim?", "Can I also use shower gel to wash my hands?", "هل يمكنني استخدام جل الاستحمام لغسل اليدين أيضًا؟"),
        t(
          "Okyanus duş jeli, etiketinde de yazdığı gibi vücut temizliği içindir. Lavabonun başında el temizliği için Lavanta Latte, Lavanta ve Portakal sıvı el sabunlarımızı öneririz.",
          "Ocean shower gel is made for cleansing the body, as its label says. For washing hands at the basin, we recommend our Lavender Latte, Lavender and Orange liquid hand soaps.",
          "جل الاستحمام المحيط مخصّص لتنظيف الجسم كما يذكر ملصقه. ولغسل اليدين عند المغسلة ننصح بصابون لاتيه اللافندر واللافندر والبرتقال السائل لليدين.",
        ),
      ),
      q(
        t("Okyanus duş jelinin kokusu nasıl?", "What does Ocean shower gel smell like?", "ما رائحة جل الاستحمام المحيط؟"),
        t(
          "Okyanus serin, berrak ve ferah bir kokudur; suyun berraklığını, köpüğün hafifliğini ve denizin ferahlığını hatırlatır.",
          "Ocean is a cool, clear and fresh scent that recalls clear water, light foam and the freshness of the sea.",
          "المحيط رائحة باردة وصافية ومنعشة، تذكّر بصفاء الماء وخفّة الرغوة وانتعاش البحر.",
        ),
      ),
      q(
        t("Oteller için 5 litre ve 20 litre duş jeli var mı?", "Is there 5-litre and 20-litre shower gel for hotels?", "هل يتوفّر جل الاستحمام بعبوات 5 و20 لترًا للفنادق؟"),
        t(
          "Evet. Okyanus duş jeli, pompalı şişenin yanı sıra 5 L ve 20 L bidon olarak da satılır. Bidonlar otel ve spa duşlarındaki dispenserleri yeniden doldurmak için uygundur; toplu alımlar için kurumsal teklif isteyebilirsiniz.",
          "Yes. Besides the pump bottle, Ocean shower gel is also sold in 5 L and 20 L canisters. The canisters are suitable for refilling the dispensers in hotel and spa showers, and you can request a business quote for bulk orders.",
          "نعم. إلى جانب الزجاجة بالمضخة، يُباع جل الاستحمام المحيط أيضًا في عبوات 5 و20 لترًا، وهي مناسبة لإعادة تعبئة الموزّعات في دشات الفنادق ومراكز السبا. ويمكنك طلب عرض سعر للشركات عند الشراء بالجملة.",
        ),
      ),
      q(
        t("Duş jelini nasıl saklamalıyım?", "How should I store shower gel?", "كيف أحفظ جل الاستحمام؟"),
        t(
          "Kapağını kapalı tutarak serin, güneş almayan ve çocukların ulaşamayacağı bir yerde saklayın. Açıldıktan sonra 12 ay içinde kullanmanızı öneririz.",
          "Keep it closed in a cool place away from sunlight and out of the reach of children. We recommend using it within 12 months of opening.",
          "احفظه مغلقًا في مكان بارد بعيد عن أشعة الشمس وبعيدًا عن متناول الأطفال. ننصح باستخدامه خلال 12 شهرًا من فتح العبوة.",
        ),
      ),
    ],
  },
  "hediye-setleri": {
    name: t("Hediye Setleri", "Gift Sets", "مجموعات الهدايا"),
    seo: {
      title: t(
        "Sabun Hediye Seti — Dört Kokulu Sıvı Sabun Seti",
        "Soap Gift Set — Four-Scent Liquid Soap Set",
        "طقم هدايا صابون — طقم صابون سائل بأربع روائح",
      ),
      description: t(
        "Sabun hediye seti: dört PRESTİJ kokusu 5 L bidonlarda tek sette. Sıvı el sabunu ve duş jeli seti; evler, işletmeler ve özel günler için anlamlı bir hediye.",
        "Soap gift set: all four PRESTİJ scents in 5 L canisters in one set. A liquid hand soap and shower gel set for homes, businesses and special occasions.",
        "طقم هدايا صابون: روائح PRESTİJ الأربع في عبوات 5 لترات ضمن طقم واحد. صابون سائل لليدين وجل استحمام للمنازل والشركات والمناسبات الخاصة.",
      ),
    },
    body: t(
      html(
        p(
          `PRESTİJ'in dört kokusu, hediye etmek ya da kendiniz kullanmak için tek bir sette buluşuyor. ${a("/urunler/dort-koku-koleksiyonu", "Dört Koku Koleksiyonu")}; Lavanta Latte, Lavanta ve Portakal sıvı el sabunlarını Okyanus duş jeliyle birlikte 5 litrelik bidonlarda bir araya getirir. Kayseri'de üretilen bu sıvı sabun seti hem evler hem de işletmeler için düşünüldü.`,
        ),
        h2("Sette neler var?"),
        ul(
          `${a("/urunler/lavanta-latte", "Lavanta Latte sıvı el sabunu")}: kremsi ve yumuşak bir lavanta kokusu`,
          `${a("/urunler/lavanta", "Lavanta sıvı el sabunu")}: klasik ve zamansız lavanta`,
          `${a("/urunler/portakal", "Portakal sıvı el sabunu")}: canlı ve güneşli narenciye`,
          `${a("/urunler/okyanus", "Okyanus duş jeli")}: serin ve berrak bir ferahlık`,
        ),
        p("Her biri 5 L bidonda gelir; set, şık bir hediye olmanın yanında pompalı şişeleriniz için hazır bir dolum stoku da sunar."),
        h2("Kimler için uygun?"),
        p(
          "Dört kokuyu evin farklı köşelerinde denemek isteyenler için: banyoda Lavanta, mutfakta Portakal, misafir lavabosunda Lavanta Latte, duşta Okyanus. Yeni evine taşınan bir yakınınıza, açılış yapan bir işletmeye ya da çalışma arkadaşlarınıza anlamlı bir hediye arıyorsanız da güzel bir seçenek. Oteller, ofisler ve restoranlar için ise her alanda ayrı bir atmosfer kurmanın kolay bir yolu.",
        ),
        h2("Neden bidon seti?"),
        p(
          "Pompalı şişenizdeki sabun bittiğinde yeni bir şişe almak yerine bidondan doldurmak, daha az ambalaj ve daha seyrek alışveriş demektir. 5 litrelik bidonlar evde ve küçük işletmelerde pratik bir yedek görevi görür; şişeyi her doldurduğunuzda aynı formül ve aynı kokuyla devam edersiniz. Setteki dört bidon sayesinde her kokunun yedeği elinizin altında olur.",
        ),
        h2("Bidonlar nasıl kullanılır?"),
        p(
          "5 L bidonlar, pompalı şişeleri ve dispenserleri yeniden doldurmak içindir. Doldurmadan önce şişeyi tamamen boşaltın, temizleyip kurumaya bırakın; kalan ürünün üzerine ekleme yapmayın. Sıvı el sabunları el temizliği, Okyanus duş jeli vücut temizliği içindir. Göz ile temasından kaçının; temas hâlinde bol suyla durulayın. Bidonları ısı ve doğrudan güneş ışığından uzakta, çocukların ulaşamayacağı bir yerde saklayın.",
        ),
        h2("İşletmeler ve toplu siparişler"),
        p(
          `Seti birden fazla adet almak ya da kokuları tek tek 5 L ve 20 L bidonlarla düzenli sipariş etmek isterseniz ${a("/kurumsal", "toptan sıvı sabun")} sayfamızdan teklif isteyebilirsiniz. Kokuları önce denemek için ${a("/numune", "ücretsiz numune")} talep edebilir (numuneler ücretsizdir ve satılmaz), tek tek incelemek için ${a("/kategori/el-sabunu", "sıvı el sabunu")} ve ${a("/kategori/dus-jeli", "duş jeli")} sayfalarımıza göz atabilirsiniz.`,
        ),
      ),
      html(
        p(
          `PRESTİJ brings its four scents together in one set, to give as a gift or to use yourself. The ${a("/urunler/dort-koku-koleksiyonu", "Four-Scent Collection")} combines Lavender Latte, Lavender and Orange liquid hand soaps with Ocean shower gel, all in 5-litre canisters. Made in Kayseri, this liquid soap set was designed for homes and businesses alike.`,
        ),
        h2("What's in the set"),
        ul(
          `${a("/urunler/lavanta-latte", "Lavender Latte liquid hand soap")}: a creamy, soft lavender scent`,
          `${a("/urunler/lavanta", "Lavender liquid hand soap")}: classic, timeless lavender`,
          `${a("/urunler/portakal", "Orange liquid hand soap")}: bright, sunny citrus`,
          `${a("/urunler/okyanus", "Ocean shower gel")}: a cool, clear freshness`,
        ),
        p("Each comes in a 5 L canister, so besides being an elegant gift, the set gives you a ready refill supply for your pump bottles."),
        h2("Who it is for"),
        p(
          "For anyone who wants to try the four scents around the home: Lavender in the bathroom, Orange in the kitchen, Lavender Latte at the guest basin and Ocean in the shower. It is also a lovely choice if you are looking for a meaningful gift for someone moving into a new home, a business celebrating its opening or your colleagues. For hotels, offices and restaurants, it is an easy way to create a distinct atmosphere in each space.",
        ),
        h2("Why a canister set?"),
        p(
          "When the soap in your pump bottle runs out, refilling it from a canister instead of buying a new bottle means less packaging and fewer shopping trips. The 5-litre canisters work as a practical refill supply at home and in small businesses, and every refill keeps the same formula and the same scent. With four canisters in the set, a refill of each scent is always close at hand.",
        ),
        h2("How to use the canisters"),
        p(
          "The 5 L canisters are for refilling pump bottles and dispensers. Before refilling, empty the bottle completely, wash it and let it dry; do not top up the product that is left. The liquid hand soaps are for washing hands; Ocean shower gel is for the body. Avoid contact with the eyes; in case of contact, rinse with plenty of water. Store the canisters away from heat and direct sunlight, out of the reach of children.",
        ),
        h2("Businesses and bulk orders"),
        p(
          `To buy several sets, or to order the scents one by one in 5 L and 20 L canisters on a regular basis, request a quote on our ${a("/kurumsal", "bulk liquid soap")} page. You can ask for ${a("/numune", "free samples")} to try the scents first (samples are free and not for sale), or browse our ${a("/kategori/el-sabunu", "liquid hand soap")} and ${a("/kategori/dus-jeli", "shower gel")} pages.`,
        ),
      ),
      html(
        p(
          `تجتمع روائح PRESTİJ الأربع في طقم واحد، لتقدّمه هدية أو لتستخدمه بنفسك. تضمّ ${a("/urunler/dort-koku-koleksiyonu", "مجموعة الروائح الأربع")} صابون لاتيه اللافندر واللافندر والبرتقال السائل لليدين مع جل الاستحمام المحيط، وكلها في عبوات سعة 5 لترات. صُنع طقم الصابون السائل هذا في قيصري، وصُمّم للمنازل والشركات على حدّ سواء.`,
        ),
        h2("ماذا يضم الطقم؟"),
        ul(
          `${a("/urunler/lavanta-latte", "صابون لاتيه اللافندر السائل لليدين")}: رائحة لافندر كريمية ناعمة`,
          `${a("/urunler/lavanta", "صابون اللافندر السائل لليدين")}: لافندر كلاسيكي خالد`,
          `${a("/urunler/portakal", "صابون البرتقال السائل لليدين")}: حمضيات مشرقة مفعمة بالحيوية`,
          `${a("/urunler/okyanus", "جل الاستحمام المحيط")}: انتعاش بارد وصافٍ`,
        ),
        p("يأتي كلٌّ منها في عبوة 5 لترات، فيمنحك الطقم إلى جانب كونه هدية أنيقة مخزونًا جاهزًا لإعادة تعبئة زجاجات المضخة."),
        h2("لمن يناسب هذا الطقم؟"),
        p(
          "لكل من يرغب في تجربة الروائح الأربع في أرجاء المنزل: اللافندر في الحمّام، والبرتقال في المطبخ، ولاتيه اللافندر عند مغسلة الضيوف، والمحيط في الدش. وهو خيار جميل أيضًا إن كنت تبحث عن هدية ذات معنى لقريب انتقل إلى منزل جديد، أو لمنشأة تحتفل بافتتاحها، أو لزملائك في العمل. أما للفنادق والمكاتب والمطاعم، فهو طريقة سهلة لخلق أجواء مختلفة في كل مساحة.",
        ),
        h2("لماذا طقم العبوات الكبيرة؟"),
        p(
          "عندما ينفد الصابون في زجاجة المضخة، فإن إعادة تعبئتها من العبوة الكبيرة بدلًا من شراء زجاجة جديدة تعني تغليفًا أقل ومرات تسوّق أقل. تؤدي عبوات 5 لترات دور الاحتياطي العملي في المنزل وفي المنشآت الصغيرة، ومع كل تعبئة تبقى التركيبة نفسها والرائحة نفسها. وبفضل العبوات الأربع في الطقم، يبقى احتياطي كل رائحة في متناول يدك.",
        ),
        h2("كيف تُستخدم العبوات؟"),
        p(
          "عبوات 5 لترات مخصّصة لإعادة تعبئة زجاجات المضخة والموزّعات. قبل التعبئة أفرغ الزجاجة تمامًا واغسلها واتركها تجفّ، ولا تُضِف منتجًا جديدًا فوق ما تبقّى منه. الصابون السائل لتنظيف اليدين، وجل الاستحمام المحيط لتنظيف الجسم. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء. احفظ العبوات بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.",
        ),
        h2("الشركات والطلبات بالجملة"),
        p(
          `لشراء أكثر من طقم، أو لطلب الروائح كلٌّ على حدة بعبوات 5 و20 لترًا بشكل منتظم، اطلب عرض سعر من صفحة ${a("/kurumsal", "الصابون السائل بالجملة")}. ويمكنك طلب ${a("/numune", "عيّنات مجانية")} لتجربة الروائح أولًا (والعيّنات مجانية وليست للبيع)، أو تصفّح صفحتي ${a("/kategori/el-sabunu", "الصابون السائل لليدين")} و${a("/kategori/dus-jeli", "جل الاستحمام")}.`,
        ),
      ),
    ),
    faq: [
      q(
        t("Dört Koku Koleksiyonu'nda neler var?", "What is in the Four-Scent Collection?", "ماذا تضم مجموعة الروائح الأربع؟"),
        t(
          "Sette Lavanta Latte, Lavanta ve Portakal sıvı el sabunları ile Okyanus duş jeli bulunur; her biri 5 L bidondadır.",
          "The set contains Lavender Latte, Lavender and Orange liquid hand soaps and Ocean shower gel, each in a 5 L canister.",
          "يضم الطقم صابون لاتيه اللافندر واللافندر والبرتقال السائل لليدين وجل الاستحمام المحيط، كلٌّ منها في عبوة 5 لترات.",
        ),
      ),
      q(
        t("Seti kimler için önerirsiniz?", "Who would you recommend the set for?", "لمن تنصحون بهذا الطقم؟"),
        t(
          "Dört kokuyu birden denemek isteyen evler ile farklı alanlarda farklı kokular kullanmak isteyen oteller, ofisler ve restoranlar için uygundur; özenle seçilmiş bir hediye olarak da verilebilir.",
          "It suits homes that want to try all four scents and hotels, offices and restaurants that like different scents in different spaces; it also makes a thoughtfully chosen gift.",
          "يناسب المنازل التي ترغب في تجربة الروائح الأربع معًا، والفنادق والمكاتب والمطاعم التي تفضّل روائح مختلفة في مساحات مختلفة، كما يصلح هديةً مختارة بعناية.",
        ),
      ),
      q(
        t("Bidonla pompalı şişe nasıl doldurulur?", "How do I refill a pump bottle from a canister?", "كيف أعيد تعبئة زجاجة المضخة من العبوة؟"),
        t(
          "Şişeyi tamamen boşaltıp temizleyin, kurumasını bekleyin ve bidondan doldurun. Kalan ürünün üzerine ekleme yapmayın; bidonun kapağını kullanımdan sonra sıkıca kapatın.",
          "Empty the bottle completely, wash it, let it dry and refill it from the canister. Do not top up the product that is left, and close the canister tightly after use.",
          "أفرغ الزجاجة تمامًا واغسلها، وانتظر حتى تجفّ، ثم املأها من العبوة. لا تُضِف منتجًا جديدًا فوق ما تبقّى منه، وأغلق العبوة بإحكام بعد الاستخدام.",
        ),
      ),
      q(
        t("Seti işletmem için toplu alabilir miyim?", "Can I buy the set in bulk for my business?", "هل يمكنني شراء الطقم بالجملة لمنشأتي؟"),
        t(
          "Evet. Birden fazla set ya da kokuları ayrı ayrı 5 L ve 20 L bidonlarla almak için kurumsal sayfamızdaki formdan teklif isteyebilirsiniz.",
          "Yes. To buy several sets, or the scents separately in 5 L and 20 L canisters, request a quote using the form on our business page.",
          "نعم. لشراء أكثر من طقم، أو شراء الروائح منفصلة بعبوات 5 و20 لترًا، اطلب عرض سعر من خلال النموذج في صفحة الشركات.",
        ),
      ),
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Corrections after the first run (day-5 review/FIX, 2026-11-11)
//
// content-day5.ts wrote the copy above to the live database before these corrections. The catalogSeo step
// updates a stored value only while it is still exactly the first version (the current text with these
// corrections undone, see ./content-fixes.ts); anything the client edited is reported and left alone.
// Category bodies: samples "ücretsiz, satılmaz" (contract §2) and the label claims as a list of nouns
// (en/ar). dus-jeli meta description: led by the generic term instead of repeating the product's.
//
// Round 2 (day-5 verification, 2026-11-11, `round: 2`): el-sabunu no longer calls the soap "a habit";
// dus-jeli: the usage text appears once, in the body's "Duş jeli nasıl kullanılır?" section (with the eye
// caution and the FAQ's irritation sentence merged in), and the FAQ asks a different question instead;
// natural EN/AR phrasing, TR title "Evler ve Oteller"; hediye-setleri: the opening and an FAQ answer no
// longer address the search phrase ("… arayanlar için"), and the canister usage section carries the
// eye-contact caution.

/** The dus-jeli FAQ's first item before round 2 (it repeated the body's usage section). */
const SHOWER_GEL_USAGE_FAQ = q(
  t("Duş jeli nasıl kullanılır?", "How do I use shower gel?", "كيف أستخدم جل الاستحمام؟"),
  t(
    "Islak cildinize ya da lifinize yeterli miktarda duş jeli alın, köpürterek uygulayın ve bol suyla durulayın. Göz ile temasından kaçının; temas hâlinde bol suyla durulayın. Tahriş oluşursa kullanımı bırakın.",
    "Apply a sufficient amount to wet skin or a washcloth, work it into a lather and rinse thoroughly with water. Avoid contact with the eyes; in case of contact, rinse with plenty of water. Discontinue use if irritation occurs.",
    "ضع كمية كافية من جل الاستحمام على البشرة المبللة أو على الليفة، ودلّكها حتى تتكوّن الرغوة، ثم اشطفها جيدًا بالماء. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء. أوقف الاستخدام إذا حدث تهيّج.",
  ),
);

/** A whole-text replacement of each language (`next` = the current seed text). */
const replaced = (before: L, next: L, round: number): LocaleFixes => ({
  tr: [{ round, before: before.tr, after: next.tr }],
  en: [{ round, before: before.en!, after: next.en! }],
  ar: [{ round, before: before.ar!, after: next.ar! }],
});

/** Records per category field; `faq` holds corrections to single FAQ texts (path: [item index, "question" | "answer"]). */
export type CategoryCopyFixes = { body?: LocaleFixes; seoTitle?: LocaleFixes; seoDescription?: LocaleFixes; faq?: readonly PathFixes[] };

export const CATEGORY_COPY_FIXES: Partial<Record<CategoryCopySlug, CategoryCopyFixes>> = {
  "el-sabunu": {
    body: {
      tr: [
        { before: "bireysel siparişlerinizde ise sepetinize ücretsiz numune ekleyebilirsiniz.", after: "bireysel siparişlerinizde ise sepetinize ücretsiz numune ekleyebilirsiniz; numuneler ücretsizdir ve satılmaz." },
        { round: 2, before: "Sıvı el sabunu, gün içinde lavabonun başında defalarca uzandığımız küçük bir alışkanlık.", after: "Sıvı el sabunu, gün içinde lavabonun başında defalarca uzandığımız bir üründür." },
      ],
      en: [
        { before: "the four features on their labels are the same: effective cleansing, skin-caring, a fresh scent and a soft feel.", after: "the four features on their labels are the same: effective cleansing, care for the skin, a fresh scent and a soft feel." },
        { before: "you can add a free sample to your cart with your own orders.", after: "you can add a free sample to your cart with your own orders; samples are free and not for sale." },
        { round: 2, before: "Liquid hand soap is a small habit we reach for many times a day at the basin.", after: "Liquid hand soap is something we reach for many times a day at the basin." },
      ],
      ar: [
        { before: "المذكورة على ملصقاتها: تنظيف فعّال، ويحمي البشرة، ورائحة منعشة، وملمس ناعم.", after: "المذكورة على ملصقاتها: تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم." },
        { before: "أو إضافة عيّنة مجانية إلى سلّتك مع طلباتك الشخصية.", after: "أو إضافة عيّنة مجانية إلى سلّتك مع طلباتك الشخصية، فالعيّنات مجانية وليست للبيع." },
        { round: 2, before: "الصابون السائل لليدين عادة صغيرة نمدّ أيدينا إليها مرات كثيرة في اليوم عند المغسلة.", after: "الصابون السائل لليدين منتج نمدّ أيدينا إليه مرات كثيرة في اليوم عند المغسلة." },
      ],
    },
  },
  "dus-jeli": {
    body: {
      tr: [
        { before: `karar vermeden önce ${a("/numune", "ücretsiz numune")} isteyebilir.`, after: `karar vermeden önce ${a("/numune", "ücretsiz numune")} isteyebilir; numuneler ücretsizdir ve satılmaz.` },
        { round: 2, before: "temas hâlinde bol suyla durulayın. Ürünü ısı", after: "temas hâlinde bol suyla durulayın. Tahriş oluşursa kullanımı bırakın. Ürünü ısı" },
      ],
      en: [
        { before: "the four features on its label are effective cleansing, skin-caring, a fresh scent and a soft feel.", after: "the four features on its label are effective cleansing, care for the skin, a fresh scent and a soft feel." },
        { before: `and ${a("/numune", "free samples")} before deciding.`, after: `and ${a("/numune", "free samples")} before deciding; samples are free and not for sale.` },
        { round: 2, before: "A shower gel is part of the moment you leave the day behind with the water.", after: "Shower gel is part of the moment you wash the day away." },
        { round: 2, before: "which is why larger formats come first.", after: "which is why larger formats are the practical choice there." },
        { round: 2, before: "rinse with plenty of water. Store the product", after: "rinse with plenty of water. Discontinue use if irritation occurs. Store the product" },
      ],
      ar: [
        { before: "والخصائص الأربع على ملصقه هي: تنظيف فعّال، ويحمي البشرة، ورائحة منعشة، وملمس ناعم.", after: "والخصائص الأربع على ملصقه هي: تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم." },
        { before: `وطلب ${a("/numune", "عيّنات مجانية")} قبل اتخاذ القرار.`, after: `وطلب ${a("/numune", "عيّنات مجانية")} قبل اتخاذ القرار، فالعيّنات مجانية وليست للبيع.` },
        { round: 2, before: "جل الاستحمام جزء من اللحظة التي تترك فيها تعب اليوم مع الماء.", after: "جل الاستحمام جزء من اللحظة التي يغسل فيها الماء تعب اليوم." },
        { round: 2, before: "ولهذا تتقدّم العبوات الكبيرة.", after: "ولهذا تكون العبوات الكبيرة خيارًا عمليًا." },
        { round: 2, before: "اشطفهما بكمية وفيرة من الماء. احفظ المنتج", after: "اشطفهما بكمية وفيرة من الماء. أوقف الاستخدام إذا حدث تهيّج. احفظ المنتج" },
      ],
    },
    faq: [
      { path: [0, "question"], fixes: replaced(SHOWER_GEL_USAGE_FAQ.question, CATEGORY_COPY["dus-jeli"].faq[0].question, 2) },
      { path: [0, "answer"], fixes: replaced(SHOWER_GEL_USAGE_FAQ.answer, CATEGORY_COPY["dus-jeli"].faq[0].answer, 2) },
    ],
    seoTitle: {
      tr: [{ round: 2, before: "Duş Jeli — Ev ve Oteller İçin, 5 L ve 20 L Bidon", after: "Duş Jeli — Evler ve Oteller İçin, 5 L ve 20 L Bidon" }],
    },
    seoDescription: {
      tr: [{ before: "Okyanus duş jeli: serin ve ferah bir koku. Pompalı şişe, 5 litre ve 20 litre bidon seçenekleriyle evler, oteller, spa merkezleri ve spor salonları için.", after: "Duş jeli: ev banyoları, oteller, spa merkezleri ve spor salonları için pompalı şişe, 5 litre ve 20 litre bidon seçenekleri. Serin, ferah Okyanus kokusu." }],
      en: [{ before: "Ocean shower gel with a cool, fresh scent, in a pump bottle or in 5-litre and 20-litre canisters for homes, hotels, spas and gyms. Made in Kayseri.", after: "Shower gel for home bathrooms, hotels, spas and gyms: a pump bottle or 5-litre and 20-litre canisters, with the cool, fresh Ocean scent. Made in Kayseri." }],
      ar: [{ before: "جل الاستحمام المحيط برائحة باردة منعشة، بزجاجة بمضخة أو بعبوات 5 و20 لترًا للمنازل والفنادق ومراكز السبا والصالات الرياضية.", after: "جل الاستحمام لحمّامات المنازل والفنادق ومراكز السبا والصالات الرياضية: زجاجة بمضخة أو عبوات 5 و20 لترًا، برائحة المحيط الباردة المنعشة." }],
    },
  },
  "hediye-setleri": {
    body: {
      tr: [
        { before: `${a("/numune", "ücretsiz numune")} talep edebilir, tek tek`, after: `${a("/numune", "ücretsiz numune")} talep edebilir (numuneler ücretsizdir ve satılmaz), tek tek` },
        { round: 2, before: "Sabun hediye seti arayanlar için PRESTİJ'in dört kokusu tek sette buluşuyor.", after: "PRESTİJ'in dört kokusu, hediye etmek ya da kendiniz kullanmak için tek bir sette buluşuyor." },
        { round: 2, before: "Okyanus duş jeli vücut temizliği içindir. Bidonları", after: "Okyanus duş jeli vücut temizliği içindir. Göz ile temasından kaçının; temas hâlinde bol suyla durulayın. Bidonları" },
      ],
      en: [
        { before: `${a("/numune", "free samples")} to try the scents first, or browse`, after: `${a("/numune", "free samples")} to try the scents first (samples are free and not for sale), or browse` },
        { round: 2, before: "If you are looking for a soap gift set, PRESTİJ brings its four scents together in one set.", after: "PRESTİJ brings its four scents together in one set, to give as a gift or to use yourself." },
        { round: 2, before: "Ocean shower gel is for the body. Store the canisters", after: "Ocean shower gel is for the body. Avoid contact with the eyes; in case of contact, rinse with plenty of water. Store the canisters" },
      ],
      ar: [
        { before: `${a("/numune", "عيّنات مجانية")} لتجربة الروائح أولًا، أو تصفّح`, after: `${a("/numune", "عيّنات مجانية")} لتجربة الروائح أولًا (والعيّنات مجانية وليست للبيع)، أو تصفّح` },
        { round: 2, before: "لمن يبحث عن طقم هدايا صابون، تجتمع روائح PRESTİJ الأربع في طقم واحد.", after: "تجتمع روائح PRESTİJ الأربع في طقم واحد، لتقدّمه هدية أو لتستخدمه بنفسك." },
        { round: 2, before: "وجل الاستحمام المحيط لتنظيف الجسم. احفظ العبوات", after: "وجل الاستحمام المحيط لتنظيف الجسم. تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما بكمية وفيرة من الماء. احفظ العبوات" },
      ],
    },
    faq: [
      {
        path: [1, "answer"],
        fixes: {
          tr: [{ round: 2, before: "Dört kokuyu birden denemek isteyen evler, farklı alanlarda farklı kokular kullanmak isteyen oteller, ofisler ve restoranlar ve özenle seçilmiş bir hediye arayanlar için uygundur.", after: "Dört kokuyu birden denemek isteyen evler ile farklı alanlarda farklı kokular kullanmak isteyen oteller, ofisler ve restoranlar için uygundur; özenle seçilmiş bir hediye olarak da verilebilir." }],
          en: [{ round: 2, before: "It suits homes that want to try all four scents, hotels, offices and restaurants that like different scents in different spaces, and anyone looking for a thoughtfully chosen gift.", after: "It suits homes that want to try all four scents and hotels, offices and restaurants that like different scents in different spaces; it also makes a thoughtfully chosen gift." }],
          ar: [{ round: 2, before: "يناسب المنازل التي ترغب في تجربة الروائح الأربع معًا، والفنادق والمكاتب والمطاعم التي تفضّل روائح مختلفة في مساحات مختلفة، وكل من يبحث عن هدية مختارة بعناية.", after: "يناسب المنازل التي ترغب في تجربة الروائح الأربع معًا، والفنادق والمكاتب والمطاعم التي تفضّل روائح مختلفة في مساحات مختلفة، كما يصلح هديةً مختارة بعناية." }],
        },
      },
    ],
  },
};

/** Arabic product SEO: the Lavender Latte title said "pump" alone; the Okyanus description was 119 characters (min 120). */
export const PRODUCT_SEO_FIXES: Partial<Record<ProductCopySlug, { title?: LocaleFixes; description?: LocaleFixes }>> = {
  "lavanta-latte": {
    title: { ar: [{ before: "صابون لاتيه اللافندر السائل لليدين — مضخة و5 و20 لترًا", after: "صابون لاتيه اللافندر السائل لليدين — عبوة بمضخة و5 و20 لترًا" }] },
  },
  okyanus: {
    description: { ar: [{ before: "لدشات المنازل والفنادق والسبا.", after: "لدشات المنازل والفنادق والسبا، ومصنوع في قيصري." }] },
  },
};
