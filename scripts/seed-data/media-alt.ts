// Alt text for imported product photos.
// Day 5 (CONTENT-CATALOG): every final image has a written description in MEDIA_ALT (product + type +
// packaging + what the photo shows, in natural tr/en/ar, written after looking at each image).
// legacyAltFor is the day-1 generator (the client's Turkish scene description plus English and Arabic
// built from the file name); it stays the fallback for an image that has no entry, and its output for the
// current images is kept in media-alt-day1.ts as the previous seeded default.
import type { LocalizedText } from "@/db/schema/common";
import type { ImageRow, Urun } from "./image-list";
import { BUNDLE, SCENTS, packOf, type PackKey } from "./products";

const t = (tr: string, en: string, ar: string): LocalizedText => ({ tr, en, ar });

/** Day-5 alt texts by media stem (the file name without extension, as in "@media:<stem>"). */
export const MEDIA_ALT: Record<string, LocalizedText> = {
  // Lavanta Latte: pump bottles
  PRESTIJ_Lavanta_Latte_Pompali_beyaz_mermer_yivli_cam: t(
    "Lavanta Latte sıvı el sabunu, beyaz mermer banyoda yivli cam pompalı şişe",
    "Lavender Latte liquid hand soap in a fluted glass pump bottle in a white marble bathroom",
    "صابون لاتيه اللافندر السائل لليدين في زجاجة مضلّعة بمضخة في حمّام من الرخام الأبيض",
  ),
  PRESTIJ_Lavanta_Latte_Pompali_spa_buzlu_cam: t(
    "Lavanta Latte sıvı el sabunu, traverten lavabonun yanında buzlu cam pompalı şişe",
    "Lavender Latte liquid hand soap in a frosted glass pump bottle beside a travertine basin",
    "صابون لاتيه اللافندر السائل لليدين في زجاجة مصنفرة بمضخة بجوار مغسلة من الترافرتين",
  ),
  PRESTIJ_Lavanta_Latte_Pompali_otel_fume_cam: t(
    "Lavanta Latte sıvı el sabunu, lüks otel lavabosunda füme köşeli cam pompalı şişe",
    "Lavender Latte liquid hand soap in a smoked square glass pump bottle at a luxury hotel basin",
    "صابون لاتيه اللافندر السائل لليدين في زجاجة مربّعة مدخّنة بمضخة على مغسلة فندق فاخر",
  ),
  PRESTIJ_Lavanta_Latte_Pompali_spa_amber_cam: t(
    "Lavanta Latte sıvı el sabunu, doğal spa ortamında amber cam pompalı şişe",
    "Lavender Latte liquid hand soap in an amber glass pump bottle in a natural spa setting",
    "صابون لاتيه اللافندر السائل لليدين في زجاجة كهرمانية بمضخة في أجواء سبا طبيعية",
  ),
  PRESTIJ_Lavanta_Latte_Pompali_kullanim_lila_buzlu_cam: t(
    "Lavanta Latte sıvı el sabunu, modern lavaboda lila buzlu cam pompalı şişeden avuca alınırken",
    "A hand pumping Lavender Latte liquid hand soap from a lilac frosted glass bottle at a modern basin",
    "يد تضغط مضخة زجاجة ليلكية مصنفرة من صابون لاتيه اللافندر السائل لليدين عند مغسلة عصرية",
  ),
  PRESTIJ_Lavanta_Latte_Pompali_mutfak_seramik: t(
    "Lavanta Latte sıvı el sabunu, aydınlık mutfakta fildişi seramik pompalı şişe",
    "Lavender Latte liquid hand soap in an ivory ceramic pump bottle in a bright kitchen",
    "صابون لاتيه اللافندر السائل لليدين في زجاجة سيراميك عاجية بمضخة في مطبخ مضيء",
  ),
  PRESTIJ_Lavanta_Latte_Pompali_studyo_fasetli_cam: t(
    "Lavanta Latte sıvı el sabunu, stüdyoda fasetli cam pompalı şişe",
    "Lavender Latte liquid hand soap in a faceted glass pump bottle, studio shot",
    "صابون لاتيه اللافندر السائل لليدين في زجاجة مشطوفة بمضخة، لقطة استوديو",
  ),
  // Lavanta Latte: canisters
  PRESTIJ_Lavanta_Latte_5L_inci_sampanya_studyo: t(
    "Lavanta Latte sıvı el sabunu 5 L bidon, inci ve şampanya tonlarında stüdyo çekimi",
    "Lavender Latte liquid hand soap in a 5 L canister, studio shot in pearl and champagne tones",
    "صابون لاتيه اللافندر السائل لليدين في عبوة 5 لترات، لقطة استوديو بدرجات اللؤلؤ والشمبانيا",
  ),
  PRESTIJ_Lavanta_Latte_5L_traverten_spa: t(
    "Lavanta Latte sıvı el sabunu 5 L bidon, traverten spa ortamında",
    "Lavender Latte liquid hand soap in a 5 L canister in a travertine spa",
    "صابون لاتيه اللافندر السائل لليدين في عبوة 5 لترات في سبا من الترافرتين",
  ),
  PRESTIJ_Lavanta_Latte_5L_ustten_cekim: t(
    "Lavanta Latte sıvı el sabunu 5 L bidon, taş ve keten üzerinde üstten çekim",
    "Lavender Latte liquid hand soap in a 5 L canister, top view on stone and linen",
    "صابون لاتيه اللافندر السائل لليدين في عبوة 5 لترات، لقطة علوية على الحجر والكتان",
  ),
  PRESTIJ_Lavanta_Latte_20L_yatay_etiket_oniks: t(
    "Lavanta Latte sıvı el sabunu 20 L bidon, krem oniks üzerinde yatay etiketli",
    "Lavender Latte liquid hand soap in a 20 L canister with a landscape label on cream onyx",
    "صابون لاتيه اللافندر السائل لليدين في عبوة 20 لترًا بملصق أفقي على أونيكس كريمي",
  ),
  PRESTIJ_Lavanta_Latte_5L_spa_servis_arabasi: t(
    "Lavanta Latte sıvı el sabunu 5 L bidon, lüks spa servis arabasında",
    "Lavender Latte liquid hand soap in a 5 L canister on a luxury spa service trolley",
    "صابون لاتيه اللافندر السائل لليدين في عبوة 5 لترات على عربة خدمة في سبا فاخر",
  ),
  PRESTIJ_Lavanta_Latte_20L_Grafik_sedef_lavanta_grafik: t(
    "Lavanta Latte sıvı el sabunu 20 L bidon, lavanta dalları ve sedefli dokulu büyük etiket tasarımı",
    "Lavender Latte liquid hand soap 20 L canister with a full label of lavender sprigs and pearly swirls",
    "عبوة 20 لترًا من صابون لاتيه اللافندر السائل لليدين بملصق كبير لأغصان اللافندر وتموّجات لؤلؤية",
  ),
  // Lavanta: pump bottles
  PRESTIJ_Lavanta_Pompali_mermer_yivli_cam: t(
    "Lavanta sıvı el sabunu, aydınlık mermer banyoda yivli cam pompalı şişe",
    "Lavender liquid hand soap in a fluted glass pump bottle in a bright marble bathroom",
    "صابون اللافندر السائل لليدين في زجاجة مضلّعة بمضخة في حمّام رخامي مضيء",
  ),
  PRESTIJ_Lavanta_Pompali_otel_fume_cam: t(
    "Lavanta sıvı el sabunu, lüks otelde füme köşeli mor cam pompalı şişe",
    "Lavender liquid hand soap in a smoked purple square glass pump bottle in a luxury hotel",
    "صابون اللافندر السائل لليدين في زجاجة مربّعة بنفسجية مدخّنة بمضخة في فندق فاخر",
  ),
  PRESTIJ_Lavanta_Pompali_spa_mat_ametist: t(
    "Lavanta sıvı el sabunu, doğal spa ortamında mat ametist pompalı şişe",
    "Lavender liquid hand soap in a matte amethyst pump bottle in a natural spa setting",
    "صابون اللافندر السائل لليدين في زجاجة بلون الجمشت غير اللامع بمضخة في أجواء سبا طبيعية",
  ),
  PRESTIJ_Lavanta_Pompali_kullanim_buzlu_lila: t(
    "Lavanta sıvı el sabunu, modern lavaboda buzlu lila pompalı şişeden avuca alınırken",
    "A hand pumping Lavender liquid hand soap from a frosted lilac bottle at a modern basin",
    "يد تضغط مضخة زجاجة ليلكية مصنفرة من صابون اللافندر السائل لليدين عند مغسلة عصرية",
  ),
  PRESTIJ_Lavanta_Pompali_mutfak_seramik: t(
    "Lavanta sıvı el sabunu, modern mutfakta fildişi seramik pompalı şişe",
    "Lavender liquid hand soap in an ivory ceramic pump bottle in a modern kitchen",
    "صابون اللافندر السائل لليدين في زجاجة سيراميك عاجية بمضخة في مطبخ عصري",
  ),
  PRESTIJ_Lavanta_Pompali_studyo_fasetli_cam: t(
    "Lavanta sıvı el sabunu, lila stüdyoda fasetli cam pompalı şişe",
    "Lavender liquid hand soap in a faceted glass pump bottle, lilac studio shot",
    "صابون اللافندر السائل لليدين في زجاجة مشطوفة بمضخة، لقطة استوديو بخلفية ليلكية",
  ),
  // Lavanta: canisters
  PRESTIJ_Lavanta_5L_ametist_altin_studyo: t(
    "Lavanta sıvı el sabunu 5 L bidon, ametist ve altın tonlarında stüdyo çekimi",
    "Lavender liquid hand soap in a 5 L canister, studio shot in amethyst and gold",
    "صابون اللافندر السائل لليدين في عبوة 5 لترات، لقطة استوديو بدرجات الجمشت والذهبي",
  ),
  PRESTIJ_Lavanta_5L_mermer_banyo: t(
    "Lavanta sıvı el sabunu 5 L bidon, mermer banyoda",
    "Lavender liquid hand soap in a 5 L canister in a marble bathroom",
    "صابون اللافندر السائل لليدين في عبوة 5 لترات في حمّام رخامي",
  ),
  PRESTIJ_Lavanta_5L_butik_otel_aksam: t(
    "Lavanta sıvı el sabunu 5 L bidon, butik otel banyosunda akşam ışığında",
    "Lavender liquid hand soap in a 5 L canister in a boutique hotel bathroom at dusk",
    "صابون اللافندر السائل لليدين في عبوة 5 لترات في حمّام فندق بوتيكي عند المساء",
  ),
  PRESTIJ_Lavanta_20L_yatay_etiket_ametist: t(
    "Lavanta sıvı el sabunu 20 L bidon, ametist ve altın tonlarında yatay etiketli",
    "Lavender liquid hand soap in a 20 L canister with a landscape label in amethyst and gold",
    "صابون اللافندر السائل لليدين في عبوة 20 لترًا بملصق أفقي بدرجات الجمشت والذهبي",
  ),
  PRESTIJ_Lavanta_5L_sabunluga_dolum_son: t(
    "Lavanta sıvı el sabunu 5 L bidondan huni ile pompalı şişeye dolum",
    "Refilling a pump bottle with Lavender liquid hand soap from a 5 L canister through a funnel",
    "إعادة تعبئة زجاجة بمضخة بصابون اللافندر السائل لليدين من عبوة 5 لترات باستخدام قمع",
  ),
  PRESTIJ_Lavanta_20L_Grafik_buyuk_lavanta_gorselleri: t(
    "Lavanta sıvı el sabunu 20 L bidon, büyük lavanta çiçekleri ve PRESTİJ logolu etiket tasarımı",
    "Lavender liquid hand soap 20 L canister with a full label of lavender flowers and the PRESTİJ logo",
    "عبوة 20 لترًا من صابون اللافندر السائل لليدين بملصق كبير لزهور اللافندر وشعار PRESTİJ",
  ),
  // Portakal: pump bottles
  PRESTIJ_Portakal_Pompali_mermer_yivli_cam: t(
    "Portakal sıvı el sabunu, güneşli mermer banyoda yivli cam pompalı şişe",
    "Orange liquid hand soap in a fluted glass pump bottle in a sunlit marble bathroom",
    "صابون البرتقال السائل لليدين في زجاجة مضلّعة بمضخة في حمّام رخامي مشمس",
  ),
  PRESTIJ_Portakal_Pompali_otel_amber_koseli: t(
    "Portakal sıvı el sabunu, lüks otelde amber köşeli cam pompalı şişe",
    "Orange liquid hand soap in an amber square glass pump bottle in a luxury hotel",
    "صابون البرتقال السائل لليدين في زجاجة مربّعة كهرمانية بمضخة في فندق فاخر",
  ),
  PRESTIJ_Portakal_Pompali_spa_amber_cam: t(
    "Portakal sıvı el sabunu, doğal spa ortamında amber cam pompalı şişe",
    "Orange liquid hand soap in an amber glass pump bottle in a natural spa setting",
    "صابون البرتقال السائل لليدين في زجاجة كهرمانية بمضخة في أجواء سبا طبيعية",
  ),
  PRESTIJ_Portakal_Pompali_mutfak_krem_seramik: t(
    "Portakal sıvı el sabunu, modern mutfakta krem seramik pompalı şişe",
    "Orange liquid hand soap in a cream ceramic pump bottle in a modern kitchen",
    "صابون البرتقال السائل لليدين في زجاجة سيراميك كريمية بمضخة في مطبخ عصري",
  ),
  PRESTIJ_Portakal_Pompali_kullanim_buzlu_amber: t(
    "Portakal sıvı el sabunu, modern lavaboda buzlu amber pompalı şişeden avuca alınırken",
    "A hand pumping Orange liquid hand soap from a frosted amber bottle at a modern basin",
    "يد تضغط مضخة زجاجة كهرمانية مصنفرة من صابون البرتقال السائل لليدين عند مغسلة عصرية",
  ),
  PRESTIJ_Portakal_Pompali_studyo_fasetli_cam: t(
    "Portakal sıvı el sabunu, sıcak tonlu stüdyoda fasetli cam pompalı şişe",
    "Orange liquid hand soap in a faceted glass pump bottle, warm-toned studio shot",
    "صابون البرتقال السائل لليدين في زجاجة مشطوفة بمضخة، لقطة استوديو بدرجات دافئة",
  ),
  // Portakal: canisters
  PRESTIJ_Portakal_5L_sicak_spa: t(
    "Portakal sıvı el sabunu 5 L bidon, sıcak tonlu spa ortamında",
    "Orange liquid hand soap in a 5 L canister in a warm-toned spa",
    "صابون البرتقال السائل لليدين في عبوة 5 لترات في أجواء سبا دافئة",
  ),
  PRESTIJ_Portakal_5L_amber_gunisigi_studyo: t(
    "Portakal sıvı el sabunu 5 L bidon, amber gün ışığında stüdyo çekimi",
    "Orange liquid hand soap in a 5 L canister, studio shot in amber daylight",
    "صابون البرتقال السائل لليدين في عبوة 5 لترات، لقطة استوديو في ضوء نهار كهرماني",
  ),
  PRESTIJ_Portakal_5L_akdeniz_mutfak: t(
    "Portakal sıvı el sabunu 5 L bidon, Akdeniz esintili modern mutfakta",
    "Orange liquid hand soap in a 5 L canister in a Mediterranean-style kitchen",
    "صابون البرتقال السائل لليدين في عبوة 5 لترات في مطبخ عصري بطابع متوسطي",
  ),
  PRESTIJ_Portakal_20L_yatay_etiket_traverten: t(
    "Portakal sıvı el sabunu 20 L bidon, sıcak traverten üzerinde yatay etiketli",
    "Orange liquid hand soap in a 20 L canister with a landscape label on warm travertine",
    "صابون البرتقال السائل لليدين في عبوة 20 لترًا بملصق أفقي على حجر ترافرتين دافئ",
  ),
  PRESTIJ_Portakal_20L_Grafik_buyuk_narenciye_gorselleri: t(
    "Portakal sıvı el sabunu 20 L bidon, büyük portakal dilimleri ve PRESTİJ logolu etiket tasarımı",
    "Orange liquid hand soap 20 L canister with a full label of orange slices and the PRESTİJ logo",
    "عبوة 20 لترًا من صابون البرتقال السائل لليدين بملصق كبير لشرائح البرتقال وشعار PRESTİJ",
  ),
  // Okyanus: pump bottles
  PRESTIJ_Okyanus_Pompali_deniz_manzarali_banyo: t(
    "Okyanus duş jeli, deniz manzaralı banyoda yivli mavi cam pompalı şişe",
    "Ocean shower gel in a fluted blue glass pump bottle in a sea-view bathroom",
    "جل الاستحمام المحيط في زجاجة زرقاء مضلّعة بمضخة في حمّام مطلّ على البحر",
  ),
  PRESTIJ_Okyanus_Pompali_otel_dus_nisi: t(
    "Okyanus duş jeli, lüks otel duş nişinde füme mavi cam pompalı şişe",
    "Ocean shower gel in a smoked blue glass pump bottle in a luxury hotel shower niche",
    "جل الاستحمام المحيط في زجاجة زرقاء مدخّنة بمضخة داخل كوّة دش في فندق فاخر",
  ),
  PRESTIJ_Okyanus_Pompali_spa_buzlu_turkuaz: t(
    "Okyanus duş jeli, doğal spa duşunda buzlu turkuaz pompalı şişe",
    "Ocean shower gel in a frosted turquoise pump bottle by a natural spa shower",
    "جل الاستحمام المحيط في زجاجة فيروزية مصنفرة بمضخة بجوار دش سبا طبيعي",
  ),
  PRESTIJ_Okyanus_Pompali_resort_seramik: t(
    "Okyanus duş jeli, açık hava resort duşunda beyaz seramik pompalı şişe",
    "Ocean shower gel in a white ceramic pump bottle at an open-air resort shower",
    "جل الاستحمام المحيط في زجاجة سيراميك بيضاء بمضخة عند دش منتجع في الهواء الطلق",
  ),
  PRESTIJ_Okyanus_Pompali_dus_jeli_kullanim: t(
    "Okyanus duş jeli, pompalı şişeden banyo süngerine alınırken",
    "Ocean shower gel being pumped onto a bath sponge in the shower",
    "جل الاستحمام المحيط يُضخّ من الزجاجة على إسفنجة استحمام داخل الدش",
  ),
  PRESTIJ_Okyanus_Pompali_su_yansimali_studyo: t(
    "Okyanus duş jeli, su yansımalı stüdyoda fasetli cam pompalı şişe",
    "Ocean shower gel in a faceted glass pump bottle, studio shot with water reflections",
    "جل الاستحمام المحيط في زجاجة مشطوفة بمضخة، لقطة استوديو مع انعكاسات الماء",
  ),
  // Okyanus: canisters
  PRESTIJ_Okyanus_5L_spa_dus: t(
    "Okyanus duş jeli 5 L bidon, spa duşunda",
    "Ocean shower gel in a 5 L canister in a spa shower",
    "جل الاستحمام المحيط في عبوة 5 لترات داخل دش سبا",
  ),
  PRESTIJ_Okyanus_5L_safir_su_isigi_studyo: t(
    "Okyanus duş jeli 5 L bidon, safir mavisi ve su ışığında stüdyo çekimi",
    "Ocean shower gel in a 5 L canister, studio shot in sapphire blue and water light",
    "جل الاستحمام المحيط في عبوة 5 لترات، لقطة استوديو بالأزرق الياقوتي وضوء الماء",
  ),
  PRESTIJ_Okyanus_5L_deniz_manzarali_resort: t(
    "Okyanus duş jeli 5 L bidon, deniz manzaralı resort duşunda",
    "Ocean shower gel in a 5 L canister at a sea-view resort shower",
    "جل الاستحمام المحيط في عبوة 5 لترات عند دش منتجع مطلّ على البحر",
  ),
  PRESTIJ_Okyanus_20L_yatay_etiket_safir: t(
    "Okyanus duş jeli 20 L bidon, safir tonlarında yatay etiketli",
    "Ocean shower gel in a 20 L canister with a landscape label in sapphire tones",
    "جل الاستحمام المحيط في عبوة 20 لترًا بملصق أفقي بدرجات الأزرق الياقوتي",
  ),
  PRESTIJ_Okyanus_20L_Grafik_su_ve_kopuk_gorselleri: t(
    "Okyanus duş jeli 20 L bidon, büyük su ve köpük görselleri ile PRESTİJ logolu etiket tasarımı",
    "Ocean shower gel 20 L canister with a full label of water and foam and the PRESTİJ logo",
    "عبوة 20 لترًا من جل الاستحمام المحيط بملصق كبير للماء والرغوة وشعار PRESTİJ",
  ),
  // The four-scent collection
  PRESTIJ_Koleksiyon_5L_dikey_koleksiyon: t(
    "Dört Koku Koleksiyonu: Lavanta, Lavanta Latte, Portakal sıvı el sabunu ve Okyanus duş jeli, üst üste dört 5 L bidon",
    "Four-Scent Collection: Lavender, Lavender Latte and Orange liquid hand soaps and Ocean shower gel, four 5 L canisters stacked",
    "مجموعة الروائح الأربع: صابون اللافندر ولاتيه اللافندر والبرتقال السائل لليدين وجل الاستحمام المحيط، أربع عبوات 5 لترات بعضها فوق بعض",
  ),
  PRESTIJ_Koleksiyon_5L_yatay_koleksiyon: t(
    "Dört Koku Koleksiyonu: Lavanta, Lavanta Latte, Portakal sıvı el sabunu ve Okyanus duş jeli, tezgâhta yan yana dört 5 L bidon",
    "Four-Scent Collection: Lavender, Lavender Latte and Orange liquid hand soaps and Ocean shower gel, four 5 L canisters side by side",
    "مجموعة الروائح الأربع: صابون اللافندر ولاتيه اللافندر والبرتقال السائل لليدين وجل الاستحمام المحيط، أربع عبوات 5 لترات جنبًا إلى جنب",
  ),
};

