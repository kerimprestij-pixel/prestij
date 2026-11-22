// Where processed media files live. Local disk in development; Supabase Storage in production.
// Server/script use only (Node fs + fetch). Intentionally no "server-only" import so the seed scripts
// can run without the react-server condition.
//
// Local driver, two roots:
//  - build-time media (seed/import scripts): public/media → "/media/<key>", served by Next as public files;
//  - panel uploads at runtime: storage/uploads (LOCAL_UPLOAD_DIR) → "/uploads/<key>", served by the
//    route handler src/app/uploads/[...key]/route.ts. `next start` indexes public/ once at boot
//    (node_modules/next/dist/server/lib/router-utils/filesystem.js: recursiveReadDir(publicFolderPath)
//    only when !dev), so files written to public/ afterwards would 404 until a restart.
//
// Day 6 direct uploads (docs/DAY6-WHEEL-VIDEO.md §1.2): the browser sends each file straight to the
// storage (one file per request, never through a 4.5 MB serverless body) into a staging key under
// "_incoming/", and the server then checks, processes and moves it. The optional adapter methods below
// (createUploadTarget, readRange, read, move, listStale) carry that flow; test fakes may omit them.
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

/** Where and how the browser sends one file (the PUT of a direct upload). */
export type UploadTarget = { method: "PUT"; url: string; headers: Record<string, string> };

export interface StorageAdapter {
  readonly driver: "local" | "supabase";
  /** Writes (or overwrites) `key` and returns its public URL. */
  put(key: string, data: Buffer, contentType: string): Promise<{ url: string }>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
  /** Size of an existing object, or null when it does not exist. */
  stat(key: string): Promise<{ bytes: number } | null>;
  /** Day 6: the browser's PUT target for a staging key (`ticket` = the signed upload ticket). */
  createUploadTarget?(key: string, contentType: string, options: { ticket: string }): Promise<UploadTarget>;
  /** Day 6: bytes `start`..`end` (inclusive) of an object; shorter at the end of the file; null when missing. */
  readRange?(key: string, start: number, end: number): Promise<Buffer | null>;
  /** Day 6: the whole object (refused above `maxBytes`); null when missing. */
  read?(key: string, maxBytes: number): Promise<Buffer | null>;
  /** Day 6: renames an object inside the same storage (staging → final key). */
  move?(from: string, to: string): Promise<void>;
  /** Day 6: keys under `prefix` (e.g. "_incoming/") last written before `olderThan`, at most `limit`. */
  listStale?(prefix: string, olderThan: Date, limit: number): Promise<string[]>;
}

/** Keys are relative, slash-separated paths like "urunler/lavanta/foto-768.webp". */
export function assertValidKey(key: string): void {
  const segments = key.split("/");
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    segments.some((s) => s === "" || s === "." || s === "..") ||
    !/^[\w./-]+$/.test(key)
  ) {
    throw new Error(`Invalid storage key: "${key}"`);
  }
}

/** Day 6: staging prefix of direct uploads (never served, swept after a day). */
export const INCOMING_PREFIX = "_incoming/";

