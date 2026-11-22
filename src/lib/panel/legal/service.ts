// Versioned legal documents for the panel: list, editor data, publish a new version, restore an old one.
// Exactly one current version per key (partial unique index legal_documents_one_current): a publish
// sets the old row's isCurrent=false first, then inserts the new current row, in one transaction.
// Orders keep the texts they stored at checkout (legal_snapshot events); nothing here touches them.
// No Next APIs: DB tests call these directly; /panel/yasal/actions.ts wraps the action options.
import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LocalizedText } from "@/db/schema/common";
import { TAGS } from "@/lib/cache-tags";
import type { AuditEntry } from "@/lib/panel/audit";
import { assertFresh } from "@/lib/panel/concurrency";
import { fieldError, PanelError } from "@/lib/panel/errors";
import type { Tx } from "@/lib/panel/tx";
import {
  CHECKOUT_LEGAL_KEYS,
  cleanStoredBody,
  composeLegalBody,
  legalPublishInput,
  legalRestoreInput,
  legalVersionSuggestions,
  splitLocalizedBody,
  type LegalPublishInput,
  type LegalRestoreInput,
} from "./schemas";

const NEWER_VERSION = "Bu metnin yeni bir sürümü siz düzenlerken yayınlandı. Sayfayı yenileyip değişikliklerinizi tekrar uygulayın.";

export type LegalPageRef = { id: number; slug: string; title: LocalizedText; isPublished: boolean };

export type LegalListItem = {
  key: string;
  title: LocalizedText;
  version: string | null;
  publishedAt: string | null;
  versionCount: number;
  checkout: boolean;
  pages: { slug: string; isPublished: boolean }[];
};

export type LegalVersionSummary = { id: number; version: string; title: LocalizedText; isCurrent: boolean; createdAt: string };

export type LegalEditorData = {
  key: string;
  current: { id: number; version: string; title: LocalizedText; body: LocalizedText; createdAt: string; updatedAt: string } | null;
  versions: LegalVersionSummary[];
  /** Suggested label for an approved text (never "taslak…"; after a draft: "2026-11 v1"). */
  nextVersion: string;
  /** Suggested label while the text is still a draft ("taslak-N"); the editor uses it while the draft notice is on. */
  nextDraftVersion: string;
  checkout: boolean;
  pages: LegalPageRef[];
};

/** Published legal pages (/sayfa/<slug>) whose legal_document section shows `key`. */
export async function legalPagesFor(keys: readonly string[], executor: Tx = db): Promise<Map<string, LegalPageRef[]>> {
  const out = new Map<string, LegalPageRef[]>(keys.map((k) => [k, []]));
  if (keys.length === 0) return out;
  const p = schema.pages;
  const s = schema.pageSections;
  const rows = await executor
    .select({ id: p.id, slug: p.slug, title: p.title, isPublished: p.isPublished, key: sql<string>`${s.content}->>'key'` })
    .from(s)
    .innerJoin(p, eq(p.id, s.pageId))
    .where(and(eq(s.type, "legal_document"), inArray(sql<string>`${s.content}->>'key'`, [...keys])))
    .orderBy(asc(p.id));
  for (const r of rows) {
    const list = out.get(r.key);
    if (list && !list.some((x) => x.id === r.id)) list.push({ id: r.id, slug: r.slug, title: r.title, isPublished: r.isPublished });
  }
  return out;
}

const KEY_ORDER = ["distance_sales", "pre_information", "kvkk", "returns", "cookies"];
const keyRank = (key: string) => {
  const i = KEY_ORDER.indexOf(key);
  return i === -1 ? KEY_ORDER.length : i;
};

/** Every legal key with its current version (list page). */
export async function listLegalDocuments(executor: Tx = db): Promise<LegalListItem[]> {
  const t = schema.legalDocuments;
  const rows = await executor
    .select({ key: t.key, version: t.version, title: t.title, isCurrent: t.isCurrent, createdAt: t.createdAt })
    .from(t)
    .orderBy(asc(t.key), desc(t.createdAt), desc(t.id));
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  const keys = [...byKey.keys()].sort((a, b) => keyRank(a) - keyRank(b) || a.localeCompare(b));
  const pages = await legalPagesFor(keys, executor);
  return keys.map((key) => {
    const list = byKey.get(key) ?? [];
    const current = list.find((r) => r.isCurrent) ?? null;
    return {
      key,
      title: (current ?? list[0]).title,
      version: current?.version ?? null,
      publishedAt: current ? current.createdAt.toISOString() : null,
      versionCount: list.length,
      checkout: CHECKOUT_LEGAL_KEYS.includes(key),
      pages: (pages.get(key) ?? []).map((p) => ({ slug: p.slug, isPublished: p.isPublished })),
    };
  });
}

