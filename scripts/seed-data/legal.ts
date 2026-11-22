// DRAFT legal texts (version "taslak-1"). They must be reviewed by a lawyer before going live.
// Turkish is the full draft with the company's real details; [köşeli parantez] marks data still
// missing. English/Arabic are short summaries that point to the Turkish text, except the day-6 gift
// wheel campaign terms (WHEEL_TERMS_LEGAL_DOCUMENT), written out in full in all three languages.
import type { LocalizedText } from "@/db/schema/common";

export const LEGAL_VERSION = "taslak-1";

const COMPANY = {
  name: "PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ.",
  address: "Cırgalan Mah. Engir Gölü Küme Evler No:5/E, Kocasinan / Kayseri",
  phone: "0352 353 30 70",
};

const draftNotice = {
  tr: `<aside class="legal-draft" role="note"><p><strong>TASLAK METİN (${LEGAL_VERSION})</strong> — Bu metin genel bilgilendirme amaçlı bir taslaktır; yayına alınmadan önce bir hukukçu tarafından incelenmeli ve onaylanmalıdır. Köşeli parantez içindeki alanlar doldurulmalıdır.</p></aside>`,
  en: `<aside class="legal-draft" role="note"><p><strong>DRAFT (${LEGAL_VERSION})</strong> — This text is a draft and must be reviewed by a lawyer before publication. The legally binding version is the Turkish text.</p></aside>`,
  ar: `<aside class="legal-draft" role="note"><p><strong>مسودة (${LEGAL_VERSION})</strong> — هذا النص مسودة ويجب أن يراجعه محامٍ قبل النشر. النسخة الملزمة قانونيًا هي النص التركي.</p></aside>`,
};

const sellerBlock = `<ul>
<li><strong>Unvan:</strong> ${COMPANY.name}</li>
<li><strong>Adres:</strong> ${COMPANY.address}</li>
<li><strong>Telefon:</strong> ${COMPANY.phone}</li>
<li><strong>E-posta:</strong> [e-posta adresi]</li>
<li><strong>MERSİS No:</strong> [MERSİS numarası]</li>
<li><strong>Vergi Dairesi / No:</strong> [vergi dairesi ve numarası]</li>
<li><strong>KEP Adresi:</strong> [KEP adresi]</li>
</ul>`;

const kvkk = `${draftNotice.tr}
<h2>Kişisel Verilerin Korunması Hakkında Aydınlatma Metni</h2>
<p>6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca, veri sorumlusu sıfatıyla ${COMPANY.name} (“PRESTİJ”) olarak kişisel verilerinizi aşağıda açıklanan kapsamda işlemekteyiz.</p>
<h3>1. Veri Sorumlusu</h3>
${sellerBlock}
<h3>2. İşlenen Kişisel Veriler</h3>
<ul>
<li><strong>Kimlik:</strong> ad, soyad; fatura için gerekli hâllerde T.C. kimlik numarası.</li>
<li><strong>İletişim:</strong> e-posta adresi, telefon numarası, teslimat ve fatura adresi.</li>
<li><strong>Müşteri işlem:</strong> sipariş, sepet, iade, numune ve teklif talebi bilgileri.</li>
<li><strong>Kurumsal müşteri:</strong> şirket unvanı, vergi dairesi ve numarası, yetkili kişi bilgileri.</li>
<li><strong>İşlem güvenliği:</strong> IP adresi, oturum ve çerez kayıtları, cihaz/tarayıcı bilgileri.</li>
<li><strong>Pazarlama:</strong> yalnızca izin vermeniz hâlinde e-bülten tercihleri.</li>
</ul>
<p>Kart bilgileriniz PRESTİJ tarafından saklanmaz; ödemeler lisanslı ödeme kuruluşları üzerinden alınır.</p>
<h3>3. İşleme Amaçları</h3>
<ul>
<li>Siparişlerin alınması, ödemenin gerçekleştirilmesi, teslimat ve faturalandırma,</li>
<li>İade, değişim, numune ve teklif taleplerinin yönetilmesi,</li>
<li>Müşteri hizmetleri ve iletişim taleplerinin yanıtlanması,</li>
<li>Üyelik ve kurumsal hesapların yönetilmesi,</li>
<li>Bilgi güvenliğinin sağlanması ve yasal yükümlülüklerin yerine getirilmesi,</li>
<li>Açık rızanız bulunması hâlinde kampanya ve yeniliklerle ilgili ticari elektronik ileti gönderilmesi.</li>
</ul>
<h3>4. Hukuki Sebepler</h3>
<p>Kişisel verileriniz KVKK m. 5/2 kapsamında; bir sözleşmenin kurulması veya ifası (c), hukuki yükümlülüğün yerine getirilmesi (ç), bir hakkın tesisi, kullanılması veya korunması (e) ve meşru menfaat (f) hukuki sebeplerine; ticari elektronik ileti gönderimi ve zorunlu olmayan çerezler bakımından ise açık rızanıza (m. 5/1) dayanılarak işlenir.</p>
<h3>5. Aktarım</h3>
<p>Kişisel verileriniz yukarıdaki amaçlarla sınırlı olarak; kargo ve lojistik firmalarına, ödeme kuruluşlarına ([ödeme kuruluşu adı]), e-fatura/e-arşiv hizmet sağlayıcısına, barındırma ve yazılım altyapısı hizmet sağlayıcılarına, mali müşavirlik hizmeti alınan kişilere ve talep hâlinde yetkili kamu kurum ve kuruluşlarına aktarılabilir. Yurt dışında bulunan hizmet sağlayıcılara aktarım KVKK m. 9 hükümlerine uygun olarak yapılır. [Yurt dışı aktarım yapılan hizmetler listelenmelidir.]</p>
<h3>6. Toplama Yöntemi</h3>
<p>Verileriniz internet sitemiz, üyelik/sipariş/iletişim/numune/teklif formları, çerezler, e-posta, telefon ve WhatsApp kanalları aracılığıyla elektronik ortamda toplanır.</p>
<h3>7. Saklama Süresi</h3>
<p>Verileriniz işleme amacının gerektirdiği süre ve ilgili mevzuatta öngörülen süreler (ör. ticari defter ve belgeler için 10 yıl) boyunca saklanır, sürenin sonunda silinir, yok edilir veya anonim hâle getirilir.</p>
<h3>8. Haklarınız</h3>
<p>KVKK m. 11 uyarınca; verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, işleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, KVKK m. 7 şartları çerçevesinde silinmesini veya yok edilmesini isteme, bu işlemlerin aktarılan üçüncü kişilere bildirilmesini isteme, münhasıran otomatik sistemlerle analiz sonucu aleyhinize bir sonuç doğmasına itiraz etme ve kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme haklarına sahipsiniz.</p>
<h3>9. Başvuru</h3>
<p>Taleplerinizi “Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ”e uygun olarak yukarıdaki adrese yazılı olarak, KEP adresimize veya sistemimizde kayıtlı e-posta adresinizden [e-posta adresi] adresine iletebilirsiniz. Başvurular en geç 30 gün içinde ücretsiz olarak sonuçlandırılır.</p>`;

