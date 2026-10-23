import ExcelJS from "exceljs";
import { formatDate, formatDateTime, formatMonthLong } from "@/lib/dates";
import { formatCode } from "@/lib/text";
import { pctChange, type Combined, type MetricsPeriod, type MetricsReportRow } from "@/modules/metrics/service";
import { brandedPdf, COLORS, nf, variation } from "./brand";
import { sanitizeCell } from "./render";

const { BLACK, INK, SUBTLE, SOFT, BLUE, BLUE_SOFT } = COLORS;

/** Dados do relatório de métricas (ver metricsReportData). */
export type MetricsReport = {
  kind: MetricsPeriod;
  periodStart: Date;
  periodEnd: Date;
  weeks: number;
  rows: MetricsReportRow[];
  total: Combined;
  previousTotal: Combined;
  scopeLabel: string;
  generatedAt: Date;
};

const TEXTS = {
  semanal: { title: "Relatório semanal de desempenho", prev: "semana anterior", noun: "semana" },
  mensal: { title: "Relatório mensal de desempenho", prev: "mês anterior", noun: "mês" },
};

export function metricsReportTitle(r: Pick<MetricsReport, "kind" | "periodStart" | "periodEnd">) {
  if (r.kind === "semanal") return `Semana de ${formatDate(r.periodStart).slice(0, 5)} a ${formatDate(r.periodEnd)}`;
  const m = formatMonthLong(r.periodStart);
  return `${m.charAt(0).toUpperCase()}${m.slice(1)}`;
}

export function metricsReportFileName(r: Pick<MetricsReport, "kind" | "periodStart">, ext: "pdf" | "xlsx") {
  const d = r.periodStart.toISOString().slice(0, r.kind === "semanal" ? 10 : 7);
  return `relatorio-${r.kind}-${d}.${ext}`;
}

const ratingsLabel = (n: number | null) => (n === null ? "—" : nf(n));

// ───────────────────────────── PDF ─────────────────────────────

/**
 * Relatório de métricas (semanal ou mensal) com identidade visual do sistema.
 * Variações são informativas: setas neutras, sem classificar como bom/ruim.
 */
