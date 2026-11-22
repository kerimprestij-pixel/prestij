// Go-live CF-4: whether the checkout may take orders as far as the contract texts are concerned. Pure
// (unit-tested in tests/unit/golive-payments-email.test.ts); the checkout page, placeOrder and subscription
// renewals use it, and the panel shows the same rule (launch checklist, payment settings).
import { isDraftLegalVersion } from "@/lib/panel/legal/draft";
import type { LegalDocumentInput } from "./legal-render";

/**
 * True only when both contract texts (pre-information form, distance sales agreement) exist and neither
 * current version is still a draft ("taslak…", the label until the lawyer approves). Otherwise the checkout
 * page shows a notice instead of the form and placeOrder refuses (legal_unavailable): an order never stores
 * a draft contract, even if a payment method is switched on by mistake.
 */
export function checkoutLegalReady(docs: { preInformation: LegalDocumentInput; distanceSales: LegalDocumentInput }): boolean {
  const { preInformation, distanceSales } = docs;
  return Boolean(preInformation && distanceSales && !isDraftLegalVersion(preInformation.version) && !isDraftLegalVersion(distanceSales.version));
}
