# Day 2: cart, checkout, orders

Read `docs/ARCHITECTURE.md` and `docs/NEXT16-NOTES.md` first. This file is the contract that the
day-2 builders share. Where it names a file, function or type, use exactly that name. If something
here turns out to be wrong or impossible, do the closest correct thing and say so in your report.

## Scope

In scope:
- Cart: kept in the DB, identified by an httpOnly cookie.
- Add to cart on the product page, a cart drawer, the `/sepet` page, the header badge.
- Free samples in the cart, coupon codes, a free-shipping progress bar.
- Checkout `/odeme` for guests, covering:
  - address and invoice (individual or corporate);
  - payment method (card / havale-EFT / kapıda ödeme, plus B2B "deferred" when allowed);
  - legal consents.
- Order placement: server-side recompute, one transaction, stock decrement, coupon usage.
- Card payments through a **payment simulator** only. Real iyzico/PayTR come on day 4, behind the
  same interface.
- Order page `/siparis/[orderNumber]` (token link) and order lookup `/siparis`.
- Panel: `/panel/siparisler` list and detail, with status actions (mark paid, prepare, ship, deliver,
  cancel with restock, refund flag, notes).

Out of scope (later days):
- Customer accounts, login and cart merge.
- Real payment providers and installments.
- E-mails. Only a stub hook is added now.
- Subscriptions. The engine keeps a hook for them; the UI does not offer them.
- Campaign badges on product pages.
- Cron jobs. Only the expiry function is written now.

## Money rules (authoritative, implemented once in `src/lib/cart/compute.ts`)

**Basics**
- All amounts are integer kuruş. Prices **include VAT** (KDV); `vatRate` is per variant (default 20).
- Shipping and the kapıda ödeme fee also include VAT at `SHIPPING_VAT_RATE = 20`.

**Unit price**
- Comes from `resolveUnitPrice` (`src/lib/pricing/resolve.ts`) with the customer context: group
  price or group discount, tiers, campaign.
- Business rule: when an **explicit group price** exists, volume tiers are **not** applied.
- When the customer has a group, group-specific tier rows win over retail (`groupId IS NULL`) ones.
- Tier quantity is the line (variant) quantity.

**Totals**
- `subtotal` = Σ unitPrice × qty over paid lines. Samples are 0.
- Order-level discounts are, in this order:
  1. the coupon (percent / fixed / free_shipping);
  2. the havale/EFT discount (`payments.bankTransfer.discountPercent`), applied after the coupon.
- Discounts are allocated to lines in proportion to their totals, using largest-remainder rounding,
  so Σ line discounts equals the discount exactly. For `order_items`:
  - `discount` = the line's share;
  - `lineTotal` = unitPrice × qty − discount.

**Shipping**
- Free when the merchandise total after the coupon (excluding the havale discount) is ≥
  `shipping.freeThreshold` (0 = never free). Otherwise the fee is `shipping.flatFee`.
- A `free_shipping` coupon makes the flat fee 0.
- Heavy surcharge: when `shipping.heavy.enabled` and total weight > `thresholdGrams`, add
  `ceil((weight − threshold) / 1000) × feePerKg`. It applies **even when shipping is free**: the
  customer asked for an extra charge for heavy parcels. Weight = Σ variant `weightGrams` × qty,
  samples included.
- `shippingTotal` = flat part + heavy part. Both are kept separately in the breakdown for display.

**Payment fee and method availability**
- `paymentFee` = `payments.cashOnDelivery.fee` when the method is kapıda ödeme.
- Kapıda ödeme is unavailable when its `maxOrderTotal > 0` and the total before the fee is above it.
- Havale is unavailable when no bank account is configured.
- Card is unavailable when disabled.
- Deferred is available only for an approved company whose `paymentTerms.allowDeferred` is set.

**VAT and invariants**
- `vatTotal` = Σ round(lineTotal × rate / (100 + rate)) + the same for shipping and fee at 20.
- Invariant, checked in tests: `grandTotal = subtotal − discountTotal + shippingTotal + paymentFee`.
  Every amount is ≥ 0.

**Coupons**
- A coupon is valid when all of these hold: `isActive`; inside its `startsAt`/`endsAt` window (a null
  bound means open); `minOrderTotal` is met by the merchandise subtotal; `usedCount < maxUses` (null
  means unlimited); the customer group is allowed.
