// Public submissions of the quote and sample forms. No Next APIs: the Server Actions
// (src/lib/requests/actions.ts) pass the trusted client IP and the signed-in user id, so DB tests call
// these directly. Flow: honeypot (pretends success, stores nothing) → validation → durable rate limits →
// one transaction (site-wide cap, ids re-read from the database, insert, e-mails). Never logs personal
// data: only ids and error classes.
import "server-only";
import { count, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BusinessSector } from "@/db/schema/commerce";
import { localize } from "@/i18n/localize";
import { safeErrorInfo } from "@/lib/db-errors";
import type { Tx } from "@/lib/panel/tx";
import { consumeLimits } from "@/lib/rate-limit-store";
import { parseSettings } from "@/lib/settings/types";
import { loadRequestCatalog } from "./catalog";
import { enqueueQuoteReceived, enqueueSampleReceived } from "./emails";
import {
  mergeProductLines,
  parseQuoteForm,
  parseSampleForm,
  readQuoteForm,
  readSampleForm,
  type FieldErrors,
  type RawQuoteForm,
  type RawSampleForm,
} from "./schema";
import { REQUEST_SITE_RULE, requestLimitKeys, type RequestKind } from "./throttle";
import { isBusinessSector, quoteRef, sampleRef, type RequestFormState, type RequestPrefill } from "./types";

type Source = FormData | Record<string, unknown>;

export type SubmitContext = {
  ip: string;
  /** Signed-in customer (links the request to the account and its company). */
  userId?: string | null;
  prev?: RequestFormState | null;
  now?: number;
  /** Tests only: run inside this transaction / with a lower site-wide cap. */
  executor?: Tx;
  siteLimit?: number;
};

export type SubmitResult = { state: RequestFormState; id: number | null };

/** Thrown inside the transaction to roll back and answer with field errors or a state. */
class Refusal extends Error {
  constructor(readonly state: Omit<RequestFormState, "attempt" | "values">) {
    super("refused");
  }
}

function echo(raw: RawQuoteForm | RawSampleForm): Record<string, string | string[]> {
  const { website: _website, ...rest } = raw;
  void _website;
  return rest;
}

async function siteCapReached(tx: Tx, kind: RequestKind, limit: number): Promise<boolean> {
  const table = kind === "quote" ? schema.quoteRequests : schema.sampleRequests;
  const [row] = await tx
    .select({ n: count() })
    .from(table)
    .where(gt(table.createdAt, sql`now() - make_interval(mins => ${REQUEST_SITE_RULE.windowMinutes})`));
  return (row?.n ?? 0) >= limit;
}

