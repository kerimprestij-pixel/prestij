// Panel settings validation (src/lib/panel/settings/schemas.ts): every key's output is a value the
// storefront schema accepts; TR IBAN, carrier tracking URL {code}, SEO title template %s, delivery days,
// languages, WhatsApp numbers, seller identity; the action payload keeps error paths at the top level.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  SETTINGS_INPUTS,
  generalSettingsInput,
  localeSettingsInput,
  normalizeWhatsappPhone,
  paymentSettingsInput,
  seoSettingsInput,
  settingsPayloadSchema,
  shippingSettingsInput,
  whatsappSettingsInput,
} from "@/lib/panel/settings/schemas";
import { settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/types";

const KEYS = Object.keys(settingsSchemas) as SettingsKey[];
/** A valid TR IBAN (mod-97 checked) and the same with its last digit changed. */
const IBAN = "TR330006100519786457841326";
const BAD_IBAN = "TR330006100519786457841327";

function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of result.error?.issues ?? []) out[i.path.map(String).join(".")] ??= i.message;
  return out;
}

const defaults = <K extends SettingsKey>(key: K): Settings<K> => settingsSchemas[key].parse({}) as Settings<K>;

describe("every settings key", () => {
  test("the panel schema exists for each storefront key", () => {
    assert.deepEqual(Object.keys(SETTINGS_INPUTS).sort(), [...KEYS].sort());
  });

  for (const key of KEYS) {
    test(`${key}: defaults pass the panel rules and the output parses with the storefront schema`, () => {
      const parsed = SETTINGS_INPUTS[key].safeParse(defaults(key));
      assert.ok(parsed.success, JSON.stringify(issues(parsed)));
      const back = settingsSchemas[key].safeParse(parsed.data);
      assert.ok(back.success);
      assert.deepEqual(settingsSchemas[key].parse(parsed.data), parsed.data);
    });
  }
});

describe("payments: bank accounts", () => {
  const withAccounts = (accounts: { bank: string; holder: string; iban: string }[]) => {
    const value = structuredClone(defaults("payments"));
    value.bankTransfer.accounts = accounts;
    return value;
  };

  test("a valid TR IBAN in any spacing is stored compact and upper-case", () => {
    const parsed = paymentSettingsInput.parse(withAccounts([{ bank: " Ziraat ", holder: "PRESTİJ", iban: "tr33 0006 1005 1978 6457 8413 26" }]));
    assert.deepEqual(parsed.bankTransfer.accounts, [{ bank: "Ziraat", holder: "PRESTİJ", iban: IBAN }]);
  });

  test("wrong check digits, foreign and short IBANs are refused at accounts.<i>.iban", () => {
    for (const iban of ["DE89370400440532013000", "TR3300061005", ""]) {
      const errors = issues(paymentSettingsInput.safeParse(withAccounts([{ bank: "Ziraat", holder: "PRESTİJ", iban }])));
      assert.match(errors["bankTransfer.accounts.0.iban"] ?? "", /TR IBAN/, iban);
    }
    // Right shape, wrong check digits: its own message (a mistyped digit, not a format problem).
    const errors = issues(paymentSettingsInput.safeParse(withAccounts([{ bank: "Ziraat", holder: "PRESTİJ", iban: BAD_IBAN }])));
    assert.match(errors["bankTransfer.accounts.0.iban"] ?? "", /kontrol haneleri/, BAD_IBAN);
  });

  test("the same IBAN twice is refused on the second row; bank and holder are required", () => {
    const errors = issues(
      paymentSettingsInput.safeParse(
        withAccounts([
          { bank: "Ziraat", holder: "PRESTİJ", iban: IBAN },
          { bank: "", holder: "", iban: IBAN.replace(/(.{4})/g, "$1 ") },
        ]),
      ),
    );
    assert.match(errors["bankTransfer.accounts.1.iban"], /zaten var/);
    assert.ok(errors["bankTransfer.accounts.1.bank"]);
    assert.ok(errors["bankTransfer.accounts.1.holder"]);
    assert.equal(errors["bankTransfer.accounts.0.iban"], undefined);
  });

  test("havale discount is limited to 0–50 and the provider to iyzico/paytr", () => {
    const value = withAccounts([]);
    value.bankTransfer.discountPercent = 60;
    (value.card as { provider: string }).provider = "stripe";
    const errors = issues(paymentSettingsInput.safeParse(value));
    assert.ok(errors["bankTransfer.discountPercent"]);
    assert.ok(errors["card.provider"]);
  });
});

