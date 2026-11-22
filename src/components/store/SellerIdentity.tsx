// Seller registry lines (MERSİS no, KEP address, chamber with its rules link, registered trademark, and the
// legal name when the caller passes it) for the footer's "İletişim" block and the contact section (go-live
// CF-9). Server-rendered markup from cached settings: no client JS, no request data. Values are bidi-isolated
// (<bdi>) so a Latin name, number or address keeps its order on the Arabic pages.
import type { SellerIdentityRow } from "@/lib/settings/seller";
import { cn } from "@/lib/utils";

type Props = {
  rows: SellerIdentityRow[];
  /** "Meslek kuralları": the visible text of the chamber's rules link. */
  rulesLabel: string;
  /** "(yeni sekmede açılır)" for screen readers. */
  newTabHint: string;
  /** Classes of the rules link (the footer is inverse, the contact section is not). */
  linkClassName?: string;
  /** Classes of each line. */
  lineClassName?: string;
  /** Classes of the visible label ("MERSİS No"). */
  labelClassName?: string;
};

export default function SellerIdentity({ rows, rulesLabel, newTabHint, linkClassName, lineClassName, labelClassName }: Props) {
  return (
    <>
      {rows.map((row) => (
        <p key={row.key} className={cn("break-words", lineClassName)}>
          <span className={labelClassName}>{row.label}:</span> <bdi>{row.value}</bdi>
          {row.href ? (
            <>
              {" · "}
              <a href={row.href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
                {rulesLabel}
                <span className="sr-only"> {newTabHint}</span>
              </a>
            </>
          ) : null}
        </p>
      ))}
    </>
  );
}
