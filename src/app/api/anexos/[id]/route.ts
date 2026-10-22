import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentActor } from "@/lib/auth/dal";
import { isAppError } from "@/lib/errors";
import { isUuid } from "@/lib/page";
import { readAttachment } from "@/modules/attendance/occurrences";

/** Anexos privados: exigem sessão e permissão restrita a cada acesso; nunca são públicos. */
export async function GET(_request: Request, ctx: RouteContext<"/api/anexos/[id]">) {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  try {
    const file = await readAttachment(db, actor, id);
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; object-src 'self'",
      },
    });
  } catch (e) {
    if (isAppError(e) && e.code === "FORBIDDEN") return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    if (isAppError(e) && e.code === "NOT_FOUND") return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    console.error("[anexos] erro", e instanceof Error ? e.name : "");
    return NextResponse.json({ error: "Erro ao ler o anexo." }, { status: 500 });
  }
}