const NAMES: Record<Urun, LocalizedText> = {
  ...(Object.fromEntries(SCENTS.map((s) => [s.urun, s.name])) as Record<Exclude<Urun, "collection">, LocalizedText>),
  collection: BUNDLE.name,
};

const KINDS: Record<Urun, LocalizedText> = {
  ...(Object.fromEntries(SCENTS.map((s) => [s.urun, s.subtitle])) as Record<Exclude<Urun, "collection">, LocalizedText>),
  collection: { tr: "", en: "liquid hand soaps and shower gel", ar: "صابون سائل لليدين وجل استحمام" },
};

// Generic packaging names (pump volume is not final yet).
const PACKS: Record<PackKey, { en: string; ar: string }> = {
  pump: { en: "pump bottle", ar: "زجاجة بمضخة" },
  "5l": { en: "5 L canister", ar: "عبوة 5 لترات" },
  "20l": { en: "20 L canister", ar: "عبوة 20 لترًا" },
};

// First match wins; matched against the lower-cased file stem.
const SCENES: [RegExp, { en: string; ar: string }][] = [
  [/grafik/, { en: "label artwork", ar: "تصميم الملصق" }],
  [/koleksiyon/, { en: "the four scents together", ar: "الروائح الأربع معًا" }],
  [/studyo/, { en: "studio shot", ar: "لقطة استوديو" }],
  [/kullanim|dolum/, { en: "in use", ar: "أثناء الاستخدام" }],
  [/resort|deniz/, { en: "seaside resort", ar: "منتجع على البحر" }],
  [/otel/, { en: "hotel setting", ar: "في فندق" }],
  [/spa/, { en: "spa setting", ar: "في منتجع صحي" }],
  [/mutfak/, { en: "kitchen setting", ar: "في المطبخ" }],
  [/banyo|mermer|traverten|oniks/, { en: "bathroom setting", ar: "في الحمّام" }],
  [/ustten/, { en: "top view on stone and linen", ar: "لقطة علوية على الحجر والكتان" }],
];

