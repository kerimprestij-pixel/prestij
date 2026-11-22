// Types of the e-mail system (pure, type-only apart from a few constants). Templates register with
// defineEmailTemplate (./registry.ts) and declare their data type by augmenting EmailTemplateRegistry:
//
//   declare module "../types" {
//     interface EmailTemplateRegistry { order_paid: OrderEmailData }
//   }
//
// enqueueEmail({ template: "order_paid", data }) then type-checks `data` against OrderEmailData.
import type { EmailRelatedType as SchemaEmailRelatedType, EmailStatus as SchemaEmailStatus } from "@/db/schema/system";
import type { Locale, LocalizedText } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";
import type { Settings } from "@/lib/settings/types";

/** Who reads the e-mail: a customer (in their locale) or the shop's staff (admin notifications). */
export type EmailAudience = "customer" | "admin";

export const EMAIL_STATUSES = ["queued", "sending", "sent", "failed", "cancelled"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_RELATED_TYPES = [
  "order",
  "quote",
  "sample",
  "company",
  "review",
  "subscription",
  "newsletter",
  "campaign",
  "contact",
  "user",
  "test",
] as const;
export type EmailRelatedType = (typeof EMAIL_RELATED_TYPES)[number];

/**
 * Compile-time guard (CORE-CHECK): the lists above must stay identical to the column types in
 * src/db/schema/system.ts (the table is typed there, the panel filters use the arrays here).
 */
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const EMAIL_TYPES_MATCH_SCHEMA: [SameUnion<EmailStatus, SchemaEmailStatus>, SameUnion<EmailRelatedType, SchemaEmailRelatedType>] = [true, true];

/** Data types per template key. Each template file augments this interface (see the header). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EmailTemplateRegistry {}

/** Keys of every registered template (a string until the first template augments the registry). */
export type TemplateKey = [keyof EmailTemplateRegistry] extends [never] ? string : Extract<keyof EmailTemplateRegistry, string>;

/** The data a template's build() receives. */
export type EmailDataFor<K extends string> = K extends keyof EmailTemplateRegistry ? EmailTemplateRegistry[K] : Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Blocks: what a template builds. All text is PLAIN text (escaped by the renderer); `{placeholder}`
// tokens in heading / paragraph / notice / button label / keyValue label texts are filled after
// escaping. Money and dates are pre-formatted strings (ctx.formatPrice, ctx.formatDate).

export type EmailHeadingBlock = {
  type: "heading";
  text: string;
  /** Small uppercase gold line above the heading (like the storefront's .eyebrow). */
  eyebrow?: string;
  /** 1 = the mail's title (one per mail), 2 = a section heading. Default 1. */
  level?: 1 | 2;
};
export type EmailParagraphBlock = {
  type: "paragraph";
  /** Plain text; a newline becomes a line break, a blank line a new paragraph. */
  text: string;
  tone?: "default" | "muted";
  size?: "md" | "sm";
};
export type EmailButtonBlock = {
  type: "button";
  label: string;
  /** Absolute URL (https, or a site path that is made absolute). Unsafe URLs render the label only. */
  url: string;
  variant?: "primary" | "secondary";
  /** Also print the URL under the button (for verification / reset links). */
  showUrl?: boolean;
};
export type EmailKeyValueBlock = {
  type: "keyValue";
  title?: string;
  rows: { label: string; value: string }[];
};
export type EmailOrderLine = {
  name: string;
  /** Variant, size or a note ("500 ml · Lavanta"). */
  detail?: string | null;
  quantity: number;
  /** Pre-formatted line total. */
  total: string;
  /** Pre-formatted unit price, shown under the quantity when given. */
  unitPrice?: string | null;
  /** Absolute URL of a JPEG/PNG/WebP image (shown 64×64). */
  imageUrl?: string | null;
  /** Product accent color used for the image placeholder when there is no image. */
  accent?: string | null;
  /** e.g. "Ücretsiz numune". */
  badge?: string | null;
};
export type EmailOrderLinesBlock = { type: "orderLines"; title?: string; lines: EmailOrderLine[] };
export type EmailTotalsRow = { label: string; value: string; kind?: "default" | "discount" | "total" | "note" };
export type EmailTotalsBlock = { type: "totals"; rows: EmailTotalsRow[] };
export type EmailNoticeBlock = { type: "notice"; text: string; title?: string; tone?: "info" | "success" | "warning" | "danger" };
export type EmailDividerBlock = { type: "divider" };
export type EmailBankAccountsBlock = {
  type: "bankAccounts";
  title?: string;
  accounts: { bank: string; holder: string; iban: string }[];
  /** e.g. { label: "Açıklama", value: "PR-261001" }: shown prominently under the accounts. */
  reference?: { label: string; value: string } | null;
  /** e.g. "Tutar: 1.299,90 ₺ · Son ödeme: 12 Kasım". */
  note?: string | null;
  labels?: { holder?: string; iban?: string };
};
/**
 * Panel-authored rich text (campaign bodies). Sanitized with the storefront's sanitizeHtml and styled
 * inline. Not in the original block list: added for newsletter campaigns.
 */
export type EmailRichTextBlock = { type: "richText"; html: string };

export type EmailBlock =
  | EmailHeadingBlock
  | EmailParagraphBlock
  | EmailButtonBlock
  | EmailKeyValueBlock
  | EmailOrderLinesBlock
  | EmailTotalsBlock
  | EmailNoticeBlock
  | EmailDividerBlock
  | EmailBankAccountsBlock
  | EmailRichTextBlock;

/** What a template's build() returns. */
export type EmailContent = {
  subject: string;
  /** Inbox preview line. Defaults to the first paragraph. */
  preheader?: string;
  blocks: EmailBlock[];
};

// ---------------------------------------------------------------------------------------------
// Settings and build context

/** settings.emails (zod schema owned by CORE-DATA in src/lib/settings/types.ts). */
export type EmailSettings = Settings<"emails">;
/** One entry of settings.emails.templates (a missing entry = enabled, built-in texts). */
export type EmailTemplateSettings = { enabled: boolean; subject?: LocalizedText; intro?: LocalizedText };

/** Unsaved panel edits for a preview or a test send (already for the locale being rendered). */
export type EmailTextOverrides = { subject?: string | null; intro?: string | null };

export type EmailBuildContext = {
  locale: Locale;
  dir: "ltr" | "rtl";
  /** The UI dictionary for `locale`, panel overrides (ui_strings) included. */
  messages: Messages;
  settings: { general: Settings<"general">; emails: EmailSettings };
  /** Public origin without a trailing slash (NEXT_PUBLIC_SITE_URL). */
  siteUrl: string;
  /** Absolute URL for a path ("/tr/hesap") or an already absolute URL (returned as is). */
  url(path: string): string;
  /** Localized amount: formatPrice(kurus, locale). */
  formatPrice(kurus: number): string;
  /** Date (and time unless { time: false }) in Europe/Istanbul, in the e-mail's language. */
  formatDate(value: Date | string | number, options?: { time?: boolean }): string;
  /** i18n format() bound to the locale (placeholders + plurals). */
  format(template: string, vars: Record<string, string | number>): string;
};

export type EmailPlaceholderValues = Record<string, string | number | null | undefined>;

export type EmailTemplateDefinition<K extends TemplateKey = TemplateKey> = {
  key: K;
  audience: EmailAudience;
  /** Turkish name for the panel ("Sipariş alındı"). Defaults to the key. */
  label?: string;
  /** One Turkish sentence for the panel: when it is sent. */
  description?: string;
  /**
   * Marketing mail (newsletter campaign): adds the unsubscribe link and the List-Unsubscribe /
   * List-Unsubscribe-Post headers. Transactional mails never do.
   */
  marketing?: boolean;
  /** `{name}` tokens the panel may use in the subject and intro overrides (shown as chips). */
  placeholders: readonly string[];
  /** Realistic sample data for the panel preview and test sends. */
  sample: () => EmailDataFor<K>;
  /** Placeholder values. Default: data[placeholder] for each declared placeholder. */
  variables?: (data: EmailDataFor<K>, ctx: EmailBuildContext) => EmailPlaceholderValues;
  build: (data: EmailDataFor<K>, ctx: EmailBuildContext) => EmailContent;
};

export type EmailTemplate<K extends TemplateKey = TemplateKey> = EmailTemplateDefinition<K> & { label: string };

/** A rendered mail, exactly as stored in email_messages and sent. */
export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

/** Placeholders every template can use (filled from settings). */
export const GLOBAL_PLACEHOLDERS = ["siteName"] as const;
