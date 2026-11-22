// A small, tolerant HTML reader for the SEO audit. Pure; no dependency. It reads the HTML this site
// (Next 16 + React 19) sends and is not a general-purpose parser:
//   - Attribute names are matched case-insensitively (React prints hrefLang, charSet, fetchPriority).
//   - <script>/<style>/<template> bodies are never scanned for tags; JSON-LD scripts are collected raw
//     (the text inside a <script> is not entity-decoded by browsers either).
//   - React streaming: a Suspense boundary that is pending where it sits (`<!--$?--><template id="B:n">
//     …fallback…<!--/$-->`) gets its real content later in the same response, inside
//     `<div hidden id="S:m">`, swapped in by `$RC("B:n","S:m")`. The reader drops the fallback of every
//     boundary completed that way and keeps the hidden segment: the DOM a browser (and Googlebot) ends
//     up with, so a skeleton next to the real page does not count twice (two <h1>, …). A boundary the
//     server hands to the browser (`$RX`, or `<!--$!-->` with a digest) keeps its fallback, since that
//     is all the HTML has, and is reported in `bailouts`.
//   - Inline <svg> is skipped (its <title> is an icon label, not the document title).
//   - Each element records whether it sits inside <head> (Next streams metadata into <body> for normal
//     browsers on dynamic pages; HTML-limited crawlers such as Bingbot get it in <head>).

export type HtmlAttrs = Record<string, string>;

export type HeadElement = { attrs: HtmlAttrs; inHead: boolean };

export type ParsedHtml = {
  /** Attributes of <html>, null when there is no <html> tag. */
  htmlAttrs: HtmlAttrs | null;
  hasHead: boolean;
  titles: { text: string; inHead: boolean }[];
  metas: HeadElement[];
  links: HeadElement[];
  /** Text of every <h1> (tags stripped, img alt included, whitespace collapsed). */
  h1s: string[];
  anchors: { href: string; rel: string }[];
  /** Every <img>, and whether it sits inside an <a> (a card whose link text already names it). */
  images: { attrs: HtmlAttrs; inLink: boolean }[];
  /** Raw bodies of <script type="application/ld+json">. */
  jsonLd: string[];
  /** Digests/notes of boundaries the server could not render (client-side fallback). */
  bailouts: string[];
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  euro: "€",
};

/** Decodes numeric and the common named character references; unknown names stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/** Collapses runs of whitespace (incl. no-break spaces) and trims. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Attribute string of a start tag → { lowercased name: decoded value } (first occurrence wins). */
export function parseAttributes(source: string): HtmlAttrs {
  const attrs: HtmlAttrs = {};
  for (const match of source.matchAll(ATTR_RE)) {
    const name = match[1].toLowerCase();
    if (Object.hasOwn(attrs, name)) continue;
    const raw = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = decodeEntities(raw);
  }
  return attrs;
}

/** Visible text of an HTML fragment: tags become spaces, <img alt> counts as text, entities decoded. */
export function innerText(fragment: string): string {
  const withAlt = fragment.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => ` ${parseAttributes(attrs).alt ?? ""} `);
  return collapseWhitespace(decodeEntities(withAlt.replace(/<[^>]*>/g, " ")));
}

/**
 * Removes the fallback content of pending Suspense boundaries (`<!--$?--><template id="B:n">…<!--/$-->`)
 * that the same response completes later (`$RC("B:n","S:m")`, ids in `completed`): their real content
 * is in the hidden `S:m` segment, which stays. A boundary that is never completed (still pending, or
 * handed to the browser with `$RX`) keeps its fallback, because that is what the HTML shows; so does a
 * client-rendered boundary (`<!--$!-->`). Completed boundaries (`<!--$-->`) are kept. A boundary left
 * open by truncated HTML is left as it is.
 */
