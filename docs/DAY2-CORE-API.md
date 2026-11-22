# Day 2 core API (cart, checkout, orders, payments)

What the CORE builder ships for the feature builders (CART-UI, CHECKOUT, ORDER, PANEL-ORDERS). Read
`docs/DAY2-CART-CHECKOUT.md` first: this file documents the code that implements it. Everything here
is server code unless marked **pure** (pure = no DB, no Next APIs, safe to import types/functions in
client components).

## 0. File map

| File | What |
|---|---|
| `src/lib/cart/types.ts` (pure) | Engine types, `PAYMENT_METHODS`, `RETAIL_CUSTOMER`, `SHIPPING_VAT_RATE`, `DEFAULT_MAX_QUANTITY` |
| `src/lib/cart/compute.ts` (pure) | `computeCart`, `allocate`, `roundDiv`, `vatIncluded`, `totalsForMethod` |
| `src/lib/cart/view.ts` (pure) | `buildCartView`, `CartView` and friends, `summaryRows`, `paymentMethodLabel`, message helpers. Runtime imports pull in all three dictionaries: client components import its **types** only |
| `src/lib/cart/action-types.ts` (pure) | `CartActionResult`, input types, error/notice codes |
| `src/lib/cart/actions.ts` (`"use server"`) | `addToCart`, `setLineQuantity`, `removeLine`, `addSample`, `applyCoupon`, `removeCoupon`, `getCart` |
| `src/lib/cart/queries.ts` | `getCartView(locale, { paymentMethod? })` for RSC inside `<Suspense>` |
| `src/lib/cart/cookie.ts` | `readCartId`, `writeCartId`, `clearCartId`, `CART_COOKIE` |
| `src/lib/cart/load.ts` | `loadCart`, `findCart`, `loadSampleOffers`, `isUuid`, `LoadedCart` |
| `src/lib/cart/mutations.ts` | DB cart writes by cart id (used by the actions and tests) |
| `src/lib/cart/settings.ts` | `loadCommerceSettings()` (fresh, uncached), `DbExecutor` |
| `src/lib/cart/totals.ts` (pure) | `totalsForLoadedCart(loaded, settings, opts)`, `cartRevision(totals)` |
| `src/lib/rate-limit.ts` (pure) | in-memory sliding-window limiter `blockedFor` / `recordHit`, trusted `clientIpFrom(headers)` |
| `src/lib/request-ip.ts` | `clientIp()` = `clientIpFrom(await headers())` (actions only) |
| `src/lib/customer/context.ts` / `resolve.ts` (pure) | `getCustomerContext()` / `resolveCustomerContext()` |
| `src/lib/coupons/validate.ts` / `eligibility.ts` (pure) | `loadCoupon`, `couponEligibility`, `normalizeCouponCode`, … |
| `src/lib/validation/tr.ts` (pure) | `isValidTckn`, `isValidVkn`, `normalizeTrPhone`, `isValidIban`, `formatIban`, `TR_PROVINCES`, `findProvince` |
| `src/lib/orders/checkout-schema.ts` (pure) | `checkoutSchema`, `validateCheckout`, `checkoutFormDataToInput`, field error codes |
| `src/lib/orders/place.ts` | `placeOrder` |
| `src/lib/orders/errors.ts` (pure) | `localizeCheckoutFailure` |
| `src/lib/orders/legal-render.ts` (pure) | `renderPreInformation`, `renderDistanceSales`, `legalOrderData`, `legalBuyerFromUnknown` |
| `src/lib/orders/legal-docs.ts` | `loadCheckoutLegalDocs(executor?)` (current pre_information + distance_sales rows; `null` when missing → `legal_unavailable`) |
| `src/lib/orders/legal-preview.ts` | `renderCheckoutLegalPreview` |
| `src/lib/orders/actions.ts` (`"use server"`) | `previewLegalTexts`, `retryCardPayment` |
| `src/lib/orders/status-machine.ts` (pure) | `ORDER_TRANSITIONS`, `checkTransition`, `allowedActions`, `buildTimeline` |
| `src/lib/orders/status.ts` | `transitionOrder`, `expireStalePendingOrders`, `restockOrder`, `SYSTEM_ACTOR` (re-exports the machine) |
| `src/lib/orders/read.ts` | `getOrderByToken`, `lookupOrder`, `listOrders`, `getOrderDetail`, `getOrderLegalSnapshot`, `orderSummaryRows` |
| `src/lib/orders/token.ts` | `orderPageHref`, `tokensMatch` |
| `src/lib/orders/number.ts` (pure) | `formatOrderNumber`, `normalizeOrderNumber`, `isOrderNumber` |
| `src/lib/orders/effects.ts` | post-commit `revalidateProducts`, `scheduleNotification` |
| `src/lib/payments/index.ts` | re-exports: gateway, `initiateCardPayment`, `completeCardPayment`, simulator |
| `src/lib/payments/{types,gateway,complete,simulator,simulator-gateway}.ts` | see §8 |
| `src/lib/notifications/index.ts` | `notifyOrderEvent(type, orderId)` stub (logs id + type only) |
| `src/lib/db-errors.ts` | `pgErrorCode`, `pgConstraint`, `isUniqueViolation`, `safeErrorInfo` (what may be logged: class, SQLSTATE, constraint; never `error.message`, which carries the SQL parameters = buyer PII) |

