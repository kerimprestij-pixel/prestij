// Day-3 panel core: formatting helpers, validation schemas, optimistic locking, audit scrubbing,
// upload validation (sniffed type, size, SVG/GIF, decompression bombs), same-origin check, nav roles.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { navForRole, PANEL_NAV_ITEMS } from "@/components/panel/nav-config";
import { processImage } from "@/lib/media/process";
import type { StorageAdapter } from "@/lib/media/storage";
import { toPayloadFormData } from "@/lib/panel/action-types";
import { auditChanges, scrubAudit } from "@/lib/panel/audit";
import { assertFresh, sameInstant } from "@/lib/panel/concurrency";
import { PanelError } from "@/lib/panel/errors";
import {
  escapeLike,
  foldText,
  formatIstanbul,
  formatTryAmount,
  isValidEan13,
  istanbulDateTimeLocal,
  parseIstanbulDateTimeLocal,
  parseTryAmount,
  slugify,
} from "@/lib/panel/format";
import { checkUploadSize, isSameOriginRequest, sanitizeFileName, sniffImage } from "@/lib/panel/media/upload";
import { MEDIA_UPLOAD } from "@/lib/panel/media/types";
import { hasRole } from "@/lib/panel/roles";
import {
  dateTimeInput,
  folderInput,
  hexColorInput,
  hrefInput,
  isSafeHref,
  kurusInput,
  localizedTextInput,
  mediaIdInput,
  optionalHrefInput,
  optionalLocalizedTextInput,
  positiveKurusInput,
  scheduleInput,
  slugInput,
  updatedAtInput,
} from "@/lib/panel/schemas";

