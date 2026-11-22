// Day-5 blog posts (CONTENT-BLOG): seven helpful articles around sıvı el sabunu, duş jeli and temizlik,
// Turkish first, with complete English and Arabic versions. One informational query per post
// (docs/DAY5-SEO.md §1, §5.6); copy rules in §2 (no medical/biocidal claims, no unprovable superlatives,
// no invented facts, no prices or pump-bottle volume, the eye-contact caution wherever hand-soap usage is
// described, samples "ücretsiz, satılmaz").
//
// Used by scripts/seed.ts (fresh database: seedBlogPosts) and by the `blogPosts` step of
// scripts/content-day5.ts (existing database: loadBlogRefs + existingBlogPostIds + insertBlogPost).
// Bodies are HTML in the blog subset (p, h2, h3, ul/ol/li, strong, a) and pass sanitizeHtml unchanged;
// internal links are stored locale-less with Turkish segments ("/urunler/lavanta") and localized on
// render by localizeBodyLinks. Covers are seeded product photos, referenced by file stem.
import { and, inArray, like } from "drizzle-orm";
import { blogPosts, media, products } from "@/db/schema";
import { readingMinutes } from "@/lib/panel/blog/reading";
import { earlierVersions, undoLocalizedFixes, type LocaleFixes } from "./content-fixes";
import type { ScriptDb } from "./db";

/** A text in all three languages (every blog field is filled in tr, en and ar). */
export type FullText = { tr: string; en: string; ar: string };

export type SeedBlogPost = {
  /** ASCII slug: /blog/<slug> (en/ar use the same slug). */
  slug: string;
  title: FullText;
  /** Plain text: the lead under the H1 and the listing card text. */
  excerpt: FullText;
  /** Sanitized-subset HTML per language. */
  body: FullText;
  /** SEO title (≤ 60 characters before " | PRESTİJ") and meta description (120–155 characters). */
  seo: { title: FullText; description: FullText };
  /** Turkish tags (the column is not localized). */
  tags: string[];
  /** File stem of the cover photo (a seeded media row: urunler/<urun>/<stem>-<width>.webp). */
  cover: string;
  /** 1–3 product slugs shown under "Yazıda geçen ürünler" (sellable products only, never samples). */
  related: string[];
  /** ISO date with offset; every post is in the past. */
  publishedAt: string;
};

export const BLOG_AUTHOR = "PRESTİJ";

// ---------------------------------------------------------------------------------------------------
// HTML helpers (output stays inside the sanitizer's allow-list)

