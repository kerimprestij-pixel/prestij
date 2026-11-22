// Serving of local-driver uploads (used by ./[...key]/route.ts; not a route itself). Day 6: videos need
// HTTP Range: Safari starts a <video> with `Range: bytes=0-1` and refuses to play from a server that
// answers 200 with the whole file, and every browser seeks with ranges. So: `Accept-Ranges: bytes`
// always, 206 with an exact Content-Range for one satisfiable range, 416 with `bytes */<size>` for an
// unsatisfiable one, the full file for none (or a multi-range / malformed header, which a server may
// ignore). Files are streamed, never read whole; HEAD answers the same headers without a body.
// Keys are validated (assertValidKey + containment check), staging uploads ("_incoming/") are never
// served, only the types the pipeline writes are served, and names are unique per upload, so responses
// are immutable for a year. ETag/Last-Modified allow revalidation and If-Range.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { assertValidKey, INCOMING_PREFIX } from "@/lib/media/storage";

export const UPLOAD_CONTENT_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";

export type ByteRange = { start: number; end: number };

/**
 * One `bytes=` range of a file of `size` bytes: `{ start, end }` (inclusive), "unsatisfiable", or null
 * when the header is absent, malformed or asks for several ranges (then the whole file is sent).
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match) return null;
  const [, first, last] = match;
  if (first === "" && last === "") return null;
  if (first === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (last !== "" && Number(last) < start)) return "unsatisfiable";
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/** The ETag of a stored file (size + mtime; files never change under a key). */
export function uploadEtag(size: number, mtimeMs: number): string {
  return `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

const matchesEtag = (header: string, etag: string) =>
  header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === etag);

/** Answers GET or HEAD for `key` under `root`. */
export async function serveUpload(request: Request, key: string, root: string): Promise<Response> {
  try {
    assertValidKey(key);
  } catch {
    return notFound();
  }
  // Staging files are never public. Case-insensitive: on Windows/macOS file systems "_INCOMING/…" opens the
  // same folder, so any first segment starting with "_" is refused too (reserved for internal folders).
  if (key.toLowerCase().startsWith(INCOMING_PREFIX) || key.startsWith("_")) return notFound();
  const type = UPLOAD_CONTENT_TYPES[key.slice(key.lastIndexOf(".") + 1).toLowerCase()];
  if (!type) return notFound();

  const base = path.resolve(root);
  const file = path.resolve(base, ...key.split("/"));
  if (!file.startsWith(base + path.sep)) return notFound();

  let info;
  try {
    info = await stat(file);
  } catch {
    return notFound();
  }
  if (!info.isFile()) return notFound();

  const size = info.size;
  const etag = uploadEtag(size, info.mtimeMs);
  const lastModified = info.mtime.toUTCString();
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE_IMMUTABLE,
    ETag: etag,
    "Last-Modified": lastModified,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const head = request.method === "HEAD";

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Last-Modified": lastModified, "Cache-Control": CACHE_IMMUTABLE, "Accept-Ranges": "bytes" } });
  }

  // If-Range: honour the Range only while the representation is the one the client already has.
  const ifRange = request.headers.get("if-range");
  const rangeAllowed = !ifRange || ifRange.trim() === etag || ifRange.trim() === lastModified;
  const range = rangeAllowed ? parseRange(request.headers.get("range"), size) : null;

  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}`, "Content-Length": "0" } });
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  const length = size === 0 ? 0 : end - start + 1;
  headers["Content-Length"] = String(length);
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  const status = range ? 206 : 200;

  if (head || length === 0) return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}
