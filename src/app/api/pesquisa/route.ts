import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentActor } from "@/lib/auth/dal";
import { isValidDateKey, parseDateKey } from "@/lib/dates";
import { globalSearch } from "@/modules/search/service";
import { SEARCH_TYPES } from "@/modules/search/types";

const params = z.object({
  q: z.string().max(100).default(""),
  limite: z.coerce.number().int().min(1).max(50).default(5),
  tipo: z.enum(SEARCH_TYPES).optional(),
  de: z.string().refine(isValidDateKey).optional(),
  ate: z.string().refine(isValidDateKey).optional(),
});

export async function GET(request: NextRequest) {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = params.safeParse(sp);
  if (!parsed.success) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  const p = parsed.data;
  const result = await globalSearch(db, actor, p.q, {
    limit: p.limite,
    types: p.tipo ? [p.tipo] : undefined,
    from: p.de ? parseDateKey(p.de) : undefined,
    to: p.ate ? parseDateKey(p.ate) : undefined,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
