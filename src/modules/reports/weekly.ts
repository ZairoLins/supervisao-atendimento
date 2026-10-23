import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { addDays, formatDate, formatDateTime } from "@/lib/dates";
import { formatCode } from "@/lib/text";
import { pctChange, type WeeklyReportRow } from "@/modules/metrics/service";
import { sanitizeCell } from "./render";

/** Dados do relatório semanal (ver weeklyReportData). */
export type WeeklyReport = {
  weekStart: Date;
  weekEnd: Date;
  rows: WeeklyReportRow[];
  total: { tickets: number | null; aht: number | null; rating: number | null; count: number };
  previousTotal: { tickets: number | null; aht: number | null; rating: number | null; count: number };
  scopeLabel: string;
  generatedAt: Date;
};

// Paleta do sistema
const BLACK = "#0a0a0a";
const INK = "#0b1220";
const MUTED = "#475569";
const SUBTLE = "#64748b";
const LINE = "#e2e8f0";
const SOFT = "#f5f7fb";
const BLUE = "#2563eb";
const BLUE_SOFT = "#dbeafe";
const SLATE = "#94a3b8";

const nf = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

function variation(cur: number | null, prev: number | null): { text: string; dir: "up" | "down" | "flat" | "none" } {
  const p = pctChange(cur, prev);
  if (p === null) return { text: "sem base anterior", dir: "none" };
  if (Math.abs(p) < 0.05) return { text: "estável", dir: "flat" };
  return { text: `${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, dir: p > 0 ? "up" : "down" };
}

export function weeklyTitle(r: Pick<WeeklyReport, "weekStart" | "weekEnd">) {
  return `Semana de ${formatDate(r.weekStart).slice(0, 5)} a ${formatDate(r.weekEnd)}`;
}

// ───────────────────────────── PDF ─────────────────────────────

/**
 * Relatório semanal em PDF com identidade visual do sistema (preto, branco e azul).
 * Variações são informativas: setas neutras, sem classificar como bom/ruim.
 */
export async function renderWeeklyPdf(r: WeeklyReport, timeZone: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `Relatório semanal — ${weeklyTitle(r)}`, Creator: "Supervisão de Atendimento" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const CW = W - 2 * M;
  const BOTTOM = H - 56;

  // ── Cabeçalho ──
  const header = (compact: boolean) => {
    const h = compact ? 54 : 118;
    doc.rect(0, 0, W, h).fill(BLACK);
    doc.rect(0, h, W, 4).fill(BLUE);
    if (compact) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff").text("Relatório semanal de desempenho", M, 21, { lineBreak: false });
      doc.font("Helvetica").fontSize(10).fillColor("#cbd5e1").text(weeklyTitle(r), M, 21, { width: CW, align: "right", lineBreak: false });
      return h + 24;
    }
    // Marca: quadrado azul com "S"
    doc.roundedRect(M, 30, 34, 34, 8).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff").text("S", M, 38, { width: 34, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor("#94a3b8").text("SUPERVISÃO DE ATENDIMENTO", M + 46, 32, { characterSpacing: 1.2, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff").text("Relatório semanal de desempenho", M + 46, 45, { lineBreak: false });
    doc.font("Helvetica").fontSize(11).fillColor("#cbd5e1").text(`${weeklyTitle(r)}  ·  ${r.scopeLabel}`, M + 46, 72, { lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor("#94a3b8").text(`Gerado em ${formatDateTime(r.generatedAt, timeZone)}`, M, 96, { width: CW, align: "right", lineBreak: false });
    return h + 28;
  };

  let y = header(false);

  if (r.rows.length === 0) {
    doc.roundedRect(M, y, CW, 120, 12).fill(SOFT);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text("Nenhum lançamento nesta semana", M, y + 38, { width: CW, align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("Lance as métricas da semana na tela Desempenho › Lançar métricas da semana.", M, y + 62, { width: CW, align: "center" });
    return finish();
  }

  // ── Cartões de indicadores ──
  const cards: Array<{ label: string; value: string; unit?: string; v: ReturnType<typeof variation> | null }> = [
    { label: "Chamados", value: nf(r.total.tickets), v: variation(r.total.tickets, r.previousTotal.tickets) },
    { label: "Tempo médio", value: nf(r.total.aht, 2), unit: "min", v: variation(r.total.aht, r.previousTotal.aht) },
    { label: "Avaliação média", value: nf(r.total.rating, 2), unit: "/ 10", v: variation(r.total.rating, r.previousTotal.rating) },
    { label: "Colaboradores", value: String(r.rows.length), v: null },
  ];
  const gap = 12;
  const cw = (CW - gap * 3) / 4;
  cards.forEach((c, i) => {
    const x = M + i * (cw + gap);
    doc.roundedRect(x, y, cw, 82, 10).fillAndStroke("#ffffff", LINE);
    doc.rect(x, y + 14, 3, 22).fill(BLUE);
    doc.font("Helvetica").fontSize(8.5).fillColor(SUBTLE).text(c.label.toUpperCase(), x + 12, y + 14, { width: cw - 20, characterSpacing: 0.4, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(21).fillColor(INK).text(c.value, x + 12, y + 30, { lineBreak: false });
    if (c.unit) {
      const vw = doc.font("Helvetica-Bold").fontSize(21).widthOfString(c.value);
      doc.font("Helvetica").fontSize(10).fillColor(SUBTLE).text(c.unit, x + 12 + vw + 4, y + 39, { lineBreak: false });
    }
    if (c.v) drawVariation(x + 12, y + 62, c.v, "vs. anterior");
  });
  y += 82 + 26;

  // ── Gráfico: chamados por colaborador ──
  sectionTitle("Chamados por colaborador", y);
  y += 24;
  const maxT = Math.max(...r.rows.map((x) => x.tickets), 1);
  const labelW = 150;
  const barMax = CW - labelW - 60;
  const sorted = [...r.rows].sort((a, b) => b.tickets - a.tickets);
  for (const row of sorted) {
    if (y + 20 > BOTTOM) y = newPage();
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(row.name, M, y + 3, { width: labelW - 10, ellipsis: true, lineBreak: false });
    doc.roundedRect(M + labelW, y + 2, barMax, 12, 6).fill(SOFT);
    const w = Math.max(6, (row.tickets / maxT) * barMax);
    doc.roundedRect(M + labelW, y + 2, w, 12, 6).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(nf(row.tickets), M + labelW + barMax + 8, y + 3, { width: 50, lineBreak: false });
    y += 20;
  }
  y += 18;

  // ── Tabela detalhada ──
  if (y + 80 > BOTTOM) y = newPage();
  sectionTitle("Detalhamento", y);
  y += 24;
  const cols = [
    { key: "name", label: "Colaborador", w: 0.3, align: "left" as const },
    { key: "tickets", label: "Chamados", w: 0.13, align: "right" as const },
    { key: "vt", label: "Var.", w: 0.1, align: "right" as const },
    { key: "aht", label: "TMA (min)", w: 0.13, align: "right" as const },
    { key: "va", label: "Var.", w: 0.1, align: "right" as const },
    { key: "rating", label: "Avaliação", w: 0.24, align: "left" as const },
  ];
  const colX: number[] = [];
  let acc = M;
  for (const c of cols) {
    colX.push(acc);
    acc += c.w * CW;
  }
  const tableHeader = () => {
    doc.roundedRect(M, y, CW, 24, 6).fill(BLACK);
    cols.forEach((c, i) => {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(c.label, colX[i] + 8, y + 8, { width: c.w * CW - 16, align: c.align, lineBreak: false });
    });
    y += 28;
  };
  tableHeader();
  r.rows.forEach((row, idx) => {
    if (y + 30 > BOTTOM) {
      y = newPage();
      tableHeader();
    }
    if (idx % 2 === 0) doc.rect(M, y - 2, CW, 30).fill(SOFT);
    const vt = variation(row.tickets, row.prev?.tickets ?? null);
    const va = variation(row.aht, row.prev?.aht ?? null);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(row.name, colX[0] + 8, y + 3, { width: cols[0].w * CW - 16, ellipsis: true, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor(SUBTLE).text(`${formatCode("employee", row.code)} · ${row.team}`, colX[0] + 8, y + 15, { width: cols[0].w * CW - 16, ellipsis: true, lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(nf(row.tickets), colX[1] + 8, y + 8, { width: cols[1].w * CW - 16, align: "right", lineBreak: false });
    varCell(colX[2], cols[2].w * CW, y + 8, vt);
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(nf(row.aht, 2), colX[3] + 8, y + 8, { width: cols[3].w * CW - 16, align: "right", lineBreak: false });
    varCell(colX[4], cols[4].w * CW, y + 8, va);
    // Avaliação: barra 0–10 + valor
    const bx = colX[5] + 10;
    const bw = cols[5].w * CW - 60;
    doc.roundedRect(bx, y + 10, bw, 7, 3.5).fill(BLUE_SOFT);
    doc.roundedRect(bx, y + 10, Math.max(4, (row.rating / 10) * bw), 7, 3.5).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(nf(row.rating, 2), bx + bw + 6, y + 8, { width: 40, lineBreak: false });
    y += 30;
  });
  // Linha de total
  if (y + 30 > BOTTOM) y = newPage();
  doc.moveTo(M, y + 2).lineTo(M + CW, y + 2).lineWidth(1).strokeColor(INK).stroke();
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text("Total da equipe", colX[0] + 8, y + 10, { lineBreak: false });
  doc.text(nf(r.total.tickets), colX[1] + 8, y + 10, { width: cols[1].w * CW - 16, align: "right", lineBreak: false });
  doc.text(nf(r.total.aht, 2), colX[3] + 8, y + 10, { width: cols[3].w * CW - 16, align: "right", lineBreak: false });
  doc.text(nf(r.total.rating, 2), colX[5] + 10, y + 10, { lineBreak: false });
  y += 36;

  // ── Observações ──
  const withNotes = r.rows.filter((x) => x.notes?.trim());
  if (withNotes.length) {
    if (y + 60 > BOTTOM) y = newPage();
    sectionTitle("Observações da semana", y);
    y += 24;
    for (const row of withNotes) {
      const text = `${row.name}: ${row.notes}`;
      const h = doc.font("Helvetica").fontSize(9).heightOfString(text, { width: CW - 24 }) + 14;
      if (y + h > BOTTOM) y = newPage();
      doc.roundedRect(M, y, CW, h, 8).fill(SOFT);
      doc.rect(M, y, 3, h).fill(BLUE);
      doc.font("Helvetica").fontSize(9).fillColor(INK).text(text, M + 14, y + 7, { width: CW - 24 });
      y += h + 6;
    }
    y += 10;
  }

  if (y + 30 > BOTTOM) y = newPage();
  doc
    .font("Helvetica-Oblique")
    .fontSize(7.5)
    .fillColor(SUBTLE)
    .text("Chamados somados; tempo médio e avaliação ponderados pelo volume de chamados. Variações comparam com a semana anterior e são apenas informativas — volume maior não indica, por si só, melhor desempenho.", M, y, { width: CW });

  return finish();

  // ── auxiliares ──
  function sectionTitle(text: string, at: number) {
    doc.rect(M, at + 2, 8, 8).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(text, M + 16, at, { lineBreak: false });
  }
  function triangle(x: number, yy: number, dir: "up" | "down", color: string) {
    if (dir === "up") doc.polygon([x, yy + 7], [x + 4, yy], [x + 8, yy + 7]).fill(color);
    else doc.polygon([x, yy], [x + 8, yy], [x + 4, yy + 7]).fill(color);
  }
  function drawVariation(x: number, yy: number, v: ReturnType<typeof variation>, suffix: string) {
    let tx = x;
    if (v.dir === "up" || v.dir === "down") {
      triangle(x, yy + 1, v.dir, v.dir === "up" ? BLUE : SLATE);
      tx += 12;
    }
    doc.font("Helvetica").fontSize(8).fillColor(v.dir === "up" ? BLUE : MUTED).text(v.dir === "none" ? v.text : `${v.text} ${suffix}`, tx, yy, { lineBreak: false });
  }
  function varCell(x: number, w: number, yy: number, v: ReturnType<typeof variation>) {
    const label = v.dir === "none" ? "—" : v.dir === "flat" ? "=" : v.text;
    const tw = doc.font("Helvetica").fontSize(8.5).widthOfString(label);
    const right = x + w - 8;
    if (v.dir === "up" || v.dir === "down") triangle(right - tw - 11, yy + 1, v.dir, v.dir === "up" ? BLUE : SLATE);
    doc.fillColor(v.dir === "up" ? BLUE : MUTED).text(label, x + 8, yy, { width: w - 16, align: "right", lineBreak: false });
  }
  function newPage() {
    doc.addPage({ size: "A4", margin: 0 });
    return header(true);
  }
  function finish(): Promise<Buffer> {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.moveTo(M, H - 38).lineTo(W - M, H - 38).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor(SUBTLE).text(`Supervisão de Atendimento · ${weeklyTitle(r)}`, M, H - 30, { lineBreak: false });
      doc.text(`Página ${i + 1} de ${range.count}`, M, H - 30, { width: CW, align: "right", lineBreak: false });
    }
    doc.end();
    return done;
  }
}

// ───────────────────────────── Excel ─────────────────────────────

export async function renderWeeklyExcel(r: WeeklyReport, timeZone: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Supervisão de Atendimento";
  wb.created = r.generatedAt;
  const ws = wb.addWorksheet("Semana", { views: [{ showGridLines: false }] });
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  ws.columns = [{ width: 2 }, { width: 34 }, { width: 18 }, { width: 13 }, { width: 11 }, { width: 13 }, { width: 11 }, { width: 13 }, { width: 11 }, { width: 40 }];

  // Faixa de título
  ws.mergeCells("B2:J2");
  ws.getCell("B2").value = "Relatório semanal de desempenho";
  ws.getCell("B2").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  ws.mergeCells("B3:J3");
  ws.getCell("B3").value = sanitizeCell(`${weeklyTitle(r)}  ·  ${r.scopeLabel}`) as string;
  ws.getCell("B3").font = { size: 11, color: { argb: "FFCBD5E1" } };
  ws.mergeCells("B4:J4");
  ws.getCell("B4").value = `Gerado em ${formatDateTime(r.generatedAt, timeZone)}`;
  ws.getCell("B4").font = { size: 9, color: { argb: "FF94A3B8" } };
  for (const row of [2, 3, 4]) for (let c = 2; c <= 10; c++) ws.getCell(row, c).fill = fill("FF0A0A0A");
  for (let c = 2; c <= 10; c++) ws.getCell(5, c).fill = fill("FF2563EB");
  ws.getRow(2).height = 30;
  ws.getRow(5).height = 4;

  // Indicadores
  const kpis: Array<[string, number | null, string]> = [
    ["Chamados", r.total.tickets, "#,##0"],
    ["Tempo médio (min)", r.total.aht, "0.00"],
    ["Avaliação média", r.total.rating, "0.00"],
    ["Colaboradores", r.rows.length, "0"],
  ];
  kpis.forEach(([label, value, fmt], i) => {
    const col = 2 + i * 2;
    const lab = ws.getCell(7, col);
    lab.value = label;
    lab.font = { size: 9, color: { argb: "FF64748B" } };
    const val = ws.getCell(8, col);
    val.value = value;
    val.numFmt = fmt;
    val.font = { bold: true, size: 16, color: { argb: "FF0B1220" } };
    const prev = [r.previousTotal.tickets, r.previousTotal.aht, r.previousTotal.rating, null][i];
    const p = pctChange(value, prev);
    const v = ws.getCell(9, col);
    v.value = p === null ? (i < 3 ? "sem base anterior" : "") : `${p > 0 ? "▲ +" : p < 0 ? "▼ " : ""}${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. semana anterior`;
    v.font = { size: 9, color: { argb: p !== null && p > 0 ? "FF2563EB" : "FF475569" } };
  });

  // Tabela
  const head = ["Colaborador", "Equipe", "Chamados", "Var. %", "TMA (min)", "Var. %", "Avaliação", "Var. %", "Observação"];
  const hr = ws.getRow(11);
  head.forEach((h, i) => {
    const c = hr.getCell(2 + i);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fill("FF2563EB");
    c.alignment = { vertical: "middle", horizontal: i >= 2 && i <= 7 ? "right" : "left" };
  });
  hr.height = 22;
  const pctOrNull = (a: number, b: number | undefined) => {
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
      row.rating,
      pctOrNull(row.rating, row.prev?.rating),
      sanitizeCell(row.notes),
    ];
    vals.forEach((v, i) => {
      const c = xr.getCell(2 + i);
      c.value = v;
      if (idx % 2 === 0) c.fill = fill("FFF5F7FB");
      c.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
      if (i === 2) c.numFmt = "#,##0";
      if (i === 4 || i === 6) c.numFmt = "0.00";
      if (i === 3 || i === 5 || i === 7) {
        c.numFmt = '+0.0%;-0.0%;0.0%';
        c.font = { color: { argb: "FF475569" } };
      }
      if (i === 0) c.font = { bold: true };
    });
  });
  const last = 11 + r.rows.length;
  if (r.rows.length) {
    // Barras de dados nas colunas de chamados e avaliação
    ws.addConditionalFormatting({
      ref: `D12:D${last}`,
      rules: [{ type: "dataBar", priority: 1, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF93C5FD" } } as ExcelJS.DataBarRuleType],
    });
    ws.addConditionalFormatting({
      ref: `H12:H${last}`,
      rules: [{ type: "dataBar", priority: 2, cfvo: [{ type: "num", value: 0 }, { type: "num", value: 10 }], color: { argb: "FF93C5FD" } } as ExcelJS.DataBarRuleType],
    });
    const t = ws.getRow(last + 1);
    t.getCell(2).value = "Total da equipe";
    t.getCell(4).value = r.total.tickets;
    t.getCell(4).numFmt = "#,##0";
    t.getCell(6).value = r.total.aht;
    t.getCell(6).numFmt = "0.00";
    t.getCell(8).value = r.total.rating;
    t.getCell(8).numFmt = "0.00";
    for (let c = 2; c <= 10; c++) {
      t.getCell(c).font = { bold: true };
      t.getCell(c).border = { top: { style: "medium", color: { argb: "FF0B1220" } } };
    }
  } else {
    ws.getCell("B12").value = "Nenhum lançamento nesta semana.";
  }
  const note = ws.getCell(`B${last + 3}`);
  note.value = "Chamados somados; tempo médio e avaliação ponderados pelos chamados. Variações em relação à semana anterior (informativas).";
  note.font = { italic: true, size: 9, color: { argb: "FF64748B" } };
  ws.views = [{ state: "frozen", ySplit: 11, showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export function weekEndOf(weekStart: Date) {
  return addDays(weekStart, 6);
}