const html = (...blocks: string[]) => blocks.join("");
const p = (text: string) => `<p>${text}</p>`;
const h2 = (text: string) => `<h2>${text}</h2>`;
const h3 = (text: string) => `<h3>${text}</h3>`;
const ul = (...items: string[]) => `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
const ol = (...items: string[]) => `<ol>${items.map((item) => `<li>${item}</li>`).join("")}</ol>`;
const b = (text: string) => `<strong>${text}</strong>`;
const a = (href: string, text: string) => `<a href="${href}">${text}</a>`;

/** Internal link targets (locale-less, Turkish segments; localized on render). */
const TO = {
  handSoap: "/kategori/el-sabunu",
  showerGel: "/kategori/dus-jeli",
  giftSets: "/kategori/hediye-setleri",
  lavantaLatte: "/urunler/lavanta-latte",
  lavanta: "/urunler/lavanta",
  portakal: "/urunler/portakal",
  okyanus: "/urunler/okyanus",
  bundle: "/urunler/dort-koku-koleksiyonu",
  business: "/kurumsal",
  samples: "/numune",
  contact: "/iletisim",
  choosing: "/blog/sivi-el-sabunu-nasil-secilir",
  canisters: "/blog/5-litre-20-litre-sivi-sabun-rehberi",
  refilling: "/blog/sivi-sabun-dispenseri-nasil-doldurulur",
  showerVsBar: "/blog/dus-jeli-mi-kati-sabun-mu",
  businesses: "/blog/otel-ofis-restoran-icin-sivi-sabun",
  handWashing: "/blog/dogru-el-yikama-adimlari",
  scents: "/blog/koku-secimi-lavanta-portakal-okyanus",
} as const;

/** The hand-soap eye-contact caution (contract §2), word for word in each language. */
export const EYE_CAUTION: FullText = {
  tr: "Göz ile temasından kaçının; temas hâlinde bol suyla durulayın.",
  en: "Avoid contact with eyes; in case of contact, rinse thoroughly with water.",
  ar: "تجنّب ملامسة العينين، وفي حال حدوث ذلك اشطفهما جيدًا بالماء.",
};

/** What every link to /numune says about samples (contract §2: "ücretsiz, satılmaz"). */
export const SAMPLES_NOTE: FullText = {
  tr: "numuneler ücretsizdir ve satılmaz",
  en: "samples are free and not for sale",
  ar: "فالعيّنات مجانية وليست للبيع",
};

// ---------------------------------------------------------------------------------------------------
// 1. Doğru el yıkama (targets "temizlik", "el temizliği")

const HAND_WASHING: SeedBlogPost = {
  slug: "dogru-el-yikama-adimlari",
  publishedAt: "2026-09-29T09:30:00+03:00",
  cover: "PRESTIJ_Portakal_Pompali_kullanim_buzlu_amber",
  related: ["portakal", "lavanta", "lavanta-latte"],
  tags: ["El yıkama", "Temizlik", "Hijyen"],
  title: {
    tr: "Doğru El Yıkama: Adım Adım El Temizliği",
    en: "Washing Your Hands Properly: Hand Cleaning Step by Step",
    ar: "غسل اليدين بالطريقة الصحيحة: نظافة اليدين خطوة بخطوة",
  },
  excerpt: {
    tr: "El yıkamak hepimizin her gün yaptığı bir şey; ama çoğumuz birkaç saniyede bitiriyoruz. Doğru el yıkamanın adımlarını, ne zaman el yıkamak gerektiğini ve sık yapılan hataları derledik.",
    en: "We all wash our hands every day, yet most of us are done in a few seconds. Here are the steps of washing your hands properly, when to do it and the mistakes people often make.",
    ar: "نغسل أيدينا جميعًا كل يوم، لكن معظمنا ينتهي في ثوانٍ معدودة. إليك خطوات غسل اليدين بالطريقة الصحيحة، ومتى ينبغي غسلهما، والأخطاء التي يقع فيها كثيرون.",
  },
  seo: {
    title: {
      tr: "Doğru El Yıkama Adımları: El Temizliği Rehberi",
      en: "How to Wash Your Hands Properly, Step by Step",
      ar: "خطوات غسل اليدين الصحيحة: دليل نظافة اليدين",
    },
    description: {
      tr: "Doğru el yıkama nasıl yapılır? En az 20 saniyelik el temizliğinin adımları, ne zaman el yıkamak gerektiği ve sık yapılan hatalar bu rehberde.",
      en: "How do you wash your hands properly? The steps of a hand wash lasting at least 20 seconds, when to wash your hands and common mistakes, in one guide.",
      ar: "كيف تغسل يديك بالطريقة الصحيحة؟ خطوات غسل اليدين لمدة 20 ثانية على الأقل، ومتى ينبغي غسلهما، والأخطاء الشائعة، في دليل واحد.",
    },
  },
  body: {
    tr: html(
      p("Temizlik denince akla önce evler, mutfaklar ve banyolar gelir. Oysa günlük temizliğin en temel adımı, ellerimizi doğru yıkamaktır. Ellerimiz gün boyunca kapı kollarına, telefonlara, paralara ve alışveriş poşetlerine dokunur; ardından yüzümüze, yiyeceklerimize ve çocuklarımıza. Bu yazıda doğru el yıkamanın adımlarını sade bir dille anlattık."),
      h2("Sabun ve su birlikte nasıl temizler?"),
      p("Yalnızca suyla durulamak, ellerdeki yağlı kiri kolayca çözmez. Sabun suyla birlikte köpürdüğünde cilt yüzeyindeki kiri ve yağı çözer; durulama sırasında bunlar suyla birlikte akıp gider. Bu yüzden el yıkamada üç şey birlikte önemlidir: yeterli sabun, yeterli süre ve ovalama. Ovalama, köpüğün parmak aralarına ve tırnak diplerine ulaşmasını sağlar; süre ise bu işin aceleye getirilmeden yapılmasını."),
      h2("Doğru el yıkama: 6 adım"),
      ol(
        `${b("Islatın.")} Ellerinizi temiz, akan suyla ıslatın; su ılık ya da soğuk olabilir. Çok sıcak suya gerek yoktur, ılık su yeterlidir.`,
        `${b("Sabunu alın.")} Pompalı şişeden ya da dispenserden ıslak avucunuza yeterli miktarda sıvı el sabunu alın. Tüm el yüzeyini kaplayacak kadar sabun yeterlidir.`,
        `${b("Köpürtün ve ovun.")} Ellerinizi en az 20 saniye köpürterek ovun. Şu bölgeleri atlamayın:${ul(
          "avuç içleri,",
          "ellerin üstü,",
          "parmak araları,",
          "başparmaklar (her birini diğer elinizle kavrayıp döndürerek),",
          "parmak uçları ve tırnak dipleri (parmak uçlarınızı diğer avucunuza sürterek),",
          "bilekler.",
        )}`,
        `${b("Durulayın.")} Ellerinizi akan suyun altında, köpük tamamen gidene kadar durulayın.`,
        `${b("Kurulayın.")} Temiz bir havlu ya da kâğıt havluyla iyice kurulayın. Ortak kullanılan alanlarda tek kullanımlık kâğıt havlu ya da kişisel havlu tercih edin; evdeki el havlularını sık sık değiştirin.`,
        `${b("Musluğu kapatın.")} Umumi lavabolarda musluğu, ellerinizi kuruladığınız kâğıt havluyla kapatabilirsiniz.`,
      ),
      p("20 saniyeyi tutturmak için içinizden yavaşça yirmiye kadar sayabilir ya da kısa bir şarkıyı iki kez mırıldanabilirsiniz. Çocuklar için bu küçük oyun, el yıkamayı alışkanlık hâline getirmenin keyifli bir yoludur."),
      h3("Lavabo için sıvı sabun mu, katı sabun mu?"),
      p(`İkisiyle de eller yıkanabilir. Pompalı şişedeki sıvı sabun kolayca dozlanır ve ortak kullanılan lavabolarda herkesin ürüne dokunmadan kendi payını almasını sağlar; katı sabunun ise suyun süzülebildiği bir sabunlukta kuru tutulması gerekir. İki formu duş için karşılaştırdığımız yazı: ${a(TO.showerVsBar, "Duş jeli mi, katı sabun mu?")}`),
      h2("Ne zaman el yıkamalı?"),
      p("Bazı anları alışkanlığa dönüştürmek, gün içinde el yıkamayı hatırlamanızı kolaylaştırır:"),
      ul(
        "yemek hazırlamadan önce, hazırlarken (özellikle çiğ et, tavuk ya da yumurtayla çalıştıktan sonra) ve sonra,",
        "yemekten önce,",
        "tuvaleti kullandıktan ve bebek bezi değiştirdikten sonra,",
        "dışarıdan eve döndüğünüzde,",
        "çöpe dokunduktan sonra,",
        "evcil hayvanlarınızı besledikten ya da sevdikten sonra,",
        "burnunuzu sildikten, öksürdükten ya da hapşırdıktan sonra,",
        "elleriniz gözle görülür biçimde kirlendiğinde.",
      ),
      h2("Sık yapılan hatalar"),
      ul(
        `${b("Çok kısa yıkamak:")} Birkaç saniyelik bir durulama, köpürtme ve ovalama adımlarını atlamak demektir.`,
        `${b("Başparmakları ve tırnak diplerini unutmak:")} El yıkarken sıkça atlanan bölgelerdir.`,
        `${b("Az sabun kullanmak:")} Tüm eli kaplamayan sabun, ovalarken her bölgeye ulaşmaz.`,
        `${b("Kurulamayı atlamak:")} Elleri ıslak bırakmak ya da kirli bir havluyla kurulamak, yıkamaya gösterdiğiniz özeni boşa çıkarır.`,
        `${b("Yüzükleri çıkarmamak:")} Yüzük ve bilekliklerin altındaki cilt de yıkanmalıdır; mümkünse yıkamadan önce çıkarın.`,
      ),
      h2("Mutfakta el temizliği"),
      p("Mutfak, ellerin gün içinde en sık yıkandığı yerlerden biridir. Birkaç alışkanlık işinizi kolaylaştırır:"),
      ul(
        "Çiğ et, tavuk, balık ya da yumurtayla çalıştıktan sonra başka bir malzemeye dokunmadan önce ellerinizi yıkayın.",
        "El havlusunu bulaşık ve tezgâh bezinden ayrı tutun.",
        "Eviyenin yanında, bulaşık deterjanından ayrı bir pompalı şişe sıvı el sabunu bulundurun; her ürünü kendi amacı için kullanın.",
        "Yemek hazırlarken telefonunuza ya da çöpe dokunduysanız, malzemelere dönmeden önce ellerinizi yeniden yıkayın.",
      ),
      h2("Çocuklara el yıkamayı öğretmek"),
      p("Çocuklar el yıkamayı çoğunlukla büyüklerini izleyerek öğrenir. Şu küçük adımlar, bu alışkanlığı erken yaşta kazanmalarına yardımcı olur:"),
      ul(
        "Lavaboya rahatça ulaşabilmeleri için sağlam, kaymayan bir basamak kullanın.",
        "Adımları birlikte yapın; 20 saniyeyi bir şarkıyla oyuna dönüştürün.",
        "Küçük çocuklar el yıkarken bir yetişkin eşlik etsin ve sabunun göze kaçmamasına dikkat edin.",
        "Yemekten önce ve dışarıdan gelince el yıkamayı bir aile kuralı hâline getirin.",
      ),
      h2("Ellerinizin konforu için"),
      p("Ellerinizi sık yıkıyorsanız, ellerinizin kendini rahat hissetmesi de önemlidir. Ilık su kullanın, ellerinizi iyice durulayın ve havluyla nazikçe kurulayın. Elleriniz kurumuş hissediyorsa, kuruladıktan sonra el kreminizi kullanabilirsiniz. Herhangi bir üründe tahriş fark ederseniz kullanmayı bırakın."),
      p(`Sıvı el sabununu kullanırken dikkat: ${EYE_CAUTION.tr} Sabunu ısı ve direkt güneş ışığından uzakta, çocukların ulaşamayacağı bir yerde saklayın.`),
      h2("Evde ve iş yerinde el temizliğini kolaylaştırın"),
      p(`Doğru el yıkama alışkanlığı, sabunun kolay ulaşılabilir olmasıyla başlar. Her lavaboda dolu bir pompalı şişe ya da dispenser bulundurun; mutfak, banyo ve misafir lavabosu için ayrı şişeler kullanın. Sabunun bitmesini beklemeden stok yapmak isteyenler için 5 L ve 20 L bidonlar pratik bir çözümdür; doldururken nelere dikkat etmeniz gerektiğini ${a(TO.refilling, "dispenser doldurma rehberimizde")} anlattık.`),
      p(`İşletmelerde ise el yıkama noktalarının her zaman dolu ve düzenli olması, çalışanlara ve misafirlere gösterilen özenin bir işaretidir. Oteller, ofisler ve restoranlar için önerilerimizi ${a(TO.businesses, "işletmeler için sıvı sabun rehberinde")} bulabilirsiniz.`),
      p(`${a(TO.lavanta, "Lavanta")}, ${a(TO.lavantaLatte, "Lavanta Latte")} ve ${a(TO.portakal, "Portakal")} kokulu seçeneklerimizi ${a(TO.handSoap, "sıvı el sabunu")} kategorisinde inceleyebilirsiniz. Kokuları denemek isterseniz sepetinize ücretsiz numune ekleyebilir, işletmeniz için ${a(TO.samples, "ücretsiz numune")} isteyebilirsiniz; ${SAMPLES_NOTE.tr}.`),
    ),
    en: html(
      p("When we think of cleaning, homes, kitchens and bathrooms usually come to mind first. Yet the most basic step of everyday cleanliness is washing our hands properly. During the day our hands touch door handles, phones, money and shopping bags, and then our faces, our food and our children. In this article we explain the steps of proper handwashing in plain language."),
      h2("How do soap and water clean together?"),
      p("Rinsing with water alone does not easily remove greasy dirt from your hands. When soap lathers with water, it loosens dirt and oil on the surface of the skin, and these are carried away with the water as you rinse. That is why three things matter together in handwashing: enough soap, enough time and rubbing. Rubbing carries the lather between your fingers and under your nails; taking enough time makes sure the job isn't rushed."),
      h2("Proper handwashing in 6 steps"),
      ol(
        `${b("Wet.")} Wet your hands with clean running water; it can be lukewarm or cold. There is no need for very hot water: lukewarm is enough.`,
        `${b("Apply soap.")} Take enough liquid hand soap from the pump bottle or dispenser into your wet palm. Enough to cover the whole surface of your hands will do.`,
        `${b("Lather and rub.")} Rub your hands with lather for at least 20 seconds. Don't skip these areas:${ul(
          "your palms,",
          "the backs of your hands,",
          "between your fingers,",
          "your thumbs (grip each one with the other hand and rotate it),",
          "your fingertips and under your nails (rub your fingertips against the other palm),",
          "your wrists.",
        )}`,
        `${b("Rinse.")} Rinse your hands under running water until all the lather is gone.`,
        `${b("Dry.")} Dry them thoroughly with a clean towel or a paper towel. In shared spaces, choose single-use paper towels or a personal towel; change the hand towels at home often.`,
        `${b("Turn off the tap.")} In public restrooms, you can turn off the tap with the paper towel you used to dry your hands.`,
      ),
      p("To reach 20 seconds, you can count slowly to twenty in your head or hum a short song twice. For children, this little game is a fun way to make handwashing a habit."),
      h3("Liquid soap or bar soap at the basin?"),
      p(`You can wash your hands with either. Liquid soap in a pump bottle is easy to dose and, at shared basins, lets everyone take their own share without touching the product; a bar of soap needs to be kept dry in a dish that lets water drain away. We compare the two forms for the shower in ${a(TO.showerVsBar, "Shower gel or bar soap?")}`),
      h2("When should you wash your hands?"),
      p("Turning certain moments into habits makes it easier to remember to wash your hands during the day:"),
      ul(
        "before, while and after preparing food (especially after handling raw meat, poultry or eggs),",
        "before eating,",
        "after using the toilet and after changing a nappy,",
        "when you come home from outside,",
        "after touching rubbish,",
        "after feeding or stroking your pets,",
        "after blowing your nose, coughing or sneezing,",
        "whenever your hands are visibly dirty.",
      ),
      h2("Common mistakes"),
      ul(
        `${b("Washing too quickly:")} a rinse of a few seconds means skipping the lathering and rubbing steps.`,
        `${b("Forgetting thumbs and nails:")} these areas are often missed when washing hands.`,
        `${b("Using too little soap:")} soap that does not cover your whole hands cannot reach every area as you rub.`,
        `${b("Skipping drying:")} leaving your hands wet or drying them on a dirty towel undoes the care you put into washing.`,
        `${b("Keeping rings on:")} the skin under rings and bracelets needs washing too; take them off before washing if you can.`,
      ),
      h2("Hand cleaning in the kitchen"),
      p("The kitchen is one of the places where hands are washed most often during the day. A few habits make it easier:"),
      ul(
        "After handling raw meat, poultry, fish or eggs, wash your hands before touching any other ingredient.",
        "Keep your hand towel separate from the dish and counter cloths.",
        "Keep a pump bottle of liquid hand soap by the kitchen sink, separate from the washing-up liquid; use each product for its own purpose.",
        "If you touched your phone or the bin while cooking, wash your hands again before going back to the ingredients.",
      ),
      h2("Teaching children to wash their hands"),
      p("Children mostly learn handwashing by watching the adults around them. These small steps help them pick up the habit early:"),
      ul(
        "Use a sturdy, non-slip step so they can reach the basin comfortably.",
        "Go through the steps together and turn the 20 seconds into a game with a song.",
        "Have an adult stay with young children while they wash their hands, and make sure no soap gets into their eyes.",
        "Make washing hands before meals and after coming home a family rule.",
      ),
      h2("For the comfort of your hands"),
      p("If you wash your hands often, it matters that they feel comfortable too. Use lukewarm water, rinse your hands well and pat them dry gently with a towel. If your hands feel dry, you can use your hand cream after drying them. If you notice irritation with any product, stop using it."),
      p(`A note on using liquid hand soap: ${EYE_CAUTION.en} Store the soap away from heat and direct sunlight, out of the reach of children.`),
      h2("Make hand cleaning easy at home and at work"),
      p(`A good handwashing habit starts with soap being within easy reach. Keep a full pump bottle or dispenser at every basin, and use separate bottles for the kitchen, the bathroom and the guest washroom. If you would rather keep a stock than wait for the soap to run out, 5 L and 20 L canisters are a practical solution; we explain what to keep in mind when refilling in our ${a(TO.refilling, "dispenser refilling guide")}.`),
      p(`In businesses, handwashing points that are always full and tidy are a sign of the care shown to staff and guests. You will find our tips for hotels, offices and restaurants in the ${a(TO.businesses, "liquid soap guide for businesses")}.`),
      p(`Browse our ${a(TO.lavanta, "Lavender")}, ${a(TO.lavantaLatte, "Lavender Latte")} and ${a(TO.portakal, "Orange")} options in the ${a(TO.handSoap, "liquid hand soap")} category. If you would like to try the scents, you can add a free sample to your cart, or request ${a(TO.samples, "free samples")} for your business; ${SAMPLES_NOTE.en}.`),
    ),
    ar: html(
      p("عندما نفكّر في النظافة، تخطر في بالنا أولًا المنازل والمطابخ والحمّامات. لكن الخطوة الأساسية في النظافة اليومية هي غسل اليدين بالطريقة الصحيحة. فأيدينا تلمس خلال اليوم مقابض الأبواب والهواتف والنقود وأكياس التسوّق، ثم وجوهنا وطعامنا وأطفالنا. نشرح في هذا المقال خطوات غسل اليدين الصحيحة بلغة بسيطة."),
      h2("كيف ينظّف الصابون والماء معًا؟"),
      p("الشطف بالماء وحده لا يزيل الأوساخ الدهنية عن اليدين بسهولة. فعندما يكوّن الصابون رغوة مع الماء، فإنه يفكّك الأوساخ والدهون على سطح البشرة، فتنجرف مع الماء أثناء الشطف. لذلك تجتمع في غسل اليدين ثلاثة أمور مهمة: كمية كافية من الصابون، ووقت كافٍ، والفرك. فالفرك يوصل الرغوة إلى ما بين الأصابع وتحت الأظافر، والوقت الكافي يضمن ألّا تُنجز المهمة على عجل."),
      h2("غسل اليدين الصحيح في 6 خطوات"),
      ol(
        `${b("البلّ.")} بلّل يديك بماء جارٍ نظيف، فاترًا كان أو باردًا. لا حاجة إلى ماء ساخن جدًا، فالماء الفاتر يكفي.`,
        `${b("أخذ الصابون.")} خذ من الزجاجة بالمضخة أو من الموزّع كمية كافية من صابون اليدين السائل في راحة يدك المبللة؛ تكفي كمية تغطي سطح اليدين كله.`,
        `${b("تكوين الرغوة والفرك.")} افرك يديك بالرغوة لمدة 20 ثانية على الأقل، ولا تُغفل هذه المناطق:${ul(
          "راحتا اليدين،",
          "ظهر اليدين،",
          "ما بين الأصابع،",
          "الإبهامان (أمسك كلًّا منهما باليد الأخرى وأدره)،",
          "أطراف الأصابع وما تحت الأظافر (بفرك أطراف أصابعك براحة اليد الأخرى)،",
          "الرسغان.",
        )}`,
        `${b("الشطف.")} اشطف يديك تحت الماء الجاري حتى تزول الرغوة تمامًا.`,
        `${b("التجفيف.")} جفّفهما جيدًا بمنشفة نظيفة أو بمنديل ورقي. وفي الأماكن المشتركة، اختر المناديل الورقية أحادية الاستخدام أو منشفة شخصية، وبدّل مناشف اليدين في المنزل كثيرًا.`,
        `${b("إغلاق الصنبور.")} في دورات المياه العامة، يمكنك إغلاق الصنبور بالمنديل الورقي الذي جفّفت به يديك.`,
      ),
      p("لتبلغ 20 ثانية، يمكنك العدّ ببطء حتى عشرين في سرّك، أو دندنة أغنية قصيرة مرتين. وبالنسبة إلى الأطفال، تُعدّ هذه اللعبة الصغيرة طريقة ممتعة لجعل غسل اليدين عادة."),
      h3("صابون سائل أم صابون صلب للمغسلة؟"),
      p(`يمكن غسل اليدين بأي منهما. فالصابون السائل في زجاجة بمضخة يسهل أخذ الكمية المناسبة منه، ويتيح عند المغاسل المشتركة لكل شخص أن يأخذ حصته دون أن يلمس المنتج؛ أما قالب الصابون فيجب إبقاؤه جافًا في صحن يسمح بتصريف الماء. وقد قارنّا بين الشكلين للاستحمام في مقال ${a(TO.showerVsBar, "جل الاستحمام أم الصابون الصلب؟")}`),
      h2("متى ينبغي غسل اليدين؟"),
      p("يسهّل عليك تحويل بعض اللحظات إلى عادات أن تتذكّر غسل يديك خلال اليوم:"),
      ul(
        "قبل إعداد الطعام وأثناءه وبعده (خاصةً بعد التعامل مع اللحوم أو الدواجن النيئة أو البيض)،",
        "قبل الأكل،",
        "بعد استخدام المرحاض وبعد تغيير حفاض الطفل،",
        "عند العودة إلى المنزل من الخارج،",
        "بعد لمس القمامة،",
        "بعد إطعام حيواناتك الأليفة أو مداعبتها،",
        "بعد تنظيف الأنف أو السعال أو العطس،",
        "كلما بدت يداك متّسختين.",
      ),
      h2("أخطاء شائعة"),
      ul(
        `${b("الغسل السريع جدًا:")} الشطف لبضع ثوانٍ يعني تجاوز خطوتي تكوين الرغوة والفرك.`,
        `${b("نسيان الإبهامين والأظافر:")} هذه هي المناطق التي يُغفل عنها كثيرًا عند غسل اليدين.`,
        `${b("استخدام كمية قليلة من الصابون:")} الصابون الذي لا يغطي اليدين كلتيهما لا يصل إلى كل المناطق أثناء الفرك.`,
        `${b("إهمال التجفيف:")} ترك اليدين مبللتين أو تجفيفهما بمنشفة متّسخة يُضيّع العناية التي بذلتها في الغسل.`,
        `${b("إبقاء الخواتم:")} البشرة تحت الخواتم والأساور تحتاج إلى الغسل أيضًا، فانزعها قبل الغسل إن أمكن.`,
      ),
      h2("نظافة اليدين في المطبخ"),
      p("المطبخ من أكثر الأماكن التي تُغسل فيها اليدان خلال اليوم، وبعض العادات تسهّل عليك الأمر:"),
      ul(
        "بعد التعامل مع اللحوم أو الدواجن أو الأسماك النيئة أو البيض، اغسل يديك قبل أن تلمس أي مكوّن آخر.",
        "أبقِ منشفة اليدين منفصلة عن مناشف الأطباق وقطع قماش السطح.",
        "احتفظ بجانب حوض المطبخ بزجاجة بمضخة من صابون اليدين السائل، منفصلة عن سائل غسل الأطباق، واستخدم كل منتج للغرض المخصّص له.",
        "إذا لمست هاتفك أو سلة القمامة أثناء الطهي، فاغسل يديك مجددًا قبل العودة إلى المكوّنات.",
      ),
      h2("تعليم الأطفال غسل اليدين"),
      p("يتعلّم الأطفال غسل اليدين في الغالب بمراقبة الكبار من حولهم، وهذه الخطوات الصغيرة تساعدهم على اكتساب العادة مبكرًا:"),
      ul(
        "استخدم درجة ثابتة غير زلقة ليصلوا إلى المغسلة بسهولة.",
        "أدِّ الخطوات معهم، وحوّل الثواني العشرين إلى لعبة مع أغنية.",
        "ليرافق شخص بالغ الأطفال الصغار أثناء غسل أيديهم، مع الحرص على ألّا يصل الصابون إلى أعينهم.",
        "اجعل غسل اليدين قبل الطعام وعند العودة إلى المنزل قاعدة عائلية.",
      ),
      h2("من أجل راحة يديك"),
      p("إذا كنت تغسل يديك كثيرًا، فمن المهم أن تشعر يداك بالراحة أيضًا. استخدم ماءً فاترًا، واشطف يديك جيدًا، وجفّفهما بالمنشفة بلطف. وإذا شعرت بجفاف يديك، يمكنك استخدام كريم اليدين بعد التجفيف. وإذا لاحظت تهيّجًا مع أي منتج، فتوقّف عن استخدامه."),
      p(`تنبيه عند استخدام صابون اليدين السائل: ${EYE_CAUTION.ar} واحفظ الصابون بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.`),
      h2("اجعل نظافة اليدين سهلة في المنزل والعمل"),
      p(`تبدأ عادة غسل اليدين الجيدة بأن يكون الصابون في متناول اليد. احتفظ بزجاجة بمضخة أو موزّع ممتلئ عند كل مغسلة، واستخدم زجاجات منفصلة للمطبخ والحمّام ومغسلة الضيوف. ولمن يفضّل الاحتفاظ بمخزون بدلًا من انتظار نفاد الصابون، تمثّل عبوات 5 لترات و20 لترًا حلًّا عمليًا؛ وقد شرحنا ما ينبغي مراعاته عند التعبئة في ${a(TO.refilling, "دليل إعادة تعبئة الموزّعات")}.`),
      p(`أما في المنشآت، فإن نقاط غسل اليدين الممتلئة والمرتّبة دائمًا علامة على العناية بالموظفين والضيوف. ستجد نصائحنا للفنادق والمكاتب والمطاعم في ${a(TO.businesses, "دليل الصابون السائل للمنشآت")}.`),
      p(`تصفّح خياراتنا ${a(TO.lavanta, "اللافندر")} و${a(TO.lavantaLatte, "لاتيه اللافندر")} و${a(TO.portakal, "البرتقال")} في فئة ${a(TO.handSoap, "صابون اليدين السائل")}. وإن أردت تجربة الروائح، يمكنك إضافة عيّنة مجانية إلى سلّتك، أو طلب ${a(TO.samples, "عيّنات مجانية")} لمنشأتك؛ ${SAMPLES_NOTE.ar}.`),
    ),
  },
};

// ---------------------------------------------------------------------------------------------------
// 2. Duş jeli mi, katı sabun mu? (targets "duş jeli")

const SHOWER_GEL_VS_BAR: SeedBlogPost = {
  slug: "dus-jeli-mi-kati-sabun-mu",
  publishedAt: "2026-10-06T09:30:00+03:00",
  cover: "PRESTIJ_Okyanus_Pompali_dus_jeli_kullanim",
  related: ["okyanus", "dort-koku-koleksiyonu"],
  tags: ["Duş jeli", "Kişisel bakım", "Karşılaştırma"],
  title: {
    tr: "Duş Jeli mi, Katı Sabun mu? Farklar ve Seçim Önerileri",
    en: "Shower Gel or Bar Soap? Differences and How to Choose",
    ar: "جل الاستحمام أم الصابون الصلب؟ الفروق وكيف تختار",
  },
  excerpt: {
    tr: "Duşta jel mi kullanmalı, kalıp sabun mu? İkisini kullanım, saklama, ortak kullanım ve seyahat açısından tarafsız bir gözle karşılaştırdık; hangisinin size uygun olduğuna karar vermeniz kolaylaşsın.",
    en: "Gel or bar in the shower? We compare the two fairly in terms of use, storage, sharing and travel, to make it easier to decide which one suits you.",
    ar: "جل أم قالب صابون تحت الدش؟ قارنّا بينهما بإنصاف من حيث الاستخدام والحفظ والاستعمال المشترك والسفر، ليسهل عليك أن تقرّر أيهما يناسبك.",
  },
  seo: {
    title: {
      tr: "Duş Jeli mi Katı Sabun mu? Farklar ve Öneriler",
      en: "Shower Gel or Bar Soap? Key Differences Explained",
      ar: "جل الاستحمام أم الصابون الصلب؟ الفروق والنصائح",
    },
    description: {
      tr: "Duş jeli mi katı sabun mu? Kullanım, saklama, ortak kullanım ve seyahat açısından farkları tarafsızca karşılaştırdık; size uygun olanı seçin.",
      en: "Shower gel or bar soap? We compare how they differ in use, storage, sharing and travel, so you can decide which one suits your routine.",
      ar: "جل الاستحمام أم الصابون الصلب؟ قارنّا بينهما في الاستخدام والحفظ والاستعمال المشترك والسفر، لتختار ما يناسب روتينك اليومي.",
    },
  },
  body: {
    tr: html(
      p("Duş rutini kişisel bir alışkanlıktır: Kimi kalıp sabunun sadeliğinden vazgeçmez, kimi duş jelinin köpüğünü ve kokusunu tercih eder. İkisi de vücut temizliği için kullanılır; asıl farkı formları, kullanım şekilleri ve günlük hayatta sundukları pratiklik yaratır. Bu yazıda duş jeli ile katı sabunu tarafsız bir gözle karşılaştırdık ve hangisinin size uygun olabileceğine dair pratik öneriler derledik."),
      h2("Temel fark: form ve kullanım"),
      p("Katı sabun, kalıp hâlinde doğrudan ıslak cilde ya da keseye sürülerek köpürtülür. Duş jeli ise sıvı formdadır; avuca, süngere ya da life alınarak köpürtülür. Bu küçük fark; dozlama, saklama, paylaşım ve seyahat gibi pek çok konuda farklı sonuçlar doğurur."),
      h2("Yan yana karşılaştırma"),
      h3("Kullanım ve dozlama"),
      p("Duş jelini pompalı şişeden ya da kapaklı ambalajından istediğiniz kadar alırsınız; bir sünger ya da lif köpüğü hızla artırır. Katı sabunda miktarı ayarlamak daha zordur, ama kullanımı son derece basittir: ıslatın, köpürtün, durulayın."),
      h3("Saklama"),
      p("Katı sabun, kullanımdan sonra suyun süzülebildiği bir sabunlukta durmalıdır; ıslak bir yüzeyde kalırsa yumuşar ve dağılır. Duş jeli ise kapağı kapalı ya da pompalı bir şişede, duş rafında düzenli durur."),
      h3("Paylaşım"),
      p("Ailede ya da ortak kullanılan banyolarda pompalı şişedeki duş jeli, herkesin ürüne doğrudan dokunmadan kendi payını almasını sağlar. Katı sabunda ise herkes aynı kalıbı kullanır. Bu yüzden pek çok kişi ortak alanlarda pompalı şişeyi daha düzenli bulur; otellerin ve spor salonlarının duşlarında dispenser ve pompalı şişelerin yaygın olmasının bir nedeni de budur."),
      h3("Seyahat"),
      p("Katı sabun sıvı kısıtlamalarına takılmaz ve az yer kaplar; ancak ıslak kalıbı taşımak için bir kutu gerekir. Duş jelini ise yolculukta küçük, sızdırmaz bir şişeye aktararak taşıyabilirsiniz."),
      h3("Koku ve his"),
      p("Her iki üründe de koku ve ciltte bıraktığı his formüle göre değişir. Duş jelinde köpük yayıldıkça koku da duşun her yerine yayılır; bu, duşu küçük bir ritüele dönüştürmek isteyenlerin sevdiği bir özelliktir."),
      h2("Hangisi size uygun?"),
      ul(
        `${b("Duş jeli seçin:")} Köpüklü ve kokulu bir duş seviyorsanız, banyoyu birden fazla kişi kullanıyorsa ya da kolay dozlanan bir pompalı şişe istiyorsanız.`,
        `${b("Katı sabun seçin:")} Sade bir rutin istiyorsanız, sık seyahat ediyorsanız ve sabunluğu kuru tutabileceğiniz bir düzeniniz varsa.`,
        `${b("İkisini birlikte kullanın:")} Evde duş jeli, seyahatte katı sabun size daha pratik geliyorsa.`,
      ),
      p("Cildinizin hassasiyetleri varsa, hangi formu seçerseniz seçin içerik listesini okuyun; tahriş fark ederseniz kullanmayı bırakın."),
      h2("Duş jeli seçerken nelere bakmalı?"),
      ul(
        `${b("Etiket:")} Ürünün vücut temizliği için hazırlandığını, kullanım şeklini ve uyarıları etikette görün.`,
        `${b("Koku:")} Sabah duşu için ferah, akşam için daha sakin bir koku tercih edebilirsiniz. Koku köpükle birlikte duşa yayılacağı için dengeli olması önemlidir.`,
        `${b("Ambalaj:")} Ev için pompalı şişe pratiktir. Sık kullanan kalabalık aileler ve işletmeler için şişeyi bidondan yeniden doldurmak daha seyrek alışveriş demektir.`,
        `${b("Kullanan kişi sayısı:")} Kalabalık bir evde ya da bir spor salonunda duş jeli çabuk tükenir; bidondan doldurulan bir pompalı şişe, stokun bitmesini beklemeden planlama yapmanızı sağlar.`,
        `${b("Açıldıktan sonra kullanım süresi:")} Etiketteki açık kavanoz simgesi, ürünün açıldıktan sonra kaç ay içinde kullanılması gerektiğini gösterir.`,
      ),
      h2("Duş jeli nasıl kullanılır?"),
      ol(
        "Cildinizi ılık suyla ıslatın.",
        "Duş jelini avucunuza, bir süngere ya da life alın.",
        "Köpürtün ve vücudunuza nazikçe yayın.",
        "Bol suyla durulayın.",
      ),
      p("Sünger ya da lif kullanmak köpüğü artırır; böylece az miktarda ürün geniş bir alana yayılır. Lifinizi her kullanımdan sonra durulayıp kurumaya bırakın."),
      h3("Duş rutininde küçük ipuçları"),
      ul(
        "Çoğu kişi ılık suyu daha konforlu bulur; duşu gereğinden uzun tutmanıza gerek yok.",
        "Durulamayı aceleye getirmeyin; köpüğün sırtınızdan ve omuzlarınızdan tamamen gittiğinden emin olun.",
        "Duştan sonra cildinizi havluyla bastırarak nazikçe kurulayın.",
        "Duş jelini ve lifinizi duşun ıslak zemininde değil, rafta tutun; şişenin kapağını kapalı bırakın.",
        "Banyoyu duştan sonra havalandırın; nemi çabuk atılan bir banyo daha düzenli görünür.",
      ),
      p(`Duş jeli harici kullanım içindir. ${EYE_CAUTION.tr} Tahriş oluşursa kullanımı bırakın. Ürünü çocukların ulaşamayacağı, serin ve güneş almayan bir yerde saklayın.`),
      p(`Duş jeli vücut, sıvı el sabunu ise el temizliği için hazırlanır; her ürünü etiketindeki kullanım alanına göre kullanın. Lavabo için seçim yapıyorsanız ${a(TO.choosing, "sıvı el sabunu seçme rehberimize")} göz atabilirsiniz.`),
      h2("Evde, otelde ve spor salonunda"),
      p(`Evde duş jelini pompalı şişede tutmak duş rafında düzen sağlar. Oteller, spa merkezleri ve spor salonları içinse duvar dispenserleri ve pompalı şişeler, her misafir için ayrı küçük ambalaj kullanmaya pratik bir alternatiftir; bu şişeler 5 L ya da 20 L bidonlardan yeniden doldurulabilir. Nasıl yapılacağını ${a(TO.refilling, "dispenser doldurma rehberimizde")} anlattık; işletmeler için daha fazla öneriyi ${a(TO.businesses, "oteller, ofisler ve restoranlar için hazırladığımız rehberde")} bulabilirsiniz.`),
      h2("PRESTİJ Okyanus duş jeli"),
      p(`${a(TO.okyanus, "Okyanus duş jeli")}, suyun berraklığını ve köpüğün hafifliğini anımsatan ferah kokusuyla duş rutininize serin bir an katar. Pompalı şişe, 5 L ve 20 L bidon seçenekleriyle evde de işletmelerde de kullanılabilir. Tüm seçenekler için ${a(TO.showerGel, "duş jeli")} kategorimize, dört kokuyu bir arada denemek için ${a(TO.bundle, "Dört Koku Koleksiyonu")}'na göz atabilirsiniz. İşletmeniz için ${a(TO.samples, "ücretsiz numune")} isteyebilirsiniz; ${SAMPLES_NOTE.tr}.`),
    ),
    en: html(
      p("Your shower routine is a personal habit: some people would never give up the simplicity of a bar of soap, others prefer the lather and scent of a shower gel. Both are used for cleansing the body; the real differences come from their form, the way they are used and how practical they are in everyday life. In this article we compare shower gel and bar soap fairly and share practical tips on which one may suit you."),
      h2("The basic difference: form and use"),
      p("Bar soap is a solid bar that you rub directly on wet skin or on a bath mitt to work up a lather. Shower gel is a liquid: you lather it in your palm, on a sponge or on a loofah. This small difference leads to different results in many areas, such as dosing, storage, sharing and travel."),
      h2("A side-by-side comparison"),
      h3("Use and dosing"),
      p("With shower gel you take exactly as much as you want from a pump bottle or flip-top pack, and a sponge or loofah quickly builds up the lather. With bar soap it is harder to control the amount, but it is extremely simple to use: wet, lather, rinse."),
      h3("Storage"),
      p("After use, a bar of soap should sit in a soap dish that lets water drain away; left on a wet surface, it softens and crumbles. Shower gel stays neatly on the shower shelf in a closed or pump bottle."),
      h3("Sharing"),
      p("In family or shared bathrooms, shower gel in a pump bottle lets everyone take their own share without touching the product directly. With bar soap, everyone uses the same bar. That is why many people find a pump bottle tidier in shared spaces, and it is one reason dispensers and pump bottles are common in hotel and gym showers."),
      h3("Travel"),
      p("Bar soap is not affected by liquid restrictions and takes up little space, though you need a case to carry a wet bar. You can take shower gel on a journey by decanting it into a small, leak-proof bottle."),
      h3("Scent and feel"),
      p("In both products, the scent and the way your skin feels afterwards depend on the formula. With shower gel, the scent fills the shower as the lather spreads, which is something people who like to turn their shower into a small ritual love."),
      h2("Which one suits you?"),
      ul(
        `${b("Choose shower gel")} if you love a lathery, fragrant shower, if more than one person uses the bathroom or if you want an easy-to-dose pump bottle.`,
        `${b("Choose bar soap")} if you want a simple routine, travel often and can keep your soap dish dry.`,
        `${b("Use both")} if shower gel at home and bar soap when travelling feels more practical to you.`,
      ),
      p("If your skin has sensitivities, read the ingredients list whichever form you choose, and stop using a product if you notice irritation."),
      h2("What to look for in a shower gel"),
      ul(
        `${b("The label:")} check that the product is made for cleansing the body, and read the directions and warnings.`,
        `${b("Scent:")} you might prefer a fresh scent for a morning shower and a calmer one in the evening. As the scent spreads through the shower with the lather, a balanced one matters.`,
        `${b("Packaging:")} a pump bottle is practical at home. For large families and businesses that use a lot, refilling the bottle from a canister means shopping less often.`,
        `${b("How many people use it:")} in a busy home or a gym, shower gel runs out quickly; a pump bottle refilled from a canister lets you plan ahead instead of waiting for the stock to run out.`,
        `${b("Period after opening:")} the open-jar symbol on the label tells you how many months the product should be used within once opened.`,
      ),
      h2("How to use shower gel"),
      ol(
        "Wet your skin with lukewarm water.",
        "Take some shower gel in your palm, on a sponge or on a loofah.",
        "Work up a lather and spread it gently over your body.",
        "Rinse thoroughly with water.",
      ),
      p("Using a sponge or loofah builds up the lather, so a small amount of product covers a large area. Rinse your loofah after every use and leave it to dry."),
      h3("Small tips for your shower routine"),
      ul(
        "Most people find lukewarm water more comfortable, and there is no need to make your shower longer than necessary.",
        "Don't rush the rinse; make sure the lather has gone completely from your back and shoulders.",
        "After your shower, pat your skin dry gently with a towel.",
        "Keep your shower gel and loofah on the shelf rather than on the wet floor of the shower, and keep the bottle closed.",
        "Air the bathroom after your shower; a bathroom that clears its humidity quickly looks tidier.",
      ),
      p(`Shower gel is for external use only. ${EYE_CAUTION.en} Discontinue use if irritation occurs. Keep the product out of the reach of children, in a cool place away from sunlight.`),
      p(`Shower gel is made for the body and liquid hand soap for the hands; use each product for the purpose on its label. If you are choosing a soap for the basin, take a look at our ${a(TO.choosing, "guide to choosing liquid hand soap")}.`),
      h2("At home, in hotels and at the gym"),
      p(`At home, keeping shower gel in a pump bottle keeps the shower shelf tidy. For hotels, spas and gyms, wall dispensers and pump bottles are a practical alternative to small individual packs for each guest; these bottles can be refilled from 5 L or 20 L canisters. We explain how in our ${a(TO.refilling, "dispenser refilling guide")}, and you will find more tips for businesses in ${a(TO.businesses, "our guide for hotels, offices and restaurants")}.`),
      h2("PRESTİJ Ocean shower gel"),
      p(`With its fresh scent recalling clear water and light foam, ${a(TO.okyanus, "Ocean shower gel")} brings a cool moment to your shower routine. Available in a pump bottle and in 5 L and 20 L canisters, it suits homes and businesses alike. Browse every option in our ${a(TO.showerGel, "shower gel")} category, or try all four scents together with the ${a(TO.bundle, "Four-Scent Collection")}. For your business, you can request ${a(TO.samples, "free samples")}; ${SAMPLES_NOTE.en}.`),
    ),
    ar: html(
      p("روتين الاستحمام عادة شخصية: فمن الناس من لا يتخلّى عن بساطة قالب الصابون، ومنهم من يفضّل رغوة جل الاستحمام ورائحته. كلاهما يُستخدم لتنظيف الجسم، أما الفرق الحقيقي فينبع من شكلهما وطريقة استخدامهما ومدى عمليتهما في الحياة اليومية. نقارن في هذا المقال بين جل الاستحمام والصابون الصلب بإنصاف، ونقدّم نصائح عملية تساعدك على معرفة أيهما قد يناسبك."),
      h2("الفرق الأساسي: الشكل وطريقة الاستخدام"),
      p("الصابون الصلب قالب يُفرك مباشرةً على البشرة المبللة أو على الليفة حتى تتكوّن الرغوة. أما جل الاستحمام فسائل يوضع في راحة اليد أو على إسفنجة أو ليفة ثم يُفرك حتى تتكوّن الرغوة. وهذا الفرق الصغير يؤدي إلى نتائج مختلفة في جوانب كثيرة، مثل تحديد الكمية والحفظ والاستعمال المشترك والسفر."),
      h2("مقارنة جنبًا إلى جنب"),
      h3("الاستخدام وتحديد الكمية"),
      p("مع جل الاستحمام تأخذ الكمية التي تريدها بالضبط من زجاجة بمضخة أو عبوة بغطاء، وتزداد الرغوة بسرعة باستخدام الإسفنجة أو الليفة. أما مع الصابون الصلب فالتحكم في الكمية أصعب، لكن استخدامه بسيط للغاية: بلّل، وكوّن الرغوة، واشطف."),
      h3("الحفظ"),
      p("ينبغي أن يوضع قالب الصابون بعد الاستخدام في صحن يسمح بتصريف الماء؛ فإذا بقي على سطح مبلل لان وتفتّت. أما جل الاستحمام فيبقى مرتّبًا على رف الدش في زجاجة مغلقة أو بمضخة."),
      h3("الاستعمال المشترك"),
      p("في حمّامات العائلة أو الحمّامات المشتركة، يتيح جل الاستحمام في زجاجة بمضخة لكل شخص أن يأخذ حصته دون أن يلمس المنتج مباشرة. أما قالب الصابون فيستخدمه الجميع. ولهذا يجد كثيرون أن الزجاجة بالمضخة أكثر ترتيبًا في الأماكن المشتركة، وهذا أحد أسباب انتشار الموزّعات والزجاجات بالمضخة في دشات الفنادق والنوادي الرياضية."),
      h3("السفر"),
      p("لا يخضع الصابون الصلب لقيود السوائل ويشغل مساحة صغيرة، لكنك تحتاج إلى علبة لحمل القالب المبلل. أما جل الاستحمام فيمكنك أخذه في رحلتك بنقله إلى زجاجة صغيرة محكمة الإغلاق."),
      h3("الرائحة والإحساس"),
      p("في كلا المنتجين تتوقف الرائحة والإحساس الذي يتركه على البشرة على التركيبة. ومع جل الاستحمام تنتشر الرائحة في أرجاء الدش مع انتشار الرغوة، وهذا ما يحبه من يريد أن يجعل استحمامه طقسًا صغيرًا."),
      h2("أيهما يناسبك؟"),
      ul(
        `${b("اختر جل الاستحمام")} إن كنت تحب الاستحمام برغوة وفيرة ورائحة عطرة، أو إن كان أكثر من شخص يستخدم الحمّام، أو إن أردت زجاجة بمضخة يسهل أخذ الكمية منها.`,
        `${b("اختر الصابون الصلب")} إن كنت تريد روتينًا بسيطًا، وتسافر كثيرًا، وتستطيع إبقاء صحن الصابون جافًا.`,
        `${b("استخدم الاثنين")} إن وجدت أن جل الاستحمام في المنزل والصابون الصلب في السفر أكثر عملية لك.`,
      ),
      p("إن كانت بشرتك حساسة، فاقرأ قائمة المكوّنات أيًّا كان الشكل الذي تختاره، وتوقّف عن استخدام المنتج إذا لاحظت أي تهيّج."),
      h2("ما الذي تبحث عنه في جل الاستحمام؟"),
      ul(
        `${b("الملصق:")} تأكّد من أن المنتج مُعدّ لتنظيف الجسم، واقرأ طريقة الاستخدام والتحذيرات.`,
        `${b("الرائحة:")} قد تفضّل رائحة منعشة لاستحمام الصباح ورائحة أهدأ في المساء. ولأن الرائحة تنتشر في الدش مع الرغوة، فمن المهم أن تكون متوازنة.`,
        `${b("العبوة:")} الزجاجة بالمضخة عملية في المنزل. أما العائلات الكبيرة والمنشآت كثيرة الاستخدام، فإعادة تعبئة الزجاجة من عبوة كبيرة تعني تسوّقًا أقل.`,
        `${b("عدد المستخدمين:")} في منزل مزدحم أو نادٍ رياضي ينفد جل الاستحمام بسرعة، والزجاجة بالمضخة التي تُعاد تعبئتها من عبوة كبيرة تتيح لك التخطيط مسبقًا بدلًا من انتظار نفاد المخزون.`,
        `${b("مدة الاستخدام بعد الفتح:")} يبيّن رمز العلبة المفتوحة على الملصق عدد الأشهر التي ينبغي استخدام المنتج خلالها بعد فتحه.`,
      ),
      h2("كيف تستخدم جل الاستحمام؟"),
      ol(
        "بلّل بشرتك بماء فاتر.",
        "ضع جل الاستحمام في راحة يدك أو على إسفنجة أو ليفة.",
        "افركه حتى تتكوّن الرغوة، ثم وزّعه على جسمك برفق.",
        "اشطفه جيدًا بالماء.",
      ),
      p("استخدام الإسفنجة أو الليفة يزيد الرغوة، فتغطي كمية قليلة من المنتج مساحة واسعة. اشطف الليفة بعد كل استخدام واتركها لتجفّ."),
      h3("نصائح صغيرة لروتين الاستحمام"),
      ul(
        "يجد معظم الناس الماء الفاتر أكثر راحة، ولا حاجة إلى إطالة الاستحمام أكثر من اللازم.",
        "لا تتعجّل في الشطف، وتأكّد من زوال الرغوة تمامًا عن ظهرك وكتفيك.",
        "بعد الاستحمام، جفّف بشرتك بلطف بالضغط عليها بالمنشفة.",
        "احتفظ بجل الاستحمام والليفة على الرف لا على أرضية الدش المبللة، وأبقِ غطاء الزجاجة مغلقًا.",
        "هوِّ الحمّام بعد الاستحمام، فالحمّام الذي تزول رطوبته سريعًا يبدو أكثر ترتيبًا.",
      ),
      p(`جل الاستحمام للاستخدام الخارجي فقط. ${EYE_CAUTION.ar} أوقف الاستخدام في حال حدوث تهيّج. واحفظ المنتج بعيدًا عن متناول الأطفال في مكان بارد بعيد عن أشعة الشمس.`),
      p(`جل الاستحمام مُعدّ للجسم، وصابون اليدين السائل مُعدّ لليدين، فاستخدم كل منتج للغرض المذكور على ملصقه. وإن كنت تختار صابونًا للمغسلة، فاطّلع على ${a(TO.choosing, "دليلنا لاختيار صابون اليدين السائل")}.`),
      h2("في المنزل والفندق والنادي الرياضي"),
      p(`في المنزل، يحافظ وضع جل الاستحمام في زجاجة بمضخة على ترتيب رف الدش. أما في الفنادق ومراكز السبا والنوادي الرياضية، فالموزّعات الجدارية والزجاجات بالمضخة بديل عملي عن العبوات الصغيرة الفردية لكل ضيف، ويمكن إعادة تعبئة هذه الزجاجات من عبوات 5 لترات أو 20 لترًا. نشرح الطريقة في ${a(TO.refilling, "دليل إعادة تعبئة الموزّعات")}، وستجد مزيدًا من النصائح للمنشآت في ${a(TO.businesses, "دليلنا للفنادق والمكاتب والمطاعم")}.`),
      h2("جل الاستحمام «المحيط» من PRESTİJ"),
      p(`بفضل رائحته المنعشة التي تذكّر بصفاء الماء وخفّة الرغوة، يضيف ${a(TO.okyanus, "جل الاستحمام «المحيط»")} لحظة منعشة إلى روتين استحمامك. ويتوفر في زجاجة بمضخة وفي عبوات 5 لترات و20 لترًا، فيناسب المنازل والمنشآت على حد سواء. تصفّح جميع الخيارات في فئة ${a(TO.showerGel, "جل الاستحمام")}، أو جرّب الروائح الأربع معًا مع ${a(TO.bundle, "مجموعة الروائح الأربع")}. ويمكنك طلب ${a(TO.samples, "عيّنات مجانية")} لمنشأتك؛ ${SAMPLES_NOTE.ar}.`),
    ),
  },
};