export function stripSuspenseFallbacks(html: string, completed: ReadonlySet<string>): string {
  const ranges: [number, number][] = [];
  const stack: boolean[] = [];
  let stripDepth = 0;
  let rangeStart = 0;
  for (const match of html.matchAll(/<!--(\$[?!~]?|\/\$)-->/g)) {
    const marker = match[1];
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (marker === "/$") {
      if (stack.length === 0) continue;
      if (stack.pop() === true) {
        stripDepth -= 1;
        if (stripDepth === 0) ranges.push([rangeStart, index]);
      }
      continue;
    }
    const id = marker === "$?" ? /^\s*<template\b[^>]*\bid="([^"]*)"/i.exec(html.slice(end, end + 200))?.[1] : undefined;
    const strip = id !== undefined && completed.has(id);
    if (strip) {
      if (stripDepth === 0) rangeStart = end;
      stripDepth += 1;
    }
    stack.push(strip);
  }
  if (ranges.length === 0) return html;
  let out = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    out += html.slice(cursor, start);
    cursor = end;
  }
  return out + html.slice(cursor);
}

const START_TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;

function findClose(html: string, tag: string, from: number): number {
  const re = new RegExp(`</${tag}\\s*>`, "gi");
  re.lastIndex = from;
  const match = re.exec(html);
  return match ? match.index : -1;
}

