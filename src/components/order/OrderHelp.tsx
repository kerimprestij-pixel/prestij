// "Need help?" block: WhatsApp (with the order number prefilled), phone and e-mail from settings.
import { Mail, Phone } from "lucide-react";
import { WhatsAppIcon } from "@/components/store/BrandIcons";
import { cn } from "@/lib/utils";
import { telHref } from "./format";

export type HelpContact = {
  /** wa.me link with a prefilled message, or null when WhatsApp is off. */
  whatsappHref: string | null;
  phone: string | null;
  email: string | null;
};

type OrderHelpProps = {
  title: string;
  text: string;
  contact: HelpContact;
  labels: { whatsapp: string; call: string; email: string; newTab: string };
  className?: string;
  /** Distinct heading id when the block is rendered twice (mobile/desktop placements). */
  id: string;
};

const linkClass =
  "group flex min-h-11 items-center gap-3 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text transition-colors duration-200 hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none";

export default function OrderHelp({ title, text, contact, labels, className, id }: OrderHelpProps) {
  const { whatsappHref, phone, email } = contact;
  if (!whatsappHref && !phone && !email) return null;

  return (
    <section aria-labelledby={id} className={cn("rounded-md bg-surface-2 p-5 sm:p-6 lg:p-8 print:hidden", className)}>
      <h2 id={id} className="font-heading text-2xl leading-tight text-text">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{text}</p>
      <ul className="mt-5 grid gap-2.5">
        {whatsappHref && (
          <li>
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={linkClass}>
              <WhatsAppIcon aria-hidden className="size-4.5 shrink-0 text-[#128C7E] dark:text-[#25D366]" strokeWidth={1.7} />
              <span>{labels.whatsapp}</span>
              <span className="sr-only"> {labels.newTab}</span>
            </a>
          </li>
        )}
        {phone && (
          <li>
            <a href={telHref(phone)} className={linkClass}>
              <Phone aria-hidden className="size-4.5 shrink-0 text-gold-text" strokeWidth={1.5} />
              <span>{labels.call}</span>
              <span dir="ltr" className="ms-auto text-text-muted tabular-nums">
                {phone}
              </span>
            </a>
          </li>
        )}
        {email && (
          <li>
            <a href={`mailto:${email}`} className={linkClass}>
              <Mail aria-hidden className="size-4.5 shrink-0 text-gold-text" strokeWidth={1.5} />
              <span>{labels.email}</span>
              <span dir="ltr" className="ms-auto min-w-0 truncate text-text-muted">
                {email}
              </span>
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}
