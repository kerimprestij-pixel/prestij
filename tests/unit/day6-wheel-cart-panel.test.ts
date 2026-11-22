// Day 6 WHEEL-CART, panel side: panel codes may not look like gift wheel prizes ("CARK-…" is reserved),
// winners' e-mails are masked for editors, and a prize's status reads used → deactivated → expired → active.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { maskEmail, WHEEL_BOUND_VIA, WHEEL_COUPON_STATUS } from "@/components/panel/marketing/labels";
import { WHEEL_BOUND_VIA as BOUND_VIA_VALUES } from "@/db/schema/wheel";
import { couponCodeInput, couponCreateSchema, WHEEL_CODE_RESERVED_MESSAGE } from "@/lib/panel/marketing/schemas";
import { wheelCouponStatus } from "@/lib/panel/marketing/status";
import { WHEEL_CODE_PREFIX } from "@/lib/wheel/types";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");

describe("panel coupon codes", () => {
  test("“CARK-” is reserved for gift wheel prizes (also after the usual normalisation)", () => {
    for (const code of ["CARK-ABC234", "cark-abc234", " CARK-1 ", "CARK-SUMMER"]) {
      const r = couponCodeInput.safeParse(code);
      assert.equal(r.success, false, code);
      assert.equal(!r.success && r.error.issues[0]?.message, WHEEL_CODE_RESERVED_MESSAGE, code);
    }
    assert.match(WHEEL_CODE_RESERVED_MESSAGE, new RegExp(WHEEL_CODE_PREFIX));
  });

  test("other codes stay valid, including ones that merely contain CARK", () => {
    for (const [code, out] of [
      ["BAHAR15", "BAHAR15"],
      ["cark15", "CARK15"],
      ["HEDIYE-CARK", "HEDIYE-CARK"],
      ["CARK_5", "CARK_5"],
    ] as const) {
      const r = couponCodeInput.safeParse(code);
      assert.equal(r.success && r.data, out, code);
    }
  });

  test("the create schema reports it on the code field", () => {
    const r = couponCreateSchema.safeParse({
      code: "CARK-AAAAAA",
      description: "",
      type: "percent",
      value: 10,
      minOrderTotal: 0,
      maxUses: null,
      perCustomerLimit: 1,
      productIds: [],
      categoryIds: [],
      customerGroupIds: [],
      schedule: { startsAt: null, endsAt: null },
      isActive: true,
    });
    assert.equal(r.success, false);
    assert.deepEqual(!r.success && r.error.issues.map((i) => i.path.join(".")), ["code"]);
  });
});

describe("wheel coupon status", () => {
  const base = { isActive: true, endsAt: new Date(NOW + 3600_000), maxUses: 1, usedCount: 0 };
  test("active until its end, then expired", () => {
    assert.equal(wheelCouponStatus(base, NOW), "active");
    assert.equal(wheelCouponStatus({ ...base, endsAt: new Date(NOW) }, NOW), "expired", "ends_at is exclusive");
    assert.equal(wheelCouponStatus({ ...base, endsAt: new Date(NOW - 1).toISOString() }, NOW), "expired");
  });
  test("used wins over expired and deactivated; deactivated wins over expired", () => {
    assert.equal(wheelCouponStatus({ ...base, usedCount: 1, endsAt: new Date(NOW - 1) }, NOW), "used");
    assert.equal(wheelCouponStatus({ ...base, usedCount: 1, isActive: false }, NOW), "used");
    assert.equal(wheelCouponStatus({ ...base, isActive: false, endsAt: new Date(NOW - 1) }, NOW), "inactive");
  });
  test("every status and every bound-via value has a Turkish label", () => {
    for (const s of ["active", "used", "expired", "inactive"] as const) assert.ok(WHEEL_COUPON_STATUS[s].label);
    for (const v of BOUND_VIA_VALUES) assert.ok(WHEEL_BOUND_VIA[v], v);
  });
});

describe("maskEmail", () => {
  test("first character and the full domain", () => {
    assert.equal(maskEmail("ayse.yilmaz@example.com"), "a•••@example.com");
    assert.equal(maskEmail("x@test.local"), "x•••@test.local");
    assert.equal(maskEmail("a@b@c.com"), "a•••@c.com", "the last @ separates the domain");
  });
  test("never echoes something that is not an address", () => {
    assert.equal(maskEmail("no-at-sign"), "•••");
    assert.equal(maskEmail("@example.com"), "•••");
    assert.equal(maskEmail(""), "•••");
  });
});
