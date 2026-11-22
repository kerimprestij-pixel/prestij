// Server check for the /hesap pages (the proxy's cookie check is only optimistic). Reads request
// headers: call it inside <Suspense> in pages.
import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/db";
import type { Locale } from "@/i18n/config";
import { signInHref } from "@/i18n/paths";
import { getSession } from "@/lib/session";
import { isAnonymizedEmail, loadAccountUser, type AccountUser } from "./service";

/**
 * The signed-in customer (fresh row), or a redirect to the sign-in page that returns to `returnTo`.
 * Banned and deleted (anonymized) accounts are treated as signed out.
 */
export async function requireAccountUser(locale: Locale, returnTo: string): Promise<AccountUser> {
  // Request time first: the session check reads the clock (expiry), which a prerender must not do.
  await connection();
  const session = await getSession();
  const userId = session?.user?.id;
  const user = userId && !session.user.banned ? await loadAccountUser(db, userId) : null;
  if (!user || user.banned || isAnonymizedEmail(user.email)) redirect(signInHref(locale, returnTo));
  return user;
}
