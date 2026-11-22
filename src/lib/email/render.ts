// Renders a template into { subject, preheader, html, text } (pure: every input is passed in, so the
// same function serves enqueueEmail, the panel preview, test sends and unit tests).
import { intlLocale, localeDir } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { localize } from "@/i18n/localize";
import type { Messages } from "@/i18n/messages";
import { formatPrice } from "@/lib/pricing/money";
import type { Settings } from "@/lib/settings/types";
import { renderBlocksHtml, renderBlocksText, type BlockRenderContext } from "./blocks";
import { fillText, headerText } from "./escape";
import { renderEmailFooterText, renderEmailLayout } from "./layout";
import { emailTheme } from "./theme";
import type {
  EmailBlock,
  EmailBuildContext,
  EmailContent,
  EmailPlaceholderValues,
  EmailSettings,
  EmailTemplate,
  EmailTextOverrides,
  RenderedEmail,
  TemplateKey,
} from "./types";

/** The logo used in e-mails: a PNG (WebP/AVIF are not shown by Outlook), served from public/. */
export const EMAIL_LOGO_PATH = "/media/marka/prestij-logo.png";

export const EMAIL_TIME_ZONE = "Europe/Istanbul";

export type EmailRenderEnvironment = {
  locale: Locale;
  /** UI dictionary for the locale (panel overrides included). */
  messages: Messages;
  general: Settings<"general">;
  emails: EmailSettings;
  /** `themes.tokens` of the default theme (brand colors); defaults to PRESTİJ Klasik. */
  themeTokens?: unknown;
  /** Public origin without a trailing slash. */
  siteUrl: string;
  /** Absolute logo URL; default siteUrl + EMAIL_LOGO_PATH. null = typographic wordmark. */
  logoUrl?: string | null;
};

