// Rules for one HTML page (status 200): head metadata, headings, language, canonical, hreflang, Open
// Graph, images and JSON-LD. Pure. Cross-page rules (duplicates, reciprocity, sitemap membership) live
// in site.ts and use the facts returned here.
//
// Which pages are judged on content: only pages that can appear in search, i.e. without noindex and
// whose canonical (if any) is the page itself. A URL with a query string whose canonical is the same
// URL without the query (e.g. a product link with ?varyant=12) is a deliberate duplicate: it only has
// to work and point its canonical to a good page (checked in site.ts).
import { hreflangLinks, linksByRel, metaByName, metaByProperty, parseHtml, robotsDirectives } from "./html";
import { checkJsonLd, type JsonLdFacts } from "./jsonld";
import { issue, type Issue } from "./types";
import { hasQuery, isForeignLocalUrl, isValidHreflang, localeOfUrl, parseAbsolute, primaryLanguage, resolveLink, withoutQuery } from "./url";
import { charLength } from "./values";

export const TITLE_MIN = 20;
export const TITLE_MAX = 70;
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;

export type PageInput = {
  /** Final URL of the page on the audited origin (after redirects). */
  url: string;
  html: string;
  /** X-Robots-Tag response header, if any. */
  xRobotsTag?: string | null;
  origin: string;
  locales: readonly string[];
  defaultLocale: string;
  rtlLocales: readonly string[];
  now: Date;
};

export type PageFacts = {
  url: string;
  /** Locale from the URL path ("/en/…" → "en"), null outside the locale tree. */
  locale: string | null;
  lang: string | null;
  dir: string | null;
  title: string | null;
  description: string | null;
  h1: string[];
  /** The canonical href as written (absolute when valid), null when absent. */
  canonical: string | null;
  /** hreflang (lowercased) → absolute href, from valid alternates only. */
  hreflang: Record<string, string>;
  noindex: boolean;
  nofollow: boolean;
  /** Canonical is this exact URL. */
  selfCanonical: boolean;
  /** Can appear in search: no noindex and (no canonical or a self canonical). */
  indexable: boolean;
  ogTitle: string | null;
  ogImage: string | null;
  /** Absolute http(s) links of <a href> (fragment removed), in document order, unique. */
  links: string[];
  /** Same-origin URLs named by metadata (canonical, hreflang, og:url, JSON-LD): crawled to prove they work. */
  metadataUrls: string[];
  /** Image URLs named by metadata (og:image, twitter:image, JSON-LD): checked as assets. */
  imageUrls: string[];
  jsonLd: JsonLdFacts;
};

const unique = (values: string[]) => [...new Set(values)];

