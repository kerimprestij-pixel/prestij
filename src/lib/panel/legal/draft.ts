// Which legal version labels mark a draft. Tiny and pure on purpose: the checkout guard
// (src/lib/orders/legal-ready.ts), the panel launch checklist (src/lib/panel/seo/launch.ts, also bundled into
// a client form) and the legal editor all import it. Unit-tested in tests/unit/golive-final.test.ts and
// tests/unit/day6-content-launch.test.ts.

/**
 * True when a version label still marks a draft: the seeded "taslak-1" and every label starting with
 * "taslak" (case-insensitive). While the current pre-information form or distance sales agreement has such
 * a label the checkout stays closed; the lawyer-approved text is published under another label ("2026-11 v1").
 */
export function isDraftLegalVersion(version: string): boolean {
  return version.trim().toLocaleLowerCase("tr-TR").startsWith("taslak");
}
