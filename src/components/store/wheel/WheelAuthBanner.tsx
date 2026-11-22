// "Çark hediyeniz: %10 indirim — üyeliğinizi tamamlayınca hesabınıza tanımlanır": a small note on the register
// and sign-in pages when the visitor holds a won, unclaimed spin (contract §1.1 claim paths, 4). Server
// component rendered inside those pages' request-time card (they already read the session there), so
// it streams with the form: no extra request, no layout shift. A spin already bound to a new account
// (sign-up done, e-mail not verified yet) gets the "verify your e-mail by <hold end>" line. Reads only the spin cookie
// and the spin row (getVisitorWheelBanner never writes a cookie). Never fails the page: on any problem
// the note is simply left out.
import { Gift } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { getVisitorWheelBanner } from "@/lib/wheel/visitor";
import { formatWheelDate } from "./countdown";

export default async function WheelAuthBanner({ locale, messages, variant }: { locale: Locale; messages: Messages; variant: "register" | "signIn" }) {
  const banner = await getVisitorWheelBanner(locale);
  if (!banner) return null;
  const text =
    banner.status === "bound"
      ? format(messages.wheel.banner.verify, { date: formatWheelDate(banner.holdUntil, locale) })
      : format(messages.wheel.banner[variant], { prize: banner.prize });
  return (
    <p className="mb-7 flex items-start gap-3 rounded-md border border-gold-300/60 border-s-4 border-s-gold bg-gold-50/70 px-4 py-3.5 text-sm leading-relaxed text-text dark:bg-gold-950/50">
      <Gift aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-text" strokeWidth={1.8} />
      <span>{text}</span>
    </p>
  );
}
