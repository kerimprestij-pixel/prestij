// EmailBlock → HTML (table rows with inline styles, for Gmail / Outlook / Apple Mail) and → plain
// text. Pure. Every text is escaped here; placeholders are filled after escaping (./escape.ts).
import { localizeBodyLinks } from "@/components/sections/localize-links";
import { sanitizeHtml } from "@/components/sections/sanitize-html";
import type { Locale } from "@/i18n/locales";
import { formatIban } from "@/lib/validation/tr";
import { escapeHtml, fillHtml, fillText, safeColor, safeEmailUrl } from "./escape";
import type { EmailTheme } from "./theme";
import type { EmailBlock, EmailOrderLine, EmailPlaceholderValues, EmailTotalsRow } from "./types";

export type BlockRenderContext = {
  theme: EmailTheme;
  dir: "ltr" | "rtl";
  locale: Locale;
  vars: EmailPlaceholderValues;
  siteUrl: string;
  /** "If the button doesn't work, copy this link…" */
  buttonFallback: string;
};

type Align = { start: "left" | "right"; end: "left" | "right" };
const alignFor = (dir: "ltr" | "rtl"): Align => (dir === "rtl" ? { start: "right", end: "left" } : { start: "left", end: "right" });

/** Escaped text with newlines as <br> (no placeholder filling: for data values). */
function textHtml(value: string | null | undefined): string {
  return escapeHtml(value ?? "").replace(/\r?\n/g, "<br>");
}

/** Escaped + filled text with newlines as <br> (for template copy). */
function copyHtml(value: string, vars: EmailPlaceholderValues): string {
  return fillHtml(value, vars).replace(/\r?\n/g, "<br>");
}

function row(content: string, padding = "0 0 20px 0"): string {
  return `<tr><td style="padding:${padding};">${content}</td></tr>`;
}

function smallCaps(theme: EmailTheme, dir: "ltr" | "rtl", color: string): string {
  // Uppercase + letter-spacing reads well in Latin script; Arabic has no case and must not be spaced.
  return dir === "rtl"
    ? `font-family:${theme.fontBody};font-size:12px;line-height:18px;font-weight:600;color:${color};`
    : `font-family:${theme.fontBody};font-size:11px;line-height:16px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${color};`;
}

function heading(block: Extract<EmailBlock, { type: "heading" }>, ctx: BlockRenderContext): string {
  const { theme, dir, vars } = ctx;
  const a = alignFor(dir);
  const level = block.level ?? 1;
  const eyebrow = block.eyebrow
    ? `<p style="margin:0 0 12px 0;${smallCaps(theme, dir, theme.goldText)}">${copyHtml(block.eyebrow, vars)}</p>`
    : "";
  const tag = level === 1 ? "h1" : "h2";
  const size = level === 1 ? "font-size:28px;line-height:36px;" : "font-size:20px;line-height:28px;";
  return row(
    `${eyebrow}<${tag} class="${level === 1 ? "email-h1" : "email-h2"}" style="margin:0;font-family:${theme.fontHeading};${size}font-weight:normal;color:${theme.brand};text-align:${a.start};">${copyHtml(block.text, vars)}</${tag}>`,
    level === 1 ? "0 0 20px 0" : "8px 0 14px 0",
  );
}

function paragraph(block: Extract<EmailBlock, { type: "paragraph" }>, ctx: BlockRenderContext): string {
  const { theme, dir, vars } = ctx;
  const a = alignFor(dir);
  const color = block.tone === "muted" ? theme.muted : theme.text;
  const size = block.size === "sm" ? "font-size:13px;line-height:20px;" : "font-size:15px;line-height:24px;";
  const parts = block.text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  const html = parts
    .map(
      (p, i) =>
        `<p style="margin:0 0 ${i === parts.length - 1 ? 0 : 12}px 0;font-family:${theme.fontBody};${size}color:${color};text-align:${a.start};">${copyHtml(p, vars)}</p>`,
    )
    .join("");
  return row(html, block.size === "sm" ? "0 0 12px 0" : "0 0 18px 0");
}