/**
 * Current version, history and usage of one key; null when the key has no rows. `now` dates the suggested
 * approved label ("2026-11 v1"); pages pass nothing (they call this after reading the session).
 */
export async function getLegalEditorData(key: string, executor: Tx = db, now: Date = new Date()): Promise<LegalEditorData | null> {
  const t = schema.legalDocuments;
  const rows = await executor.select().from(t).where(eq(t.key, key)).orderBy(desc(t.createdAt), desc(t.id));
  if (rows.length === 0) return null;
  const current = rows.find((r) => r.isCurrent) ?? null;
  const pages = (await legalPagesFor([key], executor)).get(key) ?? [];
  const suggestions = legalVersionSuggestions(current?.version ?? rows[0].version, rows.map((r) => r.version), now);
  return {
    key,
    current: current
      ? {
          id: current.id,
          version: current.version,
          title: current.title,
          body: current.body,
          createdAt: current.createdAt.toISOString(),
          updatedAt: current.updatedAt.toISOString(),
        }
      : null,
    versions: rows.map((r) => ({ id: r.id, version: r.version, title: r.title, isCurrent: r.isCurrent, createdAt: r.createdAt.toISOString() })),
    nextVersion: suggestions.approved,
    nextDraftVersion: suggestions.draft,
    checkout: CHECKOUT_LEGAL_KEYS.includes(key),
    pages,
  };
}

/** One stored version for the history viewer, split into notice and body per locale. */
export async function getLegalVersion(id: number, executor: Tx = db) {
  const t = schema.legalDocuments;
  const [row] = await executor.select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) return null;
  const parts = splitLocalizedBody(cleanStoredBody(row.body));
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    isCurrent: row.isCurrent,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    notice: parts.notice,
    body: parts.body,
  };
}

const sameText = (a: LocalizedText | null | undefined, b: LocalizedText | null | undefined) =>
  (a?.tr ?? "") === (b?.tr ?? "") && (a?.en ?? "") === (b?.en ?? "") && (a?.ar ?? "") === (b?.ar ?? "");

type PublishCore = {
  key: string;
  baseId: number | null;
  baseUpdatedAt: Date | null;
  version: string;
  title: LocalizedText;
  /** Already composed and sanitized (composeLegalBody / cleanStoredBody). */
  body: LocalizedText;
};

export type PublishResult = {
  id: number;
  version: string;
  updatedAt: Date;
  /** Suggested label for the next publish of an approved text (never "taslak…"). */
  nextVersion: string;
  /** Suggested label for the next publish while the text is still a draft ("taslak-N"). */
  nextDraftVersion: string;
  tags: string[];
  audit: AuditEntry[];
};