## 1. Schema changes (migration `drizzle/0001_day2_cart_checkout.sql`, applied)

- `orders.cart_id uuid UNIQUE NULL` (no FK: the cart is deleted on success; the unique key makes double
  submits idempotent).
- `orders.coupon_id integer → coupons.id ON DELETE SET NULL` (coupon release on cancel, per-customer counts).
- `orders.breakdown jsonb` (`OrderBreakdown`: coupon/havale discounts, flat/heavy shipping, heavyKg,
  free-shipping reason, weight, itemCount) so the order page shows exactly what was charged.
- `order_number_seq` (starts 1001). Order number = `PR-<YY Europe/Istanbul><seq padded to 4>`, e.g. `PR-261001`.
- `cart_items`: unique `(cart_id, variant_id)` (replaces the plain cart_id index; enables upsert).
- `coupons`: unique index on `upper(code)` (codes match case-insensitively).
- `payments`: unique `(provider, provider_ref) WHERE provider_ref IS NOT NULL` (callback replays).
- TS-only: `PaymentProvider` gains `"simulator"`; `OrderItemSnapshot` gains optional `productSlug,
  productSubtitle, variantLabels, image (MediaLike), categoryId, compareAt, weightGrams, stockTracked,
  couponDiscount, bankTransferDiscount`.

## 2. Money engine (pure)

```ts
computeCart(input: CartComputeInput): CartTotals
type CartComputeInput = {
  lines: EngineLine[]; customer: CustomerContext; coupon: CouponData | null;
  settings: { shipping; payments; samples }; paymentMethod?: PaymentMethod | null;
  campaigns?: EngineCampaign[]; cardGatewayReady?: boolean /* default true */; now: Date;
}
```
`CartTotals` = `MethodTotals` (`subtotal, discounts: { coupon, bankTransfer }, discountTotal,
shipping: { flat, heavy, total, free, freeReason, remainingForFree, threshold, baseFee, heavyKg },
paymentFee, vatTotal, grandTotal`) plus `lines: PricedLine[]`, `issues: CartIssue[]`,
`totalWeightGrams`, `itemCount` (incl. samples), `paidItemCount`, `coupon: CouponState | null`,
`samples: SamplesState`, `paymentMethod`, `paymentMethods: PaymentMethodOption[]` (each with full
`totals`, `available`, `reason?`, `discountPercent`, `limit?`), `checkoutAllowed`.

Rules implemented exactly as the contract's "Money rules", plus these decisions:
- Quantities: NaN/±Infinity/0/negative → `invalid_quantity` (blocking, excluded; never silently 1).
  Fractions are floored (`quantity_adjusted`, reason `fraction`). Clamp order: min → max (`?? 99`) →
  stock. Two lines of one variant share the stock. Sample quantity is always 1.
- Line issues: `unavailable` (draft/archived/inactive variant, business-only for retail, invalid base
  price), `out_of_stock` (stock < min), `invalid_quantity` are **blocking**. `quantity_adjusted`,
  `sample_not_allowed`, `sample_min_order`, `sample_limit` are informational (line ignored or clamped).
  Cart issues: `empty`, `samples_only` (blocking).
- Coupon eligibility: `productIds` OR `categoryIds` match (either list); empty lists = all; samples never.
  Window: `startsAt` inclusive, `endsAt` exclusive. Reasons in order: `inactive, not_started, expired,
  exhausted, group_not_allowed, min_order, no_eligible_items` (`per_customer_limit` only at checkout).
- Campaigns: highest `priority`, then highest percent; window and group checked with `now`.
- Payment availability reasons: `disabled`, `not_configured` (no card gateway), `no_bank_account`,
  `over_limit` (COD: total before fee > maxOrderTotal), `not_eligible` (deferred), `nothing_to_pay`
  (card/havale when grand total is 0).
