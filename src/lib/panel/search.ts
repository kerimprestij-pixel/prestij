"use server";
// Command palette search (Ctrl/⌘+K). Role-aware: products and orders for staff+, pages for editor+.
// Turkish-insensitive ("ozturk" finds "Öztürk"); at most 6 hits per group; hrefs are panel URLs.
import { asc, desc, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { ORDER_STATUS, PRODUCT_STATUS } from "@/components/panel/labels";
import { localize } from "@/i18n/localize";
import { formatPrice } from "@/lib/pricing/money";
import { requirePanelActor } from "./action";
import { escapeLike, FOLD_FROM, FOLD_TO, foldText } from "./format";
import { hasRole } from "./roles";

export type Hit = { id: string | number; title: string; subtitle?: string; href: string };
export type PanelSearchResult = { products: Hit[]; orders: Hit[]; pages: Hit[] };

const LIMIT = 6;
const EMPTY: PanelSearchResult = { products: [], orders: [], pages: [] };
const PAGE_KIND_LABELS: Record<string, string> = { home: "Ana sayfa", custom: "Sayfa", legal: "Yasal metin", landing: "Kampanya sayfası", b2b: "Kurumsal sayfa" };

const fold = (expr: SQL) => sql`lower(translate(coalesce(${expr}, ''), ${FOLD_FROM}, ${FOLD_TO}))`;

export async function panelSearch(q: string): Promise<PanelSearchResult> {
  const actor = await requirePanelActor("staff");
  const term = typeof q === "string" ? q.trim().slice(0, 100) : "";
  if (term.length < 2) return EMPTY;
  const like = `%${escapeLike(foldText(term))}%`;
  const digits = term.replace(/\D/g, "");

  const p = schema.products;
  const o = schema.orders;
  const pg = schema.pages;

  const [products, orders, pages] = await Promise.all([
    db
      .select({ id: p.id, name: p.name, subtitle: p.subtitle, status: p.status, sku: sql<string | null>`(select pv.sku from product_variants pv where pv.product_id = "products"."id" order by pv.is_default desc, pv.position, pv.id limit 1)` })
      .from(p)
      .where(
        or(
          sql`${fold(sql`${p.name}::text`)} like ${like}`,
          sql`${fold(sql`${p.subtitle}::text`)} like ${like}`,
          sql`${fold(sql`${p.slug}`)} like ${like}`,
          // Correlated subqueries use explicit aliases: drizzle renders columns unqualified in a single-table select.
          sql`exists (select 1 from product_variants pv where pv.product_id = "products"."id" and (${fold(sql.raw("pv.sku"))} like ${like} or ${fold(sql.raw("pv.barcode"))} like ${like}))`,
        ),
      )
      .orderBy(asc(p.position), asc(p.id))
      .limit(LIMIT),
    db
      .select({
        id: o.id,
        orderNumber: o.orderNumber,
        email: o.email,
        status: o.status,
        grandTotal: o.grandTotal,
        name: sql<string | null>`coalesce(${o.invoice}->>'companyName', ${o.shippingAddress}->>'fullName')`,
      })
      .from(o)
      .where(
        or(
          sql`${fold(sql`${o.orderNumber}`)} like ${like}`,
          sql`${fold(sql`${o.email}`)} like ${like}`,
          ...(digits.length >= 4 ? [sql`replace(${o.orderNumber}, '-', '') like ${`%${digits}%`}`] : []),
        ),
      )
      .orderBy(desc(o.createdAt))
      .limit(LIMIT),
    hasRole(actor.staffRole, "editor")
      ? db
          .select({ id: pg.id, title: pg.title, slug: pg.slug, kind: pg.kind })
          .from(pg)
          .where(or(sql`${fold(sql`${pg.title}::text`)} like ${like}`, sql`${fold(sql`${pg.slug}`)} like ${like}`))
          .orderBy(asc(pg.slug))
          .limit(LIMIT)
      : Promise.resolve([]),
  ]);

  return {
    products: products.map((r) => ({
      id: r.id,
      title: [localize(r.name, "tr"), localize(r.subtitle, "tr")].filter(Boolean).join(" — "),
      subtitle: [r.sku, PRODUCT_STATUS[r.status]?.label].filter(Boolean).join(" · "),
      href: `/panel/urunler/${r.id}`,
    })),
    orders: orders.map((r) => ({
      id: r.id,
      title: r.orderNumber,
      subtitle: [r.name || r.email, ORDER_STATUS[r.status]?.label, formatPrice(r.grandTotal, "tr")].filter(Boolean).join(" · "),
      href: `/panel/siparisler/${r.id}`,
    })),
    pages: pages.map((r) => ({
      id: r.id,
      title: localize(r.title, "tr") || r.slug,
      subtitle: `${PAGE_KIND_LABELS[r.kind] ?? "Sayfa"} · /${r.slug === "home" ? "" : r.slug}`,
      href: `/panel/sayfalar/${r.id}`,
    })),
  };
}
