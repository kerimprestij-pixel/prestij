// Pure parts of TEAM: the audit log diff and labels (src/components/panel/audit/labels.ts) and the team
// rules (src/lib/panel/team/rules.ts). The DB-level role/safety rules live in tests/db/team.test.ts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  actionInfo,
  auditSubject,
  diffAudit,
  entityHref,
  entityLabel,
  enumValueLabel,
  fieldLabel,
  isIsoDateString,
  isLocalizedValue,
} from "@/components/panel/audit/labels";
import { PanelError } from "@/lib/panel/errors";
import { assertTeamChangeAllowed, generateStaffPassword, STAFF_PASSWORD_PATTERN, TEAM_MESSAGES } from "@/lib/panel/team/rules";

describe("diffAudit", () => {
  test("update: changed fields first, unchanged last, key order ignored", () => {
    const rows = diffAudit(
      { name: { tr: "Eski", en: "Old" }, price: 14990, slug: "a", seo: { b: 1, a: 2 } },
      { name: { en: "Old", tr: "Yeni" }, price: 14990, slug: "b", seo: { a: 2, b: 1 } },
    );
    assert.deepEqual(
      rows.map((r) => [r.key, r.kind]),
      [
        ["name", "changed"],
        ["slug", "changed"],
        ["price", "same"],
        ["seo", "same"],
      ],
    );
    assert.equal(rows[0].label, "Ad");
  });

  test("create has only added rows, delete only removed rows, a field present on one side only", () => {
    assert.deepEqual(diffAudit(null, { role: "staff" }).map((r) => r.kind), ["added"]);
    assert.deepEqual(diffAudit({ role: "staff" }, undefined).map((r) => r.kind), ["removed"]);
    assert.deepEqual(diffAudit({ a: 1 }, { b: 2 }).map((r) => `${r.key}:${r.kind}`), ["a:removed", "b:added"]);
    assert.deepEqual(diffAudit(null, null), []);
  });

  test("non-object snapshots compare as one value", () => {
    assert.deepEqual(diffAudit([1, 2], [1, 3]).map((r) => [r.key, r.kind]), [["value", "changed"]]);
    assert.deepEqual(diffAudit("x", "x").map((r) => r.kind), ["same"]);
  });
});

describe("audit labels", () => {
  test("entities, actions and fields read in Turkish; unknown ones are humanized", () => {
    assert.equal(entityLabel("product"), "Ürün");
    assert.equal(entityLabel("gift_card"), "Gift card");
    assert.deepEqual(actionInfo("reset_password"), { label: "Şifre sıfırladı", tone: "warning" });
    assert.equal(actionInfo("archive").label, "Arşivledi");
    assert.equal(actionInfo("bulk_fix").label, "Bulk fix");
    assert.equal(fieldLabel("signedOutEverywhere"), "Tüm oturumlar kapatıldı");
    assert.equal(fieldLabel("lowStockThreshold"), "Low stock threshold");
  });

  test("enum values: roles and statuses in Turkish, others untouched", () => {
    assert.equal(enumValueLabel("role", "editor"), "Editör");
    assert.equal(enumValueLabel("status", "draft"), "Taslak");
    assert.equal(enumValueLabel("status", "awaiting_transfer"), "Havale bekleniyor");
    assert.equal(enumValueLabel("type", "bundle"), "Set");
    assert.equal(enumValueLabel("name", "editor"), null);
    assert.equal(enumValueLabel("role", 3), null);
  });

  test("entity links: detail pages where they exist, list pages otherwise", () => {
    assert.equal(entityHref("product", "12"), "/panel/urunler/12");
    assert.equal(entityHref("order", "7"), "/panel/siparisler/7");
    assert.equal(entityHref("blog_post", "3"), "/panel/blog/3");
    assert.equal(entityHref("settings", "shipping"), "/panel/ayarlar");
    assert.equal(entityHref("product", "../x"), "/panel/urunler", "non-numeric ids never reach the URL");
    assert.equal(entityHref("user", "abc"), "/panel/ekip");
    assert.equal(entityHref("mystery", "1"), null);
  });

  test("subject, localized and date detection", () => {
    assert.equal(auditSubject(null, { name: { tr: "Lavanta Latte", en: "Lavender Latte" } }), "Lavanta Latte");
    assert.equal(auditSubject({ email: "a@b.c" }, { role: "admin" }), "a@b.c");
    assert.equal(auditSubject({ price: 1 }, null), null);
    assert.equal(isLocalizedValue({ tr: "a", ar: "ب" }), true);
    assert.equal(isLocalizedValue({ tr: "a", other: "x" }), false);
    assert.equal(isIsoDateString("2026-11-09T13:23:16.549Z"), true);
    assert.equal(isIsoDateString("2026-11-09"), false);
  });
});

describe("team rules", () => {
  test("passwords are strong, readable and unique", () => {
    const all = new Set(Array.from({ length: 50 }, generateStaffPassword));
    assert.equal(all.size, 50);
    for (const p of all) assert.match(p, STAFF_PASSWORD_PATTERN);
  });

  test("role change: self refused before anything else; same role refused", () => {
    const target = { id: "a", role: "admin" as const, banned: false };
    assert.throws(() => assertTeamChangeAllowed({ actorId: "a", target, change: { kind: "role", role: "admin" }, otherActiveAdmins: 3 }), new PanelError("forbidden", TEAM_MESSAGES.selfRole));
    assert.throws(() => assertTeamChangeAllowed({ actorId: "x", target: { ...target, role: "staff" }, change: { kind: "role", role: "staff" }, otherActiveAdmins: 3 }), new PanelError("invalid", TEAM_MESSAGES.sameRole));
    assertTeamChangeAllowed({ actorId: "x", target: { ...target, role: "staff" }, change: { kind: "role", role: "admin" }, otherActiveAdmins: 0 });
  });

  test("reactivating an active account or deactivating an inactive one is refused", () => {
    assert.throws(() => assertTeamChangeAllowed({ actorId: "x", target: { id: "s", role: "staff", banned: false }, change: { kind: "active", active: true }, otherActiveAdmins: 1 }), new PanelError("invalid", TEAM_MESSAGES.alreadyActive));
    assert.throws(() => assertTeamChangeAllowed({ actorId: "x", target: { id: "s", role: "staff", banned: true }, change: { kind: "active", active: false }, otherActiveAdmins: 1 }), new PanelError("invalid", TEAM_MESSAGES.alreadyInactive));
  });
});