async function userCompanyId(tx: Tx, userId: string | null | undefined): Promise<number | null> {
  if (!userId) return null;
  const [row] = await tx.select({ companyId: schema.user.companyId }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  return row?.companyId ?? null;
}

async function run(
  kind: RequestKind,
  raw: RawQuoteForm | RawSampleForm,
  email: string,
  ctx: SubmitContext,
  attempt: number,
  store: (tx: Tx) => Promise<{ id: number }>,
): Promise<SubmitResult> {
  const decision = await consumeLimits(requestLimitKeys(kind, { ip: ctx.ip, email }), { now: ctx.now });
  if (!decision.allowed) {
    return { state: { status: "error", error: "too_many", retryMinutes: decision.retryAfterMinutes, values: echo(raw), attempt }, id: null };
  }
  try {
    const { id } = await (ctx.executor ?? db).transaction(async (tx) => {
      if (await siteCapReached(tx, kind, ctx.siteLimit ?? REQUEST_SITE_RULE.limit)) {
        console.warn(`[requests] site-wide ${kind} limit reached; new requests are refused for a few minutes`);
        throw new Refusal({ status: "error", error: "too_many", retryMinutes: REQUEST_SITE_RULE.windowMinutes });
      }
      return store(tx);
    });
    console.info(`[requests] ${kind} request stored id=${id}`);
    return { state: { status: "success", reference: kind === "quote" ? quoteRef(id) : sampleRef(id), attempt }, id };
  } catch (error) {
    if (error instanceof Refusal) return { state: { ...error.state, values: echo(raw), attempt }, id: null };
    console.error(`[requests] storing the ${kind} request failed`, safeErrorInfo(error));
    return { state: { status: "error", error: "server", values: echo(raw), attempt }, id: null };
  }
}

// ---------------------------------------------------------------------------------------------
// Quote

export async function submitQuoteRequest(source: Source, ctx: SubmitContext): Promise<SubmitResult> {
  const attempt = (ctx.prev?.attempt ?? 0) + 1;
  const raw = readQuoteForm(source);

  if (raw.website.trim() !== "") {
    await consumeLimits(requestLimitKeys("quote", { ip: ctx.ip, email: null }), { now: ctx.now });
    return { state: { status: "success", reference: null, attempt }, id: null };
  }
  const parsed = parseQuoteForm(raw);
  if (!parsed.success) {
    return { state: { status: "error", error: "invalid", fieldErrors: parsed.fieldErrors, values: echo(raw), attempt }, id: null };
  }
  const input = parsed.data;

  return run("quote", raw, input.email, ctx, attempt, async (tx) => {
    // Re-read every chosen variant: only active, public products may be quoted.
    const catalog = await loadRequestCatalog(tx);
    const variants = new Map(catalog.flatMap((p) => p.variants.map((v) => [v.id, { product: p, variant: v }] as const)));
    const errors: FieldErrors = {};
    for (const line of input.lines) {
      if (line.variantId !== null && !variants.has(line.variantId)) errors[`lines.${line.row}.variantId`] = "invalid_product";
    }
    if (Object.keys(errors).length) throw new Refusal({ status: "error", error: "invalid", fieldErrors: errors });

    const items = mergeProductLines(input.lines).map((line) => {
      if (line.variantId === null) return { label: line.label, quantity: line.quantity };
      const hit = variants.get(line.variantId)!;
      const size = hit.variant.labels.map((l) => localize(l, "tr")).filter(Boolean).join(" · ");
      return { variantId: line.variantId, label: [localize(hit.product.name, "tr"), size].filter(Boolean).join(" · "), quantity: line.quantity };
    });

    const [row] = await tx
      .insert(schema.quoteRequests)
      .values({
        companyId: await userCompanyId(tx, ctx.userId),
        userId: ctx.userId ?? null,
        companyName: input.companyName,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        sector: input.sector,
        items,
        message: input.message,
        status: "new",
        consentAt: new Date(ctx.now ?? Date.now()),
        locale: input.locale,
      })
      .returning();
    await enqueueQuoteReceived(tx, row);
    return { id: row.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Sample

async function sampleFormEnabled(executor: Tx): Promise<boolean> {
  const [row] = await executor.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, "samples")).limit(1);
  return parseSettings("samples", row?.value).requestFormEnabled;
}

export async function submitSampleRequest(source: Source, ctx: SubmitContext): Promise<SubmitResult> {
  const attempt = (ctx.prev?.attempt ?? 0) + 1;
  const raw = readSampleForm(source);

  if (!(await sampleFormEnabled(ctx.executor ?? db))) {
    return { state: { status: "error", error: "closed", attempt }, id: null };
  }
  if (raw.website.trim() !== "") {
    await consumeLimits(requestLimitKeys("sample", { ip: ctx.ip, email: null }), { now: ctx.now });
    return { state: { status: "success", reference: null, attempt }, id: null };
  }
  const parsed = parseSampleForm(raw);
  if (!parsed.success) {
    return { state: { status: "error", error: "invalid", fieldErrors: parsed.fieldErrors, values: echo(raw), attempt }, id: null };
  }
  const input = parsed.data;

  return run("sample", raw, input.email, ctx, attempt, async (tx) => {
    // Only active scents (standard products) can be sampled.
    const offered = new Set((await loadRequestCatalog(tx)).filter((p) => p.type === "standard").map((p) => p.id));
    if (input.productIds.some((id) => !offered.has(id))) {
      throw new Refusal({ status: "error", error: "invalid", fieldErrors: { productIds: "invalid_product" } });
    }
    const [row] = await tx
      .insert(schema.sampleRequests)
      .values({
        companyName: input.companyName,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        sector: input.sector,
        address: {
          fullName: input.contactName,
          phone: input.phone,
          city: input.address.city,
          district: input.address.district,
          line1: input.address.line1,
          country: "TR",
        },
        productIds: input.productIds,
        estimatedMonthlyLiters: input.estimatedMonthlyLiters,
        message: input.message,
        status: "new",
        consentAt: new Date(ctx.now ?? Date.now()),
        locale: input.locale,
      })
      .returning();
    await enqueueSampleReceived(tx, row);
    return { id: row.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Prefill for signed-in customers

/** The caller's own contact data (and company, when linked) for the forms. */
export async function requestPrefillFor(userId: string, executor: Tx = db): Promise<RequestPrefill | null> {
  const [user] = await executor
    .select({ name: schema.user.name, email: schema.user.email, phone: schema.user.phone, companyId: schema.user.companyId, banned: schema.user.banned })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (!user || user.banned) return null;
  let company: { name: string; sector: BusinessSector; phone: string | null } | null = null;
  if (user.companyId != null) {
    const [row] = await executor
      .select({ name: schema.companies.name, sector: schema.companies.sector, phone: schema.companies.phone })
      .from(schema.companies)
      .where(eq(schema.companies.id, user.companyId))
      .limit(1);
    company = row ?? null;
  }
  return {
    contactName: user.name ?? "",
    email: user.email,
    phone: user.phone ?? company?.phone ?? "",
    companyName: company?.name ?? "",
    sector: company && isBusinessSector(company.sector) ? company.sector : "",
  };
}
