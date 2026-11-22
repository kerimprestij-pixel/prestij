// Day-3 review fixes against the local PostgreSQL: reference checks and discount-scope cleanup on
// category/product delete, stale-view delete conflicts, the legal-page section guard, media existence
// checks that lock against a concurrent delete, barcode checks serialized across products, no-op audit
// rows, the contact form's site-wide cap, the per-e-mail sign-in lock, the narrowed admin role and the
// closed /api/auth/admin/* routes. Every row and user it creates is removed again; the final hook
// checks the row counts.
//   npx tsx --test --test-concurrency=1 --conditions=react-server --env-file=.env.local tests/db/day3-fixes.test.ts
import "./setup/local-only";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { POST as authPost, GET as authGet } from "@/app/api/auth/[...all]/route";
import { auth } from "@/lib/auth";
import { clearSignInFailures, SIGN_IN_FAILURE_RULE } from "@/lib/auth-limits";
import { dbLimitStore } from "@/lib/rate-limit-store";
import { submitContactForm } from "@/lib/contact/service";
import { forgetLimits } from "@/lib/rate-limit-store";
import { executePanelAction } from "@/lib/panel/action-core";
import { deleteBlogPost } from "@/lib/panel/blog/service";
import { deleteCategory } from "@/lib/panel/categories/service";
import { savePageDef } from "@/lib/panel/content/action-defs";
import { getPageEditorData } from "@/lib/panel/content/queries";
import { scopeWithout } from "@/lib/panel/discount-scope";
import { PanelError } from "@/lib/panel/errors";
import { ensureMediaExist } from "@/lib/panel/media/queries";
import { loadProductState } from "@/lib/panel/products/queries";
import { productSaveSchema } from "@/lib/panel/products/schema";
import { createProduct, deleteProduct, saveProduct } from "@/lib/panel/products/service";
import { generateStaffPassword } from "@/lib/panel/team/rules";
import type { StaffSession } from "@/lib/session";

const ACTOR_ID = "day3-fixes-test-actor";
const ACTOR = {
  user: { id: ACTOR_ID, name: "Day3 Fixes Test", email: "day3-fixes@test.local", role: "editor", banned: false },
  session: { id: "day3-fixes-test-session" },
  staffRole: "editor",
} as unknown as StaffSession;
const PREFIX = "day3-fixes-test";
const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const EMAIL = (key: string) => `${PREFIX}-${key}@test.local`;
/** In-store EAN-13 (prefix 2), valid check digit, never on a real product. */
const TEST_EAN = "2000000000008";

const COUNT_TABLES = ["products", "product_variants", "categories", "campaigns", "coupons", "announcements", "media", "audit_log", "contact_messages", "user", "session", "account", "blog_posts", "redirects"] as const;
const SEQ_TABLES = ["products", "product_variants", "categories", "campaigns", "coupons", "announcements", "media", "audit_log", "blog_posts"] as const;
type SeqState = { table: string; name: string; lastValue: string; isCalled: boolean };
let counts: Record<string, number>;
let sequences: SeqState[] = [];

async function countRows(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNT_TABLES) {
    const rows = await db.execute<{ n: string }>(sql.raw(`select count(*)::text as n from "${t}"`));
    out[t] = Number(rows[0].n);
  }
  return out;
}

async function readSequences(): Promise<SeqState[]> {
  const out: SeqState[] = [];
  for (const table of SEQ_TABLES) {
    const [{ seq }] = await db.execute<{ seq: string }>(sql`select pg_get_serial_sequence(${table}, 'id') as seq`);
    const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql.raw(`select last_value::text, is_called from ${seq}`));
    out.push({ table, name: seq, lastValue: row.last_value, isCalled: row.is_called });
  }
  return out;
}

async function restoreSequences() {
  for (const s of sequences) {
    const [{ max }] = await db.execute<{ max: string | null }>(sql.raw(`select max(id)::text as max from ${s.table}`));
    if (max === null || Number(max) <= Number(s.lastValue)) {
      await db.execute(sql`select setval(${s.name}::regclass, ${s.lastValue}::bigint, ${s.isCalled})`);
    }
  }
}