async function publishCore(tx: Tx, input: PublishCore, auditAction: "publish" | "restore", extra?: Record<string, unknown>): Promise<PublishResult> {
  const t = schema.legalDocuments;
  // Serializes concurrent publishes of the same key: the second one waits here, then sees a new current row.
  const [current] = await tx.select().from(t).where(and(eq(t.key, input.key), eq(t.isCurrent, true))).for("update");
  if (current) {
    if (input.baseId !== current.id) throw new PanelError("conflict", NEWER_VERSION);
    assertFresh(current.updatedAt, input.baseUpdatedAt);
  } else {
    const [any] = await tx.select({ id: t.id }).from(t).where(eq(t.key, input.key)).limit(1);
    if (!any) throw new PanelError("not_found", "Bu yasal metin bulunamadı.");
    if (input.baseId !== null) throw new PanelError("conflict", NEWER_VERSION);
  }

  const versions = await tx.select({ version: t.version }).from(t).where(eq(t.key, input.key));
  const wanted = input.version.toLocaleLowerCase("tr");
  if (versions.some((v) => v.version.trim().toLocaleLowerCase("tr") === wanted)) {
    throw fieldError("version", "Bu sürüm adı bu metinde daha önce kullanıldı. Yeni bir ad girin.");
  }
  if (!input.body.tr.trim()) throw fieldError("body.tr", "Türkçe metni girin.");

  // Old row off first (partial unique index), then the new current row.
  if (current) await tx.update(t).set({ isCurrent: false }).where(eq(t.id, current.id));
  const [row] = await tx
    .insert(t)
    .values({ key: input.key, version: input.version, title: input.title, body: input.body, isCurrent: true, seo: current?.seo ?? null })
    .returning({ id: t.id, updatedAt: t.updatedAt });

  const tags: string[] = [TAGS.legal, TAGS.pages];
  const audit: AuditEntry[] = [
    {
      action: auditAction,
      entity: "legal_document",
      entityId: row.id,
      before: current ? { id: current.id, key: current.key, version: current.version, title: current.title } : null,
      after: { id: row.id, key: input.key, version: input.version, title: input.title, body: input.body, ...extra },
    },
  ];

  // Legal pages show the page title as their heading: follow a renamed document, unless the page title
  // was customised in the page editor (it no longer equals the previous document title).
  if (current && !sameText(current.title, input.title)) {
    const p = schema.pages;
    for (const page of (await legalPagesFor([input.key], tx)).get(input.key) ?? []) {
      const [locked] = await tx.select({ title: p.title, seo: p.seo }).from(p).where(eq(p.id, page.id)).for("update");
      if (!locked) continue;
      const titleFollows = sameText(locked.title, current.title);
      const seoFollows = Boolean(locked.seo?.title) && sameText(locked.seo?.title, current.title);
      if (!titleFollows && !seoFollows) continue;
      const next = {
        ...(titleFollows ? { title: input.title } : {}),
        ...(seoFollows ? { seo: { ...locked.seo, title: input.title } } : {}),
      };
      await tx.update(p).set(next).where(eq(p.id, page.id));
      tags.push(TAGS.page(page.slug));
      audit.push({ action: "update", entity: "page", entityId: page.id, before: { title: locked.title }, after: { title: input.title } });
    }
  }

  const next = legalVersionSuggestions(input.version, [...versions.map((v) => v.version), input.version], new Date());
  return {
    id: row.id,
    version: input.version,
    updatedAt: row.updatedAt,
    nextVersion: next.approved,
    nextDraftVersion: next.draft,
    tags,
    audit,
  };
}

/** Publishes the editor's text as a new current version. */
export function publishLegalVersion(tx: Tx, input: LegalPublishInput): Promise<PublishResult> {
  return publishCore(
    tx,
    {
      key: input.key,
      baseId: input.baseId,
      baseUpdatedAt: input.baseUpdatedAt,
      version: input.version,
      title: input.title,
      body: composeLegalBody(input.body, input.notice, input.showNotice),
    },
    "publish",
  );
}

/** Publishes a copy of an older version (of the same key) as a new current version. */
export async function restoreLegalVersion(tx: Tx, input: LegalRestoreInput): Promise<PublishResult> {
  const t = schema.legalDocuments;
  const [source] = await tx.select().from(t).where(and(eq(t.id, input.sourceId), eq(t.key, input.key))).limit(1);
  if (!source) throw new PanelError("not_found", "Geri yüklenecek sürüm bulunamadı.");
  return publishCore(
    tx,
    {
      key: input.key,
      baseId: input.baseId,
      baseUpdatedAt: input.baseUpdatedAt,
      version: input.version,
      title: source.title,
      body: cleanStoredBody(source.body),
    },
    "restore",
    { restoredFrom: { id: source.id, version: source.version } },
  );
}

export type LegalPublishData = { id: number; version: string; updatedAt: string; nextVersion: string; nextDraftVersion: string };

const toData = (r: PublishResult): LegalPublishData => ({
  id: r.id,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
  nextVersion: r.nextVersion,
  nextDraftVersion: r.nextDraftVersion,
});

const publishedMessage = (key: string, lead: string) =>
  `${lead} ${CHECKOUT_LEGAL_KEYS.includes(key) ? "Ödeme sayfası ve sitedeki sayfa" : "Sitedeki sayfa"} artık bu sürümü gösteriyor.`;

/** panelAction options (admin; tags legal + pages): publish a new version. */
export const legalPublishOptions = {
  minRole: "admin" as const,
  schema: legalPublishInput,
  run: async (input: LegalPublishInput, { tx }: { tx: Tx }) => {
    const r = await publishLegalVersion(tx, input);
    return { data: toData(r), message: publishedMessage(input.key, `“${r.version}” yayınlandı.`), tags: r.tags, audit: r.audit };
  },
};

/** panelAction options (admin; tags legal + pages): restore an old version as a new one. */
export const legalRestoreOptions = {
  minRole: "admin" as const,
  schema: legalRestoreInput,
  run: async (input: LegalRestoreInput, { tx }: { tx: Tx }) => {
    const r = await restoreLegalVersion(tx, input);
    return { data: toData(r), message: publishedMessage(input.key, `Eski metin “${r.version}” adıyla yeniden yayınlandı.`), tags: r.tags, audit: r.audit };
  },
};