// ---------------------------------------------------------------------------------------------------
// 3. Hangi alana hangi koku? (targets "sıvı sabun koku seçimi")

const SCENTS: SeedBlogPost = {
  slug: "koku-secimi-lavanta-portakal-okyanus",
  publishedAt: "2026-10-13T09:30:00+03:00",
  cover: "PRESTIJ_Koleksiyon_5L_yatay_koleksiyon",
  related: ["lavanta", "portakal", "okyanus"],
  tags: ["Koku", "Lavanta", "Portakal", "Okyanus"],
  title: {
    tr: "Hangi Alana Hangi Koku? Lavanta, Portakal ve Okyanus",
    en: "Which Scent for Which Space? Lavender, Orange and Ocean",
    ar: "أي رائحة لأي مكان؟ اللافندر والبرتقال والمحيط",
  },
  excerpt: {
    tr: "Sıvı sabunun kokusu, bir mekânın havasını sessizce belirler. Lavanta, Lavanta Latte, Portakal ve Okyanus kokularını tanıyın; banyo, mutfak, misafir lavabosu ve işletmeler için hangisinin uygun olduğunu keşfedin.",
    en: "The scent of a liquid soap quietly shapes the mood of a space. Get to know Lavender, Lavender Latte, Orange and Ocean, and discover which one suits the bathroom, the kitchen, the guest washroom and businesses.",
    ar: "رائحة الصابون السائل تصنع أجواء المكان بصمت. تعرّف إلى اللافندر ولاتيه اللافندر والبرتقال والمحيط، واكتشف أيها يناسب الحمّام والمطبخ ومغسلة الضيوف والمنشآت.",
  },
  seo: {
    title: {
      tr: "Sıvı Sabunda Koku Seçimi: Hangi Alana Hangi Koku?",
      en: "Choosing a Soap Scent: Which Scent for Which Space?",
      ar: "اختيار رائحة الصابون السائل: أي رائحة لأي مكان؟",
    },
    description: {
      tr: "Lavanta, Lavanta Latte, Portakal ve Okyanus: sıvı sabun ve duş jelinde koku seçimi. Banyo, mutfak, misafir lavabosu ve işletmeler için öneriler.",
      en: "Lavender, Lavender Latte, Orange and Ocean: how to choose a soap scent, with ideas for the bathroom, kitchen, guest washroom and businesses.",
      ar: "اللافندر ولاتيه اللافندر والبرتقال والمحيط: كيف تختار رائحة الصابون السائل وجل الاستحمام للحمّام والمطبخ ومغسلة الضيوف والمنشآت.",
    },
  },
  body: {
    tr: html(
      p("Bir mekâna girdiğimizde ilk fark ettiğimiz şeylerden biri kokusudur. Lavabonun başında kullandığımız sıvı sabun da bu kokunun küçük ama sürekli bir parçasıdır. Doğru koku banyoyu daha sakin, mutfağı daha canlı, misafir lavabosunu daha davetkâr hissettirebilir. Bu rehberde PRESTİJ'in dört kokusunu tanıtıyor, hangi alana hangisinin yakıştığına dair öneriler paylaşıyoruz."),
      h2("Dört koku, dört karakter"),
      h3("Lavanta: klasik ve dingin"),
      p(`${a(TO.lavanta, "Lavanta sıvı el sabunu")}, adını aldığı çiçeğin tanıdık kokusunu ametist tonları ve altın detaylarla yorumlar. Klasik, köklü ve güven veren bir karakteri vardır. Herkesin tanıdığı bir koku olduğu için ortak kullanılan alanlarda kolayca benimsenir.`),
      h3("Lavanta Latte: yumuşak ve sıcak"),
      p(`${a(TO.lavantaLatte, "Lavanta Latte")}, lavanta dallarının sakinliğini sıcak fildişi tonlarıyla buluşturur. Lavantanın daha yumuşak, kremsi bir yorumu olarak sakin ve zamansız bir atmosfer isteyen mekânlara yakışır.`),
      h3("Portakal: canlı ve aydınlık"),
      p(`${a(TO.portakal, "Portakal")}, narenciyenin canlı enerjisini amber yansımalar ve gün ışığının sıcaklığıyla buluşturur. Enerjik ve davetkâr bir kokudur; güne aydınlık bir başlangıç yapmayı sevenlerin favorisi olabilir.`),
      h3("Okyanus: serin ve ferah"),
      p(`${a(TO.okyanus, "Okyanus")}, suyun berraklığını ve köpüğün hafifliğini anımsatan serin bir kokudur. PRESTİJ koleksiyonunun duş jelidir; duşu, denizin ferahlığını hatırlatan sakin bir ana dönüştürür.`),
      h2("Alan alan koku önerileri"),
      h3("Ev banyosu"),
      p("Günün başında ve sonunda kullandığınız banyo için yormayan, sakin bir koku iyi bir seçimdir. Lavanta Latte ya da Lavanta bu alanda sade bir dinginlik sunar. Lavabo ve duş için birbirini tamamlayan kokular seçmek banyoda bütünlük sağlar; örneğin lavaboda Lavanta Latte, duşta Okyanus."),
      h3("Mutfak"),
      p("Mutfakta yemek kokularıyla çatışmayan, canlı ve temiz hissettiren bir koku arayın. Portakal'ın narenciye karakteri aydınlık mutfaklarla iyi uyum sağlar. Sabunu eviyenin yanında, bulaşık deterjanından ayrı bir pompalı şişede tutmak da düzeni kolaylaştırır."),
      h3("Misafir lavabosu"),
      p("Misafir lavabosu evin küçük bir vitrinidir. Davetkâr bir izlenim için Portakal, zarif ve sakin bir karşılama için Lavanta Latte iyi birer seçenektir. Şişenin kendisinin de dekorun bir parçası olduğunu unutmayın."),
      h3("Duş"),
      p("Duşta koku, sıcak su ve köpükle birlikte bütün alana yayılır. Okyanus duş jelinin serin ve ferah karakteri, özellikle sabah duşlarında güne canlı bir başlangıç yapmak isteyenlere uygundur."),
      h2("İşletmeler için koku seçimi"),
      ul(
        `${b("Oteller ve spa merkezleri:")} Oda banyolarında Lavanta Latte'nin sakinliği, duşlarda Okyanus'un ferahlığı. Odada ve lobide aynı kokuyu kullanmak otelinize tanınabilir bir imza kazandırır.`,
        `${b("Ofisler:")} Herkesin kolayca alışacağı klasik bir koku olarak Lavanta.`,
        `${b("Restoranlar ve kafeler:")} Misafir lavabosunda Portakal'ın canlı narenciye kokusu.`,
        `${b("Spor salonları:")} Duşlarda Okyanus duş jeli, lavabolarda Portakal ya da Lavanta.`,
      ),
      h3("Bir koku imzası oluşturun"),
      p("Misafirlerin bir mekânı hatırlamasında koku önemli bir rol oynar. İşletmeniz için bir koku seçtiyseniz onu odalarda, lobide, tuvaletlerde ve personel alanlarında tutarlı biçimde kullanın; kat hizmetleri ve temizlik ekibinin dolum talimatlarına hangi noktaya hangi kokunun konacağını yazın. PRESTİJ'in pompalı şişeleri ile 5 L ve 20 L bidonları aynı formülü ve aynı kokuyu taşıdığı için şişeyle de dispenserle de aynı deneyimi sunarsınız."),
      h3("Kokuyu güne göre seçin"),
      p("Bazı alanlar günün belirli saatlerinde yoğun kullanılır. Sabah hareketli geçen bir ofis mutfağında ya da kahvaltı salonunda Portakal'ın canlılığı, akşamları dinlenmeye ayrılan bir banyoda ya da spa alanında Lavanta Latte'nin sakinliği iyi bir eşleşmedir."),
      h2("Koku seçerken dikkat edilecekler"),
      ul(
        `${b("Alanın büyüklüğü:")} Küçük ve penceresiz bir lavaboda koku daha belirgin hissedilir; geniş alanlarda daha hafif kalır.`,
        `${b("Kokuları karıştırmayın:")} Aynı lavaboda farklı kokulu ürünleri yan yana kullanmak, kokuların birbirini bastırmasına yol açar. Her alan için tek bir koku seçin.`,
        `${b("Tutarlılık:")} İşletmede her noktada aynı kokuyu kullanmak bütünlük hissi yaratır; evde ise her odaya farklı bir karakter vermek keyifli olabilir.`,
        `${b("Kişisel tercih:")} Koku algısı kişiden kişiye değişir. Ortak alanlarda kimseyi rahatsız etmeyecek, dengeli kokuları tercih edin.`,
        `${b("Mevsim:")} Bazıları yazın ferah, kışın sıcak kokuları sever; kokunuzu mevsime göre değiştirebilirsiniz.`,
      ),
      h2("Kokuyu nasıl denemeli?"),
      p(`Bir kokuyu şişeden koklamakla ellerinizde denemek farklıdır. Sabunu ıslak ellerinizde köpürtün, durulayın ve kuruladıktan sonra birkaç dakika bekleyin; kokunun ellerinizde nasıl kaldığını ve lavabonun bulunduğu alanda nasıl hissedildiğini gözlemleyin. Birden fazla kokuyu deneyecekseniz aralarda birkaç dakika ara verin; burun kısa sürede kokuya alışır ve ardından gelen kokuyu olduğundan daha hafif algılayabilir. Kararı mümkünse sabunu kullanacağınız mekânda verin. Denerken dikkat: ${EYE_CAUTION.tr}`),
      h2("Karar vermeden önce deneyin"),
      p(`Kokunuzu kâğıt üzerinde değil, lavabonun başında seçin. Dört kokuyu birlikte denemek isterseniz ${a(TO.bundle, "Dört Koku Koleksiyonu")}, Lavanta Latte, Lavanta, Portakal ve Okyanus'u 5 L bidonlarda bir araya getirir; aynı zamanda özenli bir hediyedir. Seti ${a(TO.giftSets, "sabun hediye setleri")} sayfamızda da bulabilirsiniz. Kendiniz için alışveriş yapıyorsanız sepetinize ücretsiz numune ekleyebilir, işletmeniz için ${a(TO.samples, "ücretsiz numune")} isteyebilirsiniz; ${SAMPLES_NOTE.tr}. İşletmenizin düzenli alımları için ${a(TO.business, "kurumsal teklif")} isteyin.`),
      p(`Kokunuzu seçtikten sonra doğru ambalajı belirlemek için ${a(TO.choosing, "sıvı el sabunu seçme rehberimize")} göz atabilirsiniz.`),
    ),
    en: html(
      p("One of the first things we notice when we walk into a space is its scent. The liquid soap we use at the basin is a small but constant part of that scent. The right scent can make a bathroom feel calmer, a kitchen livelier and a guest washroom more inviting. In this guide we introduce PRESTİJ's four scents and share ideas on which one suits which space."),
      h2("Four scents, four characters"),
      h3("Lavender: classic and serene"),
      p(`${a(TO.lavanta, "Lavender liquid hand soap")} interprets the familiar scent of its namesake flower with amethyst hues and golden details. Its character is classic, rooted and reassuring. Because it is a scent everyone knows, it is easily welcomed in shared spaces.`),
      h3("Lavender Latte: soft and warm"),
      p(`${a(TO.lavantaLatte, "Lavender Latte")} brings together the calm of lavender sprigs and warm ivory tones. A softer, creamier interpretation of lavender, it suits spaces that call for a calm, timeless atmosphere.`),
      h3("Orange: lively and bright"),
      p(`${a(TO.portakal, "Orange")} pairs the lively energy of citrus with amber reflections and the warmth of daylight. It is an energetic, inviting scent and may well become the favourite of anyone who likes a bright start to the day.`),
      h3("Ocean: cool and fresh"),
      p(`${a(TO.okyanus, "Ocean")} is a cool scent recalling the clarity of water and the lightness of foam. It is the shower gel of the PRESTİJ collection and turns your shower into a calm moment that recalls the freshness of the sea.`),
      h2("Scent ideas, space by space"),
      h3("Family bathroom"),
      p("For the bathroom you use at the start and end of each day, a calm scent that never feels tiring is a good choice. Lavender Latte or Lavender brings a simple serenity here. Choosing scents that complement each other at the basin and in the shower gives the bathroom a sense of harmony: Lavender Latte at the basin and Ocean in the shower, for example."),
      h3("Kitchen"),
      p("In the kitchen, look for a lively scent that feels clean and doesn't clash with cooking smells. Orange's citrus character goes well with bright kitchens. Keeping the soap in a pump bottle by the sink, separate from the washing-up liquid, also keeps things tidy."),
      h3("Guest washroom"),
      p("The guest washroom is a small showcase of your home. Orange is a good choice for an inviting impression, and Lavender Latte for an elegant, calm welcome. Remember that the bottle itself is part of the décor."),
      h3("Shower"),
      p("In the shower, scent spreads through the whole space with the warm water and lather. The cool, fresh character of Ocean shower gel suits anyone who wants a lively start to the day, especially in the morning."),
      h2("Choosing a scent for businesses"),
      ul(
        `${b("Hotels and spas:")} the calm of Lavender Latte in guest bathrooms and the freshness of Ocean in the showers. Using the same scent in the room and the lobby gives your hotel a recognisable signature.`,
        `${b("Offices:")} Lavender, a classic scent everyone gets used to easily.`,
        `${b("Restaurants and cafés:")} the lively citrus scent of Orange in the guest washroom.`,
        `${b("Gyms:")} Ocean shower gel in the showers, Orange or Lavender at the basins.`,
      ),
      h3("Create a scent signature"),
      p("Scent plays an important part in how guests remember a place. Once you have chosen a scent for your business, use it consistently in the rooms, the lobby, the restrooms and staff areas, and write down in the housekeeping and cleaning team's refilling instructions which scent goes where. Because PRESTİJ's pump bottles and 5 L and 20 L canisters carry the same formula and the same scent, you offer the same experience from a bottle or a dispenser."),
      h3("Match the scent to the time of day"),
      p("Some spaces are busiest at particular times of day. The liveliness of Orange in an office kitchen or breakfast room that is busy in the morning, and the calm of Lavender Latte in a bathroom or spa area reserved for unwinding in the evening, make good pairings."),
      h2("What to keep in mind when choosing a scent"),
      ul(
        `${b("The size of the space:")} in a small washroom without a window, scent feels more noticeable; in large spaces it stays lighter.`,
        `${b("Don't mix scents:")} using differently scented products side by side at the same basin makes the scents compete. Choose a single scent for each space.`,
        `${b("Consistency:")} in a business, using the same scent at every point creates a sense of unity; at home, giving each room a different character can be a pleasure.`,
        `${b("Personal preference:")} scent perception varies from person to person. In shared spaces, choose balanced scents that won't bother anyone.`,
        `${b("The season:")} some people like fresh scents in summer and warm ones in winter; you can change your scent with the seasons.`,
      ),
      h2("How to test a scent"),
      p(`Smelling a scent from the bottle is different from trying it on your hands. Lather the soap on wet hands, rinse, dry and wait a few minutes; notice how the scent stays on your hands and how it feels in the space around the basin. If you are testing more than one scent, leave a few minutes between them: the nose quickly gets used to a scent and may find the next one fainter than it is. If you can, make the decision in the space where the soap will be used. While testing, remember: ${EYE_CAUTION.en}`),
      h2("Try before you decide"),
      p(`Choose your scent at the basin, not on paper. If you want to try all four scents together, the ${a(TO.bundle, "Four-Scent Collection")} brings Lavender Latte, Lavender, Orange and Ocean together in 5 L canisters, and it makes a thoughtful gift too. You will also find it on our ${a(TO.giftSets, "soap gift sets")} page. If you are shopping for yourself you can add a free sample to your cart, and for your business you can request ${a(TO.samples, "free samples")}; ${SAMPLES_NOTE.en}. For your business's regular purchases, ask for a ${a(TO.business, "business quote")}.`),
      p(`Once you have chosen your scent, see our ${a(TO.choosing, "guide to choosing liquid hand soap")} to pick the right packaging too.`),
    ),
    ar: html(
      p("من أول ما نلاحظه عند دخول أي مكان رائحته. والصابون السائل الذي نستخدمه عند المغسلة جزء صغير لكنه دائم من تلك الرائحة. فالرائحة المناسبة قد تجعل الحمّام أكثر هدوءًا، والمطبخ أكثر حيوية، ومغسلة الضيوف أكثر ترحيبًا. نعرّفك في هذا الدليل إلى روائح PRESTİJ الأربع، ونشاركك أفكارًا حول أي منها يناسب أي مكان."),
      h2("أربع روائح، أربع شخصيات"),
      h3("اللافندر: كلاسيكي وهادئ"),
      p(`يعيد ${a(TO.lavanta, "صابون اليدين السائل اللافندر")} تفسير الرائحة المألوفة للزهرة التي يحمل اسمها، بدرجات الجمشت وتفاصيل ذهبية. طابعه كلاسيكي وأصيل يبعث على الطمأنينة. ولأنها رائحة يعرفها الجميع، فإنها تلقى قبولًا سهلًا في الأماكن المشتركة.`),
      h3("لاتيه اللافندر: ناعم ودافئ"),
      p(`يجمع ${a(TO.lavantaLatte, "لاتيه اللافندر")} بين سكينة أغصان اللافندر ودفء درجات العاج. وبما أنه تفسير أنعم للافندر بطابع كريمي، فإنه يناسب الأماكن التي تحتاج إلى أجواء هادئة وخالدة.`),
      h3("البرتقال: حيوي ومشرق"),
      p(`يجمع ${a(TO.portakal, "البرتقال")} بين طاقة الحمضيات النابضة وانعكاسات الكهرمان ودفء ضوء النهار. إنها رائحة مفعمة بالحيوية ومرحّبة، وقد تصبح المفضّلة لدى كل من يحب بداية يوم مشرقة.`),
      h3("المحيط: منعش ونقي"),
      p(`${a(TO.okyanus, "المحيط")} رائحة منعشة ونقية تذكّر بصفاء الماء وخفّة الرغوة. وهو جل الاستحمام في مجموعة PRESTİJ، ويحوّل استحمامك إلى لحظة هادئة تذكّر بانتعاش البحر.`),
      h2("أفكار للروائح بحسب المكان"),
      h3("حمّام المنزل"),
      p("للحمّام الذي تستخدمه في بداية يومك ونهايته، تُعدّ الرائحة الهادئة التي لا تُتعب خيارًا جيدًا. ويضفي لاتيه اللافندر أو اللافندر هنا سكينة بسيطة. واختيار روائح يكمّل بعضها بعضًا عند المغسلة وفي الدش يمنح الحمّام انسجامًا؛ كأن تضع لاتيه اللافندر عند المغسلة والمحيط في الدش."),
      h3("المطبخ"),
      p("في المطبخ، ابحث عن رائحة حيوية تمنح إحساسًا بالنظافة ولا تتعارض مع روائح الطهي. ويتناغم الطابع الحمضي للبرتقال مع المطابخ المضيئة. كما أن وضع الصابون في زجاجة بمضخة بجانب الحوض، منفصلة عن سائل غسل الأطباق، يحافظ على الترتيب."),
      h3("مغسلة الضيوف"),
      p("مغسلة الضيوف واجهة صغيرة لمنزلك. البرتقال خيار جيد لانطباع مرحّب، ولاتيه اللافندر لاستقبال أنيق وهادئ. ولا تنسَ أن الزجاجة نفسها جزء من الديكور."),
      h3("الدش"),
      p("في الدش تنتشر الرائحة في المكان كله مع الماء الدافئ والرغوة. ويناسب الطابع المنعش لجل الاستحمام «المحيط» كل من يريد بداية يوم حيوية، خاصةً في الصباح."),
      h2("اختيار الرائحة للمنشآت"),
      ul(
        `${b("الفنادق ومراكز السبا:")} سكينة لاتيه اللافندر في حمّامات الغرف، وانتعاش المحيط في الدشات. واستخدام الرائحة نفسها في الغرفة والردهة يمنح فندقك بصمة مميّزة يسهل تذكّرها.`,
        `${b("المكاتب:")} اللافندر، رائحة كلاسيكية يألفها الجميع بسهولة.`,
        `${b("المطاعم والمقاهي:")} رائحة البرتقال الحمضية الحيوية في مغسلة الضيوف.`,
        `${b("النوادي الرياضية:")} جل الاستحمام «المحيط» في الدشات، والبرتقال أو اللافندر عند المغاسل.`,
      ),
      h3("اصنع بصمة عطرية لمنشأتك"),
      p("تؤدي الرائحة دورًا مهمًا في تذكّر الضيوف للمكان. فإذا اخترت رائحة لمنشأتك، فاستخدمها بثبات في الغرف والردهة ودورات المياه ومناطق الموظفين، ودوّن في تعليمات التعبئة لفريق خدمة الغرف والتنظيف أي رائحة توضع في أي نقطة. ولأن زجاجات PRESTİJ بالمضخة وعبواتها سعة 5 لترات و20 لترًا تحمل التركيبة نفسها والرائحة نفسها، فإنك تقدّم التجربة ذاتها سواء من الزجاجة أو من الموزّع."),
      h3("اختر الرائحة بحسب وقت اليوم"),
      p("بعض الأماكن تزدحم في أوقات معيّنة من اليوم. فحيوية البرتقال في مطبخ مكتب أو قاعة إفطار تنشط صباحًا، وسكينة لاتيه اللافندر في حمّام أو منطقة سبا مخصّصة للاسترخاء مساءً، ثنائيان موفّقان."),
      h2("ما الذي ينبغي مراعاته عند اختيار الرائحة؟"),
      ul(
        `${b("مساحة المكان:")} في مغسلة صغيرة بلا نافذة تبدو الرائحة أوضح، أما في الأماكن الواسعة فتبقى أخفّ.`,
        `${b("لا تخلط الروائح:")} استخدام منتجات بروائح مختلفة جنبًا إلى جنب عند المغسلة نفسها يجعل الروائح تتنافس. اختر رائحة واحدة لكل مكان.`,
        `${b("الثبات:")} في المنشآت، يخلق استخدام الرائحة نفسها في كل النقاط إحساسًا بالتكامل؛ أما في المنزل، فقد يكون منح كل غرفة طابعًا مختلفًا أمرًا ممتعًا.`,
        `${b("التفضيل الشخصي:")} يختلف إدراك الروائح من شخص إلى آخر. في الأماكن المشتركة، اختر روائح متوازنة لا تزعج أحدًا.`,
        `${b("الموسم:")} يحب بعض الناس الروائح المنعشة صيفًا والدافئة شتاءً، ويمكنك تغيير رائحتك بحسب الموسم.`,
      ),
      h2("كيف تجرّب الرائحة؟"),
      p(`شمّ الرائحة من الزجاجة يختلف عن تجربتها على يديك. كوّن رغوة الصابون على يديك المبللتين، ثم اشطفهما وجفّفهما وانتظر بضع دقائق، ولاحظ كيف تبقى الرائحة على يديك وكيف تبدو في المكان المحيط بالمغسلة. وإن كنت ستجرّب أكثر من رائحة، فاترك بضع دقائق بين كل تجربة وأخرى؛ فالأنف يعتاد الرائحة سريعًا وقد يجد الرائحة التالية أخفّ مما هي عليه. واتخذ قرارك إن أمكن في المكان الذي سيُستخدم فيه الصابون. وأثناء التجربة تذكّر: ${EYE_CAUTION.ar}`),
      h2("جرّب قبل أن تقرّر"),
      p(`اختر رائحتك عند المغسلة لا على الورق. وإن أردت تجربة الروائح الأربع معًا، فإن ${a(TO.bundle, "مجموعة الروائح الأربع")} تجمع لاتيه اللافندر واللافندر والبرتقال والمحيط في عبوات 5 لترات، وهي أيضًا هدية مختارة بعناية. وستجدها أيضًا في صفحة ${a(TO.giftSets, "أطقم هدايا الصابون")}. وإن كنت تتسوّق لنفسك فيمكنك إضافة عيّنة مجانية إلى سلّتك، ولمنشأتك يمكنك طلب ${a(TO.samples, "عيّنات مجانية")}؛ ${SAMPLES_NOTE.ar}. وللمشتريات المنتظمة لمنشأتك، اطلب ${a(TO.business, "عرض سعر للشركات")}.`),
      p(`وبعد أن تختار رائحتك، اطّلع على ${a(TO.choosing, "دليلنا لاختيار صابون اليدين السائل")} لتختار العبوة المناسبة أيضًا.`),
    ),
  },
};

