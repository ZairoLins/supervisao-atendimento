import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getCurrentActor } from "@/lib/auth/dal";
import { todayInTimeZone, toDateKey } from "@/lib/dates";
import { isAppError } from "@/lib/errors";
import { buildReport, reportParamsSchema } from "@/modules/reports/service";
import { renderExcel, renderPdf } from "@/modules/reports/render";

export const runtime = "nodejs";

/** Exportação gerada no servidor, com parâmetros validados e permissões verificadas. */
export async function GET(request: NextRequest) {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = reportParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Parâmetros inválidos." }, { status: 400 });
  }
  const tz = env().APP_TIMEZONE;
  try {
    const report = await buildReport(db, actor, parsed.data, todayInTimeZone(tz));
    const fileBase = `${parsed.data.tipo}-${toDateKey(todayInTimeZone(tz))}`;
    if (parsed.data.formato === "xlsx") {
      const buf = await renderExcel(report, tz);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileBase}.xlsx"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    const buf = await renderPdf(report, tz);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileBase}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (isAppError(e)) {
      const status = e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error("[relatorios] erro", e instanceof Error ? e.name : "");
    return NextResponse.json({ error: "Não foi possível gerar o relatório." }, { status: 500 });
  }
}