const distanceSales = `${draftNotice.tr}
<h2>Mesafeli Satış Sözleşmesi</h2>
<h3>1. Taraflar</h3>
<p><strong>SATICI</strong></p>
${sellerBlock}
<p><strong>ALICI:</strong> Sipariş sırasında adı, adresi ve iletişim bilgileri belirtilen kişi. [Alıcı bilgileri sipariş anında otomatik eklenir.]</p>
<h3>2. Konu</h3>
<p>İşbu sözleşme, ALICI’nın SATICI’ya ait internet sitesi üzerinden elektronik ortamda siparişini verdiği aşağıda nitelikleri ve satış fiyatı belirtilen ürünün satışı ve teslimine ilişkin olarak 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği hükümleri gereğince tarafların hak ve yükümlülüklerini düzenler.</p>
<h3>3. Sözleşme Konusu Ürün</h3>
<p>Ürünlerin cinsi, türü, miktarı, satış bedeli (KDV dâhil), ödeme şekli ve teslimat bilgileri sipariş özetinde yer aldığı gibidir. [Sipariş özeti ödeme adımında otomatik eklenir.]</p>
<h3>4. Genel Hükümler</h3>
<ul>
<li>ALICI, ürünün temel nitelikleri, satış fiyatı, ödeme şekli ve teslimata ilişkin ön bilgileri okuyup bilgi sahibi olduğunu ve elektronik ortamda gerekli teyidi verdiğini kabul eder.</li>
<li>Ürün, yasal 30 günlük süreyi aşmamak kaydıyla, sipariş özetinde belirtilen süre içinde ALICI’nın bildirdiği adrese teslim edilir.</li>
<li>Teslimat sırasında hasarlı olduğu görülen paketler için kargo görevlisine tutanak tutturulması önerilir.</li>
<li>SATICI, siparişin stok yetersizliği gibi nedenlerle yerine getirilemeyeceğini öğrenirse ALICI’yı bilgilendirir ve tahsil edilen bedeli en geç 14 gün içinde iade eder.</li>
</ul>
<h3>5. Cayma Hakkı</h3>
<p>ALICI, ürünü teslim aldığı tarihten itibaren 14 gün içinde herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin cayma hakkına sahiptir. Cayma bildirimi yukarıdaki iletişim kanallarından yazılı olarak yapılabilir. Cayma hakkının kullanılmasından itibaren 14 gün içinde ürün bedeli ALICI’ya ödediği yöntemle iade edilir; ALICI ürünü 10 gün içinde geri gönderir. [İade kargo bedelinin kimde olduğu belirtilmelidir.]</p>
<h3>6. Cayma Hakkının İstisnaları</h3>
<p>Mesafeli Sözleşmeler Yönetmeliği m. 15 uyarınca; tesliminden sonra ambalaj, bant, mühür, paket gibi koruyucu unsurları açılmış olan ve iadesi sağlık ve hijyen açısından uygun olmayan ürünlerde cayma hakkı kullanılamaz. Kozmetik ürünlerin ambalajı açılmamış ve kullanılmamış olması gerekir.</p>
<h3>7. Uyuşmazlıkların Çözümü</h3>
<p>İşbu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar dâhilinde ALICI’nın veya SATICI’nın yerleşim yerindeki Tüketici Hakem Heyetleri, bu sınırları aşan durumlarda Tüketici Mahkemeleri yetkilidir.</p>
<h3>8. Yürürlük</h3>
<p>ALICI, siparişi onayladığında işbu sözleşmenin tüm koşullarını kabul etmiş sayılır. Sözleşme, siparişin onaylandığı tarihte yürürlüğe girer.</p>
<p><em>Kurumsal (tacir) alımlarda tüketici mevzuatından doğan cayma hakkı uygulanmaz; bu alımlar ayrıca kararlaştırılan teklif ve satış koşullarına tabidir.</em></p>`;

const preInformation = `${draftNotice.tr}
<h2>Ön Bilgilendirme Formu</h2>
<h3>1. Satıcı Bilgileri</h3>
${sellerBlock}
<h3>2. Ürünün Temel Nitelikleri ve Fiyatı</h3>
<p>Ürünlerin temel nitelikleri ürün sayfalarında yer alır. Siparişe konu ürünlerin adı, adedi, KDV dâhil birim ve toplam fiyatı, kargo ve varsa ek ücretler (ör. kapıda ödeme hizmet bedeli) sipariş özetinde gösterilir. [Sipariş özeti ödeme adımında otomatik eklenir.]</p>
<h3>3. Ödeme ve Teslimat</h3>
<ul>
<li>Ödeme; kredi/banka kartı, havale/EFT veya kapıda ödeme seçeneklerinden biriyle yapılabilir. Seçeneklerin güncel koşulları ödeme adımında gösterilir.</li>
<li>Ürünler, yasal 30 günlük süreyi aşmamak kaydıyla sipariş özetinde belirtilen sürede, ALICI’nın bildirdiği adrese kargo ile teslim edilir.</li>
<li>Belirli bir tutarın üzerindeki siparişlerde kargo ücretsizdir; ağır gönderiler (ör. 20 L bidon) için ek kargo bedeli uygulanabilir. Güncel tutarlar sepet ve ödeme adımında gösterilir.</li>
</ul>
<h3>4. Cayma Hakkı</h3>
<p>ALICI, ürünü teslim aldığı tarihten itibaren 14 gün içinde gerekçe göstermeksizin cayma hakkını kullanabilir. Ambalajı, bandı veya mührü açılmış ve iadesi sağlık ve hijyen açısından uygun olmayan kozmetik ürünlerde cayma hakkı kullanılamaz. Cayma bildirimi ve iade süreci için “İade ve Değişim” sayfasına bakınız.</p>
<h3>5. Şikâyet ve İtiraz</h3>
<p>Şikâyetlerinizi yukarıdaki iletişim bilgilerinden iletebilirsiniz. Uyuşmazlıklarda, parasal sınırlar dâhilinde Tüketici Hakem Heyetlerine, aşan durumlarda Tüketici Mahkemelerine başvurabilirsiniz.</p>`;

const cookies = `${draftNotice.tr}
<h2>Çerez Politikası</h2>
<p>${COMPANY.name} olarak internet sitemizde çerezler ve benzeri teknolojiler kullanıyoruz. Bu politika, hangi çerezleri neden kullandığımızı ve tercihlerinizi nasıl yönetebileceğinizi açıklar.</p>
<h3>1. Çerez Nedir?</h3>
<p>Çerezler, bir internet sitesini ziyaret ettiğinizde tarayıcınıza kaydedilen küçük metin dosyalarıdır.</p>
<h3>2. Kullandığımız Çerezler</h3>
<ul>
<li><strong>Zorunlu çerezler:</strong> oturum, sepet, güvenlik, dil ve tema (açık/koyu) tercihi gibi sitenin çalışması için gerekli çerezlerdir. Bu çerezler için izin alınmaz.</li>
<li><strong>Analitik çerezler:</strong> sitenin nasıl kullanıldığını anonim olarak ölçmemize yardımcı olur. Yalnızca izin vermeniz hâlinde kullanılır. [Kullanılan araçlar listelenmelidir.]</li>
<li><strong>Pazarlama çerezleri:</strong> ilgi alanınıza uygun içerik göstermek için kullanılır. Yalnızca izin vermeniz hâlinde kullanılır. [Kullanılan araçlar listelenmelidir.]</li>
</ul>
<h3>3. Tercihlerinizi Yönetme</h3>
<p>Zorunlu olmayan çerezlere ilişkin tercihinizi site üzerindeki çerez panelinden dilediğiniz zaman değiştirebilirsiniz. Tarayıcı ayarlarınızdan çerezleri silebilir veya engelleyebilirsiniz; zorunlu çerezlerin engellenmesi sitenin bazı bölümlerinin çalışmamasına yol açabilir.</p>
<h3>4. İletişim</h3>
<p>Kişisel verilerinizin işlenmesine ilişkin ayrıntılar için KVKK Aydınlatma Metni’ni inceleyebilir, sorularınızı ${COMPANY.phone} numaralı telefondan veya [e-posta adresi] adresinden iletebilirsiniz.</p>`;