// ---------------------------------------------------------------------------------------------------
// 4. Dispenser ve pompalı şişe nasıl doldurulur? (targets "sıvı sabun dispenseri doldurma")

const REFILLING: SeedBlogPost = {
  slug: "sivi-sabun-dispenseri-nasil-doldurulur",
  publishedAt: "2026-10-20T09:30:00+03:00",
  cover: "PRESTIJ_Lavanta_5L_sabunluga_dolum_son",
  related: ["lavanta", "lavanta-latte", "okyanus"],
  tags: ["Dispenser", "Dolum", "Sıvı sabun"],
  title: {
    tr: "Sıvı Sabun Dispenseri ve Pompalı Şişe Nasıl Doldurulur?",
    en: "How to Refill a Liquid Soap Dispenser or Pump Bottle",
    ar: "كيف تعيد تعبئة موزّع الصابون السائل أو الزجاجة بالمضخة؟",
  },
  excerpt: {
    tr: "Dispenseri ya da pompalı şişeyi doldurmak birkaç dakikalık bir iş; doğru yapıldığında sabun hep aynı kıvamda akar ve lavabo düzenli kalır. Temizlemekten kurutmaya, adım adım dolum rehberi.",
    en: "Refilling a dispenser or pump bottle takes only a few minutes; done right, the soap always flows with the same consistency and the basin stays tidy. A step-by-step refilling guide, from cleaning to drying.",
    ar: "إعادة تعبئة الموزّع أو الزجاجة بالمضخة لا تستغرق سوى دقائق؛ وعندما تتم بالطريقة الصحيحة يتدفق الصابون بالقوام نفسه دائمًا وتبقى المغسلة مرتّبة. دليل التعبئة خطوة بخطوة، من التنظيف إلى التجفيف.",
  },
  seo: {
    title: {
      tr: "Sıvı Sabun Dispenseri Nasıl Doldurulur? Adım Adım",
      en: "How to Refill a Liquid Soap Dispenser, Step by Step",
      ar: "كيف تعيد تعبئة موزّع الصابون السائل؟ خطوة بخطوة",
    },
    description: {
      tr: "Sıvı sabun dispenseri ve pompalı şişe nasıl doldurulur? Boşaltma, yıkama, kurutma ve dolum adımları ile üstüne ekleme yapmamanın nedeni.",
      en: "How do you refill a liquid soap dispenser or pump bottle? Emptying, washing, drying and refilling step by step, and why you should never top up.",
      ar: "كيف تعيد تعبئة موزّع الصابون السائل أو الزجاجة بالمضخة؟ خطوات التفريغ والغسل والتجفيف والتعبئة، ولماذا لا تضيف الصابون فوق القديم.",
    },
  },
  body: {
    tr: html(
      p("5 L ya da 20 L bidonla sıvı sabun almanın büyük bir kolaylığı, pompalı şişelerinizi ve dispenserlerinizi istediğiniz zaman yeniden doldurabilmenizdir. Ancak dolum, bidondaki sabunu şişeye boşaltmaktan ibaret değildir. Bu rehberde dolumu temiz, düzenli ve sorunsuz hâle getiren adımları ve evde de işletmelerde de dikkat edilmesi gerekenleri anlattık."),
      h2("Altın kural: Üstüne ekleme yapmayın"),
      p("Sık yapılan bir hata, şişede biraz sabun kalmışken üstüne yenisini eklemektir. Böyle yapınca şişenin dibinde ve pompanın içinde biriken eski ürün yeni sabunla karışır; zamanla kıvam, renk ve koku tutarlılığını kaybedebilir, pompa da tıkanabilir. Bu yüzden bir dispenseri ya da pompalı şişeyi her zaman tamamen boşaldığında, temizleyip kuruttuktan sonra doldurun."),
      h2("Neye ihtiyacınız var?"),
      ul(
        "doldurmak istediğiniz sabun (5 L ya da 20 L bidon),",
        "temiz ve kuru bir huni,",
        "ılık su,",
        "temiz, tüy bırakmayan bir bez,",
        "varsa dispenserinizin kullanım kılavuzu.",
      ),
      h2("Adım adım dolum"),
      ol(
        `${b("Tamamen boşaltın.")} Şişe ya da dispenser boşalana kadar kullanın; kalan az miktarı lavaboya boşaltın.`,
        `${b("Pompayı ve hazneyi ayırın.")} Pompalı şişede pompayı çevirerek çıkarın. Duvar tipi dispenserlerde hazneyi ya da kartuşu üreticinin talimatına göre sökün.`,
        `${b("Ilık suyla yıkayın.")} Hazneyi ılık suyla birkaç kez çalkalayın. Pompanın ucunu ılık su dolu bir kaba daldırın ve içinden temiz su gelene kadar birkaç kez pompalayın.`,
        `${b("Tamamen kurutun.")} Hazneyi ve pompayı ağzı aşağı bakacak şekilde kurumaya bırakın. İçeride kalan su sabunu seyreltir; bu adımı aceleye getirmeyin. Dilerseniz yedek bir şişeyle dönüşümlü çalışabilirsiniz: Biri kururken diğeri kullanımda olur.`,
        `${b("Huniyle doldurun.")} Huniyi şişenin ağzına yerleştirin ve sabunu yavaşça dökün. 20 L bidondan doğrudan dökmek zor olabilir; dolu bir 20 L bidon 20 kilogramın üzerindedir. Önce temiz ve kuru bir ara kaba alıp oradan doldurmak işinizi kolaylaştırır.`,
        `${b("Ağız payı bırakın.")} Şişeyi ağzına kadar doldurmayın; pompayı taktığınızda taşmaması için bir parmak boşluk bırakın.`,
        `${b("Pompayı takın ve çalıştırın.")} Pompayı sıkıca kapatın ve sabun gelene kadar birkaç kez basın. Şişenin dışını nemli bir bezle silin.`,
        `${b("Bidonu kapatın.")} Bidonun kapağını hemen sıkıca kapatın ve serin, güneş almayan bir yere kaldırın.`,
      ),
      h2("Sabunu suyla inceltmeyin"),
      p("Bidondan alınan sabunu “daha uzun gitsin” diye suyla inceltmek cazip görünebilir. Ancak sıvı el sabunu, ambalajındaki hâliyle kullanılmak üzere hazırlanır. Su eklemek kıvamını ve köpürmesini değiştirir, pompadan akışını bozar. Etiketteki kullanım talimatına uyun: Yeterli miktarda ürün ıslak ele alınır, ovalayarak köpürtülür ve su ile durulanır."),
      p("Not: Köpük dispenserleri, kendileri için hazırlanmış köpük sabunlarla çalışır. Bu rehberdeki adımlar sıvı sabun dispenserleri ve pompalı şişeler içindir."),
      h2("Sık karşılaşılan sorunlar"),
      ul(
        `${b("Pompa sabun çekmiyor:")} Pompaya arka arkaya birkaç kez basın ve borunun şişenin dibine ulaştığından emin olun. Pompanın ucunda kurumuş sabun varsa ucu ılık suya daldırıp pompalayarak açın.`,
        `${b("Pompa damlatıyor ya da sızdırıyor:")} Kapağın sıkıca kapandığını ve contanın yerinde olduğunu kontrol edin; şişenin ağzına kadar doldurulmadığından emin olun.`,
        `${b("Sabun her zamankinden sulu akıyor:")} Hazne tam kurumadan doldurulmuş ya da sabuna su karışmış olabilir. Şişeyi boşaltın, yıkayıp tamamen kurutun ve yeniden doldurun.`,
        `${b("Şişede hava kabarcıkları var:")} Dolumu yavaş yapın; kabarcıklar kısa sürede kendiliğinden kaybolur.`,
      ),
      h2("Hangi şişe ve dispenserler doldurulabilir?"),
      p("Cam ya da sağlam plastikten yapılmış, vidalı pompalı şişeler defalarca doldurulabilir. Şeffaf bir şişe, sabunun ne zaman biteceğini görmenizi kolaylaştırır. Pompanın vidalı başlığı ve contası sağlam olmalıdır; aşınmış ya da çatlamış bir pompayı yenisiyle değiştirin. Tek kullanımlık kartuşla çalışan bazı duvar dispenserleri bidondan doldurulmak üzere tasarlanmamıştır; yeni dispenser alırken doldurulabilir hazneli modelleri tercih edin."),
      h2("Ne sıklıkla temizlemeli?"),
      p("Pratik bir kural: her dolumda temizleyin. Hazneyi her seferinde yıkayıp kuruttuğunuzda ayrı bir temizlik takvimine gerek kalmaz. Pompanın ucunda kuruyan sabunu ise haftalık lavabo temizliği sırasında nemli bir bezle silebilirsiniz. Evde mutfak ve banyo için ayrı şişeler kullanıyorsanız, dolumlarını aynı güne denk getirmek bu işi kolay bir rutine dönüştürür."),
      h2("İşletmeler için dolum düzeni"),
      p("Otel, ofis ya da restoran gibi çok sayıda lavabonun bulunduğu yerlerde dolum bir rutine bağlanmalıdır:"),
      ul(
        "Dolumdan sorumlu kişiyi ya da ekibi belirleyin.",
        "Her dispenseri hangi kokuyla doldurduğunuzu not edin; aynı noktada hep aynı koku olsun.",
        "Yedek şişe ya da hazne bulundurun; böylece biri kururken lavabo boş kalmaz.",
        "Bidonların açılış tarihini üzerine yazın ve önce açılanı önce kullanın. PRESTİJ ürünlerinin açıldıktan sonraki kullanım süresi 12 aydır.",
        "Bidonları ısı ve direkt güneş ışığından uzakta, çocukların ulaşamayacağı bir yerde saklayın.",
      ),
      p(`Hangi bidonun işletmenize uygun olduğunu ${a(TO.canisters, "5 L ve 20 L bidon rehberimizde")} anlattık.`),
      h2("Güvenlik notu"),
      p(`Dolum sırasında sabunun göze kaçmamasına dikkat edin. ${EYE_CAUTION.tr} Dökülen sabun zemini kaygan hâle getirir; damlaları hemen silin.`),
      p(`Dolum için ${a(TO.lavanta, "Lavanta")}, ${a(TO.lavantaLatte, "Lavanta Latte")} ve ${a(TO.portakal, "Portakal")} sıvı el sabunlarımızı ve ${a(TO.okyanus, "Okyanus duş jelimizi")} 5 L ve 20 L bidon seçenekleriyle inceleyebilir, tüm seçenekleri ${a(TO.handSoap, "sıvı el sabunu")} ve ${a(TO.showerGel, "duş jeli")} kategorilerinde görebilirsiniz. İşletmeniz için düzenli alım planlıyorsanız ${a(TO.business, "kurumsal teklif")} isteyin.`),
    ),
    en: html(
      p("A big convenience of buying liquid soap in 5 L or 20 L canisters is that you can refill your pump bottles and dispensers whenever you like. But refilling is more than pouring soap from the canister into the bottle. In this guide we explain the steps that make refilling clean, tidy and trouble-free, and what to keep in mind at home and in businesses."),
      h2("The golden rule: never top up"),
      p("A common mistake is adding new soap on top while some is still left in the bottle. When you do this, the old product that has collected at the bottom of the bottle and inside the pump mixes with the new soap; over time the consistency, colour and scent can become uneven, and the pump may clog. So always refill a dispenser or pump bottle only when it is completely empty, after cleaning and drying it."),
      h2("What you will need"),
      ul(
        "the soap you want to refill with (5 L or 20 L canister),",
        "a clean, dry funnel,",
        "lukewarm water,",
        "a clean, lint-free cloth,",
        "your dispenser's instructions, if you have them.",
      ),
      h2("Step-by-step refilling"),
      ol(
        `${b("Empty it completely.")} Use the bottle or dispenser until it is empty; pour any small remainder into the basin.`,
        `${b("Take off the pump and reservoir.")} On a pump bottle, unscrew the pump. On wall dispensers, remove the reservoir or cartridge as the manufacturer instructs.`,
        `${b("Wash with lukewarm water.")} Rinse the reservoir several times with lukewarm water. Dip the end of the pump in a container of lukewarm water and pump it a few times until clean water comes out.`,
        `${b("Dry it completely.")} Leave the reservoir and pump to dry upside down. Water left inside dilutes the soap, so don't rush this step. You can also work with a spare bottle: one dries while the other is in use.`,
        `${b("Fill with a funnel.")} Place the funnel in the neck of the bottle and pour the soap slowly. Pouring directly from a 20 L canister can be difficult, as a full 20 L canister weighs more than 20 kilograms; it is easier to fill a clean, dry intermediate container first and pour from there.`,
        `${b("Leave some room.")} Don't fill the bottle to the brim; leave a finger's width of space so it doesn't overflow when you put the pump back.`,
        `${b("Refit and prime the pump.")} Screw the pump on tightly and press it a few times until soap comes out. Wipe the outside of the bottle with a damp cloth.`,
        `${b("Close the canister.")} Close the canister cap tightly straight away and put it back in a cool place out of the sun.`,
      ),
      h2("Don't dilute the soap with water"),
      p("It may be tempting to dilute soap from a canister with water “so it lasts longer”. But liquid hand soap is made to be used as it comes in its packaging. Adding water changes its consistency and lather and disrupts the flow from the pump. Follow the directions on the label: apply a sufficient amount to wet hands, lather by rubbing and rinse with water."),
      p("Note: foam dispensers work with foaming soaps made for them. The steps in this guide are for liquid soap dispensers and pump bottles."),
      h2("Common problems"),
      ul(
        `${b("The pump doesn't draw up soap:")} press the pump several times in a row and make sure the tube reaches the bottom of the bottle. If there is dried soap at the tip, dip it in lukewarm water and pump until it clears.`,
        `${b("The pump drips or leaks:")} check that the cap is screwed on tightly and the seal is in place, and that the bottle isn't filled to the brim.`,
        `${b("The soap is runnier than usual:")} the reservoir may have been refilled before it was fully dry, or water may have got into the soap. Empty the bottle, wash and dry it completely, then refill it.`,
        `${b("There are air bubbles in the bottle:")} pour slowly; the bubbles disappear on their own after a short while.`,
      ),
      h2("Which bottles and dispensers can be refilled?"),
      p("Pump bottles made of glass or sturdy plastic with a screw-on pump can be refilled again and again. A clear bottle makes it easier to see when the soap is about to run out. The pump's screw cap and seal should be in good condition; replace a worn or cracked pump with a new one. Some wall dispensers that work with single-use cartridges are not designed to be refilled from a canister; when buying a new dispenser, choose a model with a refillable reservoir."),
      h2("How often should you clean them?"),
      p("A practical rule is to clean at every refill. If you wash and dry the reservoir every time, you don't need a separate cleaning schedule. Dried soap at the tip of the pump can be wiped off with a damp cloth during your weekly basin clean. If you use separate bottles for the kitchen and bathroom at home, refilling them on the same day turns the job into an easy routine."),
      h2("A refilling routine for businesses"),
      p("In hotels, offices or restaurants with many washbasins, refilling should be part of a routine:"),
      ul(
        "Decide which person or team is responsible for refilling.",
        "Note which scent each dispenser is filled with, so the same point always has the same scent.",
        "Keep spare bottles or reservoirs, so that no basin is left empty while one dries.",
        "Write the opening date on canisters and use the oldest one first. PRESTİJ products should be used within 12 months of opening.",
        "Store canisters away from heat and direct sunlight, out of the reach of children.",
      ),
      p(`We explain which canister suits your business in our ${a(TO.canisters, "guide to 5 L and 20 L canisters")}.`),
      h2("A safety note"),
      p(`Take care that no soap gets into your eyes while refilling. ${EYE_CAUTION.en} Spilled soap makes floors slippery, so wipe up drips straight away.`),
      p(`For refilling, browse our ${a(TO.lavanta, "Lavender")}, ${a(TO.lavantaLatte, "Lavender Latte")} and ${a(TO.portakal, "Orange")} liquid hand soaps and ${a(TO.okyanus, "Ocean shower gel")} in 5 L and 20 L canisters, and see every option in the ${a(TO.handSoap, "liquid hand soap")} and ${a(TO.showerGel, "shower gel")} categories. If you are planning regular purchases for your business, ask for a ${a(TO.business, "business quote")}.`),
    ),
    ar: html(
      p("من المزايا الكبيرة لشراء الصابون السائل في عبوات 5 لترات أو 20 لترًا أنك تستطيع إعادة تعبئة زجاجاتك بالمضخة وموزّعاتك متى شئت. لكن إعادة التعبئة ليست مجرد صبّ الصابون من العبوة في الزجاجة. نشرح في هذا الدليل الخطوات التي تجعل التعبئة نظيفة ومرتّبة وخالية من المتاعب، وما ينبغي مراعاته في المنزل وفي المنشآت."),
      h2("القاعدة الذهبية: لا تضف الصابون فوق القديم"),
      p("من الأخطاء الشائعة إضافة صابون جديد بينما لا يزال في الزجاجة شيء من القديم. عندها يختلط المنتج القديم المتجمّع في قاع الزجاجة وداخل المضخة بالصابون الجديد، وقد يفقد مع الوقت تجانس قوامه ولونه ورائحته، وقد تنسدّ المضخة. لذلك لا تملأ الموزّع أو الزجاجة بالمضخة إلا بعد أن يفرغ تمامًا، وبعد تنظيفه وتجفيفه."),
      h2("ما الذي تحتاج إليه؟"),
      ul(
        "الصابون الذي ستعبّئ به (عبوة 5 لترات أو 20 لترًا)،",
        "قمع نظيف وجاف،",
        "ماء فاتر،",
        "قطعة قماش نظيفة لا تترك وبرًا،",
        "دليل استخدام الموزّع إن وُجد.",
      ),
      h2("التعبئة خطوة بخطوة"),
      ol(
        `${b("أفرغها تمامًا.")} استخدم الزجاجة أو الموزّع حتى يفرغ، واسكب الكمية القليلة المتبقية في المغسلة.`,
        `${b("افصل المضخة والخزان.")} في الزجاجة بالمضخة، فُكّ المضخة بتدويرها. وفي الموزّعات الجدارية، انزع الخزان أو الخرطوشة وفق تعليمات الشركة المصنّعة.`,
        `${b("اغسلها بماء فاتر.")} اشطف الخزان بالماء الفاتر عدة مرات. ثم اغمس طرف المضخة في وعاء فيه ماء فاتر واضغطها عدة مرات حتى يخرج منها ماء نظيف.`,
        `${b("جفّفها تمامًا.")} اترك الخزان والمضخة ليجفّا مقلوبين. فالماء المتبقي في الداخل يخفّف الصابون، لذا لا تتعجّل في هذه الخطوة. ويمكنك أيضًا العمل بزجاجة احتياطية: إحداهما تجفّ والأخرى قيد الاستخدام.`,
        `${b("املأها باستخدام القمع.")} ضع القمع في فوهة الزجاجة واسكب الصابون ببطء. قد يكون الصبّ مباشرةً من عبوة 20 لترًا صعبًا، فوزنها وهي ممتلئة يزيد على 20 كيلوغرامًا؛ لذا يسهل عليك أن تملأ أولًا وعاءً وسيطًا نظيفًا وجافًا ثم تعبّئ منه.`,
        `${b("اترك مسافة في الأعلى.")} لا تملأ الزجاجة حتى حافتها، واترك مسافة بعرض إصبع حتى لا يفيض الصابون عند تركيب المضخة.`,
        `${b("ركّب المضخة وشغّلها.")} أحكم إغلاق المضخة واضغطها عدة مرات حتى يخرج الصابون. ثم امسح السطح الخارجي للزجاجة بقطعة قماش مبللة.`,
        `${b("أغلق العبوة.")} أغلق غطاء العبوة الكبيرة بإحكام فورًا، وأعدها إلى مكان بارد بعيد عن الشمس.`,
      ),
      h2("لا تخفّف الصابون بالماء"),
      p("قد يبدو تخفيف الصابون المأخوذ من العبوة بالماء «ليدوم مدة أطول» فكرة مغرية. لكن صابون اليدين السائل مُعدّ للاستخدام كما هو في عبوته. فإضافة الماء تغيّر قوامه ورغوته وتُخلّ بتدفقه من المضخة. اتبع تعليمات الاستخدام على الملصق: توضع كمية كافية من المنتج على اليدين المبللتين وتُفرك حتى تتكوّن الرغوة، ثم تُشطف بالماء."),
      p("ملاحظة: تعمل موزّعات الرغوة بأنواع صابون رغوي مخصّصة لها. أما الخطوات في هذا الدليل فهي لموزّعات الصابون السائل والزجاجات بالمضخة."),
      h2("مشكلات شائعة"),
      ul(
        `${b("المضخة لا تسحب الصابون:")} اضغط المضخة عدة مرات متتالية، وتأكّد من أن الأنبوب يصل إلى قاع الزجاجة. وإن كان عند طرفها صابون جاف، فاغمسه في ماء فاتر واضغط المضخة حتى ينفتح.`,
        `${b("المضخة تقطر أو تسرّب:")} تحقّق من إحكام إغلاق الغطاء ومن وجود الحلقة المانعة للتسرّب في مكانها، ومن أن الزجاجة ليست ممتلئة حتى حافتها.`,
        `${b("الصابون أكثر سيولة من المعتاد:")} ربما مُلئ الخزان قبل أن يجفّ تمامًا، أو اختلط الماء بالصابون. أفرغ الزجاجة واغسلها وجفّفها تمامًا، ثم أعد تعبئتها.`,
        `${b("فقاعات هواء في الزجاجة:")} اسكب الصابون ببطء، وستختفي الفقاعات من تلقاء نفسها بعد وقت قصير.`,
      ),
      h2("أي الزجاجات والموزّعات يمكن إعادة تعبئتها؟"),
      p("يمكن إعادة تعبئة الزجاجات بالمضخة المصنوعة من الزجاج أو البلاستيك المتين، ذات المضخة الملولبة، مرات كثيرة. والزجاجة الشفافة تسهّل عليك رؤية الوقت الذي يقترب فيه الصابون من النفاد. وينبغي أن يكون غطاء المضخة الملولب وحلقتها المانعة للتسرّب بحالة جيدة، فاستبدل المضخة البالية أو المتشقّقة بأخرى جديدة. وبعض الموزّعات الجدارية التي تعمل بخراطيش أحادية الاستخدام غير مصمّمة لإعادة التعبئة من عبوة كبيرة؛ لذا اختر عند شراء موزّع جديد طرازًا بخزان قابل لإعادة التعبئة."),
      h2("كم مرة ينبغي تنظيفها؟"),
      p("من القواعد العملية التنظيف عند كل تعبئة. فإذا غسلت الخزان وجفّفته في كل مرة، فلن تحتاج إلى جدول تنظيف منفصل. أما بقايا الصابون الجافة عند طرف المضخة، فيمكنك مسحها بقطعة قماش مبللة أثناء التنظيف الأسبوعي للمغسلة. وإن كنت تستخدم في المنزل زجاجات منفصلة للمطبخ والحمّام، فإن تعبئتها في اليوم نفسه يحوّل هذه المهمة إلى روتين سهل."),
      h2("نظام التعبئة في المنشآت"),
      p("في الفنادق والمكاتب والمطاعم التي تضم مغاسل كثيرة، ينبغي أن تصبح التعبئة جزءًا من روتين ثابت:"),
      ul(
        "حدّد الشخص أو الفريق المسؤول عن التعبئة.",
        "سجّل الرائحة التي يُملأ بها كل موزّع، لتبقى الرائحة نفسها في النقطة نفسها دائمًا.",
        "احتفظ بزجاجات أو خزانات احتياطية حتى لا تبقى أي مغسلة فارغة أثناء التجفيف.",
        "اكتب تاريخ الفتح على العبوات واستخدم الأقدم أولًا. يُنصح باستخدام منتجات PRESTİJ خلال 12 شهرًا من فتحها.",
        "احفظ العبوات بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.",
      ),
      p(`نشرح أي عبوة تناسب منشأتك في ${a(TO.canisters, "دليلنا لعبوات 5 لترات و20 لترًا")}.`),
      h2("ملاحظة للسلامة"),
      p(`احرص على ألّا يصل الصابون إلى عينيك أثناء التعبئة. ${EYE_CAUTION.ar} والصابون المسكوب يجعل الأرضية زلقة، فامسح القطرات فورًا.`),
      p(`للتعبئة، تصفّح صابون اليدين السائل ${a(TO.lavanta, "اللافندر")} و${a(TO.lavantaLatte, "لاتيه اللافندر")} و${a(TO.portakal, "البرتقال")}، و${a(TO.okyanus, "جل الاستحمام «المحيط»")} في عبوات 5 لترات و20 لترًا، وشاهد جميع الخيارات في فئتي ${a(TO.handSoap, "صابون اليدين السائل")} و${a(TO.showerGel, "جل الاستحمام")}. وإن كنت تخطّط لمشتريات منتظمة لمنشأتك، فاطلب ${a(TO.business, "عرض سعر للشركات")}.`),
    ),
  },
};