- `perCustomerLimit` is checked at checkout by e-mail: count non-cancelled orders with that coupon.
- `productIds` / `categoryIds` limit which lines are eligible. Samples are never eligible.
- `fixed` is capped at the eligible total.
- Codes are matched case-insensitively and trimmed.

**Samples**
- Sample products have `type = "sample"`, price 0, and their stock is tracked.
- They are allowed when `samples.cartSampleEnabled` and the paid subtotal ≥ `samples.minOrderTotal`.
- At most `samples.maxPerOrder` distinct sample lines, quantity always 1.
- A cart with only samples cannot check out. Samples become invalid and are dropped when paid lines
  are removed.

**Quantities**
- Clamped to `[minQuantity, maxQuantity ?? 99]`.
- When `trackStock && !allowBackorder`, also clamped to the stock on hand.
- Inactive, draft or archived variants and products become line **issues** and are excluded from
  totals.

Engine signature (pure, no DB, fully unit-tested):
```ts
export function computeCart(input: CartComputeInput): CartTotals
// CartComputeInput: { lines: EngineLine[]; customer: CustomerContext; coupon: CouponData | null;
//   settings: { shipping; payments; samples }; paymentMethod?: PaymentMethod; now: Date }
// CartTotals: { lines: PricedLine[]; issues: CartIssue[]; subtotal; discounts: { coupon; bankTransfer };
//   discountTotal; shipping: { flat; heavy; total; free: boolean; remainingForFree }; paymentFee;
//   vatTotal; grandTotal; totalWeightGrams; itemCount; coupon: { code; status: "applied"|"invalid"; reason? } | null;
//   paymentMethods: { method: PaymentMethod; available: boolean; reason?: string; totals: {...} }[] }
```
`paymentMethods[].totals` holds the full totals as they would be for that method. The checkout UI
shows them when the method changes, so the client never does price math.

## Data and server code (owned by the CORE builder)

**Schema changes** (`npm run db:generate` then `npm run db:migrate`, commit the SQL in `drizzle/`)
- `orders.cartId uuid UNIQUE NULL`: one order per cart, which also makes double-submit safe.
- `pgSequence("order_number_seq", { startWith: 1001 })`. The order number is
  `PR-${YY}${seq padded to 4}`, e.g. `PR-261001`.
- Anything else you truly need. List it in your report.

**Modules**
- `src/lib/cart/cookie.ts`
  - Cookie `prestij_cart` holds the cart UUID: httpOnly, `sameSite=lax`, `secure` in production,
    `path=/`, 30 days.
  - `readCartId()`, `writeCartId(id)`, `clearCartId()`.
- `src/lib/customer/context.ts`
  - `getCustomerContext(): Promise<CustomerContext>`, built from the session user's group and company.
  - The group applies only to an approved company when `b2b.requireApproval`.
  - No session means retail.
- `src/lib/cart/load.ts`: `loadCart(cartId, customer)` reads the lines plus variant, product, media
  and pricing rows for the engine, in a few queries (no N+1).
- `src/lib/cart/view.ts`
  - `buildCartView(totals, raw, locale, messages?)` returns a serializable, localized,
    pre-formatted `CartView`.
  - Each line has: `lineId`, `variantId`, `productSlug`, name, variant labels, image media, accent
    color, unit and line price labels plus raw kuruş, compareAt, quantity limits, isSample, issues.
  - The view also carries: the totals breakdown with labels, samples on offer (`availableSamples`),
    coupon state, `itemCount`, `checkoutAllowed`.
- `src/lib/cart/queries.ts`: `getCartView(locale)`. It is uncached and reads cookies, so call it
  only inside `<Suspense>` or from actions.
- `src/lib/cart/actions.ts` (`"use server"`)
  - Actions: `addToCart({variantId, quantity, locale})`, `setLineQuantity({lineId, quantity, locale})`,
    `removeLine({lineId, locale})`, `addSample({variantId, locale})`, `applyCoupon({code, locale})`,
    `removeCoupon({locale})`, `getCart({locale})`.
  - Each validates its input with zod and returns
    `CartActionResult = { ok: true; view: CartView; notice?: string } | { ok: false; error: string; view?: CartView }`.
    The `error` is a message key or a localized string; say which in your report.
  - A cart row is created lazily on the first add. `expiresAt` = now + 30 days on every change.