const returns = `${draftNotice.tr}
<h2>İade ve Değişim Koşulları</h2>
<h3>1. Cayma Hakkı (14 Gün)</h3>
<p>Ürünü teslim aldığınız tarihten itibaren 14 gün içinde gerekçe göstermeksizin iade edebilirsiniz. İade edilecek ürünün ambalajı açılmamış, kullanılmamış ve yeniden satılabilir durumda olması gerekir.</p>
<h3>2. İade Edilemeyen Ürünler</h3>
<p>Ambalajı, bandı veya mührü açılmış ve iadesi sağlık ve hijyen açısından uygun olmayan kozmetik ürünler (sıvı el sabunu, duş jeli vb.) iade edilemez. Ücretsiz numuneler iade kapsamında değildir.</p>
<h3>3. İade Süreci</h3>
<ol>
<li>İade talebinizi sipariş numaranızla birlikte ${COMPANY.phone} numaralı telefondan veya [e-posta adresi] adresinden bize iletin.</li>
<li>Ürünü, faturası ile birlikte orijinal ambalajında, size bildirilen kargo firmasıyla en geç 10 gün içinde gönderin. [İade kargo bedelinin kimde olduğu belirtilmelidir.]</li>
<li>İade bedeli, ürün tarafımıza ulaştıktan ve kontrol edildikten sonra en geç 14 gün içinde ödeme yaptığınız yönteme iade edilir.</li>
</ol>
<h3>4. Hasarlı veya Ayıplı Ürün</h3>
<p>Kargo paketi hasarlı ulaştıysa teslim almadan önce kargo görevlisine tutanak tutturunuz. Ayıplı ürünlerde 6502 sayılı Kanun m. 11 kapsamındaki seçimlik haklarınızı (bedel iadesi, indirim, ücretsiz onarım veya ayıpsız misliyle değişim) kullanabilirsiniz; bu durumda kargo bedeli tarafımızca karşılanır.</p>
<h3>5. Değişim</h3>
<p>Ambalajı açılmamış ürünlerde, stok durumuna göre farklı bir koku veya ambalajla değişim yapılabilir. Değişim talepleri iade süreciyle aynı şekilde iletilir.</p>
<p><em>Kurumsal (tacir) alımlarda iade ve değişim koşulları ayrıca kararlaştırılır.</em></p>`;

/** ACCOUNTS (day 4): the membership agreement accepted on /hesap/kayit (legal key `membership`). */
const membership = `${draftNotice.tr}
<h2>Üyelik Sözleşmesi</h2>
<h3>1. Taraflar</h3>
<p>İşbu Üyelik Sözleşmesi (“Sözleşme”), bir tarafta aşağıda bilgileri yer alan ${COMPANY.name} (“PRESTİJ”) ile diğer tarafta internet sitesi üzerinden üyelik formunu doldurarak üye olan gerçek kişi (“Üye”) arasında, Üye’nin bu Sözleşme’yi elektronik ortamda onaylamasıyla kurulmuştur.</p>
${sellerBlock}
<h3>2. Konu</h3>
<p>Sözleşme’nin konusu; Üye’nin internet sitesindeki üyelik hizmetlerinden (sipariş takibi, adres defteri, favoriler, kurumsal hesap başvurusu, abonelik ve benzeri hizmetler) yararlanma koşullarının ve tarafların hak ve yükümlülüklerinin belirlenmesidir. Siparişler ayrıca her sipariş sırasında onaylanan Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi’ne tabidir.</p>
<h3>3. Üyelik ve Hesap Güvenliği</h3>
<ul>
<li>Üyelik, 18 yaşını doldurmuş ve fiil ehliyetine sahip gerçek kişiler içindir. Üye, formda verdiği bilgilerin doğru ve güncel olduğunu kabul eder.</li>
<li>Üyelik, Üye’nin e-posta adresine gönderilen doğrulama bağlantısının onaylanmasıyla etkinleşir.</li>
<li>Şifrenin gizliliğinden ve hesabın yetkisiz kişilerce kullanılmasını önlemekten Üye sorumludur. Hesabın yetkisiz kullanıldığından şüphelenen Üye, şifresini derhâl değiştirmeli ve PRESTİJ’i bilgilendirmelidir.</li>
<li>Üye, hesabını üçüncü kişilere devredemez veya kullandıramaz.</li>
</ul>
<h3>4. Tarafların Hak ve Yükümlülükleri</h3>
<ul>
<li>Üye, internet sitesini hukuka, genel ahlaka ve bu Sözleşme’ye uygun kullanmayı; sitenin işleyişini bozacak, güvenliğini tehlikeye atacak veya başkalarının haklarını ihlal edecek davranışlardan kaçınmayı kabul eder.</li>
<li>PRESTİJ, internet sitesinin içeriğini, sunulan hizmetleri ve fiyatları önceden bildirmeksizin değiştirme hakkını saklı tutar; verilmiş siparişler, sipariş anındaki koşullara tabidir.</li>
<li>PRESTİJ, bu Sözleşme’ye veya mevzuata aykırı kullanım tespit ettiğinde üyeliği geçici olarak askıya alabilir veya sona erdirebilir.</li>
<li>Ürün değerlendirmeleri yayımlanmadan önce incelenir; hukuka aykırı, yanıltıcı veya kişilik haklarını ihlal eden içerikler yayımlanmaz.</li>
</ul>
<h3>5. Kişisel Veriler</h3>
<p>Üye’nin kişisel verileri, 6698 sayılı Kişisel Verilerin Korunması Kanunu’na uygun olarak ve KVKK Aydınlatma Metni’nde açıklanan amaç ve hukuki sebeplerle işlenir. Üye, KVKK m. 11 kapsamındaki haklarını Aydınlatma Metni’ndeki iletişim kanallarından kullanabilir.</p>
<h3>6. Ticari Elektronik İleti</h3>
<p>Kampanya ve yenilik e-postaları yalnızca Üye’nin ayrıca vereceği açık onay ve e-posta adresine gönderilen bağlantının doğrulanması (çift onay) ile gönderilir. Üye, bu izni “Hesabım › Üyelik bilgilerim” sayfasından veya her e-postadaki bağlantıdan dilediği zaman geri alabilir. Sipariş ve hesap güvenliğiyle ilgili bilgilendirmeler ticari ileti niteliğinde değildir ve izin gerektirmez.</p>
<h3>7. Fikri Mülkiyet</h3>
<p>İnternet sitesindeki marka, logo, görsel, metin ve tasarımlar PRESTİJ’e veya lisans verenlerine aittir; izinsiz kopyalanamaz, çoğaltılamaz ve kullanılamaz.</p>
<h3>8. Üyeliğin Sona Ermesi ve Hesabın Silinmesi</h3>
<ul>
<li>Üye, “Hesabım › Üyelik bilgilerim” sayfasından şifresini doğrulayarak hesabını dilediği zaman silebilir.</li>
<li>Hesap silindiğinde Üye’nin adı, e-posta adresi, telefonu ve şifresi hesaptan silinir; kayıtlı adresleri, favorileri ve sepeti silinir, varsa abonelikleri iptal edilir ve tüm oturumları kapatılır.</li>
<li>Verilmiş siparişlere ilişkin kayıtlar ve faturalar, Türk Ticaret Kanunu ve Vergi Usul Kanunu’ndaki saklama yükümlülükleri nedeniyle yasal süre boyunca saklanır; bu kayıtlar artık bir üyelik hesabına bağlı değildir.</li>
</ul>
<h3>9. Sözleşme Değişiklikleri</h3>
<p>PRESTİJ, bu Sözleşme’yi mevzuat değişiklikleri veya hizmetlerdeki değişiklikler nedeniyle güncelleyebilir. Güncel metin internet sitesinde yayımlanır; esaslı değişiklikler Üye’ye e-posta ile bildirilir. [Bildirim ve onay usulü hukukçu tarafından değerlendirilmelidir.]</p>
<h3>10. Uyuşmazlıkların Çözümü</h3>
<p>Bu Sözleşme’den doğan uyuşmazlıklarda Türk hukuku uygulanır. Tüketici sıfatını taşıyan Üye bakımından, Ticaret Bakanlığınca ilan edilen parasal sınırlar dâhilinde Tüketici Hakem Heyetleri, bu sınırları aşan durumlarda Tüketici Mahkemeleri yetkilidir.</p>
<h3>11. Yürürlük</h3>
<p>Üye, üyelik formundaki onay kutusunu işaretleyerek bu Sözleşme’nin tamamını okuduğunu, anladığını ve kabul ettiğini beyan eder. Sözleşme, üyeliğin oluşturulduğu tarihte yürürlüğe girer ve üyelik sona erene kadar geçerlidir.</p>`;

