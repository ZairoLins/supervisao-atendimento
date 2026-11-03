"use server";

import { db } from "@/lib/db";
import { formToObject, runAction, type ActionState } from "@/lib/action";
import { monthKey, addDays } from "@/lib/dates";
import { correctMetric, deleteMetric, deleteWeekMetrics, saveWeeklyBatch, weekLabel } from "./service";

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
    return { message: "Lançamento atualizado. O valor anterior foi preservado no histórico.", revalidate: ["/desempenho", "/"] };
  });
}

/** Exclui o lançamento. Na página de detalhe (`goBack`), volta para o desempenho do mês. */
export async function deleteMetricAction(id: string, goBack: boolean, _: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const m = await deleteMetric(db, actor, id);
    return {
      message: "Lançamento excluído.",
      redirectTo: goBack ? `/desempenho?mes=${monthKey(addDays(m.weekStart, 4))}&excluido=1` : undefined,
      revalidate: ["/desempenho", "/"],
    };
  });
}

export async function deleteWeekMetricsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async (actor) => {
    const r = await deleteWeekMetrics(db, actor, formToObject(fd));
    return { message: `${r.deleted} lançamento(s) da semana ${weekLabel(r.weekStart)} excluído(s).`, revalidate: ["/desempenho", "/"] };
  });
}
