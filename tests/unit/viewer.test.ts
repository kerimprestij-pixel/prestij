// Viewer state helpers (pure): the signed-out default and the greeting name.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SIGNED_OUT_VIEWER, firstNameOf } from "@/lib/customer/viewer";

describe("viewer", () => {
  test("the signed-out default is complete and frozen", () => {
    assert.deepEqual(SIGNED_OUT_VIEWER, { signedIn: false, firstName: null, isBusiness: false, companyStatus: null, favoriteProductIds: [] });
    assert.ok(Object.isFrozen(SIGNED_OUT_VIEWER));
  });

  test("firstNameOf takes the first given name", () => {
    assert.equal(firstNameOf("Ayşe Nur Yılmaz"), "Ayşe");
    assert.equal(firstNameOf("  Zeynep  "), "Zeynep");
    assert.equal(firstNameOf("محمد علي"), "محمد");
    assert.equal(firstNameOf(""), null);
    assert.equal(firstNameOf(null), null);
    assert.equal(firstNameOf("x".repeat(100))?.length, 60);
  });
});
