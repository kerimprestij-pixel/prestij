// Newsletter e-mails (NOTIFY): the double opt-in confirmation (transactional: it is the answer to the
// visitor's own request) and the campaign mail (marketing: unsubscribe link + List-Unsubscribe
// headers). Campaign subject and body are written per locale on /panel/e-bulten.
import { defineEmailTemplate } from "../registry";

export type NewsletterConfirmEmailData = {
  /** Absolute link to /bulten/onay?t=<token> in the subscriber's language. */
  url: string;
};

export type NewsletterCampaignEmailData = {
  /** The campaign subject in the reader's language (plain text). */
  subject: string;
  /** Optional inbox preview line. */
  preheader?: string | null;
  /** The campaign body in the reader's language (panel rich text; sanitized when rendered). */
  html: string;
};

declare module "../types" {
  interface EmailTemplateRegistry {
    newsletter_confirm: NewsletterConfirmEmailData;
    newsletter_campaign: NewsletterCampaignEmailData;
  }
}

export const newsletterConfirmEmail = defineEmailTemplate({
  key: "newsletter_confirm",
  audience: "customer",
  label: "E-bülten abonelik onayı",
  description: "E-bültene abone olan kişiye aboneliğini onaylaması için gönderilir (çift onay; bağlantı 7 gün geçerlidir).",
  placeholders: [],
  sample: () => ({ url: "https://prestij.com.tr/tr/bulten/onay?t=ornek" }),
  build: (data, ctx) => {
    const m = ctx.messages.email.newsletter.confirm;
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: m.intro },
        { type: "button", label: m.button, url: data.url, showUrl: true },
        { type: "paragraph", text: m.expiry, tone: "muted", size: "sm" },
        { type: "paragraph", text: m.ignore, tone: "muted", size: "sm" },
      ],
    };
  },
});

const SAMPLE_BODY: Record<string, string> = {
  tr: "<h2>Kış koleksiyonu geldi</h2><p>Lavanta Latte'nin yumuşak, kremsi notaları şimdi 5 L ekonomik ambalajda. Otel, spa ve ofisleriniz için kampanya fiyatlarını kaçırmayın.</p><p><a href=\"/urunler\">Koleksiyonu keşfedin</a></p>",
  en: "<h2>The winter collection is here</h2><p>The soft, creamy notes of Lavender Latte now come in an economical 5 L pack. Don't miss the offer prices for your hotel, spa or office.</p><p><a href=\"/urunler\">Discover the collection</a></p>",
  ar: "<h2>وصلت مجموعة الشتاء</h2><p>نفحات لافندر لاتيه الناعمة والكريمية متوفرة الآن في عبوة اقتصادية سعة 5 لترات. لا تفوّت أسعار العروض لفندقك أو منتجعك أو مكتبك.</p><p><a href=\"/urunler\">اكتشف المجموعة</a></p>",
};

export const newsletterCampaignEmail = defineEmailTemplate({
  key: "newsletter_campaign",
  audience: "customer",
  marketing: true,
  label: "E-bülten kampanyası",
  description: "E-bülten ekranında yazılan kampanyalar bu tasarımla gönderilir; konu ve metin her kampanyada ayrıca yazılır.",
  placeholders: [],
  sample: () => ({ subject: "Kış koleksiyonu geldi", preheader: "Lavanta Latte şimdi 5 L ambalajda.", html: SAMPLE_BODY.tr }),
  build: (data, ctx) => {
    // The sample body follows the preview language; real campaigns pass their own localized body.
    const html = data.html === SAMPLE_BODY.tr ? (SAMPLE_BODY[ctx.locale] ?? data.html) : data.html;
    return {
      subject: data.subject,
      ...(data.preheader ? { preheader: data.preheader } : {}),
      blocks: [{ type: "richText", html }],
    };
  },
});
