// REVIEWS: the review request e-mail, queued by the reviews.request job (src/lib/reviews/requests.ts)
// `requestDaysAfterDelivery` days after delivery, once per order. One row per product with its own
// "Değerlendir" button (a signed link that opens the review form on the product page). Texts: the
// `email.reviewRequest` message group; subject/intro overridable in the panel.
import { defineEmailTemplate } from "../registry";
import type { EmailBlock } from "../types";

export type ReviewRequestProduct = {
  name: string;
  /** e.g. "Sıvı El Sabunu · 500 ml". */
  detail: string | null;
  /** Absolute or site-relative WebP/JPEG/PNG URL (64×64), or null. */
  imageUrl: string | null;
  /** Product accent color for the image box when there is no image. */
  accent: string | null;
  /** Units of the product in the order. */
  quantity: number;
  /** Site path or absolute URL of the product page that opens the review form. */
  url: string;
};

export type ReviewRequestEmailData = {
  /** First name from the shipping address ("" when unknown). */
  name: string;
  orderNumber: string;
  products: ReviewRequestProduct[];
  /** True when the buttons are personal signed links (guests can review without an account). */
  personalLinks: boolean;
  /** Days the personal links stay valid. */
  linkDays: number;
};

declare module "../types" {
  interface EmailTemplateRegistry {
    review_request: ReviewRequestEmailData;
  }
}

export const reviewRequestEmail = defineEmailTemplate({
  key: "review_request",
  audience: "customer",
  label: "Değerlendirme isteği",
  description: "Teslimattan birkaç gün sonra (Ayarlar › Yorumlar) müşteriden aldığı ürünleri değerlendirmesi istenir; sipariş başına bir kez.",
  placeholders: ["name", "orderNumber"],
  sample: () => ({
    name: "Ayşe",
    orderNumber: "PR-261001",
    personalLinks: true,
    linkDays: 90,
    products: [
      {
        name: "Lavanta",
        detail: "Sıvı El Sabunu · 500 ml",
        imageUrl: null,
        accent: "#8E61B6",
        quantity: 2,
        url: "https://prestij.com.tr/tr/urunler/lavanta?degerlendir=ornek#degerlendirmeler",
      },
      {
        name: "Okyanus",
        detail: "Duş Jeli · 500 ml",
        imageUrl: null,
        accent: "#329BC0",
        quantity: 1,
        url: "https://prestij.com.tr/tr/urunler/okyanus?degerlendir=ornek#degerlendirmeler",
      },
    ],
  }),
  build: (data, ctx) => {
    const m = ctx.messages.email.reviewRequest;
    const products: EmailBlock[] = data.products.flatMap((product) => [
      {
        type: "orderLines" as const,
        lines: [{ name: product.name, detail: product.detail, quantity: product.quantity, total: "", imageUrl: product.imageUrl, accent: product.accent }],
      },
      { type: "button" as const, label: m.button, url: product.url, variant: "secondary" as const },
    ]);
    return {
      subject: m.subject,
      preheader: m.preheader,
      blocks: [
        { type: "heading", eyebrow: m.eyebrow, text: m.heading },
        { type: "paragraph", text: data.name ? m.intro : m.introNoName },
        ...products,
        { type: "paragraph", text: m.moderation, tone: "muted", size: "sm" },
        {
          type: "paragraph",
          text: data.personalLinks ? ctx.format(m.personalLinks, { days: data.linkDays }) : m.signInLinks,
          tone: "muted",
          size: "sm",
        },
      ],
    };
  },
});
