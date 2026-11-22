// Blog post writes (DB-testable: no Next APIs). The Server Actions in app/panel/(dashboard)/blog wire
// these to panelAction and return the cache tags and audit entries computed here.
import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { LocalizedText, SeoFields } from "@/db/schema";
import { localize } from "@/i18n/localize";
import { TAGS } from "@/lib/cache-tags";
import { auditChanges, type AuditEntry } from "../audit";
import { assertFresh } from "../concurrency";
import { fieldError, PanelError } from "../errors";
import { ensureMediaExist } from "../media/queries";
import { canonicalPath, dropRedirectsTo, recordMove } from "../redirects";
import type { Tx } from "../tx";
import { postVisibility, readingMinutes } from "./reading";
import type { BlogPostInput } from "./schema";

const b = schema.blogPosts;

export type SavedPost = { id: number; slug: string; updatedAt: Date; status: "draft" | "published"; publishedAt: Date | null };

export type SavePostResult = { post: SavedPost; created: boolean; tags: string[]; audit: AuditEntry };

/** SeoFields without empty keys (the storefront treats a missing key as "use the default"). */
function toSeo(seo: BlogPostInput["seo"]): SeoFields | null {
  const out: SeoFields = {};
  if (seo.title) out.title = seo.title;
  if (seo.description) out.description = seo.description;
  if (seo.ogImageId) out.ogImageId = seo.ogImageId;
  if (seo.noIndex) out.noIndex = true;
  return Object.keys(out).length > 0 ? out : null;
}

type PostValues = {
  slug: string;
  title: LocalizedText;
  excerpt: LocalizedText | null;
  body: LocalizedText | null;
  coverId: number | null;
  authorName: string | null;
  tags: string[] | null;
  relatedProductIds: number[] | null;
  status: "draft" | "published";
  publishedAt: Date | null;
  seo: SeoFields | null;
  readingMinutes: number | null;
};

/** Audit view of a post: the editable fields only (body is kept; scrubAudit shortens very long strings). */
function auditView(v: PostValues) {
  return {
    slug: v.slug,
    title: v.title,
    excerpt: v.excerpt,
    body: v.body,
    coverId: v.coverId,
    authorName: v.authorName,
    tags: v.tags ?? [],
    relatedProductIds: v.relatedProductIds ?? [],
    status: v.status,
    publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    seo: v.seo,
  };
}

async function assertSlugFree(tx: Tx, slug: string, exceptId: number | null) {
  const [taken] = await tx
    .select({ id: b.id })
    .from(b)
    .where(exceptId ? and(eq(b.slug, slug), ne(b.id, exceptId)) : eq(b.slug, slug))
    .limit(1);
  if (taken) throw fieldError("slug", "Bu kısa ad başka bir yazıda kullanılıyor. Farklı bir kısa ad seçin.");
}

async function assertProductsExist(tx: Tx, ids: readonly number[]) {
  if (ids.length === 0) return;
  const rows = await tx.select({ id: schema.products.id }).from(schema.products).where(inArray(schema.products.id, [...ids]));
  if (rows.length !== new Set(ids).size) {
    throw fieldError("relatedProductIds", "Seçilen ürünlerden biri artık yok. Listeyi gözden geçirip yeniden kaydedin.");
  }
}

/**
 * Creates (input.id null) or updates a post, locked by the `updatedAt` the editor loaded. Publishing
 * without a date stamps "now"; a future date schedules the post. Reading minutes come from the TR body.
 * Changing the slug of a post that is already public records a redirect (old → new address).
 */