function button(block: Extract<EmailBlock, { type: "button" }>, ctx: BlockRenderContext): string {
  const { theme, dir, vars, siteUrl } = ctx;
  const a = alignFor(dir);
  const url = safeEmailUrl(block.url, siteUrl);
  const label = copyHtml(block.label, vars);
  if (!url) {
    return row(`<p style="margin:0;font-family:${theme.fontBody};font-size:15px;line-height:24px;font-weight:600;color:${theme.brand};">${label}</p>`);
  }
  const secondary = block.variant === "secondary";
  const bg = secondary ? theme.surface : theme.brand;
  const fg = secondary ? theme.brand : theme.brandContrast;
  const border = secondary ? `border:1px solid ${theme.brand};` : `border:1px solid ${theme.brand};`;
  const href = escapeHtml(url);
  const fallback = block.showUrl
    ? `<p style="margin:16px 0 0 0;font-family:${theme.fontBody};font-size:12px;line-height:18px;color:${theme.muted};text-align:${a.start};">${escapeHtml(ctx.buttonFallback)}<br><a href="${href}" target="_blank" rel="noopener" style="color:${theme.brand};text-decoration:underline;word-break:break-all;" dir="ltr">${escapeHtml(url)}</a></p>`
    : "";
  return row(
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="${a.start}" style="border-collapse:separate;"><tr>` +
      `<td align="center" bgcolor="${bg}" style="border-radius:999px;background-color:${bg};${border}">` +
      `<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 34px;font-family:${theme.fontBody};font-size:15px;line-height:20px;font-weight:600;letter-spacing:0.2px;color:${fg};text-decoration:none;border-radius:999px;">${label}</a>` +
      `</td></tr></table>` +
      `<div style="clear:both;line-height:0;font-size:0;">&nbsp;</div>${fallback}`,
    "6px 0 26px 0",
  );
}

function sectionTitle(title: string | undefined, ctx: BlockRenderContext): string {
  if (!title) return "";
  return `<p style="margin:0 0 10px 0;${smallCaps(ctx.theme, ctx.dir, ctx.theme.muted)}text-align:${alignFor(ctx.dir).start};">${copyHtml(title, ctx.vars)}</p>`;
}

function keyValue(block: Extract<EmailBlock, { type: "keyValue" }>, ctx: BlockRenderContext): string {
  const { theme, dir, vars } = ctx;
  const a = alignFor(dir);
  if (block.rows.length === 0) return "";
  const rows = block.rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="padding:10px 0;border-bottom:1px solid ${theme.border};font-family:${theme.fontBody};font-size:14px;line-height:20px;color:${theme.muted};text-align:${a.start};vertical-align:top;">${copyHtml(r.label, vars)}</td>` +
        `<td dir="auto" style="padding:10px 0;padding-${a.start}:16px;border-bottom:1px solid ${theme.border};font-family:${theme.fontBody};font-size:14px;line-height:20px;font-weight:600;color:${theme.text};text-align:${a.end};vertical-align:top;">${textHtml(r.value)}</td>` +
        `</tr>`,
    )
    .join("");
  return row(
    `${sectionTitle(block.title, ctx)}<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid ${theme.border};">${rows}</table>`,
    "0 0 24px 0",
  );
}

function orderLine(line: EmailOrderLine, ctx: BlockRenderContext): string {
  const { theme, dir } = ctx;
  const a = alignFor(dir);
  const image = line.imageUrl ? safeEmailUrl(line.imageUrl, ctx.siteUrl) : null;
  const accent = safeColor(line.accent, theme.surface2);
  const media = image
    ? `<img src="${escapeHtml(image)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border:1px solid ${theme.border};border-radius:8px;object-fit:cover;background-color:${theme.surface2};">`
    : `<table role="presentation" width="64" height="64" border="0" cellspacing="0" cellpadding="0"><tr><td width="64" height="64" bgcolor="${accent}" style="width:64px;height:64px;border-radius:8px;background-color:${accent};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
  const detail = line.detail
    ? `<p dir="auto" style="margin:2px 0 0 0;font-family:${theme.fontBody};font-size:13px;line-height:18px;color:${theme.muted};">${textHtml(line.detail)}</p>`
    : "";
  const badge = line.badge
    ? `<p style="margin:6px 0 0 0;${smallCaps(theme, dir, theme.goldText)}">${textHtml(line.badge)}</p>`
    : "";
  const qty = `× ${Math.max(0, Math.trunc(line.quantity))}${line.unitPrice ? ` · ${escapeHtml(line.unitPrice)}` : ""}`;
  return (
    `<tr>` +
    `<td width="64" style="width:64px;padding:14px 0;border-bottom:1px solid ${theme.border};vertical-align:top;">${media}</td>` +
    `<td style="padding:14px 16px;border-bottom:1px solid ${theme.border};vertical-align:top;text-align:${a.start};">` +
    `<p dir="auto" style="margin:0;font-family:${theme.fontBody};font-size:14px;line-height:20px;font-weight:600;color:${theme.text};">${textHtml(line.name)}</p>` +
    detail +
    `<p style="margin:4px 0 0 0;font-family:${theme.fontBody};font-size:13px;line-height:18px;color:${theme.muted};" dir="ltr">${qty}</p>` +
    badge +
    `</td>` +
    `<td dir="ltr" style="padding:14px 0;border-bottom:1px solid ${theme.border};vertical-align:top;text-align:${a.end};white-space:nowrap;font-family:${theme.fontBody};font-size:14px;line-height:20px;font-weight:600;color:${theme.text};">${escapeHtml(line.total)}</td>` +
    `</tr>`
  );
}

function orderLines(block: Extract<EmailBlock, { type: "orderLines" }>, ctx: BlockRenderContext): string {
  if (block.lines.length === 0) return "";
  return row(
    `${sectionTitle(block.title, ctx)}<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid ${ctx.theme.border};">${block.lines.map((l) => orderLine(l, ctx)).join("")}</table>`,
    "0 0 20px 0",
  );
}

