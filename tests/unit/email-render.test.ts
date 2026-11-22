// E-mail rendering (pure): escaping, placeholders filled after escaping, URLs, the block renderer,
// RTL, the plain-text part, panel overrides, marketing footers and the template registry.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Locale } from "@/i18n/config";
import { defaultMessages } from "@/i18n/messages";
import { renderBlocksHtml, renderBlocksText, richTextToEmailHtml, htmlToText, type BlockRenderContext } from "@/lib/email/blocks";
import { escapeHtml, fillHtml, fillText, findPlaceholders, headerText, safeColor, safeEmailUrl, unknownPlaceholders } from "@/lib/email/escape";
import { defineEmailTemplate, getEmailTemplate, listEmailTemplates } from "@/lib/email/registry";
import { applyIntro, renderContent, renderTemplate, templateDefaults, type EmailRenderEnvironment } from "@/lib/email/render";
import "@/lib/email/templates";
import { emailTheme } from "@/lib/email/theme";
import type { EmailBlock } from "@/lib/email/types";
import { parseSettings } from "@/lib/settings/types";

const SITE = "https://prestij.test";

function env(locale: Locale, emails: unknown = {}): EmailRenderEnvironment {
  return {
    locale,
    messages: defaultMessages[locale],
    general: parseSettings("general", { email: "info@prestij.test", phone: "0352 353 30 70" }),
    emails: parseSettings("emails", emails),
    siteUrl: SITE,
  };
}

function blockCtx(dir: "ltr" | "rtl" = "ltr", vars: Record<string, string> = {}): BlockRenderContext {
  return { theme: emailTheme(undefined, dir), dir, locale: dir === "rtl" ? "ar" : "tr", vars, siteUrl: SITE, buttonFallback: "Bağlantı:" };
}

const verify = () => {
  const t = getEmailTemplate("account_verify");
  assert.ok(t, "account_verify is registered");
  return t;
};

describe("escaping and placeholders", () => {
  test("escapeHtml escapes the five HTML characters", () => {
    assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    assert.equal(escapeHtml(null), "");
  });

  test("placeholders are filled after escaping, with escaped values", () => {
    const html = fillHtml("<b>Merhaba {name}</b> & {orderNumber}", { name: `<script>alert("x")</script>`, orderNumber: "PR-261001" });
    assert.equal(html, "&lt;b&gt;Merhaba &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;/b&gt; &amp; PR-261001");
    assert.ok(!html.includes("<script>"));
  });

  test("a value cannot smuggle in another placeholder (single pass)", () => {
    assert.equal(fillHtml("{name} / {orderNumber}", { name: "{orderNumber}", orderNumber: "PR-1" }), "{orderNumber} / PR-1");
    assert.equal(fillText("{name} / {orderNumber}", { name: "{orderNumber}", orderNumber: "PR-1" }), "{orderNumber} / PR-1");
  });

  test("unknown placeholders stay visible; null values become empty", () => {
    assert.equal(fillText("Hi {name}, {unknown}", { name: null }), "Hi , {unknown}");
    assert.deepEqual(findPlaceholders("{a} {b} {a} { c } {1x}"), ["a", "b"]);
    assert.deepEqual(unknownPlaceholders("Merhaba {name}, {orderNumber} {hacker}", ["name", "orderNumber"]), ["hacker"]);
  });

  test("headerText keeps the subject on one line", () => {
    assert.equal(headerText("Siparişiniz\r\nBcc: x@y.z\t  hazır"), "Siparişiniz Bcc: x@y.z hazır");
    assert.equal(headerText("a".repeat(300)).length, 250);
  });

  test("safeEmailUrl allows https, local http, mailto, tel and site paths only", () => {
    assert.equal(safeEmailUrl("https://prestij.test/tr/hesap", SITE), "https://prestij.test/tr/hesap");
    assert.equal(safeEmailUrl("/tr/hesap/dogrula?token=a b", SITE), null, "whitespace refused");
    assert.equal(safeEmailUrl("/tr/hesap/dogrula?token=ab", SITE), "https://prestij.test/tr/hesap/dogrula?token=ab");
    assert.equal(safeEmailUrl("http://localhost:3000/tr", SITE), "http://localhost:3000/tr");
    assert.equal(safeEmailUrl("http://corecomms.localhost:3401/tr", SITE), "http://corecomms.localhost:3401/tr");
    assert.equal(safeEmailUrl("mailto:info@prestij.test", SITE), "mailto:info@prestij.test");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.example", "http://evil.example", "https://user:pw@evil.example", "/\\evil.example", ""]) {
      assert.equal(safeEmailUrl(bad, SITE), null, bad);
    }
    assert.equal(safeColor("#C2ADD1", "#000"), "#C2ADD1");
    assert.equal(safeColor("red;background:url(x)", "#000"), "#000");
  });
});

