// /hesap/kurumsal (en/ar: /account/business): the business account application and its status
// (pending, approved with group and terms, rejected with the reason and a prefilled form to apply
// again). Dynamic and noindex: the session is read inside <Suspense>, so the shell stays static.
// The account navigation comes from layout.tsx (AccountShell).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BadgeCheck, CircleCheck, Clock3, FileText, Hourglass, Mail, ReceiptText, Tags, XCircle } from "lucide-react";
import { AccountContentSkeleton, AccountPageHeader } from "@/components/store/account/AccountShell";
import { privateMetadata } from "@/components/store/account/page-helpers";
import BusinessApplicationForm, { type BusinessFormLabels } from "@/components/store/b2b/BusinessApplicationForm";
import { buttonClass } from "@/components/sections/button-styles";
import { intlLocale, isLocale, type Locale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages, type Messages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import { requireAccountUser } from "@/lib/account/session";
import { loadBusinessAccount, type BusinessAccountView } from "@/lib/b2b/account";
import { TR_PROVINCE_NAMES } from "@/lib/validation/tr";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Slug of the KVKK notice page (seeded legal page). */
const KVKK_PAGE_SLUG = "kvkk";

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const messages = await getMessages(locale);
  return privateMetadata(messages.b2b.account.metaTitle);
}

export default function BusinessAccountPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<AccountContentSkeleton />}>
      <BusinessAccount params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined);

