// "Yayına alma adımları" card on /panel/seo: every go-live step in three groups (LAUNCH_GROUPS: before go-live with
// sales, before the gift wheel, after go-live), with the exact URLs to paste. Server component (static copy from
// launchChecklist); only the copy buttons are client islands.
import Link from "next/link";
import { ArrowUpRight, ExternalLink, Rocket } from "lucide-react";
import CopyButton from "@/components/panel/orders/CopyButton";
import StatusBadge from "@/components/panel/StatusBadge";
import { LAUNCH_GROUPS, type LaunchStep } from "@/lib/panel/seo/launch";

function DoneBadge({ done, review }: { done: boolean | null; review?: boolean }) {
  if (done === true) return <StatusBadge tone="success">Tamam</StatusBadge>;
  if (done === false) return <StatusBadge tone="warning">Yapılacak</StatusBadge>;
  if (review) return <StatusBadge tone="info">Kontrol et</StatusBadge>;
  return null;
}

function StepItem({ step, number }: { step: LaunchStep; number: number }) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-[0.6875rem] font-semibold text-text-muted tabular-nums">
          {number}
        </span>
        <h4 className="text-sm font-medium text-text">{step.title}</h4>
        <DoneBadge done={step.done} review={step.review} />
      </div>
      <ul className="mt-2 list-disc space-y-1 ps-12 text-xs leading-relaxed text-text-muted marker:text-border">
        {step.steps.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {step.links.length > 0 || step.panelHref ? (
        <div className="mt-3 space-y-2 ps-9">
          {step.links
            .filter((link) => link.copy)
            .map((link) => (
              <div key={link.label} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <p className="min-w-0 text-xs">
                  <span className="text-text-muted">{link.label}: </span>
                  <span className="break-all text-text" dir="ltr">
                    {link.url}
                  </span>
                </p>
                <CopyButton text={link.url} label="Kopyala" srLabel={`Kopyala: ${link.label} (${step.title})`} className="self-start sm:self-center" />
              </div>
            ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {step.links
              .filter((link) => !link.copy)
              .map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded text-xs font-medium text-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {link.label}
                  <ExternalLink aria-hidden className="size-3.5 text-text-muted" />
                  <span className="sr-only">(yeni sekmede açılır)</span>
                </a>
              ))}
            {step.panelHref ? (
              <Link
                href={step.panelHref}
                className="inline-flex items-center gap-1 rounded text-xs font-medium text-gold-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {step.panelLabel ?? "Panelde aç"}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function LaunchChecklist({ steps, siteIsLocal, origin }: { steps: LaunchStep[]; siteIsLocal: boolean; origin: string }) {
  // Numbered across the groups, in launchChecklist's order (which already lists the groups one after another).
  const numbered = steps.map((step, index) => ({ step, number: index + 1 }));
  return (
    <section aria-labelledby="launch-checklist" className="min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgb(3_38_95/0.04)]">
      <header className="flex items-start gap-4 border-b border-border px-5 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/35 bg-gold/10 text-gold-text">
          <Rocket aria-hidden className="size-5" strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <h2 id="launch-checklist" className="text-sm font-semibold text-text">
            Yayına alma adımları
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-text-muted">
            Site, satış için gereken her şey hazır olunca açılır. Adımlar üç gruptadır: yayından önce, çarkı açmadan önce ve yayından sonra.
          </p>
        </div>
      </header>
      {siteIsLocal ? (
        <p className="border-b border-border bg-[#D68A12]/10 px-5 py-3 text-xs leading-relaxed text-text">
          Site adresi şu an yerel bir adres ({origin}). Aşağıdaki adresler canlı alan adı NEXT_PUBLIC_SITE_URL olarak tanımlanınca ona göre değişir;
          arama motorlarına yalnızca canlı adresleri verin.
        </p>
      ) : null}
      {LAUNCH_GROUPS.map((group) => {
        const items = numbered.filter(({ step }) => step.group === group.key);
        if (items.length === 0) return null;
        const headingId = `launch-group-${group.key}`;
        return (
          <div key={group.key} role="group" aria-labelledby={headingId} className="border-b border-border last:border-b-0">
            <div className="bg-surface-2/50 px-5 py-3">
              <h3 id={headingId} className="text-xs font-semibold uppercase tracking-[0.08em] text-text">
                {group.title}
              </h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{group.text}</p>
            </div>
            <ol className="divide-y divide-border" start={items[0].number}>
              {items.map(({ step, number }) => (
                <StepItem key={step.key} step={step} number={number} />
              ))}
            </ol>
          </div>
        );
      })}
    </section>
  );
}