describe("slugify", () => {
  test("Turkish letters, accents, punctuation", () => {
    assert.equal(slugify("Lavanta Latte"), "lavanta-latte");
    assert.equal(slugify("Çiçek Bahçesi Şampuanı"), "cicek-bahcesi-sampuani");
    assert.equal(slugify("İSTANBUL IĞDIR ÖZÜ"), "istanbul-igdir-ozu");
    assert.equal(slugify("ılık  -- su"), "ilik-su");
    assert.equal(slugify("Sabun & Duş Jeli"), "sabun-ve-dus-jeli");
    assert.equal(slugify("Crème brûlée 5 L!"), "creme-brulee-5-l");
    assert.equal(slugify("  --Okyanus--  "), "okyanus");
    assert.equal(slugify("%%%"), "");
    assert.equal(slugify(null), "");
  });

  test("length cap never leaves a trailing hyphen", () => {
    const s = slugify("a".repeat(79) + " b", 80);
    assert.equal(s, "a".repeat(79));
    assert.ok(slugify("kelime ".repeat(30)).length <= 80);
    assert.match(slugify("kelime ".repeat(30)), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("TRY amounts", () => {
  test("parseTryAmount reads Turkish formats into kuruş", () => {
    assert.equal(parseTryAmount("1.499,90"), 149990);
    assert.equal(parseTryAmount("1499,90"), 149990);
    assert.equal(parseTryAmount("149,9"), 14990);
    assert.equal(parseTryAmount("149"), 14900);
    assert.equal(parseTryAmount("0,05"), 5);
    assert.equal(parseTryAmount("1.499"), 149900);
    assert.equal(parseTryAmount("1.234.567,89"), 123456789);
    assert.equal(parseTryAmount("149.90"), 14990);
    assert.equal(parseTryAmount(" 1.499,90 ₺ "), 149990);
    assert.equal(parseTryAmount("1.499,90 TL"), 149990);
    assert.equal(parseTryAmount("1\u00A0499,90"), 149990);
    assert.equal(parseTryAmount(149.9), 14990);
  });

  test("parseTryAmount refuses malformed and negative input", () => {
    for (const bad of ["", "abc", "-5", "1,999", "1.49,90", "12.3456", "1,2,3", "1..0", ",5", "5,", "1e3", null, undefined, Number.NaN, -1]) {
      assert.equal(parseTryAmount(bad as string), null, String(bad));
    }
  });

  test("formatTryAmount", () => {
    assert.equal(formatTryAmount(149990), "1.499,90");
    assert.equal(formatTryAmount(5), "0,05");
    assert.equal(formatTryAmount(0), "0,00");
    assert.equal(formatTryAmount(123456789), "1.234.567,89");
    assert.equal(formatTryAmount(-14990), "-149,90");
    assert.equal(formatTryAmount(14990, { symbol: true }), "149,90\u00A0₺");
    assert.equal(formatTryAmount(null), "");
  });

  test("round trip", () => {
    for (const k of [0, 1, 99, 100, 14990, 149990, 100000000]) assert.equal(parseTryAmount(formatTryAmount(k)), k);
  });
});

describe("isValidEan13", () => {
  test("check digit", () => {
    assert.equal(isValidEan13("4006381333931"), true);
    assert.equal(isValidEan13("8690504000013"), true);
    assert.equal(isValidEan13("4006381333932"), false);
    assert.equal(isValidEan13("400638133393"), false);
    assert.equal(isValidEan13("40063813339311"), false);
    assert.equal(isValidEan13("40063813339a1"), false);
    assert.equal(isValidEan13(4006381333931), false);
    assert.equal(isValidEan13(""), false);
  });
});

describe("Istanbul date-times", () => {
  test("datetime-local ↔ instant (UTC+3)", () => {
    assert.equal(istanbulDateTimeLocal(new Date("2026-11-09T11:30:00Z")), "2026-11-09T14:30");
    assert.equal(istanbulDateTimeLocal("2026-12-31T21:15:00.000Z"), "2027-01-01T00:15");
    assert.equal(istanbulDateTimeLocal(null), "");
    assert.equal(parseIstanbulDateTimeLocal("2026-11-09T14:30")?.toISOString(), "2026-11-09T11:30:00.000Z");
    assert.equal(parseIstanbulDateTimeLocal("2027-01-01T00:15:30")?.toISOString(), "2026-12-31T21:15:30.000Z");
    assert.equal(parseIstanbulDateTimeLocal("2026-02-30T10:00"), null);
    assert.equal(parseIstanbulDateTimeLocal("2026-11-09 14:30"), null);
    assert.equal(parseIstanbulDateTimeLocal(""), null);
    assert.match(formatIstanbul("2026-11-09T11:30:00Z"), /9 Kas 2026 14:30/);
  });
});

describe("search helpers", () => {
  test("foldText and escapeLike", () => {
    assert.equal(foldText("ÖZTÜRK Işık Çağrı İnci"), "ozturk isik cagri inci");
    assert.equal(escapeLike("50%_off\\x"), "50\\%\\_off\\\\x");
  });
});

describe("hrefInput / isSafeHref", () => {
  const good = [
    "/urunler/lavanta",
    "/",
    "/iletisim?konu=teklif",
    "/kurumsal#teklif",
    "#sss",
    "https://www.instagram.com/prestij",
    "HTTPS://prestij.com.tr/x?y=1",
    "mailto:info@prestij.com.tr",
    "mailto:info@prestij.com.tr?subject=Merhaba",
    "tel:+903523533070",
    "tel:0352-353-30-70",
  ];
  const bad = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0000javascript:alert(1)",
    "\u200Bjavascript:alert(1)",
    "javas\u200Bcript:alert(1)",
    "javascript&#58;alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "%6Aavascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "Data:image/svg+xml,<svg onload=alert(1)>",
    "//evil.com",
    "//evil.com/urunler",
    "/\\evil.com",
    "\\\\evil.com",
    "/urunler\\..\\x",
    "/ /evil",
    "/urunler/\u2028x",
    "/urunler\u00A0x",
    "http://example.com",
    "https://",
    "https://localhost",
    "https://user:pass@evil.com",
    "ftp://files.example.com",
    "#",
    "#1abc",
    "mailto:",
    "mailto:javascript:alert(1)",
    "tel:abc",
    "tel:+90 352",
    "urunler/lavanta",
    "",
    "   ",
  ];

  test("accepts site paths, anchors, https, mailto and tel", () => {
    for (const v of good) {
      assert.equal(isSafeHref(v), true, v);
      assert.equal(hrefInput.safeParse(v).success, true, v);
    }
  });

  test("rejects javascript:, data:, //host, backslashes, whitespace, entity and zero-width tricks", () => {
    for (const v of bad) {
      assert.equal(isSafeHref(v), false, JSON.stringify(v));
      assert.equal(hrefInput.safeParse(v).success, false, JSON.stringify(v));
    }
  });

  test("trims surrounding whitespace; optional links accept empty", () => {
    assert.equal(hrefInput.parse("  /urunler  "), "/urunler");
    assert.equal(optionalHrefInput.parse(""), null);
    assert.equal(optionalHrefInput.parse(null), null);
    assert.equal(optionalHrefInput.parse(" #sss "), "#sss");
    assert.equal(optionalHrefInput.safeParse("javascript:alert(1)").success, false);
    assert.equal(isSafeHref(42), false);
  });
});

describe("validation schemas", () => {
  test("slugInput", () => {
    assert.equal(slugInput.parse(" Lavanta-Latte "), "lavanta-latte");
    for (const v of ["", "a b", "çiçek", "a--b", "-a", "a-", "a_b", "x".repeat(81)]) assert.equal(slugInput.safeParse(v).success, false, v);
  });

  test("localizedTextInput trims, requires tr, drops empty translations", () => {
    assert.deepEqual(localizedTextInput.parse({ tr: "  Merhaba ", en: " ", ar: "" }), { tr: "Merhaba" });
    assert.deepEqual(localizedTextInput.parse({ tr: "A", en: "B", ar: "ج" }), { tr: "A", en: "B", ar: "ج" });
    const missing = localizedTextInput.safeParse({ tr: "  ", en: "Hello" });
    assert.equal(missing.success, false);
    assert.deepEqual(missing.error?.issues[0].path, ["tr"]);
    assert.equal(localizedTextInput.safeParse({ tr: "a\u0000b" }).success, false);
    assert.equal(localizedTextInput.safeParse(null).success, false);
  });

  test("optionalLocalizedTextInput", () => {
    assert.equal(optionalLocalizedTextInput.parse(null), null);
    assert.equal(optionalLocalizedTextInput.parse({ tr: " ", en: "" }), null);
    assert.deepEqual(optionalLocalizedTextInput.parse({ tr: "Alt", ar: "بديل" }), { tr: "Alt", ar: "بديل" });
    const noTr = optionalLocalizedTextInput.safeParse({ tr: "", en: "Only English" });
    assert.equal(noTr.success, false);
    assert.deepEqual(noTr.error?.issues[0].path, ["tr"]);
  });

  test("money, color, media id, folder", () => {
    assert.equal(kurusInput.parse(14990), 14990);
    assert.equal(kurusInput.parse("1.499,90"), 149990);
    assert.equal(kurusInput.safeParse(-1).success, false);
    assert.equal(kurusInput.safeParse(1.5).success, false);
    assert.equal(kurusInput.safeParse("abc").success, false);
    assert.equal(positiveKurusInput.safeParse(0).success, false);
    assert.equal(positiveKurusInput.parse(1), 1);
    assert.equal(hexColorInput.parse("#abc"), "#AABBCC");
    assert.equal(hexColorInput.parse(" #03265f "), "#03265F");
    assert.equal(hexColorInput.safeParse("03265F").success, false);
    assert.equal(hexColorInput.safeParse("#12345").success, false);
    assert.equal(mediaIdInput.parse("12"), 12);
    assert.equal(mediaIdInput.parse(null), null);
    assert.equal(mediaIdInput.safeParse(-3).success, false);
    assert.equal(folderInput.parse("Urunler/Lavanta"), "urunler/lavanta");
    for (const v of ["../x", "a//b", "/a", "a/b/c/d", "a b", "ç"]) assert.equal(folderInput.safeParse(v).success, false, v);
  });

  test("dates and schedule", () => {
    assert.equal(dateTimeInput.parse("2026-11-09T14:30")?.toISOString(), "2026-11-09T11:30:00.000Z");
    assert.equal(dateTimeInput.parse("2026-11-09T11:30:00.000Z")?.toISOString(), "2026-11-09T11:30:00.000Z");
    assert.equal(dateTimeInput.parse(""), null);
    assert.equal(dateTimeInput.safeParse("yarın").success, false);
    const ok = scheduleInput.parse({ startsAt: "2026-11-09T10:00", endsAt: "2026-11-10T10:00" });
    assert.ok(ok.startsAt && ok.endsAt && ok.endsAt > ok.startsAt);
    assert.deepEqual(scheduleInput.parse({ startsAt: null, endsAt: "" }), { startsAt: null, endsAt: null });
    const badRange = scheduleInput.safeParse({ startsAt: "2026-11-10T10:00", endsAt: "2026-11-10T10:00" });
    assert.equal(badRange.success, false);
    assert.deepEqual(badRange.error?.issues[0].path, ["endsAt"]);
    assert.equal(updatedAtInput.parse("2026-11-09T11:30:00.123Z").getTime(), Date.parse("2026-11-09T11:30:00.123Z"));
    assert.equal(updatedAtInput.safeParse("").success, false);
    assert.equal(updatedAtInput.safeParse(undefined).success, false);
  });
});

describe("assertFresh", () => {
  const loaded = new Date("2026-11-09T11:30:00.123Z");
  test("same instant in any representation passes", () => {
    assert.doesNotThrow(() => assertFresh(loaded, "2026-11-09T11:30:00.123Z"));
    assert.doesNotThrow(() => assertFresh("2026-11-09T14:30:00.123+03:00", loaded));
    assert.equal(sameInstant(loaded, loaded.getTime()), true);
  });
  test("a changed or missing stamp is a conflict", () => {
    for (const expected of ["2026-11-09T11:30:00.124Z", null, undefined, "", "garbage"]) {
      assert.throws(
        () => assertFresh(loaded, expected),
        (e: unknown) => e instanceof PanelError && e.code === "conflict" && /başka biri tarafından değiştirildi/.test(e.message),
      );
    }
  });
});

describe("audit scrubbing", () => {
  test("drops secret-looking keys at any depth and bounds sizes", () => {
    const out = scrubAudit({
      name: "Ali",
      password: "x",
      nested: { accessToken: "t", apiKey: "k", ok: 1, list: [{ refresh_token: "r", keep: true }] },
      sessionToken: "s",
      passwordHash: "h",
      when: new Date("2026-11-09T00:00:00Z"),
      long: "a".repeat(5000),
      iban: "TR330006100519786457841326",
    }) as Record<string, unknown>;
    assert.equal(out.password, undefined);
    assert.equal(out.sessionToken, undefined);
    assert.equal(out.passwordHash, undefined);
    assert.deepEqual(out.nested, { ok: 1, list: [{ keep: true }] });
    assert.equal(out.when, "2026-11-09T00:00:00.000Z");
    assert.equal((out.long as string).length, 4001);
    assert.equal(out.iban, "TR330006100519786457841326");
  });

  test("auditChanges keeps only changed top-level fields", () => {
    const { before, after } = auditChanges(
      { name: { tr: "A" }, price: 100, updatedAt: new Date(1), same: [1, 2] },
      { name: { tr: "B" }, price: 100, updatedAt: new Date(2), same: [1, 2], added: true },
    );
    assert.deepEqual(before, { name: { tr: "A" } });
    assert.deepEqual(after, { name: { tr: "B" }, added: true });
  });
});

describe("payload helper", () => {
  test("toPayloadFormData serializes the state into one field", () => {
    const form = toPayloadFormData({ a: 1, b: [true] });
    assert.equal(form.get("payload"), '{"a":1,"b":[true]}');
  });
});

/** A PNG that declares width × height but carries almost no data (a decompression-bomb header). */
function bombPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(1024))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("upload validation", () => {
  const base = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#336699" } });

  test("accepts JPEG, PNG, WebP and AVIF by their real content", async () => {
    for (const fmt of ["jpeg", "png", "webp", "avif"] as const) {
      const data = await base().toFormat(fmt).toBuffer();
      const r = await sniffImage(data, `foto.${fmt}`);
      assert.deepEqual(r, { ok: true, format: fmt, width: 64, height: 48 }, fmt);
    }
    // The name lies, the content decides.
    const png = await base().png().toBuffer();
    assert.deepEqual(await sniffImage(png, "virus.exe"), { ok: true, format: "png", width: 64, height: 48 });
  });

  test("refuses SVG, GIF, TIFF and non-images", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><rect width="10" height="10"/></svg>');
    const svgResult = await sniffImage(svg, "logo.png");
    assert.equal(svgResult.ok, false);
    assert.match(!svgResult.ok ? svgResult.error : "", /SVG/);

    const gif = await base().gif().toBuffer();
    const gifResult = await sniffImage(gif, "a.gif");
    assert.equal(gifResult.ok, false);
    assert.match(!gifResult.ok ? gifResult.error : "", /GIF/);

    const tiff = await base().tiff().toBuffer();
    assert.equal((await sniffImage(tiff, "a.tif")).ok, false);
    const text = await sniffImage(Buffer.from("merhaba dünya"), "not.jpg");
    assert.equal(text.ok, false);
    assert.match(!text.ok ? text.error : "", /desteklenmeyen/);
    assert.equal((await sniffImage(Buffer.alloc(0), "empty.png")).ok, false);
  });

  test("size limits", () => {
    assert.equal(checkUploadSize({ name: "a.jpg", size: 1024 }), null);
    assert.equal(checkUploadSize({ name: "a.jpg", size: MEDIA_UPLOAD.maxFileBytes }), null);
    assert.match(checkUploadSize({ name: "büyük.jpg", size: MEDIA_UPLOAD.maxFileBytes + 1 }) ?? "", /çok büyük.*15 MB/);
    assert.match(checkUploadSize({ name: "a.jpg", size: 0 }) ?? "", /boş/);
  });

  test("decompression bomb: refused by the header check and by sharp's limitInputPixels", async () => {
    const bomb = bombPng(30000, 30000); // 900 MP declared, ~1 KB on disk
    assert.ok(bomb.length < 4096);
    const r = await sniffImage(bomb, "bomb.png");
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /megapiksel|desteklenmeyen/);

    await assert.rejects(sharp(bomb, { limitInputPixels: MEDIA_UPLOAD.maxPixels }).resize(10).toBuffer(), /pixel limit/i);

    const written: string[] = [];
    const storage: StorageAdapter = {
      driver: "local",
      put: async (key) => {
        written.push(key);
        return { url: `/x/${key}` };
      },
      delete: async () => undefined,
      publicUrl: (key) => `/x/${key}`,
      stat: async () => null,
    };
    await assert.rejects(processImage(bomb, { folder: "test", stem: "bomb", storage, limitInputPixels: MEDIA_UPLOAD.maxPixels }));
    assert.deepEqual(written, []);
  });

  test("file names are cleaned for display", () => {
    assert.equal(sanitizeFileName("C:\\fakepath\\..\\foto<script>.jpg"), "fotoscript.jpg");
    assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFileName(""), "görsel");
  });
});

