// Day 5 SEO-AUDIT: the tolerant HTML reader (src/lib/seo/audit/html.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeEntities, hreflangLinks, innerText, linksByRel, metaByName, parseAttributes, parseHtml, robotsDirectives, stripSuspenseFallbacks } from "@/lib/seo/audit/html";
import { pageHtml } from "./day5-seo-audit-fixtures";

describe("decodeEntities / parseAttributes / innerText", () => {
  test("numeric and common named references; unknown names stay", () => {
    assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#x27;e&#39; &#304;&#x130; &rsquo;&nbsp;&hellip; &bogus;"), "a & b <c> \"d\" 'e' İİ ’ … &bogus;");
  });

  test("attribute names are case-insensitive (React prints hrefLang), values decoded, first occurrence wins", () => {
    const attrs = parseAttributes(` rel="alternate" hrefLang="en" href="/en?a=1&amp;b=2" data-x='y' hidden HREFLANG="tr" unquoted=val`);
    assert.deepEqual(attrs, { rel: "alternate", hreflang: "en", href: "/en?a=1&b=2", "data-x": "y", hidden: "", unquoted: "val" });
  });

  test("innerText joins inline parts with spaces and counts img alt as text", () => {
    assert.equal(innerText(`<span>Lavanta</span><span class="block text-sm">Sıvı El&nbsp;Sabunu</span>`), "Lavanta Sıvı El Sabunu");
    assert.equal(innerText(`<img src="/logo.png" alt="PRESTİJ"/>`), "PRESTİJ");
  });
});

describe("parseHtml on Next/React output", () => {
  const page = parseHtml(pageHtml());

  test("<html lang/dir>, head metadata with inHead, the svg <title> ignored", () => {
    assert.equal(page.htmlAttrs?.lang, "tr");
    assert.equal(page.htmlAttrs?.dir, "ltr");
    assert.equal(page.hasHead, true);
    assert.deepEqual(page.titles, [{ text: "Lavanta Sıvı El Sabunu | PRESTİJ", inHead: true }]);
    assert.equal(metaByName(page, "description")[0]?.inHead, true);
    assert.equal(linksByRel(page, "canonical")[0]?.attrs.href, "http://check.localhost:3580/tr/urunler/lavanta");
    assert.deepEqual(
      hreflangLinks(page).map((l) => l.hreflang),
      ["tr", "en", "ar", "x-default"],
    );
  });

  test("the streamed segment counts, the completed boundary's skeleton fallback does not, script strings are not markup", () => {
    assert.deepEqual(page.h1s, ["Lavanta"]);
    assert.equal(page.jsonLd.length, 0);
    assert.deepEqual(page.bailouts, []);
    assert.ok(page.anchors.some((a) => a.href === "tel:+903523533070"));
    assert.ok(page.anchors.some((a) => a.href === "/tr"));
  });

  test("images: attributes and whether they sit inside a link", () => {
    assert.equal(page.images.length, 2);
    assert.equal(page.images[0].attrs.fetchpriority, "high");
    assert.equal(page.images[0].inLink, false);
    const linked = parseHtml(`<html><body><a href="/tr/urunler/x"><picture><img src="/a.webp" alt=""/></picture><span>X</span></a><img src="/b.webp" alt="b"/></body></html>`);
    assert.deepEqual(linked.images.map((i) => i.inLink), [true, false]);
  });

  test("JSON-LD bodies are collected raw (the \\u003c escape stays for JSON.parse)", () => {
    const html = pageHtml({ jsonLd: [{ "@context": "https://schema.org", "@type": "Thing", name: "a </script> b" }] });
    const parsed = parseHtml(html);
    assert.equal(parsed.jsonLd.length, 1);
    assert.equal((JSON.parse(parsed.jsonLd[0]) as { name: string }).name, "a </script> b");
  });

  test("metadata streamed into <body> is found but marked outside <head>", () => {
    const parsed = parseHtml(pageHtml({ metadataInBody: true }));
    assert.equal(parsed.titles.length, 1);
    assert.equal(parsed.titles[0].inHead, false);
    assert.equal(linksByRel(parsed, "canonical")[0]?.inHead, false);
  });
});

