# PRESTİJ yayına alma rehberi

İlk hazırlanma: 14 Kasım 2026. Güncelleme: 21 Kasım 2026 (karar: site, satış için her şey hazır olunca açılır; PayTR adımları PayTR'nin resmi sayfalarına göre yenilendi, Bölüm 4.1). Yayına alma günü: Bölüm 4'teki hazırlıklar bitince.

Bu rehber senin için yazıldı. Teknik komutları ben çalıştıracağım. Hesap açma, ödeme ve onay gibi tıklamaları sen yapacaksın, ben her adımı tek tek söyleyeceğim. Şifreler, anahtarlar ve kodlar **asla sohbete yazılmaz**, sadece şifre yöneticisine ve ilgili panele girilir.

Hukuki ve mali maddelerin hepsini **avukat ve mali müşavir onaylamalı**. Buradaki bilgiler onların yerini tutmaz.

---

## 1. Kısa cevap

"Domain bağlarım, PayTR'ye başvururum, başka bir şey kalmaz" **doğru değil**. Site kod olarak hazır ve test edildi. Ama satış yapabilmek için kod dışında da işler var. Kararın şu: site, satış için her şey hazır olunca açılır. Plan iki aşamalı:

| Aşama | Ziyaretçi ne görür | Ne zaman |
|---|---|---|
| **1. Satışla açılış** | Sitenin tamamı açık. Kapıda ödeme ve/veya havale ile sipariş verilir. Kartla ödeme, hediye çarkı, bülten ve abonelik kapalı. Numune, ÜTS bildirimi onaylanana kadar kapalı. | Bölüm 4'teki 1-9. maddeler bitince |
| **2. Kartla ödeme** | PayTR ile kartla ödeme de açılır | PayTR iki kez onay verince (Bölüm 4.1): önce başvurunu, sonra test ödemesinden sonra "canlı mod" talebini. PayTR başvuruda siteyi inceler, bu yüzden 1. aşama yayında olmalı. Günlerce sürebilir. |

Bugün satışı durduran şey kod değil, şunlar:
- Fiyatlar hâlâ yapım sırasında girilen örnek fiyatlar (149,90 / 449,90 / 1.499,90 / 1.599,90 TL).
- Şirket bilgileri eksik: MERSİS, vergi no, vergi dairesi, KEP, e-posta, meslek odası ve meslek kuralları bağlantısı.
- Yasal metinlerin hepsi "taslak" ve içinde doldurulmamış [köşeli parantezler] var.
- Havale için şirket IBAN'ı girilmedi.
- ETBİS kaydı, ÜTS bildirimi ve e-fatura düzeni henüz yok.

Yayına alma betiği bunları kendisi de kontrol eder: biri eksikse neyin eksik olduğunu söyler ve hiçbir şey yazmadan durur.

---

## 2. Hazırlık: senin yapacakların

### 2.1 Hesaplar
Hepsi şirketin e-postasıyla açılsın, hepsinde iki adımlı doğrulama (2FA) açık olsun, kurtarma kodları saklansın.

1. **Şifre yöneticisi** kur (ör. Bitwarden). Bundan sonraki her şifre ve anahtar oraya gider.
2. **GitHub** hesabı aç. İçinde boş ve **gizli (Private)** bir depo oluştur, adı `prestij` olsun.
3. **Vercel** hesabı aç ("Continue with GitHub" ile). **Pro pakete geç** (ayda yaklaşık 20 $, kart gerekir). Ücretsiz paket ticari kullanıma izin vermiyor.
4. **Supabase** hesabı aç. Projeyi **henüz oluşturma**, yayına alma günü beraber Frankfurt bölgesinde oluşturacağız. İlk gerçek siparişten önce Pro pakete geçmek gerekecek (ayda yaklaşık 25 $), çünkü ücretsiz pakette yedek yok. Satışla açıldığımız için bunu yayına alma gününde yaparız.
5. **Resend** hesabı aç (alternatifi Brevo). Bu, sitenin e-posta göndermesi için. Bu olmadan kimse üyeliğini onaylayamaz, sipariş e-postaları gitmez.
6. `info@alanadin` için bir **e-posta kutusu** seç: Zoho Mail, Yandex 360 ya da domaini aldığın firmanın e-postası.

### 2.2 Domain
- Domain kayıtlı mı ve domain firmasının paneline girebiliyor musun? Kontrol et.
- Ana adres olarak **www.alanadin** kullanacağız. Her yerde **aynı adres** yazılır: PayTR başvuru formu, PayTR paneli, sözleşmeler, ETBİS ve sitenin ayarı.
- Vercel'e alan adını **iki şekilde de** ekleriz: `alanadin` ve `www.alanadin`. Böylece ikisinin de güvenlik sertifikası (https) olur, `alanadin` yazan da `www.alanadin`'e gider. PayTR sözleşmesi, sitenin açık bütün sayfalarında geçerli bir sertifika ister.
- Domainde eski kayıtlar varsa (eski site, e-posta) bir yere not al. Panel izin veriyorsa TTL değerlerini 300'e düşür, böylece yayına alma günündeki değişiklik hızlı yayılır.

### 2.3 Toplanacak şirket bilgileri
- MERSİS numarası
- Vergi numarası ve vergi dairesi
- KEP adresi (yoksa PTT KEP alınabilir)
- Kayıtlı olunan meslek odası (Kayseri Ticaret ve/veya Sanayi Odası) ve odanın meslek kurallarının yayımlandığı sayfanın adresi (https:// ile başlayan)
- "PRESTİJ" tescilli marka mı (TÜRKPATENT)?
- Şirket IBAN'ı (havale için)

### 2.4 Fiyat ve ürün kararları
- 17 ürün seçeneğinin hepsi için gerçek fiyat (KDV dahil), stok ve ağırlık/desi.
- **Pompalı şişe gerçekten üretiliyor mu?** Üretiliyorsa gerçek ml değeri ne? Üretilmiyorsa o 4 seçeneği ve görsellerini gizleriz.
- Kargo ücreti, ücretsiz kargo sınırı, ağır paket farkı (20 L), kargoya verme süresi, kapıda ödeme ücreti ve üst sınırı.

### 2.5 Avukata ve mali müşavire gönderilecekler
- Panelden yasal metinleri (Panel → Yasal Metinler) avukata gönder. Sorular **Bölüm 6**'da.
- Mali müşavire Bölüm 7'deki soruları sor.
- PayTR için evrak dosyası hazırla. PayTR'nin limited şirketler için resmi listesi:
  - güncel **vergi levhası**,
  - **ticaret sicil gazetesi** (kuruluş ve son yetki değişikliği),
  - güncel **imza sirküleri**,
  - **bütün ortakların** kimlik görüntüsü (ön ve arka yüz),
  - şirket hesabını gösteren **banka belgesi** (internet bankacılığından ya da şubeden alınan IBAN/hesap belgesi; hesap şirket adına olmalı).
  İkametgâh belgesi resmi listede yalnızca bireysel başvurular (şirketi olmayan kişiler) için var; sizden istenmez. ÜTS kayıtlarının çıktısını da bu dosyada tut, PayTR sorarsa hazır olsun.
- **Kimlik doğrulama (KYC):** imza sirkülerindeki **imza yetkilisi** yapar. Bunun için **çipli kimlik kartı** ve **NFC'li bir telefon** gerekir (PayTR uygulamasıyla). Diğer ortakların da yapıp yapmayacağını PayTR temsilcisine sor; resmi sayfada yazmıyor.

**Taşıma sırasında kartla ödemeyi, çarkı, bülteni ve abonelikleri ben kapatacağım. Numune de, ÜTS bildirimi onaylanana kadar kapalı taşınır.** Kapıda ödeme ve havale, senin panelde ayarladığın gibi açık kalır. Senin panelde bir şey kapatmana gerek yok.

---

## 3. Yayına alma günü

Toplam 5-8 saat sürebilir. En uzun bekleme DNS'in ve güvenlik sertifikasının (https) devreye girmesi, bu dakikalar da sürebilir saatler de. Sıra önemli:

1. **Ön koşul (bilgisayardaki panelde):** Bölüm 4'teki 1-9. maddeler bitmiş olmalı. Özellikle şunlar **bilgisayardaki panelde** girilmiş olmalı, çünkü taşıma betiği bunları kontrol eder ve biri eksikse hiçbir şey yazmadan durur: avukat onaylı yasal metinler, şirket bilgilerinin hepsi (KEP, meslek odası ve kuralları bağlantısı dahil), havale için IBAN ve ödeme süresi, gerçek fiyatlar. Panel → SEO Kontrol'deki "Yayına alma adımları" listesinin "Yayından önce" grubuna bak.
2. **Yedek:** Bilgisayardaki veritabanının son hâlini yedeklerim.
3. **Supabase projesi:** Beraber oluşturacağız. Frankfurt bölgesi, güçlü veritabanı şifresi, SSL zorunlu, gereksiz dışa açık kapılar kapalı. Pro pakete geçeriz (yedek için).
4. **Verileri taşıma:** Ürünleri, sayfaları, ayarları, yasal metinleri ve blog yazılarını Supabase'e **satış profiliyle** taşırım: kartla ödeme, çark, bülten ve abonelik kapalı; kapıda ödeme ve havale açık; numune ÜTS onayı yoksa kapalı (numune duyurusu da kapanır). Test kayıtları, üyeler ve sepetler taşınmaz. Bir şey eksikse betik neyin eksik olduğunu Türkçe söyler ve durur; eksiği bilgisayardaki panelde tamamlar, yeniden denersin.
5. **Yönetici hesabı:** Panel için senin gerçek e-postanla yeni bir yönetici hesabı açarız. Şifreyi sen yazarsın, ekranda görünmez.
6. **Fotoğraf/video deposu:** Supabase'de `media` adında bir depo açarsın, ben ayarlarını söylerim.
7. **E-posta:** Resend'e domainini eklersin. Verdiği DNS kayıtlarını 10. adımda gireriz.
8. **GitHub:** Kodu senin gizli deponya yüklerim. GitHub girişini sen yaparsın.
9. **Vercel:** Projeyi içeri alırsın. **"Deploy"a basmadan önce** ayarları (ortam değişkenlerini) tek tek gireriz. Vercel'in "Import .env" düğmesi asla kullanılmaz.
10. **Domain ve DNS:** Domain firmasının panelinde Vercel'in ve Resend'in verdiği kayıtları girersin. Eski site kayıtları silinir, e-posta kutusu kayıtları korunur. Vercel'de hem `alanadin` hem `www.alanadin` eklenir; ikisini de tarayıcıda açıp kilit işaretini (https) kontrol ederiz.
11. **Zamanlanmış görevler ve bildirimler:** Vercel'de görevleri bir kez elle çalıştırıp kontrol ederiz. Canlı sitede panele girip yeni sipariş bildirimlerinin gideceği e-posta adresini kontrol edersin (Ayarlar › E-posta › Yönetici bildirimleri).
12. **Canlı test (yaklaşık 1 saat):** Sayfalar üç dilde açılıyor mu, test e-postası geliyor ve spam'e düşmüyor mu, yeni üyelik ve onay maili, şifre sıfırlama, iletişim formu, büyük fotoğraf ve video yükleme. Sonra **bir kapıda ödeme ve bir havale test siparişi** veririz: sipariş ve havale e-postaları geliyor mu, havale e-postasında ve sipariş sayfasında IBAN ve son ödeme tarihi doğru mu, panelde siparişler görünüyor mu. İki siparişi de panelden iptal ederiz (stok geri eklenir). Son olarak çarkın, kartla ödemenin ve (ÜTS yoksa) numunenin görünmediğini ve veritabanı güvenlik kontrolünü kontrol ederiz.

---

## 4. Yayına almadan önce hazır olması gerekenler

1-9. maddeler yayına alma gününün ön koşuludur (Bölüm 3, adım 1). 10. madde açılışı beklemez.

| # | Kim | Ne |
|---|---|---|
| 1 | sen | Panelde her varyantın gerçek fiyatı ve stoğu, kargo ayarları (Ayarlar › Kargo: kargo ücreti, ücretsiz kargo sınırı, ağır paket farkı, kargoya verme süresi). Duyuru bandındaki yazıları güncelle (ör. ücretsiz kargo sınırı). Örnek fiyatta tek bir varyant kalsa bile taşıma betiği durur ve hangisi olduğunu söyler; o fiyat gerçekten doğruysa bana söyle. |
| 2 | sen | Panel → Ayarlar › Firma bilgileri: şirket bilgileri eksiksiz (ticari unvan, adres, telefon, e-posta, MERSİS, vergi dairesi ve numarası, KEP, meslek odası ve meslek kuralları bağlantısı). Bunlar sitenin altında "İletişim" başlığıyla görünür. |
| 3 | avukat → sen | Yasal metinlerin son hâli. Köşeli parantezlerin hepsi doldurulur, "taslak" ibaresi kalkar, sürüm adı "taslak" ile başlamaz (ör. "2026-11 v1"). **Metinler taslakken site sipariş almaz**, bu bilerek konmuş bir güvenlik kilidi. Avukat bir köşeli parantezi bilerek olduğu gibi bırakıyorsa (ör. bir kanun atfı) bana söyle. |
| 4 | sen | **ETBİS** kaydı (e-Devlet → Elektronik Ticaret Bilgi Sistemi). Domain ve KEP adresi gerekir. |
| 5 | sen + sorumlu teknik eleman | **ÜTS**: her ürün, her boy bildirilmiş olmalı. Sitedeki içerik listelerini (INCI) ürün dosyasındaki doğru listeyle değiştir. Şu an Lavanta'da portakal içeriği görünüyor, Okyanus'ta yazım hataları var. Numuneler ÜTS'ye bildirilip onaylanmadan numune (sepette numune ve /numune formu) canlı sitede kapalı kalır; onay gelince bana söyle. |
| 6 | mali müşavir | e-Arşiv / e-Fatura düzeni. Site fatura kesmiyor, faturayı mali müşavirin programı keser. |
| 7 | sen | Tek bir kargo firmasıyla anlaşma: desi fiyatları, kapıda tahsilat, anlaşmalı iade kodu. |
| 8 | sen | Panel → Ayarlar › Ödeme yöntemleri: kapıda ödeme ve/veya havale açık. Havale için şirket IBAN'ı ve hesap sahibi, **Ödeme süresi** (varsayılan 3 gün). Süre sipariş verilirken siparişe yazılır; sonradan değiştirirsen yalnızca yeni siparişler etkilenir. Son ödeme tarihi e-postada, sipariş sayfasında ve sözleşmelerin sipariş bölümünde kendiliğinden yazar (aşağıdaki satır; avukata göster, Bölüm 6, soru 10). Kapıda ödeme sadece kargo firmasının tahsilat hizmeti varsa. |
| 9 | avukat | Müşteri verisi yurt dışındaki sunucularda tutuluyor (Vercel, Supabase, e-posta servisi). KVKK açısından sözleşme ve bildirim gerekir. |
| 10 | sen | Bülteni açmadan önce **İYS** kaydı (iys.org.tr). Açılışı beklemez; bülten o zamana kadar kapalı kalır. |

Sözleşmelerin sipariş bölümüne havale siparişlerinde kendiliğinden yazılan satır (tarih ve gün sayısı siparişe göre değişir):

> Havale/EFT ile ödemede son ödeme tarihi: 13 Kasım 2026 (sipariş tarihinden itibaren 3 gün).

Bu satır yalnızca tarihi söyler. Tarih geçince ne olacağı (ör. siparişin iptal edilebileceği) avukatın onayladığı metinde yazmalı.

### 4.1 Kartla ödeme: PayTR adım adım (2. aşama, sonra)

PayTR'de iki ayrı onay var. **1. onay:** başvurun ve evrakların incelenir. **2. onay:** sitede test ödemesi yaptıktan sonra "canlı mod" talebin incelenir. PayTR'nin resmi sayfaları süre için bir yerde "2 saat", bir yerde "1-5 iş günü" diyor; günlerce süreceğini düşün. İlk hafta kart gelirine güvenme. PayTR gerekçe göstermeden de reddedebilir; o zaman iyzico yedek olarak hazır (ayrı başvuru ve yasal metin güncellemesi gerekir).

1. **Başvuru (1. aşama yayındayken):** paytr.com'daki "Üye İşyeri Olun" formunu doldur.
   - Başvurulacak ürün: **Sanal POS**. Şirket türü: **Limited Şirket**.
   - Web sitesi: **https://www.alanadin** (vercel.app adresi asla).
   - Yetkili kişi: imza sirkülerindeki imza yetkilisi. E-posta: her gün okunan şirket adresi (PayTR teklifleri, evrak linklerini ve canlı mod haberini e-posta ve SMS ile gönderir).
   - Temsilci arayınca: "**Kendi yazılımımız var, iFrame API ile bağlanacağız**" de. Hazır modül, Direkt API, Linkle Ödeme, Abonelik ya da Kolay Mağaza değil.
2. **Evrak ve kimlik doğrulama:** Bölüm 2.5'teki evrakları yükle. İmza yetkilisi çipli kimlik ve NFC'li telefonla kimlik doğrulamasını yapar.
3. **Sözleşme imzalanınca:** PayTR Mağaza Paneli › Destek & Kurulum › **Entegrasyon Bilgileri** (eski adı: Bilgi) sayfasında mağaza no, mağaza parola ve mağaza gizli anahtar var. Bu sayfayı göremiyorsan mağazanın ana kullanıcısıyla gir ya da PayTR'ye sor. Bunları sohbete yazma; Vercel'e beraber gireriz ve siteyi yeniden yayınlarız.
4. **PayTR logosu ve yazısı:** PayTR sözleşmesi, ödeme sayfasında PayTR logosunu ve "Bu internet sitesindeki ödeme hizmetleri PAYTR Ödeme ve Elektronik Para Kuruluşu A.Ş. tarafından sağlanmaktadır." cümlesini (paytr.com bağlantısıyla) ister. Site yazıyı kendisi gösterir: kart ödeme sayfasında her zaman, sitenin alt bilgisinde ise kart PayTR ile canlıyken. Logoyu sen eklersin: PayTR'nin kendi logo dosyalarından birini al (PayTR panelinden ya da dev.paytr.com'daki "Sıkça Sorulan Sorular" sayfasındaki PayTR görselleri bağlantısından), Panel → Medya'ya yükle, Panel → Ayarlar › Ödeme yöntemleri › **PayTR logosu** alanından seç. Logoyu değiştirme ya da yeniden çizme; sözleşme PayTR'nin belirlediği şekli ister. İmzaladığın sözleşmedeki cümle farklıysa Panel → Arayüz Metinleri › Alt bilgi › PayTR'den aynısını yaz.
5. **Bildirim URL'si:** Panel → Ayarlar › Ödeme yöntemleri'ndeki "**PayTR bildirim URL'si**"ni kopyala. PayTR Mağaza Paneli › Destek & Kurulum › Ayarlar › **Bildirim URL Ayarları**'na aynen yapıştır. Protokol: **HTTPS**. Sonuna "/" ekleme, www'yi atlama, vercel.app adresi yazma. Bu adres yanlışsa kartla ödeyen müşterinin siparişi "ödendi" olmaz.
6. **PayTR'de açılmayacaklar:** PayTR'nin **Havale/EFT** ürününü açma ve "ara bildirim" adresi tanımlama. Havaleyi sitenin kendi havale yöntemiyle almaya devam et. **Taksiti** avukatın metinleri taksiti anlatmıyorsa kapalı tut.
7. **Test ödemesi:** Panel → Ayarlar › Ödeme yöntemleri: kuruluş **PayTR**, **Test modu açık**, **Kart açık**. Test modunda kart seçeneğini yalnızca panele giriş yapmış ekip üyeleri görür, müşteriler görmez. Panele girişliyken sitede PayTR'nin test kartıyla bir sipariş ver. Siparişin panelde "Ödendi" olduğunu ve PayTR panelindeki işlem listesinde "Başarılı" göründüğünü kontrol et. Sonra siparişteki "Kart iadesi yap" ile iade et.
8. **Canlı mod talebi (2. onay):** PayTR Mağaza Paneli › Destek & Kurulum › **Canlı Mod** sayfasında önce "**Evet, Entegrasyonu Tamamladım**"a bas. Test kontrolü başarılı olunca "**Canlı Moda Geçiş Talebi Gönder**"e bas. PayTR test işlemini ve talebi inceler, sonra **SMS ve e-postayla** haber verir.
9. **Haber gelince:** Panel → Ayarlar › Ödeme yöntemleri'nde **test modunu kapat** ve kaydet. Haberden önce kapatma: müşteriler kart seçeneğini görür ama ödeme çalışmaz. Sonra küçük tutarlı gerçek bir sipariş verip "Kart iadesi yap" ile iade et. İlk gün iade "**PayTR 010**" (bakiye yetersiz) hatası verebilir; bu site hatası değildir, ertesi gün yeniden dene ya da PayTR'ye sor.
10. **ETBİS:** kart ödemesi açılınca ETBİS kaydına "kart"ı ekle (süreyi avukat veya mali müşavir teyit etsin).
11. **Adres değişirse:** alan adı değişirse PayTR'ye yazılı bildir (sözleşme bunu ister) ve Bildirim URL'sini de güncelle.

---

## 5. İlk hafta

- **Yedek:** Supabase Pro'da her gün otomatik yedek alınır. Ayrıca haftada bir ben de yedek alırım.
- **Günlük 5 dakika kontrol:** Panel → E-postalar'da başarısız mail var mı, zamanlanmış görevler çalışıyor mu, ödenmemiş havale siparişleri var mı. Ödeme süresi geçen havale siparişleri Siparişler › Havale bekleyen'de ve ana paneldeki Yapılacaklar'da "Ödeme süresi doldu" diye işaretlenir; site bunları kendiliğinden iptal etmez: müşteriyi ara ya da siparişi iptal et (stok geri eklenir). Müşterinin sipariş sayfasında da "Son ödeme tarihi geçti, ödeme yapmadan önce bizimle iletişime geçin" yazar.
- **Google:** Search Console'a siteyi ekle, doğrulama kodunu panele gir, site haritasını gönder ("Yayına alma adımları" listesinin "Yayından sonra" grubu).
- **Merchant Center ve Google İşletme Profili:** Gerçek fiyatlar, son iade politikası ve kartla ödeme hazır olduktan sonra.
- **Hediye çarkı:** Avukat onaylayınca açılır (listede "Çarkı açmadan önce" grubu).
- **Numune:** ÜTS onayı gelince açılır.
- **Güvenlik:** Personel için ortak şifre kullanılmaz, herkese ayrı panel hesabı açılır.

### Numune kapalıyken
Numune kapalıyken (sepette numune ve numune formu kapalı) site, üst menüdeki "Numune" ve alt bilgideki "Ücretsiz Numune" bağlantılarını ve numuneye çağıran bölümleri (ana sayfadaki ve kurumsal sayfadaki "Numune talep edin" bölümleri, "Ücretsiz numune isteyin" düğmeleri) **kendiliğinden gizler**. Numuneyi panelden açınca hepsi geri gelir; menülere dokunmana gerek yok. /numune sayfasına doğrudan giren "Numune talepleri şu anda alınmıyor" notunu görür.

Yazılar ise değişmez, çünkü onlar senin içeriğin; yazının içindeki numune bağlantıları da tıklanabilir kalır ve "Numune talepleri şu anda alınmıyor" notuna götürür. Şu yerlerde hâlâ ücretsiz numuneden söz ediliyor; açılıştan önce panelden düzelt ya da önce ÜTS'yi bitir:
- **Hakkımızda** sayfası: "işletmelere ücretsiz numune gönderiyoruz; bireysel siparişlerinize de ücretsiz numune ekleyebilirsiniz" (içindeki numune bağlantısı da).
- **Ana sayfa:** SSS'deki "Ücretsiz numune alabilir miyim?" sorusu; kurumsal bölümdeki "Ücretsiz numune gönderimi" maddesi.
- **Kurumsal sayfa:** SSS'deki numune cevabı, teklif formundaki "Karar vermeden önce ücretsiz numune de isteyebilirsiniz." maddesi, kurumsal bölümdeki "Karar öncesi ücretsiz numune" maddesi.
- **Ürünler sayfası:** SSS'deki "siparişinize ücretsiz numune ekleyebilirsiniz" cümlesi; sayfanın altındaki tanıtım yazısındaki "işletmelere ücretsiz numune gönderiyoruz" cümlesi (içindeki numune bağlantısı da).
- **İletişim sayfası:** formun giriş yazısındaki numune cümlesi ve "Numune talebi" konusu.
- **Blog yazıları** (Panel → Blog; 7 yazının 6'sı): "Doğru El Yıkama: Adım Adım El Temizliği", "Duş Jeli mi, Katı Sabun mu? Farklar ve Seçim Önerileri", "Hangi Alana Hangi Koku? Lavanta, Portakal ve Okyanus", "5 L ve 20 L Bidon Sıvı Sabun: İşletmeler İçin Rehber", "Oteller, Ofisler ve Restoranlar İçin Sıvı Sabun ve Duş Jeli", "Sıvı El Sabunu Nasıl Seçilir?": yazının içindeki ücretsiz numune cümleleri ve numune bağlantıları. Türkçe, İngilizce ve Arapça metinlerin üçünde de var.
- **Kategori sayfaları** (Panel → Kategoriler › Sıvı el sabunu, Duş jeli, Hediye setleri): sayfanın altındaki tanıtım yazısında ücretsiz numune cümlesi ve numune bağlantısı. Türkçe, İngilizce ve Arapça metinlerin üçünü de düzelt.
- **Duyuru bandı:** "Oteller ve işletmeler için ücretsiz numune" duyurusu taşımada kendiliğinden kapanır.

### Kartla ödeme açıldıktan sonra (ilk haftalar)
- **Her gün:** PayTR Mağaza Paneli'ndeki **Mağaza Bildirimleri** sayfasına bak. Orada duran (gönderilemeyen) bildirim varsa bana haber ver.
- Müşteri PayTR'den döndükten sonra sipariş sayfasında en fazla 45 dakika "**Ödemeniz doğrulanıyor**" yazabilir. Bu sürede yeniden ödeme düğmesi çıkmaz; böylece kart iki kez çekilmez.
- **Kısmi iade** (siparişin bir kısmı iade edilirse): tutarı PayTR panelinden elle iade et, sonra panelde siparişe tutar ve tarihle bir not yaz. O siparişte daha sonra "Kart iadesi yap"a **basma**: site yalnızca tam iade yapar ve PayTR fazla iadeyi reddeder.
- **Linkle Ödeme:** PayTR'nin ödeme linkiyle (ör. toptan müşteriden) aldığın ödemeler siteye hiç gelmez. Onları ayrıca kaydet ve faturala; sitenin bildirim adresini linke yazma.
- **Ana paneldeki uyarılar** (Yapılacaklar kutusu):
  - "**Kart ödemesi doğrulanamadı**": bir kart siparişinin sonucu 24 saattir PayTR'den öğrenilemedi. Site bu siparişi kendiliğinden iptal etmez. PayTR panelinde işleme bak: para çekildiyse siparişte "Ödeme alındı"ya, çekilmediyse "İptal et"e bas.
  - "**PayTR bildirimleri reddediliyor**": sitedeki bir ödemeye ait PayTR bildirimi, imza tutmadığı için ya da anahtarlar eksik olduğu için reddediliyor. Bildirim URL'sini ve anahtarları kontrol etmemiz gerekir, bana haber ver. Düzelince PayTR'nin Mağaza Bildirimleri sayfasından duran bildirimleri yeniden başlat. Uyarı 72 saat sonra kendiliğinden kalkar. Yalnızca sitedeki bir ödemenin numarasını taşıyan bildirimler sayılır; yine de bu numarayı bilen biri sahte istek gönderebilir, o durumda siparişler etkilenmez.
  - "**Canlı siparişe PayTR test ödemesi geldi**": para çekilmedi, sipariş ödendi sayılmadı. Büyük ihtimalle test modu PayTR'nin canlı mod onayından önce kapatıldı. Panel → Ayarlar › Ödeme yöntemleri'nde **test modunu yeniden açıp kaydet**; PayTR canlı mod onayını SMS veya e-postayla bildirene kadar açık tut. Satırın altındaki "Test ödemesi gelen sipariş" satırı siparişi açar; müşteriyle görüş.
  - "**Başarısız ödemeden sonra başarılı bildirim**": aynı ödeme için önce "başarısız", sonra "başarılı" geldi. Satır siparişi (birden fazlaysa o siparişlerin listesini) açar. PayTR panelinde kontrol et: para çekildiyse siparişi "Ödeme alındı" ile onayla ya da tutarı iade et.
  - "**Kart ödemesi doğrulanamadı**" uyarısında ve sipariş sayfasında PayTR'de aranacak numara yazar: "PayTR sipariş no" (PR ile başlar, tire yoktur; sipariş numarası PayTR'de geçmez). PayTR mağaza panelinin **İşlemler** sayfasında bu numarayla ya da müşterinin e-postasıyla ara.
  - Kartla ödeyen müşteri sipariş sayfasında "Ödemeniz doğrulanıyor" gördüğü sürede, ödemeyi yapmadıysa ya da kartı reddedildiyse aynı ödeme formuna dönebilir (aynı form olduğu için iki kez çekim olmaz). Süre dolup ödeme gelmezse sipariş kısa süre sonra kendiliğinden iptal edilir ve müşteriye iptal e-postası gider; müşterinin gördüğü yazı da bunu söyler.

### Aylık tahmini giderler
| Kalem | Tutar |
|---|---|
| Vercel Pro | yaklaşık 20 $ |
| Supabase Pro (ilk siparişten önce) | yaklaşık 25 $ |
| E-posta kutusu | kişi başı yaklaşık 1 $ |
| Resend | günde 100 maile kadar ücretsiz, büyürse yaklaşık 20 $ |
| KEP | yıllık ücret |

---

## 6. Avukata sorulacaklar

1. **Hediye çarkı:** Her dilimin kazandırdığı bu çark, Milli Piyango izni gereken bir çekiliş sayılır mı? Hatırlatma e-postası ticari elektronik ileti mi? Minimum sepet şartlı hediyeler (300 / 750 TL) ve "1.500 TL üzeri ücretsiz kargo" bandı, 1 Ağustos 2026'dan beri geçerli şartlı indirim reklam kurallarına uygun mu?
2. **İade ve cayma** (1 Ocak 2026'dan beri geçerli değişiklik): anlaşmalı kargo, ücretsiz iade, 14 gün içinde gönderme, iadenin ne zaman yapılacağı, "yeniden satılabilir olma" şartı.
3. Sözleşme öncesi bilgilendirme (6563 sayılı kanun m.3): teknik adımlar, sözleşmenin saklanması ve erişimi.
4. Sipariş sayfasındaki sözleşme bağlantısı yeterli mi, yoksa sözleşme e-postaya eklenmeli mi?
5. **KVKK yurt dışı aktarım:** Vercel, Supabase, e-posta servisleri, WhatsApp. Standart sözleşme, 5 iş günü içinde bildirim, aydınlatma metnine eklenecek firmalar.
6. **Çerez politikası:** Site şu an sadece zorunlu çerezler kullanıyor. Çerez bandı gerekli mi? Metindeki "analiz/pazarlama çerezleri" ifadesi düzeltilmeli.
7. Ana sayfadaki satıcı bilgileri bloğunda hangi alanlar zorunlu (KEP, meslek odası ve kuralları bağlantısı, tescilli marka)?
8. 1 Ağustos 2026'dan beri yorum yayınlama kuralları: sadece satın alanların yorumu mu yayınlanmalı?
9. Gönderilen e-postaların kaydı ne kadar süre saklanabilir?
10. **Havale son ödeme tarihi:** Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi'nin sipariş bölümüne site kendiliğinden şu satırı yazıyor: "Havale/EFT ile ödemede son ödeme tarihi: [tarih] (sipariş tarihinden itibaren [gün] gün)." Bu satır yeterli mi? Tarih geçince ödemesi gelmeyen siparişin iptal edilebileceği sözleşme metninde nasıl yazılmalı (şu an otomatik satırda böyle bir cümle yok)?

## 7. Mali müşavire sorulacaklar

- e-Fatura / e-Arşiv entegratörü ve internet satışı şablonu
- Sıvı sabun ve duş jeli için KDV oranı (%20 mi?)
- Kargo ücreti ve kapıda ödeme ücretinin KDV'si ve faturalanması
- Faturanın müşteriye nasıl iletileceği (PDF e-posta, kâğıt?)
- VERBİS muafiyeti
- Şirketin MERSİS, vergi no, vergi dairesi ve KEP bilgileri
