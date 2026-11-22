// Go-live, pure parts of the payment and e-mail fixes: draft contracts close the checkout (CF-4), test
// payments are recognised and flagged in the admin new-order mail (CF-11), PayTR's refusal reason is kept
// masked and short (CF-12), MERSİS and KEP beside the company name in campaign mails only (CF-13), and every
// table has row level security in the schema and in migration 0006 (CF-18).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import * as schema from "@/db/schema";
import { defaultMessages } from "@/i18n/messages";
import { renderBlocksHtml } from "@/lib/email/blocks";
import { getEmailTemplate } from "@/lib/email/registry";
import { renderContent, renderTemplate, type EmailRenderEnvironment } from "@/lib/email/render";
import "@/lib/email/templates";
import { sampleOrderEmailData } from "@/lib/email/templates/orders";
import { emailTheme } from "@/lib/email/theme";
import { checkoutLegalReady } from "@/lib/orders/legal-ready";
import { hasTestPayment, isTestPayment, lastErrorOf } from "@/lib/payments/attempts";
import { GatewayRefusedError, PROVIDER_MESSAGE_MAX, providerRefusalOf, safeProviderMessage } from "@/lib/payments/refusal";
import { parseSettings } from "@/lib/settings/types";

const doc = (key: string, version: string) => ({ key, version, title: { tr: key }, body: { tr: "<p>metin</p>" } });

