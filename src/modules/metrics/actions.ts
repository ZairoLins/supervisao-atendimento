"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { correctMetric, saveWeeklyBatch } from "./service";

export async function saveWeeklyBatchAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const r = await saveWeeklyBatch(db, actor, formToObject(fd));
    const parts = [r.created && `${r.created} novo(s)`, r.updated && `${r.updated} ajustado(s)`, r.unchanged && `${r.unchanged} sem alteração`].filter(Boolean);
    return { message: `Lançamentos salvos: ${parts.join(", ")}.`, revalidate: ["/desempenho", "/"] };
  });
}

export async function correctMetricAction(id: string, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    await correctMetric(db, actor, id, formToObject(fd));
    return { message: "Correção registrada. O valor anterior foi preservado no histórico.", revalidate: ["/desempenho", "/"] };
  });
}