describe("block renderer", () => {
  test("every block type renders escaped table rows", () => {
    const blocks: EmailBlock[] = [
      { type: "heading", eyebrow: "Sipariş", text: "Teşekkürler {name}" },
      { type: "paragraph", text: "Satır 1\nSatır 2\n\nİkinci paragraf <b>" },
      { type: "button", label: "Siparişi görüntüle", url: "/tr/siparis/PR-1?t=abc", showUrl: true },
      { type: "keyValue", title: "Bilgiler", rows: [{ label: "Sipariş no", value: "PR-1" }, { label: "Adres", value: "Satır\n<i>2</i>" }] },
      { type: "orderLines", lines: [{ name: "Lavanta <Latte>", detail: "500 ml", quantity: 2, total: "299,80 ₺", imageUrl: "https://prestij.test/a.jpg" }, { name: "Okyanus", quantity: 1, total: "0,00 ₺", accent: "#329BC0", badge: "Numune" }] },
      { type: "totals", rows: [{ label: "Ara toplam", value: "299,80 ₺" }, { label: "İndirim", value: "−10,00 ₺", kind: "discount" }, { label: "Toplam", value: "289,80 ₺", kind: "total" }, { label: "KDV dahil", value: "", kind: "note" }] },
      { type: "notice", title: "Bilgi", text: "Kargoya verildi", tone: "success" },
      { type: "divider" },
      { type: "bankAccounts", title: "Hesaplar", accounts: [{ bank: "Ziraat", holder: "PRESTİJ", iban: "TR330006100519786457841326" }], reference: { label: "Açıklama", value: "PR-1" }, note: "Son gün: yarın", labels: { holder: "Hesap sahibi", iban: "IBAN" } },
    ];
    const html = renderBlocksHtml(blocks, blockCtx("ltr", { name: "<Ayşe>" }));
    assert.ok(html.includes("Teşekkürler &lt;Ayşe&gt;"), "placeholder escaped");
    assert.ok(html.includes("Satır 1<br>Satır 2"), "newline → br");
    assert.ok(html.includes("İkinci paragraf &lt;b&gt;"), "paragraph text escaped");
    assert.ok(html.includes('href="https://prestij.test/tr/siparis/PR-1?t=abc"'), "site path made absolute");
    assert.ok(html.includes("Lavanta &lt;Latte&gt;"), "order line escaped");
    assert.ok(html.includes("Satır<br>&lt;i&gt;2&lt;/i&gt;"), "keyValue value escaped with breaks");
    assert.ok(html.includes("TR33 0006 1005 1978 6457 8413 26"), "IBAN grouped");
    assert.ok(html.includes('bgcolor="#329BC0"'), "accent placeholder");
    assert.ok(!/<(script|b|i)>/.test(html), "no raw markup from data");
    assert.equal((html.match(/<tr>/g) ?? []).length >= 9, true);
  });

  test("an unsafe button URL renders the label without a link", () => {
    const html = renderBlocksHtml([{ type: "button", label: "Tıkla", url: "javascript:alert(1)" }], blockCtx());
    assert.ok(!html.includes("href="));
    assert.ok(html.includes("Tıkla"));
  });

  test("RTL flips alignment and keeps IBAN / quantities left-to-right", () => {
    const ltr = renderBlocksHtml([{ type: "keyValue", rows: [{ label: "a", value: "b" }] }], blockCtx("ltr"));
    const rtl = renderBlocksHtml(
      [
        { type: "keyValue", rows: [{ label: "a", value: "b" }] },
        { type: "bankAccounts", accounts: [{ bank: "B", holder: "H", iban: "TR330006100519786457841326" }] },
        { type: "heading", eyebrow: "عنوان", text: "x" },
      ],
      blockCtx("rtl"),
    );
    assert.ok(ltr.includes("text-align:left") && ltr.includes("text-align:right"));
    assert.ok(rtl.includes('dir="ltr"'), "IBAN stays LTR");
    assert.ok(/padding-right:16px/.test(rtl), "the gap is on the start (right) side in RTL");
    assert.ok(!/letter-spacing:2px;text-transform:uppercase/.test(rtl), "no letter-spaced uppercase for Arabic");
  });

  test("rich text is sanitized, styled, and internal links are localized and absolute", () => {
    const html = richTextToEmailHtml(
      `<p>Merhaba <strong>dünya</strong></p><script>alert(1)</script><p><a href="/urunler/lavanta">Lavanta</a> <a href="javascript:x">kötü</a></p><ul><li>bir</li></ul>`,
      { theme: emailTheme(), dir: "ltr", locale: "en", siteUrl: SITE },
    );
    assert.ok(!html.includes("script") && !html.includes("javascript"));
    assert.ok(html.includes('href="https://prestij.test/en/products/lavanta"'));
    assert.ok(/<p style="margin:0 0 14px 0;/.test(html));
    assert.ok(/<li style=/.test(html));
    assert.equal(htmlToText(html), "Merhaba dünya\nLavanta (https://prestij.test/en/products/lavanta) kötü\n\n- bir");
  });

  test("plain text: headings underlined, buttons with their URL, no markup", () => {
    const text = renderBlocksText(
      [
        { type: "heading", text: "Şifrenizi sıfırlayın" },
        { type: "paragraph", text: "Merhaba {name}," },
        { type: "button", label: "Yeni şifre", url: "https://prestij.test/tr/hesap/sifre-sifirla?token=x" },
        { type: "orderLines", lines: [{ name: "Lavanta", detail: "500 ml", quantity: 2, total: "299,80 ₺" }] },
        { type: "totals", rows: [{ label: "Toplam", value: "299,80 ₺", kind: "total" }] },
      ],
      blockCtx("ltr", { name: "Ayşe" }),
    );
    assert.equal(
      text,
      "Şifrenizi sıfırlayın\n====================\n\nMerhaba Ayşe,\n\nYeni şifre:\nhttps://prestij.test/tr/hesap/sifre-sifirla?token=x\n\n- 2 × Lavanta (500 ml): 299,80 ₺\n\nToplam: 299,80 ₺",
    );
  });
});

describe("templates, layout, overrides", () => {
  test("core templates are registered with Turkish labels", () => {
    const keys = listEmailTemplates().map((t) => t.key);
    assert.ok(keys.includes("account_verify") && keys.includes("password_reset"));
    assert.equal(getEmailTemplate("password_reset")?.label, "Şifre sıfırlama");
    assert.equal(getEmailTemplate("nope"), null);
    assert.throws(() => defineEmailTemplate({ key: "Bad-Key" as never, audience: "customer", placeholders: [], sample: () => ({}) as never, build: () => ({ subject: "", blocks: [] }) }));
  });

  for (const locale of ["tr", "en", "ar"] as const) {
    test(`account_verify renders a complete mail in ${locale}`, () => {
      const data = { name: "Ayşe <b>", url: "https://prestij.test/tr/hesap/dogrula?token=abc.def" };
      const mail = renderTemplate(verify(), data, env(locale));
      const m = defaultMessages[locale].email.accountVerify;
      assert.equal(mail.subject, m.subject);
      assert.equal(mail.preheader, m.preheader);
      assert.ok(mail.html.startsWith("<!DOCTYPE html>"));
      // Every attribute value stays intact: after a closing quote comes a space, ">" or "/".
      assert.ok(!/\s[a-z-]+="[^"]*"[^\s>/]/i.test(mail.html), "no attribute broken by a stray double quote");
      assert.ok(!/style="[^"]*"[^\s>/]/.test(mail.html));
      assert.ok(mail.html.includes(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
      assert.ok(mail.html.includes(`text-align:${locale === "ar" ? "right" : "left"}`));
      assert.ok(mail.html.includes("Ayşe &lt;b&gt;"), "name escaped in the intro");
      assert.ok(mail.html.includes(`src="${SITE}/media/marka/prestij-logo.png"`), "logo by absolute URL");
      assert.ok(mail.html.includes('href="https://prestij.test/tr/hesap/dogrula?token=abc.def"'));
      assert.ok(mail.html.includes("PRESTİJ BUKLET KOZMETİK"), "company in the footer");
      assert.ok(mail.html.includes("info@prestij.test"));
      assert.ok(mail.html.includes(m.preheader), "hidden preheader");
      assert.ok(!mail.html.includes("List-Unsubscribe") && !mail.html.includes(defaultMessages[locale].email.layout.unsubscribe), "no unsubscribe in transactional mail");
      assert.ok(mail.text.includes("https://prestij.test/tr/hesap/dogrula?token=abc.def"));
      assert.ok(mail.text.includes("Ayşe <b>"), "the text part is not HTML-escaped");
      assert.ok(!/<(table|tr|td|p|a|div|br|h1|span|img)\b/i.test(mail.text), "no markup in the text part");
      assert.ok(mail.text.includes("PRESTİJ BUKLET KOZMETİK"));
    });
  }

  test("panel overrides: subject and intro per locale, never another locale's text", () => {
    const emails = { templates: { account_verify: { enabled: true, subject: { tr: "Hoş geldin {name}!" }, intro: { tr: "Özel giriş {name} <x>" } } } };
    const tr = renderTemplate(verify(), { name: "Ali", url: "https://prestij.test/x" }, env("tr", emails));
    assert.equal(tr.subject, "Hoş geldin Ali!");
    assert.ok(tr.html.includes("Özel giriş Ali &lt;x&gt;"));
    assert.ok(!tr.html.includes(defaultMessages.tr.email.accountVerify.intro.slice(0, 20)), "the first paragraph was replaced");
    const en = renderTemplate(verify(), { name: "Ali", url: "https://prestij.test/x" }, env("en", emails));
    assert.equal(en.subject, defaultMessages.en.email.accountVerify.subject, "no Turkish fallback for English readers");
    const preview = renderTemplate(verify(), { name: "Ali", url: "https://prestij.test/x" }, env("tr", emails), { overrides: { subject: "Taslak {name}" } });
    assert.equal(preview.subject, "Taslak Ali", "unsaved edits win");
  });

  test("applyIntro inserts an intro after the heading when there is no paragraph", () => {
    const blocks = applyIntro([{ type: "heading", text: "H" }, { type: "divider" }], "Intro");
    assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "divider"]);
  });

  test("templateDefaults returns the raw texts (placeholders unfilled)", () => {
    const d = templateDefaults(verify(), env("tr"));
    assert.equal(d.subject, defaultMessages.tr.email.accountVerify.subject);
    assert.ok(d.intro.includes("{name}"));
  });

  test("marketing mails get the unsubscribe link in the footer and the text part", () => {
    const mail = renderContent(
      { subject: "Kampanya", preheader: "Yeni kokular", blocks: [{ type: "richText", html: "<p>Merhaba</p>" }] },
      { siteName: "PRESTİJ" },
      env("tr", { footerNote: { tr: "Müşteri hizmetleri: hafta içi 09-18" } }),
      { marketing: true, unsubscribeUrl: "https://prestij.test/tr/bulten/ayril?t=abc" },
    );
    assert.ok(mail.html.includes('href="https://prestij.test/tr/bulten/ayril?t=abc"'));
    assert.ok(mail.html.includes("Abonelikten çık"));
    assert.ok(mail.html.includes("e-bültenine abone olduğunuz için"));
    assert.ok(mail.html.includes("Müşteri hizmetleri: hafta içi 09-18"), "footer note");
    assert.ok(mail.text.includes("Abonelikten çık: https://prestij.test/tr/bulten/ayril?t=abc"));
  });

  test("brand colors come from the theme tokens", () => {
    const custom = renderTemplate(verify(), { name: "A", url: "https://prestij.test/x" }, { ...env("tr"), themeTokens: { colors: { brand: "#7A1F3D" } } });
    assert.ok(custom.html.toLowerCase().includes("#7a1f3d"));
  });
});
