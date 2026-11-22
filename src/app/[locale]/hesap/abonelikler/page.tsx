// /hesap/abonelikler (en/ar: /account/subscriptions): the customer's subscriptions with self-service
// (skip / pause / resume / plan / address / cancel) and the skip link of the reminder e-mail
// (?atla=<signed token>). Dynamic and noindex: the session is read inside <Suspense>; the account
// navigation comes from ./layout.tsx (ACCOUNTS' AccountShell).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountContentSkeleton, AccountPageHeader } from "@/components/store/account/AccountShell";
import { privateMetadata } from "@/components/store/account/page-helpers";
import AccountSubscriptions, { type AccountSubscriptionCard, type SkipPrompt } from "@/components/store/subscription/AccountSubscriptions";
import { isLocale } from "@/i18n/config";
import { format } from "@/i18n/format";
import { getMessages } from "@/i18n/get-messages";
import { localize } from "@/i18n/localize";
import { href } from "@/i18n/paths";
import { requireAccountUser } from "@/lib/account/session";
import { loadActivePlans } from "@/lib/subscriptions/plans";
import { addressLines, describeItems, formatDay, listUserSubscriptions, paymentText } from "@/lib/subscriptions/queries";
import { anchorDayOf, nextRunAfter } from "@/lib/subscriptions/schedule";
import { readSubscriptionSkipToken } from "@/lib/subscriptions/service";
import { formatPrice } from "@/lib/pricing/money";
import { TR_PROVINCE_NAMES } from "@/lib/validation/tr";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return privateMetadata((await getMessages(locale)).subscriptions.account.title);
}

export default function AccountSubscriptionsPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<AccountContentSkeleton />}>
      <Subscriptions params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined);

async function Subscriptions({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Request time only: the session, the skip link and the dates below are per request.
  await connection();
  const page = href(locale, "accountSubscriptions");
  const query = await searchParams;
  const skipToken = first(query.atla)?.slice(0, 2048) ?? null;
  const user = await requireAccountUser(locale, skipToken ? `${page}?atla=${encodeURIComponent(skipToken)}` : page);

  const [messages, subscriptions, plans] = await Promise.all([getMessages(locale), listUserSubscriptions(user.id), loadActivePlans()]);
  const m = messages.subscriptions.account;
  const cards: AccountSubscriptionCard[] = await Promise.all(
    subscriptions.map(async (s) => ({
      id: s.id,
      status: s.status,
      statusLabel: m.status[s.status],
      title: format(m.number, { id: s.id }),
      planId: s.planId,
      planName: localize(s.planName, locale),
      percent: s.percent,
      nextRunLabel: formatDay(s.nextRunAt, locale),
      skipNext: s.skipNext,
      skippedNote: s.skipNext ? format(m.skippedNote, { date: formatDay(s.nextRunAt, locale), next: formatDay(s.followingRunAt, locale) }) : null,
      failed: s.failedCount > 0 && s.status === "active",
      startedLabel: formatDay(s.createdAt, locale),
      cancelledNote: s.cancelledAt ? format(m.cancelledNote, { date: formatDay(s.cancelledAt, locale) }) : null,
      paymentLabel: paymentText(s.paymentMethod, messages),
      items: await describeItems(s.items, locale),
      address: s.shippingAddress,
      addressLines: addressLines(s.shippingAddress),
      orders: s.orders.map((o) => ({
        orderNumber: o.orderNumber,
        href: href(locale, "accountOrder", { orderNumber: o.orderNumber }),
        statusLabel: messages.account.status[o.status] ?? o.status,
        totalLabel: formatPrice(o.grandTotal, locale),
        dateLabel: formatDay(o.createdAt, locale),
        kindLabel: o.first ? m.firstOrder : m.renewal,
      })),
    })),
  );

  let skipPrompt: SkipPrompt | null = null;
  if (skipToken) {
    const token = readSubscriptionSkipToken(skipToken);
    const target = token ? subscriptions.find((s) => s.id === token.subscriptionId) : undefined;
    // Valid only for the renewal it was issued for, on an active subscription that is not skipped yet.
    if (token && target && target.status === "active" && !target.skipNext && new Date(target.nextRunAt).getTime() === token.runAt) {
      skipPrompt = {
        valid: true,
        subscriptionId: target.id,
        token: skipToken,
        text: format(m.skipLink.text, {
          date: formatDay(target.nextRunAt, locale),
          next: formatDay(nextRunAfter(new Date(target.nextRunAt), target, new Date(target.nextRunAt), anchorDayOf(new Date(target.createdAt))).toISOString(), locale),
        }),
      };
    } else {
      skipPrompt = { valid: false, text: m.skipLink.invalid };
    }
  }

  return (
    <>
      <AccountPageHeader title={m.title} intro={m.intro} />
      <AccountSubscriptions
        locale={locale}
        subscriptions={cards}
        plans={plans.map((p) => ({ id: p.id, name: localize(p.name, locale), percent: p.percent }))}
        provinces={[...TR_PROVINCE_NAMES]}
        skipPrompt={skipPrompt}
        productsHref={href(locale, "products")}
        labels={{
          ...m,
          planSaving: messages.subscriptions.choice.planSaving,
          optional: messages.common.optional,
          select: messages.checkout.form.provincePlaceholder,
        }}
      />
    </>
  );
}

