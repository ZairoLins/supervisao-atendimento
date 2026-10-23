import type { Db } from "@/lib/db";
import { todayInTimeZone } from "@/lib/dates";
import { assertCan, type Actor } from "@/lib/permissions";
import { metricsReportData } from "@/modules/metrics/service";
import { metricsReportFileName, metricsReportTitle, renderMetricsPdf } from "@/modules/reports/metrics-report";
import { occurrencesReportData, occurrencesVars, payrollLabel, payrollPeriod, renderOccurrencesPdf } from "@/modules/reports/occurrences-report";
import type { WhatsAppDocument, WhatsAppSender } from "./client";
import { deliver, renderMessage, timeZone } from "./core";

/** Relatórios enviados ao gestor (PDF gerado na hora, não fica guardado). */

export * from "./core";

const pdfDoc = (buf: Buffer, fileName: string, caption?: string): WhatsAppDocument => ({ base64: buf.toString("base64"), fileName, mimetype: "application/pdf", caption });

/** Ocorrências do período da folha (20 → 19): PDF + resumo em texto. */
export async function sendOccurrencesToManager(db: Db, actor: Actor, raw: { folha?: Date }, sender: WhatsAppSender) {
  assertCan(actor, "messages:send");
  const p = payrollPeriod(raw.folha ?? todayInTimeZone(timeZone()));
  const data = await occurrencesReportData(db, actor, p.from, p.to);
  const pdf = await renderOccurrencesPdf({ ...data, generatedAt: new Date() }, timeZone());
  return deliver(db, actor.id, sender, {
    kind: "OCCURRENCES",
    target: "MANAGER",
    summary: `${payrollLabel(p)} · ${data.total} ocorrência(s)`,
    entityId: p.from.toISOString().slice(0, 10),
    document: pdfDoc(pdf, `ocorrencias-folha-${p.from.toISOString().slice(0, 10)}.pdf`),
    text: await renderMessage(db, "OCCURRENCES", occurrencesVars(data)),
  });
}

/** Relatório mensal de métricas em PDF, com resumo na legenda. */
export async function sendMonthlyMetricsToManager(db: Db, actor: Actor, raw: { month: Date }, sender: WhatsAppSender) {
  assertCan(actor, "messages:send");
  const data = await metricsReportData(db, actor, "mensal", raw.month);
  const report = { ...data, scopeLabel: "Toda a equipe", generatedAt: new Date() };
  const pdf = await renderMetricsPdf(report, timeZone());
  const nf = (n: number | null, d = 0) => (n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const title = metricsReportTitle(report);
  const caption = await renderMessage(db, "MONTHLY_METRICS", {
    mes: title,
    chamados: nf(data.total.tickets),
    tma: nf(data.total.aht, 2),
    nota: nf(data.total.rating, 2),
    avaliacoes: data.total.ratings !== null ? nf(data.total.ratings) : "",
    colaboradores: String(data.rows.length),
    semanas: String(data.weeks),
  });
  return deliver(db, actor.id, sender, {
    kind: "MONTHLY_METRICS",
    target: "MANAGER",
    summary: `${title} · ${data.rows.length} colaborador(es)`,
    entityId: data.periodStart.toISOString().slice(0, 7),
    document: pdfDoc(pdf, metricsReportFileName(report, "pdf"), caption),
  });
}

