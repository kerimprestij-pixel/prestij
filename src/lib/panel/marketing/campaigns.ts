// Campaign service (automatic discounts). Takes a transaction, never touches Next APIs, so DB tests
// call it directly. The rules a campaign follows at checkout live in src/lib/campaigns/pick.ts.
import "server-only";
import { and, asc, eq, inArray, ne, or, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { campaignAllowsGroup, campaignCovers, campaignDisplayPrice, hasCustomerGroups } from "@/lib/campaigns/pick";
import { TAGS } from "@/lib/cache-tags";
import { auditChanges, type AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import type { CampaignCreateInput, CampaignPreviewInput, CampaignUpdateInput } from "./schemas";
import { windowsOverlap } from "./status";

const c = schema.campaigns;

/** The stored shape of the editable columns (empty id lists are stored as null = "all"). */
type CampaignColumns = {
  name: string;
  label: LocalizedText | null;
  discountPercent: number;
  productIds: number[] | null;
  categoryIds: number[] | null;
  customerGroupIds: number[] | null;
  themeId: number | null;
  priority: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

const orNull = (ids: number[]) => (ids.length ? ids : null);

function toColumns(input: CampaignCreateInput): CampaignColumns {
  return {
    name: input.name,
    label: input.label,
    discountPercent: input.discountPercent,
    productIds: orNull(input.productIds),
    categoryIds: orNull(input.categoryIds),
    customerGroupIds: orNull(input.customerGroupIds),
    themeId: input.themeId,
    priority: input.priority,
    isActive: input.isActive,
    startsAt: input.schedule.startsAt,
    endsAt: input.schedule.endsAt,
  };
}

const editable = {
  id: c.id,
  name: c.name,
  label: c.label,
  discountPercent: c.discountPercent,
  productIds: c.productIds,
  categoryIds: c.categoryIds,
  customerGroupIds: c.customerGroupIds,
  themeId: c.themeId,
  priority: c.priority,
  isActive: c.isActive,
  startsAt: c.startsAt,
  endsAt: c.endsAt,
  updatedAt: c.updatedAt,
} as const;

/** Every referenced product, category, customer group and theme must exist (ids never trusted). */
async function assertReferences(tx: Tx, input: CampaignCreateInput): Promise<void> {
  const { products, categories, customerGroups, themes } = schema;
  const [productRows, categoryRows, groupRows, themeRows] = await Promise.all([
    input.productIds.length
      ? tx.select({ id: products.id, type: products.type }).from(products).where(inArray(products.id, input.productIds))
      : Promise.resolve([]),
    input.categoryIds.length ? tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, input.categoryIds)) : Promise.resolve([]),
    input.customerGroupIds.length
      ? tx.select({ id: customerGroups.id }).from(customerGroups).where(inArray(customerGroups.id, input.customerGroupIds))
      : Promise.resolve([]),
    input.themeId != null ? tx.select({ id: themes.id, isDefault: themes.isDefault }).from(themes).where(eq(themes.id, input.themeId)) : Promise.resolve([]),
  ]);
  if (productRows.length !== input.productIds.length) {
    throw fieldError("productIds", "Seçilen ürünlerden biri artık yok. Listeyi kontrol edin.");
  }
  if (productRows.some((p) => p.type === "sample")) {
    throw fieldError("productIds", "Numune ürünler ücretsizdir; kampanyaya eklenemez.");
  }
  if (categoryRows.length !== input.categoryIds.length) {
    throw fieldError("categoryIds", "Seçilen kategorilerden biri artık yok. Listeyi kontrol edin.");
  }
  if (groupRows.length !== input.customerGroupIds.length) {
    throw fieldError("customerGroupIds", "Seçilen müşteri gruplarından biri artık yok.");
  }
  if (input.themeId != null) {
    const theme = themeRows[0];
    if (!theme) throw fieldError("themeId", "Seçilen tema artık yok.");
    if (theme.isDefault) throw fieldError("themeId", "Varsayılan tema zaten her zaman etkin; başka bir tema seçin.");
  }
}

/** `campaigns`, plus `theme` when a linked theme is involved (campaign-linked themes, THEME-TEXTS). */
function tagsFor(...themeIds: (number | null | undefined)[]): string[] {
  return themeIds.some((id) => id != null) ? [TAGS.campaigns, TAGS.theme] : [TAGS.campaigns];
}

export type CampaignSaveResult = { id: number; updatedAt: Date; tags: string[]; audit: AuditEntry };

export async function createCampaign(tx: Tx, input: CampaignCreateInput): Promise<CampaignSaveResult> {
  await assertReferences(tx, input);
  const values = toColumns(input);
  const [row] = await tx.insert(c).values(values).returning({ id: c.id, updatedAt: c.updatedAt });
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    tags: tagsFor(values.themeId),
    audit: { action: "create", entity: "campaign", entityId: row.id, after: values },
  };
}