// ---------------------------------------------------------------------------------------------------
// CONTENT (day 6): "Hediye Çarkı Kampanya Koşulları" (legal key `wheel_terms`, page
// /sayfa/hediye-carki-kampanya-kosullari), linked from the gift wheel dialog ("Çarkı çevirerek Kampanya
// Koşulları’nı kabul etmiş olursun"). A draft for the lawyer like the texts above, marked "taslak — avukat
// onayı bekliyor", but written out in full in tr/en/ar because visitors open it from the wheel in their own
// language (the Turkish text stays the binding one). It describes only what the shop actually does
// (docs/DAY6-WHEEL-VIDEO.md §1.1; the money engine src/lib/cart/compute.ts and coupon rules
// src/lib/coupons/eligibility.ts; a cancelled order releases its coupon in src/lib/orders/status.ts) and
// names no figure the owner can change in the panel (prize validity, hold time, slices, minimums): the
// wheel's own screens show those. Internal links are stored locale-less (/sayfa/…) and point to the
// reader's language on the storefront (localizeBodyLinks).

/** Legal key of the gift wheel campaign terms (the page and the wheel dialog link refer to it). */
export const WHEEL_TERMS_KEY = "wheel_terms";

const wheelDraftNotice = {
  tr: `<aside class="legal-draft" role="note"><p><strong>TASLAK METİN (${LEGAL_VERSION}) — avukat onayı bekliyor.</strong> Bu kampanya koşulları bir taslaktır; kampanya yayına alınmadan önce bir avukat tarafından incelenmeli ve onaylanmalıdır. Köşeli parantez içindeki alanlar doldurulmalıdır.</p></aside>`,
  en: `<aside class="legal-draft" role="note"><p><strong>DRAFT (${LEGAL_VERSION}) — awaiting legal review.</strong> These campaign terms are a draft and must be reviewed by a lawyer before the campaign goes live. The legally binding version is the Turkish text.</p></aside>`,
  ar: `<aside class="legal-draft" role="note"><p><strong>مسودة (${LEGAL_VERSION}) — بانتظار مراجعة المحامي.</strong> شروط الحملة هذه مسودة ويجب أن يراجعها محامٍ قبل إطلاق الحملة. النسخة الملزمة قانونيًا هي النص التركي.</p></aside>`,
};

const wheelTermsTr = `${wheelDraftNotice.tr}
<h2>Hediye Çarkı Kampanya Koşulları</h2>
<p>Bu koşullar, ${COMPANY.name} (“PRESTİJ”) tarafından internet sitesinde düzenlenen “Hediye Çarkı” kampanyasının (“Kampanya”) kurallarını düzenler. Çarkı çeviren her ziyaretçi (“Katılımcı”) bu koşulları kabul etmiş sayılır.</p>
<h3>1. Düzenleyen</h3>
${sellerBlock}
<h3>2. Kampanya Dönemi</h3>
<p>Kampanya [başlangıç tarihi] tarihinde başlar ve [bitiş tarihi] tarihinde sona erer; bitiş tarihi belirlenmemişse PRESTİJ’in bu sayfada duyuracağı tarihe kadar sürer. PRESTİJ, Kampanya’yı erken sona erdirebilir veya uzatabilir; değişiklikler bu sayfada duyurulur. Çark, internet sitesinde yalnızca Kampanya süresince gösterilir.</p>
<h3>3. Katılım Şartları</h3>
<ul>
<li>Kampanya’ya 18 yaşını doldurmuş gerçek kişiler katılabilir. Ödülün alınabilmesi için internet sitesinde ücretsiz üye olunması veya mevcut üyelik hesabıyla giriş yapılması gerekir; üyelik <a href="/sayfa/uyelik-sozlesmesi">Üyelik Sözleşmesi</a>’ne tabidir.</li>
<li>Çark, Kampanya ayarlarına göre ya henüz sipariş vermemiş ziyaretçilere ve üyelere ya da tüm ziyaretçilere gösterilir. Kampanya’nın yalnızca yeni müşterilere açık olduğu dönemlerde, daha önce aynı hesapla veya aynı e-posta adresiyle sipariş verilmişse ödül tanımlanmaz.</li>
<li>PRESTİJ çalışanları ve site yönetim paneline erişimi olan hesaplar Kampanya’ya katılamaz.</li>
<li>Kurumsal (tacir) müşteri hesapları, PRESTİJ ayrıca duyurmadıkça Kampanya’ya katılamaz.</li>
</ul>
<h3>4. Çarkın Çevrilmesi ve Sonucun Belirlenmesi</h3>
<ul>
<li>Çarkı çevirmek ücretsizdir ve alışveriş yapma şartına bağlı değildir.</li>
<li>Çarkta boş dilim yoktur; her dilim bir ödüldür. Dilimlerin gelme olasılıkları birbirinden farklı olabilir.</li>
<li>Sonuç, çark çevrildiği anda PRESTİJ’in sistemi tarafından rastgele belirlenir. Ekrandaki çark hareketi yalnızca bu sonucu gösterir; sonuç Katılımcının becerisine bağlı değildir.</li>
<li>Her Katılımcı bir Kampanya turunda çarkı bir kez çevirebilir. Çark aynı tarayıcıda yeniden açıldığında aynı sonuç gösterilir.</li>
</ul>
<h3>5. Ödülün Hesaba Tanımlanması</h3>
<ul>
<li>Üye girişi yapmış Katılımcının ödülü, sonuç ekranından alındığı anda hesabına tanımlanır.</li>
<li>Üye girişi yapmamış Katılımcı, ödülünü sonuç ekranında gösterilen tarihe kadar ücretsiz üye olarak veya üye girişi yaparak alabilir. Yeni üyelikte ödül, e-posta adresi doğrulandığında hesaba tanımlanır. Bu tarihe kadar alınmayan ödülün hakkı düşer.</li>
<li>Bir üyelik hesabına her Kampanya turunda yalnızca bir ödül tanımlanır. PRESTİJ yeni bir tur başlattığında Katılımcılar çarkı yeniden çevirebilir; önceki turlarda tanımlanan ödüller bundan etkilenmez.</li>
<li>Ödül, Katılımcının hesabına tanımlanan ve yalnızca o hesapla kullanılabilen tek kullanımlık bir indirim kodudur. Kod ve son kullanım tarihi ödül ekranında, hesap sayfasında ve sepette gösterilir; ayrıca hesabın e-posta adresine gönderilir.</li>
</ul>
<h3>6. Ödül Türleri ve Koşulları</h3>
<ul>
<li><strong>Yüzde indirim:</strong> sepetteki ürünlerin toplam tutarından belirtilen oranda indirim sağlar.</li>
<li><strong>Tutar indirimi:</strong> belirtilen tutar kadar indirim sağlar. İndirim, sepetteki ürünlerin toplam tutarını aşamaz; aşan kısım kullanılamaz.</li>
<li><strong>Ücretsiz kargo:</strong> standart kargo ücretini karşılar. Ağır gönderiler için alınan ek kargo ücreti bu ödüle dahil değildir.</li>
<li>Bazı ödüller asgari sepet tutarına bağlıdır; bu tutar sonuç ekranında ve sepette belirtilir. Asgari tutar; kargo ücreti ve ücretsiz numuneler hariç, indirim uygulanmadan önceki KDV dâhil ürün toplamına göre hesaplanır.</li>
<li>İndirimler yalnızca satışa sunulan ürünlere uygulanır; ücretsiz numuneler indirim kapsamında değildir. Tüm tutarlara KDV dâhildir.</li>
</ul>
<h3>7. Geçerlilik Süresi ve Kullanım</h3>
<ul>
<li>Ödül, hesaba tanımlandığı andan başlayarak Kampanya için belirlenen süre boyunca geçerlidir. Son kullanım tarihi ve saati ödül ekranında, hesap sayfasında, sepette ve e-postada gösterilir. Süresi dolan ödül kullanılamaz ve süresi uzatılmaz.</li>
<li>Ödül yalnızca bu internet sitesinden, ödülün tanımlandığı hesapla giriş yapılarak verilen tek bir siparişte kullanılabilir.</li>
<li>Sepette ürün varsa ve başka bir indirim kodu kullanılmıyorsa ödül sepete kendiliğinden uygulanır; aksi hâlde hesapta saklanır ve sonraki uygun sepette kendiliğinden uygulanır. Ödül, Katılımcının kendi girdiği bir indirim kodunun yerine geçmez.</li>
</ul>
<h3>8. Nakde Çevrilemezlik ve Devredilemezlik</h3>
<ul>
<li>Ödül nakde çevrilemez; karşılığında para veya başka bir ürün istenemez.</li>
<li>Ödül kişiye özeldir; başka bir hesaba aktarılamaz, satılamaz ve başkası tarafından kullanılamaz.</li>
</ul>
<h3>9. Diğer İndirimlerle Birlikte Kullanım</h3>
<ul>
<li>Bir siparişte yalnızca bir indirim kodu kullanılabilir; ödül başka bir indirim koduyla birleştirilemez.</li>
<li>Ödül, sitede o sırada geçerli olan kampanyalı ürün fiyatları, abonelik indirimi ve havale/EFT indirimi gibi diğer indirimlerle birlikte uygulanabilir. Havale/EFT indirimi, ödül indirimi düşüldükten sonraki tutar üzerinden hesaplanır.</li>
<li>Ücretsiz kargo sınırına ulaşılıp ulaşılmadığı, ödül indirimi düşüldükten sonraki ürün toplamına göre belirlenir.</li>
</ul>
<h3>10. Sipariş İptali ve İade</h3>
<ul>
<li>Ödülün kullanıldığı sipariş teslim edilmeden iptal edilirse ödül, son kullanım tarihi geçmemişse yeniden kullanılabilir; son kullanım tarihi değişmez.</li>
<li>Teslim edilen ürünler cayma hakkı kapsamında iade edildiğinde, iade tutarı bu ürünler için siparişte fiilen ödenen (indirim düşülmüş) tutardır; ödül yeniden tanımlanmaz.</li>
</ul>
<h3>11. Kötüye Kullanım</h3>
<ul>
<li>Birden fazla hesap açmak, gerçeğe aykırı veya başkasına ait bilgilerle üye olmak, otomatik yazılım (bot) kullanmak ya da Kampanya’yı başka yollarla yanıltmaya çalışmak yasaktır.</li>
<li>Kötüye kullanım tespit edilirse PRESTİJ ilgili ödülü iptal edebilir ve Katılımcıyı Kampanya’dan çıkarabilir. [Kötüye kullanılarak alınmış bir ödülle verilen siparişlerde uygulanacak işlem hukukçu tarafından belirlenmelidir.]</li>
<li>Teknik bir hata nedeniyle yanlış tanımlanan bir ödülü düzeltme hakkı PRESTİJ’e aittir.</li>
<li>Kötüye kullanımı önlemek için aynı internet bağlantısından yapılabilecek çevirme ve ödül alma sayısı sınırlandırılabilir.</li>
</ul>
<h3>12. Kişisel Veriler</h3>
<ul>
<li>Çarkı çevirmek için ad, e-posta veya telefon gibi bilgiler istenmez. Çark sonucu; ödül, Kampanya turu, dil, çarkın çevrildiği sayfanın adresi, tarih ve saat ile kötüye kullanımı önlemek için IP adresinden üretilen tek yönlü bir özet değerle birlikte kaydedilir; IP adresinin kendisi saklanmaz.</li>
<li>Çark sonucunu hatırlamak için tarayıcıya “prestij_wheel” adlı zorunlu bir çerez yerleştirilir; çerez, sonucun saklandığı süre boyunca tutulur. Çarkı gizleme tercihleri yalnızca Katılımcının tarayıcısında saklanır.</li>
<li>Ödül alınmamış çark kayıtları en geç 30 gün içinde silinir. Ödül hesaba tanımlandığında çark kaydı o hesapla ilişkilendirilir.</li>
<li>Ödülü almak için üye olurken veya giriş yaparken verilen bilgiler, <a href="/sayfa/kvkk">KVKK Aydınlatma Metni</a>’nde açıklanan amaçlarla ve Üyelik Sözleşmesi kapsamında işlenir. Hesap silindiğinde kullanılmamış ödüller geçersiz olur.</li>
<li>Ödül hesaba tanımlandığında ödülü, kodu ve son kullanım tarihini bildiren bir e-posta gönderilir. Ödülün süresi dolmadan önce gönderilen hatırlatma e-postası yalnızca e-bülten almayı kabul edip bu izni onaylamış üyelere gönderilir. [Hatırlatma e-postasının ticari elektronik ileti sayılıp sayılmadığı hukukçu tarafından değerlendirilmelidir.]</li>
</ul>
<h3>13. Kampanyada Değişiklik</h3>
<p>PRESTİJ; Kampanya’yı, çarktaki dilimleri, ödülleri ve bu koşulları ileriye dönük olarak değiştirebilir, durdurabilir veya sona erdirebilir. Değişiklikler bu sayfada yayımlanır. Hesaba tanımlanmış bir ödül, son kullanım tarihine kadar tanımlandığı andaki koşullarla geçerliliğini korur.</p>
<h3>14. Diğer Hükümler</h3>
<p>Bu koşullarda düzenlenmeyen konularda <a href="/sayfa/mesafeli-satis-sozlesmesi">Mesafeli Satış Sözleşmesi</a>, Üyelik Sözleşmesi ve ilgili mevzuat hükümleri uygulanır. Sorularınızı ${COMPANY.phone} numaralı telefondan veya [e-posta adresi] adresinden iletebilirsiniz. [Kampanyanın izne tabi bir çekiliş veya piyango sayılıp sayılmadığı hukukçu tarafından değerlendirilmelidir.]</p>`;

