// Day 6: the signed ticket of a direct upload. It carries everything the complete step must trust (the
// staging key, the declared size/type/kind, the folder, the display name and the uploading editor), so
// no DB row is needed between "ticket" and "complete". signToken("media-upload", …, 7200): HMAC with a
// key derived from BETTER_AUTH_SECRET for this purpose only, expiring with Supabase's signed upload URL.
// No "server-only" import so unit tests can load it; it never runs in the browser (node:crypto).
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { MEDIA_KINDS, type MediaKind } from "@/lib/media/types";
import { makeStem } from "@/lib/media/process";
import { assertValidKey, INCOMING_PREFIX } from "@/lib/media/storage";
import { signToken, verifyToken, type TokenSigner } from "@/lib/signed-token";
import { FOLDER_PATTERN } from "../schemas";
import { MEDIA_UPLOAD } from "./types";
import { IMAGE_UPLOAD_TYPES, sanitizeFileName, VIDEO_UPLOAD_TYPES } from "./upload-rules";

export const MEDIA_UPLOAD_TOKEN_PURPOSE = "media-upload";

/** New, never reused file stem: uploads must not overwrite old URLs (the image cache cannot be purged). */
export function uniqueUploadStem(fileName: string): string {
  return `${makeStem(sanitizeFileName(fileName), { unique: false })}-${randomBytes(5).toString("hex")}`;
}

export type UploadTicket = {
  /** Staging key "_incoming/<random>/<safe-name>". */
  key: string;
  /** Declared size in bytes (the stored object must have exactly this size). */
  size: number;
  /** Canonical declared type, e.g. "video/mp4". */
  mime: string;
  kind: MediaKind;
  folder: string;
  /** Display name (sanitized), stored as media.original_name. */
  name: string;
  /** The editor who asked for the ticket; only they can send and complete it. */
  actorId: string;
  expiresAt: Date | null;
};

const MIMES = [...Object.keys(IMAGE_UPLOAD_TYPES), ...Object.keys(VIDEO_UPLOAD_TYPES)] as [string, ...string[]];

/** Short keys: the token travels in a query string on the local driver. */
const payloadSchema = z.object({
  v: z.literal(1),
  k: z.string().min(1).max(300),
  s: z.number().int().positive(),
  t: z.enum(MIMES),
  d: z.enum(MEDIA_KINDS),
  f: z.string().regex(FOLDER_PATTERN),
  n: z.string().min(1).max(120),
  a: z.string().min(1).max(200),
});

const appSigner: Pick<TokenSigner, "signToken" | "verifyToken"> = { signToken, verifyToken };

/** A new staging key for a file: random folder (never reused), URL-safe file name with the canonical extension. */
export function incomingKey(name: string, ext: string, random: string = randomBytes(12).toString("hex")): string {
  const key = `${INCOMING_PREFIX}${random}/${makeStem(name, { unique: false })}.${ext}`;
  assertValidKey(key);
  return key;
}

export function createUploadTicket(
  ticket: Omit<UploadTicket, "expiresAt">,
  signer: Pick<TokenSigner, "signToken"> = appSigner,
  ttlSeconds: number = MEDIA_UPLOAD.direct.ticketSeconds,
): string {
  const payload = payloadSchema.parse({
    v: 1,
    k: ticket.key,
    s: ticket.size,
    t: ticket.mime,
    d: ticket.kind,
    f: ticket.folder,
    n: ticket.name,
    a: ticket.actorId,
  });
  return signer.signToken(MEDIA_UPLOAD_TOKEN_PURPOSE, payload, ttlSeconds);
}

export type ReadTicketResult = { ok: true; ticket: UploadTicket } | { ok: false; error: string; reason: "expired" | "invalid" };

const INVALID = "Yükleme bileti geçersiz. Sayfayı yenileyip dosyayı yeniden yükleyin.";
const EXPIRED = "Yükleme süresi doldu. Dosyayı yeniden yükleyin.";

/**
 * Verifies a ticket (signature, expiry, shape) and that it belongs to `actorId`. The staging key must be
 * a valid key under "_incoming/" (a forged payload can never point at a live file).
 */
export function readUploadTicket(
  token: unknown,
  actorId: string,
  signer: Pick<TokenSigner, "verifyToken"> = appSigner,
): ReadTicketResult {
  const verified = signer.verifyToken(MEDIA_UPLOAD_TOKEN_PURPOSE, token);
  if (!verified.ok) return verified.reason === "expired" ? { ok: false, error: EXPIRED, reason: "expired" } : { ok: false, error: INVALID, reason: "invalid" };
  const parsed = payloadSchema.safeParse(verified.payload);
  if (!parsed.success) return { ok: false, error: INVALID, reason: "invalid" };
  const p = parsed.data;
  if (p.a !== actorId || !p.k.startsWith(INCOMING_PREFIX)) return { ok: false, error: INVALID, reason: "invalid" };
  try {
    assertValidKey(p.k);
  } catch {
    return { ok: false, error: INVALID, reason: "invalid" };
  }
  return {
    ok: true,
    ticket: { key: p.k, size: p.s, mime: p.t, kind: p.d, folder: p.f, name: p.n, actorId: p.a, expiresAt: verified.expiresAt },
  };
}
