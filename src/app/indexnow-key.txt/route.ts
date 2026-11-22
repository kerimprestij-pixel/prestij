// GET /indexnow-key.txt — the IndexNow key file (UTF-8 text containing INDEXNOW_KEY) that Bing and
// Yandex fetch to verify our submissions (keyLocation in src/lib/seo/indexnow.ts). 404 while the key is
// unset or invalid. Read at request time (connection()), so setting the variable needs no rebuild.
// The path ends in ".txt", so src/proxy.ts never localizes it (its matcher skips files).
import { connection } from "next/server";
import { readIndexNowKey } from "@/lib/seo/indexnow";

export async function GET(): Promise<Response> {
  await connection();
  const key = readIndexNowKey();
  if (!key) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return new Response(key, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Robots-Tag": "noindex" },
  });
}
