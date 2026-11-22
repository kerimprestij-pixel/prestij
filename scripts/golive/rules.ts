// Go-live data path, pure part (no database, no Next APIs, no environment): which target URLs the
// scripts accept, which tables are copied and in which order, the "showcase" profile (Level 1 of
// docs/GO-LIVE.md: site live, no orders), the "sales" profile (site live, orders by kapıda ödeme and/or
// havale; card later; free samples off until ÜTS unless --keep-samples) with its readiness rules (the seller and
// legal-placeholder rules are the panel's own: src/lib/settings/seller.ts, src/lib/panel/legal/schemas.ts), the
// announcement rule of both profiles, and the production admin's e-mail/password rules.
// Used by scripts/golive/{copy-content,copy-run,verify-target,create-admin}.ts; unit-tested in
// tests/unit/golive-data-*.test.ts, tests/unit/salesready-impl-b.test.ts and tests/unit/salesready-fix.test.ts.
import { localizePath } from "@/i18n/paths";
import { isDraftLegalVersion } from "@/lib/panel/legal/draft";
import { findMissingFields } from "@/lib/panel/legal/schemas";
import { DAY1_PLACEHOLDER_PRICES, formatKurusTl, type PlaceholderPriceCheck } from "@/lib/pricing/placeholder-prices";
import { missingSellerFieldKeys, SELLER_FIELD_NAMES } from "@/lib/settings/seller";
import { parseSettings, settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/types";
import { isUsableBankAccount } from "@/lib/validation/tr";
import { WHEEL_TERMS_PAGE_SLUG } from "@/lib/wheel/types";

// ---------------------------------------------------------------------------------------------------
// Tables

/**
 * The owner's content: copied from the local database to the target, ids included. Every table of
 * src/db/schema is either here or in NEVER_COPY_TABLES (a unit test enforces it, so a new table must
 * be classified before it can ship).
 */
export const CONTENT_TABLES = [
  "settings",
  "themes",
  "media",
  "categories",
  "products",
  "product_options",
  "product_option_values",
  "product_variants",
  "variant_option_values",
  "product_media",
  "product_relations",
  "bundle_items",
  "customer_groups",
  "group_prices",
  "tier_prices",
  "subscription_plans",
  "pages",
  "page_sections",
  "menus",
  "announcements",
  "blog_posts",
  "legal_documents",
  "redirects",
  "ui_strings",
  "campaigns",
] as const;
export type ContentTable = (typeof CONTENT_TABLES)[number];

/**
 * Never copied: accounts and sessions (Better Auth), carts and orders, customer requests, consent
 * records, local test history (coupons and wheel spins belong to local accounts; reviews and their
 * product ratings come from orders), the local mail log, job runs and the panel audit log.
 */
export const NEVER_COPY_TABLES = [
  "user",
  "account",
  "session",
  "verification",
  "rate_limit",
  "rate_limit_counters",
  "carts",
  "cart_items",
  "orders",
  "order_items",
  "order_events",
  "payments",
  "coupons",
  "wheel_spins",
  "email_messages",
  "email_campaigns",
  "job_runs",
  "audit_log",
  "newsletter_subscribers",
  "contact_messages",
  "quote_requests",
  "sample_requests",
  "reviews",
  "favorites",
  "companies",
  "subscriptions",
  "addresses",
] as const;

/** Staff accounts the verifier accepts in `user` (created by scripts/golive/create-admin.ts). */
export const ALLOWED_TARGET_USER_ROLES = ["admin"] as const;

/**
 * Markers of local test rows (e-mails @test.local, day6-test- / DAY6TEST / golive-test prefixes).
 * A PostgreSQL regular expression, used case-insensitively (`~*`) on whole rows.
 */
export const TEST_MARKER_SQL_PATTERN = "@test\\.local|day6-test-|day6test|golive-test";

/**
 * Values that must never reach production settings (local URLs and test domains). A PostgreSQL `~*`
 * pattern, always passed as a query parameter (`\y` is PostgreSQL's word boundary; `\b` would be a backspace).
 */
export const LOCAL_URL_SQL_PATTERN = "localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]|\\.local\\y";

/** A foreign key between two public tables (pg_constraint), child → parent. */
export type ForeignKeyEdge = { child: string; parent: string; constraint?: string; columns?: string[] };

/**
 * Orders `tables` so that every parent comes before its children. Ties keep the input order, self
 * references are ignored (one COPY checks them at statement end), and edges to tables outside the
 * list are ignored here (see externalParents). Throws on a cycle between different tables.
 */
export function orderParentsFirst(tables: readonly string[], edges: readonly ForeignKeyEdge[]): string[] {
  const wanted = new Set(tables);
  const parentsOf = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of edges) {
    if (child === parent || !wanted.has(child) || !wanted.has(parent)) continue;
    parentsOf.get(child)!.add(parent);
  }
  const placed = new Set<string>();
  const order: string[] = [];
  while (order.length < tables.length) {
    const next = tables.find((t) => !placed.has(t) && [...parentsOf.get(t)!].every((p) => placed.has(p)));
    if (!next) {
      const stuck = tables.filter((t) => !placed.has(t));
      throw new Error(`foreign keys form a cycle between: ${stuck.join(", ")}`);
    }
    placed.add(next);
    order.push(next);
  }
  return order;
}

/** Foreign keys from a listed table to a table that is not copied (its rows would fail on the target). */
export function externalParents(tables: readonly string[], edges: readonly ForeignKeyEdge[]): ForeignKeyEdge[] {
  const wanted = new Set(tables);
  return edges.filter((e) => wanted.has(e.child) && !wanted.has(e.parent));
}

