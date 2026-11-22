"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PANEL_LOGIN_PATH } from "@/lib/session";

/** Ends the current session (cookies are cleared through the nextCookies plugin). */
export async function signOutAction(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // No active session: nothing to revoke.
  }
  redirect(PANEL_LOGIN_PATH);
}