async function cleanup() {
  const P = schema.products;
  const mine = await db.select({ id: P.id }).from(P).where(like(P.slug, `${PREFIX}%`));
  if (mine.length) await db.delete(P).where(inArray(P.id, mine.map((r) => r.id)));
  await db.delete(schema.categories).where(like(schema.categories.slug, `${PREFIX}%`));
  await db.delete(schema.campaigns).where(like(schema.campaigns.name, `${PREFIX}%`));
  await db.delete(schema.coupons).where(like(schema.coupons.code, "DAY3FIXTEST%"));
  await db.delete(schema.announcements).where(sql`${schema.announcements.text}->>'tr' like ${`${PREFIX}%`}`);
  await db.delete(schema.media).where(like(schema.media.storageKey, `${PREFIX}/%`));
  await db.delete(schema.blogPosts).where(like(schema.blogPosts.slug, `${PREFIX}%`));
  await db.delete(schema.contactMessages).where(like(schema.contactMessages.email, `${PREFIX}%`));
  await db
    .delete(schema.redirects)
    .where(or(like(schema.redirects.fromPath, `%/${PREFIX}%`), like(schema.redirects.toPath, `%/${PREFIX}%`)));
  const users = await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, `${PREFIX}-%@test.local`));
  if (users.length) {
    const ids = users.map((u) => u.id);
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.userId, ids));
    await db.delete(schema.user).where(inArray(schema.user.id, ids)); // sessions + accounts cascade
  }
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
}

before(async () => {
  await cleanup();
  counts = await countRows();
  sequences = await readSequences();
});

after(async () => {
  for (const key of ["lock", "admin", "staff"]) await clearSignInFailures(dbLimitStore, EMAIL(key));
  // The site-cap test refuses before counting, but forget its keys anyway (durable counters).
  await forgetLimits(["contact:ip:198.51.100.250", `contact:email:${PREFIX}-cap@test.local`]);
  await cleanup();
  await restoreSequences();
  try {
    assert.deepEqual(await countRows(), counts, "row counts are back to the start");
  } finally {
    await db.$client.end();
  }
});

const stampOf = async (table: typeof schema.categories | typeof schema.products | typeof schema.blogPosts, id: number) => {
  const [row] = await db.select({ updatedAt: table.updatedAt }).from(table).where(eq(table.id, id));
  return row.updatedAt;
};

async function tempCategory(suffix: string) {
  const [row] = await db
    .insert(schema.categories)
    .values({ slug: `${PREFIX}-${suffix}`, name: { tr: `${PREFIX} ${suffix}` }, isVisible: false, position: 900 })
    .returning();
  return row;
}

async function linkingAnnouncement(href: string) {
  const [row] = await db
    .insert(schema.announcements)
    .values({ text: { tr: `${PREFIX} duyuru` }, href, isActive: false, position: 900 })
    .returning({ id: schema.announcements.id });
  return row.id;
}

const failsWith = (code: string, pattern?: RegExp) => (e: unknown) =>
  e instanceof PanelError && e.code === code && (!pattern || pattern.test(`${e.message} ${JSON.stringify(e.fieldErrors ?? {})}`));

// ---------------------------------------------------------------------------------------------------