// ---------------------------------------------------------------------------------------------------
// 5. 5 L ve 20 L bidon sıvı sabun rehberi (targets "5 litre / 20 litre sıvı sabun")

const CANISTERS: SeedBlogPost = {
  slug: "5-litre-20-litre-sivi-sabun-rehberi",
  publishedAt: "2026-10-27T09:30:00+03:00",
  cover: "PRESTIJ_Portakal_20L_yatay_etiket_traverten",
  related: ["lavanta", "portakal", "dort-koku-koleksiyonu"],
  tags: ["Sıvı sabun", "Bidon", "İşletmeler"],
  title: {
    tr: "5 L ve 20 L Bidon Sıvı Sabun: İşletmeler İçin Rehber",
    en: "5 L and 20 L Liquid Soap Canisters: A Guide for Businesses",
    ar: "الصابون السائل في عبوات 5 لترات و20 لترًا: دليل للمنشآت",
  },
  excerpt: {
    tr: "Pompalı şişeden bidona geçmeyi düşünüyorsanız doğru boyu seçmek önemli. 5 litre ve 20 litre sıvı sabun bidonlarını tüketim, saklama, dolum ve sipariş planı açısından karşılaştırdık.",
    en: "Thinking of moving from pump bottles to canisters? Choosing the right size matters. We compare 5 L and 20 L liquid soap canisters in terms of consumption, storage, refilling and ordering.",
    ar: "هل تفكّر في الانتقال من الزجاجات بالمضخة إلى العبوات الكبيرة؟ اختيار الحجم المناسب مهم. قارنّا بين عبوتي الصابون السائل 5 لترات و20 لترًا من حيث الاستهلاك والتخزين وإعادة التعبئة والطلب.",
  },
  seo: {
    title: {
      tr: "5 Litre ve 20 Litre Sıvı Sabun: Bidon Rehberi",
      en: "5 L and 20 L Liquid Soap Canisters: A Buyer's Guide",
      ar: "الصابون السائل في عبوات 5 و20 لترًا: دليل الشراء",
    },
    description: {
      tr: "5 litre ve 20 litre bidon sıvı sabun hangi işletmeye uygun? Tüketim hesabı, saklama, dolum ve sipariş planı için pratik bir rehber.",
      en: "Which suits your business, a 5 L or a 20 L liquid soap canister? A practical guide to estimating use, storage, refilling and ordering.",
      ar: "أيهما يناسب منشأتك: عبوة الصابون السائل 5 لترات أم 20 لترًا؟ دليل عملي لحساب الاستهلاك والتخزين وإعادة التعبئة وتخطيط الطلبات.",
    },
  },
  body: {
    tr: html(
      p("Lavabonun yanında duran şık bir pompalı şişe, evde günlük kullanım için yeterlidir. Ancak gün içinde onlarca kişinin el yıkadığı bir ofiste, odaları her gün hazırlanan bir otelde ya da mutfağı hiç durmayan bir restoranda tek tek şişe almak hem zaman hem emek ister. Bu noktada 5 L ve 20 L bidonlar devreye girer. Bu rehberde hangi boyun kime uygun olduğunu ve bidonla çalışırken nelere dikkat etmek gerektiğini anlattık."),
      h2("Bidon sıvı sabun ne işe yarar?"),
      p("Bidonlar, sabunu doğrudan kullanmak için değil; pompalı şişeleri, dispenserleri ve sabunlukları yeniden doldurmak için tasarlanır. Böylece:"),
      ul(
        "her sabun bittiğinde yeni bir şişe almanız gerekmez,",
        "lavabolarınızdaki şişe ve dispenserler aynı kalır, yalnızca içleri yenilenir,",
        "siparişlerinizi daha seyrek ve planlı verebilirsiniz.",
      ),
      p("PRESTİJ'in 5 L ve 20 L bidonları, pompalı şişelerle aynı formülü ve aynı kokuyu taşır. Misafiriniz odadaki şişede de lobideki dispenserde de aynı PRESTİJ deneyimini yaşar."),
      h2("Pompalı şişe, 5 L ve 20 L: kısa karşılaştırma"),
      ul(
        `${b("Pompalı şişe:")} Lavabonun başında doğrudan kullanılır ve dekorun bir parçasıdır; evler ve az kullanılan alanlar için idealdir.`,
        `${b("5 L bidon:")} Birkaç şişeyi ya da dispenseri doldurmaya yeter, kolay taşınır ve farklı kokularla çalışmayı kolaylaştırır.`,
        `${b("20 L bidon:")} Yoğun tüketimde daha seyrek sipariş demektir; sabit bir dolum noktası gerektirir ve tek kokuyla çalışan işletmelere uygundur.`,
      ),
      h2("5 L mi, 20 L mi?"),
      h3("5 L bidon kimler için uygun?"),
      ul(
        "birkaç lavabosu olan küçük ofisler, butik oteller, kafeler ve mağazalar,",
        "kalabalık aileler ya da birden fazla banyosu olan evler,",
        "farklı alanlarda farklı kokular kullanmak isteyenler (her koku için ayrı bir 5 L bidon),",
        "depolama alanı sınırlı olanlar.",
      ),
      p("5 litrelik bidon rahatça taşınır ve doğrudan pompalı şişeye dökülebilir."),
      h3("20 L bidon kimler için uygun?"),
      ul(
        "çok sayıda odası ve ortak alanı olan oteller,",
        "kalabalık ofisler, okullar, spor salonları ve alışveriş merkezleri gibi yoğun kullanılan alanlar,",
        "restoran ve yemekhane mutfakları,",
        "tüm noktalarda tek bir koku kullanan işletmeler.",
      ),
      p("Dolu bir 20 L bidon 20 kilogramın üzerindedir. Bu yüzden genellikle depoda ya da kat ofisinde sabit tutulur; dolum, temiz bir ara kapla ya da doğrudan dispenser haznelerine yapılır."),
      h2("İhtiyacınızı nasıl hesaplarsınız?"),
      p("Doğru boyu seçmenin güvenilir bir yolu, kendi tüketiminizi ölçmektir. Tahmin yerine şu basit yöntemi deneyin:"),
      ol(
        "Sabun kullanılan tüm noktaları (lavabolar, duşlar, mutfak) listeleyin.",
        "Bir ya da iki hafta boyunca her noktanın kaç kez doldurulduğunu not edin.",
        "Doldurduğunuz şişe ya da haznenin hacmini bu sayıyla çarparak haftalık toplam tüketiminizi bulun.",
        "Bu toplamı aylık ihtiyaca çevirin ve bidon sayısını buna göre planlayın.",
      ),
      p("Örneğin haftalık tüketiminiz birkaç litrede kalıyorsa 5 L bidonlar yeterli olabilir; her hafta bir 5 L bidonu bitiriyorsanız 20 L bidonla daha seyrek sipariş vermek işinizi kolaylaştırır. Yoğun dönemleri de (yaz sezonu, etkinlikler, okulların açık olduğu aylar) hesaba katın ve bu dönemlerde stokunuzu biraz artırın."),
      h3("Açıldıktan sonraki kullanım süresini unutmayın"),
      p("PRESTİJ ürünlerinin açıldıktan sonraki kullanım süresi 12 aydır. Açtığınız bir bidonu 12 ay içinde tüketemeyecekseniz daha küçük boyu tercih edin. Örneğin aylık tüketiminiz düşükse tek bir 20 L bidon yerine birkaç 5 L bidon almak daha doğru olur; açılmamış bidonlar sırasını bekler."),
      h2("Saklama ve stok düzeni"),
      ul(
        "Bidonları ısı ve direkt güneş ışığından uzakta, serin bir yerde ve çocukların ulaşamayacağı şekilde saklayın.",
        "Kapakları her kullanımdan sonra sıkıca kapatın.",
        "Açılış tarihini bidonun üzerine yazın; önce açılanı önce kullanın.",
        "Ağır bidonları alt raflara yerleştirin; dökülmelere karşı altlarına bir tepsi koyabilirsiniz.",
        "Stok sayımında açılmamış bidonları ayrı sayın; yeniden sipariş zamanını böylece kolayca görürsünüz.",
      ),
      h2("Bidona geçerken ilk adımlar"),
      ol(
        "Lavabolarınızdaki şişe ve dispenserlerin yeniden doldurulabilir olduğunu kontrol edin; tek kullanımlık kartuşlu sistemler bidondan doldurulamayabilir.",
        "Bir huni ve gerekirse temiz bir ara kap edinin.",
        "Dolum görevini bir kişiye ya da ekibe verin.",
        "İlk ay 5 L bidonla başlayıp tüketiminizi ölçün; ardından boyu ve sipariş sıklığını buna göre belirleyin.",
      ),
      h2("Dolum ipuçları"),
      p(`Bidondan dolum yaparken en önemli kural, şişeyi ya da dispenseri tamamen boşaldığında, temizleyip kuruttuktan sonra doldurmaktır; üstüne ekleme yapmayın ve sabunu suyla inceltmeyin. Adım adım anlatım için ${a(TO.refilling, "dispenser ve pompalı şişe doldurma rehberimize")} göz atın.`),
      h2("Koku ve ürün seçimi"),
      p("PRESTİJ'in dört kokusu da bidon seçenekleriyle sunulur:"),
      ul(
        `${a(TO.lavanta, "Lavanta")}, ${a(TO.lavantaLatte, "Lavanta Latte")} ve ${a(TO.portakal, "Portakal")} sıvı el sabunları: lavabolar, mutfaklar ve tuvaletler için,`,
        `${a(TO.okyanus, "Okyanus duş jeli")}: otel odaları, spa ve spor salonu duşları için.`,
      ),
      p(`Dört kokuyu birlikte denemek ya da her alana farklı bir koku vermek isteyenler için ${a(TO.bundle, "Dört Koku Koleksiyonu")}, dört kokuyu 5 L bidonlarda bir araya getirir. Hangi kokunun hangi alana yakıştığını ${a(TO.scents, "koku seçimi rehberimizde")} anlattık.`),
      h2("İşletmeler için sipariş ve fatura"),
      p(`Sipariş verirken ödeme adımında faturanın firmanız adına düzenlenmesini seçebilirsiniz. Düzenli ya da yüksek hacimli alımlar için ${a(TO.business, "toptan sıvı sabun ve kurumsal teklif sayfamızdan")} ihtiyacınızı iletin; işletmenize özel fiyatla dönüş yapalım. Karar vermeden önce kokuları kendi mekânınızda denemek isterseniz ${a(TO.samples, "ücretsiz numune")} isteyebilirsiniz; ${SAMPLES_NOTE.tr}.`),
    ),
    en: html(
      p("An elegant pump bottle by the basin is all a home needs for everyday use. But buying bottle after bottle for an office where dozens of people wash their hands every day, a hotel whose rooms are made up daily or a restaurant whose kitchen never stops takes time and effort. That is where 5 L and 20 L canisters come in. In this guide we explain which size suits whom and what to keep in mind when working with canisters."),
      h2("What are liquid soap canisters for?"),
      p("Canisters are not meant for using soap directly; they are designed for refilling pump bottles, dispensers and soap containers. This means:"),
      ul(
        "you don't need to buy a new bottle every time the soap runs out,",
        "the bottles and dispensers at your basins stay the same, and only their contents are renewed,",
        "you can order less often and more predictably.",
      ),
      p("PRESTİJ's 5 L and 20 L canisters carry the same formula and the same scent as the pump bottles. Your guest enjoys the same PRESTİJ experience from the bottle in the room and the dispenser in the lobby."),
      h2("Pump bottle, 5 L and 20 L at a glance"),
      ul(
        `${b("Pump bottle:")} used directly at the basin and part of the décor; ideal for homes and spaces with light use.`,
        `${b("5 L canister:")} enough to refill several bottles or dispensers, easy to carry and handy when you work with different scents.`,
        `${b("20 L canister:")} means ordering less often when consumption is high; it needs a fixed refilling point and suits businesses that work with a single scent.`,
      ),
      h2("5 L or 20 L?"),
      h3("Who is the 5 L canister for?"),
      ul(
        "small offices, boutique hotels, cafés and shops with a few washbasins,",
        "large families or homes with more than one bathroom,",
        "anyone who wants different scents in different spaces (a separate 5 L canister for each scent),",
        "places with limited storage space.",
      ),
      p("A 5 L canister is easy to carry and to pour straight into a pump bottle."),
      h3("Who is the 20 L canister for?"),
      ul(
        "hotels with many rooms and shared areas,",
        "busy spaces such as large offices, schools, gyms and shopping centres,",
        "restaurant and canteen kitchens,",
        "businesses that use a single scent at every point.",
      ),
      p("A full 20 L canister weighs more than 20 kilograms. It is therefore usually kept in one place, such as a storeroom or housekeeping office, and refilling is done with a clean intermediate container or directly into dispenser reservoirs."),
      h2("How to work out what you need"),
      p("A reliable way to choose the right size is to measure your own consumption. Instead of guessing, try this simple method:"),
      ol(
        "List every point where soap is used (washbasins, showers, kitchen).",
        "For one or two weeks, note how many times each point is refilled.",
        "Multiply the volume of the bottle or reservoir you fill by that number to find your weekly total.",
        "Convert this into a monthly figure and plan the number of canisters accordingly.",
      ),
      p("For example, if your weekly consumption is only a few litres, 5 L canisters may be enough; if you finish a 5 L canister every week, ordering 20 L canisters less often will make things easier. Also allow for busy periods (the summer season, events, the months when schools are open) and increase your stock a little at those times."),
      h3("Don't forget the period after opening"),
      p("PRESTİJ products should be used within 12 months of opening. If you won't be able to finish a canister within 12 months of opening it, choose the smaller size. For instance, if your monthly consumption is low, several 5 L canisters are a better choice than a single 20 L one; unopened canisters simply wait their turn."),
      h2("Storage and stock routine"),
      ul(
        "Store canisters in a cool place away from heat and direct sunlight, out of the reach of children.",
        "Close the cap tightly after every use.",
        "Write the opening date on the canister and use the oldest one first.",
        "Keep heavy canisters on lower shelves; you can put a tray under them in case of spills.",
        "In stock counts, count unopened canisters separately; that way you can easily see when to reorder.",
      ),
      h2("First steps when switching to canisters"),
      ol(
        "Check that the bottles and dispensers at your basins can be refilled; systems with single-use cartridges may not take soap from a canister.",
        "Get a funnel and, if needed, a clean intermediate container.",
        "Give the refilling task to one person or team.",
        "Start with 5 L canisters in the first month and measure your consumption; then decide on the size and how often to order.",
      ),
      h2("Refilling tips"),
      p(`When refilling from a canister, the most important rule is to fill a bottle or dispenser only when it is completely empty, after cleaning and drying it; never top up and never dilute the soap with water. For a step-by-step explanation, see our ${a(TO.refilling, "guide to refilling dispensers and pump bottles")}.`),
      h2("Choosing scents and products"),
      p("All four PRESTİJ scents come in canisters:"),
      ul(
        `${a(TO.lavanta, "Lavender")}, ${a(TO.lavantaLatte, "Lavender Latte")} and ${a(TO.portakal, "Orange")} liquid hand soaps: for washbasins, kitchens and restrooms,`,
        `${a(TO.okyanus, "Ocean shower gel")}: for hotel rooms, spa and gym showers.`,
      ),
      p(`If you would like to try all four scents or give each space a different one, the ${a(TO.bundle, "Four-Scent Collection")} brings the four scents together in 5 L canisters. We explain which scent suits which space in our ${a(TO.scents, "guide to choosing a scent")}.`),
      h2("Ordering and invoicing for businesses"),
      p(`At checkout you can choose to have the invoice issued in your company's name. For regular or high-volume purchases, tell us what you need through our ${a(TO.business, "bulk liquid soap and business quotes page")} and we will get back to you with pricing for your business. If you would like to try the scents in your own space before deciding, you can request ${a(TO.samples, "free samples")}; ${SAMPLES_NOTE.en}.`),
    ),
    ar: html(
      p("تكفي زجاجة أنيقة بمضخة بجانب المغسلة للاستخدام اليومي في المنزل. لكن شراء الزجاجات واحدة تلو الأخرى لمكتب يغسل فيه عشرات الأشخاص أيديهم كل يوم، أو لفندق تُجهَّز غرفه يوميًا، أو لمطعم لا يتوقف مطبخه، يستهلك الوقت والجهد. وهنا يأتي دور العبوات سعة 5 لترات و20 لترًا. نشرح في هذا الدليل أي حجم يناسب من، وما الذي ينبغي مراعاته عند العمل بالعبوات الكبيرة."),
      h2("ما فائدة عبوات الصابون السائل الكبيرة؟"),
      p("لا تُستخدم العبوات الكبيرة لأخذ الصابون منها مباشرة، بل صُمّمت لإعادة تعبئة الزجاجات بالمضخة والموزّعات وحاويات الصابون. وهذا يعني:"),
      ul(
        "أنك لا تحتاج إلى شراء زجاجة جديدة كلما نفد الصابون،",
        "وأن الزجاجات والموزّعات عند مغاسلك تبقى كما هي، ويتجدّد ما بداخلها فقط،",
        "وأنك تستطيع تقديم طلباتك على فترات أطول وبتخطيط مسبق.",
      ),
      p("تحمل عبوات PRESTİJ سعة 5 لترات و20 لترًا التركيبة نفسها والرائحة نفسها الموجودتين في الزجاجات بالمضخة. فيعيش ضيفك تجربة PRESTİJ ذاتها سواء من الزجاجة في الغرفة أو من الموزّع في الردهة."),
      h2("الزجاجة بالمضخة وعبوتا 5 و20 لترًا: مقارنة سريعة"),
      ul(
        `${b("الزجاجة بالمضخة:")} تُستخدم مباشرةً عند المغسلة وهي جزء من الديكور، ومثالية للمنازل والأماكن قليلة الاستخدام.`,
        `${b("عبوة 5 لترات:")} تكفي لتعبئة عدة زجاجات أو موزّعات، ويسهل حملها، وتسهّل العمل بروائح مختلفة.`,
        `${b("عبوة 20 لترًا:")} تعني طلبات أقل تكرارًا عند ارتفاع الاستهلاك، وتحتاج إلى نقطة تعبئة ثابتة، وتناسب المنشآت التي تعتمد رائحة واحدة.`,
      ),
      h2("5 لترات أم 20 لترًا؟"),
      h3("لمن تناسب عبوة 5 لترات؟"),
      ul(
        "المكاتب الصغيرة والفنادق البوتيكية والمقاهي والمتاجر التي تضم عددًا قليلًا من المغاسل،",
        "العائلات الكبيرة أو المنازل التي فيها أكثر من حمّام،",
        "من يرغب في استخدام روائح مختلفة في أماكن مختلفة (عبوة 5 لترات لكل رائحة)،",
        "الأماكن ذات مساحة التخزين المحدودة.",
      ),
      p("يسهل حمل عبوة 5 لترات وصبّها مباشرةً في الزجاجة بالمضخة."),
      h3("لمن تناسب عبوة 20 لترًا؟"),
      ul(
        "الفنادق التي تضم غرفًا ومساحات مشتركة كثيرة،",
        "الأماكن المزدحمة مثل المكاتب الكبيرة والمدارس والنوادي الرياضية ومراكز التسوّق،",
        "مطابخ المطاعم والمقاصف،",
        "المنشآت التي تستخدم رائحة واحدة في جميع النقاط.",
      ),
      p("يزيد وزن عبوة 20 لترًا الممتلئة على 20 كيلوغرامًا. لذلك تُحفظ عادةً في مكان ثابت مثل المستودع أو مكتب خدمة الغرف، وتتم التعبئة بواسطة وعاء وسيط نظيف أو مباشرةً في خزانات الموزّعات."),
      h2("كيف تحسب احتياجك؟"),
      p("من الطرق الموثوقة لاختيار الحجم المناسب قياسُ استهلاكك الفعلي. بدلًا من التخمين، جرّب هذه الطريقة البسيطة:"),
      ol(
        "اكتب قائمة بكل النقاط التي يُستخدم فيها الصابون (المغاسل والدشات والمطبخ).",
        "سجّل لمدة أسبوع أو أسبوعين عدد مرات تعبئة كل نقطة.",
        "اضرب سعة الزجاجة أو الخزان الذي تملؤه في هذا العدد لتعرف إجمالي استهلاكك الأسبوعي.",
        "حوّل هذا الإجمالي إلى احتياج شهري، وخطّط لعدد العبوات بناءً عليه.",
      ),
      p("فمثلًا، إن كان استهلاكك الأسبوعي بضعة لترات فقط، فقد تكفيك عبوات 5 لترات؛ أما إن كنت تُنهي عبوة 5 لترات كل أسبوع، فإن طلب عبوات 20 لترًا على فترات أطول سيسهّل عملك. وخذ في الحسبان أيضًا فترات الذروة (موسم الصيف والفعاليات وأشهر الدراسة)، وزِد مخزونك قليلًا خلالها."),
      h3("لا تنسَ مدة الاستخدام بعد الفتح"),
      p("يُنصح باستخدام منتجات PRESTİJ خلال 12 شهرًا من فتحها. فإن كنت لن تستطيع إنهاء العبوة خلال 12 شهرًا من فتحها، فاختر الحجم الأصغر. على سبيل المثال، إن كان استهلاكك الشهري منخفضًا، فإن شراء عدة عبوات 5 لترات أنسب من عبوة واحدة 20 لترًا، إذ تنتظر العبوات غير المفتوحة دورها."),
      h2("التخزين وتنظيم المخزون"),
      ul(
        "احفظ العبوات في مكان بارد بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.",
        "أغلق الغطاء بإحكام بعد كل استخدام.",
        "اكتب تاريخ الفتح على العبوة، واستخدم الأقدم أولًا.",
        "ضع العبوات الثقيلة على الرفوف السفلية، ويمكنك وضع صينية تحتها تحسّبًا للانسكاب.",
        "عند جرد المخزون، احسب العبوات غير المفتوحة على حدة، فترى بسهولة متى تحتاج إلى طلب جديد.",
      ),
      h2("الخطوات الأولى عند الانتقال إلى العبوات الكبيرة"),
      ol(
        "تحقّق من أن الزجاجات والموزّعات عند مغاسلك قابلة لإعادة التعبئة، فالأنظمة ذات الخراطيش أحادية الاستخدام قد لا تقبل التعبئة من عبوة كبيرة.",
        "جهّز قمعًا، ووعاءً وسيطًا نظيفًا عند الحاجة.",
        "أسند مهمة التعبئة إلى شخص أو فريق.",
        "ابدأ بعبوات 5 لترات في الشهر الأول وقِس استهلاكك، ثم حدّد الحجم وعدد مرات الطلب.",
      ),
      h2("نصائح لإعادة التعبئة"),
      p(`القاعدة الأهم عند التعبئة من العبوة الكبيرة هي ألّا تملأ الزجاجة أو الموزّع إلا بعد أن يفرغ تمامًا ويُنظَّف ويُجفَّف؛ فلا تضف صابونًا فوق القديم ولا تخفّفه بالماء. للشرح خطوة بخطوة، اطّلع على ${a(TO.refilling, "دليلنا لإعادة تعبئة الموزّعات والزجاجات بالمضخة")}.`),
      h2("اختيار الروائح والمنتجات"),
      p("تتوفر روائح PRESTİJ الأربع جميعها في عبوات كبيرة:"),
      ul(
        `صابون اليدين السائل ${a(TO.lavanta, "اللافندر")} و${a(TO.lavantaLatte, "لاتيه اللافندر")} و${a(TO.portakal, "البرتقال")}: للمغاسل والمطابخ ودورات المياه،`,
        `${a(TO.okyanus, "جل الاستحمام «المحيط»")}: لغرف الفنادق ودشات السبا والنوادي الرياضية.`,
      ),
      p(`وإن أردت تجربة الروائح الأربع معًا أو منح كل مكان رائحة مختلفة، فإن ${a(TO.bundle, "مجموعة الروائح الأربع")} تجمعها في عبوات سعة 5 لترات. وقد شرحنا أي رائحة تناسب أي مكان في ${a(TO.scents, "دليلنا لاختيار الرائحة")}.`),
      h2("الطلب والفوترة للمنشآت"),
      p(`يمكنك عند إتمام الطلب اختيار إصدار الفاتورة باسم شركتك. وللمشتريات المنتظمة أو الكبيرة، أرسل احتياجك عبر ${a(TO.business, "صفحة الصابون السائل بالجملة وعروض الأسعار للشركات")}، وسنعود إليك بأسعار خاصة بمنشأتك. وإن أردت تجربة الروائح في مكانك قبل اتخاذ القرار، يمكنك طلب ${a(TO.samples, "عيّنات مجانية")}؛ ${SAMPLES_NOTE.ar}.`),
    ),
  },
};