const wheelTermsEn = `${wheelDraftNotice.en}
<h2>Gift Wheel Campaign Terms</h2>
<p>These terms set out the rules of the “Gift Wheel” campaign (the “Campaign”) run on this website by ${COMPANY.name} (“PRESTİJ”). Every visitor who spins the wheel (a “Participant”) accepts these terms.</p>
<h3>1. Organiser</h3>
<ul>
<li><strong>Company:</strong> ${COMPANY.name}</li>
<li><strong>Address:</strong> ${COMPANY.address}, Türkiye</li>
<li><strong>Phone:</strong> +90 352 353 30 70</li>
<li><strong>Email:</strong> [email address]</li>
</ul>
<h3>2. Campaign period</h3>
<p>The Campaign runs from [start date] to [end date]; if no end date is set, it runs until a date PRESTİJ announces on this page. PRESTİJ may end the Campaign early or extend it and announces any change on this page. The wheel is shown on the website only while the Campaign is running.</p>
<h3>3. Who can take part</h3>
<ul>
<li>Individuals aged 18 or over can take part. To claim a prize you need a free customer account on this website: sign up, or sign in to your existing account. Accounts are governed by the <a href="/sayfa/uyelik-sozlesmesi">Membership Agreement</a>.</li>
<li>Depending on the campaign settings, the wheel is shown either to visitors and customers who have not ordered yet, or to all visitors. While the Campaign is open to new customers only, no prize is given if an order has already been placed with the same account or the same email address.</li>
<li>PRESTİJ employees and accounts with access to the site's management panel cannot take part.</li>
<li>Business (trade) customer accounts cannot take part unless PRESTİJ announces otherwise.</li>
</ul>
<h3>4. Spinning the wheel and how the result is decided</h3>
<ul>
<li>Spinning the wheel is free and does not require a purchase.</li>
<li>There are no empty slices: every slice is a prize. Slices may have different chances of coming up.</li>
<li>The result is chosen at random by PRESTİJ's system at the moment you spin. The movement of the wheel on the screen only shows that result; it does not depend on any skill.</li>
<li>Each Participant can spin the wheel once per campaign round. If the wheel is opened again in the same browser, the same result is shown.</li>
</ul>
<h3>5. Adding the prize to your account</h3>
<ul>
<li>If you are signed in, the prize is added to your account when you claim it on the result screen.</li>
<li>If you are not signed in, you can claim the prize until the date shown on the result screen by signing up for free or signing in. For a new account, the prize is added once you confirm your email address. If the prize is not claimed by that date, the right to it lapses.</li>
<li>Each account can receive only one prize per campaign round. When PRESTİJ starts a new round, Participants can spin again; prizes added in earlier rounds are not affected.</li>
<li>The prize is a single-use discount code added to your account and usable only with that account. The code and its expiry are shown on the prize screen, on your account page and in the cart, and are also sent to your account's email address.</li>
</ul>
<h3>6. Prize types and conditions</h3>
<ul>
<li><strong>Percentage discount:</strong> the stated percentage off the total of the products in your cart.</li>
<li><strong>Amount discount:</strong> the stated amount off. It cannot exceed the total of the products in your cart; any remainder cannot be used.</li>
<li><strong>Free shipping:</strong> covers the standard shipping fee. The additional fee for heavy parcels is not included.</li>
<li>Some prizes require a minimum basket, shown on the result screen and in the cart. The minimum is calculated on the product total including VAT, before the discount, excluding shipping and free samples.</li>
<li>Discounts apply only to products for sale; free samples are not discounted. All amounts include VAT.</li>
</ul>
<h3>7. Validity and use</h3>
<ul>
<li>A prize is valid for the period set for the Campaign, counted from the moment it is added to your account. The expiry date and time are shown on the prize screen, on your account page, in the cart and in the email. An expired prize cannot be used or extended.</li>
<li>A prize can be used on one order placed on this website while signed in to the account it was added to.</li>
<li>If your cart contains products and no other discount code, the prize is applied automatically; otherwise it is kept in your account and applied automatically to a suitable cart later. It never replaces a discount code you entered yourself.</li>
</ul>
<h3>8. No cash value, not transferable</h3>
<ul>
<li>Prizes have no cash value and cannot be exchanged for money or other products.</li>
<li>Prizes are personal: they cannot be transferred to another account, sold or used by anyone else.</li>
</ul>
<h3>9. Combining with other offers</h3>
<ul>
<li>Only one discount code can be used per order; a prize cannot be combined with another discount code.</li>
<li>A prize can be used together with other discounts available on the site at the time, such as campaign prices, the subscription discount and the bank transfer discount. The bank transfer discount is calculated on the amount after the prize discount.</li>
<li>Whether an order reaches the free shipping threshold is decided on the product total after the prize discount.</li>
</ul>
<h3>10. Cancellations and returns</h3>
<ul>
<li>If an order on which a prize was used is cancelled before delivery, the prize can be used again until its expiry, which does not change.</li>
<li>If delivered products are returned under the right of withdrawal, the refund is the amount actually paid for them on the order, after the discount; the prize is not added again.</li>
</ul>
<h3>11. Misuse</h3>
<ul>
<li>Opening several accounts, signing up with false or someone else's details, using bots or other automated tools, or otherwise trying to manipulate the Campaign is not allowed.</li>
<li>If misuse is found, PRESTİJ may cancel the prize concerned and exclude the Participant from the Campaign.</li>
<li>PRESTİJ may correct a prize that was added by mistake because of a technical error.</li>
<li>To prevent misuse, the number of spins and claims from the same internet connection may be limited.</li>
</ul>
<h3>12. Personal data</h3>
<ul>
<li>Spinning the wheel does not ask for your name, email address or phone number. The spin is recorded with the prize, the campaign round, the language, the address of the page, the date and time and, to prevent misuse, a one-way code derived from your IP address; the IP address itself is not stored.</li>
<li>A strictly necessary cookie named “prestij_wheel” remembers your result in your browser for as long as the result is kept. Your choices to hide the wheel are stored only in your browser.</li>
<li>Spin records without a claimed prize are deleted within 30 days. When a prize is added to your account, the spin record is linked to that account.</li>
<li>The details you give when you sign up or sign in to claim a prize are processed for the purposes described in the <a href="/sayfa/kvkk">Privacy Notice (KVKK)</a> and under the Membership Agreement. If you delete your account, unused prizes become invalid.</li>
<li>When a prize is added to your account, we send you an email with the prize, the code and the expiry. A reminder before the prize expires is sent only to members who have agreed to receive the newsletter and confirmed that consent.</li>
</ul>
<h3>13. Changes to the Campaign</h3>
<p>PRESTİJ may change, pause or end the Campaign, the slices of the wheel, the prizes and these terms for the future. Changes are published on this page. A prize already added to your account remains valid until its expiry under the terms that applied when it was added.</p>
<h3>14. Other provisions</h3>
<p>Matters not covered by these terms are governed by the <a href="/sayfa/mesafeli-satis-sozlesmesi">Distance Sales Agreement</a>, the Membership Agreement and the applicable law. For questions, call +90 352 353 30 70 or write to [email address].</p>`;