- Rounding: `roundDiv` = half-up integer division; percent discounts `round(base × p / 100)`; discounts
  allocated to lines with BigInt largest remainder (ties: larger weight, then earlier line).

## 3. Cart

### Cookie
`prestij_cart` = cart UUID, httpOnly, `sameSite=lax`, `secure` in production, `path=/`, 30 days.
The cart id is the cart's only credential: it is never put in the `CartView`.

### `CartView` (`src/lib/cart/view.ts`) — serializable, localized, pre-formatted
```ts
type Money = { amount: number /* kuruş */; label: string /* formatPrice */ };
type CartView = {
  locale; revision /* cartRevision: included "variantId:qty" sorted + "|" + applied coupon code */; isEmpty; itemCount /* publishCartCount(view.itemCount) */; itemCountLabel; paidItemCount;
  lines: CartLineView[];
  availableSamples: SampleOfferView[];     // [] when samples are disabled
  samples: { enabled; allowed; max; used; remaining; hint: string | null; unavailableMessage: string | null };
  coupon: { code; type; status: "applied" | "invalid"; reason?; message; discount: Money } | null;
  totals: { subtotal; couponDiscount; bankTransferDiscount; discountTotal; shippingFlat; shippingHeavy;
            shippingTotal; paymentFee; vatTotal; grandTotal }   // all Money
  shipping: { free; freeReason: "threshold" | "coupon" | null; heavyKg; threshold: Money | null;
              remainingForFree: Money; progress: number | null /* 0..1 */; message: string | null };
  summary: SummaryRow[];                   // totals table for "no method chosen" (cart page)
  issues: IssueView[]; blockingIssues: IssueView[];   // { code, lineId?, blocking, message }
  checkoutAllowed: boolean;
  paymentMethod: PaymentMethod | null;
  paymentMethods: PaymentMethodView[];     // { method, label, available, visible, reason?, reasonMessage,
                                           //   discountPercent, totals (Money fields), summary: SummaryRow[] }
  totalWeightGrams; customer: { isBusiness; showPricesExVat };
};
type CartLineView = {
  lineId; variantId; productId; productSlug; href: string | null; name; subtitle: string | null;
  variantLabels: string[]; variantLabel /* " · " joined */; sku; image: MediaLike | null; imageAlt;
  accentColor: string | null /* productScopeStyle */; isSample; included /* counted in totals */;
  quantity; requestedQuantity; minQuantity; maxQuantity /* stepper max incl. stock */; canIncrease; canDecrease;
  stock: "in" | "low" | "out"; unitPrice: Money; compareAt: Money | null; lineSubtotal: Money;
  discount: Money; lineTotal: Money; priceNote: string | null /* "Kurumsal fiyat", tier, "Ücretsiz numune" */;
  issues: IssueView[];
};
type SampleOfferView = { variantId; productSlug; name; subtitle; accentColor; image; imageAlt; inCart; inStock; canAdd };
type SummaryRow = { key: "subtotal"|"coupon"|"bankTransfer"|"shipping"|"heavy"|"paymentFee"|"total"|"vat";
                    label; amount; amountLabel /* discounts negative, free shipping = "Ücretsiz" */;
                    kind: "default"|"discount"|"free"|"total"|"note" };
```
`PaymentMethodView.visible` is false for methods disabled in settings, for havale while no bank
account is configured (`no_bank_account`: a setup gap, not a shopper message) and for `deferred` when
the buyer is not eligible: hide those; show the others, disabled with `reasonMessage` when unavailable.

Summary rows: with a heavy-parcel surcharge the flat row is labelled `cart.summary.shippingStandard`
("Standart kargo"), never plain "Kargo: Ücretsiz" next to a shipping surcharge; a free_shipping code is
named in the row (`cart.summary.shippingCoupon`). `shipping.message` uses `freeShippingReachedHeavy`
when standard shipping is free but a heavy surcharge applies.

### Server Actions (`src/lib/cart/actions.ts`)
```ts
addToCart({ variantId, quantity? = 1, locale }): Promise<CartActionResult>
setLineQuantity({ lineId, quantity /* 0 removes */, locale })
removeLine({ lineId, locale })
addSample({ variantId, locale })        // sample variant id from view.availableSamples
applyCoupon({ code, locale })           // stored only if valid for the cart right now
removeCoupon({ locale })
getCart({ locale })                     // also prunes invalid samples / persists clamps
type CartActionResult =
  | { ok: true; view: CartView; notice?: string; noticeCode?: CartNoticeCode }
  | { ok: false; error: string; code: CartErrorCode; view?: CartView };
```
- `error` and `notice` are **localized strings** (panel overrides included). Codes map to keys
  `cart.errors.<code>` / `cart.notices.<noticeCode>`.