// ---------------------------------------------------------------------------------------------------
// 6. Oteller, ofisler ve restoranlar için (targets "otel / ofis / restoran sıvı sabun"; /kurumsal owns
//    "toptan sıvı sabun", this post links to it instead of competing)

const BUSINESSES: SeedBlogPost = {
  slug: "otel-ofis-restoran-icin-sivi-sabun",
  publishedAt: "2026-11-03T09:30:00+03:00",
  cover: "PRESTIJ_Lavanta_Latte_5L_spa_servis_arabasi",
  related: ["lavanta-latte", "okyanus", "dort-koku-koleksiyonu"],
  tags: ["Otel", "Ofis", "Restoran", "İşletmeler"],
  title: {
    tr: "Oteller, Ofisler ve Restoranlar İçin Sıvı Sabun ve Duş Jeli",
    en: "Liquid Soap and Shower Gel for Hotels, Offices and Restaurants",
    ar: "الصابون السائل وجل الاستحمام للفنادق والمكاتب والمطاعم",
  },
  excerpt: {
    tr: "Bir işletmenin lavabosu, misafirlerine ve çalışanlarına verdiği özeni sessizce anlatır. Otel, ofis, restoran, okul ve spor salonları için sıvı sabun ve duş jeli planlamasına dair pratik öneriler.",
    en: "A business's washroom quietly tells guests and staff how much care goes into the details. Practical tips for planning liquid soap and shower gel in hotels, offices, restaurants, schools and gyms.",
    ar: "مغسلة المنشأة تخبر ضيوفها وموظفيها بصمت عن مقدار العناية بالتفاصيل. نصائح عملية لتخطيط الصابون السائل وجل الاستحمام في الفنادق والمكاتب والمطاعم والمدارس والنوادي الرياضية.",
  },
  seo: {
    title: {
      tr: "Otel, Ofis ve Restoran İçin Sıvı Sabun Rehberi",
      en: "Liquid Soap for Hotels, Offices and Restaurants",
      ar: "الصابون السائل للفنادق والمكاتب والمطاعم: دليل عملي",
    },
    description: {
      tr: "Otel, ofis, restoran, okul ve spor salonları için sıvı sabun ve duş jeli nasıl planlanır? Alan, boy, koku ve dolum düzeni için öneriler.",
      en: "How to plan liquid soap and shower gel for hotels, offices, restaurants, schools and gyms: tips on spaces, sizes, scents and refill routines.",
      ar: "كيف تخطّط للصابون السائل وجل الاستحمام في الفنادق والمكاتب والمطاعم والمدارس والنوادي؟ نصائح حول الأماكن والأحجام والروائح وإعادة التعبئة.",
    },
  },
  body: {
    tr: html(
      p("Misafirler bir otelin lobisini, bir restoranın menüsünü ya da bir ofisin toplantı odasını hatırlar; ama çoğu zaman fark etmeden lavaboyu da değerlendirir. Dolu bir dispenser, hoş bir koku ve temiz bir tezgâh, işletmenin ayrıntılara verdiği önemi sessizce anlatır. Bu rehberde farklı işletme türleri için sıvı sabun ve duş jeli planlamasını ele aldık."),
      h2("Önce alanları haritalayın"),
      p("Planlamaya, sabun ve duş jeli kullanılan her noktayı listeleyerek başlayın. Her nokta için üç soruyu yanıtlayın:"),
      ul(
        "Bu noktayı kimler kullanıyor: misafirler mi, çalışanlar mı, ikisi birden mi?",
        "Günde yaklaşık kaç kişi kullanıyor?",
        "Pompalı şişe mi, duvar dispenseri mi kullanılıyor?",
      ),
      p("Bu liste, hem hangi ürünlere hem de hangi boylara ihtiyacınız olduğunu gösterir."),
      h2("Oteller"),
      p("Otellerde iki farklı ihtiyaç vardır: oda banyoları ve ortak alanlar."),
      ul(
        `${b("Oda banyoları:")} Lavabo başında şık bir pompalı şişe sıvı el sabunu, duşta pompalı şişe duş jeli. Kat hizmetleri şişeleri 5 L ya da 20 L bidonlardan düzenli olarak doldurur.`,
        `${b("Lobi ve ortak tuvaletler:")} Yoğun kullanılan bu alanlarda dispenserin hiç boş kalmaması önemlidir; dolum sıklığını kullanım yoğunluğuna göre belirleyin.`,
        `${b("Spa ve fitness alanları:")} Duşlarda ve soyunma odalarında duş jeli, lavabolarda sıvı el sabunu.`,
      ),
      p("Odadaki şişeyle lobideki dispenserde aynı kokuyu kullanmak, otelinize tanınabilir bir imza kazandırır. Oda temizliğinde şişeleri kontrol edin; yarıya inen bir şişeyi yeni misafir gelmeden temiz ve dolu bir yedekle değiştirin. Doluluk arttıkça tüketim de artar, bu yüzden yüksek sezondan önce bidon stokunuzu gözden geçirin."),
      h2("Ofisler"),
      p("Ofislerde sabun tüketimi, çalışan sayısı ve mutfağın ne kadar kullanıldığıyla doğrudan ilişkilidir."),
      ul(
        `${b("Tuvaletler:")} Her lavaboda dolu bir dispenser ya da pompalı şişe.`,
        `${b("Ofis mutfağı:")} Bulaşık deterjanından ayrı, el yıkamak için bir pompalı şişe sıvı el sabunu.`,
        `${b("Toplantı ve misafir alanlarına yakın lavabolar:")} Ziyaretçilerin el yıkadığı yerlerde zarif bir şişe ve sizin seçtiğiniz bir koku.`,
      ),
      p("Dolum görevini bir kişiye ya da temizlik ekibine vermek ve bir dolum çizelgesi tutmak, “sabun bitmiş” şikâyetlerinin önüne geçer. Çalışan sayısı değiştiğinde ya da ofis büyüdüğünde tüketiminizi yeniden ölçün."),
      h2("Restoranlar ve kafeler"),
      p("Restoranlarda misafir lavabosu ile mutfak, ihtiyaçları farklı iki ayrı dünyadır. Misafir lavabosundaki şişeyi her servisten önce kontrol edin; yoğun bir akşamda boşalan bir şişe misafirin gözünden kaçmaz."),
      ul(
        `${b("Misafir lavabosu:")} Burası restoranınızın bir parçasıdır; dekorla uyumlu bir pompalı şişe ve davetkâr bir koku seçin.`,
        `${b("Mutfak ve hazırlık alanları:")} El yıkama noktalarında sabun her an hazır olmalıdır. Gıda işletmeleri, bağlı oldukları hijyen kurallarına göre el yıkama noktalarını düzenlemeli ve personelin ellerini sık sık yıkamasını sağlamalıdır.`,
      ),
      p(`Doğru el yıkama adımlarını ekibinizle paylaşmak için ${a(TO.handWashing, "el yıkama rehberimizden")} yararlanabilirsiniz.`),
      h2("Okullar, spor salonları ve diğer yoğun alanlar"),
      p("Okullar, kurslar, spor salonları, kuaförler ve alışveriş alanları gibi gün boyu yoğun kullanılan yerlerde öncelik süreklilik ve kolay dolumdur. Bu alanlarda tek bir koku seçip 20 L bidonla merkezi bir dolum düzeni kurmak işinizi kolaylaştırır. Spor salonlarının duşlarında duş jeli, lavabolarda sıvı el sabunu kullanın."),
      h3("Personel alanlarını unutmayın"),
      p("Soyunma odaları, personel tuvaletleri ve mutfak arkasındaki lavabolar da misafir alanları kadar özen ister. Personel alanlarında da aynı ürünleri kullanmak stok yönetimini sadeleştirir ve ekibinize verdiğiniz değeri gösterir."),
      h2("Hangi boy, hangi alan?"),
      ul(
        `${b("Pompalı şişe:")} oda banyoları, misafir lavaboları, ofis mutfağı.`,
        `${b("5 L bidon:")} birkaç lavabosu olan ya da farklı alanlarda farklı kokular kullanan işletmeler.`,
        `${b("20 L bidon:")} çok sayıda lavabo ve duşu olan, tek kokuyla çalışan yoğun işletmeler.`,
      ),
      p(`Tüketiminizi hesaplama yöntemi ve saklama önerileri için ${a(TO.canisters, "5 L ve 20 L bidon rehberimize")} göz atın.`),
      h2("Koku seçimi"),
      p(`İşletmenizin karakterine uygun bir koku seçin ve tüm noktalarda tutarlı biçimde kullanın: klasik ve güven veren bir atmosfer için ${a(TO.lavanta, "Lavanta")}, sakin ve yumuşak bir karşılama için ${a(TO.lavantaLatte, "Lavanta Latte")}, canlı ve sıcak bir enerji için ${a(TO.portakal, "Portakal")}, duşlar için ferah ${a(TO.okyanus, "Okyanus duş jeli")}. Daha fazla fikir için ${a(TO.scents, "koku seçimi rehberimizi")} okuyun.`),
      h2("Misafir deneyimi için küçük ayrıntılar"),
      ul(
        "Şişeleri ve dispenserleri her gün nemli bir bezle silin; üzerlerinde sabun lekesi ve parmak izi kalmasın.",
        "Şişenin etiketini misafire dönük yerleştirin.",
        "Kâğıt havluyu ya da el havlusunu sabunun hemen yanında bulundurun.",
        "Lavabo tezgâhını kuru tutun; sabun damlalarını hemen silin.",
        "Bitmek üzere olan şişeleri misafir fark etmeden yenileyin.",
      ),
      h2("Dolum ve stok düzeni"),
      ul(
        `Dispenserleri tamamen boşaldığında temizleyip kurutarak doldurun; üstüne ekleme yapmayın (ayrıntılar ${a(TO.refilling, "dolum rehberimizde")}).`,
        "Yedek şişe ya da hazne bulundurun.",
        "Bidonların açılış tarihini yazın ve açıldıktan sonra 12 ay içinde kullanın.",
        "Ürünleri ısı ve güneş ışığından uzakta, çocukların ulaşamayacağı bir yerde saklayın.",
        "Stokunuz bitmeden bir sonraki siparişinizi planlayın.",
      ),
      h2("PRESTİJ ile çalışmak"),
      p(`PRESTİJ sıvı el sabunları ve Okyanus duş jeli Kayseri'de üretilir; pompalı şişe, 5 L ve 20 L bidon seçenekleriyle sunulur. Sipariş verirken faturanın firmanız adına düzenlenmesini seçebilirsiniz. Düzenli ya da yüksek hacimli alımlar için ${a(TO.business, "kurumsal teklif sayfamızdan")} ihtiyacınızı iletin; işletmenize özel fiyatla dönüş yapalım. Kokuları kendi mekânınızda denemek isterseniz ${a(TO.samples, "ücretsiz numune")} isteyin; ${SAMPLES_NOTE.tr}. Sorularınız için ${a(TO.contact, "iletişim sayfamızdan")} bize ulaşabilirsiniz.`),
    ),
    en: html(
      p("Guests remember a hotel's lobby, a restaurant's menu or an office's meeting room, but they often judge the washroom too, without even noticing. A full dispenser, a pleasant scent and a clean counter quietly show how much a business cares about the details. In this guide we look at planning liquid soap and shower gel for different types of business."),
      h2("Start by mapping your spaces"),
      p("Begin by listing every point where soap and shower gel are used. For each one, answer three questions:"),
      ul(
        "Who uses this point: guests, staff or both?",
        "Roughly how many people use it each day?",
        "Is there a pump bottle or a wall dispenser?",
      ),
      p("This list shows both which products and which sizes you need."),
      h2("Hotels"),
      p("Hotels have two different needs: guest bathrooms and shared areas."),
      ul(
        `${b("Guest bathrooms:")} an elegant pump bottle of liquid hand soap by the basin and a pump bottle of shower gel in the shower. Housekeeping refills the bottles regularly from 5 L or 20 L canisters.`,
        `${b("Lobby and public restrooms:")} in these busy areas the dispenser should never run empty; set how often you refill according to how busy they are.`,
        `${b("Spa and fitness areas:")} shower gel in the showers and changing rooms, liquid hand soap at the basins.`,
      ),
      p("Using the same scent in the room bottle and the lobby dispenser gives your hotel a recognisable signature. Check the bottles when rooms are cleaned, and swap a half-empty bottle for a clean, full spare before the next guest arrives. Consumption rises with occupancy, so review your canister stock before the high season."),
      h2("Offices"),
      p("In offices, soap consumption is directly linked to the number of employees and how much the kitchen is used."),
      ul(
        `${b("Restrooms:")} a full dispenser or pump bottle at every basin.`,
        `${b("Office kitchen:")} a pump bottle of liquid hand soap for washing hands, separate from the washing-up liquid.`,
        `${b("Basins near meeting and visitor areas:")} an elegant bottle and a scent of your choice where visitors wash their hands.`,
      ),
      p("Giving the refilling task to one person or the cleaning team and keeping a refill log prevents “the soap has run out” complaints. Measure your consumption again whenever headcount changes or the office grows."),
      h2("Restaurants and cafés"),
      p("In restaurants, the guest washroom and the kitchen are two separate worlds with different needs. Check the bottle in the guest washroom before every service; a bottle that runs empty on a busy evening does not go unnoticed by guests."),
      ul(
        `${b("Guest washroom:")} it is part of your restaurant; choose a pump bottle that matches the décor and an inviting scent.`,
        `${b("Kitchen and preparation areas:")} soap must be ready at every handwashing point at all times. Food businesses should organise their handwashing points according to the hygiene rules that apply to them and make sure staff wash their hands frequently.`,
      ),
      p(`To share the correct handwashing steps with your team, you can use our ${a(TO.handWashing, "handwashing guide")}.`),
      h2("Schools, gyms and other busy spaces"),
      p("In places that are busy all day, such as schools, training centres, gyms, hair salons and shopping areas, the priority is continuity and easy refilling. Choosing a single scent and setting up a central refilling routine with 20 L canisters makes things easier here. Use shower gel in gym showers and liquid hand soap at the basins."),
      h3("Don't forget staff areas"),
      p("Changing rooms, staff restrooms and the basins behind the kitchen deserve as much care as guest areas. Using the same products in staff areas also simplifies stock management and shows your team that they are valued."),
      h2("Which size for which space?"),
      ul(
        `${b("Pump bottle:")} guest bathrooms, guest washrooms, office kitchens.`,
        `${b("5 L canister:")} businesses with a few washbasins, or those using different scents in different areas.`,
        `${b("20 L canister:")} busy businesses with many basins and showers that work with a single scent.`,
      ),
      p(`For a method to calculate your consumption and storage tips, see our ${a(TO.canisters, "guide to 5 L and 20 L canisters")}.`),
      h2("Choosing a scent"),
      p(`Choose a scent that matches your business's character and use it consistently at every point: ${a(TO.lavanta, "Lavender")} for a classic, reassuring atmosphere, ${a(TO.lavantaLatte, "Lavender Latte")} for a calm, soft welcome, ${a(TO.portakal, "Orange")} for lively, warm energy and fresh ${a(TO.okyanus, "Ocean shower gel")} for showers. For more ideas, read our ${a(TO.scents, "guide to choosing a scent")}.`),
      h2("Small details for the guest experience"),
      ul(
        "Wipe bottles and dispensers with a damp cloth every day, so no soap marks or fingerprints are left on them.",
        "Place the bottle with its label facing the guest.",
        "Keep paper towels or a hand towel right next to the soap.",
        "Keep the basin counter dry and wipe up soap drips straight away.",
        "Replace bottles that are about to run out before guests notice.",
      ),
      h2("Refilling and stock routine"),
      ul(
        `Refill dispensers only when they are completely empty, after cleaning and drying them; never top up (details in our ${a(TO.refilling, "refilling guide")}).`,
        "Keep spare bottles or reservoirs.",
        "Write the opening date on canisters and use them within 12 months of opening.",
        "Store products away from heat and sunlight, out of the reach of children.",
        "Plan your next order before your stock runs out.",
      ),
      h2("Working with PRESTİJ"),
      p(`PRESTİJ liquid hand soaps and Ocean shower gel are made in Kayseri and come in pump bottles and 5 L and 20 L canisters. At checkout you can choose to have the invoice issued in your company's name. For regular or high-volume purchases, tell us what you need through our ${a(TO.business, "business quotes page")} and we will get back to you with pricing for your business. If you would like to try the scents in your own space, request ${a(TO.samples, "free samples")}; ${SAMPLES_NOTE.en}. For any questions, reach us through our ${a(TO.contact, "contact page")}.`),
    ),
    ar: html(
      p("يتذكّر الضيوف ردهة الفندق وقائمة طعام المطعم وقاعة اجتماعات المكتب، لكنهم كثيرًا ما يحكمون على المغسلة أيضًا دون أن ينتبهوا. فموزّع ممتلئ ورائحة لطيفة وسطح نظيف تُظهر بصمت مدى اهتمام المنشأة بالتفاصيل. نتناول في هذا الدليل تخطيط الصابون السائل وجل الاستحمام لأنواع مختلفة من المنشآت."),
      h2("ابدأ برسم خريطة لأماكنك"),
      p("ابدأ بكتابة قائمة بكل النقاط التي يُستخدم فيها الصابون وجل الاستحمام، وأجب عن ثلاثة أسئلة لكل نقطة:"),
      ul(
        "من يستخدم هذه النقطة: الضيوف أم الموظفون أم كلاهما؟",
        "كم شخصًا يستخدمها يوميًا على وجه التقريب؟",
        "هل فيها زجاجة بمضخة أم موزّع جداري؟",
      ),
      p("تكشف لك هذه القائمة المنتجات التي تحتاج إليها والأحجام المناسبة لها."),
      h2("الفنادق"),
      p("للفنادق احتياجان مختلفان: حمّامات الغرف والمساحات المشتركة."),
      ul(
        `${b("حمّامات الغرف:")} زجاجة أنيقة بمضخة من صابون اليدين السائل بجانب المغسلة، وزجاجة بمضخة من جل الاستحمام في الدش. ويعيد فريق خدمة الغرف تعبئة الزجاجات بانتظام من عبوات 5 لترات أو 20 لترًا.`,
        `${b("الردهة ودورات المياه العامة:")} في هذه الأماكن المزدحمة ينبغي ألّا يفرغ الموزّع أبدًا، فحدّد عدد مرات التعبئة وفق كثافة الاستخدام.`,
        `${b("السبا ومرافق اللياقة:")} جل الاستحمام في الدشات وغرف تبديل الملابس، وصابون اليدين السائل عند المغاسل.`,
      ),
      p("استخدام الرائحة نفسها في زجاجة الغرفة وموزّع الردهة يمنح فندقك بصمة مميّزة يسهل تذكّرها. افحص الزجاجات عند تنظيف الغرف، واستبدل الزجاجة التي انخفضت إلى النصف بزجاجة احتياطية نظيفة وممتلئة قبل وصول الضيف التالي. ويزداد الاستهلاك مع ارتفاع نسبة الإشغال، لذا راجع مخزونك من العبوات الكبيرة قبل موسم الذروة."),
      h2("المكاتب"),
      p("يرتبط استهلاك الصابون في المكاتب ارتباطًا مباشرًا بعدد الموظفين ومدى استخدام المطبخ."),
      ul(
        `${b("دورات المياه:")} موزّع ممتلئ أو زجاجة بمضخة عند كل مغسلة.`,
        `${b("مطبخ المكتب:")} زجاجة بمضخة من صابون اليدين السائل لغسل اليدين، منفصلة عن سائل غسل الأطباق.`,
        `${b("المغاسل القريبة من قاعات الاجتماعات وأماكن الزوار:")} زجاجة أنيقة ورائحة من اختيارك حيث يغسل الزوار أيديهم.`,
      ),
      p("إسناد مهمة التعبئة إلى شخص واحد أو إلى فريق التنظيف، والاحتفاظ بسجل للتعبئة، يمنعان شكاوى «نفد الصابون». وأعد قياس استهلاكك كلما تغيّر عدد الموظفين أو توسّع المكتب."),
      h2("المطاعم والمقاهي"),
      p("في المطاعم، مغسلة الضيوف والمطبخ عالمان منفصلان لكل منهما احتياجاته. افحص الزجاجة في مغسلة الضيوف قبل كل فترة خدمة، فالزجاجة التي تفرغ في مساء مزدحم لا تخفى على الضيوف."),
      ul(
        `${b("مغسلة الضيوف:")} هي جزء من مطعمك، فاختر زجاجة بمضخة تنسجم مع الديكور ورائحة مرحّبة.`,
        `${b("المطبخ ومناطق التحضير:")} يجب أن يكون الصابون جاهزًا في كل نقطة لغسل اليدين في جميع الأوقات. وعلى منشآت الأغذية أن تنظّم نقاط غسل اليدين وفق قواعد النظافة التي تخضع لها، وأن تحرص على أن يغسل العاملون أيديهم كثيرًا.`,
      ),
      p(`ولمشاركة خطوات غسل اليدين الصحيحة مع فريقك، يمكنك الاستعانة بـ${a(TO.handWashing, "دليلنا لغسل اليدين")}.`),
      h2("المدارس والنوادي الرياضية والأماكن المزدحمة الأخرى"),
      p("في الأماكن المزدحمة طوال اليوم، مثل المدارس ومراكز التدريب والنوادي الرياضية وصالونات تصفيف الشعر ومناطق التسوّق، تكون الأولوية للاستمرارية وسهولة التعبئة. وهنا يسهّل عليك اختيار رائحة واحدة واعتماد نظام تعبئة مركزي بعبوات 20 لترًا. استخدم جل الاستحمام في دشات النوادي الرياضية، وصابون اليدين السائل عند المغاسل."),
      h3("لا تنسَ مناطق الموظفين"),
      p("غرف تبديل الملابس ودورات مياه الموظفين والمغاسل خلف المطبخ تستحق العناية نفسها التي تحظى بها مناطق الضيوف. كما أن استخدام المنتجات نفسها في مناطق الموظفين يبسّط إدارة المخزون ويُظهر لفريقك مدى تقديرك له."),
      h2("أي حجم لأي مكان؟"),
      ul(
        `${b("الزجاجة بالمضخة:")} حمّامات الغرف ومغاسل الضيوف ومطابخ المكاتب.`,
        `${b("عبوة 5 لترات:")} المنشآت التي تضم عددًا قليلًا من المغاسل، أو التي تستخدم روائح مختلفة في أماكن مختلفة.`,
        `${b("عبوة 20 لترًا:")} المنشآت المزدحمة ذات المغاسل والدشات الكثيرة التي تعتمد رائحة واحدة.`,
      ),
      p(`لمعرفة طريقة حساب استهلاكك ونصائح التخزين، اطّلع على ${a(TO.canisters, "دليلنا لعبوات 5 لترات و20 لترًا")}.`),
      h2("اختيار الرائحة"),
      p(`اختر رائحة تناسب طابع منشأتك واستخدمها بثبات في جميع النقاط: ${a(TO.lavanta, "اللافندر")} لأجواء كلاسيكية تبعث على الطمأنينة، و${a(TO.lavantaLatte, "لاتيه اللافندر")} لاستقبال هادئ وناعم، و${a(TO.portakal, "البرتقال")} لطاقة حيوية دافئة، و${a(TO.okyanus, "جل الاستحمام «المحيط»")} المنعش للدشات. ولمزيد من الأفكار، اقرأ ${a(TO.scents, "دليلنا لاختيار الرائحة")}.`),
      h2("تفاصيل صغيرة لتجربة الضيوف"),
      ul(
        "امسح الزجاجات والموزّعات يوميًا بقطعة قماش مبللة حتى لا تبقى عليها آثار صابون أو بصمات أصابع.",
        "ضع الزجاجة بحيث يكون ملصقها مواجهًا للضيف.",
        "احتفظ بالمناديل الورقية أو منشفة اليدين بجانب الصابون مباشرةً.",
        "حافظ على جفاف سطح المغسلة، وامسح قطرات الصابون فورًا.",
        "استبدل الزجاجات التي أوشكت على النفاد قبل أن يلاحظ الضيوف ذلك.",
      ),
      h2("نظام التعبئة والمخزون"),
      ul(
        `لا تملأ الموزّعات إلا بعد أن تفرغ تمامًا وتُنظَّف وتُجفَّف، ولا تضف صابونًا فوق القديم (التفاصيل في ${a(TO.refilling, "دليل إعادة التعبئة")}).`,
        "احتفظ بزجاجات أو خزانات احتياطية.",
        "اكتب تاريخ الفتح على العبوات، واستخدمها خلال 12 شهرًا من فتحها.",
        "احفظ المنتجات بعيدًا عن الحرارة وأشعة الشمس وبعيدًا عن متناول الأطفال.",
        "خطّط لطلبك التالي قبل أن ينفد مخزونك.",
      ),
      h2("العمل مع PRESTİJ"),
      p(`يُصنع صابون اليدين السائل وجل الاستحمام «المحيط» من PRESTİJ في قيصري، ويتوفران في زجاجات بمضخة وعبوات 5 لترات و20 لترًا. ويمكنك عند إتمام الطلب اختيار إصدار الفاتورة باسم شركتك. وللمشتريات المنتظمة أو الكبيرة، أرسل احتياجك عبر ${a(TO.business, "صفحة عروض الأسعار للشركات")}، وسنعود إليك بأسعار خاصة بمنشأتك. وإن أردت تجربة الروائح في مكانك، فاطلب ${a(TO.samples, "عيّنات مجانية")}؛ ${SAMPLES_NOTE.ar}. ولأي استفسار، تواصل معنا عبر ${a(TO.contact, "صفحة الاتصال")}.`),
    ),
  },
};