const wheelTermsAr = `${wheelDraftNotice.ar}
<h2>شروط حملة عجلة الهدايا</h2>
<p>توضّح هذه الشروط قواعد حملة «عجلة الهدايا» (ويُشار إليها بـ«الحملة») التي تنظّمها شركة ${COMPANY.name} (ويُشار إليها بـ«PRESTİJ») على هذا الموقع. ويُعدّ كل زائر يدير العجلة (ويُشار إليه بـ«المشارك») موافقًا على هذه الشروط.</p>
<h3>1. الجهة المنظِّمة</h3>
<ul>
<li><strong>الشركة:</strong> ${COMPANY.name}</li>
<li><strong>العنوان:</strong> ${COMPANY.address}، تركيا</li>
<li><strong>الهاتف:</strong> ‎+90 352 353 30 70</li>
<li><strong>البريد الإلكتروني:</strong> [عنوان البريد الإلكتروني]</li>
</ul>
<h3>2. مدة الحملة</h3>
<p>تسري الحملة من [تاريخ البدء] إلى [تاريخ الانتهاء]، وإذا لم يُحدَّد تاريخ للانتهاء فتستمر حتى تاريخ تعلنه شركة PRESTİJ في هذه الصفحة. ويجوز لها إنهاء الحملة قبل موعدها أو تمديدها، وتعلن أي تغيير في هذه الصفحة. ولا تظهر العجلة على الموقع إلا خلال مدة الحملة.</p>
<h3>3. من يحق له المشاركة</h3>
<ul>
<li>يحق للأشخاص الذين بلغوا 18 عامًا فأكثر المشاركة. وللحصول على الجائزة يلزم حساب عميل مجاني على هذا الموقع، إما بالتسجيل وإما بتسجيل الدخول إلى حسابك الحالي. وتخضع العضوية <a href="/sayfa/uyelik-sozlesmesi">لاتفاقية العضوية</a>.</li>
<li>بحسب إعدادات الحملة، تظهر العجلة إما للزوار والعملاء الذين لم يسبق لهم تقديم طلب، وإما لجميع الزوار. وعندما تكون الحملة مخصّصة للعملاء الجدد فقط، لا تُمنح جائزة إذا سبق تقديم طلب بالحساب نفسه أو بعنوان البريد الإلكتروني نفسه.</li>
<li>لا يحق لموظفي PRESTİJ ولا للحسابات التي تملك صلاحية الدخول إلى لوحة إدارة الموقع المشاركة في الحملة.</li>
<li>لا يحق لحسابات العملاء من الشركات (التجّار) المشاركة ما لم تعلن PRESTİJ خلاف ذلك.</li>
</ul>
<h3>4. تدوير العجلة وتحديد النتيجة</h3>
<ul>
<li>تدوير العجلة مجاني ولا يشترط الشراء.</li>
<li>لا توجد في العجلة أجزاء فارغة، فكل جزء جائزة. وقد تختلف فرص ظهور الأجزاء من جزء إلى آخر.</li>
<li>يحدّد نظام PRESTİJ النتيجة عشوائيًا لحظة التدوير. ولا تعرض حركة العجلة على الشاشة إلا هذه النتيجة، ولا تعتمد النتيجة على أي مهارة.</li>
<li>يمكن لكل مشارك تدوير العجلة مرة واحدة في كل جولة من جولات الحملة. وإذا فُتحت العجلة مجددًا في المتصفح نفسه تظهر النتيجة نفسها.</li>
</ul>
<h3>5. إضافة الجائزة إلى حسابك</h3>
<ul>
<li>إذا كنت مسجّل الدخول، تُضاف الجائزة إلى حسابك عندما تطلبها من شاشة النتيجة.</li>
<li>إذا لم تكن مسجّل الدخول، يمكنك طلب الجائزة حتى التاريخ الظاهر في شاشة النتيجة بالتسجيل مجانًا أو بتسجيل الدخول. وفي الحساب الجديد تُضاف الجائزة بعد تأكيد بريدك الإلكتروني. وإذا لم تُطلب الجائزة حتى ذلك التاريخ يسقط الحق فيها.</li>
<li>لا يُمنح كل حساب إلا جائزة واحدة في كل جولة. وعندما تبدأ PRESTİJ جولة جديدة يمكن للمشاركين تدوير العجلة مجددًا، ولا تتأثر بذلك الجوائز المضافة في الجولات السابقة.</li>
<li>الجائزة رمز خصم يُستخدم مرة واحدة، ويُضاف إلى حسابك ولا يمكن استخدامه إلا من خلاله. ويظهر الرمز وتاريخ انتهاء صلاحيته في شاشة الجائزة وفي صفحة حسابك وفي السلة، ويُرسَل أيضًا إلى البريد الإلكتروني المسجّل في حسابك.</li>
</ul>
<h3>6. أنواع الجوائز وشروطها</h3>
<ul>
<li><strong>خصم بنسبة مئوية:</strong> خصم بالنسبة المذكورة من إجمالي قيمة المنتجات في سلتك.</li>
<li><strong>خصم بمبلغ محدد:</strong> خصم بالمبلغ المذكور، ولا يمكن أن يتجاوز إجمالي قيمة المنتجات في سلتك، ولا يمكن استخدام ما يزيد على ذلك.</li>
<li><strong>شحن مجاني:</strong> يغطي رسوم الشحن العادية، ولا يشمل الرسوم الإضافية للشحنات الثقيلة.</li>
<li>تشترط بعض الجوائز حدًّا أدنى لقيمة السلة يظهر في شاشة النتيجة وفي السلة. ويُحتسب هذا الحد على إجمالي قيمة المنتجات شاملًا ضريبة القيمة المضافة وقبل الخصم، دون رسوم الشحن والعيّنات المجانية.</li>
<li>تُطبَّق الخصومات على المنتجات المعروضة للبيع فقط، ولا تشمل العيّنات المجانية. وجميع المبالغ شاملة ضريبة القيمة المضافة.</li>
</ul>
<h3>7. مدة الصلاحية والاستخدام</h3>
<ul>
<li>تبقى الجائزة صالحة طوال المدة المحددة للحملة اعتبارًا من لحظة إضافتها إلى حسابك. ويظهر تاريخ انتهاء الصلاحية ووقته في شاشة الجائزة وفي صفحة حسابك وفي السلة وفي البريد الإلكتروني. ولا يمكن استخدام الجائزة بعد انتهاء صلاحيتها ولا تمديدها.</li>
<li>يمكن استخدام الجائزة في طلب واحد يُقدَّم عبر هذا الموقع أثناء تسجيل الدخول إلى الحساب الذي أُضيفت إليه.</li>
<li>إذا كانت في سلتك منتجات ولم يُستخدم فيها رمز خصم آخر، تُطبَّق الجائزة تلقائيًا، وإلا فتُحفظ في حسابك وتُطبَّق تلقائيًا لاحقًا على سلة مناسبة. ولا تحلّ الجائزة أبدًا محل رمز خصم أدخلته بنفسك.</li>
</ul>
<h3>8. لا قيمة نقدية ولا قابلية للتحويل</h3>
<ul>
<li>لا قيمة نقدية للجوائز، ولا يمكن استبدالها بالمال أو بمنتجات أخرى.</li>
<li>الجوائز شخصية، فلا يمكن نقلها إلى حساب آخر أو بيعها أو استخدامها من قِبل شخص آخر.</li>
</ul>
<h3>9. الجمع مع العروض الأخرى</h3>
<ul>
<li>لا يمكن استخدام أكثر من رمز خصم واحد في الطلب الواحد، فلا تُجمع الجائزة مع رمز خصم آخر.</li>
<li>يمكن استخدام الجائزة مع الخصومات الأخرى المتاحة على الموقع في حينه، مثل أسعار الحملات وخصم الاشتراك وخصم التحويل البنكي. ويُحتسب خصم التحويل البنكي على المبلغ المتبقي بعد خصم الجائزة.</li>
<li>يُحدَّد بلوغ الحد الأدنى للشحن المجاني على أساس إجمالي قيمة المنتجات بعد خصم الجائزة.</li>
</ul>
<h3>10. الإلغاء والإرجاع</h3>
<ul>
<li>إذا أُلغي قبل التسليم طلبٌ استُخدمت فيه الجائزة، يمكن استخدام الجائزة مجددًا حتى تاريخ انتهاء صلاحيتها، ولا يتغير هذا التاريخ.</li>
<li>إذا أُعيدت منتجات مُسلَّمة بموجب حق الانسحاب، يكون المبلغ المسترد هو المبلغ المدفوع فعليًا عنها في الطلب بعد الخصم، ولا تُضاف الجائزة مرة أخرى.</li>
</ul>
<h3>11. إساءة الاستخدام</h3>
<ul>
<li>يُمنع فتح عدة حسابات أو التسجيل ببيانات غير صحيحة أو تخص شخصًا آخر أو استخدام برامج آلية أو محاولة التلاعب بالحملة بأي طريقة أخرى.</li>
<li>إذا ثبتت إساءة الاستخدام، يجوز لشركة PRESTİJ إلغاء الجائزة المعنية واستبعاد المشارك من الحملة.</li>
<li>يحق لشركة PRESTİJ تصحيح أي جائزة أُضيفت خطأً بسبب عطل تقني.</li>
<li>لمنع إساءة الاستخدام، قد يُحدَّد عدد مرات التدوير وطلب الجوائز من اتصال الإنترنت نفسه.</li>
</ul>
<h3>12. البيانات الشخصية</h3>
<ul>
<li>لا يُطلب منك عند تدوير العجلة اسمك أو بريدك الإلكتروني أو رقم هاتفك. وتُسجَّل نتيجة التدوير مع الجائزة وجولة الحملة واللغة وعنوان الصفحة والتاريخ والوقت، إضافة إلى رمز أحادي الاتجاه مشتق من عنوان IP الخاص بك لمنع إساءة الاستخدام، ولا يُحفظ عنوان IP نفسه.</li>
<li>يحفظ ملف تعريف ارتباط ضروري باسم «prestij_wheel» نتيجتك في متصفحك طوال مدة الاحتفاظ بها. أما اختياراتك بإخفاء العجلة فتُحفظ في متصفحك فقط.</li>
<li>تُحذف سجلات التدوير التي لم تُطلب جائزتها خلال 30 يومًا. وعند إضافة الجائزة إلى حسابك يُربط سجل التدوير بهذا الحساب.</li>
<li>تُعالَج البيانات التي تقدّمها عند التسجيل أو تسجيل الدخول للحصول على الجائزة للأغراض الموضحة في <a href="/sayfa/kvkk">إشعار حماية البيانات الشخصية (KVKK)</a> وفي إطار اتفاقية العضوية. وإذا حذفت حسابك تصبح الجوائز غير المستخدمة باطلة.</li>
<li>عند إضافة الجائزة إلى حسابك نرسل إليك رسالة بريد إلكتروني تتضمن الجائزة والرمز وتاريخ انتهاء الصلاحية. ولا تُرسل رسالة التذكير قبل انتهاء الصلاحية إلا إلى الأعضاء الذين وافقوا على تلقي النشرة البريدية وأكّدوا موافقتهم.</li>
</ul>
<h3>13. التغييرات على الحملة</h3>
<p>يجوز لشركة PRESTİJ تغيير الحملة وأجزاء العجلة والجوائز وهذه الشروط أو إيقافها أو إنهاؤها بأثر مستقبلي، وتُنشر التغييرات في هذه الصفحة. وتبقى الجائزة المضافة إلى حسابك صالحة حتى انتهاء صلاحيتها وفق الشروط التي كانت سارية عند إضافتها.</p>
<h3>14. أحكام أخرى</h3>
<p>تسري على المسائل التي لا تتناولها هذه الشروط أحكام <a href="/sayfa/mesafeli-satis-sozlesmesi">عقد البيع عن بُعد</a> واتفاقية العضوية والقوانين المعمول بها. وللاستفسارات يمكنك الاتصال على الرقم ‎+90 352 353 30 70 أو الكتابة إلى [عنوان البريد الإلكتروني].</p>`;