- `CartErrorCode`: `invalid_input, variant_not_found, unavailable, out_of_stock, line_not_found,
  cart_full (50 lines), sample_not_allowed, sample_needs_product, sample_min_order, sample_limit,
  sample_unavailable, sample_in_cart, coupon_empty, coupon_not_found, coupon_inactive,
  coupon_not_started, coupon_expired, coupon_exhausted, coupon_group_not_allowed, coupon_min_order,
  coupon_no_eligible_items, coupon_per_customer_limit, coupon_no_benefit, rate_limited, generic`.
  `coupon_no_benefit`: the code would not lower the grand total (a small coupon that drops the cart
  below the free-shipping threshold, or free_shipping on a cart that ships free anyway).
  `rate_limited`: 15 failed codes per 15 min per client IP (per instance).
- `CartNoticeCode`: `added, added_limited ({count}), updated, updated_limited ({count}), removed,
  sample_added, coupon_applied, coupon_removed, samples_removed, quantities_adjusted`.
- Side effects of the post-action sync (other lines clamped to stock/limits, samples dropped) are never
  silent: their messages are appended to the action's `notice` (or `error`) and `noticeCode` becomes
  `samples_removed` / `quantities_adjusted`. `syncCart(cartId, totals)` → `{ changed, samplesRemoved,
  adjusted: { lineId, from, to }[] }`; each write is guarded by the quantity it was computed from, so a
  change committed meanwhile (another tab) is never overwritten. Samples that are unavailable or sold
  out are informational (never blocking) and are dropped by the sync.
- Quantities over stock/limits are clamped, not refused (`added_limited`). Failures still return
  `view` whenever possible, so always re-render from it.
- Every action re-reads the session (`getCustomerContext`) and prices on the server.

Client usage:
```tsx
"use client";
import { useTransition } from "react";
import { addToCart } from "@/lib/cart/actions";
import type { CartActionResult } from "@/lib/cart/action-types";
import { publishCartCount } from "@/components/store/cart-count";
const [pending, startTransition] = useTransition();
startTransition(async () => {
  const r: CartActionResult = await addToCart({ variantId, quantity, locale });
  if (r.view) publishCartCount(r.view.itemCount);
  // r.ok ? announce(r.notice) : announce(r.error)   (aria-live)
});
```
Actions are dispatched one at a time by the client; never `Promise.all` them.

### RSC reads
`getCartView(locale, { paymentMethod? })` — calls `await connection()`, reads the cookie and the
session. Only inside `<Suspense>` (sepet/ödeme page bodies). Never in `"use cache"`, layouts' static
shell or product pages (they must stay ○). It does not write (no pruning); `getCart` does.

## 4. Customer context
`getCustomerContext(): Promise<CustomerContext>` (session + fresh user/company/group rows + b2b
settings). Retail when signed out/banned. Group only for an approved company when
`b2b.requireApproval`; B2B disabled → no group. `allowDeferred` = approved company with
`paymentTerms.allowDeferred`. Pure rule: `resolveCustomerContext(sources)`.

## 5. Coupons
`loadCoupon(code, executor?)` (trim + `upper()` match, no validity judgement);
`couponEligibility(coupon, { lines, subtotal, customer, now })`; `normalizeCouponCode(code)`;
`countCouponUsesByEmail(couponId, email, tx)` + `lockCouponForEmail` (checkout only). The panel must
create codes upper-case (unique on `upper(code)`).

## 6. TR validation (pure)
`isValidTckn` (checksum; `11111111111` is NOT valid — leave the field empty for the e-Arşiv default),
`isValidVkn` (GİB check digit), `normalizeTrPhone` → `+905xxxxxxxxx` | null (mobile only),
`isValidIban` (TR, mod-97, spaces ok), `formatIban`, `TR_PROVINCES: { code, name }[]` (81, plate
order), `findProvince(nameOrPlate)` (case/Turkish-letter insensitive).

## 7. Checkout