describe("category and product delete keep references intact", () => {
  test("pure: removing the last scope id switches the discount off instead of widening it", () => {
    assert.deepEqual(scopeWithout({ productIds: null, categoryIds: [5], isActive: true }, "categoryIds", 5), {
      productIds: null,
      categoryIds: null,
      isActive: false,
    });
    assert.deepEqual(scopeWithout({ productIds: [3], categoryIds: [5, 6], isActive: true }, "categoryIds", 5), {
      productIds: [3],
      categoryIds: [6],
      isActive: true,
    });
    assert.deepEqual(scopeWithout({ productIds: [3], categoryIds: [5], isActive: true }, "categoryIds", 5).isActive, true, "products still scope it");
  });

  test("a category linked from an announcement is refused; a stale view is a conflict", async () => {
    const cat = await tempCategory("linked");
    const announcement = await linkingAnnouncement(`/kategori/${cat.slug}?x=1`);
    await assert.rejects(
      db.transaction((tx) => deleteCategory(tx, { id: cat.id, updatedAt: cat.updatedAt })),
      failsWith("in_use", /Duyuru/),
    );
    await db.delete(schema.announcements).where(eq(schema.announcements.id, announcement));
    await assert.rejects(
      db.transaction((tx) => deleteCategory(tx, { id: cat.id, updatedAt: new Date(cat.updatedAt.getTime() - 60_000) })),
      failsWith("conflict"),
    );
  });

  test("deleting a category removes it from coupon and campaign scopes in the same transaction", async () => {
    const cat = await tempCategory("scoped");
    const [coupon] = await db
      .insert(schema.coupons)
      .values({ code: "DAY3FIXTEST-ONLY", type: "percent", value: 10, categoryIds: [cat.id], isActive: true })
      .returning();
    const [campaign] = await db
      .insert(schema.campaigns)
      .values({ name: `${PREFIX} kampanya`, discountPercent: 10, productIds: [999_999], categoryIds: [cat.id], isActive: false })
      .returning();

    const result = await db.transaction((tx) => deleteCategory(tx, { id: cat.id, updatedAt: cat.updatedAt }));
    assert.ok(result.tags.includes("campaigns"), result.tags.join(","));
    assert.match(result.note ?? "", /1 kampanya ve 1 kupon/);
    assert.ok(result.audit.some((a) => a.entity === "coupon") && result.audit.some((a) => a.entity === "campaign"));

    const [c2] = await db.select().from(schema.coupons).where(eq(schema.coupons.id, coupon.id));
    assert.equal(c2.categoryIds, null);
    assert.equal(c2.isActive, false, "a coupon whose whole scope disappeared is switched off, not widened to everything");
    const [k2] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaign.id));
    assert.equal(k2.categoryIds, null);
    assert.deepEqual(k2.productIds, [999_999], "product scope kept");
  });

  test("deleting a draft product: refused while linked, detached from coupon scopes, stale view refused", async () => {
    const created = await db.transaction((tx) => createProduct(tx, { name: `${PREFIX} silinecek`, type: "standard", categoryId: null }));
    const announcement = await linkingAnnouncement(`/urunler/${created.slug}`);
    let updatedAt = await stampOf(schema.products, created.id);
    await assert.rejects(db.transaction((tx) => deleteProduct(tx, { id: created.id, updatedAt })), failsWith("in_use", /bağlantı/));
    await db.delete(schema.announcements).where(eq(schema.announcements.id, announcement));

    const [coupon] = await db
      .insert(schema.coupons)
      .values({ code: "DAY3FIXTEST-PRODUCT", type: "percent", value: 10, productIds: [created.id, 999_998], isActive: true })
      .returning();
    await assert.rejects(
      db.transaction((tx) => deleteProduct(tx, { id: created.id, updatedAt: new Date(updatedAt.getTime() - 1000) })),
      failsWith("conflict"),
    );
    updatedAt = await stampOf(schema.products, created.id);
    const deleted = await db.transaction((tx) => deleteProduct(tx, { id: created.id, updatedAt }));
    assert.ok(deleted.audit.some((a) => a.entity === "coupon" && a.action === "update"));
    const [c2] = await db.select().from(schema.coupons).where(eq(schema.coupons.id, coupon.id));
    assert.deepEqual(c2.productIds, [999_998]);
    assert.equal(c2.isActive, true);
  });

  test("deleting a blog post from a stale view is a conflict", async () => {
    const [post] = await db
      .insert(schema.blogPosts)
      .values({ slug: `${PREFIX}-yazi`, title: { tr: `${PREFIX} yazı` }, status: "draft" })
      .returning();
    await assert.rejects(
      db.transaction((tx) => deleteBlogPost(tx, { id: post.id, updatedAt: new Date(post.updatedAt.getTime() - 1000) })),
      failsWith("conflict"),
    );
    await db.transaction((tx) => deleteBlogPost(tx, { id: post.id, updatedAt: post.updatedAt }));
    assert.equal((await db.select().from(schema.blogPosts).where(eq(schema.blogPosts.id, post.id))).length, 0);
  });
});