/** A column of a public table (pg_attribute). */
export type Column = { name: string; type: string; notNull: boolean; hasDefault: boolean };

/**
 * Why the target's columns cannot take the source's rows, or null. The copy names the source columns
 * on both sides, so the physical order may differ; the target may have extra columns only when they
 * are nullable or have a default (a newer migration than the local database).
 */
export function columnMismatch(source: Column[] | undefined, target: Column[] | undefined): string | null {
  if (!source || !target) return "table missing";
  const byName = new Map(target.map((c) => [c.name, c]));
  for (const c of source) {
    const t = byName.get(c.name);
    if (!t) return `column ${c.name} is missing on the target`;
    if (t.type !== c.type) return `column ${c.name} is ${c.type} locally but ${t.type} on the target`;
  }
  const known = new Set(source.map((c) => c.name));
  const blocking = target.filter((c) => !known.has(c.name) && c.notNull && !c.hasDefault);
  if (blocking.length) return `target column(s) ${blocking.map((c) => c.name).join(", ")} are NOT NULL without default and missing locally`;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Target and source URLs

export type TargetKind = "production" | "rehearsal";
export type UrlCheck =
  | { ok: true; kind: TargetKind; host: string; port: number; database: string }
  | { ok: false; reason: string };

/** Local rehearsal databases must carry this prefix (created from template0, dropped afterwards). */
export const REHEARSAL_DB_PREFIX = "prestij_golive_";
const REHEARSAL_DB_PATTERN = /^prestij_golive_[a-z0-9_]{1,40}$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
/** Supabase's connection pooler (Supavisor): aws-0-eu-central-1.pooler.supabase.com and the like. */
const POOLER_HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.pooler\.supabase\.com$/;
/** Session pooler user: postgres.<project ref>. */
const POOLER_USER_PATTERN = /^postgres\.[a-z0-9]{8,40}$/;
const SESSION_POOLER_PORT = 5432;
const TRANSACTION_POOLER_PORT = 6543;

function refuse(reason: string): UrlCheck {
  return { ok: false, reason };
}

function parsePostgresUrl(raw: string): URL | string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "it is not a valid URL";
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return "it must start with postgresql://";
  return url;
}

function databaseOf(url: URL): string {
  try {
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return url.pathname.replace(/^\//, "");
  }
}

/**
 * Query parameters postgres.js turns into connection settings: `host`/`port` replace the URL's own, and every
 * other unknown key (database, user, options, …) goes into the startup packet AFTER the path's database and
 * the URL's user, so `…/prestij_golive_x?database=prestij` would connect to `prestij`. A local URL therefore
 * carries no parameter at all, except one harmless `sslmode=disable`.
 */
function localUrlParamProblem(url: URL, label: string): string | null {
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) return null;
  if (entries.length === 1 && entries[0][0] === "sslmode" && entries[0][1] === "disable") return null;
  const names = [...new Set(entries.map(([k]) => k))].join(", ");
  return `${label} must not carry URL parameters (${names}): postgres.js would let them change the host, port, database or user the guard checked. Remove everything from "?" on.`;
}

/**
 * The target rule: production = Supabase session pooler (`*.pooler.supabase.com:5432/postgres`, user
 * `postgres.<ref>`, exactly `?sslmode=require` and no other parameter); rehearsal = 127.0.0.1 or
 * localhost with a database named prestij_golive_* and no URL parameter (see localUrlParamProblem).
 * Everything else is refused, the owner's local database `prestij` in particular. The reason never
 * contains the URL or its password.
 */
export function checkTargetUrl(raw: string | undefined): UrlCheck {
  if (!raw || !raw.trim()) return refuse("TARGET_DATABASE_URL is not set.");
  const url = parsePostgresUrl(raw);
  if (typeof url === "string") return refuse(`TARGET_DATABASE_URL is refused: ${url}.`);
  const host = url.hostname.toLowerCase();
  const port = url.port ? Number(url.port) : SESSION_POOLER_PORT;
  const database = databaseOf(url);
  const params = [...url.searchParams.keys()];

  if (LOCAL_HOSTS.has(host)) {
    if (!REHEARSAL_DB_PATTERN.test(database)) {
      return refuse(
        `a local target must be a rehearsal database named ${REHEARSAL_DB_PREFIX}<name> (lower-case letters, digits, _); ` +
          `"${database}" is refused (the owner's database is never a target).`,
      );
    }
    const paramProblem = localUrlParamProblem(url, "a rehearsal TARGET_DATABASE_URL");
    if (paramProblem) return refuse(paramProblem);
    return { ok: true, kind: "rehearsal", host, port, database };
  }

  if (POOLER_HOST_PATTERN.test(host)) {
    const sslmodes = url.searchParams.getAll("sslmode");
    if (sslmodes.length !== 1 || sslmodes[0] !== "require") {
      return refuse(
        "a Supabase URL must end with ?sslmode=require (postgres.js: encrypted, no CA check; 'no-verify' is only for drizzle-kit and fails here).",
      );
    }
    const extra = params.filter((p) => p !== "sslmode");
    if (extra.length > 0) {
      return refuse(`remove the extra URL parameter(s) ${extra.join(", ")}: paste the plain URI and add only ?sslmode=require.`);
    }
    if (port === TRANSACTION_POOLER_PORT) {
      return refuse("port 6543 is the transaction pooler (Vercel only). Use the Session pooler URI (port 5432).");
    }
    if (port !== SESSION_POOLER_PORT) return refuse(`port ${port} is not the Supabase session pooler port (5432).`);
    if (database !== "postgres") return refuse(`the Supabase database is "postgres", not "${database}".`);
    let user = url.username;
    let password = url.password;
    try {
      user = decodeURIComponent(user);
      password = decodeURIComponent(password);
    } catch {
      return refuse("the user or password part of the URI is not correctly encoded.");
    }
    if (!POOLER_USER_PATTERN.test(user)) {
      return refuse("the session pooler user must be postgres.<project ref> (copy the URI from Supabase > Connect > Session pooler).");
    }
    if (!password || /YOUR[-_ ]?PASSWORD/i.test(password)) {
      return refuse("the URI has no database password (replace the [YOUR-PASSWORD] placeholder).");
    }
    if (/^\[.*\]$/.test(password)) {
      return refuse("remove the square brackets around the password (they belong to the [YOUR-PASSWORD] placeholder, not to the password).");
    }
    return { ok: true, kind: "production", host, port, database };
  }

  if (host.endsWith(".supabase.co") || host.endsWith(".supabase.com")) {
    return refuse("use the Session pooler URI (…pooler.supabase.com:5432); the direct host db.<ref>.supabase.co is IPv6-only.");
  }
  return refuse(
    `only *.pooler.supabase.com (production) or 127.0.0.1/localhost with a ${REHEARSAL_DB_PREFIX}* database (rehearsal) are accepted.`,
  );
}