describe("CF-4: draft contracts close the checkout", () => {
  test("both texts must exist and neither may be a 'taslak' version", () => {
    assert.equal(checkoutLegalReady({ preInformation: doc("pre_information", "2026-11 v1"), distanceSales: doc("distance_sales", "v1") }), true);
    assert.equal(checkoutLegalReady({ preInformation: doc("pre_information", "taslak-1"), distanceSales: doc("distance_sales", "v1") }), false);
    assert.equal(checkoutLegalReady({ preInformation: doc("pre_information", "v1"), distanceSales: doc("distance_sales", " Taslak-2") }), false);
    assert.equal(checkoutLegalReady({ preInformation: null, distanceSales: doc("distance_sales", "v1") }), false);
    assert.equal(checkoutLegalReady({ preInformation: doc("pre_information", "v1"), distanceSales: null }), false);
  });

  test("the checkout page and placeOrder both use it; tests opt in to drafts explicitly", () => {
    const page = readFileSync("src/app/[locale]/odeme/page.tsx", "utf8");
    assert.match(page, /if \(!checkoutLegalReady\(legalDocs\)\) \{\s*return <CheckoutClosed /);
    const place = readFileSync("src/lib/orders/place.ts", "utf8");
    assert.match(place, /if \(!ctx\.allowDraftContracts && !checkoutLegalReady\(docs\)\) return fail\("legal_unavailable"\);/);
    assert.doesNotMatch(readFileSync("src/app/[locale]/odeme/actions.ts", "utf8"), /allowDraftContracts/, "the checkout action never allows drafts");
  });
});

describe("CF-11: test payments", () => {
  test("the simulator and provider results in test mode moved no money", () => {
    assert.equal(isTestPayment("simulator", null), true);
    assert.equal(isTestPayment("paytr", { testMode: true }), true);
    assert.equal(isTestPayment("paytr", { testMode: false, providerTestMode: true }), true, "PayTR's own test flag (merchant panel not live)");
    assert.equal(isTestPayment("iyzico", { testMode: false }), false);
    assert.equal(isTestPayment("iyzico", null), false);
    assert.equal(hasTestPayment([{ provider: "paytr", status: "failed", raw: { testMode: true } }]), false, "only paid rows count");
    assert.equal(hasTestPayment([{ provider: "paytr", status: "succeeded", raw: { testMode: true } }]), true);
    assert.equal(hasTestPayment([{ provider: "paytr", status: "refunded", raw: { providerTestMode: true } }]), true);
    assert.equal(hasTestPayment([{ provider: "paytr", status: "succeeded", raw: { testMode: false, providerTestMode: false } }]), false);
  });

  const env = (): EmailRenderEnvironment => ({
    locale: "tr",
    messages: defaultMessages.tr,
    general: parseSettings("general", { email: "info@prestij.test" }),
    emails: parseSettings("emails", {}),
    siteUrl: "https://prestij.test",
    logoUrl: null,
  });

  test("the admin new-order mail flags a test payment first, in red, and never says 'card payment received'", () => {
    const template = getEmailTemplate("admin_new_order");
    assert.ok(template);
    const admin = { panelUrl: "/panel/siparisler/1", companyName: null, isMember: false, customerNote: null, taxId: null };
    const test = renderTemplate(template, sampleOrderEmailData({ admin: { ...admin, testPayment: true } }), env());
    const m = defaultMessages.tr.email.orders.adminNew;
    assert.ok(test.subject.startsWith("TEST ÖDEMESİ – para çekilmedi · "), test.subject);
    assert.ok(test.html.includes(m.testPaymentTitle));
    assert.ok(test.html.includes("#B42318"), "red accent");
    assert.ok(!test.html.includes(m.next.card));
    assert.ok(test.text.includes(m.testPaymentTitle));
    const live = renderTemplate(template, sampleOrderEmailData({ admin }), env());
    assert.ok(!live.subject.includes("TEST"));
    assert.ok(!live.html.includes(m.testPaymentTitle));
    assert.ok(live.html.includes(m.next.card));
  });

  test("a danger notice uses the theme's red", () => {
    const html = renderBlocksHtml([{ type: "notice", text: "x", tone: "danger" }], {
      theme: emailTheme(),
      dir: "ltr",
      locale: "tr",
      vars: {},
      siteUrl: "https://prestij.test",
      buttonFallback: "",
    });
    assert.match(html, /border-left:3px solid #B42318/);
  });
});

describe("CF-12: PayTR refusal reason", () => {
  test("provider text only: one line, masked, at most 200 characters", () => {
    assert.equal(safeProviderMessage("  Geçersiz\n user_ip  "), "Geçersiz user_ip");
    const masked = safeProviderMessage("paytr_token hatalı: test@example.com 4111 1111 1111 1111 / 05321234567 max_installment 12");
    assert.equal(masked, "paytr_token hatalı: [e-posta] [numara] / [numara] max_installment 12");
    const long = safeProviderMessage("x".repeat(500));
    assert.equal(long.length, PROVIDER_MESSAGE_MAX);
    assert.ok(long.endsWith("…"));
    assert.equal(safeProviderMessage(42), "");
  });

  test("only a GatewayRefusedError carries a reason; other errors stay silent", () => {
    const error = new GatewayRefusedError("paytr", "Mağaza canlı modda değil");
    assert.equal(error.name, "GatewayRefusedError");
    assert.deepEqual(providerRefusalOf(error), { provider: "paytr", message: "Mağaza canlı modda değil" });
    assert.equal(providerRefusalOf(new Error("Failed query: insert … params: ayse@example.com")), null);
    assert.equal(providerRefusalOf(new GatewayRefusedError("paytr", "")), null);
  });

  test("payments.raw.lastError.message is read back for the panel", () => {
    assert.equal(lastErrorOf({ lastError: { at: "2026-11-14T00:00:00Z", message: "Geçersiz istek" } }), "Geçersiz istek");
    assert.equal(lastErrorOf({ lastError: "x" }), null);
    assert.equal(lastErrorOf(null), null);
  });
});

describe("CF-13: MERSİS and KEP in campaign e-mail footers", () => {
  const env = (general: Record<string, unknown>): EmailRenderEnvironment => ({
    locale: "tr",
    messages: defaultMessages.tr,
    general: parseSettings("general", general),
    emails: parseSettings("emails", {}),
    siteUrl: "https://prestij.test",
    logoUrl: null,
  });
  const content = { subject: "Kampanya", preheader: "p", blocks: [{ type: "paragraph" as const, text: "Merhaba" }] };
  const marketing = { marketing: true, unsubscribeUrl: "https://prestij.test/tr/bulten/ayril?t=abc" };

  test("beside the legal name in campaign mails (HTML and text), each only when filled", () => {
    const out = renderContent(content, {}, env({ mersisNo: "0123456789000015", kep: "prestij@hs01.kep.tr" }), marketing);
    assert.match(out.html, /PRESTİJ BUKLET KOZMETİK SAN\. TİC\. LTD\. ŞTİ\.<\/strong> · <span dir="auto">MERSİS No: 0123456789000015<\/span> · <span dir="auto">KEP: prestij@hs01\.kep\.tr<\/span>/);
    assert.ok(out.text.includes("PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ. · MERSİS No: 0123456789000015 · KEP: prestij@hs01.kep.tr"));
    const onlyMersis = renderContent(content, {}, env({ mersisNo: "0123456789000015" }), marketing);
    assert.ok(onlyMersis.html.includes("MERSİS No: 0123456789000015"));
    assert.ok(!onlyMersis.html.includes("KEP:"));
    const empty = renderContent(content, {}, env({}), marketing);
    assert.ok(!empty.html.includes("MERSİS") && !empty.text.includes("MERSİS"));
  });

  test("not in transactional mails", () => {
    const out = renderContent(content, {}, env({ mersisNo: "0123456789000015", kep: "prestij@hs01.kep.tr" }), { marketing: false, unsubscribeUrl: null });
    assert.ok(!out.html.includes("MERSİS") && !out.text.includes("KEP:"));
  });
});

describe("CF-18: row level security", () => {
  const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));

  test("every table of the schema enables RLS (no policies: the app connects as the owner)", () => {
    assert.equal(tables.length, 52);
    for (const table of tables) {
      const config = getTableConfig(table);
      assert.equal(config.enableRLS, true, config.name);
      assert.equal(config.policies.length, 0, config.name);
    }
  });

  test("migration 0006 enables it on exactly those tables and does nothing else", () => {
    const sql = readFileSync("drizzle/0006_golive_rls.sql", "utf8");
    const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    const names = statements.map((s) => /^ALTER TABLE "([a-z_]+)" ENABLE ROW LEVEL SECURITY;$/.exec(s)?.[1]);
    assert.ok(names.every(Boolean), statements.join("\n"));
    assert.deepEqual([...names].sort(), tables.map((t) => getTableConfig(t).name).sort());
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
    assert.deepEqual(journal.entries.at(-1), { ...journal.entries.at(-1), idx: 6, tag: "0006_golive_rls" });
  });
});