const summary = (en: string, ar: string): Pick<LocalizedText, "en" | "ar"> => ({
  en: `${draftNotice.en}<p>${en}</p><p>Seller: ${COMPANY.name}, ${COMPANY.address}, Türkiye. Phone: +90 352 353 30 70.</p>`,
  ar: `${draftNotice.ar}<p>${ar}</p><p>البائع: ${COMPANY.name}، ${COMPANY.address}، تركيا. الهاتف: ‎+90 352 353 30 70.</p>`,
});

/**
 * ACCOUNTS: the membership agreement (/hesap/kayit requires it). Seeded with the others; existing
 * databases get it from scripts/content-day4.ts (membershipLegalDoc).
 */
export const MEMBERSHIP_LEGAL_DOCUMENT: { key: string; title: LocalizedText; body: LocalizedText } = {
  key: "membership",
  title: { tr: "Üyelik Sözleşmesi", en: "Membership Agreement", ar: "اتفاقية العضوية" },
  body: {
    tr: membership,
    ...summary(
      "Summary: the terms of your PRESTİJ customer account. You must be 18 or over and keep your password safe; your account becomes active once you confirm your email address. Your personal data is processed as described in the Privacy Notice (KVKK). Marketing emails are sent only with your separate, confirmed consent, which you can withdraw at any time. You can delete your account at any time under My account › Account details: your personal details, addresses and favorites are removed, while order records are kept for the period required by Turkish commercial and tax law.",
      "ملخص: شروط حساب العميل لدى PRESTİJ. يجب أن يكون عمرك 18 عامًا أو أكثر وأن تحافظ على سرية كلمة المرور؛ ويُفعَّل حسابك بعد تأكيد بريدك الإلكتروني. تُعالَج بياناتك الشخصية وفقًا لإشعار حماية البيانات الشخصية (KVKK). لا تُرسل الرسائل التسويقية إلا بموافقتك المنفصلة المؤكدة، ويمكنك سحبها في أي وقت. يمكنك حذف حسابك في أي وقت من «حسابي › بيانات العضوية»: تُحذف بياناتك الشخصية وعناوينك ومفضلتك، بينما تُحفظ سجلات الطلبات للمدة التي يفرضها القانون التجاري والضريبي التركي.",
    ),
  },
};