describe("shipping", () => {
  const withCarriers = (carriers: { key: string; name: string; trackingUrl: string }[]) => {
    const value = structuredClone(defaults("shipping"));
    value.carriers = carriers;
    return value;
  };

  test("the tracking URL must contain {code} and be https", () => {
    const missing = issues(shippingSettingsInput.safeParse(withCarriers([{ key: "aras", name: "Aras", trackingUrl: "https://kargo.example.com/takip" }])));
    assert.match(missing["carriers.0.trackingUrl"], /\{code\}/);
    const http = issues(shippingSettingsInput.safeParse(withCarriers([{ key: "aras", name: "Aras", trackingUrl: "http://kargo.example.com/?q={code}" }])));
    assert.match(http["carriers.0.trackingUrl"], /https/);
    const script = issues(shippingSettingsInput.safeParse(withCarriers([{ key: "x", name: "X", trackingUrl: "javascript:alert('{code}')" }])));
    assert.ok(script["carriers.0.trackingUrl"]);
    assert.ok(shippingSettingsInput.safeParse(withCarriers([{ key: "aras", name: "Aras", trackingUrl: "https://kargo.example.com/?q={code}" }])).success);
  });

  test("carrier keys are lower-cased, must be slug-like and unique", () => {
    const ok = shippingSettingsInput.parse(withCarriers([{ key: " PTT ", name: "PTT Kargo", trackingUrl: "https://ptt.example.com/{code}" }]));
    assert.equal(ok.carriers[0].key, "ptt");
    const errors = issues(
      shippingSettingsInput.safeParse(
        withCarriers([
          { key: "ptt", name: "PTT", trackingUrl: "https://ptt.example.com/{code}" },
          { key: "ptt", name: "PTT 2", trackingUrl: "https://ptt.example.com/{code}" },
          { key: "kargo firma", name: "Y", trackingUrl: "https://y.example.com/{code}" },
        ]),
      ),
    );
    assert.match(errors["carriers.1.key"], /başka bir firmada/);
    assert.ok(errors["carriers.2.key"]);
  });

  test("delivery days: max ≥ min, at most 30 (Mesafeli Sözleşmeler Yönetmeliği)", () => {
    const value = structuredClone(defaults("shipping"));
    value.estimatedDays = { min: 4, max: 2 };
    assert.ok(issues(shippingSettingsInput.safeParse(value))["estimatedDays.max"]);
    value.estimatedDays = { min: 1, max: 31 };
    assert.ok(issues(shippingSettingsInput.safeParse(value))["estimatedDays.max"]);
  });

  test("money fields accept kuruş and reject negatives", () => {
    const value = structuredClone(defaults("shipping")) as Record<string, unknown>;
    value.flatFee = -1;
    assert.ok(issues(shippingSettingsInput.safeParse(value)).flatFee);
  });
});

describe("seo title template", () => {
  const withTemplate = (titleTemplate: string) => ({ ...defaults("seo"), titleTemplate });
  test("must contain %s exactly once", () => {
    assert.ok(seoSettingsInput.safeParse(withTemplate("%s | PRESTİJ")).success);
    assert.match(issues(seoSettingsInput.safeParse(withTemplate("PRESTİJ"))).titleTemplate, /%s/);
    assert.match(issues(seoSettingsInput.safeParse(withTemplate("%s | %s"))).titleTemplate, /%s/);
    assert.ok(issues(seoSettingsInput.safeParse(withTemplate("   "))).titleTemplate);
  });
  test("default title and description need Turkish text", () => {
    const errors = issues(seoSettingsInput.safeParse({ ...defaults("seo"), defaultTitle: { tr: "", en: "Title" } }));
    assert.ok(errors["defaultTitle.tr"]);
  });
});