/** Revision notes in the CSV ("düzeltilmiş son sürüm") are not part of the scene. */
function cleanScene(scene: string): string {
  return scene.replace(/,\s*(düzeltilmiş son sürüm|ilk taslak)\s*$/i, "").trim();
}

/** The day-1 alt text (scene description + generated English/Arabic). Unchanged since day 1. */
export function legacyAltFor(row: ImageRow): LocalizedText {
  const name = NAMES[row.urun];
  const kind = KINDS[row.urun];
  const pack = PACKS[packOf(row.ambalaj)];
  const scene = SCENES.find(([re]) => re.test(row.stem.toLowerCase()))?.[1];
  const sceneTr = cleanScene(row.scene);
  const lowerFirst = sceneTr.charAt(0).toLocaleLowerCase("tr") + sceneTr.slice(1);

  const en = [`PRESTİJ ${name.en}${kind.en ? ` ${kind.en.toLowerCase()}` : ""}`, pack.en, scene?.en].filter(Boolean);
  const ar = [`${name.ar} من PRESTİJ${kind.ar ? `، ${kind.ar}` : ""}`, pack.ar, scene?.ar].filter(Boolean);
  return {
    tr: `PRESTİJ ${name.tr}, ${lowerFirst}`,
    en: en.join(", "),
    ar: ar.join("، "),
  };
}

/** Alt text of an imported product photo: the written description, else the day-1 generated one. */
export function altFor(row: ImageRow): LocalizedText {
  return MEDIA_ALT[row.stem] ?? legacyAltFor(row);
}