/**
 * The local source: 127.0.0.1 or localhost only (the owner's database, opened read-only), no URL parameter.
 * A rehearsal database (prestij_golive_*) is never the source of a production copy; `rehearsalTarget` (the
 * target is itself a local rehearsal database) allows one, so the sales profile can be rehearsed end to end
 * from a rehearsal copy patched with fake-but-valid data (docs/GO-LIVE.md "Rehearsal").
 */
export function checkSourceUrl(raw: string, options: { rehearsalTarget?: boolean } = {}): UrlCheck {
  const url = parsePostgresUrl(raw);
  if (typeof url === "string") return refuse(`SOURCE_DATABASE_URL is refused: ${url}.`);
  const host = url.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return refuse("the source must be the local database (127.0.0.1 or localhost).");
  const database = databaseOf(url);
  if (database.startsWith(REHEARSAL_DB_PREFIX) && !(options.rehearsalTarget && REHEARSAL_DB_PATTERN.test(database))) {
    return refuse("a rehearsal database cannot be the source (only of another local rehearsal database).");
  }
  const paramProblem = localUrlParamProblem(url, "SOURCE_DATABASE_URL");
  if (paramProblem) return refuse(paramProblem);
  return { ok: true, kind: "rehearsal", host, port: url.port ? Number(url.port) : 5432, database };
}

/** True when both checks point at the same server and database (127.0.0.1 and localhost count as one). */
export function sameDatabase(a: UrlCheck, b: UrlCheck): boolean {
  if (!a.ok || !b.ok) return false;
  const norm = (h: string) => (LOCAL_HOSTS.has(h) ? "local" : h);
  return norm(a.host) === norm(b.host) && a.port === b.port && a.database === b.database;
}

/** A printable description without user or password. */
export function describeTarget(check: UrlCheck): string {
  return check.ok ? `${check.kind} ${check.host}:${check.port}/${check.database}` : "(invalid)";
}

/** Entry tags of drizzle/meta/_journal.json (the migrations the repo ships). */
export function journalTags(journal: unknown): string[] {
  const entries = (journal as { entries?: unknown })?.entries;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("drizzle/meta/_journal.json has no entries.");
  return entries.map((e, i) => {
    const tag = (e as { tag?: unknown })?.tag;
    if (typeof tag !== "string" || !tag) throw new Error(`drizzle/meta/_journal.json entry ${i} has no tag.`);
    return tag;
  });
}

// ---------------------------------------------------------------------------------------------------
// Showcase profile (Level 1: the site is live, no order can be placed)

type SettingsPatch<K extends SettingsKey> = (value: Settings<K>) => Settings<K>;

/**
 * Settings changed by --profile=showcase, keyed by the real settings keys of src/lib/settings/types.ts.
 * Payment methods off (src/lib/orders/place.ts refuses unavailable methods), wheel and its reminder
 * mail off, newsletter sign-up off (until İYS), samples off (until ÜTS), subscriptions off.
 */
export const SHOWCASE_SETTINGS: { [K in SettingsKey]?: SettingsPatch<K> } = {
  giftWheel: (v) => ({ ...v, enabled: false, reminderEnabled: false }),
  payments: (v) => ({
    ...v,
    card: { ...v.card, enabled: false },
    bankTransfer: { ...v.bankTransfer, enabled: false },
    cashOnDelivery: { ...v.cashOnDelivery, enabled: false },
  }),
  newsletter: (v) => ({ ...v, enabled: false, popupEnabled: false }),
  samples: (v) => ({ ...v, cartSampleEnabled: false, requestFormEnabled: false }),
  subscriptions: (v) => ({ ...v, enabled: false }),
};

/** Pages unpublished by the profile (pages.is_published = false: /sayfa/<slug> answers 404 and leaves the sitemap). */
export const SHOWCASE_UNPUBLISH_PAGE_SLUGS: readonly string[] = [WHEEL_TERMS_PAGE_SLUG];