### Form field names (= error paths)
```
locale
contact.email  contact.phone
shippingAddress.fullName  .city (province name or plate)  .district  .neighbourhood?  .line1  .postalCode?
invoice.type = individual | corporate
invoice.sameAsShipping   (checkbox — must be rendered; unchecked = separate billing address)
invoice.fullName?  invoice.nationalId?                         (individual)
invoice.companyName  invoice.taxOffice  invoice.taxNumber  invoice.eInvoice (checkbox)   (corporate)
invoice.address.fullName/.city/.district/.neighbourhood?/.line1/.postalCode?   (when not same)
paymentMethod = card | bank_transfer | cash_on_delivery | deferred
consents.preInformation  consents.distanceSales   (checkboxes, must be ticked)
customerNote? (≤ 500)
expectedTotal?   (hidden: grand total shown for the chosen method → "price_changed" on mismatch)
expectedTotals.<method>?   (hidden, one per available method; wins over expectedTotal, so a form
                 posted without JavaScript is checked against the method actually chosen)
expectedCart?    (hidden: CartView.revision the buyer saw → "cart_changed" on mismatch, even when the
                 total matches, e.g. another scent's 500 ml swapped in)
```
Text fields refuse C0 control characters (NUL etc.; tab/newline allowed) with the field code `invalid`.
`checkoutFormDataToInput(formData)` builds the nested object (checkboxes → booleans).
`validateCheckout(input)` → `{ ok, data }` | `{ ok: false, fieldErrors: Record<path, code> }`.
Field codes (`checkout.errors.<code>`): `required, invalid, too_short, too_long, invalid_email,
invalid_phone, invalid_province, invalid_postal_code, invalid_tckn, invalid_tax_number, consent_required`.

### `placeOrder(input: unknown, ctx)`
```ts
ctx: { cartId: string | null; customer: CustomerContext; messages?: Messages; settings?; now?; effects?: boolean }
→ { ok: true; orderId; orderNumber; accessToken; status; paymentMethod; redirectTo; existing: boolean }
| { ok: false; code: CheckoutErrorCode; fieldErrors: Record<string, CheckoutFieldErrorCode>;
    reason?: PaymentUnavailableReason; limit?: number /* over_limit: COD max (kuruş) */; variantId?: number; actualTotal?: number }
```
`CheckoutErrorCode` (`checkout.errors.<code>`): `invalid_input, cart_empty, cart_has_issues,
samples_only, method_unavailable (+reason → checkout.paymentUnavailable.<reason>), out_of_stock,
coupon_unavailable, coupon_limit_reached, price_changed, cart_changed, card_not_configured,
legal_unavailable, rate_limited, generic`.
- `legal_unavailable`: a current pre_information or distance_sales document is missing; no order is
  placed (the checkout page also disables the button). Consents always store a real version.
- `rate_limited` ({minutes}): set by `placeOrderAction`, not placeOrder: 10 orders/hour per trusted
  client IP and 5/hour per e-mail and per phone, counted on success (in-memory, per instance).
- A coupon that saved nothing (no discount and shipping not free because of it) is not used: no
  usage count, no per-customer use, not linked to the order.
- One transaction: lock cart row → reload + recompute → coupon checks → guarded stock UPDATEs (variant
  id order) → guarded coupon UPDATE → `nextval` → legal snapshot → order, items, events, consents,
  payment row (card) → delete cart. A double submit returns the first order with `existing: true`.
- Initial status: card `pending_payment`, havale `awaiting_transfer`, COD/deferred `processing`.
- `redirectTo`: card → simulator (`/tr/odeme/simulator?order=…&t=…`); otherwise the order page
  `/tr/siparis/PR-…?t=<token>&new=1`.
- A coupon stored on the cart that is no longer valid → `coupon_unavailable` and the code is removed
  from the cart (never silently dropped). Refresh the view (`getCart`) after any failure.
- Effects (default): clear the cookie, `revalidateTag(TAGS.product(slug), "max")`, `after(notify)`.

Recommended `placeOrderAction` (CHECKOUT owns it):
```ts
"use server";
export async function placeOrderAction(_prev: State, formData: FormData): Promise<State> {
  const input = checkoutFormDataToInput(formData);
  const locale = isLocale(input.locale) ? input.locale : "tr";
  const [cartId, customer, messages] = await Promise.all([readCartId(), getCustomerContext(), getMessages(locale)]);
  const result = await placeOrder(input, { cartId, customer, messages });
  if (result.ok) redirect(result.redirectTo);              // redirect() throws: keep it last
  return { ...localizeCheckoutFailure(result, messages, locale), code: result.code, values: input };
}
```

### Legal texts
- Preview (modal): Server Action `previewLegalTexts({ locale, paymentMethod?, form? })` →
  `{ preInformation, distanceSales }: { key, title, version, html }` (sanitized HTML; missing buyer
  fields show "—", order number shows "Sipariş onaylandığında verilecektir"). `form` = the nested form
  state (e.g. `checkoutFormDataToInput(new FormData(formEl))`).
