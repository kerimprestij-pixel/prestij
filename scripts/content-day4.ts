/**
 * Day-4 content for EXISTING databases. A fresh database gets the same content from the seed
 * definitions (scripts/seed-data/**); the client's live database gets it from this script.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/content-day4.ts [--dry-run] [--only=requestForms,reviewSettings] [--allow-production]
 *
 * Rules (every step):
 *   - inserts only what is missing and never overwrites existing rows or anything the client edited;
 *   - the only updates allowed are values that are still exactly the previous seeded default (e.g. a CTA
 *     that pointed to the contact form before the form moved onto the page); anything else is skipped;
 *   - safe to run again: a second run reports nothing to do.
 * One transaction per step; `--dry-run` rolls every step back after printing what it would do.
 * Refuses NODE_ENV=production and a non-local DATABASE_URL unless `--allow-production` is passed.
 * It does not invalidate a running server's caches: restart the server afterwards (or save the page or
 * menu once in the panel).
 *
 * Owners: each area owns ONE exported function below and registers it in STEPS (shared file: edit only
 * your own function, with the Edit tool, after re-reading the file).
 *   requestForms        REQUESTS   quote_form on /kurumsal, sample_request_form on /numune, CTAs to them
 *   membershipLegalDoc  ACCOUNTS   legal document `membership` (draft for lawyer review) + /panel/yasal listing
 *   reviewSettings      REVIEWS    review settings / content
 */
import { and, asc, eq } from "drizzle-orm";
import { sectionMeta, type SectionType } from "@/components/sections/schemas";
import { legalDocuments, menus, pages, pageSections } from "@/db/schema";
import type { MenuItem } from "@/db/schema/site";
import {
  decideDefaultUpdate,
  emptyReport,
  getAt,
  lt as t,
  runContentSteps,
  setAt,
  SKIP_REASON,
  type ContentReport,
  type ContentStepDefinition,
  type Path,
} from "./seed-data/content-helpers";
import type { ScriptDb } from "./seed-data/db";
import { LEGAL_VERSION, MEMBERSHIP_LEGAL_DOCUMENT } from "./seed-data/legal";
import { LEGAL_PAGES, MENUS } from "./seed-data/site";
import { QUOTE_FORM_SECTION, SAMPLE_REQUEST_FORM_SECTION, SITE_PAGES } from "./seed-data/site-pages";

// The report types moved to scripts/seed-data/content-helpers.ts (day 5); re-exported for older imports.
export type { ContentReport, ContentStep } from "./seed-data/content-helpers";

// ---------------------------------------------------------------------------------------------
// REQUESTS: the quote and sample forms on /kurumsal and /numune

/** Where each form goes: right after the first section of `after` (same position, later id). */
const REQUEST_FORMS: { slug: "kurumsal" | "numune"; section: typeof QUOTE_FORM_SECTION; after: SectionType }[] = [
  { slug: "kurumsal", section: QUOTE_FORM_SECTION, after: "b2b_cta" },
  { slug: "numune", section: SAMPLE_REQUEST_FORM_SECTION, after: "scent_showcase" },
];

/**
 * Seeded values from before the forms existed (day 3: CTAs to /iletisim?konu=…, texts that send
 * visitors to the contact form). A value is replaced by the current seed value only while it is still
 * exactly this previous default.
 */
const PREVIOUS_DEFAULTS: { slug: "kurumsal" | "numune"; type: SectionType; path: Path; previous: unknown }[] = [
  { slug: "kurumsal", type: "hero", path: ["primaryCta", "href"], previous: "/iletisim?konu=teklif" },
  { slug: "kurumsal", type: "b2b_cta", path: ["cta", "href"], previous: "/iletisim?konu=teklif" },
  { slug: "kurumsal", type: "b2b_cta", path: ["secondaryCta", "href"], previous: "/numune" },
  {
    slug: "kurumsal",
    type: "faq",
    path: ["items", 0, "answer"],
    previous: t(
      "İletişim formunda konu olarak “Kurumsal teklif”i seçin; işletmenizin adını, ilgilendiğiniz kokuları ve boyları, yaklaşık aylık ihtiyacınızı yazın. Size özel teklifimizle dönüş yapalım. Dilerseniz bizi telefonla da arayabilirsiniz.",
      "Choose “Business quote” as the subject in our contact form and tell us your business name, the scents and sizes you are interested in and your approximate monthly needs. We will get back to you with a tailored quote. You are also welcome to call us.",
      "اختر «عرض سعر للشركات» موضوعًا في نموذج التواصل، واذكر اسم منشأتك والروائح والأحجام التي تهمّك واحتياجك الشهري التقريبي، وسنعود إليك بعرض مخصّص. ويمكنك أيضًا الاتصال بنا هاتفيًا.",
    ),
  },
  { slug: "kurumsal", type: "sample_cta", path: ["cta", "href"], previous: "/numune" },
  { slug: "numune", type: "hero", path: ["primaryCta", "href"], previous: "/iletisim?konu=numune" },
  {
    slug: "numune",
    type: "packaging",
    path: ["items", 0, "description"],
    previous: t(
      "İletişim formunda “Numune talebi” konusunu seçin; işletmenizi, denemek istediğiniz kokuları ve gönderim adresini yazın.",
      "Choose “Sample request” in the contact form and tell us about your business, the scents you would like to try and the delivery address.",
      "اختر «طلب عيّنات» في نموذج التواصل، وأخبرنا عن منشأتك والروائح التي ترغب في تجربتها وعنوان الإرسال.",
    ),
  },
  { slug: "numune", type: "packaging", path: ["items", 0, "cta", "href"], previous: "/iletisim?konu=numune" },
  {
    slug: "numune",
    type: "faq",
    path: ["items", 1, "answer"],
    previous: t(
      "Oteller, spa merkezleri, ofisler, restoranlar ve kafeler gibi işletmeler iletişim formundan numune isteyebilir. Kendiniz için alışveriş yapıyorsanız sepetinize ücretsiz numune ekleyebilirsiniz.",
      "Businesses such as hotels, spas, offices, restaurants and cafés can request samples through the contact form. When shopping for yourself, you can add free samples to your cart.",
      "يمكن للمنشآت مثل الفنادق ومراكز السبا والمكاتب والمطاعم والمقاهي طلب العيّنات عبر نموذج التواصل. أما عند التسوّق لنفسك، فيمكنك إضافة عيّنات مجانية إلى سلّتك.",
    ),
  },
  { slug: "numune", type: "sample_cta", path: ["cta", "href"], previous: "/iletisim?konu=numune" },
];