describe("general (seller identity)", () => {
  const base = () => structuredClone(defaults("general"));
  test("VKN, MERSİS, e-mail, KEP and map URL are checked only when filled", () => {
    assert.ok(generalSettingsInput.safeParse(base()).success);
    const errors = issues(
      generalSettingsInput.safeParse({ ...base(), taxNumber: "1234567891", mersisNo: "123", email: "info@", kep: "kep", mapUrl: "http://maps.example.com" }),
    );
    assert.ok(errors.taxNumber);
    assert.ok(errors.mersisNo);
    assert.ok(errors.email);
    assert.ok(errors.kep);
    assert.match(errors.mapUrl, /https/);
  });
  test("social profiles accept a handle or an https URL; empty ones are dropped", () => {
    const parsed = generalSettingsInput.parse({ ...base(), social: { instagram: "@prestij", youtube: "https://youtube.com/@prestij", tiktok: "  " } });
    assert.deepEqual(parsed.social, { instagram: "@prestij", youtube: "https://youtube.com/@prestij" });
    assert.ok(issues(generalSettingsInput.safeParse({ ...base(), social: { facebook: "javascript:alert(1)" } }))["social.facebook"]);
  });
  test("empty optional texts are stored as empty strings, mapUrl is dropped", () => {
    const parsed = generalSettingsInput.parse({ ...base(), email: null, mapUrl: "" });
    assert.equal(parsed.email, "");
    assert.equal("mapUrl" in parsed && parsed.mapUrl !== undefined, false);
  });
});

describe("languages and WhatsApp", () => {
  test("Turkish cannot be switched off; the list is ordered and de-duplicated", () => {
    assert.ok(issues(localeSettingsInput.safeParse({ enabled: ["en"] })).enabled);
    assert.deepEqual(localeSettingsInput.parse({ enabled: ["ar", "tr", "ar"] }).enabled, ["tr", "ar"]);
  });
  test("WhatsApp numbers are normalized to international digits", () => {
    assert.equal(normalizeWhatsappPhone("0532 123 45 67"), "905321234567");
    assert.equal(normalizeWhatsappPhone("+90 (352) 353 30 70"), "903523533070");
    assert.equal(normalizeWhatsappPhone("0090 532 123 45 67"), "905321234567");
    assert.equal(normalizeWhatsappPhone("532 123 45 67"), "905321234567");
    const enabledEmpty = issues(whatsappSettingsInput.safeParse({ ...defaults("whatsapp"), phone: "" }));
    assert.ok(enabledEmpty.phone);
    assert.ok(whatsappSettingsInput.safeParse({ ...defaults("whatsapp"), enabled: false, phone: "" }).success);
  });
});

describe("action payload", () => {
  test("fields sit at the top level next to updatedAt; error paths match the form", async () => {
    const schema = settingsPayloadSchema("shipping");
    const value = structuredClone(defaults("shipping"));
    value.carriers[1].trackingUrl = "https://kargo.example.com/takip";
    const bad = await schema.safeParseAsync({ ...value, updatedAt: "2026-11-06T15:29:14.891Z" });
    assert.equal(bad.success, false);
    assert.ok(issues(bad)["carriers.1.trackingUrl"]);

    const ok = await schema.safeParseAsync({ ...defaults("shipping"), updatedAt: "2026-11-06T15:29:14.891Z" });
    assert.ok(ok.success);
    assert.ok(ok.data.updatedAt instanceof Date);
    assert.equal("updatedAt" in ok.data.value, false);
  });

  test("updatedAt may be null (no row yet) but not missing", async () => {
    const schema = settingsPayloadSchema("locales");
    assert.ok((await schema.safeParseAsync({ enabled: ["tr"], updatedAt: null })).success);
    assert.ok(issues(await schema.safeParseAsync({ enabled: ["tr"] })).updatedAt);
  });
});
