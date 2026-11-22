// GET /panel/api/newsletter/export?ara=&durum=&kaynak=&dil= — newsletter subscribers as CSV (personal
// data: admin only). Same filters as the /panel/e-bulten list. UTF-8 with BOM, ";" separated (Turkish
// Excel), one audit row per export (filter and row count, no addresses). Never cached.
import { db } from "@/db";
import { safeErrorInfo } from "@/lib/db-errors";
import { getPanelActor } from "@/lib/panel/action";
import { writeAudit } from "@/lib/panel/audit";
import { exportSubscribersCsv } from "@/lib/panel/marketing/newsletter";
import { parseSubscriberFilter } from "@/lib/panel/marketing/newsletter-filter";
import { hasRole } from "@/lib/panel/roles";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  // A download link from the panel is same-origin (or a typed URL: "none"); refuse other sites.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return fail("İstek reddedildi: dışa aktarma yalnızca panelden yapılabilir.", 403);

  const actor = await getPanelActor();
  if (!actor) return fail("Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.", 401);
  if (!hasRole(actor.staffRole, "admin")) return fail("Abone listesini yalnızca yöneticiler dışa aktarabilir.", 403);

  const filter = parseSubscriberFilter(new URL(request.url).searchParams);
  try {
    const { csv, rows } = await db.transaction(async (tx) => {
      const result = await exportSubscribersCsv(tx, filter);
      await writeAudit(tx, {
        actorId: actor.user.id,
        action: "export",
        entity: "newsletter_subscriber",
        after: { rows: result.rows, filter: { ...filter, q: filter.q ? "(arama)" : "" } },
      });
      return result;
    });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
    return new Response(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="e-bulten-aboneleri-${day}.csv"`,
        "X-Row-Count": String(rows),
      },
    });
  } catch (error) {
    console.error("[panel] newsletter export failed", safeErrorInfo(error));
    return fail("Liste şu an dışa aktarılamadı. Biraz sonra tekrar deneyin.", 500);
  }
}
