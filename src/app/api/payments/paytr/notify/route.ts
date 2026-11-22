// POST /api/payments/paytr/notify — PayTR's server-to-server notification ("Bildirim URL" in the PayTR
// merchant panel). Verifies the hash, applies the result (completeCardPayment, idempotent per
// merchant_oid) and answers the plain text "OK", also for replays. No session, no cookies.
// Logic: src/lib/payments/{http,callbacks}.ts.
import { paytrNotifyResponse } from "@/lib/payments/http";

export async function POST(request: Request): Promise<Response> {
  return paytrNotifyResponse(request);
}

export function GET(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