describe("legal pages keep their legal text", () => {
  test("removing, hiding, scheduling, narrowing or re-pointing the legal_document section is refused", async () => {
    const [page] = await db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.slug, "kvkk"));
    if (!page) return; // not seeded
    const data = await getPageEditorData(page.id);
    assert.ok(data);
    const state = data.page;
    const legalIndex = state.sections.findIndex((s) => s.type === "legal_document");
    assert.ok(legalIndex >= 0, "the kvkk page has a legal_document section");
    const withLegal = (patch: Record<string, unknown>) =>
      state.sections.map((s, i) => (i === legalIndex ? { ...s, ...patch } : s));
    const before = await db.select({ updatedAt: schema.pages.updatedAt }).from(schema.pages).where(eq(schema.pages.id, page.id));

    const attempts: [string, unknown][] = [
      ["removed", { ...state, sections: state.sections.filter((s) => s.type !== "legal_document") }],
      ["hidden", { ...state, sections: withLegal({ isVisible: false }) }],
      ["business only", { ...state, sections: withLegal({ audience: "business" }) }],
      ["scheduled", { ...state, sections: withLegal({ schedule: { startsAt: "2030-01-01T00:00:00.000Z", endsAt: null } }) }],
      ["other key", { ...state, sections: withLegal({ content: { ...(state.sections[legalIndex].content as object), key: "does-not-exist" } }) }],
    ];
    for (const [label, payload] of attempts) {
      const { result } = await executePanelAction(savePageDef, ACTOR, payload);
      assert.equal(result.ok, false, label);
      assert.equal((result as { code: string }).code, "invalid", label);
    }
    const afterRows = await db.select({ updatedAt: schema.pages.updatedAt }).from(schema.pages).where(eq(schema.pages.id, page.id));
    assert.equal(afterRows[0].updatedAt.getTime(), before[0].updatedAt.getTime(), "the page was not touched");
  });
});

describe("concurrency", () => {
  test("a media existence check locks the row against a concurrent delete (FOR SHARE vs FOR UPDATE)", async () => {
    const [m] = await db
      .insert(schema.media)
      .values({ storageKey: `${PREFIX}/probe.webp`, url: `/uploads/${PREFIX}/probe.webp`, mime: "image/webp", folder: PREFIX })
      .returning({ id: schema.media.id });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let checked!: () => void;
    const checkedSignal = new Promise<void>((resolve) => (checked = resolve));
    const saver = db.transaction(async (tx) => {
      await ensureMediaExist(tx, [m.id], "imageId");
      checked();
      await gate;
    });
    await checkedSignal;
    // A delete (deleteMediaRow locks FOR UPDATE first) cannot proceed while the save is open.
    await assert.rejects(
      db.transaction((tx) => tx.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.id, m.id)).for("update", { noWait: true })),
      (e: unknown) => /could not obtain lock|55P03/i.test(String((e as { code?: string; message?: string })?.code ?? "") + String((e as Error)?.message ?? "") + String((e as { cause?: { code?: string } })?.cause?.code ?? "")),
    );
    release();
    await saver;
  });

  test("two products saved at once cannot both take the same barcode", async () => {
    const a = await db.transaction((tx) => createProduct(tx, { name: `${PREFIX} barkod a`, type: "standard", categoryId: null }));
    const b = await db.transaction((tx) => createProduct(tx, { name: `${PREFIX} barkod b`, type: "standard", categoryId: null }));
    const payload = async (id: number) => {
      const s = await loadProductState(db, id);
      assert.ok(s);
      return productSaveSchema.parse({ ...s, variants: [{ ...s.variants[0], barcode: TEST_EAN, price: 1000 }] });
    };
    const [pa, pb] = await Promise.all([payload(a.id), payload(b.id)]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let saved!: () => void;
    const savedSignal = new Promise<void>((resolve) => (saved = resolve));
    const first = db.transaction(async (tx) => {
      await saveProduct(tx, pa);
      saved();
      await gate;
    });
    await savedSignal;
    const second = db.transaction((tx) => saveProduct(tx, pb));
    const outcome = second.then(
      () => "ok",
      (e: unknown) => e,
    );
    await new Promise((resolve) => setTimeout(resolve, 300)); // the second save now waits for the first
    release();
    await first;
    const result = await outcome;
    assert.ok(failsWith("invalid", /barkod/i)(result), `second save refused: ${String(result)}`);
    const holders = await db.select({ productId: schema.productVariants.productId }).from(schema.productVariants).where(eq(schema.productVariants.barcode, TEST_EAN));
    assert.deepEqual(holders.map((h) => h.productId), [a.id]);
  });
});