/** Footer links (menu `footer_corporate`, matched by href + Turkish label) and their previous hrefs. */
const PREVIOUS_MENU_LINKS: { menu: keyof typeof MENUS; labelTr: string; previous: string }[] = [
  { menu: "footer_corporate", labelTr: "Toplu Alım", previous: "/iletisim?konu=teklif" },
  { menu: "footer_corporate", labelTr: "Numune Talebi", previous: "/numune" },
];

export async function requestForms(db: ScriptDb): Promise<ContentReport> {
  const report = emptyReport();
  const now = new Date();

  for (const form of REQUEST_FORMS) {
    const [page] = await db.select({ id: pages.id }).from(pages).where(eq(pages.slug, form.slug)).limit(1);
    if (!page) {
      report.skipped.push(`/${form.slug}: page missing, ${form.section.type} not added`);
      continue;
    }
    const sections = await db
      .select({ id: pageSections.id, type: pageSections.type, position: pageSections.position })
      .from(pageSections)
      .where(eq(pageSections.pageId, page.id))
      .orderBy(asc(pageSections.position), asc(pageSections.id));
    if (sections.some((s) => s.type === form.section.type)) {
      report.skipped.push(`/${form.slug}: ${form.section.type} already present`);
      continue;
    }
    const content = sectionMeta[form.section.type].schema.parse(form.section.content);
    const anchor = sections.find((s) => s.type === form.after);
    // Same position as the anchor: the storefront and the panel order by (position, id), so the new row
    // lands right after it without renumbering the client's rows.
    const position = anchor ? anchor.position : sections.reduce((max, s) => Math.max(max, s.position + 1), 0);
    const [row] = await db
      .insert(pageSections)
      .values({ pageId: page.id, type: form.section.type, position, isVisible: true, content, audience: "all" })
      .returning({ id: pageSections.id });
    report.inserted.push(`page_sections #${row.id}: ${form.section.type} on /${form.slug} (position ${position}, after ${anchor ? `${form.after} #${anchor.id}` : "the last section"})`);
  }

  for (const change of PREVIOUS_DEFAULTS) {
    const seedPage = SITE_PAGES.find((p) => p.slug === change.slug);
    const next = getAt(seedPage?.sections.find((s) => s.type === change.type)?.content, change.path);
    const where = `/${change.slug} ${change.type}.${change.path.join(".")}`;
    if (next === undefined) {
      report.skipped.push(`${where}: no seed value`);
      continue;
    }
    const [section] = await db
      .select({ id: pageSections.id, content: pageSections.content })
      .from(pageSections)
      .innerJoin(pages, eq(pages.id, pageSections.pageId))
      .where(and(eq(pages.slug, change.slug), eq(pageSections.type, change.type)))
      .orderBy(asc(pageSections.position), asc(pageSections.id))
      .limit(1);
    if (!section) {
      report.skipped.push(`${where}: section missing`);
      continue;
    }
    const decision = decideDefaultUpdate(getAt(section.content, change.path), next, change.previous);
    if (decision !== "update") {
      report.skipped.push(`${where}: ${SKIP_REASON[decision]}`);
      continue;
    }
    const content = setAt(section.content, change.path, next);
    if (!sectionMeta[change.type].schema.safeParse(content).success) {
      report.skipped.push(`${where}: the update would not validate, left as is`);
      continue;
    }
    await db.update(pageSections).set({ content, updatedAt: now }).where(eq(pageSections.id, section.id));
    report.updated.push(`page_sections #${section.id}: ${change.type}.${change.path.join(".")} on /${change.slug} → ${typeof next === "string" ? next : "new text (tr/en/ar)"}`);
  }

  for (const link of PREVIOUS_MENU_LINKS) {
    const next = MENUS[link.menu].find((i) => i.label.tr === link.labelTr)?.href;
    const [menu] = await db.select({ id: menus.id, items: menus.items }).from(menus).where(eq(menus.key, link.menu)).limit(1);
    const where = `menu ${link.menu} “${link.labelTr}”`;
    if (!menu || !next) {
      report.skipped.push(`${where}: menu or seed link missing`);
      continue;
    }
    const index = menu.items.findIndex((i) => i.label?.tr === link.labelTr && i.href === link.previous);
    if (index < 0) {
      report.skipped.push(`${where}: ${menu.items.some((i) => i.label?.tr === link.labelTr && i.href === next) ? "already up to date" : "edited in the panel, left as is"}`);
      continue;
    }
    const items: MenuItem[] = menu.items.map((item, i) => (i === index ? { ...item, href: next } : item));
    await db.update(menus).set({ items, updatedAt: now }).where(eq(menus.id, menu.id));
    report.updated.push(`menus #${menu.id}: ${link.menu} “${link.labelTr}” → ${next}`);
  }

  return report;
}

// ---------------------------------------------------------------------------------------------
// ACCOUNTS: the membership agreement (legal document key `membership`). Filled in by ACCOUNTS.

/**
 * Adds the membership agreement (/hesap/kayit requires it): the legal document `membership` (draft,
 * version LEGAL_VERSION, marked for lawyer review; listed on /panel/yasal like the others) and its
 * page /sayfa/uyelik-sozlesmesi with one `legal_document` section. Each part only when missing; an
 * existing document or page (also one the client created or edited) is never touched.
 */
export async function membershipLegalDoc(db: ScriptDb): Promise<ContentReport> {
  const report = emptyReport();
  const doc = MEMBERSHIP_LEGAL_DOCUMENT;
  const page = LEGAL_PAGES.find((p) => p.key === doc.key);

  const [existingDoc] = await db.select({ id: legalDocuments.id }).from(legalDocuments).where(eq(legalDocuments.key, doc.key)).limit(1);
  if (existingDoc) report.skipped.push(`legal document "${doc.key}" already exists (#${existingDoc.id})`);
  else {
    const [row] = await db
      .insert(legalDocuments)
      .values({ key: doc.key, version: LEGAL_VERSION, title: doc.title, body: doc.body, isCurrent: true })
      .returning({ id: legalDocuments.id });
    report.inserted.push(`legal_documents #${row.id}: ${doc.key} (${LEGAL_VERSION}, draft for lawyer review)`);
  }

  if (!page) {
    report.skipped.push(`no seeded page for "${doc.key}"`);
    return report;
  }
  const [existingPage] = await db.select({ id: pages.id }).from(pages).where(eq(pages.slug, page.slug)).limit(1);
  if (existingPage) {
    report.skipped.push(`/sayfa/${page.slug} already exists (#${existingPage.id})`);
    return report;
  }
  const [created] = await db
    .insert(pages)
    .values({ slug: page.slug, kind: "legal", title: doc.title, seo: { title: doc.title }, isPublished: true })
    .returning({ id: pages.id });
  const content = sectionMeta.legal_document.schema.parse({ key: doc.key });
  const [section] = await db.insert(pageSections).values({ pageId: created.id, type: "legal_document", position: 0, content }).returning({ id: pageSections.id });
  report.inserted.push(`pages #${created.id}: /sayfa/${page.slug} (legal) with page_sections #${section.id} legal_document "${doc.key}"`);
  return report;
}

// ---------------------------------------------------------------------------------------------
// REVIEWS: nothing to seed. settings.reviews works from its schema defaults (enabled, guest links on,
// request 7 days after delivery, min. 10 characters) until the admin saves /panel/ayarlar/yorumlar, so
// no settings row is written (a stored row would freeze today's defaults). The review_request e-mail
// texts live in the message dictionaries; reviews themselves come from customers.

export async function reviewSettings(db: ScriptDb): Promise<ContentReport> {
  void db;
  return { ...emptyReport(), skipped: ["settings.reviews: schema defaults are used (no row needed)"] };
}

// ---------------------------------------------------------------------------------------------
// Runner

/** Every step, in run order. Owners add their own line. */
export const STEPS: ContentStepDefinition[] = [
  { key: "requestForms", owner: "REQUESTS", run: requestForms },
  { key: "membershipLegalDoc", owner: "ACCOUNTS", run: membershipLegalDoc },
  { key: "reviewSettings", owner: "REVIEWS", run: reviewSettings },
];

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  await runContentSteps({ title: "Day-4 content", steps: STEPS, argv });
}

// Run when executed directly (tests import the step functions without running anything).
if (/content-day4\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
