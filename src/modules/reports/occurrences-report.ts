import type { Db } from "@/lib/db";
import { addDays, formatDate, formatDuration, formatTimeRange } from "@/lib/dates";
import { REVIEW_STATUS } from "@/lib/labels";
import { assertCan, type Actor } from "@/lib/permissions";
import { formatCode } from "@/lib/text";
import { teamAttendanceSummary } from "@/modules/attendance/occurrences";
import { renderTemplate, TEMPLATES, type TemplateVars } from "@/modules/whatsapp/templates";
import { brandedPdf, COLORS, nf } from "./brand";

const { BLACK, INK, MUTED, SUBTLE, SOFT, BLUE } = COLORS;

/** Dia em que começa o período da folha (20 de um mês até 19 do mês seguinte). */
export const PAYROLL_START_DAY = 20;

/** Período da folha que contém a data: de 20/M a 19/M+1. */
export function payrollPeriod(date: Date): { from: Date; to: Date } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const startMonth = date.getUTCDate() >= PAYROLL_START_DAY ? m : m - 1;
  const from = new Date(Date.UTC(y, startMonth, PAYROLL_START_DAY));
  const to = new Date(Date.UTC(y, startMonth + 1, PAYROLL_START_DAY - 1));
  return { from, to };
}

/** Período da folha anterior ao que contém a data (o "fechado" mais recente). */
export function previousPayrollPeriod(date: Date) {
  return payrollPeriod(addDays(payrollPeriod(date).from, -1));
}

export function payrollLabel(p: { from: Date; to: Date }) {
  return `Folha de ${formatDate(p.from)} a ${formatDate(p.to)}`;
}

export type OccurrencesReport = Awaited<ReturnType<typeof occurrencesReportData>> & { generatedAt: Date };

/**
 * Ocorrências do período por colaborador, para envio ao gestor. Nunca inclui observações
 * (administrativas ou restritas) nem anexos. Ocorrências desconsideradas ficam de fora.
 */
