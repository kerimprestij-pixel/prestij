// GET /panel/api/musteriler/<userId>/export — everything we hold about one customer as a JSON download
// (KVKK m.11 access request). Personal data: admin only, same-origin only, never cached, one audit row
// per export (no personal data in it).
import { db } from "@/db";
import { exportCustomerData } from "@/lib/b2b/customers";
import { safeErrorInfo } from "@/lib/db-errors";
import { getPanelActor } from "@/lib/panel/action";
import { writeAudit } from "@/lib/panel/audit";
import { isPanelError } from "@/lib/panel/errors";
import { hasRole } from "@/lib/panel/roles";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return fail("İstek reddedildi: dışa aktarma yalnızca panelden yapılabilir.", 403);

  const actor = await getPanelActor();
  if (!actor) return fail("Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.", 401);
  if (!hasRole(actor.staffRole, "admin")) return fail("Müşteri verilerini yalnızca yöneticiler dışa aktarabilir.", 403);

  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail("Müşteri bulunamadı.", 404);

  try {
    const data = await db.transaction(async (tx) => {
      const result = await exportCustomerData(tx, id);
      const counts = Object.fromEntries(Object.entries(result).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
      await writeAudit(tx, { actorId: actor.user.id, action: "export", entity: "user", entityId: id, after: { kvkk: true, counts } });
      return result;
    });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="musteri-verisi-${id.slice(0, 12)}-${day}.json"`,
      },
    });
  } catch (error) {
    if (isPanelError(error)) return fail(error.message, error.code === "not_found" ? 404 : 403);
    console.error("[b2b] customer export failed", safeErrorInfo(error));
    return fail("Veriler şu an dışa aktarılamadı. Biraz sonra tekrar deneyin.", 500);
  }
}
