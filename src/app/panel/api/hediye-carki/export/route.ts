// GET /panel/api/hediye-carki/export?durum=&ara= — gift wheel winners as CSV (full e-mail addresses are
// personal data: admin only). Same filters as /panel/hediye-carki/kazananlar. UTF-8 with BOM, ";"
// separated (Turkish Excel), one audit row per export (filter and row count, no addresses). Never cached.
import { db } from "@/db";
import { safeErrorInfo } from "@/lib/db-errors";
import { getPanelActor } from "@/lib/panel/action";
import { writeAudit } from "@/lib/panel/audit";
import { parseWinnerFilter } from "@/lib/panel/gift-wheel/filters";
import { exportWheelWinnersCsv } from "@/lib/panel/gift-wheel/queries";
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
  if (!hasRole(actor.staffRole, "admin")) return fail("Kazanan listesini yalnızca yöneticiler dışa aktarabilir.", 403);

  const filter = parseWinnerFilter(new URL(request.url).searchParams);
  try {
    const { csv, rows } = await db.transaction(async (tx) => {
      const result = await exportWheelWinnersCsv(tx, filter);
      await writeAudit(tx, {
        actorId: actor.user.id,
        action: "export",
        entity: "wheel_spin",
        after: { rows: result.rows, filter: { status: filter.status ?? "all", q: filter.q ? "(arama)" : "" } },
      });
      return result;
    });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
    return new Response(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="hediye-carki-kazananlar-${day}.csv"`,
        "X-Row-Count": String(rows),
      },
    });
  } catch (error) {
    console.error("[panel] gift wheel winners export failed", safeErrorInfo(error));
    return fail("Liste şu an dışa aktarılamadı. Biraz sonra tekrar deneyin.", 500);
  }
}
