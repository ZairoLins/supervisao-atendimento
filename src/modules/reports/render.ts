import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { formatDateTime } from "@/lib/dates";
import type { ReportCell, ReportData } from "./types";

/**
 * Neutraliza fórmulas maliciosas (CSV/Excel injection): textos iniciados por = + - @,
 * tabulação ou retorno de carro recebem apóstrofo, sendo exibidos como texto.
 */
export function sanitizeCell(value: ReportCell): ReportCell {
  if (typeof value !== "string") return value;
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return /^[=+\-@\t\r]/.test(cleaned) ? `'${cleaned}` : cleaned;
}

export async function renderExcel(report: ReportData, timeZone: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Supervisão de Atendimento";
  wb.created = report.generatedAt;
  const ws = wb.addWorksheet(report.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));

  ws.addRow([sanitizeCell(report.title)]).font = { bold: true, size: 14 };
  for (const m of report.meta) ws.addRow([sanitizeCell(m)]).font = { italic: true, color: { argb: "FF555555" } };
  ws.addRow([`Gerado em ${formatDateTime(report.generatedAt, timeZone)}`]).font = { italic: true, color: { argb: "FF555555" } };
  ws.addRow([]);

  const header = ws.addRow(report.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFE4D6" } };
    cell.border = { bottom: { style: "thin" } };
  });
  const headerRow = header.number;

  for (const row of report.rows) {
    ws.addRow(report.columns.map((c) => sanitizeCell(row[c.key] ?? null)));
  }
  if (report.totals) {
    const t = ws.addRow(report.columns.map((c, i) => sanitizeCell(report.totals?.[c.key] ?? (i === 0 ? "Total" : null))));
    t.font = { bold: true };
  }
  report.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(10, c.width);
    if (c.kind === "decimal") col.numFmt = "0.00";
    if (c.kind === "number") col.numFmt = "0";
  });
  if (report.notes?.length) {
    ws.addRow([]);
    for (const n of report.notes) ws.addRow([sanitizeCell(n)]).font = { italic: true, size: 9 };
  }
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: report.columns.length } };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function cellText(v: ReportCell, kind?: string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return kind === "decimal" ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toLocaleString("pt-BR");
  return v;
}

export async function renderPdf(report: ReportData, timeZone: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: report.title, Creator: "Supervisão de Atendimento" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWidth = report.columns.reduce((s, c) => s + c.width, 0);
  const widths = report.columns.map((c) => (c.width / totalWidth) * usable);
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#100904").text(report.title.toUpperCase(), left, 36);
  doc.moveDown(0.3).font("Helvetica").fontSize(9).fillColor("#555555");
  for (const m of report.meta) doc.text(m);
  doc.text(`Gerado em ${formatDateTime(report.generatedAt, timeZone)}`);
  doc.moveDown(0.8);

  const drawHeader = () => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#40372e");
    let x = left;
    report.columns.forEach((c, i) => {
      doc.text(c.header.toUpperCase(), x + 2, y, { width: widths[i] - 4, align: c.kind ? "right" : "left" });
      x += widths[i];
    });
    const h = Math.max(...report.columns.map((c, i) => doc.heightOfString(c.header.toUpperCase(), { width: widths[i] - 4 })));
    doc.moveTo(left, y + h + 3).lineTo(left + usable, y + h + 3).lineWidth(0.8).strokeColor("#40372e").stroke();
    doc.y = y + h + 7;
  };

  const drawRow = (row: Record<string, ReportCell>, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor("#100904");
    const texts = report.columns.map((c) => cellText(row[c.key] ?? null, c.kind));
    const h = Math.max(...texts.map((t, i) => doc.heightOfString(t, { width: widths[i] - 4 })));
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHeader();
    }
    const y = doc.y;
    let x = left;
    texts.forEach((t, i) => {
      doc.text(t, x + 2, y, { width: widths[i] - 4, align: report.columns[i].kind ? "right" : "left" });
      x += widths[i];
    });
    doc.y = y + h + 4;
    doc.moveTo(left, doc.y - 2).lineTo(left + usable, doc.y - 2).lineWidth(0.3).dash(2, { space: 2 }).strokeColor("#b8a994").stroke().undash();
  };

  drawHeader();
  if (report.rows.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#555555").text("Nenhum registro encontrado para os filtros selecionados.", left, doc.y + 6);
  }
  for (const row of report.rows) drawRow(row);
  if (report.totals) drawRow({ ...report.totals, [report.columns[0].key]: report.totals[report.columns[0].key] ?? "Total" }, true);
  if (report.notes?.length) {
    doc.moveDown(1).font("Helvetica-Oblique").fontSize(7.5).fillColor("#555555");
    for (const n of report.notes) doc.text(n, left, doc.y, { width: usable });
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Zera a margem inferior para o rodapé não gerar página extra
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7).fillColor("#888888").text(`${report.title} · página ${i + 1} de ${range.count}`, left, doc.page.height - 30, { width: usable, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
