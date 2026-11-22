// Minimal allow-list HTML sanitizer for panel-authored rich text (descriptions, rich_text sections).
// Keeps a small set of formatting tags, drops every attribute except a vetted href on <a>, removes
// script/style/iframe blocks with their content, and escapes anything else.

const ALLOWED = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li",
  "h2", "h3", "h4", "blockquote", "hr", "small", "sup", "sub", "span",
]);
const VOID = new Set(["br", "hr"]);
const BLOCK = new Set(["p", "ul", "ol", "h2", "h3", "h4", "blockquote", "hr"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
// "/\host" is treated like "//host" by browsers, so a backslash after the first slash is refused too.
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?![/\\])|#)/i;

const escapeText = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) =>
  s.replace(/&(?!(?:[a-z]+|#\d+|#x[\da-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Named character references other than the basic five. Browsers decode them in attribute values, so
 * "/&sol;evil.example" would become the off-site "//evil.example" (and "&bsol;", "&colon;", "&Tab;"
 * hide slashes, schemes and whitespace). A legitimate link never needs them: such hrefs are dropped.
 */
const NAMED_REFERENCE = /&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z\d]*;/i;

function readHref(attrs: string): string | null {
  const m = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const raw = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  if (NAMED_REFERENCE.test(raw)) return null;
  // Decode entity-obfuscated schemes ("jav&#x61;script:") before checking.
  const decoded = raw.replace(/&#x([\da-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)));
  const compact = decoded.replace(/[\u0000- ]/g, "");
  return SAFE_HREF.test(compact) ? raw : null;
}

export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  const html = input.replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  const out: string[] = [];
  const open: string[] = [];
  const tag = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = tag.exec(html))) {
    out.push(escapeText(html.slice(last, m.index)));
    last = tag.lastIndex;
    const closing = Boolean(m[1]);
    const name = m[2].toLowerCase();
    if (!ALLOWED.has(name)) continue;

    if (closing) {
      const idx = open.lastIndexOf(name);
      if (idx === -1) continue;
      // Close anything left open inside it so the markup stays balanced.
      while (open.length > idx) out.push(`</${open.pop()}>`);
      continue;
    }
    // Implicitly close a paragraph before a block and a list item before its sibling, as browsers do.
    if (BLOCK.has(name) && open.at(-1) === "p") out.push(`</${open.pop()}>`);
    if (name === "li" && open.at(-1) === "li") out.push(`</${open.pop()}>`);
    if (VOID.has(name)) {
      out.push(`<${name}>`);
      continue;
    }
    if (name === "a") {
      const href = readHref(m[3]);
      const external = href ? /^https?:\/\//i.test(href) : false;
      out.push(
        href
          ? `<a href="${escapeAttr(href)}"${external ? ' rel="noopener noreferrer" target="_blank"' : ""}>`
          : "<a>",
      );
    } else {
      out.push(`<${name}>`);
    }
    open.push(name);
  }
  out.push(escapeText(html.slice(last)));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join("");
}

/** True when the text looks like HTML rather than plain paragraphs. */
export function looksLikeHtml(text: string): boolean {
  return /<\/?(p|br|h[2-4]|ul|ol|li|blockquote|strong|b|em|i|a|hr)\b[^>]*>/i.test(text);
}

/** Plain text with blank-line paragraphs → safe HTML paragraphs. */
export function textToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeText(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Sanitized HTML for either authored HTML or plain text. */
export function richTextHtml(text: string | null | undefined): string {
  if (!text) return "";
  return looksLikeHtml(text) ? sanitizeHtml(text) : textToHtml(text);
}