describe("audit and abuse limits", () => {
  test("an update whose before and after are empty writes no audit row", async () => {
    const { result } = await executePanelAction(
      { schema: z.object({}), run: async () => ({ audit: { action: "update", entity: "category", entityId: 1, before: {}, after: {} } }) },
      ACTOR,
      {},
    );
    assert.equal(result.ok, true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.userId, ACTOR_ID));
    assert.equal(rows.length, 0);
  });

  test("the contact form refuses new messages once the site-wide cap is reached (any IP, any e-mail)", async () => {
    const { state, messageId } = await submitContactForm(
      { name: "Site Cap", email: `${PREFIX}-cap@test.local`, phone: "", subject: "general", message: "Site geneli sınır testi mesajı.", locale: "tr", website: "" },
      { ip: "198.51.100.250", siteLimit: 0 },
    );
    assert.equal(messageId, null);
    assert.equal(state.status, "error");
    assert.equal(state.error, "too_many");
  });
});

describe("authentication", () => {
  test("an account locks after repeated wrong passwords, whatever the IP; the right password then waits too", async () => {
    const email = EMAIL("lock");
    const password = generateStaffPassword();
    await auth.api.createUser({ body: { email, password, name: "Day3 lock test", role: "staff", data: { emailVerified: true } } });
    const attempt = (pw: string, ip: string) =>
      auth.api.signInEmail({ body: { email, password: pw }, headers: new Headers({ origin: ORIGIN, "x-forwarded-for": ip }), asResponse: true });
    for (let i = 0; i < SIGN_IN_FAILURE_RULE.limit; i++) {
      const response = await attempt(`wrong-password-${i}`, `198.51.100.${i + 1}`);
      assert.equal(response.status, 401, `attempt ${i + 1}`);
    }
    // Over HTTP (the real route handler) the lock answers 429 with its own code…
    const http = (pw: string, ip: string) =>
      authPost(
        new Request(`${ORIGIN}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ email, password: pw }),
        }),
      );
    const locked = await http("wrong-again", "203.0.113.9");
    assert.equal(locked.status, 429);
    assert.equal(((await locked.json()) as { code?: string }).code, "TOO_MANY_FAILED_SIGN_INS");
    assert.equal((await http(password, "203.0.113.10")).status, 429, "locked even with the right password");
    // …and in-process calls are refused the same way.
    await assert.rejects(attempt(password, "203.0.113.12"), (e: unknown) => (e as { statusCode?: number }).statusCode === 429);
    await clearSignInFailures(dbLimitStore, email);
    assert.equal((await attempt(password, "203.0.113.11")).status, 200, "works once the lock is lifted");
  });

  test("the admin role cannot impersonate and the admin plugin routes are closed over HTTP", async () => {
    const adminPassword = generateStaffPassword();
    await auth.api.createUser({ body: { email: EMAIL("admin"), password: adminPassword, name: "Day3 admin", role: "admin", data: { emailVerified: true } } });
    const staff = await auth.api.createUser({
      body: { email: EMAIL("staff"), password: generateStaffPassword(), name: "Day3 staff", role: "staff", data: { emailVerified: true } },
    });
    const signIn = await auth.api.signInEmail({ body: { email: EMAIL("admin"), password: adminPassword }, headers: new Headers({ origin: ORIGIN }), asResponse: true });
    assert.equal(signIn.status, 200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => /session_token=/.test(c));
    assert.ok(cookie);
    const headers = new Headers({ cookie, origin: ORIGIN });

    await assert.rejects(
      auth.api.impersonateUser({ body: { userId: staff.user.id }, headers }),
      (e: unknown) => (e as { statusCode?: number }).statusCode === 403,
    );
    await assert.rejects(
      auth.api.removeUser({ body: { userId: staff.user.id }, headers }),
      (e: unknown) => (e as { statusCode?: number }).statusCode === 403,
    );

    for (const route of ["admin/set-role", "admin/impersonate-user", "admin/remove-user", "admin%2Fset-role"]) {
      const response = await authPost(
        new Request(`${ORIGIN}/api/auth/${route}`, {
          method: "POST",
          headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
          body: JSON.stringify({ userId: staff.user.id, role: "admin" }),
        }),
      );
      assert.equal(response.status, 404, route);
    }
    const [row] = await db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.id, staff.user.id));
    assert.equal(row.role, "staff", "the role did not change");
    const session = await authGet(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }));
    assert.equal(session.status, 200, "other auth routes still work");
  });
});