/** Thrown by LocalStorage.writeStream when the body is longer than allowed. */
export class UploadTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Upload exceeds ${maxBytes} bytes`);
    this.name = "UploadTooLargeError";
  }
}

type BodySource = ReadableStream<Uint8Array> | NodeJS.ReadableStream | AsyncIterable<Uint8Array>;

export class LocalStorage implements StorageAdapter {
  readonly driver = "local" as const;

  constructor(
    private readonly root = path.join(process.cwd(), "public", "media"),
    private readonly baseUrl = "/media",
  ) {}

  private file(key: string): string {
    assertValidKey(key);
    return path.join(this.root, ...key.split("/"));
  }

  async put(key: string, data: Buffer): Promise<{ url: string }> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, data);
    return { url: this.publicUrl(key) };
  }

  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
    await this.pruneIncomingDirs(key);
  }

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${this.baseUrl}/${key}`;
  }

  async stat(key: string): Promise<{ bytes: number } | null> {
    try {
      const s = await stat(this.file(key));
      return s.isFile() ? { bytes: s.size } : null;
    } catch {
      return null;
    }
  }

  /**
   * Local driver: the browser PUTs to our own route, which streams the body to disk
   * (src/app/panel/api/media/uploads/local/route.ts). The ticket travels in the query string.
   */
  async createUploadTarget(key: string, contentType: string, { ticket }: { ticket: string }): Promise<UploadTarget> {
    assertValidKey(key);
    return {
      method: "PUT",
      url: `/panel/api/media/uploads/local?ticket=${encodeURIComponent(ticket)}`,
      headers: { "Content-Type": contentType },
    };
  }

  /**
   * Streams `body` into `key` without buffering it: a temporary file next to the target, renamed into
   * place when complete. More than `maxBytes` aborts with UploadTooLargeError (nothing is kept).
   * Returns the number of bytes written.
   */
  async writeStream(key: string, body: BodySource, { maxBytes }: { maxBytes: number }): Promise<number> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.part-${randomBytes(4).toString("hex")}`;
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) callback(new UploadTooLargeError(maxBytes));
        else callback(null, chunk);
      },
    });
    const source =
      typeof (body as ReadableStream<Uint8Array>).getReader === "function"
        ? Readable.fromWeb(body as unknown as NodeWebReadableStream<Uint8Array>)
        : Readable.from(body as AsyncIterable<Uint8Array>);
    try {
      await pipeline(source, limiter, createWriteStream(tmp, { flags: "wx" }));
      await rename(tmp, file);
      return bytes;
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      await this.pruneIncomingDirs(key);
      throw error;
    }
  }

  async readRange(key: string, start: number, end: number): Promise<Buffer | null> {
    const length = Math.max(0, end - start + 1);
    let handle;
    try {
      handle = await open(this.file(key), "r");
    } catch {
      return null;
    }
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async read(key: string, maxBytes: number): Promise<Buffer | null> {
    const info = await this.stat(key);
    if (!info) return null;
    if (info.bytes > maxBytes) throw new UploadTooLargeError(maxBytes);
    return readFile(this.file(key));
  }

  async move(from: string, to: string): Promise<void> {
    const source = this.file(from);
    const target = this.file(to);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(source, target);
    await this.pruneIncomingDirs(from);
  }

  async listStale(prefix: string, olderThan: Date, limit: number): Promise<string[]> {
    const base = prefix.replace(/\/+$/, "");
    assertValidKey(base);
    const out: string[] = [];
    const walk = async (dir: string, keyPrefix: string, depth: number): Promise<void> => {
      if (depth > 4 || out.length >= limit) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= limit) return;
        const full = path.join(dir, entry.name);
        const key = `${keyPrefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(full, key, depth + 1);
        } else if (entry.isFile()) {
          const info = await stat(full).catch(() => null);
          if (info && info.mtime < olderThan) out.push(key);
        }
      }
    };
    await walk(path.join(this.root, ...base.split("/")), base, 0);
    return out;
  }

  /** Removes the now-empty "_incoming/<random>" folder of a staging key (never anything else). */
  private async pruneIncomingDirs(key: string): Promise<void> {
    if (!key.startsWith(INCOMING_PREFIX)) return;
    const parts = key.split("/");
    for (let depth = parts.length - 1; depth >= 2; depth--) {
      const dir = path.join(this.root, ...parts.slice(0, depth));
      try {
        await rmdir(dir); // fails (and stops) when the folder is not empty
      } catch {
        return;
      }
    }
  }
}

/** Writes a file through a temporary name, so a reader never sees half a file. */
async function writeFileAtomic(file: string, data: Buffer): Promise<void> {
  const tmp = `${file}.part-${randomBytes(4).toString("hex")}`;
  const handle = await open(tmp, "wx");
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** A legacy Supabase key (anon / service_role) is a JWT: three base64url parts, the first starting "eyJ". */
export function isLegacyJwtKey(key: string): boolean {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key);
}

/** Lifetime Supabase gives a signed upload URL (createSignedUploadUrl: "valid for 2 hours"). */
export const SUPABASE_SIGNED_UPLOAD_SECONDS = 2 * 3600;

type SupabaseListItem = { name: string; id: string | null; created_at?: string | null; updated_at?: string | null };

/**
 * Supabase Storage via its REST API (no SDK; the request shapes follow the Storage API that
 * @supabase/storage-js calls). The bucket must exist and be public (files are served from
 * /object/public/…). Server-side calls authenticate with SUPABASE_SERVICE_ROLE_KEY: a new secret key
 * (sb_secret_…) goes only in the `apikey` header, a legacy service_role JWT also as `Authorization:
 * Bearer` (supabase.com/docs/guides/api/api-keys).
 */