/**
 * CONTENT (day 6): the gift wheel campaign terms (the wheel dialog links to them). Seeded with the others;
 * existing databases get them, with their page, from scripts/content-day6.ts (wheelTerms).
 */
export const WHEEL_TERMS_LEGAL_DOCUMENT: { key: string; title: LocalizedText; body: LocalizedText } = {
  key: WHEEL_TERMS_KEY,
  title: { tr: "Hediye Çarkı Kampanya Koşulları", en: "Gift Wheel Campaign Terms", ar: "شروط حملة عجلة الهدايا" },
  body: { tr: wheelTermsTr, en: wheelTermsEn, ar: wheelTermsAr },
};

export const LEGAL_DOCUMENTS: { key: string; title: LocalizedText; body: LocalizedText }[] = [
  {
    key: "kvkk",
    title: { tr: "KVKK Aydınlatma Metni", en: "Privacy Notice (KVKK)", ar: "إشعار حماية البيانات الشخصية (KVKK)" },
    body: {
      tr: kvkk,
      ...summary(
        "Summary: we process your identity, contact, order and (with consent) marketing data to take and deliver orders, issue invoices, answer requests and meet legal obligations, under Türkiye's Personal Data Protection Law No. 6698. Card details are handled by licensed payment providers and are not stored by us. You may exercise your rights under Article 11 by contacting us.",
        "ملخص: نعالج بيانات الهوية والاتصال والطلبات (وبيانات التسويق بموافقتك) لاستلام الطلبات وتوصيلها وإصدار الفواتير والرد على الطلبات والوفاء بالالتزامات القانونية، وفقًا لقانون حماية البيانات الشخصية التركي رقم 6698. تتولى مؤسسات دفع مرخّصة بيانات البطاقات ولا نخزّنها. يمكنك ممارسة حقوقك بموجب المادة 11 بالتواصل معنا.",
      ),
    },
  },
  {
    key: "distance_sales",
    title: { tr: "Mesafeli Satış Sözleşmesi", en: "Distance Sales Agreement", ar: "عقد البيع عن بُعد" },
    body: {
      tr: distanceSales,
      ...summary(
        "Summary: the agreement between the buyer and PRESTİJ for online orders under Turkish Consumer Protection Law No. 6502 and the Distance Contracts Regulation. Delivery within the stated time (max. 30 days); 14-day right of withdrawal, except for cosmetics whose protective seal has been opened, as they cannot be returned for health and hygiene reasons.",
        "ملخص: الاتفاق بين المشتري وPRESTİJ للطلبات عبر الإنترنت وفقًا لقانون حماية المستهلك التركي رقم 6502 ولائحة العقود عن بُعد. التسليم خلال المدة المحددة (30 يومًا كحد أقصى)؛ حق الانسحاب خلال 14 يومًا، باستثناء مستحضرات التجميل التي فُتح ختمها الواقي لأسباب صحية.",
      ),
    },
  },
  {
    key: "pre_information",
    title: { tr: "Ön Bilgilendirme Formu", en: "Preliminary Information Form", ar: "نموذج المعلومات المسبقة" },
    body: {
      tr: preInformation,
      ...summary(
        "Summary: before you order, this form sets out the seller's details, the main features and total price of the products (VAT included), shipping fees, payment and delivery terms, the 14-day right of withdrawal and how to file a complaint.",
        "ملخص: قبل الطلب، يوضح هذا النموذج بيانات البائع والخصائص الأساسية للمنتجات وسعرها الإجمالي (شاملًا ضريبة القيمة المضافة) ورسوم الشحن وشروط الدفع والتسليم وحق الانسحاب خلال 14 يومًا وطريقة تقديم الشكوى.",
      ),
    },
  },
  {
    key: "cookies",
    title: { tr: "Çerez Politikası", en: "Cookie Policy", ar: "سياسة ملفات تعريف الارتباط" },
    body: {
      tr: cookies,
      ...summary(
        "Summary: we use strictly necessary cookies (session, cart, security, language and theme preference). Analytics and marketing cookies are used only with your consent, which you can change at any time from the cookie panel.",
        "ملخص: نستخدم ملفات تعريف الارتباط الضرورية فقط (الجلسة والسلة والأمان واللغة وتفضيل المظهر). لا تُستخدم ملفات التحليلات والتسويق إلا بموافقتك، ويمكنك تغييرها في أي وقت من لوحة ملفات تعريف الارتباط.",
      ),
    },
  },
  {
    key: "returns",
    title: { tr: "İade ve Değişim Koşulları", en: "Returns & Exchanges", ar: "سياسة الإرجاع والاستبدال" },
    body: {
      tr: returns,
      ...summary(
        "Summary: unopened, unused products can be returned within 14 days of delivery. Opened cosmetics cannot be returned for health and hygiene reasons; free samples are excluded. Refunds are made within 14 days after we receive the item. Damaged or defective items are covered at our expense.",
        "ملخص: يمكن إرجاع المنتجات غير المفتوحة وغير المستخدمة خلال 14 يومًا من التسليم. لا يمكن إرجاع مستحضرات التجميل المفتوحة لأسباب صحية، والعينات المجانية مستثناة. يُعاد المبلغ خلال 14 يومًا من استلامنا المنتج. نتحمّل تكلفة المنتجات التالفة أو المعيبة.",
      ),
    },
  },
  MEMBERSHIP_LEGAL_DOCUMENT,
  WHEEL_TERMS_LEGAL_DOCUMENT,
];