function totalsRow(r: EmailTotalsRow, ctx: BlockRenderContext): string {
  const { theme, dir, vars } = ctx;
  const a = alignFor(dir);
  if (r.kind === "note") {
    return `<tr><td colspan="2" style="padding:8px 0 0 0;font-family:${theme.fontBody};font-size:12px;line-height:18px;color:${theme.muted};text-align:${a.start};">${copyHtml(r.label, vars)}${r.value ? ` ${textHtml(r.value)}` : ""}</td></tr>`;
  }
  if (r.kind === "total") {
    return (
      `<tr>` +
      `<td style="padding:12px 0 0 0;border-top:1px solid ${theme.border};font-family:${theme.fontHeading};font-size:18px;line-height:26px;color:${theme.brand};text-align:${a.start};">${copyHtml(r.label, vars)}</td>` +
      `<td dir="ltr" style="padding:12px 0 0 0;border-top:1px solid ${theme.border};font-family:${theme.fontBody};font-size:18px;line-height:26px;font-weight:700;color:${theme.brand};text-align:${a.end};white-space:nowrap;">${escapeHtml(r.value)}</td>` +
      `</tr>`
    );
  }
  const valueColor = r.kind === "discount" ? theme.success : theme.text;
  return (
    `<tr>` +
    `<td style="padding:4px 0;font-family:${theme.fontBody};font-size:14px;line-height:22px;color:${theme.muted};text-align:${a.start};">${copyHtml(r.label, vars)}</td>` +
    `<td dir="ltr" style="padding:4px 0;padding-${a.start}:16px;font-family:${theme.fontBody};font-size:14px;line-height:22px;color:${valueColor};text-align:${a.end};white-space:nowrap;">${escapeHtml(r.value)}</td>` +
    `</tr>`
  );
}

function totals(block: Extract<EmailBlock, { type: "totals" }>, ctx: BlockRenderContext): string {
  if (block.rows.length === 0) return "";
  const { theme } = ctx;
  return row(
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${theme.surface2}" style="border-collapse:separate;background-color:${theme.surface2};border-radius:10px;">` +
      `<tr><td style="padding:16px 20px;"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${block.rows.map((r) => totalsRow(r, ctx)).join("")}</table></td></tr></table>`,
    "0 0 24px 0",
  );
}

function notice(block: Extract<EmailBlock, { type: "notice" }>, ctx: BlockRenderContext): string {
  const { theme, dir, vars } = ctx;
  const a = alignFor(dir);
  const tone = block.tone === "success" ? theme.success : block.tone === "warning" ? theme.warning : block.tone === "danger" ? theme.danger : theme.gold;
  const title = block.title
    ? `<p style="margin:0 0 4px 0;font-family:${theme.fontBody};font-size:14px;line-height:20px;font-weight:700;color:${theme.text};">${copyHtml(block.title, vars)}</p>`
    : "";
  return row(
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${theme.surface2}" style="border-collapse:collapse;background-color:${theme.surface2};">` +
      `<tr><td style="padding:14px 18px;border-${a.start}:3px solid ${tone};text-align:${a.start};">${title}` +
      `<p style="margin:0;font-family:${theme.fontBody};font-size:14px;line-height:22px;color:${theme.text};">${copyHtml(block.text, vars)}</p></td></tr></table>`,
    "0 0 22px 0",
  );
}

