// Renders page sections in order. Unknown types and content that fails its schema are skipped
// (logged in development) so a bad block never takes the page down.
//
// Audiences: pages are static, so every section is rendered on the server. "all" sections render as
// they are; "retail" and "business" ones are wrapped in <AudienceGate>, which decides in the browser
// once the viewer has loaded (guests and crawlers get the retail view, approved business customers
// the business view). Rules: ./audience-gate-rules.ts.
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/get-messages";
import type { PageSectionData } from "@/lib/data/pages";
import AudienceGate from "./AudienceGate";
import { audienceMatches, isSectionAudience, leadingGuestSection, type AudienceFilter } from "./audience-gate-rules";
import { sectionRegistry, type SectionComponent } from "./registry";
import { isSectionType, type SectionType } from "./schemas";

const dev = process.env.NODE_ENV !== "production";

type ParsedSection = { id: number; type: SectionType; data: unknown; audience: PageSectionData["audience"] };

function parse(section: PageSectionData, log: boolean): ParsedSection | null {
  // An audience the storefront does not know is never shown (the panel only saves all/retail/business).
  if (!isSectionAudience(section.audience)) return null;
  if (!isSectionType(section.type)) {
    if (log && dev) console.warn(`[sections] unknown type "${section.type}" (id ${section.id}) skipped`);
    return null;
  }
  const result = sectionRegistry[section.type].schema.safeParse(section.content ?? {});
  if (!result.success) {
    if (log && dev) console.warn(`[sections] invalid "${section.type}" content (id ${section.id}):`, result.error.issues);
    return null;
  }
  return { id: section.id, type: section.type, data: result.data, audience: section.audience };
}

/**
 * True when the section can render (known type, valid content) for the given visitors: "any"
 * (default: guests or business customers, i.e. it belongs in the SectionRenderer list), "retail"
 * (what guests and crawlers see) or "business" (what an approved business customer sees).
 */
export function isRenderable(section: PageSectionData, audience: AudienceFilter = "any"): boolean {
  return audienceMatches(section.audience, audience) && parse(section, false) !== null;
}

export default function SectionRenderer({
  sections,
  locale,
  messages,
  leadsPage = false,
}: {
  sections: PageSectionData[];
  locale: Locale;
  messages: Messages;
  /**
   * The sections open the page's content (nothing with a priority image above them: home, /sayfa,
   * /kurumsal…): the first section guests see gets `priority` (its first image is preloaded).
   */
  leadsPage?: boolean;
}) {
  const parsedSections = sections.map((section) => parse(section, true));
  const lead = leadsPage ? leadingGuestSection(parsedSections.filter((p): p is ParsedSection => p !== null)) : null;
  return (
    <>
      {parsedSections.map((parsed) => {
        if (!parsed) return null;
        const Component = sectionRegistry[parsed.type].Component as SectionComponent<unknown>;
        const element = (
          <Component
            key={parsed.id}
            content={parsed.data}
            locale={locale}
            messages={messages}
            audience={parsed.audience}
            priority={parsed === lead}
          />
        );
        if (parsed.audience === "all") return element;
        return (
          <AudienceGate key={parsed.id} audience={parsed.audience}>
            {element}
          </AudienceGate>
        );
      })}
    </>
  );
}