- Stored: placeOrder renders the same functions with the order number and stores them in the
  `legal_snapshot` event; read with `getOrderLegalSnapshot(orderId)` or `OrderView.legal`.
- Pure: `renderPreInformation(input)`, `renderDistanceSales(input)`, `legalOrderData(totals, loaded,
  locale, method)`, `legalBuyerFromUnknown(value)`.
- Product lines carry the product type ("Okyanus — Duş Jeli (20 L Bidon) × 1"). TCKN / tax numbers
  are masked to the last two digits (the full value stays in `orders.invoice`). For en/ar, when the
  document has its own translated body, the binding Turkish body follows it under
  `checkout.legal.bindingTurkishTitle`. Seller MERSİS no / tax office / tax number / KEP come from
  `settings.general` (`mersisNo`, `taxOffice`, `taxNumber`, `kep`) and are shown when filled.
- The checkout repeats the essentials right above the order button (MSY m.6(2)(a)): items with type,
  every cost row of the chosen method, the withdrawal right with its hygiene exception. Consents are
  cleared when the payment method or the cart revision changes.

## 8. Payments (simulator only today)

Flow:
1. `placeOrder` (card) inserts a `payments` row `initiated` and returns `redirectTo =
   /<locale>/odeme/simulator?order=PR-…&t=<token>` (`href(locale, "paymentSimulator")`).
2. Simulator page (CHECKOUT, `src/app/[locale]/odeme/simulator/page.tsx`, inside Suspense, reads
   `searchParams`): `await getSimulatorSession({ orderNumber, token })` →
   `{ ok: true, orderId, orderNumber, amount, locale, status, orderHref } | { ok: false, code:
   "disabled" | "not_found" | "not_pending" }`. Show amount, success and failure buttons, no card fields.
3. Button Server Action: `const r = await simulateCardPayment({ orderNumber, token, outcome:
   "success" | "failure", locale })` → `{ ok: true, status: "paid" | "failed", redirectTo }` |
   `{ ok: false, code, redirectTo: string | null }`; then `redirect(r.redirectTo ?? orderPageHref…)`.
   Success → order page with `new=1`; failure → order page with `payment=failed` (order stays
   `pending_payment`, retry possible).
4. Order page retry button: Server Action `retryCardPayment({ orderNumber, token })` →
   `{ ok: true, redirectTo }` (simulator again) | `{ ok: false, code }`.

Library functions:
- `getCardGateway(): PaymentGateway | null`, `isCardPaymentReady()`; `PaymentGateway { provider;
  isReady(); initiate(order) → { redirectUrl }; handleCallback(payload) → GatewayCallback | null }`.
- `initiateCardPayment(orderId)` → `{ ok: true, redirectUrl } | { ok: false, code: "not_found" |
  "not_card" | "not_pending" | "not_configured" | "gateway_error" }` (caller must have checked access).
- `completeCardPayment({ orderId, providerRef, success, amount, raw?, provider? }, { effects? })` →
  `{ ok: true, status: "paid" | "failed", alreadyProcessed, orderId, orderNumber } | { ok: false, code:
  "not_configured" | "invalid_input" | "not_found" | "not_card" | "amount_mismatch" | "not_pending" |
  "order_cancelled" }`. Idempotent per `providerRef` (a ref recorded for another order → `invalid_input`);
  amount must equal `grandTotal`; money for a cancelled order is recorded, sets the order's `paidAt`
  (so `mark_refunded` is possible) and adds a `payment_after_cancel` event; a second charge on a paid
  order adds `payment_duplicate`. A failure for an order that is no longer pending is stored as a
  failed payment row only (no event, no notification) and returns `not_pending` / `order_cancelled`.
- `initiateCardPayment` reuses (touches `updatedAt` of) the open initiated row on a retry; expiry counts
  from the latest of `orders.created_at` and that row's `updated_at`.
- **Fail closed:** everything above returns `not_configured`/`disabled` unless
  `process.env.PAYMENT_SIMULATOR === "true"` (set in `.env.local` only). The card method then shows
  `reason: "not_configured"` in the views.