/**
 * Page sections hidden by the profile. The "newsletter" section renders its sign-up form whatever
 * settings.newsletter.enabled says (src/components/sections/Newsletter.tsx); with the newsletter off
 * every submission would fail, so the band is hidden until İYS.
 */
export const SHOWCASE_HIDE_SECTION_TYPES: readonly string[] = ["newsletter"];

/** The flags the verifier expects after the showcase profile (dotted paths into the parsed settings). */
export const SHOWCASE_EXPECTED_FLAGS: readonly { key: SettingsKey; path: string; expected: boolean }[] = [
  { key: "giftWheel", path: "enabled", expected: false },
  { key: "giftWheel", path: "reminderEnabled", expected: false },
  { key: "payments", path: "card.enabled", expected: false },
  { key: "payments", path: "bankTransfer.enabled", expected: false },
  { key: "payments", path: "cashOnDelivery.enabled", expected: false },
  { key: "newsletter", path: "enabled", expected: false },
  { key: "newsletter", path: "popupEnabled", expected: false },
  { key: "samples", path: "cartSampleEnabled", expected: false },
  { key: "samples", path: "requestFormEnabled", expected: false },
  { key: "subscriptions", path: "enabled", expected: false },
];

// ---------------------------------------------------------------------------------------------------
// Sales profile (orders by kapıda ödeme and/or havale; card payments stay off until PayTR is set up)

/**
 * Settings changed by --profile=sales. Card payments off (until PayTR), wheel and its reminder mail off (until
 * the lawyer answers), newsletter sign-up off (until İYS), free samples off (cart samples and the /numune request
 * form, until ÜTS: FIX F1; `--keep-samples` keeps them as configured once ÜTS is confirmed, see resolveProfile),
 * subscriptions off. Kapıda ödeme and havale stay exactly as the owner configured them locally.
 */
export const SALES_SETTINGS: { [K in SettingsKey]?: SettingsPatch<K> } = {
  giftWheel: (v) => ({ ...v, enabled: false, reminderEnabled: false }),
  payments: (v) => ({ ...v, card: { ...v.card, enabled: false } }),
  newsletter: (v) => ({ ...v, enabled: false, popupEnabled: false }),
  samples: (v) => ({ ...v, cartSampleEnabled: false, requestFormEnabled: false }),
  subscriptions: (v) => ({ ...v, enabled: false }),
};

/** The flags the verifier expects after the sales profile (the samples pair is dropped with --keep-samples). */
export const SALES_EXPECTED_FLAGS: readonly { key: SettingsKey; path: string; expected: boolean }[] = [
  { key: "giftWheel", path: "enabled", expected: false },
  { key: "giftWheel", path: "reminderEnabled", expected: false },
  { key: "payments", path: "card.enabled", expected: false },
  { key: "newsletter", path: "enabled", expected: false },
  { key: "newsletter", path: "popupEnabled", expected: false },
  { key: "samples", path: "cartSampleEnabled", expected: false },
  { key: "samples", path: "requestFormEnabled", expected: false },
  { key: "subscriptions", path: "enabled", expected: false },
];

