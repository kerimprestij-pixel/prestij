// The footer's copyright line. Pure (unit-tested).

/**
 * "© 2026 PRESTİJ BUKLET KOZMETİK SAN. TİC. LTD. ŞTİ. All rights reserved." The year and the company name are
 * bidi-isolated. On the Arabic pages (dir="rtl") the name's final period would otherwise take the
 * paragraph's right-to-left direction and show before the name (".PRESTİJ … ŞTİ"). `<bdi>` takes the
 * direction of the name itself: left-to-right for a Latin name, right-to-left for an Arabic one.
 */
export default function FooterCopyright({ year, holder, rights }: { year: number; holder: string; rights: string }) {
  return (
    <p>
      © <span dir="ltr">{year}</span> <bdi>{withPeriod(holder)}</bdi> {rights}
    </p>
  );
}

/** "… LTD. ŞTİ." already ends with a period: never print "ŞTİ..". */
export function withPeriod(name: string): string {
  const trimmed = name.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}
