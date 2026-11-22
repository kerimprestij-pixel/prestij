import type { Locale } from "@/i18n/config";
import { localize } from "@/i18n/localize";
import { getSettings } from "@/lib/settings/get-settings";
import { WhatsAppIcon } from "./BrandIcons";

type WhatsAppButtonProps = { locale: Locale; label: string; newTabHint: string };

/** Floating WhatsApp chat link (bottom-end corner) driven by settings.whatsapp. */
export default async function WhatsAppButton({ locale, label, newTabHint }: WhatsAppButtonProps) {
  const settings = await getSettings("whatsapp");
  const phone = settings.phone.replace(/\D/g, "");
  if (!settings.enabled || phone.length < 8) return null;

  const text = localize(settings.message, locale);
  const url = `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} ${newTabHint}`}
      title={label}
      className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] end-4 z-30 inline-flex size-12 items-center justify-center rounded-full bg-[#128C7E] text-white shadow-[0_10px_30px_-10px_rgb(0_0_0/0.45)] ring-1 ring-black/5 transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-12px_rgb(0_0_0/0.5)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0 md:end-6 md:size-14 print:hidden"
    >
      <WhatsAppIcon className="size-6 md:size-7" strokeWidth={1.7} />
    </a>
  );
}