function divider(ctx: BlockRenderContext): string {
  return row(
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="border-top:1px solid ${ctx.theme.border};font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`,
    "4px 0 22px 0",
  );
}

function bankAccounts(block: Extract<EmailBlock, { type: "bankAccounts" }>, ctx: BlockRenderContext): string {
  const { theme, dir } = ctx;
  const a = alignFor(dir);
  if (block.accounts.length === 0) return "";
  const label = (text: string) => `<p style="margin:10px 0 2px 0;${smallCaps(theme, dir, theme.muted)}">${escapeHtml(text)}</p>`;
  const accounts = block.accounts
    .map(
      (acc) =>
        `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:separate;border:1px solid ${theme.border};border-radius:10px;margin:0 0 12px 0;">` +
        `<tr><td style="padding:16px 18px;text-align:${a.start};">` +
        `<p dir="auto" style="margin:0;font-family:${theme.fontBody};font-size:15px;line-height:22px;font-weight:700;color:${theme.brand};">${textHtml(acc.bank)}</p>` +
        label(block.labels?.holder ?? "") +
        `<p dir="auto" style="margin:0;font-family:${theme.fontBody};font-size:14px;line-height:20px;color:${theme.text};">${textHtml(acc.holder)}</p>` +
        label(block.labels?.iban ?? "IBAN") +
        `<p dir="ltr" style="margin:0;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:15px;line-height:22px;letter-spacing:1px;color:${theme.text};text-align:${a.start};">${escapeHtml(formatIban(acc.iban))}</p>` +
        `</td></tr></table>`,
    )
    .join("");
  const reference = block.reference
    ? `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${theme.surface2}" style="border-collapse:collapse;background-color:${theme.surface2};margin:4px 0 0 0;"><tr><td style="padding:14px 18px;border-${a.start}:3px solid ${theme.gold};text-align:${a.start};">` +
      `<p style="margin:0;${smallCaps(theme, dir, theme.muted)}">${copyHtml(block.reference.label, ctx.vars)}</p>` +
      `<p dir="ltr" style="margin:4px 0 0 0;font-family:${theme.fontBody};font-size:18px;line-height:26px;font-weight:700;letter-spacing:0.5px;color:${theme.brand};text-align:${a.start};">${escapeHtml(block.reference.value)}</p>` +
      `</td></tr></table>`
    : "";
  const note = block.note
    ? `<p style="margin:12px 0 0 0;font-family:${theme.fontBody};font-size:13px;line-height:20px;color:${theme.muted};">${copyHtml(block.note, ctx.vars)}</p>`
    : "";
  return row(`${sectionTitle(block.title, ctx)}${accounts}${reference}${note}`, "0 0 24px 0");
}

/** Sanitized rich text with inline styles; internal links localized and made absolute. */
export function richTextToEmailHtml(html: string, ctx: Pick<BlockRenderContext, "theme" | "dir" | "locale" | "siteUrl">): string {
  const { theme, dir } = ctx;
  const a = alignFor(dir);
  const listPad = `padding-${a.start}:22px;`;
  const base = `font-family:${theme.fontBody};color:${theme.text};`;
  const styles: Record<string, string> = {
    p: `margin:0 0 14px 0;${base}font-size:15px;line-height:24px;`,
    h2: `margin:20px 0 10px 0;font-family:${theme.fontHeading};font-size:22px;line-height:30px;font-weight:normal;color:${theme.brand};`,
    h3: `margin:18px 0 8px 0;font-family:${theme.fontHeading};font-size:18px;line-height:26px;font-weight:normal;color:${theme.brand};`,
    h4: `margin:16px 0 6px 0;${base}font-size:15px;line-height:22px;font-weight:700;`,
    ul: `margin:0 0 14px 0;${listPad}${base}font-size:15px;line-height:24px;`,
    ol: `margin:0 0 14px 0;${listPad}${base}font-size:15px;line-height:24px;`,
    li: `margin:0 0 6px 0;`,
    blockquote: `margin:0 0 14px 0;padding:4px 0;padding-${a.start}:16px;border-${a.start}:3px solid ${theme.gold};font-family:${theme.fontHeading};font-size:17px;line-height:26px;font-style:italic;color:${theme.text};`,
    hr: `border:0;border-top:1px solid ${theme.border};margin:22px 0;`,
    a: `color:${theme.brand};text-decoration:underline;`,
  };
  const clean = localizeBodyLinks(sanitizeHtml(html), ctx.locale)
    // Internal paths → absolute URLs (mail clients have no base URL).
    .replace(/<a href="(\/(?!\/)[^"]*)"/g, (_m, path: string) => `<a href="${escapeHtml(`${ctx.siteUrl}${path}`)}" target="_blank" rel="noopener"`);
  return clean.replace(/<(p|h2|h3|h4|ul|ol|li|blockquote|hr|a)(\s|>)/g, (_m, tag: string, next: string) => `<${tag} style="${styles[tag]}"${next}`);
}