export async function saveBlogPost(tx: Tx, input: BlogPostInput, { now = new Date() }: { now?: Date } = {}): Promise<SavePostResult> {
  await assertSlugFree(tx, input.slug, input.id);
  await ensureMediaExist(tx, [input.coverId], "coverId");
  await ensureMediaExist(tx, [input.seo.ogImageId], "seo.ogImageId");
  await assertProductsExist(tx, input.relatedProductIds);

  const values: PostValues = {
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    body: input.body,
    coverId: input.coverId,
    authorName: input.authorName,
    tags: input.tags.length > 0 ? input.tags : null,
    relatedProductIds: input.relatedProductIds.length > 0 ? input.relatedProductIds : null,
    status: input.status,
    publishedAt: input.publishedAt ?? (input.status === "published" ? now : null),
    seo: toSeo(input.seo),
    readingMinutes: readingMinutes(input.body?.tr),
  };

  if (input.id === null) {
    const [row] = await tx
      .insert(b)
      .values(values)
      .returning({ id: b.id, slug: b.slug, updatedAt: b.updatedAt, status: b.status, publishedAt: b.publishedAt });
    return {
      post: row,
      created: true,
      tags: [TAGS.blog, TAGS.post(row.slug)],
      audit: { action: values.status === "published" ? "publish" : "create", entity: "blog_post", entityId: row.id, after: auditView(values) },
    };
  }

  const [current] = await tx.select().from(b).where(eq(b.id, input.id)).for("update");
  if (!current) throw new PanelError("not_found", "Yazı bulunamadı. Silinmiş olabilir.");
  assertFresh(current.updatedAt, input.updatedAt);

  const tags = new Set<string>([TAGS.blog, TAGS.post(current.slug), TAGS.post(values.slug)]);
  const wasPublic = postVisibility(current, now) === "published";
  if (current.slug !== values.slug && wasPublic) {
    if (await recordMove(tx, canonicalPath.post(current.slug), canonicalPath.post(values.slug))) tags.add(TAGS.redirects);
  }

  const [row] = await tx
    .update(b)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(b.id, input.id))
    .returning({ id: b.id, slug: b.slug, updatedAt: b.updatedAt, status: b.status, publishedAt: b.publishedAt });

  const before = auditView({
    slug: current.slug,
    title: current.title,
    excerpt: current.excerpt ?? null,
    body: current.body ?? null,
    coverId: current.coverId ?? null,
    authorName: current.authorName ?? null,
    tags: current.tags ?? null,
    relatedProductIds: current.relatedProductIds ?? null,
    status: current.status,
    publishedAt: current.publishedAt ?? null,
    seo: current.seo ?? null,
    readingMinutes: current.readingMinutes ?? null,
  });
  const publishing = current.status !== "published" && values.status === "published";
  return {
    post: row,
    created: false,
    tags: [...tags],
    audit: { action: publishing ? "publish" : "update", entity: "blog_post", entityId: row.id, ...auditChanges(before, auditView(values)) },
  };
}

export type PostLink = { label: string; detail: string; href: string | null };

/**
 * Menus, page sections and announcements that link to /blog/<slug> (any locale prefix). Deleting a post
 * they point to would leave broken links, so the delete is refused while any exist.
 */
export async function findPostLinks(tx: Tx, slug: string): Promise<PostLink[]> {
  // Slugs are [a-z0-9-] (slugInput), so they are safe inside the regular expression.
  const pattern = `/blog/${slug}([/?#"]|$)`;
  const [menus, sections, announcements] = await Promise.all([
    tx.select({ key: schema.menus.key }).from(schema.menus).where(sql`${schema.menus.items}::text ~ ${pattern}`),
    tx
      .select({ pageId: schema.pages.id, title: schema.pages.title, type: schema.pageSections.type })
      .from(schema.pageSections)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.pageSections.pageId))
      .where(sql`${schema.pageSections.content}::text ~ ${pattern}`),
    tx.select({ id: schema.announcements.id, text: schema.announcements.text }).from(schema.announcements).where(sql`${schema.announcements.href} ~ ${pattern}`),
  ]);
  const MENU_LABELS: Record<string, string> = {
    header: "Üst menü",
    footer_shop: "Alt bilgi › Alışveriş",
    footer_corporate: "Alt bilgi › Kurumsal",
    footer_legal: "Alt bilgi › Yasal",
  };
  return [
    ...menus.map((m) => ({ label: MENU_LABELS[m.key] ?? `Menü (${m.key})`, detail: "Menü bağlantısı", href: "/panel/menuler" })),
    ...sections.map((s) => ({ label: localize(s.title, "tr") || "Sayfa", detail: `Bölüm bağlantısı (${s.type})`, href: `/panel/sayfalar/${s.pageId}` })),
    ...announcements.map((a) => ({ label: localize(a.text, "tr").slice(0, 60) || "Duyuru", detail: "Duyuru bağlantısı", href: "/panel/duyurular" })),
  ];
}

/** Deletes a post (refused with `in_use` while menus/sections/announcements link to it). */
export async function deleteBlogPost(tx: Tx, input: { id: number; updatedAt: Date }): Promise<{ tags: string[]; audit: AuditEntry }> {
  const id = input.id;
  const [row] = await tx.select().from(b).where(eq(b.id, id)).for("update");
  if (!row) throw new PanelError("not_found", "Yazı bulunamadı. Daha önce silinmiş olabilir.");
  assertFresh(row.updatedAt, input.updatedAt);

  const links = await findPostLinks(tx, row.slug);
  if (links.length > 0) {
    const places = links.slice(0, 4).map((l) => `${l.label} (${l.detail})`);
    const rest = links.length - places.length;
    throw new PanelError(
      "in_use",
      `Bu yazıya bağlantı veren yerler var: ${places.join(", ")}${rest > 0 ? ` ve ${rest} yer daha` : ""}. Önce bu bağlantıları kaldırın ya da yazıyı taslağa alın.`,
    );
  }

  await tx.delete(b).where(eq(b.id, id));
  const removed = await dropRedirectsTo(tx, canonicalPath.post(row.slug));
  return {
    tags: [TAGS.blog, TAGS.post(row.slug), ...(removed > 0 ? [TAGS.redirects] : [])],
    audit: {
      action: "delete",
      entity: "blog_post",
      entityId: id,
      before: { slug: row.slug, title: row.title, status: row.status, publishedAt: row.publishedAt?.toISOString() ?? null, coverId: row.coverId },
    },
  };
}
