// Self-check cases for resolve.ts. Run once with:
//   npx tsx -e "import('./src/lib/pricing/resolve.test-cases.ts').then(m => console.log(m.checkCases()))"
import { perLiter, resolveUnitPrice, type PriceInput, type ResolvedPrice } from "./resolve";

export type PriceCase = { name: string; input: PriceInput; expected: ResolvedPrice };

const tiers = [
  { minQuantity: 6, discountPercent: 5 },
  { minQuantity: 12, discountPercent: 10 },
  { minQuantity: 24, discountPercent: 15 },
];

export const cases: PriceCase[] = [
  {
    name: "retail, no rules",
    input: { basePrice: 14990, quantity: 1 },
    expected: { unitPrice: 14990, appliedRules: [] },
  },
  {
    name: "compareAt shown when higher than the price",
    input: { basePrice: 14990, compareAtPrice: 17990, quantity: 1 },
    expected: { unitPrice: 14990, compareAt: 17990, appliedRules: [] },
  },
  {
    name: "explicit group price beats group discount",
    input: { basePrice: 89990, groupPrice: 69990, groupDiscountPercent: 10, quantity: 1 },
    expected: { unitPrice: 69990, compareAt: 89990, appliedRules: [{ kind: "group_price", price: 69990 }] },
  },
  {
    name: "group discount when no explicit price (rounded to kuruş)",
    input: { basePrice: 14990, groupDiscountPercent: 15, quantity: 1 },
    expected: { unitPrice: 12742, compareAt: 14990, appliedRules: [{ kind: "group_discount", percent: 15 }] },
  },
  {
    name: "best tier for quantity (12 → 10 %)",
    input: { basePrice: 10000, tierDiscounts: tiers, quantity: 12 },
    expected: { unitPrice: 9000, compareAt: 10000, appliedRules: [{ kind: "tier", percent: 10, minQuantity: 12 }] },
  },
  {
    name: "below the first tier",
    input: { basePrice: 10000, tierDiscounts: tiers, quantity: 5 },
    expected: { unitPrice: 10000, appliedRules: [] },
  },
  {
    name: "group discount × tier × campaign stack multiplicatively",
    input: { basePrice: 10000, groupDiscountPercent: 10, tierDiscounts: tiers, campaignPercent: 20, quantity: 30 },
    expected: {
      unitPrice: 6120,
      compareAt: 10000,
      appliedRules: [
        { kind: "group_discount", percent: 10 },
        { kind: "tier", percent: 15, minQuantity: 24 },
        { kind: "campaign", percent: 20 },
      ],
    },
  },
  {
    name: "percent above 100 is clamped, never below 0",
    input: { basePrice: 5000, campaignPercent: 150, quantity: 1 },
    expected: { unitPrice: 0, compareAt: 5000, appliedRules: [{ kind: "campaign", percent: 100 }] },
  },
  {
    name: "NaN quantity fails closed (no tier)",
    input: { basePrice: 10000, tierDiscounts: tiers, quantity: Number.NaN },
    expected: { unitPrice: 10000, appliedRules: [] },
  },
  {
    name: "Infinity quantity fails closed (no tier)",
    input: { basePrice: 10000, tierDiscounts: tiers, quantity: Number.POSITIVE_INFINITY },
    expected: { unitPrice: 10000, appliedRules: [] },
  },
  {
    name: "NaN tier minimum is never reached",
    input: { basePrice: 10000, tierDiscounts: [{ minQuantity: Number.NaN, discountPercent: 50 }], quantity: 100 },
    expected: { unitPrice: 10000, appliedRules: [] },
  },
  {
    name: "NaN compareAt is ignored",
    input: { basePrice: 10000, compareAtPrice: Number.NaN, quantity: 1 },
    expected: { unitPrice: 10000, appliedRules: [] },
  },
  {
    name: "group price of 0 is honoured (free for partners)",
    input: { basePrice: 5000, groupPrice: 0, quantity: 1 },
    expected: { unitPrice: 0, compareAt: 5000, appliedRules: [{ kind: "group_price", price: 0 }] },
  },
];

/** Inputs that must throw instead of producing a price. */
export const invalidCases: { name: string; input: PriceInput }[] = [
  { name: "NaN base price", input: { basePrice: Number.NaN, quantity: 1 } },
  { name: "Infinite base price", input: { basePrice: Number.POSITIVE_INFINITY, quantity: 1 } },
  { name: "negative base price", input: { basePrice: -100, quantity: 1 } },
];

export const perLiterCases: { kurus: number; volumeMl: number | null; expected: number | null }[] = [
  { kurus: 89990, volumeMl: 5000, expected: 17998 },
  { kurus: 299990, volumeMl: 20000, expected: 15000 },
  { kurus: 14990, volumeMl: null, expected: null },
];

/** Returns the names of failing cases (empty array = all good). */
export function checkCases(): string[] {
  const failures: string[] = [];
  for (const c of cases) {
    const got = resolveUnitPrice(c.input);
    if (JSON.stringify(got) !== JSON.stringify(c.expected)) failures.push(`${c.name}: got ${JSON.stringify(got)}`);
  }
  for (const c of invalidCases) {
    try {
      resolveUnitPrice(c.input);
      failures.push(`${c.name}: expected a throw`);
    } catch {
      // expected
    }
  }
  for (const c of perLiterCases) {
    const got = perLiter(c.kurus, c.volumeMl);
    if (got !== c.expected) failures.push(`perLiter(${c.kurus}, ${c.volumeMl}): got ${got}`);
  }
  return failures;
}