export class SupabaseStorage implements StorageAdapter {
  readonly driver = "supabase" as const;
  private readonly url: string;
  private readonly serviceKey: string;
  private readonly bucket: string;
  private readonly publishableKey: string | null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !serviceKey) {
      throw new Error(
        "Supabase Storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (and optionally SUPABASE_STORAGE_BUCKET, default \"media\"), or use STORAGE_DRIVER=local.",
      );
    }
    this.url = url;
    this.serviceKey = serviceKey;
    this.bucket = env.SUPABASE_STORAGE_BUCKET?.trim() || "media";
    this.publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() || null;
  }

  private objectUrl(key: string): string {
    assertValidKey(key);
    return `${this.url}/storage/v1/object/${this.bucket}/${key}`;
  }

  /** Server-side auth headers (see the class comment for the key types). */
  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.serviceKey,
      ...(isLegacyJwtKey(this.serviceKey) ? { Authorization: `Bearer ${this.serviceKey}` } : {}),
      ...extra,
    };
  }

  async put(key: string, data: Buffer, contentType: string): Promise<{ url: string }> {
    const res = await fetch(this.objectUrl(key), {
      method: "POST",
      headers: this.headers({
        "Content-Type": contentType,
        "x-upsert": "true",
        // Files are immutable per key (new uploads get new keys), so let CDNs keep them for a year.
        "Cache-Control": "max-age=31536000",
      }),
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Supabase upload failed for "${key}": ${res.status} ${await safeText(res)}`);
    return { url: this.publicUrl(key) };
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(this.objectUrl(key), { method: "DELETE", headers: this.headers() });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Supabase delete failed for "${key}": ${res.status} ${await safeText(res)}`);
    }
  }

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${this.url}/storage/v1/object/public/${this.bucket}/${key}`;
  }

  /** Authenticated HEAD on the object (works for staging keys and private buckets too). */
  async stat(key: string): Promise<{ bytes: number } | null> {
    const res = await fetch(this.objectUrl(key), { method: "HEAD", headers: this.headers() });
    if (!res.ok) return null;
    const bytes = Number(res.headers.get("content-length"));
    return { bytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : 0 };
  }

  /**
   * POST /storage/v1/object/upload/sign/{bucket}/{key} → { url: "/object/upload/sign/{bucket}/{key}?token=…" }.
   * The browser then PUTs the raw file to that URL ("upload files to the bucket without further
   * authentication", valid for 2 hours). No x-upsert: a staging key is new, and an existing object must
   * never be replaced through a ticket. SUPABASE_PUBLISHABLE_KEY (public by design) is sent along only
   * when set, in case the API gateway of the project asks for an `apikey` on that PUT.
   */
  async createUploadTarget(key: string, contentType: string): Promise<UploadTarget> {
    assertValidKey(key);
    const res = await fetch(`${this.url}/storage/v1/object/upload/sign/${this.bucket}/${key}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: "{}",
    });
    if (!res.ok) throw new Error(`Supabase upload signing failed for "${key}": ${res.status} ${await safeText(res)}`);
    const body = (await res.json().catch(() => null)) as { url?: unknown; token?: unknown } | null;
    const relative = typeof body?.url === "string" ? body.url : "";
    if (!relative.startsWith("/")) throw new Error(`Supabase upload signing returned no URL for "${key}"`);
    const signed = new URL(`${this.url}/storage/v1${relative}`);
    const token = typeof body?.token === "string" && body.token ? body.token : signed.searchParams.get("token");
    if (!token) throw new Error(`Supabase upload signing returned no token for "${key}"`);
    signed.searchParams.set("token", token);
    return {
      method: "PUT",
      url: signed.toString(),
      headers: {
        "Content-Type": contentType,
        // Kept by move(): a video's final key is immutable, so CDNs may keep it for a year.
        "Cache-Control": "max-age=31536000",
        "x-upsert": "false",
        ...(this.publishableKey ? { apikey: this.publishableKey } : {}),
      },
    };
  }

  async readRange(key: string, start: number, end: number): Promise<Buffer | null> {
    const want = Math.max(0, end - start + 1);
    const res = await fetch(this.objectUrl(key), { headers: this.headers({ Range: `bytes=${start}-${end}` }) });
    if (res.status === 416) {
      await res.body?.cancel().catch(() => undefined);
      return Buffer.alloc(0);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    // 206 as asked; a server that ignores Range answers 200 with the whole file: skip to `start`.
    const skip = res.status === 206 ? 0 : start;
    return readCapped(res, skip + want).then((buffer) => buffer.subarray(skip, skip + want));
  }

  async read(key: string, maxBytes: number): Promise<Buffer | null> {
    const res = await fetch(this.objectUrl(key), { headers: this.headers() });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new UploadTooLargeError(maxBytes);
    }
    const buffer = await readCapped(res, maxBytes + 1);
    if (buffer.length > maxBytes) throw new UploadTooLargeError(maxBytes);
    return buffer;
  }

  /** POST /storage/v1/object/move { bucketId, sourceKey, destinationKey } (same bucket). */
  async move(from: string, to: string): Promise<void> {
    assertValidKey(from);
    assertValidKey(to);
    const res = await fetch(`${this.url}/storage/v1/object/move`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ bucketId: this.bucket, sourceKey: from, destinationKey: to }),
    });
    if (!res.ok) throw new Error(`Supabase move failed for "${from}": ${res.status} ${await safeText(res)}`);
  }

  /**
   * POST /storage/v1/object/list/{bucket} { prefix, limit, offset, sortBy } lists one folder level: files
   * have an id and created_at, folders have id null. Staging keys are "_incoming/<random>/<name>", so the
   * folders of the prefix are listed one by one (bounded).
   */
  async listStale(prefix: string, olderThan: Date, limit: number): Promise<string[]> {
    const base = prefix.replace(/\/+$/, "");
    assertValidKey(base);
    const out: string[] = [];
    const visit = async (folder: string, depth: number): Promise<void> => {
      if (depth > 2 || out.length >= limit) return;
      const items = await this.list(`${folder}/`, 100);
      for (const item of items) {
        if (out.length >= limit) return;
        const key = `${folder}/${item.name}`;
        if (item.id === null) {
          await visit(key, depth + 1);
        } else {
          const stamp = Date.parse(item.created_at ?? item.updated_at ?? "");
          if (Number.isFinite(stamp) && stamp < olderThan.getTime()) out.push(key);
        }
      }
    };
    await visit(base, 0);
    return out;
  }

  private async list(prefix: string, limit: number): Promise<SupabaseListItem[]> {
    const res = await fetch(`${this.url}/storage/v1/object/list/${this.bucket}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit, offset: 0, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`Supabase list failed for "${prefix}": ${res.status} ${await safeText(res)}`);
    const body = (await res.json().catch(() => null)) as unknown;
    return Array.isArray(body)
      ? body.filter((x): x is SupabaseListItem => Boolean(x) && typeof (x as SupabaseListItem).name === "string")
      : [];
  }
}

/** Reads at most `cap` bytes of a response body, then cancels the rest. */
async function readCapped(res: Response, cap: number): Promise<Buffer> {
  if (!res.body) return Buffer.from(await res.arrayBuffer()).subarray(0, cap);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (total < cap) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(parts).subarray(0, cap);
}

/** A short, log-safe excerpt of an error body (Supabase answers JSON { statusCode, error, message }). */
async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Public URL prefix of runtime uploads on the local driver. */
export const LOCAL_UPLOADS_BASE_URL = "/uploads";

/** Directory of runtime uploads on the local driver (outside public/). */
export function localUploadRoot(): string {
  return process.env.LOCAL_UPLOAD_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "uploads");
}

/** The configured driver name (STORAGE_DRIVER, default "local"). */
export function storageDriver(env: NodeJS.ProcessEnv = process.env): "local" | "supabase" {
  const driver = (env.STORAGE_DRIVER || "local").trim().toLowerCase();
  if (driver !== "local" && driver !== "supabase") throw new Error(`Unknown STORAGE_DRIVER "${driver}" (expected "local" or "supabase").`);
  return driver;
}

/**
 * Day 6: a deployment on Vercel has a read-only file system, so the local driver would fail on the first
 * upload with EROFS. Refuse it up front with a message that says what to set.
 */
export function assertDriverUsable(driver: "local" | "supabase", env: NodeJS.ProcessEnv = process.env): void {
  if (driver === "local" && env.VERCEL) {
    throw new Error(
      "STORAGE_DRIVER=local cannot store uploads on Vercel (read-only file system). Set STORAGE_DRIVER=supabase with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see README, environment variables).",
    );
  }
}

let cached: StorageAdapter | undefined;
let cachedUploads: StorageAdapter | undefined;

/** The configured adapter: STORAGE_DRIVER=local (default) | supabase. */
export function getStorage(): StorageAdapter {
  if (cached) return cached;
  const driver = storageDriver();
  assertDriverUsable(driver);
  cached = driver === "supabase" ? new SupabaseStorage() : new LocalStorage();
  return cached;
}

/** Where panel uploads go: the local uploads root ("/uploads/<key>") or the same Supabase bucket. */
export function getUploadStorage(): StorageAdapter {
  if (cachedUploads) return cachedUploads;
  const base = getStorage();
  cachedUploads = base.driver === "local" ? new LocalStorage(localUploadRoot(), LOCAL_UPLOADS_BASE_URL) : base;
  return cachedUploads;
}

/** The adapter that holds a media row's files (by its public URL), e.g. before deleting them. */
export function storageForMediaUrl(url: string): StorageAdapter {
  const base = getStorage();
  if (base.driver === "local" && (url === LOCAL_UPLOADS_BASE_URL || url.startsWith(`${LOCAL_UPLOADS_BASE_URL}/`))) {
    return getUploadStorage();
  }
  return base;
}
