import "server-only";
import { headers } from "next/headers";
import { clientIpFrom } from "./rate-limit";

let warned = false;

/** The trusted client IP (see clientIpFrom). Server Actions and request-time code only. */
export async function clientIp(): Promise<string> {
  if (!warned && process.env.NODE_ENV === "production" && !process.env.VERCEL && !process.env.TRUSTED_IP_HEADER && !process.env.AUTH_IP_HEADER) {
    warned = true;
    // An error, not a warning: without a proxy that overwrites the header, every per-IP durable limit
    // (forms, sign-up, reset, order lookup, callbacks) can be bypassed with a forged X-Forwarded-For.
    console.error(
      "[rate-limit] TRUSTED_IP_HEADER is not set and this is not Vercel: per-IP limits use the last X-Forwarded-For entry, which a client can forge unless a reverse proxy appends or overwrites it. Set TRUSTED_IP_HEADER to the header your proxy overwrites (e.g. x-real-ip).",
    );
  }
  return clientIpFrom(await headers());
}