describe("same-origin check for route handlers", () => {
  const h = (values: Record<string, string>) => new Headers(values);
  test("origin host must equal the request host", () => {
    assert.equal(isSameOriginRequest(h({ origin: "http://core.localhost:3300", host: "core.localhost:3300" })), true);
    assert.equal(isSameOriginRequest(h({ origin: "https://prestij.com.tr", host: "app.internal", "x-forwarded-host": "prestij.com.tr" })), true);
    assert.equal(isSameOriginRequest(h({ origin: "https://evil.com", host: "prestij.com.tr" })), false);
    assert.equal(isSameOriginRequest(h({ origin: "http://core.localhost:3301", host: "core.localhost:3300" })), false);
    assert.equal(isSameOriginRequest(h({ host: "prestij.com.tr" })), false);
    assert.equal(isSameOriginRequest(h({ origin: "null", host: "prestij.com.tr" })), false);
    assert.equal(
      isSameOriginRequest(h({ origin: "https://prestij.com.tr", host: "prestij.com.tr", "sec-fetch-site": "cross-site" })),
      false,
    );
  });
});

describe("roles and nav", () => {
  test("hasRole ranks staff < editor < admin", () => {
    assert.equal(hasRole("admin", "editor"), true);
    assert.equal(hasRole("editor", "editor"), true);
    assert.equal(hasRole("staff", "editor"), false);
    assert.equal(hasRole(null, "staff"), false);
  });

  test("every nav item has a minRole; items above the role are hidden", () => {
    for (const item of PANEL_NAV_ITEMS) assert.ok(item.minRole, item.href);
    const hrefs = (role: "staff" | "editor" | "admin") => navForRole(role).flatMap((g) => g.items.map((i) => i.href));
    const staff = hrefs("staff");
    assert.ok(staff.includes("/panel/siparisler") && staff.includes("/panel/mesajlar") && staff.includes("/panel/urunler"));
    assert.ok(!staff.includes("/panel/medya") && !staff.includes("/panel/ayarlar"));
    const editor = hrefs("editor");
    assert.ok(editor.includes("/panel/medya") && editor.includes("/panel/metinler") && editor.includes("/panel/kategoriler"));
    assert.ok(!editor.includes("/panel/yasal") && !editor.includes("/panel/ekip") && !editor.includes("/panel/islem-kaydi"));
    const admin = hrefs("admin");
    assert.equal(admin.length, PANEL_NAV_ITEMS.length);
    assert.equal(navForRole(null).length, 0);
  });
});

describe("optional keys inside objects", () => {
  test("missing optional fields are accepted (zod 4 key optionality)", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      name: localizedTextInput,
      alt: optionalLocalizedTextInput,
      link: optionalHrefInput,
      color: (await import("@/lib/panel/schemas")).optionalHexColorInput,
      when: dateTimeInput,
      image: mediaIdInput,
      note: (await import("@/lib/panel/schemas")).textInput({ required: false }),
    });
    assert.deepEqual(schema.parse({ name: { tr: "Ad" } }), { name: { tr: "Ad" }, alt: null, link: null, color: null, when: null, image: null, note: null });
  });
});

describe("textInput output types", () => {
  test("required text is typed string, optional text string | null", async () => {
    const { textInput } = await import("@/lib/panel/schemas");
    const required: string = textInput({ max: 5 }).parse("  ab ");
    const optional: string | null = textInput({ required: false }).parse("");
    assert.equal(required, "ab");
    assert.equal(optional, null);
    assert.equal(textInput({ max: 5 }).safeParse("").success, false);
  });
});