// ---------------------------------------------------------------------------------------------------
// 7. Sıvı el sabunu nasıl seçilir? (targets "sıvı el sabunu seçimi"; the newest post, featured on /blog)

const CHOOSING: SeedBlogPost = {
  slug: "sivi-el-sabunu-nasil-secilir",
  publishedAt: "2026-11-06T09:30:00+03:00",
  cover: "PRESTIJ_Lavanta_Pompali_mermer_yivli_cam",
  related: ["lavanta-latte", "lavanta", "portakal"],
  tags: ["Sıvı el sabunu", "Seçim rehberi", "Temizlik"],
  title: {
    tr: "Sıvı El Sabunu Nasıl Seçilir?",
    en: "How to Choose a Liquid Hand Soap",
    ar: "كيف تختار صابون اليدين السائل؟",
  },
  excerpt: {
    tr: "Raflarda onlarca seçenek var; peki eviniz ya da işletmeniz için doğru sıvı el sabununu neye göre seçmelisiniz? Kullanım alanından kokuya, ambalajdan etiket bilgisine kadar pratik bir kontrol listesi.",
    en: "There are countless options on the shelf, so how do you pick the right liquid hand soap for your home or business? A practical checklist covering where you will use it, scent, packaging and what the label tells you.",
    ar: "الخيارات على الرفوف كثيرة، فكيف تختار صابون اليدين السائل المناسب لمنزلك أو منشأتك؟ قائمة عملية تشمل مكان الاستخدام والرائحة والعبوة وما يخبرك به الملصق.",
  },
  seo: {
    title: {
      tr: "Sıvı El Sabunu Nasıl Seçilir? Pratik Rehber",
      en: "How to Choose Liquid Hand Soap: A Practical Guide",
      ar: "كيف تختار صابون اليدين السائل؟ دليل عملي",
    },
    description: {
      tr: "Sıvı el sabunu seçerken nelere bakmalı? Kullanım alanı, koku, doku, ambalaj ve etiket bilgileri için pratik bir kontrol listesi ve öneriler.",
      en: "What should you look for in a liquid hand soap? A practical checklist on where it's used, scent, texture, packaging and what the label tells you.",
      ar: "ما الذي تبحث عنه عند اختيار صابون اليدين السائل؟ قائمة عملية تشمل مكان الاستخدام والرائحة والقوام والعبوة ومعلومات الملصق.",
    },
  },
  body: {
    tr: html(
      p("Sıvı el sabunu, gün içinde en sık elimize aldığımız ürünlerden biridir: yemek hazırlamadan önce, işten eve döndüğümüzde, misafir lavabosunda… Bu kadar sık kullanılan bir ürünü seçerken yalnızca şişenin görünüşüne bakmak yetmez. Aşağıdaki adımlar, eviniz ya da işletmeniz için doğru sıvı el sabununu seçmenize yardımcı olacak."),
      h2("1. Önce kullanım alanını düşünün"),
      p("Her alanın sabundan beklentisi farklıdır. Seçime başlamadan önce sabunu nerede kullanacağınızı netleştirin:"),
      ul(
        `${b("Ev banyosu:")} Ailenin her gün kullandığı lavabo için sevdiğiniz, yormayan bir koku ve elde bıraktığı yumuşak his öne çıkar.`,
        `${b("Misafir lavabosu:")} Burada sabun, evinizin ilk izlenimlerinden biridir; zarif bir pompalı şişe ve davetkâr bir koku iyi bir karşılama sunar.`,
        `${b("Mutfak:")} Gün içinde defalarca el yıkanan bu alanda kolay dozlanan bir pompalı şişe ve canlı, ferah bir koku pratik olur.`,
        `${b("Ofis, otel ve restoran:")} Yoğun kullanılan lavabolarda kesintisiz kullanım ve kolay dolum önemlidir; bu yüzden bidon seçenekleri devreye girer.`,
      ),
      h2("2. Etiketi okuyun: kullanım, uyarılar ve içerik"),
      p("İyi bir seçim, etiketi okumakla başlar. Bir sıvı el sabununun etiketinde şunları görmelisiniz:"),
      ul(
        `${b("Kullanım alanı ve şekli:")} Ürünün el temizliği için mi, vücut için mi hazırlandığı açıkça yazmalıdır. Her ürünü etiketindeki amaca göre kullanın.`,
        `${b("Uyarılar:")} Saklama koşulları ve dikkat edilmesi gerekenler. PRESTİJ sıvı el sabunlarının etiketinde, ürünün ısı ve direkt güneş ışığından uzakta, çocukların ulaşamayacağı bir yerde muhafaza edilmesi gerektiği yazar.`,
        `${b("İçindekiler:")} Kozmetik ürünlerde içerik listesi uluslararası adlarla (INCI) verilir. Belirli bir içeriğe karşı hassasiyetiniz varsa satın almadan önce bu listeye göz atın.`,
        `${b("Açıldıktan sonra kullanım süresi:")} Açık kavanoz simgesinin yanındaki “12M” gibi bir ifade, ürünün açıldıktan sonra kaç ay içinde kullanılması gerektiğini gösterir. PRESTİJ ürünlerinde bu süre 12 aydır.`,
        `${b("Üretici ve menşe bilgisi:")} Üreticinin unvanı, adresi ve iletişim bilgileri etikette yer almalıdır. PRESTİJ ürünleri Kayseri'de üretilir; menşei Türkiye'dir.`,
      ),
      h2("3. Kokuyu alana ve kullanıcıya göre seçin"),
      p("Koku, sıvı el sabunu seçiminin en kişisel kısmıdır. Küçük ve kapalı bir lavaboda yoğun bir koku kısa sürede baskın hâle gelebilir; geniş ve sık kullanılan alanlarda ise ferah bir koku daha dengeli durur. Birkaç pratik öneri:"),
      ul(
        `sakin ve klasik bir atmosfer için ${a(TO.lavanta, "Lavanta sıvı el sabunu")},`,
        `daha yumuşak ve sıcak bir yorum için ${a(TO.lavantaLatte, "Lavanta Latte")},`,
        `mutfak ve güneş alan alanlar için canlı narenciye karakteriyle ${a(TO.portakal, "Portakal")}.`,
      ),
      p(`Hangi kokunun hangi mekâna yakıştığını merak ediyorsanız ${a(TO.scents, "koku seçimi rehberimize")} göz atabilirsiniz.`),
      h2("4. Dokuya ve elde bıraktığı hisse dikkat edin"),
      p("Bir sıvı el sabununu iyi kılan şey yalnızca kokusu değildir. Kıvamı, köpürme şekli, ne kadar kolay durulandığı ve kuruladıktan sonra elinizde bıraktığı his, günlük kullanımda farkı yaratır. Çok sulu bir sabun pompadan hızla akar ve çabuk tükenir; çok koyu bir sabunu ise dozlamak zordur. Şişedeki iddiaları değil, ellerinizdeki hissi ölçü alın."),
      p("PRESTİJ sıvı el sabunlarının etiketinde dört özellik yer alır: etkili temizlik, cildi koruyan yapı, ferah koku ve yumuşak his. Bunları kendi ellerinizde denemenin en kolay yolu numune istemektir (aşağıda)."),
      h2("5. Ambalajı tüketiminize göre belirleyin"),
      p("Doğru ambalaj, hem kullanım kolaylığını hem de ne sıklıkla alışveriş yapacağınızı belirler."),
      h3("Pompalı şişe"),
      p("Lavabonun başında duran, tek elle kolayca dozlanan pompalı şişe günlük kullanım için idealdir. Güzel bir şişe, banyonun ya da mutfağın dekorunun da bir parçası olur."),
      h3("5 L ve 20 L bidon"),
      p(`Sabunu sık kullanıyorsanız ya da birden fazla lavabonuz varsa bidon mantıklı bir seçimdir. 5 L ve 20 L bidonlar; pompalı şişeleri, dispenserleri ve sabunlukları yeniden doldurmak için tasarlandı. Hangi boyun size uygun olduğunu ${a(TO.canisters, "5 L ve 20 L bidon rehberimizde")} ayrıntılı olarak anlattık.`),
      p("Bidon alırken açıldıktan sonraki kullanım süresini de hesaba katın: Açtığınız bir bidonu 12 ay içinde bitirebilecekseniz büyük boy işinizi görür; tüketiminiz düşükse 5 L daha doğru bir seçim olabilir."),
      h2("6. Şişeyi ve dispenseri de düşünün"),
      p(`Sabunun kendisi kadar onu sunduğunuz şişe de önemlidir. Şeffaf bir şişe, sabunun ne zaman biteceğini görmenizi kolaylaştırır. Cam şişeler ağırlığı ve görünümüyle şık durur; çocuklu evlerde ve kalabalık ortak alanlarda kırılmaz plastik şişeler daha pratik olabilir. Pompanın sağlam ve vidalı olması, şişeyi yeniden doldurmayı kolaylaştırır. Duvar dispenseri kullanacaksanız doldurulabilir hazneli bir model seçin; nasıl doldurulacağını ${a(TO.refilling, "dispenser doldurma rehberimizde")} anlattık.`),
      h2("7. Doğru kullanım: az ama yeterli"),
      p(`Seçtiğiniz sabundan verim almak için doğru kullanım da önemlidir. Etiketteki tarif basittir: Yeterli miktarda ürün ıslak ele alınır, ovalayarak köpürtülür ve su ile durulanır. Ellerinizi en az 20 saniye köpürterek ovmak, avuç içlerini, parmak aralarını ve tırnak diplerini atlamamak iyi bir alışkanlıktır. ${EYE_CAUTION.tr}`),
      p(`Adım adım anlatım için ${a(TO.handWashing, "doğru el yıkama rehberimizi")} okuyabilirsiniz.`),
      h2("8. Karar vermeden önce deneyin"),
      p(`Koku ve his ancak denenerek anlaşılır. Kendiniz için alışveriş yapıyorsanız sepetinize ücretsiz numune ekleyebilirsiniz. Otel, ofis ya da restoran gibi bir işletme için seçim yapıyorsanız ${a(TO.samples, "ücretsiz numune sayfamızdan")} talepte bulunabilirsiniz; ${SAMPLES_NOTE.tr}. Düzenli ve yüksek hacimli alımlar için ${a(TO.business, "kurumsal teklif")} isteyebilirsiniz.`),
      h2("Kısa kontrol listesi"),
      ul(
        "Sabunu nerede ve kimler kullanacak?",
        "Etiketinde kullanım alanı, uyarılar, içerik ve açıldıktan sonra kullanım süresi yazıyor mu?",
        "Koku, alanın büyüklüğüne ve kullanıcılara uygun mu?",
        "Kıvamı ve elde bıraktığı his hoşunuza gidiyor mu?",
        "Tüketiminize uygun ambalaj hangisi: pompalı şişe mi, 5 L mi, 20 L mi?",
      ),
      p(`Tüm seçenekleri ${a(TO.handSoap, "sıvı el sabunu")} kategorimizde bulabilirsiniz.`),
    ),
    en: html(
      p("Liquid hand soap is one of the products we reach for most often during the day: before cooking, when we get home from work, in the guest washroom… When something is used this often, choosing it by the look of the bottle alone is not enough. The steps below will help you choose the right liquid hand soap for your home or business."),
      h2("1. Start with where it will be used"),
      p("Every space expects something different from a soap. Before you choose, be clear about where it will be used:"),
      ul(
        `${b("Family bathroom:")} for a basin everyone uses every day, a scent you love that never feels tiring and a soft feel on the hands matter most.`,
        `${b("Guest washroom:")} here the soap is one of your home's first impressions; an elegant pump bottle and an inviting scent make a good welcome.`,
        `${b("Kitchen:")} hands are washed many times a day here, so an easy-to-dose pump bottle and a lively, fresh scent are practical.`,
        `${b("Offices, hotels and restaurants:")} busy washbasins need uninterrupted supply and easy refilling, which is where canisters come in.`,
      ),
      h2("2. Read the label: use, warnings and ingredients"),
      p("A good choice starts with reading the label. On a liquid hand soap label you should find:"),
      ul(
        `${b("Area and method of use:")} the label should state clearly whether the product is meant for the hands or the body. Use each product for the purpose on its label.`,
        `${b("Warnings:")} storage conditions and precautions. The labels of PRESTİJ liquid hand soaps state that the product should be stored away from heat and direct sunlight, out of the reach of children.`,
        `${b("Ingredients:")} cosmetic ingredient lists use international (INCI) names. If you are sensitive to a particular ingredient, check this list before you buy.`,
        `${b("Period after opening:")} a figure such as “12M” next to the open-jar symbol tells you how many months the product should be used within once opened. For PRESTİJ products this period is 12 months.`,
        `${b("Manufacturer and origin:")} the manufacturer's name, address and contact details should be on the label. PRESTİJ products are made in Kayseri; their origin is Türkiye.`,
      ),
      h2("3. Match the scent to the space and the people using it"),
      p("Scent is the most personal part of choosing a liquid hand soap. In a small, closed washroom an intense scent can quickly become overpowering, while in large, busy spaces a fresh scent feels more balanced. A few practical suggestions:"),
      ul(
        `for a calm, classic atmosphere, ${a(TO.lavanta, "Lavender liquid hand soap")},`,
        `for a softer, warmer interpretation, ${a(TO.lavantaLatte, "Lavender Latte")},`,
        `for kitchens and sunny spaces, ${a(TO.portakal, "Orange")}, with its lively citrus character.`,
      ),
      p(`If you are wondering which scent suits which room, take a look at our ${a(TO.scents, "guide to choosing a scent")}.`),
      h2("4. Pay attention to texture and how your hands feel"),
      p("A good liquid hand soap is about more than its scent. Its consistency, the way it lathers, how easily it rinses off and how your hands feel after drying are what make the difference day to day. A very runny soap flows out of the pump too quickly and runs out fast; a very thick one is hard to dose. Judge by how it feels on your hands rather than by the claims on the bottle."),
      p("The labels of PRESTİJ liquid hand soaps name four qualities: effective cleansing, care for the skin, a fresh scent and a soft feel. The easiest way to try them on your own hands is to ask for a sample (see below)."),
      h2("5. Choose the packaging that fits your consumption"),
      p("The right packaging determines both how convenient the soap is and how often you need to shop."),
      h3("Pump bottle"),
      p("Standing by the basin and easy to dose with one hand, the pump bottle is ideal for everyday use. A beautiful bottle also becomes part of the décor of your bathroom or kitchen."),
      h3("5 L and 20 L canisters"),
      p(`If you use a lot of soap or have more than one washbasin, a canister makes sense. The 5 L and 20 L canisters are designed for refilling pump bottles, dispensers and soap containers. We explain which size suits you in detail in our ${a(TO.canisters, "guide to 5 L and 20 L canisters")}.`),
      p("When buying a canister, also consider the period after opening: if you can finish an opened canister within 12 months, the large size will serve you well; if your consumption is low, 5 L may be the better choice."),
      h2("6. Think about the bottle and dispenser too"),
      p(`The bottle you serve the soap in matters as much as the soap itself. A clear bottle makes it easy to see when the soap is about to run out. Glass bottles look elegant with their weight and shine; in homes with children and busy shared spaces, shatterproof plastic bottles may be more practical. A sturdy, screw-on pump makes the bottle easy to refill. If you are going to use a wall dispenser, choose a model with a refillable reservoir; we explain how to refill it in our ${a(TO.refilling, "dispenser refilling guide")}.`),
      h2("7. Use it correctly: enough, not too much"),
      p(`Using your soap correctly helps you get the most out of it. The directions on the label are simple: apply a sufficient amount to wet hands, lather by rubbing and rinse with water. Rubbing your hands with lather for at least 20 seconds, without skipping your palms, the spaces between your fingers and under your nails, is a good habit. ${EYE_CAUTION.en}`),
      p(`For a step-by-step explanation, read our ${a(TO.handWashing, "guide to washing your hands properly")}.`),
      h2("8. Try before you decide"),
      p(`Scent and feel can only be judged by trying. If you are shopping for yourself, you can add a free sample to your cart. If you are choosing for a business such as a hotel, office or restaurant, you can request samples from our ${a(TO.samples, "free samples page")}; ${SAMPLES_NOTE.en}. For regular or high-volume purchases, you can ask for a ${a(TO.business, "business quote")}.`),
      h2("A quick checklist"),
      ul(
        "Where will the soap be used, and by whom?",
        "Does the label state the area of use, warnings, ingredients and period after opening?",
        "Does the scent suit the size of the space and the people using it?",
        "Do you like its consistency and the way your hands feel?",
        "Which packaging suits your consumption: pump bottle, 5 L or 20 L?",
      ),
      p(`You will find every option in our ${a(TO.handSoap, "liquid hand soap")} category.`),
    ),
    ar: html(
      p("صابون اليدين السائل من أكثر المنتجات التي نستخدمها خلال اليوم: قبل إعداد الطعام، وعند العودة من العمل، وفي مغسلة الضيوف… ومنتج يُستخدم بهذا القدر لا يكفي أن نختاره بناءً على شكل الزجاجة وحده. ستساعدك الخطوات التالية على اختيار صابون اليدين السائل المناسب لمنزلك أو منشأتك."),
      h2("1. ابدأ بمكان الاستخدام"),
      p("لكل مكان توقعات مختلفة من الصابون. قبل أن تختار، حدّد أين سيُستخدم:"),
      ul(
        `${b("حمّام العائلة:")} للمغسلة التي يستخدمها الجميع يوميًا، تأتي في المقدمة رائحة تحبها ولا تُتعب، وإحساس ناعم على اليدين.`,
        `${b("مغسلة الضيوف:")} هنا يصبح الصابون من أول ما يكوّن انطباع الضيوف عن منزلك؛ فزجاجة أنيقة بمضخة ورائحة مرحّبة تصنعان استقبالًا جميلًا.`,
        `${b("المطبخ:")} تُغسل اليدان هنا مرات كثيرة في اليوم، لذا تكون الزجاجة بالمضخة سهلة الجرعة والرائحة الحيوية المنعشة خيارًا عمليًا.`,
        `${b("المكاتب والفنادق والمطاعم:")} تحتاج المغاسل المزدحمة إلى توفّر دائم وإعادة تعبئة سهلة، وهنا يأتي دور العبوات الكبيرة.`,
      ),
      h2("2. اقرأ الملصق: الاستخدام والتحذيرات والمكوّنات"),
      p("الاختيار الجيد يبدأ بقراءة الملصق. على ملصق صابون اليدين السائل يجب أن تجد ما يلي:"),
      ul(
        `${b("مجال الاستخدام وطريقته:")} ينبغي أن يوضّح الملصق إن كان المنتج مخصّصًا لليدين أم للجسم. واستخدم كل منتج للغرض المذكور على ملصقه.`,
        `${b("التحذيرات:")} شروط الحفظ والاحتياطات. يذكر ملصق صابون اليدين السائل من PRESTİJ أن المنتج يُحفظ بعيدًا عن الحرارة وأشعة الشمس المباشرة وبعيدًا عن متناول الأطفال.`,
        `${b("المكوّنات:")} تُكتب قوائم مكوّنات مستحضرات التجميل بالأسماء الدولية (INCI). فإن كانت لديك حساسية تجاه مكوّن معيّن، فراجع هذه القائمة قبل الشراء.`,
        `${b("مدة الاستخدام بعد الفتح:")} عبارة مثل «12M» بجانب رمز العلبة المفتوحة تبيّن عدد الأشهر التي ينبغي استخدام المنتج خلالها بعد فتحه. وهذه المدة في منتجات PRESTİJ هي 12 شهرًا.`,
        `${b("الشركة المصنّعة وبلد المنشأ:")} يجب أن يحمل الملصق اسم الشركة المصنّعة وعنوانها وبيانات التواصل معها. تُصنع منتجات PRESTİJ في قيصري، وبلد منشئها تركيا.`,
      ),
      h2("3. اختر الرائحة بحسب المكان ومستخدميه"),
      p("الرائحة هي الجانب الأكثر شخصية في اختيار صابون اليدين السائل. ففي مغسلة صغيرة مغلقة قد تطغى الرائحة القوية سريعًا، بينما تبدو الرائحة المنعشة أكثر توازنًا في الأماكن الواسعة كثيرة الاستخدام. إليك بعض الاقتراحات العملية:"),
      ul(
        `لأجواء هادئة وكلاسيكية: ${a(TO.lavanta, "صابون اليدين السائل اللافندر")}،`,
        `لتفسير أنعم وأكثر دفئًا: ${a(TO.lavantaLatte, "لاتيه اللافندر")}،`,
        `للمطابخ والأماكن المشمسة: ${a(TO.portakal, "البرتقال")} بطابعه الحمضي الحيوي.`,
      ),
      p(`وإن كنت تتساءل أي رائحة تناسب أي مكان، فاطّلع على ${a(TO.scents, "دليلنا لاختيار الرائحة")}.`),
      h2("4. انتبه إلى القوام والإحساس الذي يتركه على اليدين"),
      p("لا تقتصر جودة صابون اليدين السائل على رائحته. فقوامه وطريقة تكوّن رغوته وسهولة شطفه والإحساس الذي يتركه على اليدين بعد التجفيف هي ما يصنع الفرق في الاستخدام اليومي. فالصابون شديد السيولة يتدفق من المضخة بسرعة وينفد سريعًا، أما الكثيف جدًا فيصعب أخذ الكمية المناسبة منه. احكم بما تشعر به يداك لا بما تقوله الزجاجة."),
      p("يذكر ملصق صابون اليدين السائل من PRESTİJ أربع خصائص: تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم. وأسهل طريقة لتجربتها بنفسك هي طلب عيّنة (انظر أدناه)."),
      h2("5. اختر العبوة التي تناسب استهلاكك"),
      p("العبوة المناسبة تحدّد مدى سهولة الاستخدام وعدد مرات التسوّق في آن واحد."),
      h3("الزجاجة بالمضخة"),
      p("الزجاجة بالمضخة التي تقف بجانب المغسلة ويسهل أخذ الكمية منها بيد واحدة مثالية للاستخدام اليومي. والزجاجة الجميلة تصبح أيضًا جزءًا من ديكور الحمّام أو المطبخ."),
      h3("عبوات 5 لترات و20 لترًا"),
      p(`إن كنت تستخدم الصابون كثيرًا أو لديك أكثر من مغسلة، فالعبوة الكبيرة خيار منطقي. صُمّمت عبوات 5 لترات و20 لترًا لإعادة تعبئة الزجاجات بالمضخة والموزّعات وحاويات الصابون. وقد شرحنا بالتفصيل أي حجم يناسبك في ${a(TO.canisters, "دليلنا لعبوات 5 لترات و20 لترًا")}.`),
      p("وعند شراء عبوة كبيرة، خذ في الحسبان مدة الاستخدام بعد الفتح: إن كنت تستطيع إنهاء العبوة المفتوحة خلال 12 شهرًا فالحجم الكبير يفي بالغرض، أما إن كان استهلاكك منخفضًا فقد تكون عبوة 5 لترات الخيار الأنسب."),
      h2("6. فكّر في الزجاجة والموزّع أيضًا"),
      p(`الزجاجة التي تقدّم فيها الصابون لا تقل أهمية عن الصابون نفسه. فالزجاجة الشفافة تسهّل عليك رؤية الوقت الذي يقترب فيه الصابون من النفاد. والزجاجات المصنوعة من الزجاج تبدو أنيقة بثقلها ولمعانها، أما في المنازل التي فيها أطفال والأماكن المشتركة المزدحمة فقد تكون الزجاجات البلاستيكية غير القابلة للكسر أكثر عملية. والمضخة المتينة الملولبة تسهّل إعادة تعبئة الزجاجة. وإن كنت ستستخدم موزّعًا جداريًا، فاختر طرازًا بخزان قابل لإعادة التعبئة؛ وقد شرحنا طريقة تعبئته في ${a(TO.refilling, "دليل إعادة تعبئة الموزّعات")}.`),
      h2("7. استخدمه بالطريقة الصحيحة: كمية كافية دون إسراف"),
      p(`الاستخدام الصحيح يساعدك على الاستفادة من الصابون الذي اخترته. وتعليمات الملصق بسيطة: توضع كمية كافية من المنتج على اليدين المبللتين وتُفرك حتى تتكوّن الرغوة، ثم تُشطف بالماء. ومن العادات الجيدة أن تفرك يديك بالرغوة لمدة 20 ثانية على الأقل دون أن تُغفل راحتي اليدين وما بين الأصابع وما تحت الأظافر. ${EYE_CAUTION.ar}`),
      p(`وللشرح خطوة بخطوة، اقرأ ${a(TO.handWashing, "دليلنا لغسل اليدين بالطريقة الصحيحة")}.`),
      h2("8. جرّب قبل أن تقرّر"),
      p(`لا يمكن الحكم على الرائحة والإحساس إلا بالتجربة. فإن كنت تتسوّق لنفسك، يمكنك إضافة عيّنة مجانية إلى سلّتك. وإن كنت تختار لمنشأة مثل فندق أو مكتب أو مطعم، فيمكنك طلب العيّنات من ${a(TO.samples, "صفحة العيّنات المجانية")}؛ ${SAMPLES_NOTE.ar}. وللمشتريات المنتظمة أو الكبيرة، يمكنك طلب ${a(TO.business, "عرض سعر للشركات")}.`),
      h2("قائمة تحقّق سريعة"),
      ul(
        "أين سيُستخدم الصابون، ومن سيستخدمه؟",
        "هل يذكر الملصق مجال الاستخدام والتحذيرات والمكوّنات ومدة الاستخدام بعد الفتح؟",
        "هل تناسب الرائحة مساحة المكان ومستخدميه؟",
        "هل يعجبك قوامه والإحساس الذي يتركه على يديك؟",
        "أي عبوة تناسب استهلاكك: الزجاجة بالمضخة أم عبوة 5 لترات أم 20 لترًا؟",
      ),
      p(`ستجد جميع الخيارات في فئة ${a(TO.handSoap, "صابون اليدين السائل")}.`),
    ),
  },
};