export async function renderMetricsPdf(r: MetricsReport, timeZone: string): Promise<Buffer> {
  const t = TEXTS[r.kind];
  const b = brandedPdf({ title: t.title, subtitle: metricsReportTitle(r), scope: r.scopeLabel, generatedAt: r.generatedAt, timeZone });
  const { doc, M, CW, BOTTOM } = b;
  let y = b.header(false);

  if (r.rows.length === 0) {
    b.emptyState(y, `Nenhum lançamento ${r.kind === "semanal" ? "nesta semana" : "neste mês"}`, "Lance as métricas na tela Desempenho › Lançar métricas da semana.");
    return b.finish();
  }

  // ── Indicadores ──
  y +=
    b.cards(y, [
      { label: "Chamados", value: nf(r.total.tickets), v: variation(r.total.tickets, r.previousTotal.tickets) },
      { label: "Tempo médio", value: nf(r.total.aht, 2), unit: "min", v: variation(r.total.aht, r.previousTotal.aht) },
      { label: "Nota média", value: nf(r.total.rating, 2), unit: "/ 10", v: variation(r.total.rating, r.previousTotal.rating) },
      { label: "Avaliações", value: ratingsLabel(r.total.ratings), v: variation(r.total.ratings, r.previousTotal.ratings) },
      {
        label: "Equipe",
        value: String(r.rows.length),
        hint: r.kind === "mensal" ? `${r.weeks} semana(s)` : "pessoas",
      },
    ], "") + 26;

  // ── Gráfico: chamados por colaborador ──
  b.sectionTitle("Chamados por colaborador", y);
  y += 24;
  const maxT = Math.max(...r.rows.map((x) => x.tickets), 1);
  const labelW = 150;
  const barMax = CW - labelW - 60;
  for (const row of [...r.rows].sort((a, c) => c.tickets - a.tickets)) {
    if (y + 20 > BOTTOM) y = b.newPage();
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(row.name, M, y + 3, { width: labelW - 10, ellipsis: true, lineBreak: false });
    doc.roundedRect(M + labelW, y + 2, barMax, 12, 6).fill(SOFT);
    doc.roundedRect(M + labelW, y + 2, Math.max(6, (row.tickets / maxT) * barMax), 12, 6).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(nf(row.tickets), M + labelW + barMax + 8, y + 3, { width: 50, lineBreak: false });
    y += 20;
  }
  y += 18;

  // ── Tabela detalhada ──
  if (y + 80 > BOTTOM) y = b.newPage();
  b.sectionTitle("Detalhamento", y);
  y += 24;
  const cols = [
    { label: "Colaborador", w: 0.25, align: "left" as const },
    { label: "Chamados", w: 0.12, align: "right" as const },
    { label: "Var.", w: 0.08, align: "right" as const },
    { label: "TMA", w: 0.1, align: "right" as const },
    { label: "Var.", w: 0.08, align: "right" as const },
    { label: "Avaliações", w: 0.13, align: "right" as const },
    { label: "Nota", w: 0.24, align: "left" as const },
  ];
  const colX: number[] = [];
  let acc = M;
  for (const c of cols) {
    colX.push(acc);
    acc += c.w * CW;
  }
  const cell = (i: number, text: string, yy: number, bold = false) =>
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INK).text(text, colX[i] + 8, yy, { width: cols[i].w * CW - 16, align: cols[i].align, lineBreak: false });
  const tableHeader = () => {
    doc.roundedRect(M, y, CW, 24, 6).fill(BLACK);
    cols.forEach((c, i) => doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(c.label, colX[i] + 8, y + 8, { width: c.w * CW - 16, align: c.align, lineBreak: false }));
    y += 28;
  };
  const ratingBar = (rating: number | null, yy: number) => {
    const bx = colX[6] + 10;
    const bw = cols[6].w * CW - 60;
    doc.roundedRect(bx, yy + 2, bw, 7, 3.5).fill(BLUE_SOFT);
    if (rating !== null) doc.roundedRect(bx, yy + 2, Math.max(4, (rating / 10) * bw), 7, 3.5).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(rating === null ? SUBTLE : INK).text(rating === null ? "—" : nf(rating, 2), bx + bw + 6, yy, { width: 40, lineBreak: false });
  };
  tableHeader();
  r.rows.forEach((row, idx) => {
    if (y + 30 > BOTTOM) {
      y = b.newPage();
      tableHeader();
    }
    if (idx % 2 === 0) doc.rect(M, y - 2, CW, 30).fill(SOFT);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(row.name, colX[0] + 8, y + 3, { width: cols[0].w * CW - 16, height: 11, ellipsis: true });
    const sub = `${formatCode("employee", row.code)} · ${row.team}${r.kind === "mensal" ? ` · ${row.weeks} sem.` : ""}`;
    doc.font("Helvetica").fontSize(7.5).fillColor(SUBTLE).text(sub, colX[0] + 8, y + 15, { width: cols[0].w * CW - 16, height: 9, ellipsis: true });
    cell(1, nf(row.tickets), y + 8);
    b.varCell(colX[2], cols[2].w * CW, y + 8, variation(row.tickets, row.prev?.tickets ?? null));
    cell(3, nf(row.aht, 2), y + 8);
    b.varCell(colX[4], cols[4].w * CW, y + 8, variation(row.aht, row.prev?.aht ?? null));
    cell(5, ratingsLabel(row.ratings), y + 8);
    ratingBar(row.rating, y + 8);
    y += 30;
  });
  if (y + 30 > BOTTOM) y = b.newPage();
  doc.moveTo(M, y + 2).lineTo(M + CW, y + 2).lineWidth(1).strokeColor(INK).stroke();
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text("Total da equipe", colX[0] + 8, y + 10, { lineBreak: false });
  cell(1, nf(r.total.tickets), y + 10, true);
  cell(3, nf(r.total.aht, 2), y + 10, true);
  cell(5, ratingsLabel(r.total.ratings), y + 10, true);
  ratingBar(r.total.rating, y + 10);
  y += 36;

  // ── Observações ──
  const withNotes = r.rows.filter((x) => x.notes?.trim());
  if (withNotes.length) {
    if (y + 60 > BOTTOM) y = b.newPage();
    b.sectionTitle(r.kind === "semanal" ? "Observações da semana" : "Observações do mês", y);
    y += 24;
    for (const row of withNotes) {
      const text = `${row.name}: ${row.notes}`;
      const h = doc.font("Helvetica").fontSize(9).heightOfString(text, { width: CW - 24 }) + 14;
      if (y + h > BOTTOM) y = b.newPage();
      y += b.noteBox(y, text) + 6;
    }
    y += 10;
  }

  if (y + 30 > BOTTOM) y = b.newPage();
  doc
    .font("Helvetica-Oblique")
    .fontSize(7.5)
    .fillColor(SUBTLE)
    .text(
      `Chamados somados; tempo médio ponderado pelo volume de chamados; nota ponderada pela quantidade de avaliações (quem teve mais avaliações pesa mais; semanas sem avaliações não entram). ${
        r.kind === "mensal" ? "O mês reúne as semanas cuja sexta-feira cai nele. " : ""
      }Variações comparam com o ${t.prev} e são apenas informativas — volume maior não indica, por si só, melhor desempenho.`,
      M,
      y,
      { width: CW },
    );
  return b.finish();
}