- `src/lib/coupons/validate.ts`: `loadCoupon(code)`, `couponEligibility(...)`.
- `src/lib/validation/tr.ts`
  - Validators: `isValidTckn`, `isValidVkn`, `normalizeTrPhone` (accepts 05xx…, 5xx…, +90…, returns
    `+905xxxxxxxxx` or null), `isValidIban` (TR, mod-97).
  - `TR_PROVINCES` (81 provinces with plate codes, Turkish names).
- `src/lib/orders/checkout-schema.ts`: `checkoutSchema` (zod) for contact, shippingAddress,
  invoice, paymentMethod, `consents: { preInformation: true, distanceSales: true }`, customerNote
  (≤ 500 characters), locale.
- `src/lib/orders/place.ts`: `placeOrder(input, { cartId, customer })`
  - Re-validates, reloads the cart, recomputes the totals for the chosen method, and refuses if the
    cart is empty, has blocking issues, or the method is unavailable.
  - Runs ONE `db.transaction`, in which it:
    - decrements stock with guarded UPDATEs (`... WHERE id=$1 AND (NOT track_stock OR allow_backorder OR stock >= $2) RETURNING`; zero rows means `out_of_stock` and a rollback);
    - increments the coupon usage under the same `maxUses` guard;
    - inserts the order (with `cartId`), the items (with snapshots) and the events;
    - inserts a payments row for card;
    - stores the consents (key, legal doc `version`, acceptedAt);
    - stores an order event `legal_snapshot` holding the rendered pre-information and
      distance-sales HTML;
    - deletes the cart items and the cart.
  - A unique violation on `cartId` means a double submit: return the existing order.
  - The initial status depends on the method: card → `pending_payment`; havale →
    `awaiting_transfer`; kapıda ödeme → `processing`; deferred → `processing`.
  - Returns `{ orderNumber, accessToken, redirectTo }`. `redirectTo` is the payment simulator for
    card and the order page otherwise.
  - Afterwards: clear the cookie; `revalidateTag(TAGS.product(slug), "max")` for the touched
    products; call `notifyOrderEvent("placed", orderId)` (the stub in
    `src/lib/notifications/index.ts`, scheduled with `after()`).
- `src/lib/orders/legal-render.ts`
  - `renderPreInformation(...)` and `renderDistanceSales(...)` build the order-specific block:
    seller identity from `general` settings; buyer, delivery and invoice data; the items with
    VAT-included prices; shipping and fees; the total; the payment method; delivery time from
    `shipping.estimatedDays`; the 14-day withdrawal right. The legal document body from the DB
    follows it.
  - Output is sanitized HTML.
  - The checkout UI uses the same functions for the preview modal, so what the customer reads is
    what gets stored.
- `src/lib/orders/status.ts`
  - The state machine: `ORDER_TRANSITIONS`, and
    `transitionOrder(orderId, action, { actor, note?, carrier?, trackingNumber? })`.
  - Actions: `mark_paid`, `start_processing`, `ship`, `deliver`, `cancel`, `mark_refunded`, `add_note`.
  - Cancel restocks the items and releases one coupon use, in a transaction.
  - Every change writes an `order_events` row.
  - `expireStalePendingOrders(minutes = 30)` cancels card orders that stayed `pending_payment` and
    restocks them. The day-4 cron will call it; for now it is only exported.
- `src/lib/orders/read.ts`
  - `getOrderByToken(orderNumber, token)`: constant-time token compare; null on mismatch.
  - `lookupOrder(orderNumber, email)`.
  - Panel reads: `listOrders({ status?, q?, page })` and `getOrderDetail(id)`.
- `src/lib/payments/`
  - `types.ts`: a `PaymentGateway` interface with `initiate(order)` → `{ redirectUrl }` and a
    callback handler.
  - `simulator.ts`.
  - `index.ts`: `initiateCardPayment(orderId)` and `completeCardPayment({ orderId, providerRef, success, amount, raw })`.
    `completeCardPayment` is idempotent, checks the amount against `grandTotal`, and moves the order
    `pending_payment` → `paid`, or records the failure.
  - **The simulator is enabled only when `process.env.PAYMENT_SIMULATOR === "true"`.** Add it to
    `.env.local` (never to production). Otherwise card checkout must fail closed with a clear
    "card payments not configured" state.
