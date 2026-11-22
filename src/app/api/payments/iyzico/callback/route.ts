// POST /api/payments/iyzico/callback?o=<order number> — iyzico's hosted payment page makes the buyer's
// browser POST the checkout form `token` here. We retrieve the result from iyzico, verify its signature,
// apply it (completeCardPayment) and answer 303 to the order page. Logic: src/lib/payments/{http,callbacks}.ts.
import { iyzicoCallbackResponse } from "@/lib/payments/http";

export async function POST(request: Request): Promise<Response> {
  return iyzicoCallbackResponse(request);
}

/** Only iyzico's POST is meaningful; a stray GET (e.g. a reload) is refused. */
export function GET(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
