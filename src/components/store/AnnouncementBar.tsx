import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { localizePath } from "@/i18n/paths";
import { getActiveAnnouncements } from "@/lib/data/site";
import { isSafeHref } from "@/lib/safe-href";
import { announcementPrePaintScript } from "./announcement-dismiss";
import AnnouncementRotator, { type AnnouncementLabels, type RotatorItem } from "./AnnouncementRotator";

type AnnouncementBarProps = { locale: Locale; labels: AnnouncementLabels };

/** Thin bar above the header with the active, scheduled announcements (one at a time). */
export default async function AnnouncementBar({ locale, labels }: AnnouncementBarProps) {
  const announcements = await getActiveAnnouncements();
  const items: RotatorItem[] = announcements
    .map((a) => ({
      id: a.id,
      text: localize(a.text, locale),
      // Render-time second check of the link rule (the panel validates on save): unsafe → no link.
      href: a.href && isSafeHref(a.href) ? localizePath(locale, a.href) : null,
      external: a.href && isSafeHref(a.href) ? /^(https?:)?\/\//i.test(a.href) : false,
      variant: a.variant,
    }))
    .filter((item) => item.text !== "");

  if (items.length === 0) return null;

  // Changes whenever the set or any text changes, so a dismissed bar comes back for new content.
  const lastEdit = Math.max(...announcements.map((a) => a.updatedAt));
  const signature = `${items.map((item) => item.id).join(".")}:${lastEdit}`;

  return (
    <>
      <AnnouncementRotator items={items} signature={signature} labels={labels} />
      <script dangerouslySetInnerHTML={{ __html: announcementPrePaintScript(signature) }} />
    </>
  );
}