- `src/lib/notifications/index.ts`: `notifyOrderEvent(type, orderId)` is a stub that logs only the
  order id and type, never PII.
- Paths: add `siparis: "order"` to `SEGMENTS` and the route `"order"` (with an `orderNumber` param)
  to `href`.
- Tests: `node:test` through `tsx --test`.
  - Unit tests: the engine (every rule above, the invariants, rounding, NaN and tampering), the
    coupons, the TR validators, the state machine.
  - A DB integration test that places orders for each method and covers the races: two concurrent
    orders for the last unit, where exactly one wins; and a double submit.
  - Add the npm scripts `test` and `test:db`.

## UI (owned by the feature builders)

- **CART-UI**
  - `AddToCartButton`: real quantity stepper and add, respecting stock and limits.
  - `CartDrawer`: an end-side sheet, RTL-aware, focus-trapped, Escape closes it, `aria-live` updates.
    It is mounted once in `src/app/[locale]/layout.tsx` and opened through a small client store or
    event.
  - `CartLink` opens the drawer (the link still works without JS).
  - The `/sepet` page (`src/app/[locale]/sepet/page.tsx`, noindex, Suspense) contains: the lines,
    the stepper, remove, the free-shipping progress, the sample picker, the coupon form, the summary
    and the checkout CTA.
  - Use optimistic updates and `publishCartCount`.
  - Messages group: `cart`.
- **CHECKOUT**
  - `/odeme` page: Suspense; redirects to the cart when the cart is empty or not allowed.
    - One page with sections: contact; delivery address (`TR_PROVINCES` select, ilçe text,
      mahalle optional); invoice; payment method (each with its totals); consents (unticked
      checkboxes that open the modal with the rendered texts); a KVKK notice link; the note.
    - A sticky summary on desktop, collapsible on mobile.
    - The order button wording must make the payment obligation clear, e.g. "Siparişi onayla ve öde".
  - The `placeOrderAction` server action wraps `placeOrder` and uses `useActionState` with
    field-level errors.
  - The simulator page `src/app/[locale]/odeme/simulator/page.tsx`: a fake 3-D Secure screen with
    success and failure buttons and **no card fields**. It redirects to the order page.
  - Messages group: `checkout`.
- **ORDER**
  - `/siparis/[orderNumber]?t=token` page: noindex, Suspense, `referrer` set to no-referrer. It shows:
    - a thank-you hero for new orders;
    - a status timeline, the items, the totals and the addresses;
    - for havale, the bank accounts with a copy-IBAN button and the instructions;
    - for card orders in `pending_payment`, a retry-payment button;
    - tracking (carrier link from `shipping.carriers`).
  - `/siparis` is a lookup form (order number + e-mail) that redirects to the token link.
  - Messages group: `order` (new).
- **PANEL-ORDERS**
  - `/panel/siparisler`: list with status tabs, search, pagination.
  - `/panel/siparisler/[id]`: the detail with every field, the timeline, and actions through
    `transitionOrder`. Mark paid needs a confirm step. Ship asks for the carrier select and the
    tracking number. Cancel asks for a reason and restocks.
  - Panel copy is Turkish and hard-coded, as in the existing panel.
  - Roles: staff can do everything except `mark_refunded`, which needs admin.
  - Remove `siparisler` from the placeholder routing.

## Shared rules for all builders
- Build links only with `href` / `localizePath`. Money is shown only through `formatPrice`.
- Never trust the client: variant ids, quantities, prices and the payment method are all
  re-validated on the server.
- i18n: every new storefront string goes into `src/i18n/messages/{tr,en,ar}.ts` under your own
  group, with the same shape in all three. Edit those files only with the Edit tool (never Write a
  whole file), because other builders edit other groups at the same time; re-read and retry if an
  edit fails.
- Design: luxury-minimal, as in ARCHITECTURE.md. Mobile first, RTL (Arabic), dark mode, AA
  contrast, `prefers-reduced-motion`. Use the existing tokens and components (`buttonClass`,
  `.eyebrow`, `container-x`, product scope colors in the cart lines' accents).
- Next 16: `cookies()` only inside Suspense or in actions, never inside `"use cache"`. Product pages
  must stay static (○). Pass the locale explicitly into actions.
- No new npm dependencies unless truly necessary (say why).
- Test data is local only. Card payments are always simulated.