## 9. Order reads (`src/lib/orders/read.ts`)
- `getOrderByToken(orderNumber, token): Promise<OrderView | null>` (constant-time token compare;
  null for unknown number or wrong token). `OrderView` = id, orderNumber, status, paymentMethod,
  paymentProvider, locale, email, phone, ISO dates (createdAt, paidAt, shippedAt, deliveredAt,
  cancelledAt), shippingAddress, invoice, customerNote, `items: OrderItemView[]` (from snapshots:
  name/subtitle/variantTitle/variantLabels as LocalizedText, sku, image MediaLike, accentColor,
  isSample, quantity, unitPrice, compareAt, lineSubtotal, couponDiscount, bankTransferDiscount,
  discount, lineTotal, vatRate), `totals: OrderTotals` (subtotal, couponCode/type/discount,
  bankTransferDiscount/percent, discountTotal, shippingFlat, shippingHeavy, heavyKg, shippingTotal,
  freeShipping(+reason), paymentFee, vatTotal, grandTotal, weight, itemCount), `carrier: { key, name,
  trackingNumber, trackingUrl } | null`, `timeline: TimelineStep[]`, `events` (customer-safe: no notes,
  no actors), `payment: { method, canRetry, bankTransfer: { accounts, instructions } | null }` (bank
  data only while `awaiting_transfer`), `legal`.
- `orderSummaryRows(totals, locale, messages)` → the same `SummaryRow[]` as the cart.
- `lookupOrder(orderNumber, email)` → `{ orderNumber, accessToken, locale } | null`; redirect with
  `orderPageHref(locale, orderNumber, accessToken)`.
- `listOrders({ status?, q?, page?, pageSize? = 20 })` → `{ items: OrderListItem[], total, page,
  pageSize, pageCount, counts: Record<OrderStatus | "all", number> }` (q: order number, e-mail, name,
  company, phone digits; counts honour q, not status). Core helper, used by the DB tests: the panel
  list uses its own `listPanelOrders` (src/app/panel/_lib/orders.ts: grouped tabs, Turkish folding).
- `getOrderDetail(id)` → `OrderDetail` = OrderView + accessToken, customerHref, userId, companyId,
  customerGroupId, couponId, adminNote, consents, all `events` (with `actorName`), `payments`,
  `actionsByRole: { staff, editor, admin }`, `carriers` (ship select), customerName, updatedAt.
- `getOrderLegalSnapshot(orderId)`.

Timeline steps (`key`): card/havale `placed → paid → processing → shipped → delivered`; COD/deferred
`placed → processing → shipped → delivered`; plus terminal `cancelled` / `refunded`. `state`:
`done | current | upcoming | skipped`. Label them under your own `order` messages group.

Event types: `placed, legal_snapshot, payment_initiated, payment_succeeded, payment_failed,
payment_amount_mismatch, payment_after_cancel, payment_duplicate, status_changed (data: action, from,
to, carrier?, trackingNumber?, restocked?, couponReleased?, reason?, actorName?), note`.

## 10. Status machine (`ORDER_TRANSITIONS`)

| Action | From | To | Min role | Needs | Restock + release coupon |
|---|---|---|---|---|---|
| `mark_paid` | pending_payment, awaiting_transfer | paid | staff | — (UI: confirm step) | no |
| `start_processing` | paid | processing | staff | — | no |
| `ship` | paid, processing | shipped | staff | `carrier` (key from shipping.carriers), `trackingNumber` | no |
| `deliver` | shipped | delivered | staff | — | no |
| `cancel` | pending_payment, awaiting_transfer, paid, processing, shipped† | cancelled | staff | `note` (reason) | **yes** |
| `mark_refunded` | paid, processing, shipped, delivered, cancelled* | refunded | **admin** | money received (`paidAt`) | from paid/processing only |
| `add_note` | any | (unchanged) | staff | `note` | no |
| card payment success | pending_payment | paid | system (completeCardPayment) | — | no |
| expiry | pending_payment (card, > 30 min) | cancelled | system | — | yes |

\* every `mark_refunded` needs `paidAt` (money received), else `not_paid`: unpaid kapıda ödeme / deferred
orders are cancelled, never "refunded". `deliver` sets `paidAt` on kapıda ödeme orders (the courier
collected the money); a card capture after cancellation sets it too.
† from `shipped` only while unpaid (`paidAt` null): a parcel refused at the door that came back.

