// Picks the e-mail driver from the environment:
//   EMAIL_DRIVER=outbox  → files in storage/mail-outbox (default outside production)
//   EMAIL_DRIVER=smtp    → nodemailer with EMAIL_SMTP_URL (needs EMAIL_FROM too)
//   unset in production  → "none": mails stay queued and the panel shows a warning.
// On Vercel (env.VERCEL set) the outbox driver is reported not ready: the file system is read-only there,
// so mails stay queued (and the panel says why) instead of failing on every send.
import { createOutboxDriver } from "./outbox";
import { createSmtpDriver } from "./smtp";
import type { EmailDriver, EmailDriverStatus } from "./types";

export type { EmailDriver, EmailDriverName, EmailDriverStatus, EmailSendResult, OutgoingEmail } from "./types";
export { createOutboxDriver, outboxDirectory, outboxFileBase } from "./outbox";

type Env = Record<string, string | undefined>;

/** Used by the outbox driver when EMAIL_FROM is not set (never by SMTP). */
export const LOCAL_FROM_ADDRESS = "siparis@prestij.local";

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

/** True for a single plain address (no display name, no header-injection characters). */
export function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && ADDRESS.test(value) && !/[\r\n]/.test(value);
}

/** The bare address of EMAIL_FROM ("PRESTİJ <siparis@x.com>" or "siparis@x.com"), or null. */
export function parseFromAddress(raw: string | undefined): { name: string | null; address: string } | null {
  const value = (raw ?? "").trim();
  if (!value || /[\r\n]/.test(value)) return null;
  const angle = value.match(/^(.*)<([^<>]+)>\s*$/);
  const address = (angle ? angle[2] : value).trim();
  if (!isEmailAddress(address)) return null;
  const name = angle ? angle[1].trim().replace(/^"(.*)"$/, "$1").trim() : "";
  return { name: name || null, address };
}

/** `"Name" <address>` with the display name sanitized (no quotes, backslashes or line breaks). */
export function formatAddress(name: string | null | undefined, address: string): string {
  const clean = (name ?? "").replace(/[\r\n"\\<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean ? `"${clean}" <${address}>` : address;
}

function configuredDriver(env: Env): string {
  const raw = (env.EMAIL_DRIVER ?? "").trim().toLowerCase();
  if (raw) return raw;
  return env.NODE_ENV === "production" ? "none" : "outbox";
}

/** What the panel shows on /panel/ayarlar/e-posta (never the SMTP URL or any credential). */
export function emailDriverStatus(env: Env = process.env): EmailDriverStatus {
  const driver = configuredDriver(env);
  const from = parseFromAddress(env.EMAIL_FROM);
  if (driver === "outbox") {
    if (env.VERCEL?.trim()) {
      return {
        driver: "outbox",
        ready: false,
        fromAddress: from?.address ?? LOCAL_FROM_ADDRESS,
        problem: "EMAIL_DRIVER=outbox Vercel'da çalışmaz (salt okunur disk). EMAIL_DRIVER=smtp kullanın.",
      };
    }
    return { driver: "outbox", ready: true, fromAddress: from?.address ?? LOCAL_FROM_ADDRESS, problem: null };
  }
  if (driver === "smtp") {
    const problems = [
      env.EMAIL_SMTP_URL?.trim() ? null : "EMAIL_SMTP_URL tanımlı değil.",
      from ? null : "EMAIL_FROM tanımlı değil ya da geçerli bir adres değil.",
    ].filter(Boolean);
    return { driver: "smtp", ready: problems.length === 0, fromAddress: from?.address ?? null, problem: problems.length ? problems.join(" ") : null };
  }
  if (driver === "none") {
    return {
      driver: "none",
      ready: false,
      fromAddress: from?.address ?? null,
      problem: "E-posta gönderimi yapılandırılmadı (EMAIL_DRIVER=smtp ve EMAIL_SMTP_URL gerekli). E-postalar kuyrukta bekliyor.",
    };
  }
  return { driver: "none", ready: false, fromAddress: from?.address ?? null, problem: `Bilinmeyen EMAIL_DRIVER değeri. "outbox" ya da "smtp" olmalı.` };
}

/** The configured driver, or null when nothing can send (mails then stay queued). */
export function getEmailDriver(env: Env = process.env): EmailDriver | null {
  const status = emailDriverStatus(env);
  if (!status.ready) return null;
  if (status.driver === "outbox") return createOutboxDriver();
  if (status.driver === "smtp") return createSmtpDriver(env.EMAIL_SMTP_URL!.trim());
  return null;
}

/** The From header: settings.emails.fromName + the EMAIL_FROM address. */
export function fromHeader(fromName: string | null | undefined, env: Env = process.env): string {
  const from = parseFromAddress(env.EMAIL_FROM);
  return formatAddress(fromName?.trim() || from?.name || "PRESTİJ", from?.address ?? LOCAL_FROM_ADDRESS);
}