async function BusinessAccount({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Request-time only (session, clock): keeps the prerendered shell free of per-user values.
  await connection();
  const page = href(locale, "accountBusiness");
  const user = await requireAccountUser(locale, page);
  const [messages, view, query] = await Promise.all([getMessages(locale), loadBusinessAccount(user.id), searchParams]);
  if (!view) notFound();
  const m = messages.b2b.account;
  const justSent = first(query.gonderildi) === "1";

  return (
    <div className="min-w-0">
      <AccountPageHeader eyebrow={m.eyebrow} title={m.title} intro={m.intro} />
      {view.company?.status === "approved" ? null : <Benefits m={m} />}
      <div className="mt-8 max-w-3xl">
        <Body view={view} locale={locale} messages={messages} justSent={justSent} />
      </div>
    </div>
  );
}

function Benefits({ m }: { m: Messages["b2b"]["account"] }) {
  const items = [
    { icon: Tags, text: m.benefitPrices },
    { icon: Clock3, text: m.benefitTerms },
    { icon: ReceiptText, text: m.benefitInvoice },
  ];
  return (
    <section aria-label={m.benefitsTitle} className="max-w-3xl">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-text-muted">{m.benefitsTitle}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {items.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 rounded-md border border-border bg-surface/70 p-4 text-sm leading-relaxed text-text sm:flex-col">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-gold/40 text-gold-text">
              <Icon aria-hidden className="size-4" strokeWidth={1.5} />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Body({ view, locale, messages, justSent }: { view: BusinessAccountView; locale: Locale; messages: Messages; justSent: boolean }) {
  const m = messages.b2b.account;
  const { status: _status, ...formLabels } = m;
  void _status;
  const form = (
    <BusinessApplicationForm
      locale={locale}
      labels={formLabels as BusinessFormLabels}
      defaults={view.defaults}
      provinces={[...TR_PROVINCE_NAMES]}
      privacyHref={href(locale, "page", { slug: KVKK_PAGE_SLUG })}
    />
  );

  if (view.isStaff) return <Panel tone="muted" icon={FileText} title={m.title} text={m.errors.staff} />;

  const company = view.company;
  if (!company) {
    if (!view.b2bEnabled) return <Panel tone="muted" icon={FileText} title={m.title} text={m.errors.closed} />;
    return <Card>{form}</Card>;
  }

  if (company.status === "pending") {
    return (
      <div className="space-y-6">
        <Panel
          tone="pending"
          icon={justSent ? CircleCheck : Hourglass}
          title={justSent ? m.status.submittedTitle : m.status.pendingTitle}
          text={format(m.status.pendingText, { company: company.name, date: formatDate(company.submittedAt, locale) })}
        >
          <Steps m={m} />
        </Panel>
        <Summary view={view} locale={locale} messages={messages} />
      </div>
    );
  }

  if (company.status === "approved") {
    const group = localize(company.groupName, locale);
    return (
      <div className="space-y-6">
        <Panel tone="success" icon={BadgeCheck} title={m.status.approvedTitle} text={format(m.status.approvedText, { company: company.name })}>
          <dl className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
            {group && <Detail label={m.status.group} value={group} />}
            <Detail label={m.status.terms} value={company.deferredDays ? format(m.status.termsDeferred, { days: company.deferredDays }, locale) : m.status.termsStandard} />
          </dl>
          {company.pricesExVat && <p className="mt-4 text-sm text-text-muted">{m.status.pricesExVat}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={href(locale, "products")} className={buttonClass("primary", "rtl:tracking-normal")}>
              {m.status.shop}
            </Link>
            <Link href={href(locale, "contact")} className={buttonClass("secondary", "rtl:tracking-normal")}>
              {m.status.contact}
            </Link>
          </div>
        </Panel>
        <Summary view={view} locale={locale} messages={messages} />
      </div>
    );
  }

  // Rejected: the reason, then the form prefilled with the previous application.
  return (
    <div className="space-y-6">
      <Panel tone="danger" icon={XCircle} title={m.status.rejectedTitle} text={format(m.status.rejectedText, { company: company.name })}>
        {company.rejectionReason && (
          <div className="mt-5 rounded-md border border-border bg-surface-2/70 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">{m.status.reasonLabel}</p>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-text" dir="auto">
              {company.rejectionReason}
            </p>
          </div>
        )}
        <p className="mt-5 text-sm text-text-muted">{m.status.reapplyText}</p>
      </Panel>
      {view.b2bEnabled ? <Card>{form}</Card> : null}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-border bg-surface p-6 shadow-[0_24px_60px_-44px_rgb(3_38_95/0.35)] sm:p-10">{children}</div>;
}

const TONES = {
  pending: "border-gold/45 text-gold-text",
  success: "border-emerald-700/35 text-emerald-700 dark:border-emerald-400/35 dark:text-emerald-300",
  danger: "border-red-700/30 text-red-700 dark:border-red-400/35 dark:text-red-300",
  muted: "border-border text-text-muted",
} as const;

function Panel({
  tone,
  icon: Icon,
  title,
  text,
  children,
}: {
  tone: keyof typeof TONES;
  icon: typeof Mail;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <section role="status" className="rounded-md border border-border bg-surface p-6 shadow-[0_24px_60px_-44px_rgb(3_38_95/0.35)] sm:p-10">
      <span className={cn("grid size-12 place-items-center rounded-full border", TONES[tone])}>
        <Icon aria-hidden className="size-6" strokeWidth={1.5} />
      </span>
      <h2 className="mt-6 font-heading text-3xl leading-tight text-balance text-text md:text-4xl">{title}</h2>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-pretty text-text-muted">{text}</p>
      {children}
    </section>
  );
}

function Steps({ m }: { m: Messages["b2b"]["account"] }) {
  const steps = [
    { label: m.status.steps.received, done: true },
    { label: m.status.steps.review, done: false, current: true },
    { label: m.status.steps.result, done: false },
  ];
  return (
    <ol className="mt-8 grid gap-3 border-t border-border pt-6 sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-3 text-sm">
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums",
              s.done ? "border-brand bg-brand text-brand-contrast dark:border-gold dark:bg-gold dark:text-gold-contrast" : s.current ? "border-gold text-gold-text" : "border-border text-text-muted",
            )}
            aria-hidden
          >
            {i + 1}
          </span>
          <span className={s.done || s.current ? "text-text" : "text-text-muted"}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Summary({ view, locale, messages }: { view: BusinessAccountView; locale: Locale; messages: Messages }) {
  const c = view.company;
  if (!c) return null;
  const m = messages.b2b.account;
  const rows = [
    { label: m.companyName, value: c.name },
    { label: m.sector, value: m.sectors[c.sector] ?? m.sectors.other },
    c.taxOffice ? { label: m.taxOffice, value: c.taxOffice } : null,
    c.taxNumber ? { label: m.taxNumber, value: c.taxNumber, ltr: true } : null,
    c.city ? { label: `${m.city} / ${m.district}`, value: [c.city, c.district].filter(Boolean).join(" / ") } : null,
  ].filter((r): r is { label: string; value: string; ltr?: boolean } => r !== null);
  void locale;
  return (
    <section className="rounded-md border border-border p-6 sm:p-8">
      <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-text-muted">{m.status.detailsTitle}</h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        {rows.map((r) => (
          <Detail key={r.label} label={r.label} value={r.value} ltr={r.ltr} />
        ))}
      </dl>
    </section>
  );
}

function Detail({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-[0.12em] text-text-muted">{label}</dt>
      <dd className="mt-1 break-words text-[0.95rem] text-text" dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}

function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(value));
}