export const PROFILE_NAMES = ["showcase", "sales"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

export type GoLiveProfile = {
  name: ProfileName;
  settings: { [K in SettingsKey]?: SettingsPatch<K> };
  unpublishPageSlugs: readonly string[];
  hideSectionTypes: readonly string[];
  expectedFlags: readonly { key: SettingsKey; path: string; expected: boolean }[];
  /** --keep-samples (sales only, ÜTS confirmed): settings.samples is left as configured locally. */
  keepsSamples?: boolean;
};

/** Both profiles unpublish the wheel terms page and hide the newsletter band; they differ in the settings. */
export const PROFILES: Record<ProfileName, GoLiveProfile> = {
  showcase: {
    name: "showcase",
    settings: SHOWCASE_SETTINGS,
    unpublishPageSlugs: SHOWCASE_UNPUBLISH_PAGE_SLUGS,
    hideSectionTypes: SHOWCASE_HIDE_SECTION_TYPES,
    expectedFlags: SHOWCASE_EXPECTED_FLAGS,
  },
  sales: {
    name: "sales",
    settings: SALES_SETTINGS,
    unpublishPageSlugs: SHOWCASE_UNPUBLISH_PAGE_SLUGS,
    hideSectionTypes: SHOWCASE_HIDE_SECTION_TYPES,
    expectedFlags: SALES_EXPECTED_FLAGS,
  },
};

export function isProfileName(value: unknown): value is ProfileName {
  return typeof value === "string" && (PROFILE_NAMES as readonly string[]).includes(value);
}

/** Options of both scripts that change what a profile does or expects. */
export type ProfileOptions = { keepSamples?: boolean };

/**
 * The profile copy-content applies and verify-target expects. `keepSamples` (the --keep-samples flag: ÜTS is
 * confirmed) is accepted only with the sales profile: it leaves settings.samples untouched and drops the two
 * samples flags from the expected list. Everything else is PROFILES[name] unchanged.
 */
export function resolveProfile(name: ProfileName, options: ProfileOptions = {}): GoLiveProfile {
  const base = PROFILES[name];
  if (!options.keepSamples) return base;
  if (name !== "sales") throw new Error("--keep-samples belongs to --profile=sales.");
  const settings = { ...base.settings };
  delete settings.samples;
  return { ...base, settings, expectedFlags: base.expectedFlags.filter((f) => f.key !== "samples"), keepsSamples: true };
}

/**
 * A copy into PRODUCTION must name a profile (FIX F6): a plain copy would carry every local switch as it is (card in
 * test mode, the wheel with draft terms, the newsletter without İYS, free samples) and run no sales check. Local
 * rehearsal targets keep the plain copy. The reason for a refusal, or null.
 */
export function productionProfileProblem(kind: TargetKind, profile: ProfileName | null): string | null {
  return kind === "production" && !profile
    ? "a production copy needs a profile: add --profile=sales (orders by kapıda ödeme/havale; refused while the shop is not ready) or --profile=showcase (no orders)."
    : null;
}

/**
 * Validates the script flags that only make sense with --profile=sales (both scripts call it): the reason
 * for a refusal, or null.
 */
export function salesOnlyFlagProblem(profile: ProfileName | null, flags: { allowPrices?: boolean; keepSamples?: boolean; allowLegalBrackets?: boolean }): string | null {
  if (profile === "sales") return null;
  const used = [
    flags.allowPrices ? "--allow-prices" : null,
    flags.keepSamples ? "--keep-samples" : null,
    flags.allowLegalBrackets ? "--allow-legal-brackets" : null,
  ].filter((f): f is string => f !== null);
  return used.length ? `${used.join(", ")} belong(s) to --profile=sales (yalnızca satış profiliyle kullanılır).` : null;
}

// ---------------------------------------------------------------------------------------------------
// Announcements that link to a feature the profile switches off (both profiles deactivate them)

/** Features an announcement can point at, and what "off" means for each (from the parsed settings). */
export type AnnouncementFeature = "samples" | "giftWheel" | "newsletter" | "subscriptions";

export type FeatureSettings = {
  samples: Pick<Settings<"samples">, "cartSampleEnabled" | "requestFormEnabled">;
  giftWheel: Pick<Settings<"giftWheel">, "enabled">;
  newsletter: Pick<Settings<"newsletter">, "enabled">;
  subscriptions: Pick<Settings<"subscriptions">, "enabled">;
};

/** The settings keys the feature rule reads. */
export const FEATURE_SETTINGS_KEYS = ["samples", "giftWheel", "newsletter", "subscriptions"] as const satisfies readonly SettingsKey[];

/**
 * Features that are off: samples when neither the cart samples nor the /numune request form are on (the
 * /numune page then has nothing to offer), the wheel, the newsletter and subscriptions when switched off.
 */
export function featuresOff(s: FeatureSettings): Set<AnnouncementFeature> {
  const off = new Set<AnnouncementFeature>();
  if (!s.samples.cartSampleEnabled && !s.samples.requestFormEnabled) off.add("samples");
  if (!s.giftWheel.enabled) off.add("giftWheel");
  if (!s.newsletter.enabled) off.add("newsletter");
  if (!s.subscriptions.enabled) off.add("subscriptions");
  return off;
}

const NEWSLETTER_HASHES = new Set(["#bulten", "#e-bulten", "#newsletter"]);
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Which feature a storefront link points at, or null. Relative links only (an absolute URL may be another
 * site; the panel stores storefront links as paths): the path is canonicalized to the Turkish folders, so
 * /numune, /tr/numune, /en/samples and /ar/samples all count as the samples page.
 * - samples: /numune · gift wheel: the wheel terms page /sayfa/${WHEEL_TERMS_PAGE_SLUG} or any link naming
 *   "hediye-carki" · newsletter: /bulten… or the #bulten / #e-bulten / #newsletter anchors · subscriptions:
 *   /hesap/abonelikler.
 */
export function announcementFeature(href: string | null | undefined): AnnouncementFeature | null {
  const raw = (href ?? "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return null;
  const hashAt = raw.indexOf("#");
  const hash = hashAt >= 0 ? raw.slice(hashAt).toLowerCase() : "";
  const pathPart = raw.split(/[?#]/)[0] ?? "";
  let path = "";
  if (pathPart) {
    const tr = localizePath("tr", pathPart.startsWith("/") ? pathPart : `/${pathPart}`);
    path = (tr.replace(/^\/tr(?=\/|$)/, "").replace(/\/+$/, "") || "/").toLowerCase();
  }
  if (under(path, "/numune")) return "samples";
  if (path === `/sayfa/${WHEEL_TERMS_PAGE_SLUG}` || raw.toLowerCase().includes("hediye-carki")) return "giftWheel";
  if (under(path, "/bulten") || NEWSLETTER_HASHES.has(hash)) return "newsletter";
  if (under(path, "/hesap/abonelikler")) return "subscriptions";
  return null;
}

export type AnnouncementRow = { id: number; href: string | null; isActive: boolean; text?: string | null };

/** Active announcements whose link points at a feature in `off` (to deactivate, and to print). */
export function announcementsToDeactivate(rows: readonly AnnouncementRow[], off: ReadonlySet<AnnouncementFeature>) {
  return rows
    .filter((r) => r.isActive)
    .map((r) => ({ ...r, feature: announcementFeature(r.href) }))
    .filter((r): r is AnnouncementRow & { feature: AnnouncementFeature } => r.feature !== null && off.has(r.feature));
}

/**
 * The feature settings as the target will have them after a profile: the profile's patched documents where it
 * changes the key, otherwise the stored document parsed the way the storefront parses it.
 */
export function featureSettingsAfter(changes: readonly SettingsChange[], stored: Partial<Record<SettingsKey, unknown>>): FeatureSettings {
  const changed = new Map(changes.map((c) => [c.key, c.value]));
  const read = <K extends (typeof FEATURE_SETTINGS_KEYS)[number]>(key: K): Settings<K> => parseSettings(key, changed.has(key) ? changed.get(key) : stored[key]);
  return { samples: read("samples"), giftWheel: read("giftWheel"), newsletter: read("newsletter"), subscriptions: read("subscriptions") };
}

// ---------------------------------------------------------------------------------------------------
// Sales readiness: what --profile=sales refuses (before any write, and again inside the copy transaction on what
// was copied) and verify-target --profile=sales fails on

/** A refusal or warning in both languages (the owner reads Turkish, the logs stay readable in English). */
export type ReadinessProblem = { code: string; tr: string; en: string };

/** Legal texts that must be lawyer-approved (current version not "taslak…", no [placeholder] left) before sales. */
export const SALES_LEGAL_KEYS = ["pre_information", "distance_sales", "kvkk", "returns", "cookies", "membership"] as const;
export type SalesLegalKey = (typeof SALES_LEGAL_KEYS)[number];

/** The Turkish titles the owner sees in Yasal Metinler (scripts/seed-data/legal.ts), for the Turkish messages. */
export const SALES_LEGAL_TITLES: Record<SalesLegalKey, string> = {
  pre_information: "Ön Bilgilendirme Formu",
  distance_sales: "Mesafeli Satış Sözleşmesi",
  kvkk: "KVKK Aydınlatma Metni",
  returns: "İade ve Değişim Koşulları",
  cookies: "Çerez Politikası",
  membership: "Üyelik Sözleşmesi",
};

/** "Ön Bilgilendirme Formu" for a sales legal key (the key itself for anything else). */
export function legalTitle(key: string): string {
  return (SALES_LEGAL_TITLES as Record<string, string>)[key] ?? key;
}

/** The draft notice the legal editor stores in front of a draft body (src/lib/panel/legal/schemas.ts). */
const LEGAL_DRAFT_NOTICE = /<aside\b[^>]*\blegal-draft\b/i;

/**
 * The distinct [placeholders] left in a legal body, over every language of it. The SAME rule as the legal
 * editor's "Doldurulacak yerler" list (findMissingFields: 2–120 characters between brackets, tags ignored), so
 * the panel and the go-live script agree (FIX F8); the editor shows the Turkish body, the script checks all.
 */
export function legalPlaceholders(body: unknown): string[] {
  const texts = body && typeof body === "object" ? Object.values(body as Record<string, unknown>) : [body];
  return findMissingFields(...texts.filter((t): t is string => typeof t === "string")).map((label) => `[${label}]`);
}

export type LegalDocRow = { key: string; version: string; body: unknown };

const short = (list: string[], max = 4) => (list.length > max ? `${list.slice(0, max).join(", ")} … (+${list.length - max})` : list.join(", "));

/**
 * Missing, draft ("taslak…" label or the draft notice) or unfinished ([placeholders]) sales legal texts.
 * `allowLegalBrackets` (--allow-legal-brackets: the lawyer approved the bracketed text as it is, e.g. a legal
 * citation "[Mülga: …]") turns the placeholder rule into warnings that still list every bracket; the draft label,
 * the draft notice and a missing text always refuse.
 */
export function legalReadiness(currentDocs: readonly LegalDocRow[], allowLegalBrackets = false): { problems: ReadinessProblem[]; warnings: ReadinessProblem[] } {
  const byKey = new Map(currentDocs.map((d) => [d.key, d]));
  const problems: ReadinessProblem[] = [];
  const warnings: ReadinessProblem[] = [];
  for (const key of SALES_LEGAL_KEYS) {
    const doc = byKey.get(key);
    const title = SALES_LEGAL_TITLES[key];
    if (!doc) {
      problems.push({ code: `legal-missing:${key}`, tr: `${title}: yürürlükte bir sürümü yok (Yasal Metinler).`, en: `legal text "${key}" (${title}): no current version.` });
      continue;
    }
    if (isDraftLegalVersion(doc.version)) {
      problems.push({
        code: `legal-draft:${key}`,
        tr: `${title}: yürürlükteki sürüm “${doc.version}” taslak (avukat onaylı metni Yasal Metinler'de “taslak” ile başlamayan bir sürüm adıyla yayınlayın).`,
        en: `legal text "${key}" (${title}): the current version "${doc.version}" is a draft (publish the lawyer-approved text under a label that does not start with "taslak").`,
      });
    }
    const bodies = doc.body && typeof doc.body === "object" ? Object.values(doc.body as Record<string, unknown>) : [];
    if (bodies.some((b) => typeof b === "string" && LEGAL_DRAFT_NOTICE.test(b))) {
      problems.push({
        code: `legal-notice:${key}`,
        tr: `${title}: taslak uyarısı hâlâ metnin başında (Yasal Metinler'de kapatın).`,
        en: `legal text "${key}" (${title}): the draft notice is still on (switch it off in Yasal Metinler).`,
      });
    }
    const placeholders = legalPlaceholders(doc.body);
    if (placeholders.length) {
      const problem: ReadinessProblem = {
        code: `legal-placeholder:${key}`,
        tr: `${title}: köşeli parantezli doldurulacak yer(ler) kaldı: ${short(placeholders)}. Avukat bu köşeli parantezli yazıyı olduğu gibi onayladıysa --allow-legal-brackets eklenir.`,
        en: `legal text "${key}" (${title}): [bracketed] placeholder(s) left: ${short(placeholders)}. If the lawyer approved this bracketed text as it is, add --allow-legal-brackets.`,
      };
      if (allowLegalBrackets) warnings.push({ ...problem, code: `legal-brackets-allowed:${key}` });
      else problems.push(problem);
    }
  }
  return { problems, warnings };
}

/** legalReadiness without the override: every problem refuses. */
export function legalProblems(currentDocs: readonly LegalDocRow[]): ReadinessProblem[] {
  return legalReadiness(currentDocs).problems;
}

/**
 * Seller details the sales contracts and the footer print: the SAME rule as the panel's "Satıcı bilgileri eksiksiz"
 * step (missingSellerFieldKeys in src/lib/settings/seller.ts: legal name, MERSİS, tax office and number, KEP, e-mail,
 * phone, address with district, chamber and its rules link; FIX F3).
 */
export function sellerProblems(general: Settings<"general">): ReadinessProblem[] {
  const missing = missingSellerFieldKeys(general);
  if (!missing.length) return [];
  return [
    {
      code: "seller",
      tr: `Firma bilgileri eksik: ${missing.map((f) => SELLER_FIELD_NAMES[f].tr).join(", ")} (Ayarlar › Firma bilgileri).`,
      en: `seller details missing: ${missing.map((f) => SELLER_FIELD_NAMES[f].en).join(", ")} (Ayarlar › Firma bilgileri).`,
    },
  ];
}

/** A havale account the customer can pay to: valid TR IBAN and an account holder. */
export function usableBankAccounts(payments: Settings<"payments">): Settings<"payments">["bankTransfer"]["accounts"] {
  return payments.bankTransfer.accounts.filter(isUsableBankAccount);
}

/** Kapıda ödeme and/or havale must take orders; havale needs a usable bank account. Card is ignored (forced off). */
export function paymentProblems(payments: Settings<"payments">): ReadinessProblem[] {
  const problems: ReadinessProblem[] = [];
  if (!payments.cashOnDelivery.enabled && !payments.bankTransfer.enabled) {
    problems.push({
      code: "payments-none",
      tr: "Ne kapıda ödeme ne havale açık: sitede sipariş verilemez (Ayarlar › Ödeme yöntemleri).",
      en: "neither kapıda ödeme (cash on delivery) nor havale (bank transfer) is enabled: no order could be placed.",
    });
  }
  if (payments.bankTransfer.enabled && usableBankAccounts(payments).length === 0) {
    problems.push({
      code: "payments-bank-account",
      tr: "Havale açık ama IBAN'ı geçerli ve hesap sahibi yazılı bir banka hesabı yok (Ayarlar › Ödeme yöntemleri).",
      en: "havale is enabled without a bank account that has a valid IBAN and an account holder.",
    });
  }
  return problems;
}

/** "PR-LVL-500 149,90 TL, …" (at most `max` SKUs, then the count of the rest). */
export function priceMatchList(check: PlaceholderPriceCheck, max = 8): string {
  return short(check.matches.map((m) => `${m.sku} ${formatKurusTl(m.price)}`), max);
}

/**
 * The placeholder-price rule (src/lib/pricing/placeholder-prices.ts) for the scripts (FIX F2): ANY considered variant
 * still on a Day-1 price refuses and is listed; --allow-prices turns it into a warning that lists the same SKUs.
 */
export function priceProblems(check: PlaceholderPriceCheck, allowPrices: boolean): { problems: ReadinessProblem[]; warnings: ReadinessProblem[] } {
  if (check.matches.length === 0) return { problems: [], warnings: [] };
  const seed = DAY1_PLACEHOLDER_PRICES.map(formatKurusTl).join(" / ");
  const list = priceMatchList(check);
  const problem: ReadinessProblem = {
    code: "prices",
    tr: `İlk günün örnek fiyatları duruyor: ${check.matches.length}/${check.considered} fiyatlı varyant hâlâ örnek fiyatta (${seed}): ${list}. Gerçek fiyatları panelde (Ürünler) girin; bu fiyatlar gerçekten doğruysa --allow-prices ekleyin.`,
    en: `Day-1 placeholder prices are still there: ${check.matches.length}/${check.considered} priced variants keep a seed price (${seed}): ${list}. Enter the real prices in the panel (Ürünler), or add --allow-prices if these prices are really right.`,
  };
  return allowPrices ? { problems: [], warnings: [{ ...problem, code: "prices-allowed" }] } : { problems: [problem], warnings: [] };
}

export type SalesReadinessInput = {
  legal: readonly LegalDocRow[];
  general: Settings<"general">;
  payments: Settings<"payments">;
  prices: PlaceholderPriceCheck;
  allowPrices: boolean;
  /** --allow-legal-brackets: [bracketed] text the lawyer approved is a warning, not a refusal. */
  allowLegalBrackets?: boolean;
};

/** Every sales-readiness rule; `problems` must be empty before a sales copy may write (and commit) anything. */
export function salesReadiness(input: SalesReadinessInput): { problems: ReadinessProblem[]; warnings: ReadinessProblem[] } {
  const legal = legalReadiness(input.legal, input.allowLegalBrackets ?? false);
  const prices = priceProblems(input.prices, input.allowPrices);
  return {
    problems: [...legal.problems, ...sellerProblems(input.general), ...paymentProblems(input.payments), ...prices.problems],
    warnings: [...legal.warnings, ...prices.warnings],
  };
}

/**
 * The samples line of both scripts (FIX F1): what the sales profile does with settings.samples. `where`: "local"
 * (copy-content, before the profile: the profile switches them off) or "target" (verify-target: what is live).
 */
export function samplesSummary(
  samples: Pick<Settings<"samples">, "cartSampleEnabled" | "requestFormEnabled">,
  keepSamples: boolean,
  where: "local" | "target",
): { status: "OK" | "WARN" | "FAIL"; en: string } {
  const state = `cart samples ${samples.cartSampleEnabled ? "on" : "off"}, /numune request form ${samples.requestFormEnabled ? "on" : "off"}`;
  if (keepSamples) return { status: "WARN", en: `--keep-samples: kept as configured (${state}); only with the ÜTS notification confirmed` };
  if (where === "local") return { status: "OK", en: `switched off on the target by the profile (locally ${state}); until ÜTS, then --keep-samples` };
  return samples.cartSampleEnabled || samples.requestFormEnabled
    ? { status: "FAIL", en: `${state} although ÜTS is not confirmed (switch them off, or add --keep-samples only once ÜTS is confirmed)` }
    : { status: "OK", en: `${state} (until ÜTS)` };
}

export function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), value);
}

export type FieldChange = { path: string; from: unknown; to: unknown };
export type SettingsChange = {
  key: SettingsKey;
  /** The key had a row (false: the row is inserted with the defaults plus the change). */
  existed: boolean;
  /** The stored document did not pass the schema as a whole; parseSettings repaired it per field (as the storefront does). */
  repaired: boolean;
  /** What the profile changes (parsed document before → after). */
  fields: FieldChange[];
  /** Fields the stored row gains or loses by being written in its parsed form (schema defaults filled in, unknown keys dropped), exactly as a panel save would. */
  normalized: FieldChange[];
  /** The complete document to store, validated with the app's schema (settingsSchemas[key]). */
  value: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** JSON with object keys sorted (jsonb stores keys in its own order, so key order never counts as a change). */
function canonicalJson(v: unknown): string | undefined {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x) ?? "null").join(",")}]`;
  if (isPlainObject(v)) {
    const parts = Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Leaf paths whose value differs between `a` and `b` (arrays compare as a whole, key order ignored). */
export function changedPaths(a: unknown, b: unknown, prefix = ""): FieldChange[] {
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  }
  return canonicalJson(a) === canonicalJson(b) ? [] : [{ path: prefix, from: a, to: b }];
}

/**
 * Applies a settings profile to the stored documents (`stored[key]` = the row's value, or undefined
 * when the key has no row). Each document is parsed exactly as the storefront parses it, patched, and
 * re-validated with the app's own zod schema; a value the schema rejects throws (nothing is written).
 */
export function buildSettingsChanges(
  profile: { [K in SettingsKey]?: SettingsPatch<K> },
  stored: Partial<Record<SettingsKey, unknown>>,
): SettingsChange[] {
  return (Object.keys(profile) as SettingsKey[]).map((key) => {
    const patch = profile[key] as unknown as (value: unknown) => unknown;
    const schema = settingsSchemas[key];
    const raw = stored[key];
    const repaired = raw !== undefined && raw !== null && !schema.safeParse(raw).success;
    const base = parseSettings(key, raw);
    const checked = schema.safeParse(patch(base));
    if (!checked.success) {
      const issues = checked.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new Error(`settings "${key}" would not pass the app's schema after the profile: ${issues}`);
    }
    const existed = raw !== undefined && raw !== null;
    return { key, existed, repaired, fields: changedPaths(base, checked.data), normalized: existed ? changedPaths(raw, base) : [], value: checked.data };
  });
}