```ts
transitionOrder(orderId, action, { actor, note?, carrier?, trackingNumber?, reason?, expectedStatus? }, { effects? })
  // expectedStatus: the status the actor saw (panel forms post it); a different locked status → invalid_transition
  → { ok: true; orderId; orderNumber; status; previousStatus; restocked }
  | { ok: false; code: "not_found" | "invalid_transition" | "forbidden" | "not_paid" | "note_required"
      | "carrier_required" | "invalid_carrier" | "tracking_required" | "invalid_tracking" }
// Panel: const s = await requireStaff();
//        transitionOrder(id, action, { actor: { userId: s.user.id, role: s.staffRole, name: s.user.name }, ... })
expireStalePendingOrders(minutes = 30, { effects? }) → { expired, orderNumbers }   // for the day-4 cron;
  // status (pending_payment) and staleness are re-checked under the row lock: an order paid meanwhile is skipped
```
Roles: staff and editor may do everything except `mark_refunded` (admin). `transitionOrder` enforces
this itself; use `detail.actionsByRole[s.staffRole]` (or `allowedActions(order, role)`) to show buttons.
Tracking numbers are normalized (spaces removed, upper-case, `[A-Z0-9-]{4,40}`).

## 11. Paths
`SEGMENTS.siparis = "order"`. New routes: `href(l, "order", { orderNumber })` → `/tr/siparis/PR-…`,
`/en/order/PR-…`; `href(l, "orderLookup")` → `/tr/siparis`; `href(l, "paymentSimulator")` →
`/tr/odeme/simulator`, `/en/checkout/simulator`. Token links: `orderPageHref(locale, number, token,
{ new?, paymentFailed? })`.

## 12. i18n keys added (tr/en/ar, same shape)
- `cart.sampleLabel`, `cart.tierDiscount`, `cart.summary.*` (subtotal, couponDiscount {code},
  bankTransferDiscount {percent}, shipping, shippingFree, heavySurcharge {kg}, paymentFee, total, vat),
  `cart.samplesUnavailable.{disabled,no_paid_items,min_order}`, `cart.errors.*`, `cart.issues.*`
  (incl. `quantity_adjusted_stock/max/min`), `cart.notices.*`.
- `checkout.deferred`, `checkout.paymentUnavailable.*`, `checkout.errors.*` (general + field +
  payment codes `order_not_found, payment_not_pending, payment_amount_mismatch, order_cancelled`),
  `checkout.legal.*` (labels of the legal order block).
- Not added: the `order` group (ORDER builder) and UI labels of the cart/checkout pages beyond these.

## 13. Tests
- `npm test` → `tsx --test "tests/unit/**/*.test.ts"` (engine, coupons, TR validators, customer
  context, order numbers, status machine, checkout schema, CartView, legal texts, paths, dictionary parity).
- `npm run test:db` → starts the DB, runs `tests/db/**/*.test.ts` with `--conditions=react-server
  --env-file=.env.local`, one file at a time. It restores rows, stock and sequences and asserts the DB
  is identical afterwards.

## 14. Gotchas
- Never import `src/lib/cart/queries.ts`, `cookie.ts` or `customer/context.ts` into product pages,
  layouts' static parts or `"use cache"` functions. Client components may import the actions modules
  (`@/lib/cart/actions`, `@/lib/orders/actions`) and the pure modules.
- Anything that reads the clock in an RSC (`getCartView`, `renderCheckoutLegalPreview`) runs after
  `connection()`; wrap such components in `<Suspense>`.
- Money: render only `Money.label` / `formatPrice`; labels use no-break spaces (U+00A0).
- `CartView` never contains the cart id or other buyers' data; `OrderView` contains PII → only after a
  token match (order page: `referrer: no-referrer`, noindex).
- `expectedTotal` is optional but recommended (hidden input with the selected method's grand total).
- Samples stay in the cart DB until `getCart`/another action prunes them; the engine ignores invalid
  ones meanwhile (they never reach an order).
- The panel's `ship` carrier list comes from `settings.shipping.carriers` (keys: yurtici, aras, mng).
- Havale is unavailable (and hidden) until a bank account is configured in `payments.bankTransfer.accounts`.
- Rate limits (order lookup, order placement, coupon guessing) are in-memory per instance and keyed on
  `clientIpFrom()`: `TRUSTED_IP_HEADER` (or `AUTH_IP_HEADER`) when set, `x-vercel-forwarded-for` on
  Vercel, else the last X-Forwarded-For entry. Self-hosted behind a proxy: set `TRUSTED_IP_HEADER`.
- Order lookup throttle: 8 failures / 15 min per IP and 5 / hour per (order number, IP); a stranger
  can no longer lock the owner out of their order.
- Never log `error.message` of DB errors (`safeErrorInfo`).
- `next.config.ts` sends security headers on every route (nosniff, frame-ancestors 'none' + X-Frame-
  Options DENY, Referrer-Policy, Permissions-Policy, HSTS in production; no-referrer on token pages)
  and no `X-Powered-By`. The proxy 307-redirects `/odeme` without a cart cookie to the cart.