export async function occurrencesReportData(db: Db, actor: Actor, from: Date, to: Date) {
  assertCan(actor, "attendance:read");
  const [summary, occs] = await Promise.all([
    teamAttendanceSummary(db, actor, from, to),
    db.attendanceOccurrence.findMany({
      where: { deletedAt: null, date: { gte: from, lte: to }, reviewStatus: { not: "DISREGARDED" } },
      select: { code: true, date: true, startMinute: true, endMinute: true, reviewStatus: true, employeeId: true, type: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    }),
  ]);
  const byEmployee = summary
    .filter((r) => r.occurrenceCount > 0)
    .map((r) => ({
      employeeId: r.employee.id,
      code: r.employee.code,
      name: r.employee.fullName,
      team: r.employee.team,
      count: r.occurrenceCount,
      absenceMinutes: r.summary.absenceMinutes,
      byType: r.byType,
      items: occs
        .filter((o) => o.employeeId === r.employee.id)
        .map((o) => ({
          code: o.code,
          date: o.date,
          type: o.type.name,
          time: o.startMinute !== null && o.endMinute !== null ? formatTimeRange(o.startMinute, o.endMinute) : "Dia inteiro",
          status: REVIEW_STATUS[o.reviewStatus].label,
          pending: o.reviewStatus === "PENDING",
        })),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
  const byType: Record<string, number> = {};
  for (const o of occs) byType[o.type.name] = (byType[o.type.name] ?? 0) + 1;
  return {
    from,
    to,
    employees: byEmployee,
    total: occs.length,
    pending: occs.filter((o) => o.reviewStatus === "PENDING").length,
    absenceMinutes: byEmployee.reduce((s, e) => s + e.absenceMinutes, 0),
    team: summary.length,
    byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
  };
}

/** Resumo em texto (formatação do WhatsApp) para acompanhar o PDF. */
/** Variáveis do modelo de mensagem "Ocorrências da folha". */
export function occurrencesVars(r: Omit<OccurrencesReport, "generatedAt">): TemplateVars {
  return {
    periodo: payrollLabel(r),
    tem_ocorrencias: r.total ? "sim" : "",
    total: String(r.total),
    colaboradores: String(r.employees.length),
    equipe: String(r.team),
    ausencia: formatDuration(r.absenceMinutes),
    a_conferir: r.pending ? String(r.pending) : "",
    por_tipo: r.byType.map(([t, n]) => `• ${t}: ${n}`).join("\n"),
    por_colaborador: r.employees.map((e) => `• ${e.name}: ${Object.entries(e.byType).map(([t, n]) => `${t} ${n}`).join(", ")}`).join("\n"),
  };
}

/** Resumo com o modelo padrão (o envio usa o modelo editado, se houver). */
export function occurrencesSummaryText(r: Omit<OccurrencesReport, "generatedAt">): string {
  return renderTemplate(TEMPLATES.OCCURRENCES.defaultBody, occurrencesVars(r));
}

export async function renderOccurrencesPdf(r: OccurrencesReport, timeZone: string): Promise<Buffer> {
  const b = brandedPdf({ title: "Ocorrências da folha", subtitle: payrollLabel(r), scope: "Toda a equipe", generatedAt: r.generatedAt, timeZone });
  const { doc, M, CW, BOTTOM } = b;
  let y = b.header(false);
  if (r.total === 0) {
    b.emptyState(y, "Nenhuma ocorrência no período", `Sem registros entre ${formatDate(r.from)} e ${formatDate(r.to)}.`);
    return b.finish();
  }

  y +=
    b.cards(y, [
      { label: "Ocorrências", value: nf(r.total), hint: r.pending ? `${r.pending} a conferir` : "todas conferidas" },
      { label: "Colaboradores", value: nf(r.employees.length), hint: `de ${r.team} na equipe` },
      { label: "Ausência estimada", value: formatDuration(r.absenceMinutes), hint: "pela jornada prevista" },
      { label: "Tipos", value: nf(r.byType.length), hint: r.byType[0] ? `+ comum: ${r.byType[0][0]}` : undefined },
    ]) + 26;

  // ── Por tipo ──
  b.sectionTitle("Ocorrências por tipo", y);
  y += 24;
  const max = Math.max(...r.byType.map(([, n]) => n), 1);
  const labelW = 170;
  const barMax = CW - labelW - 50;
  for (const [type, n] of r.byType) {
    if (y + 20 > BOTTOM) y = b.newPage();
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(type, M, y + 3, { width: labelW - 10, ellipsis: true, lineBreak: false });
    doc.roundedRect(M + labelW, y + 2, barMax, 12, 6).fill(SOFT);
    doc.roundedRect(M + labelW, y + 2, Math.max(6, (n / max) * barMax), 12, 6).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(String(n), M + labelW + barMax + 8, y + 3, { width: 40, lineBreak: false });
    y += 20;
  }
  y += 18;

  // ── Por colaborador ──
  if (y + 80 > BOTTOM) y = b.newPage();
  b.sectionTitle("Detalhamento por colaborador", y);
  y += 26;
  const cols = [
    { label: "Data", x: 0, w: 0.14 },
    { label: "Tipo", x: 0.14, w: 0.34 },
    { label: "Horário", x: 0.48, w: 0.2 },
    { label: "Situação", x: 0.68, w: 0.18 },
    { label: "ID", x: 0.86, w: 0.14 },
  ];
  for (const e of r.employees) {
    if (y + 70 > BOTTOM) y = b.newPage();
    doc.roundedRect(M, y, CW, 30, 6).fill(BLACK);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff").text(e.name, M + 10, y + 6, { width: CW * 0.6, ellipsis: true, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor("#cbd5e1").text(`${formatCode("employee", e.code)} · ${e.team}`, M + 10, y + 18, { width: CW * 0.6, ellipsis: true, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(`${e.count} ocorrência(s) · ausência ${formatDuration(e.absenceMinutes)}`, M, y + 11, { width: CW - 10, align: "right", lineBreak: false });
    y += 34;
    cols.forEach((c) => doc.font("Helvetica-Bold").fontSize(7.5).fillColor(SUBTLE).text(c.label.toUpperCase(), M + c.x * CW + 10, y, { width: c.w * CW - 12, lineBreak: false }));
    y += 13;
    e.items.forEach((o, i) => {
      if (y + 18 > BOTTOM) y = b.newPage();
      if (i % 2 === 0) doc.rect(M, y - 3, CW, 17).fill(SOFT);
      const vals = [formatDate(o.date), o.type, o.time, o.status, formatCode("occurrence", o.code)];
      vals.forEach((v, k) =>
        doc
          .font(k === 1 ? "Helvetica-Bold" : "Helvetica")
          .fontSize(8.5)
          .fillColor(k === 3 && o.pending ? BLUE : k === 4 ? MUTED : INK)
          .text(v, M + cols[k].x * CW + 10, y, { width: cols[k].w * CW - 12, ellipsis: true, lineBreak: false }),
      );
      y += 17;
    });
    y += 14;
  }

  if (y + 30 > BOTTOM) y = b.newPage();
  doc
    .font("Helvetica-Oblique")
    .fontSize(7.5)
    .fillColor(SUBTLE)
    .text(
      "Acompanhamento gerencial: não representa cálculo de descontos salariais nem avaliação jurídica de atestados. Observações, dados médicos e anexos não são incluídos. Ocorrências desconsideradas não aparecem.",
      M,
      y,
      { width: CW },
    );
  return b.finish();
}