describe("Suspense boundaries", () => {
  const boundary = (id: string, fallback: string) => `<!--$?--><template id="${id}"></template>${fallback}<!--/$-->`;

  test("a boundary completed by $RC loses its fallback; the hidden segment stays", () => {
    const html = `<main>${boundary("B:0", "<h1>Skeleton</h1>")}</main><div hidden id="S:0"><h1>Real</h1></div>`;
    assert.equal(stripSuspenseFallbacks(html, new Set(["B:0"])), `<main><!--$?--><!--/$--></main><div hidden id="S:0"><h1>Real</h1></div>`);
    const parsed = parseHtml(`<html><body>${html}<script>$RC("B:0","S:0")</script></body></html>`);
    assert.deepEqual(parsed.h1s, ["Real"]);
  });

  test("a boundary handed to the browser ($RX) keeps its fallback (that is all the HTML has) and is reported", () => {
    const parsed = parseHtml(`<html><body>${boundary("B:0", "<form><h1>Form</h1></form>")}<script>$RX=function(){};$RX("B:0","")</script></body></html>`);
    assert.deepEqual(parsed.h1s, ["Form"]);
    assert.deepEqual(parsed.bailouts, ["boundary B:0"]);
  });

  test("a never-completed pending boundary keeps its fallback", () => {
    assert.deepEqual(parseHtml(`<html><body>${boundary("B:3", "<h1>Only</h1>")}</body></html>`).h1s, ["Only"]);
  });

  test("nested boundaries: a completed outer boundary removes everything inside it", () => {
    const html = `<!--$?--><template id="B:0"></template><h1>Outer</h1><!--$--><h1>Inner</h1><!--/$--><!--/$--><div hidden id="S:0"><h1>Real</h1></div>`;
    assert.deepEqual(parseHtml(`<html><body>${html}<script>$RC("B:0","S:0")</script></body></html>`).h1s, ["Real"]);
  });

  test("a client-rendered boundary (<!--$!--> with a digest) keeps its fallback and reports the digest", () => {
    const html = `<html><body><!--$!--><template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template><h1>Fallback</h1><!--/$--></body></html>`;
    const parsed = parseHtml(html);
    assert.deepEqual(parsed.h1s, ["Fallback"]);
    assert.deepEqual(parsed.bailouts, ["BAILOUT_TO_CLIENT_SIDE_RENDERING"]);
  });
});

describe("robotsDirectives", () => {
  const withMeta = (name: string, content: string) => parseHtml(`<html><head><meta name="${name}" content="${content}"/></head></html>`);

  test("meta robots / googlebot, including none", () => {
    assert.equal(robotsDirectives(withMeta("robots", "noindex, follow")).noindex, true);
    assert.equal(robotsDirectives(withMeta("robots", "noindex, follow")).nofollow, false);
    assert.equal(robotsDirectives(withMeta("googlebot", "noindex")).noindex, true);
    assert.deepEqual(
      [robotsDirectives(withMeta("robots", "none")).noindex, robotsDirectives(withMeta("robots", "none")).nofollow],
      [true, true],
    );
    assert.equal(robotsDirectives(withMeta("robots", "index, follow, max-image-preview:large")).noindex, false);
  });

  test("X-Robots-Tag: global directives apply, another bot's do not, valued directives are not user agents", () => {
    assert.equal(robotsDirectives(null, "noindex").noindex, true);
    assert.equal(robotsDirectives(null, "googlebot: noindex, nofollow").nofollow, true);
    assert.equal(robotsDirectives(null, "otherbot: noindex, nofollow").noindex, false);
    assert.equal(robotsDirectives(null, "max-snippet: 20, noindex").noindex, true);
    assert.equal(robotsDirectives(null, "unavailable_after: 2026-12-01").noindex, false);
  });
});