function richText(block: Extract<EmailBlock, { type: "richText" }>, ctx: BlockRenderContext): string {
  const html = richTextToEmailHtml(block.html, ctx);
  return html ? row(html, "0 0 10px 0") : "";
}

/** One block as table row(s) for the layout's body table. */
export function renderBlockHtml(block: EmailBlock, ctx: BlockRenderContext): string {
  switch (block.type) {
    case "heading":
      return heading(block, ctx);
    case "paragraph":
      return paragraph(block, ctx);
    case "button":
      return button(block, ctx);
    case "keyValue":
      return keyValue(block, ctx);
    case "orderLines":
      return orderLines(block, ctx);
    case "totals":
      return totals(block, ctx);
    case "notice":
      return notice(block, ctx);
    case "divider":
      return divider(ctx);
    case "bankAccounts":
      return bankAccounts(block, ctx);
    case "richText":
      return richText(block, ctx);
    default:
      return "";
  }
}

export function renderBlocksHtml(blocks: readonly EmailBlock[], ctx: BlockRenderContext): string {
  return blocks.map((b) => renderBlockHtml(b, ctx)).join("");
}

// ---------------------------------------------------------------------------------------------
// Plain text

/** Text of panel rich text: block tags become line breaks, entities decoded, tags dropped. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html)
    .replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<li>/g, "\n- ")
    .replace(/<br>|<\/(p|h2|h3|h4|blockquote|ul|ol)>|<hr>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textBlock(block: EmailBlock, ctx: BlockRenderContext): string {
  const { vars } = ctx;
  switch (block.type) {
    case "heading": {
      const title = fillText(block.text, vars);
      return (block.level ?? 1) === 1 ? `${title}\n${"=".repeat(Math.min(60, Math.max(3, title.length)))}` : title;
    }
    case "paragraph":
      return fillText(block.text, vars).trim();
    case "button": {
      const url = safeEmailUrl(block.url, ctx.siteUrl);
      return url ? `${fillText(block.label, vars)}:\n${url}` : fillText(block.label, vars);
    }
    case "keyValue":
      return [block.title ? fillText(block.title, vars).toLocaleUpperCase(ctx.locale) : null, ...block.rows.map((r) => `${fillText(r.label, vars)}: ${r.value.replace(/\r?\n/g, ", ")}`)]
        .filter(Boolean)
        .join("\n");
    case "orderLines":
      return [
        block.title ? fillText(block.title, vars).toLocaleUpperCase(ctx.locale) : null,
        ...block.lines.map((l) => `- ${l.quantity} × ${l.name}${l.detail ? ` (${l.detail})` : ""}${l.badge ? ` [${l.badge}]` : ""}${l.total ? `: ${l.total}` : ""}`),
      ]
        .filter(Boolean)
        .join("\n");
    case "totals":
      return block.rows
        .map((r) => (r.kind === "note" ? `${fillText(r.label, vars)}${r.value ? ` ${r.value}` : ""}` : `${fillText(r.label, vars)}: ${r.value}`))
        .join("\n");
    case "notice":
      return [block.title ? fillText(block.title, vars) : null, fillText(block.text, vars)].filter(Boolean).join("\n");
    case "divider":
      return "----------------------------------------";
    case "bankAccounts":
      return [
        block.title ? fillText(block.title, vars).toLocaleUpperCase(ctx.locale) : null,
        ...block.accounts.map((acc) => `${acc.bank}\n${block.labels?.holder ? `${block.labels.holder}: ` : ""}${acc.holder}\n${block.labels?.iban ?? "IBAN"}: ${formatIban(acc.iban)}`),
        block.reference ? `${fillText(block.reference.label, vars)}: ${block.reference.value}` : null,
        block.note ? fillText(block.note, vars) : null,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "richText":
      return htmlToText(richTextToEmailHtml(block.html, ctx));
    default:
      return "";
  }
}

export function renderBlocksText(blocks: readonly EmailBlock[], ctx: BlockRenderContext): string {
  return blocks
    .map((b) => textBlock(b, ctx))
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
}
