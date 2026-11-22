// The branded e-mail shell (pure): a centered 600 px card on the ivory background, the logo by
// absolute URL, a thin gold rule, the blocks, and a quiet footer with the company data. Table-based
// with inline styles (Outlook ignores most CSS); a small <style> only adds mobile padding.
import type { Locale } from "@/i18n/locales";
import { escapeHtml } from "./escape";
import type { EmailTheme } from "./theme";

export type EmailLayoutInput = {
  locale: Locale;
  dir: "ltr" | "rtl";
  /** Plain text (already filled). */
  subject: string;
  /** Plain text (already filled); shown as the inbox preview line. */
  preheader: string;
  /** Rendered block rows (renderBlocksHtml). */
  bodyHtml: string;
  theme: EmailTheme;
  siteUrl: string;
  siteName: string;
  /** Absolute URL of a PNG logo, or null for the typographic wordmark. */
  logoUrl: string | null;
  /**
   * `identity`: labelled seller registry lines shown beside the legal name ("MERSİS No: …", "KEP: …"; plain
   * text, already labelled). Marketing mails pass them (go-live CF-13); empty or omitted = nothing shown.
   */
  company: { legalName: string; addressLines: string[]; phone: string; email: string; identity?: string[] };
  /** Panel footer note for this locale (plain text, already filled). */
  footerNote: string | null;
  /** Why the reader gets this mail (plain text, already filled). */
  reason: string;
  /** Marketing mails only. */
  unsubscribeUrl: string | null;
  labels: { unsubscribe: string; visitSite: string };
};

/** Invisible filler after the preheader so clients do not pull body text into the preview line. */
const PREHEADER_FILLER = "&#847;&zwnj;&nbsp;".repeat(60);

export function renderEmailLayout(input: EmailLayoutInput): string {
  const { theme, dir } = input;
  const start = dir === "rtl" ? "right" : "left";
  const lang = input.locale;
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="132" alt="${escapeHtml(input.siteName)}" style="display:block;margin:0 auto;width:132px;max-width:132px;height:auto;border:0;outline:none;text-decoration:none;font-family:${theme.fontHeading};font-size:24px;letter-spacing:6px;color:${theme.brand};">`
    : `<span style="font-family:${theme.fontHeading};font-size:26px;line-height:32px;letter-spacing:6px;color:${theme.brand};" dir="ltr">${escapeHtml(input.siteName)}</span>`;

  // `data` lines (company name, address, contacts) are usually Latin script: dir="auto" keeps their
  // punctuation in place inside an Arabic mail.
  const footerLine = (html: string, extra = "", data = false) =>
    `<p${data ? ' dir="auto"' : ""} style="margin:0 0 6px 0;font-family:${theme.fontBody};font-size:12px;line-height:18px;color:${theme.muted};text-align:center;${extra}">${html}</p>`;

  const address = input.company.addressLines.filter(Boolean).map(escapeHtml).join(" · ");
  const contacts = [input.company.phone ? `<span dir="ltr">${escapeHtml(input.company.phone)}</span>` : "", input.company.email ? escapeHtml(input.company.email) : ""]
    .filter(Boolean)
    .join(" · ");
  const siteLink = `<a href="${escapeHtml(input.siteUrl)}" target="_blank" rel="noopener" style="color:${theme.brand};text-decoration:underline;">${escapeHtml(input.labels.visitSite)}</a>`;
  const unsubscribe = input.unsubscribeUrl
    ? ` · <a href="${escapeHtml(input.unsubscribeUrl)}" target="_blank" rel="noopener" style="color:${theme.brand};text-decoration:underline;">${escapeHtml(input.labels.unsubscribe)}</a>`
    : "";

  const identity = (input.company.identity ?? [])
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ` · <span dir="auto">${escapeHtml(line)}</span>`)
    .join("");

  const footer = [
    input.footerNote ? footerLine(escapeHtml(input.footerNote).replace(/\r?\n/g, "<br>"), `color:${theme.text};margin-bottom:14px;`, true) : "",
    footerLine(`<strong style="font-weight:600;color:${theme.text};">${escapeHtml(input.company.legalName || input.siteName)}</strong>${identity}`, "", true),
    address ? footerLine(address, "", true) : "",
    contacts ? footerLine(contacts, "", true) : "",
    footerLine(`${siteLink}${unsubscribe}`, "margin-top:12px;"),
    footerLine(escapeHtml(input.reason), "margin-top:12px;font-size:11px;line-height:16px;"),
  ].join("");

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(input.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  @media only screen and (max-width: 620px) {
    .email-card { border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
    .email-pad { padding-left: 22px !important; padding-right: 22px !important; }
    .email-outer { padding: 0 !important; }
    .email-h1 { font-size: 24px !important; line-height: 32px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${theme.bg};" bgcolor="${theme.bg}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}${PREHEADER_FILLER}</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${theme.bg}" style="background-color:${theme.bg};">
<tr><td class="email-outer" align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" align="center" border="0" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" class="email-card" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${theme.surface}" style="max-width:600px;margin:0 auto;background-color:${theme.surface};border:1px solid ${theme.border};border-radius:12px;border-collapse:separate;" dir="${dir}">
<tr><td class="email-pad" align="center" style="padding:36px 44px 8px 44px;">
<a href="${escapeHtml(input.siteUrl)}" target="_blank" rel="noopener" style="text-decoration:none;">${logo}</a>
</td></tr>
<tr><td align="center" style="padding:18px 44px 30px 44px;">
<table role="presentation" width="48" border="0" cellspacing="0" cellpadding="0"><tr><td style="border-top:1px solid ${theme.gold};font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
</td></tr>
<tr><td class="email-pad" style="padding:0 44px 20px 44px;text-align:${start};">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
${input.bodyHtml}
</table>
</td></tr>
</table>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;" dir="${dir}">
<tr><td class="email-pad" style="padding:26px 44px 8px 44px;">
${footer}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** The text part's footer, in the same order as the HTML footer. */
export function renderEmailFooterText(input: Pick<EmailLayoutInput, "siteUrl" | "siteName" | "company" | "footerNote" | "reason" | "unsubscribeUrl" | "labels">): string {
  const lines = [
    input.footerNote ?? "",
    [input.company.legalName || input.siteName, ...(input.company.identity ?? []).map((line) => line.trim()).filter(Boolean)].join(" · "),
    input.company.addressLines.filter(Boolean).join(", "),
    [input.company.phone, input.company.email].filter(Boolean).join(" · "),
    input.siteUrl,
    input.unsubscribeUrl ? `${input.labels.unsubscribe}: ${input.unsubscribeUrl}` : "",
    input.reason,
  ].filter((line) => line.trim().length > 0);
  return `--\n${lines.join("\n")}`;
}
