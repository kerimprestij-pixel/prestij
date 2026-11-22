// The gift wheel in the storefront layout (server, async). Reads the cached, display-only teaser and
// mounts the client island when the wheel is live; renders nothing otherwise. Props stay tiny (about
// 0.4 KB): they are serialized into every prerendered page. Mounted once in src/app/[locale]/layout.tsx
// after <CartDrawer>.
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { getActiveWheelTeaser } from "@/lib/data/wheel";
import GiftWheelIsland from "./GiftWheelIsland";
import { wheelTeaserLabels } from "./labels";

export default async function GiftWheel({ locale, messages }: { locale: Locale; messages: Messages }) {
  const teaser = await getActiveWheelTeaser(locale);
  if (!teaser) return null;
  const { teaserText, ...island } = teaser;
  return <GiftWheelIsland locale={locale} teaser={island} labels={wheelTeaserLabels(messages, teaserText)} />;
}
