// Presentation helpers for the page builder: an icon per section type (unknown and future types get a
// neutral icon, so new types need no change here) and the schedule note shown on a section card.
import {
  BookOpen,
  Building2,
  Clapperboard,
  Contact,
  FileText,
  FlaskConical,
  Images,
  LayoutTemplate,
  Mail,
  MessageSquareQuote,
  MessageCircleQuestion,
  Package,
  PanelTop,
  Scale,
  Send,
  ShoppingBag,
  Sparkles,
  Type,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";
import type { Tone } from "@/components/panel/labels";
import { formatIstanbul } from "@/lib/panel/format";

const ICONS: Record<string, LucideIcon> = {
  hero: PanelTop,
  scent_showcase: Sparkles,
  featured_products: ShoppingBag,
  packaging: Package,
  lifestyle_gallery: Images,
  b2b_cta: Building2,
  sample_cta: FlaskConical,
  story: BookOpen,
  newsletter: Mail,
  rich_text: Type,
  image_banner: LayoutTemplate,
  faq: MessageCircleQuestion,
  legal_document: Scale,
  contact_info: Contact,
  contact_form: Send,
  quote_form: MessageSquareQuote,
  sample_request_form: FlaskConical,
  video: Clapperboard,
};

/** The icon of a section type (a neutral page icon for types without one). */
export function SectionIcon({ type, className, strokeWidth = 1.75 }: { type: string; className?: string; strokeWidth?: number }) {
  return createElement(ICONS[type] ?? FileText, { "aria-hidden": true, className, strokeWidth });
}

export type ScheduleNote = { label: string; tone: Tone; live: boolean };

/** Card badge for a section's publish window (null when it has none). Same rule as the storefront. */
export function scheduleNote(schedule: { startsAt: string | null; endsAt: string | null }, now = Date.now()): ScheduleNote | null {
  const start = schedule.startsAt ? new Date(schedule.startsAt).getTime() : null;
  const end = schedule.endsAt ? new Date(schedule.endsAt).getTime() : null;
  if (start === null && end === null) return null;
  if (end !== null && end <= now) return { label: "Süresi doldu", tone: "neutral", live: false };
  if (start !== null && start > now) return { label: `${formatIstanbul(schedule.startsAt)} itibarıyla`, tone: "info", live: false };
  if (end !== null) return { label: `${formatIstanbul(schedule.endsAt)} tarihine kadar`, tone: "gold", live: true };
  return null;
}