export function parseHtml(html: string): ParsedHtml {
  const jsonLd: string[] = [];
  const bailouts: string[] = [];
  const completed = new Set<string>();

  // Script bodies: keep JSON-LD, note completed boundaries ($RC/$RR) and boundaries handed to the
  // browser ($RX: a render error or a client-only bailout), drop the rest.
  let work = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_m, attrs: string, body: string) => {
    const type = (parseAttributes(attrs).type ?? "").trim().toLowerCase();
    if (type === "application/ld+json") {
      jsonLd.push(body);
      return "";
    }
    for (const call of body.matchAll(/\$R[CR]\("([^"]*)"/g)) completed.add(call[1]);
    for (const call of body.matchAll(/\$RX\("([^"]*)"(?:\s*,\s*"([^"]*)")?/g)) bailouts.push(call[2] || `boundary ${call[1]}`);
    return "";
  });
  work = work.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  for (const match of work.matchAll(/<template\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[1]);
    if (Object.hasOwn(attrs, "data-dgst")) bailouts.push(attrs["data-dgst"] || attrs["data-msg"] || "unknown digest");
  }
  work = stripSuspenseFallbacks(work, completed);
  work = work.replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, "");
  work = work.replace(/<!--[\s\S]*?-->/g, "");
  work = work.replace(/<svg\b[^>]*\/>/gi, " ").replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, " ");

  const headStart = work.search(/<head[\s>]/i);
  const headClose = work.search(/<\/head\s*>/i);
  const bodyStart = work.search(/<body[\s>]/i);
  const hasHead = headStart >= 0;
  const headEnd = !hasHead ? -1 : headClose >= 0 ? headClose : bodyStart >= 0 ? bodyStart : work.length;
  const inHead = (index: number) => hasHead && index > headStart && index < headEnd;
  // Ranges of <a …>…</a> (links do not nest in valid HTML), to tell images inside a link apart.
  const linkRanges: [number, number][] = [];
  for (const open of work.matchAll(/<a\b[^>]*>/gi)) {
    const start = open.index ?? 0;
    const close = findClose(work, "a", start + open[0].length);
    linkRanges.push([start, close >= 0 ? close : start + open[0].length]);
  }
  const inLink = (index: number) => linkRanges.some(([start, end]) => index > start && index < end);

  const parsed: ParsedHtml = { htmlAttrs: null, hasHead, titles: [], metas: [], links: [], h1s: [], anchors: [], images: [], jsonLd, bailouts };

  const re = new RegExp(START_TAG_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(work)) !== null) {
    const tag = match[1].toLowerCase();
    const index = match.index;
    const end = index + match[0].length;
    switch (tag) {
      case "html":
        if (!parsed.htmlAttrs) parsed.htmlAttrs = parseAttributes(match[2] ?? "");
        break;
      case "title": {
        const close = findClose(work, "title", end);
        const text = close >= 0 ? collapseWhitespace(decodeEntities(work.slice(end, close))) : "";
        parsed.titles.push({ text, inHead: inHead(index) });
        if (close >= 0) re.lastIndex = close;
        break;
      }
      case "meta":
        parsed.metas.push({ attrs: parseAttributes(match[2] ?? ""), inHead: inHead(index) });
        break;
      case "link":
        parsed.links.push({ attrs: parseAttributes(match[2] ?? ""), inHead: inHead(index) });
        break;
      case "a": {
        const attrs = parseAttributes(match[2] ?? "");
        if (attrs.href !== undefined) parsed.anchors.push({ href: attrs.href, rel: attrs.rel ?? "" });
        break;
      }
      case "img":
        parsed.images.push({ attrs: parseAttributes(match[2] ?? ""), inLink: inLink(index) });
        break;
      case "h1": {
        const close = findClose(work, "h1", end);
        parsed.h1s.push(innerText(close >= 0 ? work.slice(end, close) : ""));
        break;
      }
      default:
        break;
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------------------------------
// Head lookups

const tokens = (value: string | undefined) => (value ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** <meta name="…"> elements (name compared case-insensitively). */
export function metaByName(page: ParsedHtml, name: string): HeadElement[] {
  return page.metas.filter((m) => (m.attrs.name ?? "").trim().toLowerCase() === name);
}

/** <meta property="…"> elements (Open Graph), falling back to name="…" as some sites print it. */
export function metaByProperty(page: ParsedHtml, property: string): HeadElement[] {
  const byProperty = page.metas.filter((m) => (m.attrs.property ?? "").trim().toLowerCase() === property);
  return byProperty.length > 0 ? byProperty : metaByName(page, property);
}

/** <link> elements whose rel list contains `rel`. */
export function linksByRel(page: ParsedHtml, rel: string): HeadElement[] {
  return page.links.filter((l) => tokens(l.attrs.rel).includes(rel));
}

/** hreflang alternates: <link rel="alternate" hreflang="…" href="…">. */
export function hreflangLinks(page: ParsedHtml): { hreflang: string; href: string; inHead: boolean }[] {
  return linksByRel(page, "alternate")
    .filter((l) => l.attrs.hreflang !== undefined)
    .map((l) => ({ hreflang: (l.attrs.hreflang ?? "").trim(), href: (l.attrs.href ?? "").trim(), inHead: l.inHead }));
}

/**
 * Robots directives from <meta name="robots"> and <meta name="googlebot"> plus an X-Robots-Tag header
 * value (only directives without a user-agent prefix, or for googlebot). "none" = noindex + nofollow.
 */
export function robotsDirectives(page: ParsedHtml | null, xRobotsTag?: string | null): { noindex: boolean; nofollow: boolean; sources: string[] } {
  const values: string[] = [];
  const sources: string[] = [];
  if (page) {
    for (const name of ["robots", "googlebot"]) {
      for (const meta of metaByName(page, name)) {
        values.push(meta.attrs.content ?? "");
        sources.push(`<meta name="${name}" content="${meta.attrs.content ?? ""}">`);
      }
    }
  }
  if (xRobotsTag) {
    // "noindex, nofollow" applies to every crawler; "otherbot: noindex, nofollow" only to otherbot
    // (a user-agent prefix applies to the directives after it). Directives with values
    // ("max-snippet: 20", "unavailable_after: …") are not user agents.
    const VALUED = new Set(["unavailable_after", "max-snippet", "max-image-preview", "max-video-preview"]);
    let agent: string | null = null;
    for (const token of xRobotsTag.split(",")) {
      const prefixed = /^\s*([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i.exec(token);
      let directive = token;
      if (prefixed && !VALUED.has(prefixed[1].toLowerCase())) {
        agent = prefixed[1].toLowerCase();
        directive = prefixed[2];
      }
      if (agent === null || agent === "googlebot") values.push(directive);
    }
    sources.push(`X-Robots-Tag: ${xRobotsTag}`);
  }
  const directives = values.flatMap((v) => v.toLowerCase().split(",").map((d) => d.trim()));
  const none = directives.includes("none");
  return { noindex: none || directives.includes("noindex"), nofollow: none || directives.includes("nofollow"), sources };
}