export type RenderOptions = {
  /** Unsaved panel edits (preview / test send). Win over the saved settings. */
  overrides?: EmailTextOverrides;
  /** Marketing mails: the reader's unsubscribe page (also used for the header by the sender). */
  unsubscribeUrl?: string | null;
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatDate(locale: Locale, value: Date | string | number, time: boolean): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const key = `${locale}:${time}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: EMAIL_TIME_ZONE,
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(time ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
    });
    dateFormatters.set(key, f);
  }
  return f.format(date);
}

function absolute(siteUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildEmailContext(env: EmailRenderEnvironment): EmailBuildContext {
  const { locale } = env;
  return {
    locale,
    dir: localeDir(locale),
    messages: env.messages,
    settings: { general: env.general, emails: env.emails },
    siteUrl: env.siteUrl,
    url: (path) => absolute(env.siteUrl, path),
    formatPrice: (kurus) => formatPrice(kurus, locale),
    formatDate: (value, options) => formatDate(locale, value, options?.time ?? true),
    format: (template, vars) => format(template, vars, intlLocale(locale)),
  };
}

/** The panel text for this exact locale (no fallback to Turkish: an English reader must not get Turkish). */
function overrideFor(text: { tr: string; en?: string; ar?: string } | null | undefined, locale: Locale): string | null {
  const value = text?.[locale]?.trim();
  return value ? value : null;
}

/** Replaces the first paragraph (the intro) or, without one, inserts it after the leading heading. */
export function applyIntro(blocks: readonly EmailBlock[], intro: string): EmailBlock[] {
  const next = [...blocks];
  const index = next.findIndex((b) => b.type === "paragraph");
  if (index >= 0) {
    const current = next[index] as Extract<EmailBlock, { type: "paragraph" }>;
    next[index] = { ...current, text: intro };
    return next;
  }
  const at = next[0]?.type === "heading" ? 1 : 0;
  next.splice(at, 0, { type: "paragraph", text: intro });
  return next;
}

/** Placeholder values: global ones, then data[placeholder] for declared names, then template.variables(). */
export function placeholderValues<K extends TemplateKey>(template: EmailTemplate<K>, data: unknown, ctx: EmailBuildContext): EmailPlaceholderValues {
  const values: EmailPlaceholderValues = { siteName: ctx.settings.general.siteName };
  if (data && typeof data === "object") {
    for (const name of template.placeholders) {
      const value = (data as Record<string, unknown>)[name];
      if (typeof value === "string" || typeof value === "number") values[name] = value;
    }
  }
  if (template.variables) Object.assign(values, template.variables(data as never, ctx));
  return values;
}

function firstParagraph(blocks: readonly EmailBlock[]): string {
  const p = blocks.find((b) => b.type === "paragraph") as Extract<EmailBlock, { type: "paragraph" }> | undefined;
  return p?.text ?? "";
}

/** The template's own subject and intro for a locale, before panel overrides and filling (panel defaults). */
export function templateDefaults<K extends TemplateKey>(template: EmailTemplate<K>, env: EmailRenderEnvironment): { subject: string; intro: string } {
  const content = template.build(template.sample(), buildEmailContext(env));
  return { subject: content.subject, intro: firstParagraph(content.blocks) };
}

export function renderTemplate<K extends TemplateKey>(template: EmailTemplate<K>, data: unknown, env: EmailRenderEnvironment, options: RenderOptions = {}): RenderedEmail {
  const ctx = buildEmailContext(env);
  const content: EmailContent = template.build(data as never, ctx);
  const vars = placeholderValues(template, data, ctx);
  const saved = env.emails.templates?.[template.key];

  const subjectSource = options.overrides?.subject?.trim() || overrideFor(saved?.subject, env.locale) || content.subject;
  const intro = options.overrides?.intro?.trim() || overrideFor(saved?.intro, env.locale);
  const blocks = intro ? applyIntro(content.blocks, intro) : content.blocks;

  const subject = headerText(fillText(subjectSource, vars));
  const preheader = headerText(fillText(content.preheader ?? firstParagraph(blocks), vars), 160);
  return renderContent({ subject, preheader, blocks }, vars, env, { marketing: Boolean(template.marketing), unsubscribeUrl: options.unsubscribeUrl ?? null });
}

/** Lays out already-built content (subject and preheader already filled). Exported for tests. */
export function renderContent(
  content: { subject: string; preheader: string; blocks: readonly EmailBlock[] },
  vars: EmailPlaceholderValues,
  env: EmailRenderEnvironment,
  options: { marketing: boolean; unsubscribeUrl: string | null },
): RenderedEmail {
  const { locale, messages, general } = env;
  const dir = localeDir(locale);
  const theme = emailTheme(env.themeTokens, dir);
  const layoutMessages = messages.email.layout;
  const blockCtx: BlockRenderContext = { theme, dir, locale, vars, siteUrl: env.siteUrl, buttonFallback: layoutMessages.buttonFallback };

  const footerNoteSource = localize(env.emails.footerNote ?? null, locale);
  const footerNote = footerNoteSource ? fillText(footerNoteSource, vars) : null;
  const reason = fillText(options.marketing ? layoutMessages.footerMarketing : layoutMessages.footerTransactional, vars);
  const unsubscribeUrl = options.marketing ? options.unsubscribeUrl : null;
  // Campaign mails (ticari elektronik ileti) also name the seller's MERSİS number and KEP address beside the
  // company name, each only when filled in Ayarlar › Firma bilgileri (go-live CF-13).
  const mersisNo = general.mersisNo?.trim() ?? "";
  const kep = general.kep?.trim() ?? "";
  const identity = options.marketing
    ? [mersisNo ? `${layoutMessages.mersisNo}: ${mersisNo}` : "", kep ? `${layoutMessages.kep}: ${kep}` : ""].filter(Boolean)
    : [];
  const company = {
    legalName: general.legalName,
    addressLines: [general.address.line, [general.address.district, general.address.city].filter(Boolean).join(" / "), general.address.country],
    phone: general.phone,
    email: general.email,
    identity,
  };
  const siteHome = `${env.siteUrl}/${locale}`;
  const labels = { unsubscribe: layoutMessages.unsubscribe, visitSite: layoutMessages.visitSite };
  const logoUrl = env.logoUrl === undefined ? `${env.siteUrl}${EMAIL_LOGO_PATH}` : env.logoUrl;

  const html = renderEmailLayout({
    locale,
    dir,
    subject: content.subject,
    preheader: content.preheader,
    bodyHtml: renderBlocksHtml(content.blocks, blockCtx),
    theme,
    siteUrl: siteHome,
    siteName: general.siteName,
    logoUrl,
    company,
    footerNote,
    reason,
    unsubscribeUrl,
    labels,
  });
  const text = `${renderBlocksText(content.blocks, blockCtx)}\n\n${renderEmailFooterText({
    siteUrl: siteHome,
    siteName: general.siteName,
    company,
    footerNote,
    reason,
    unsubscribeUrl,
    labels,
  })}\n`;
  return { subject: content.subject, preheader: content.preheader, html, text };
}
