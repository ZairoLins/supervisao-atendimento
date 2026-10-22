"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { correctMetric, createMetric } from "./service";

export async function createMetricAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const m = await createMetric(db, actor, formToObject(fd));
    if (fd.get("next") === "1") return { message: "Lançamento salvo. Preencha o próximo.", revalidate: ["/desempenho", "/"] };
    return { redirectTo: `/desempenho/${m.id}?salvo=1`, revalidate: ["/desempenho", "/"] };
  });
}

export async function correctMetricAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await correctMetric(db, actor, id, formToObject(fd));
    return { message: "Correção registrada. O valor anterior foi preservado no histórico.", revalidate: ["/desempenho", "/"] };
  });
}
