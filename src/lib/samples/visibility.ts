// Links to the free-samples page while samples are switched off (PayTR-fix IMPL-B, S17). Pure: no Next APIs, no DB.
//
// With both sample switches off (Ayarlar › Numune: cart samples and the /numune request form; the sales profile
// turns both off until ÜTS), /numune shows only its closed notice ("Numune talepleri şu anda alınmıyor…"), so
// links that promise free samples would lead a visitor, or a payment provider's reviewer, to a closed form. The
// storefront therefore leaves them out at render time, server side, from cached reads only (the settings document
// is cached under TAGS.settings, so switching samples back on in the panel brings everything back):
// - header and footer menu items (and fallback items) whose link is the samples page, children included;
// - page sections whose main call to action (`cta`, a hero's `primaryCta`) is the samples page; any other button or
//   link to it inside a section (a hero's second button, a packaging item's button, a gallery link…) is dropped
//   while the section stays. The samples page itself is left as it is (its closed notice is its content).
// Texts are never changed (e.g. an About page paragraph or a FAQ answer mentioning free samples): owner content.
// A link counts in any language form, with or without a query or #anchor: /numune, /numune#numune-formu,
// /tr/numune, /en/samples, /ar/samples?x. Absolute URLs are not (they may be another site), the same rule as the
// go-live scripts' announcement check (scripts/golive/rules.ts announcementFeature; a unit test keeps them equal).
import { localizePath } from "@/i18n/paths";
import type { NavItem } from "@/lib/data/site";
import type { PageSectionData } from "@/lib/data/pages";
import type { Settings } from "@/lib/settings/types";

/** The reserved page-builder slug of /numune (src/lib/reserved-pages.ts). */
export const SAMPLES_PAGE_SLUG = "numune";

/** Samples are off when neither the cart samples nor the /numune request form are on (the page then offers nothing). */
export function samplesSwitchedOff(samples: Pick<Settings<"samples">, "cartSampleEnabled" | "requestFormEnabled">): boolean {
  return !samples.cartSampleEnabled && !samples.requestFormEnabled;
}

/** True when `href` is the storefront samples page in any language form (relative links only). */
export function isSamplesHref(href: unknown): boolean {
  if (typeof href !== "string") return false;
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  const pathPart = raw.split(/[?#]/)[0] ?? "";
  if (!pathPart) return false;
  const tr = localizePath("tr", pathPart.startsWith("/") ? pathPart : `/${pathPart}`);
  const path = (tr.replace(/^\/tr(?=\/|$)/, "").replace(/\/+$/, "") || "/").toLowerCase();
  return path === `/${SAMPLES_PAGE_SLUG}` || path.startsWith(`/${SAMPLES_PAGE_SLUG}/`);
}

/** Menu items without the ones that link to the samples page (recursively; other items keep their order). */
export function withoutSamplesMenuItems(items: readonly NavItem[]): NavItem[] {
  return items.filter((item) => !isSamplesHref(item.href)).map((item) => ({ ...item, children: withoutSamplesMenuItems(item.children) }));
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
/** A stored button ({ label, href }, the sections' `cta` schema) that leads to the samples page. */
const isSamplesButton = (value: unknown): boolean => isObject(value) && Object.hasOwn(value, "label") && isSamplesHref(value.href);

/** The keys that carry a section's main call to action. */
const MAIN_CTA_KEYS = ["cta", "primaryCta"] as const;

/**
 * Section content without buttons to the samples page (a button object is removed from its parent object or list)
 * and without plain `href` links to it (e.g. a gallery image's optional link: the image stays, unlinked).
 */
function stripSamplesLinks(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.filter((item) => !isSamplesButton(item)).map((item) => stripSamplesLinks(item, depth + 1));
  if (!isObject(value)) return value;
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === "href" && isSamplesHref(child)) || isSamplesButton(child)) continue;
    out[key] = stripSamplesLinks(child, depth + 1);
  }
  return out;
}

/** Whether a section's main call to action leads to the samples page (then the whole section is left out). */
export function sectionLeadsToSamples(section: Pick<PageSectionData, "content">): boolean {
  const content = section.content;
  return isObject(content) && MAIN_CTA_KEYS.some((key) => isSamplesButton(content[key]));
}

/**
 * A page's sections while samples are off: sections whose main call to action is the samples page are left out,
 * every other link or button to it is removed from the section's content. Sections are never mutated.
 */
export function withoutSamplesSections(sections: readonly PageSectionData[]): PageSectionData[] {
  return sections.filter((s) => !sectionLeadsToSamples(s)).map((s) => ({ ...s, content: stripSamplesLinks(s.content) }));
}
