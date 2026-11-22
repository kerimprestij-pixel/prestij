// Rich-text clean-up for the panel editor (browser only: uses DOMParser). Reduces pasted or edited HTML
// to the editor's subset — p, br, strong, em, a[href], h2, h3, ul, ol, li, blockquote, hr — and then
// runs the shared server sanitizer so the client never emits anything the server would strip.
import { looksLikeHtml, sanitizeHtml, textToHtml } from "@/components/sections/sanitize-html";

const BLOCKS: Record<string, string> = {
  p: "p",
  div: "p",
  section: "p",
  article: "p",
  header: "p",
  footer: "p",
  pre: "p",
  address: "p",
  h1: "h2",
  h2: "h2",
  h3: "h3",
  h4: "h3",
  h5: "h3",
  h6: "h3",
  blockquote: "blockquote",
  ul: "ul",
  ol: "ol",
  li: "li",
  td: "p",
  th: "p",
  dt: "p",
  dd: "p",
  figcaption: "p",
};
const INLINE: Record<string, string> = { strong: "strong", b: "strong", em: "em", i: "em", a: "a" };
const SKIP = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "img", "video", "audio", "picture", "source", "canvas", "head", "title", "meta", "link", "button", "input", "select", "textarea", "form"]);
const OUTPUT_BLOCKS = new Set(["p", "h2", "h3", "ul", "ol", "blockquote", "hr"]);

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

function inlineStyleTags(el: HTMLElement): { open: string; close: string } {
  // Google Docs/Word mark bold and italic with inline styles on spans.
  const weight = el.style?.fontWeight ?? "";
  const bold = weight === "bold" || Number(weight) >= 600;
  const italic = el.style?.fontStyle === "italic";
  return { open: `${bold ? "<strong>" : ""}${italic ? "<em>" : ""}`, close: `${italic ? "</em>" : ""}${bold ? "</strong>" : ""}` };
}

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText((node.textContent ?? "").replace(/ /g, " "));
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag)) return "";
  const inner = () => Array.from(el.childNodes).map(walk).join("");

  if (tag === "br") return "<br>";
  if (tag === "hr") return "<hr>";
  if (BLOCKS[tag]) {
    const out = BLOCKS[tag];
    if (out === "p" || out === "h2" || out === "h3") {
      // Blocks nested in a paragraph/heading (e.g. Chrome's <h2><ul>…</ul></h2>) are lifted out.
      const parts: string[] = [];
      let run = "";
      for (const child of Array.from(el.childNodes)) {
        const childTag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName.toLowerCase() : "";
        if (childTag === "hr" || (BLOCKS[childTag] && BLOCKS[childTag] !== "li")) {
          if (run.trim()) parts.push(`<${out}>${run}</${out}>`);
          run = "";
          parts.push(walk(child));
        } else {
          run += walk(child);
        }
      }
      if (run.trim() || parts.length === 0) parts.push(`<${out}>${run}</${out}>`);
      return parts.join("");
    }
    return `<${out}>${inner()}</${out}>`;
  }
  if (tag === "a") {
    const href = el.getAttribute("href")?.trim();
    return href ? `<a href="${escapeAttr(href)}">${inner()}</a>` : inner();
  }
  if (INLINE[tag]) {
    // Google Docs wraps whole pastes in <b style="font-weight:normal">.
    if (tag === "b" && el.style?.fontWeight === "normal") return inner();
    const out = INLINE[tag];
    return `<${out}>${inner()}</${out}>`;
  }
  const styled = inlineStyleTags(el);
  return `${styled.open}${inner()}${styled.close}`;
}

/** Wraps loose top-level inline content in paragraphs and drops empty blocks. */
function structure(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    const joined = run.join("").replace(/^(\s|<br>)+|(\s|<br>)+$/g, "");
    if (joined.trim()) out.push(`<p>${joined}</p>`);
    run = [];
  };
  for (const child of Array.from(doc.body.childNodes)) {
    const tag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName.toLowerCase() : "";
    if (OUTPUT_BLOCKS.has(tag)) {
      flush();
      const el = child as HTMLElement;
      if (tag === "hr") out.push("<hr>");
      else if ((el.textContent ?? "").trim() || el.querySelector("hr")) out.push(el.outerHTML.replace(/(<br>)+(<\/(p|h2|h3|li|blockquote)>)/g, "$2"));
    } else if (child.nodeType === Node.TEXT_NODE) {
      run.push(escapeText(child.textContent ?? ""));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      run.push((child as HTMLElement).outerHTML);
    }
  }
  flush();
  return out.join("");
}

/** Pasted HTML (Word, Google Docs, web pages) → the editor's clean subset. */
export function cleanRichHtml(html: string): string {
  if (typeof DOMParser === "undefined") return sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const reduced = Array.from(doc.body.childNodes).map(walk).join("");
  return structure(sanitizeHtml(reduced));
}

/** Pasted plain text → paragraphs (blank line = new paragraph, single newline = <br>). */
export function plainTextToHtml(text: string): string {
  return textToHtml(text);
}

/** Stored value → HTML the editor can show (plain text from older data becomes paragraphs). */
export function toEditorHtml(value: string | null | undefined): string {
  if (!value) return "";
  return cleanRichHtml(looksLikeHtml(value) ? value : textToHtml(value));
}

/** Readable HTML for the source view: one block per line. */
export function prettyHtml(html: string): string {
  return html
    .replace(/(<\/(p|h2|h3|blockquote|ul|ol)>|<hr>)/g, "$1\n")
    .replace(/(<(ul|ol)>)/g, "$1\n")
    .replace(/(<\/li>)/g, "$1\n")
    .replace(/<li>/g, "  <li>")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