async function lockCampaign(tx: Tx, id: number) {
  const [row] = await tx.select(editable).from(c).where(eq(c.id, id)).for("update");
  if (!row) throw new PanelError("not_found", "Kampanya bulunamadı; silinmiş olabilir.");
  return row;
}

export async function updateCampaign(tx: Tx, input: CampaignUpdateInput): Promise<CampaignSaveResult> {
  const before = await lockCampaign(tx, input.id);
  assertFresh(before.updatedAt, input.updatedAt);
  await assertReferences(tx, input);
  const values = toColumns(input);
  const [row] = await tx
    .update(c)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(c.id, input.id))
    .returning({ id: c.id, updatedAt: c.updatedAt });
  const { updatedAt: _u, id: _i, ...old } = before;
  void _u;
  void _i;
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    tags: tagsFor(before.themeId, values.themeId),
    audit: { action: "update", entity: "campaign", entityId: row.id, ...auditChanges(old, values) },
  };
}

export async function setCampaignActive(
  tx: Tx,
  input: { id: number; isActive: boolean; updatedAt: Date },
): Promise<CampaignSaveResult> {
  const before = await lockCampaign(tx, input.id);
  assertFresh(before.updatedAt, input.updatedAt);
  const [row] = await tx
    .update(c)
    .set({ isActive: input.isActive, updatedAt: new Date() })
    .where(eq(c.id, input.id))
    .returning({ id: c.id, updatedAt: c.updatedAt });
  return {
    id: row.id,
    updatedAt: row.updatedAt,
    tags: tagsFor(before.themeId),
    audit: { action: "status", entity: "campaign", entityId: row.id, before: { isActive: before.isActive }, after: { isActive: input.isActive } },
  };
}

/** Campaigns hold no references (orders keep their own prices), so any campaign may be deleted. */
export async function deleteCampaign(tx: Tx, input: { id: number; updatedAt?: Date }): Promise<{ tags: string[]; audit: AuditEntry }> {
  const before = await lockCampaign(tx, input.id);
  if (input.updatedAt) assertFresh(before.updatedAt, input.updatedAt);
  await tx.delete(c).where(eq(c.id, input.id));
  const { updatedAt: _u, ...old } = before;
  void _u;
  return { tags: tagsFor(before.themeId), audit: { action: "delete", entity: "campaign", entityId: input.id, before: old } };
}

// ---------------------------------------------------------------------------------------------------
// Preview of affected prices

export type CampaignPreviewRow = {
  variantId: number;
  productId: number;
  productName: string;
  sku: string;
  volumeMl: number | null;
  businessOnly: boolean;
  /** Regular retail price (kuruş). */
  oldPrice: number;
  /** Price with this campaign, rounded like the cart. */
  newPrice: number;
  /** Another campaign that wins over this one for the product (higher priority or percent). */
  overriddenBy: { id: number; name: string; percent: number } | null;
};

