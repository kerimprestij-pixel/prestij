import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { defaultAc, userAc } from "better-auth/plugins/admin/access";
import { db } from "@/db";
import { account, rateLimit, session, user, verification } from "@/db/schema";
import {
  AUTH_RATE_LIMIT_RULES,
  SIGN_IN_LOCKED_CODE,
  authIpAddressOptions,
  clearSignInFailures,
  recordSignInFailure,
  signInLockedMinutes,
} from "@/lib/auth-limits";
import { dbLimitStore } from "@/lib/rate-limit-store";
import { sendPasswordResetMail, sendVerificationMail } from "@/lib/auth-emails";
import { onEmailVerified, onPasswordReset } from "@/lib/customer/auth-events";

/**
 * What the panel's team actions need from the admin plugin (src/lib/panel/team/gateway.ts): create
 * users, set roles, ban/unban, set passwords, revoke sessions. Not granted: impersonate, delete, set
 * e-mail/phone and free-form update, which have no audited panel action. The plugin's HTTP endpoints
 * are closed anyway (src/app/api/auth/[...all]/route.ts); this keeps in-process calls minimal too.
 */
const panelAdminAc = defaultAc.newRole({
  user: ["create", "list", "set-role", "ban", "set-password", "get"],
  session: ["list", "revoke", "delete"],
});

/**
 * Roles known to the admin plugin. Only `admin` may use the plugin's user-management endpoints;
 * editor/staff reach the panel through `requireStaff()` (src/lib/session.ts), not through the plugin.
 */
const roles = {
  admin: panelAdminAc,
  editor: userAc,
  staff: userAc,
  customer: userAc,
};

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

/**
 * Customer self-registration is open (with e-mail verification). AUTH_PUBLIC_SIGNUP=false closes it in
 * an emergency; staff accounts (scripts/create-admin.ts, the team panel) are never affected.
 */
const publicSignUpEnabled = process.env.AUTH_PUBLIC_SIGNUP !== "false";

/** Verification links (stateless JWT) are valid for 24 h, password reset links for 1 h (single use). */
const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
const RESET_PASSWORD_TTL_SECONDS = 60 * 60;

export const auth = betterAuth({
  appName: "PRESTİJ",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? siteUrl,
  trustedOrigins: siteUrl ? [siteUrl] : [],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification, rateLimit },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: !publicSignUpEnabled,
    minPasswordLength: 10,
    // No session before the e-mail is confirmed. Staff users are created verified (team service,
    // create-admin, panel-test-user) and existing staff rows were fixed in migration 0003.
    // With this on, Better Auth answers a sign-up for an existing e-mail exactly like a new one (no
    // enumeration), and forgot-password always answers the same.
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: RESET_PASSWORD_TTL_SECONDS,
    // A reset means the old password may be known to someone else: sign out every other device.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url, token }) => sendPasswordResetMail(user, url, token),
    onPasswordReset: async ({ user }) => onPasswordReset(user),
  },
  emailVerification: {
    sendOnSignUp: true,
    // An unverified user who signs in with the right password gets a fresh link (throttled to one
    // mail per 2 minutes per user in auth-emails.ts).
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
    sendVerificationEmail: async ({ user, url, token }) => sendVerificationMail(user, url, token),
    afterEmailVerification: async (user) => onEmailVerified(user),
  },
  // Production only (Better Auth default), keyed on the client IP (see authIpAddressOptions). Stored in
  // Postgres (table rate_limit, schema key `rateLimit`), so the limits hold across instances and
  // restarts. The IP-independent per-e-mail failure limit lives in the hooks below.
  rateLimit: {
    storage: "database",
    customRules: AUTH_RATE_LIMIT_RULES,
  },
  advanced: {
    // Vercel: x-vercel-forwarded-for only. Self-hosting: AUTH_IP_HEADER (a header the reverse proxy
    // overwrites) or x-forwarded-for read from the right past AUTH_TRUSTED_PROXIES. See auth-limits.ts.
    ipAddress: authIpAddressOptions(),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once a day
  },
  user: {
    additionalFields: {
      phone: { type: "string", required: false, input: true },
      locale: { type: "string", required: false, input: true, defaultValue: "tr" },
      // Business linkage and pricing group are assigned by staff, never by the customer.
      companyId: { type: "number", required: false, input: false },
      customerGroupId: { type: "number", required: false, input: false },
      // Not client-writable: consent must come from a verified flow (double opt-in), never a raw sign-up field.
      marketingConsent: { type: "boolean", required: false, input: false, defaultValue: false },
      // When consent was given (KVKK/İYS record); set by the hooks below, never by the client.
      marketingConsentAt: { type: "date", required: false, input: false, returned: false },
    },
  },
  hooks: {
    // Per-e-mail lock after repeated wrong passwords (independent of the client IP; durable DB counters).
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      if ((await signInLockedMinutes(dbLimitStore, ctx.body?.email)) > 0) {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: "Too many failed sign-in attempts. Try again later.",
          code: SIGN_IN_LOCKED_CODE,
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const returned = ctx.context.returned;
      if (isAPIError(returned)) {
        if (returned.statusCode === 401) await recordSignInFailure(dbLimitStore, ctx.body?.email);
      } else if (returned !== undefined) {
        await clearSignInFailures(dbLimitStore, ctx.body?.email);
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (data) =>
          data.marketingConsent === true ? { data: { ...data, marketingConsentAt: new Date() } } : undefined,
      },
      update: {
        before: async (data) =>
          typeof data.marketingConsent === "boolean"
            ? { data: { ...data, marketingConsentAt: data.marketingConsent ? new Date() : null } }
            : undefined,
      },
    },
  },
  plugins: [
    admin({
      defaultRole: "customer",
      adminRoles: ["admin"],
      roles,
    }),
    nextCookies(), // must stay last
  ],
});

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
