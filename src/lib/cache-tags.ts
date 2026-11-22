/** The only place cache tag strings are defined. Storefront reads tag with these; panel writes invalidate them. */
export const TAGS = {
  settings: "settings",
  theme: "theme",
  menus: "menus",
  announcements: "announcements",
  uiStrings: "ui-strings",
  pages: "pages",
  page: (slug: string) => `page:${slug}`,
  products: "products",
  product: (slug: string) => `product:${slug}`,
  categories: "categories",
  reviews: (productId: number) => `reviews:${productId}`,
  blog: "blog",
  post: (slug: string) => `post:${slug}`,
  legal: "legal",
  media: "media",
  /** Automatic discounts (storefront badges/prices, campaign-linked themes). */
  campaigns: "campaigns",
  /** Moved slugs (redirectIfMoved). */
  redirects: "redirects",
  /** Active subscribe-and-save plans (product page subscription choice). */
  subscriptionPlans: "subscription-plans",
  /** Day 6: the gift wheel's display-only teaser read by the locale layout (settings key giftWheel). */
  wheel: "wheel",
} as const;