export type CampaignPreview = {
  /** No product and no category selected: every product. */
  everything: boolean;
  productCount: number;
  variantCount: number;
  /** At most PREVIEW_LIMIT rows, in catalog order. */
  rows: CampaignPreviewRow[];
  truncated: boolean;
  overriddenProductCount: number;
};

export const PREVIEW_LIMIT = 120;

/**
 * Active, sellable variants the campaign would change (same matching as the cart: product listed OR
 * its own category listed; nothing listed = everything; samples are never discounted), with the
 * regular → campaign price, and which ones another overlapping campaign would win.
 */
export async function previewCampaign(executor: Tx, input: CampaignPreviewInput): Promise<CampaignPreview> {
  const { products: p, productVariants: v } = schema;
  const everything = input.productIds.length === 0 && input.categoryIds.length === 0;
  const scope: SQL[] = [];
  if (input.productIds.length) scope.push(inArray(p.id, input.productIds));
  if (input.categoryIds.length) scope.push(inArray(p.categoryId, input.categoryIds));

  const [variants, others] = await Promise.all([
    executor
      .select({
        variantId: v.id,
        productId: p.id,
        categoryId: p.categoryId,
        name: p.name,
        sku: v.sku,
        volumeMl: v.volumeMl,
        price: v.price,
        businessOnly: p.businessOnly,
      })
      .from(v)
      .innerJoin(p, eq(v.productId, p.id))
      .where(and(eq(p.status, "active"), ne(p.type, "sample"), eq(v.isActive, true), everything ? undefined : or(...scope)))
      .orderBy(asc(p.position), asc(p.id), asc(v.position), asc(v.id)),
    executor
      .select({
        id: c.id,
        name: c.name,
        percent: c.discountPercent,
        priority: c.priority,
        productIds: c.productIds,
        categoryIds: c.categoryIds,
        customerGroupIds: c.customerGroupIds,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
      })
      .from(c)
      .where(input.id != null ? and(eq(c.isActive, true), ne(c.id, input.id)) : eq(c.isActive, true))
      .orderBy(asc(c.id)),
  ]);

  // Rivals: other switched-on campaigns that can run at the same time for the same buyers and beat this one.
  const draftGroups = input.customerGroupIds;
  const rivals = others.filter((o) => {
    if (!windowsOverlap(o, input.schedule)) return false;
    const sameBuyers = draftGroups.length === 0 ? !hasCustomerGroups(o) : !hasCustomerGroups(o) || draftGroups.some((g) => campaignAllowsGroup(o, g));
    if (!sameBuyers) return false;
    return o.priority > input.priority || (o.priority === input.priority && o.percent > input.discountPercent);
  });

  const products = new Set<number>();
  const overridden = new Set<number>();
  const rows: CampaignPreviewRow[] = [];
  for (const row of variants) {
    products.add(row.productId);
    const target = { productId: row.productId, categoryId: row.categoryId };
    const rival = rivals
      .filter((o) => campaignCovers(o, target))
      .sort((a, b) => b.priority - a.priority || b.percent - a.percent || a.id - b.id)[0];
    if (rival) overridden.add(row.productId);
    if (rows.length < PREVIEW_LIMIT) {
      rows.push({
        variantId: row.variantId,
        productId: row.productId,
        productName: row.name.tr,
        sku: row.sku,
        volumeMl: row.volumeMl,
        businessOnly: row.businessOnly,
        oldPrice: row.price,
        newPrice: campaignDisplayPrice({ price: row.price }, input.discountPercent).unitPrice,
        overriddenBy: rival ? { id: rival.id, name: rival.name, percent: rival.percent } : null,
      });
    }
  }
  return {
    everything,
    productCount: products.size,
    variantCount: variants.length,
    rows,
    truncated: variants.length > rows.length,
    overriddenProductCount: overridden.size,
  };
}