export function checkPage(input: PageInput): { issues: Issue[]; facts: PageFacts } {
  const { url, origin, locales } = input;
  const page = parseHtml(input.html);
  const issues: Issue[] = [];
  const add = (code: Parameters<typeof issue>[0], message: string) => issues.push(issue(code, message, url));

  const robots = robotsDirectives(page, input.xRobotsTag);
  const locale = localeOfUrl(url, locales);
  const lang = page.htmlAttrs?.lang?.trim() || null;
  const dir = page.htmlAttrs?.dir?.trim().toLowerCase() || null;

  // ---- language and direction (every HTML page)
  if (!lang) add("html-lang-missing", "<html> has no lang attribute.");
  else if (locale && primaryLanguage(lang) !== locale) add("html-lang-mismatch", `<html lang="${lang}"> on a /${locale}/ URL.`);
  if (locale) {
    const expected = input.rtlLocales.includes(locale) ? "rtl" : "ltr";
    if ((dir ?? "ltr") !== expected) add("html-dir-mismatch", `<html dir="${dir ?? ""}"> but /${locale}/ is ${expected}.`);
  }

  for (const digest of unique(page.bailouts)) {
    const message = digest.startsWith("NEXT_REDIRECT")
      ? `a redirect inside a streamed boundary (the page answers 200 and redirects in the browser): ${digest}.`
      : digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
        ? `a notFound()/HTTP error inside a streamed boundary: ${digest}.`
        : digest.startsWith("boundary ")
          ? `the server did not render ${digest.slice("boundary ".length)} (a render error, or a client-only API such as useSearchParams); browsers render it, HTML-only crawlers see only its fallback.`
          : `a Suspense boundary is rendered only in the browser (digest ${digest}); HTML-only crawlers see only its fallback.`;
    add("client-render-bailout", message);
  }

  // ---- canonical
  const canonicalLinks = linksByRel(page, "canonical");
  const canonicalRaw = canonicalLinks[0]?.attrs.href?.trim() || null;
  const canonicalUrl = parseAbsolute(canonicalRaw);
  const canonical = canonicalUrl ? canonicalUrl.href : canonicalRaw;
  const selfCanonical = canonical !== null && canonicalUrl !== null && canonical === url;
  const queryVariant = canonical !== null && hasQuery(url) && canonical === withoutQuery(url);

  if (robots.noindex) {
    if (canonicalUrl && canonical !== url) add("noindex-foreign-canonical", `noindex, but the canonical points to ${canonical}.`);
  } else {
    if (canonicalLinks.length === 0) add("canonical-missing", "No <link rel=\"canonical\">.");
    if (canonicalLinks.length > 1) add("canonical-multiple", `${canonicalLinks.length} canonical links: ${canonicalLinks.map((l) => l.attrs.href).join(", ")}.`);
    if (canonicalRaw && !canonicalUrl) add("canonical-relative", `Canonical "${canonicalRaw}" is not an absolute URL.`);
    if (canonicalUrl && canonical !== url && !queryVariant) {
      add("canonical-not-self", `Canonical ${canonical} is not this page.`);
      if (isForeignLocalUrl(canonicalUrl.href, origin)) add("foreign-origin-url", `Canonical points to ${canonicalUrl.origin}.`);
    }
  }

  const indexable = !robots.noindex && (canonicalLinks.length === 0 || selfCanonical || (canonicalRaw !== null && !canonicalUrl));
  const titleTexts = page.titles.map((t) => t.text);
  const title = titleTexts.find((t) => t) ?? null;
  const descriptionMetas = metaByName(page, "description");
  const description = descriptionMetas.map((m) => (m.attrs.content ?? "").trim()).find((d) => d) ?? null;
  const ogTitle = metaByProperty(page, "og:title")[0]?.attrs.content?.trim() || null;
  const ogImageRaw = metaByProperty(page, "og:image")[0]?.attrs.content?.trim() || null;
  const ogUrl = metaByProperty(page, "og:url")[0]?.attrs.content?.trim() || null;
  const twitterImage = metaByName(page, "twitter:image")[0]?.attrs.content?.trim() || null;

  const hreflang: Record<string, string> = {};
  const alternates = hreflangLinks(page);
  const metadataUrls: string[] = [];
  if (canonicalUrl) metadataUrls.push(canonicalUrl.href);

  if (indexable) {
    // ---- head metadata outside <head> (HTML-limited crawlers such as Bingbot read only <head>)
    const outside: string[] = [];
    if (page.titles.length > 0 && !page.titles.some((t) => t.inHead)) outside.push("<title>");
    if (descriptionMetas.length > 0 && !descriptionMetas.some((m) => m.inHead)) outside.push("meta description");
    if (canonicalLinks.length > 0 && !canonicalLinks.some((l) => l.inHead)) outside.push("canonical");
    if (alternates.length > 0 && !alternates.some((l) => l.inHead)) outside.push("hreflang");
    if (outside.length > 0) add("metadata-outside-head", `${outside.join(", ")} only in <body> (streamed metadata).`);

    // ---- title
    if (!title) add("title-missing", "No <title> text.");
    else {
      const length = charLength(title);
      if (length > TITLE_MAX) add("title-too-long", `${length} characters: "${title}".`);
      if (length < TITLE_MIN) add("title-too-short", `${length} characters: "${title}".`);
    }
    if (page.titles.length > 1) add("title-multiple", `${page.titles.length} <title> elements: ${titleTexts.map((t) => `"${t}"`).join(", ")}.`);

    // ---- meta description
    if (!description) add("description-missing", "No meta description (or an empty one).");
    else {
      const length = charLength(description);
      if (length < DESCRIPTION_MIN || length > DESCRIPTION_MAX) add("description-length", `${length} characters (aim for ${DESCRIPTION_MIN}–${DESCRIPTION_MAX}): "${description}".`);
    }
    if (descriptionMetas.length > 1) add("description-multiple", `${descriptionMetas.length} meta descriptions.`);

    // ---- h1
    if (page.h1s.length === 0) add("h1-missing", "The page has no <h1>.");
    if (page.h1s.length > 1) add("h1-multiple", `${page.h1s.length} <h1>: ${page.h1s.map((h) => `"${h}"`).join(", ")}.`);
    if (page.h1s.some((h) => !h)) add("h1-empty", "An <h1> has no text.");

    // ---- hreflang
    if (alternates.length === 0) add("hreflang-missing", "No <link rel=\"alternate\" hreflang> alternates.");
    for (const alt of alternates) {
      const href = parseAbsolute(alt.href);
      if (!isValidHreflang(alt.hreflang)) {
        add("hreflang-invalid", `hreflang "${alt.hreflang}" is not a language code.`);
        continue;
      }
      if (!href || href.origin !== origin) {
        add("hreflang-invalid", `hreflang ${alt.hreflang} → "${alt.href}" is not an absolute URL on ${origin}.`);
        if (href && isForeignLocalUrl(href.href, origin)) add("foreign-origin-url", `hreflang ${alt.hreflang} points to ${href.origin}.`);
        continue;
      }
      const key = alt.hreflang.toLowerCase();
      if (hreflang[key] !== undefined && hreflang[key] !== href.href) add("hreflang-invalid", `hreflang "${alt.hreflang}" points to two URLs.`);
      else hreflang[key] = href.href;
      metadataUrls.push(href.href);
    }
    if (alternates.length > 0) {
      const keys = Object.keys(hreflang);
      const missing = locales.filter((l) => !keys.some((k) => k !== "x-default" && primaryLanguage(k) === l));
      if (!keys.includes("x-default")) missing.push("x-default");
      if (missing.length > 0) add("hreflang-incomplete", `Missing: ${missing.join(", ")}.`);
      const ownLang = locale ?? (lang ? primaryLanguage(lang) : null);
      const selfEntry = ownLang ? Object.entries(hreflang).find(([k]) => k !== "x-default" && primaryLanguage(k) === ownLang) : undefined;
      if (!selfEntry || selfEntry[1] !== url) add("hreflang-self-missing", `The ${ownLang ?? "page's"} alternate is ${selfEntry ? selfEntry[1] : "missing"}, expected this URL.`);
      const defaultEntry = Object.entries(hreflang).find(([k]) => k !== "x-default" && primaryLanguage(k) === input.defaultLocale);
      if (hreflang["x-default"] && defaultEntry && hreflang["x-default"] !== defaultEntry[1]) {
        add("hreflang-x-default", `x-default → ${hreflang["x-default"]}, the ${input.defaultLocale} version is ${defaultEntry[1]}.`);
      }
    }

    // ---- Open Graph
    if (!ogTitle) add("og-title-missing", "No og:title.");
    if (!ogImageRaw) add("og-image-missing", "No og:image (the share preview has no picture).");
    else if (!parseAbsolute(ogImageRaw)) add("og-image-relative", `og:image "${ogImageRaw}" is not absolute.`);
    else if (isForeignLocalUrl(ogImageRaw, origin)) add("foreign-origin-url", `og:image points to ${ogImageRaw}.`);
    if (ogUrl && canonicalUrl && parseAbsolute(ogUrl)?.href !== canonicalUrl.href) add("og-url-mismatch", `og:url ${ogUrl} ≠ canonical ${canonicalUrl.href}.`);
    if (ogUrl && isForeignLocalUrl(ogUrl, origin)) add("foreign-origin-url", `og:url points to ${ogUrl}.`);

    // ---- images
    // alt="" is right for decorative images and for a picture inside a link whose text names it (product
    // cards), so only a missing attribute is an error; an empty alt is flagged only on the page's main
    // (high-priority, LCP) image when it is not inside a link.
    const noAlt = page.images.filter((img) => !Object.hasOwn(img.attrs, "alt"));
    if (noAlt.length > 0) add("img-alt-missing", `${noAlt.length} <img> without alt, e.g. ${noAlt.slice(0, 3).map((i) => i.attrs.src ?? "(no src)").join(", ")}.`);
    const emptyPriority = page.images.filter((img) => !img.inLink && (img.attrs.alt ?? "x").trim() === "" && (img.attrs.fetchpriority ?? "").toLowerCase() === "high");
    if (emptyPriority.length > 0) add("img-alt-empty-priority", `alt="" on ${emptyPriority.map((i) => i.attrs.src ?? "(no src)").join(", ")}.`);
  }

  // ---- links (every page: broken internal links count wherever they are)
  const links: string[] = [];
  const foreignLinkOrigins = new Map<string, string>();
  for (const anchor of page.anchors) {
    const resolved = resolveLink(anchor.href, url);
    if (!resolved) continue;
    links.push(resolved);
    if (isForeignLocalUrl(resolved, origin)) foreignLinkOrigins.set(new URL(resolved).origin, resolved);
  }
  for (const [foreign, example] of foreignLinkOrigins) add("foreign-origin-url", `Link to ${foreign}, e.g. ${example}.`);

  // ---- JSON-LD (judged on indexable pages, like the rest of the content)
  const jsonLdResult = indexable
    ? checkJsonLd(page.jsonLd, { pageUrl: url, canonical: canonicalUrl?.href ?? null, origin, pageLang: locale ?? (lang ? primaryLanguage(lang) : null), now: input.now })
    : { issues: [], facts: { types: [], offers: [], pageUrls: [], images: [], groups: [] } satisfies JsonLdFacts };
  issues.push(...jsonLdResult.issues);
  metadataUrls.push(...jsonLdResult.facts.pageUrls);
  const ogUrlParsed = parseAbsolute(ogUrl);
  if (ogUrlParsed) metadataUrls.push(ogUrlParsed.href);

  const imageUrls = [ogImageRaw, twitterImage, ...jsonLdResult.facts.images].filter((u): u is string => !!u && parseAbsolute(u) !== null);

  return {
    issues,
    facts: {
      url,
      locale,
      lang,
      dir,
      title,
      description,
      h1: page.h1s,
      canonical,
      hreflang,
      noindex: robots.noindex,
      nofollow: robots.nofollow,
      selfCanonical,
      indexable,
      ogTitle,
      ogImage: ogImageRaw,
      links: unique(links),
      metadataUrls: unique(metadataUrls.filter((u) => parseAbsolute(u)?.origin === origin)),
      imageUrls: unique(imageUrls),
      jsonLd: jsonLdResult.facts,
    },
  };
}