// ---------------------------------------------------------------------------------------------------
// Corrections after the first run (day-5 review/FIX, 2026-11-11; round 2: the verification after it)
//
// content-day5.ts wrote the posts above to the live database before these corrections. The blogPosts step
// brings an existing post up to date only while its body is still exactly a version it wrote earlier (the
// current body with the later correction rounds undone, scripts/seed-data/content-fixes.ts); a post the
// client edited is reported and left alone. A fresh database simply gets the corrected bodies.

/** "Rengi de hesaba katın": a section giving the colour of the liquid soap per scent, which no source supports (removed). */
const REMOVED_SOAP_COLOUR: FullText = {
  tr: html(
    h2("Rengi de hesaba katın"),
    p("Şeffaf bir şişede sıvı sabunun rengi de dekorun bir parçası olur. PRESTİJ kokularının renkleri karakterlerini yansıtır: Lavanta'da mor, Lavanta Latte'de fildişi, Portakal'da amber ve turuncu, Okyanus'ta mavi tonlar. Beyaz ve mermer banyolarda her renk öne çıkar; koyu taş lavabolarda fildişi ve amber sıcak bir kontrast yaratır; mavi ve beyaz tonlu banyolarda Okyanus bütünlük sağlar."),
  ),
  en: html(
    h2("Consider the colour too"),
    p("In a clear bottle, the colour of the liquid soap becomes part of the décor as well. The colours of the PRESTİJ scents reflect their characters: purple for Lavender, ivory for Lavender Latte, amber and orange for Orange and shades of blue for Ocean. In white and marble bathrooms every colour stands out; at dark stone basins, ivory and amber create a warm contrast; in blue and white bathrooms, Ocean ties everything together."),
  ),
  ar: html(
    h2("خذ اللون في الحسبان أيضًا"),
    p("في الزجاجة الشفافة يصبح لون الصابون السائل جزءًا من الديكور أيضًا. وتعكس ألوان روائح PRESTİJ شخصياتها: البنفسجي للافندر، والعاجي للاتيه اللافندر، والكهرماني والبرتقالي للبرتقال، ودرجات الأزرق للمحيط. في الحمّامات البيضاء والرخامية يبرز كل لون؛ وعند المغاسل الحجرية الداكنة يصنع العاجي والكهرماني تباينًا دافئًا؛ أما في الحمّامات ذات الدرجات الزرقاء والبيضاء فيمنح المحيط انسجامًا تامًا."),
  ),
};

/** Body corrections per post slug (before = as first written, after = the text above). */
export const BLOG_BODY_FIXES: Readonly<Record<string, LocaleFixes>> = {
  "dogru-el-yikama-adimlari": {
    tr: [{ before: "Evde ve işyerinde el temizliğini", after: "Evde ve iş yerinde el temizliğini" }],
  },
  "dus-jeli-mi-kati-sabun-mu": {
    tr: [
      { before: "süngere ya da lifeye alınarak", after: "süngere ya da life alınarak" },
      { before: "bir sünger ya da life köpüğü", after: "bir sünger ya da lif köpüğü" },
      { before: "bir süngere ya da lifeye alın.", after: "bir süngere ya da life alın." },
      { before: "Sünger ya da life kullanmak", after: "Sünger ya da lif kullanmak" },
    ],
  },
  "koku-secimi-lavanta-portakal-okyanus": {
    tr: [
      { before: REMOVED_SOAP_COLOUR.tr + h2("Koku seçerken dikkat edilecekler"), after: h2("Koku seçerken dikkat edilecekler") },
      {
        before: `Diğer seçenekleri ${a(TO.giftSets, "sabun hediye setleri")} arasında bulabilirsiniz.`,
        after: `Seti ${a(TO.giftSets, "sabun hediye setleri")} sayfamızda da bulabilirsiniz.`,
      },
      // Keeps the article at its length after the colour section went (contract: 700+ Turkish words).
      { before: "nasıl hissedildiğini gözlemleyin. Kararı mümkünse", after: "nasıl hissedildiğini gözlemleyin. Birden fazla kokuyu deneyecekseniz aralarda birkaç dakika ara verin; burun kısa sürede kokuya alışır ve ardından gelen kokuyu olduğundan daha hafif algılayabilir. Kararı mümkünse" },
    ],
    en: [
      { before: REMOVED_SOAP_COLOUR.en + h2("What to keep in mind when choosing a scent"), after: h2("What to keep in mind when choosing a scent") },
      {
        before: `You will find other options among our ${a(TO.giftSets, "soap gift sets")}.`,
        after: `You will also find it on our ${a(TO.giftSets, "soap gift sets")} page.`,
      },
      // Keeps the article at its length after the colour section went (contract: 700+ Turkish words).
      { before: "how it feels in the space around the basin. If you can,", after: "how it feels in the space around the basin. If you are testing more than one scent, leave a few minutes between them: the nose quickly gets used to a scent and may find the next one fainter than it is. If you can," },
    ],
    ar: [
      { before: REMOVED_SOAP_COLOUR.ar + h2("ما الذي ينبغي مراعاته عند اختيار الرائحة؟"), after: h2("ما الذي ينبغي مراعاته عند اختيار الرائحة؟") },
      {
        before: `وستجد خيارات أخرى ضمن ${a(TO.giftSets, "أطقم هدايا الصابون")}.`,
        after: `وستجدها أيضًا في صفحة ${a(TO.giftSets, "أطقم هدايا الصابون")}.`,
      },
      // Keeps the article at its length after the colour section went (contract: 700+ Turkish words).
      { before: "وكيف تبدو في المكان المحيط بالمغسلة. واتخذ قرارك", after: "وكيف تبدو في المكان المحيط بالمغسلة. وإن كنت ستجرّب أكثر من رائحة، فاترك بضع دقائق بين كل تجربة وأخرى؛ فالأنف يعتاد الرائحة سريعًا وقد يجد الرائحة التالية أخفّ مما هي عليه. واتخذ قرارك" },
    ],
  },
  "sivi-sabun-dispenseri-nasil-doldurulur": {
    tr: [
      {
        before: `tüm seçenekleri ${a(TO.handSoap, "sıvı el sabunu")} kategorisinde görebilirsiniz.`,
        after: `tüm seçenekleri ${a(TO.handSoap, "sıvı el sabunu")} ve ${a(TO.showerGel, "duş jeli")} kategorilerinde görebilirsiniz.`,
      },
    ],
    en: [
      {
        before: `and see every option in the ${a(TO.handSoap, "liquid hand soap")} category.`,
        after: `and see every option in the ${a(TO.handSoap, "liquid hand soap")} and ${a(TO.showerGel, "shower gel")} categories.`,
      },
    ],
    ar: [
      {
        before: `وشاهد جميع الخيارات في فئة ${a(TO.handSoap, "صابون اليدين السائل")}.`,
        after: `وشاهد جميع الخيارات في فئتي ${a(TO.handSoap, "صابون اليدين السائل")} و${a(TO.showerGel, "جل الاستحمام")}.`,
      },
    ],
  },
  // Round 2 (day-5 verification): nothing says the labels carry a production date or serial number, so the
  // stock tip no longer claims it (a tip that makes no claim about the label instead).
  "5-litre-20-litre-sivi-sabun-rehberi": {
    tr: [
      {
        round: 2,
        before: "Üretim tarihi ve seri numarası ambalajın üzerindedir; stok sayımlarında bu bilgiden yararlanabilirsiniz.",
        after: "Stok sayımında açılmamış bidonları ayrı sayın; yeniden sipariş zamanını böylece kolayca görürsünüz.",
      },
    ],
    en: [
      {
        round: 2,
        before: "The production date and serial number are printed on the packaging; you can use them in stock counts.",
        after: "In stock counts, count unopened canisters separately; that way you can easily see when to reorder.",
      },
    ],
    ar: [
      {
        round: 2,
        before: "تاريخ الإنتاج والرقم التسلسلي مطبوعان على العبوة، ويمكنك الاستفادة منهما عند جرد المخزون.",
        after: "عند جرد المخزون، احسب العبوات غير المفتوحة على حدة، فترى بسهولة متى تحتاج إلى طلب جديد.",
      },
    ],
  },
  "sivi-el-sabunu-nasil-secilir": {
    tr: [{ before: "etkili temizlik, cildi koruyan, ferah koku", after: "etkili temizlik, cildi koruyan yapı, ferah koku" }],
    en: [{ before: "effective cleansing, skin-caring, fresh scent and soft feel.", after: "effective cleansing, care for the skin, a fresh scent and a soft feel." }],
    ar: [{ before: "تنظيف فعّال، ويحمي البشرة، ورائحة منعشة، وملمس ناعم. وأسهل", after: "تنظيف فعّال، وحماية للبشرة، ورائحة منعشة، وملمس ناعم. وأسهل" }],
  },
};

/** The post's body as content-day5.ts first wrote it (the current body when it has no corrections). */
export function firstWrittenBody(post: SeedBlogPost): FullText {
  return undoLocalizedFixes(post.body, BLOG_BODY_FIXES[post.slug]);
}

/**
 * Every body content-day5.ts wrote for the post before the current one (the version before each
 * correction round, newest first; the first written body last). Empty when the body was never corrected.
 */
export function earlierBodies(post: SeedBlogPost): FullText[] {
  return earlierVersions(post.body, [{ path: [], fixes: BLOG_BODY_FIXES[post.slug] }]);
}

// ---------------------------------------------------------------------------------------------------
// The list (chronological: ids follow the publish dates; the blog lists the newest first)

export const BLOG_POSTS: readonly SeedBlogPost[] = [HAND_WASHING, SHOWER_GEL_VS_BAR, SCENTS, REFILLING, CANISTERS, BUSINESSES, CHOOSING];

// ---------------------------------------------------------------------------------------------------
// Rows

/** Media ids by file stem and product ids by slug, used to resolve `cover` and `related`. */
export type BlogRefs = { media: ReadonlyMap<string, number>; products: ReadonlyMap<string, number> };

/** The blog_posts insert values, shaped like the panel's save (saveBlogPost). */
export type BlogPostValues = typeof blogPosts.$inferInsert;

/**
 * The row for one seed post: cover and related products resolved through `refs`, reading minutes from
 * the Turkish body (as the panel computes them), status published, author PRESTİJ. `missing` lists the
 * references that could not be resolved (the row is still built: no cover / fewer related products).
 */
export function blogPostRow(post: SeedBlogPost, refs: BlogRefs): { values: BlogPostValues; missing: string[] } {
  const missing: string[] = [];
  const coverId = refs.media.get(post.cover) ?? null;
  if (coverId === null) missing.push(`cover "${post.cover}" not found in the media library, inserted without a cover`);
  const related: number[] = [];
  for (const slug of post.related) {
    const id = refs.products.get(slug);
    if (id === undefined) missing.push(`related product "${slug}" not found (or not active), left out`);
    else if (!related.includes(id)) related.push(id);
  }
  return {
    values: {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      body: post.body,
      coverId,
      authorName: BLOG_AUTHOR,
      tags: post.tags.length > 0 ? [...post.tags] : null,
      relatedProductIds: related.length > 0 ? related : null,
      status: "published",
      publishedAt: new Date(post.publishedAt),
      seo: { title: post.seo.title, description: post.seo.description },
      readingMinutes: readingMinutes(post.body.tr),
    },
    missing,
  };
}

/** "urunler/lavanta/PRESTIJ_Lavanta_5L_mermer_banyo-1024.webp" → "PRESTIJ_Lavanta_5L_mermer_banyo". */
export function mediaStem(storageKey: string): string {
  const file = storageKey.split("/").pop() ?? storageKey;
  return file.replace(/\.[^.]+$/, "").replace(/-\d+$/, "");
}

/** The references the posts need, read from an existing database (the lowest id wins for a stem). */
export async function loadBlogRefs(db: ScriptDb): Promise<BlogRefs> {
  const stems = new Set(BLOG_POSTS.map((post) => post.cover));
  const slugs = [...new Set(BLOG_POSTS.flatMap((post) => post.related))];
  const mediaRows = await db.select({ id: media.id, storageKey: media.storageKey }).from(media).where(like(media.storageKey, "urunler/%")).orderBy(media.id);
  const mediaIds = new Map<string, number>();
  for (const row of mediaRows) {
    const stem = mediaStem(row.storageKey);
    if (stems.has(stem) && !mediaIds.has(stem)) mediaIds.set(stem, row.id);
  }
  const productRows = slugs.length
    ? await db
        .select({ id: products.id, slug: products.slug })
        .from(products)
        .where(and(inArray(products.slug, slugs), inArray(products.status, ["active"]), inArray(products.type, ["standard", "bundle"])))
    : [];
  return { media: mediaIds, products: new Map(productRows.map((row) => [row.slug, row.id])) };
}

/** Ids of the posts (any status) that already use one of the seed slugs: slug → id. */
export async function existingBlogPostIds(db: ScriptDb): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: blogPosts.id, slug: blogPosts.slug })
    .from(blogPosts)
    .where(inArray(blogPosts.slug, BLOG_POSTS.map((post) => post.slug)));
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/** Inserts one row; returns its id. */
export async function insertBlogPost(db: ScriptDb, values: BlogPostValues): Promise<number> {
  const [row] = await db.insert(blogPosts).values(values).returning({ id: blogPosts.id });
  return row.id;
}

/**
 * Fresh database (scripts/seed.ts): inserts every post. Strict like the rest of the seed: an unknown
 * cover or product reference throws instead of inserting an incomplete post. Returns the number inserted.
 */
export async function seedBlogPosts(db: ScriptDb, refs: BlogRefs): Promise<number> {
  const rows = BLOG_POSTS.map((post) => ({ post, ...blogPostRow(post, refs) }));
  const missing = rows.flatMap((row) => row.missing.map((m) => `/blog/${row.post.slug}: ${m}`));
  if (missing.length) throw new Error(`Blog seed references unknown ids:\n  ${missing.join("\n  ")}`);
  for (const row of rows) await insertBlogPost(db, row.values);
  return rows.length;
}