// ---------------------------------------------------------------------------------------------------
// Production admin

export const ADMIN_PASSWORD_MIN_LENGTH = 14;
/** Better Auth's default maximum (src/lib/auth.ts keeps it). */
export const ADMIN_PASSWORD_MAX_LENGTH = 128;
const WEAK_FRAGMENTS = ["prestij", "password", "parola", "sifre", "şifre", "123456", "qwerty", "admin"];

/** Why a panel admin password is refused, or null when it is acceptable. Never echoes the password. */
export function adminPasswordProblem(password: string, email: string): string | null {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) return `the password must have at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > ADMIN_PASSWORD_MAX_LENGTH) return `the password must have at most ${ADMIN_PASSWORD_MAX_LENGTH} characters.`;
  if (password !== password.trim()) return "the password starts or ends with a space (copy-paste mistake?).";
  if (new Set(password).size < 8) return "the password repeats too few different characters (use a password manager's generator).";
  const lower = password.toLocaleLowerCase("tr");
  const fragment = WEAK_FRAGMENTS.find((f) => lower.includes(f));
  if (fragment) return "the password contains a common word or the shop's name.";
  const local = email.split("@")[0]?.toLocaleLowerCase("tr") ?? "";
  if (local.length >= 4 && lower.includes(local)) return "the password contains the e-mail address.";
  return null;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why an admin e-mail is refused for this target, or null. Rehearsal accounts must be @test.local. */
export function adminEmailProblem(email: string, kind: TargetKind): string | null {
  if (!EMAIL_SHAPE.test(email)) return "ADMIN_EMAIL is not an e-mail address.";
  if (kind === "rehearsal") return email.endsWith("@test.local") ? null : "a rehearsal admin must use an @test.local address.";
  const domain = email.split("@")[1] ?? "";
  if (/(^|\.)(local|localhost|test|example|invalid)$/.test(domain) || /^example\.(com|org|net)$/.test(domain)) {
    return "ADMIN_EMAIL must be a real mailbox the owner reads (password reset mails go there).";
  }
  return null;
}