// ───────────────────────────── Excel ─────────────────────────────

export async function renderMetricsExcel(r: MetricsReport, timeZone: string): Promise<Buffer> {
  const t = TEXTS[r.kind];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Supervisão de Atendimento";
  wb.created = r.generatedAt;
  const ws = wb.addWorksheet(r.kind === "semanal" ? "Semana" : "Mês", { views: [{ showGridLines: false }] });
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  ws.columns = [{ width: 2 }, { width: 34 }, { width: 18 }, { width: 13 }, { width: 11 }, { width: 13 }, { width: 11 }, { width: 13 }, { width: 11 }, { width: 13 }, { width: 40 }];
  const LAST = 11;

  ws.mergeCells(2, 2, 2, LAST);
  ws.getCell("B2").value = t.title;
  ws.getCell("B2").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  ws.mergeCells(3, 2, 3, LAST);
  ws.getCell("B3").value = sanitizeCell(`${metricsReportTitle(r)}  ·  ${r.scopeLabel}`) as string;
  ws.getCell("B3").font = { size: 11, color: { argb: "FFCBD5E1" } };
  ws.mergeCells(4, 2, 4, LAST);
  ws.getCell("B4").value = `Gerado em ${formatDateTime(r.generatedAt, timeZone)}`;
  ws.getCell("B4").font = { size: 9, color: { argb: "FF94A3B8" } };
  for (const row of [2, 3, 4]) for (let c = 2; c <= LAST; c++) ws.getCell(row, c).fill = fill("FF0A0A0A");
  for (let c = 2; c <= LAST; c++) ws.getCell(5, c).fill = fill("FF2563EB");
  ws.getRow(2).height = 30;
  ws.getRow(5).height = 4;

  const kpis: Array<[string, number | null, number | null, string]> = [
    ["Chamados", r.total.tickets, r.previousTotal.tickets, "#,##0"],
    ["Tempo médio (min)", r.total.aht, r.previousTotal.aht, "0.00"],
    ["Avaliação média", r.total.rating, r.previousTotal.rating, "0.00"],
    ["Avaliações", r.total.ratings, r.previousTotal.ratings, "#,##0"],
    ["Colaboradores", r.rows.length, null, "0"],
  ];
  kpis.forEach(([label, value, prev, fmt], i) => {
    const col = 2 + i * 2;
    ws.getCell(7, col).value = label;
    ws.getCell(7, col).font = { size: 9, color: { argb: "FF64748B" } };
    const val = ws.getCell(8, col);
    val.value = value;
    val.numFmt = fmt;
    val.font = { bold: true, size: 16, color: { argb: "FF0B1220" } };
    const p = pctChange(value, prev);
    const v = ws.getCell(9, col);
    v.value = i === 4 ? "" : p === null ? "sem base anterior" : `${p > 0 ? "▲ +" : p < 0 ? "▼ " : ""}${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. ${t.prev}`;
    v.font = { size: 9, color: { argb: p !== null && p > 0 ? "FF2563EB" : "FF475569" } };
  });

  const head = ["Colaborador", "Equipe", "Chamados", "Var. %", "TMA (min)", "Var. %", "Avaliações", "Nota", "Var. %", "Observação"];
  const hr = ws.getRow(11);
  head.forEach((h, i) => {
    const c = hr.getCell(2 + i);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fill("FF2563EB");
    c.alignment = { vertical: "middle", horizontal: i >= 2 && i <= 8 ? "right" : "left" };
  });
  hr.height = 22;
  const pctOrNull = (a: number | null, b: number | null | undefined) => {
    const p = pctChange(a, b ?? null);
    return p === null ? null : Math.round(p * 10) / 1000;
  };
  r.rows.forEach((row, idx) => {
    const xr = ws.getRow(12 + idx);
    const vals = [
      sanitizeCell(row.name),
      sanitizeCell(row.team),
      row.tickets,
      pctOrNull(row.tickets, row.prev?.tickets),
      row.aht,
      pctOrNull(row.aht, row.prev?.aht),
      row.ratings,
      row.rating,
      pctOrNull(row.rating, row.prev?.rating),
      sanitizeCell(row.notes),
    ];
    vals.forEach((v, i) => {
      const c = xr.getCell(2 + i);
      c.value = v;
      if (idx % 2 === 0) c.fill = fill("FFF5F7FB");
      c.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
      if (i === 2 || i === 6) c.numFmt = "#,##0";
      if (i === 4 || i === 7) c.numFmt = "0.00";
      if (i === 3 || i === 5 || i === 8) {
        c.numFmt = "+0.0%;-0.0%;0.0%";
        c.font = { color: { argb: "FF475569" } };
      }
      if (i === 0) c.font = { bold: true };
    });
  });
  const last = 11 + r.rows.length;
  if (r.rows.length) {
    ws.addConditionalFormatting({
      ref: `D12:D${last}`,
      rules: [{ type: "dataBar", priority: 1, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF93C5FD" } } as ExcelJS.DataBarRuleType],
    });
    ws.addConditionalFormatting({
      ref: `I12:I${last}`,
      rules: [{ type: "dataBar", priority: 2, cfvo: [{ type: "num", value: 0 }, { type: "num", value: 10 }], color: { argb: "FF93C5FD" } } as ExcelJS.DataBarRuleType],
    });
    const tr = ws.getRow(last + 1);
    tr.getCell(2).value = "Total da equipe";
    const totals: Array<[number, number | null, string]> = [
      [4, r.total.tickets, "#,##0"],
      [6, r.total.aht, "0.00"],
      [8, r.total.ratings, "#,##0"],
      [9, r.total.rating, "0.00"],
    ];
    for (const [c, v, fmt] of totals) {
      tr.getCell(c).value = v;
      tr.getCell(c).numFmt = fmt;
    }
    for (let c = 2; c <= LAST; c++) {
      tr.getCell(c).font = { bold: true };
      tr.getCell(c).border = { top: { style: "medium", color: { argb: "FF0B1220" } } };
    }
  } else {
    ws.getCell("B12").value = r.kind === "semanal" ? "Nenhum lançamento nesta semana." : "Nenhum lançamento neste mês.";
  }
  const note = ws.getCell(`B${last + 3}`);
  note.value = `Chamados somados; TMA ponderado pelos chamados; nota ponderada pela quantidade de avaliações. Variações em relação ao ${t.prev} (informativas).`;
  note.font = { italic: true, size: 9, color: { argb: "FF64748B" } };
  ws.views = [{ state: "frozen", ySplit: 11, showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
