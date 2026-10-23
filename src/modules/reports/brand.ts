import PDFDocument from "pdfkit";
import { formatDateTime } from "@/lib/dates";
import { pctChange } from "@/modules/metrics/service";

/**
 * Identidade visual dos relatórios em PDF (preto, branco e azul): cabeçalho com marca,
 * títulos de seção, cartões de indicadores e rodapé paginado.
 */

export const COLORS = {
  BLACK: "#0a0a0a",
  INK: "#0b1220",
  MUTED: "#475569",
  SUBTLE: "#64748b",
  LINE: "#e2e8f0",
  SOFT: "#f5f7fb",
  BLUE: "#2563eb",
  BLUE_SOFT: "#dbeafe",
  SLATE: "#94a3b8",
};
const { BLACK, INK, MUTED, SUBTLE, LINE, SOFT, BLUE, SLATE } = COLORS;

export const nf = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export type Variation = { text: string; dir: "up" | "down" | "flat" | "none" };

export function variation(cur: number | null, prev: number | null): Variation {
  const p = pctChange(cur, prev);
  if (p === null) return { text: "sem base anterior", dir: "none" };
  if (Math.abs(p) < 0.05) return { text: "estável", dir: "flat" };
  return { text: `${p > 0 ? "+" : ""}${p.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, dir: p > 0 ? "up" : "down" };
}

export type BrandedDoc = ReturnType<typeof brandedPdf>;

export function brandedPdf(opts: { title: string; subtitle: string; scope?: string; generatedAt: Date; timeZone: string; landscape?: boolean }) {
  const doc = new PDFDocument({ size: "A4", layout: opts.landscape ? "landscape" : "portrait", margin: 0, bufferPages: true, info: { Title: `${opts.title} — ${opts.subtitle}`, Creator: "Supervisão de Atendimento" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const H = doc.page.height;
  const M = 40;
  const CW = W - 2 * M;
  const BOTTOM = H - 56;

  function header(compact: boolean): number {
    const h = compact ? 54 : 118;
    doc.rect(0, 0, W, h).fill(BLACK);
    doc.rect(0, h, W, 4).fill(BLUE);
    if (compact) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff").text(opts.title, M, 21, { lineBreak: false });
      doc.font("Helvetica").fontSize(10).fillColor("#cbd5e1").text(opts.subtitle, M, 21, { width: CW, align: "right", lineBreak: false });
      return h + 24;
    }
    doc.roundedRect(M, 30, 34, 34, 8).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff").text("S", M, 38, { width: 34, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(SLATE).text("SUPERVISÃO DE ATENDIMENTO", M + 46, 32, { characterSpacing: 1.2, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff").text(opts.title, M + 46, 45, { lineBreak: false });
    doc.font("Helvetica").fontSize(11).fillColor("#cbd5e1").text(opts.scope ? `${opts.subtitle}  ·  ${opts.scope}` : opts.subtitle, M + 46, 72, { lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(SLATE).text(`Gerado em ${formatDateTime(opts.generatedAt, opts.timeZone)}`, M, 96, { width: CW, align: "right", lineBreak: false });
    return h + 28;
  }

  function sectionTitle(text: string, at: number) {
    doc.rect(M, at + 2, 8, 8).fill(BLUE);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(text, M + 16, at, { lineBreak: false });
  }

  function triangle(x: number, yy: number, dir: "up" | "down", color: string) {
    if (dir === "up") doc.polygon([x, yy + 7], [x + 4, yy], [x + 8, yy + 7]).fill(color);
    else doc.polygon([x, yy], [x + 8, yy], [x + 4, yy + 7]).fill(color);
  }

  function drawVariation(x: number, yy: number, v: Variation, suffix: string) {
    let tx = x;
    if (v.dir === "up" || v.dir === "down") {
      triangle(x, yy + 1, v.dir, v.dir === "up" ? BLUE : SLATE);
      tx += 12;
    }
    doc.font("Helvetica").fontSize(8).fillColor(v.dir === "up" ? BLUE : MUTED).text(v.dir === "none" ? v.text : `${v.text} ${suffix}`, tx, yy, { lineBreak: false });
  }

  function varCell(x: number, w: number, yy: number, v: Variation) {
    const label = v.dir === "none" ? "—" : v.dir === "flat" ? "=" : v.text;
    const tw = doc.font("Helvetica").fontSize(8.5).widthOfString(label);
    const right = x + w - 8;
    if (v.dir === "up" || v.dir === "down") triangle(right - tw - 11, yy + 1, v.dir, v.dir === "up" ? BLUE : SLATE);
    doc.fillColor(v.dir === "up" ? BLUE : MUTED).text(label, x + 8, yy, { width: w - 16, align: "right", lineBreak: false });
  }

  /** Cartões de indicadores lado a lado; retorna a altura usada. */
  function cards(y: number, items: Array<{ label: string; value: string; unit?: string; v?: Variation | null; hint?: string }>, suffix = "vs. anterior"): number {
    const gap = 12;
    const cw = (CW - gap * (items.length - 1)) / items.length;
    items.forEach((c, i) => {
      const x = M + i * (cw + gap);
      doc.roundedRect(x, y, cw, 82, 10).fillAndStroke("#ffffff", LINE);
      doc.rect(x, y + 14, 3, 22).fill(BLUE);
      doc.font("Helvetica").fontSize(8.5).fillColor(SUBTLE).text(c.label.toUpperCase(), x + 12, y + 14, { width: cw - 20, height: 11, characterSpacing: 0.4, ellipsis: true });
      doc.font("Helvetica-Bold").fontSize(21).fillColor(INK).text(c.value, x + 12, y + 30, { lineBreak: false });
      if (c.unit) {
        const vw = doc.font("Helvetica-Bold").fontSize(21).widthOfString(c.value);
        doc.font("Helvetica").fontSize(10).fillColor(SUBTLE).text(c.unit, x + 12 + vw + 4, y + 39, { lineBreak: false });
      }
      if (c.v) drawVariation(x + 12, y + 62, c.v, suffix);
      else if (c.hint) doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(c.hint, x + 12, y + 62, { width: cw - 20, height: 10, ellipsis: true });
    });
    return 82;
  }

  /** Caixa de observação com faixa azul; retorna a altura usada. */
  function noteBox(y: number, text: string): number {
    const h = doc.font("Helvetica").fontSize(9).heightOfString(text, { width: CW - 24 }) + 14;
    doc.roundedRect(M, y, CW, h, 8).fill(SOFT);
    doc.rect(M, y, 3, h).fill(BLUE);
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(text, M + 14, y + 7, { width: CW - 24 });
    return h;
  }

  function emptyState(y: number, title: string, text: string) {
    doc.roundedRect(M, y, CW, 120, 12).fill(SOFT);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(title, M, y + 38, { width: CW, align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(text, M, y + 62, { width: CW, align: "center" });
  }

  function newPage(): number {
    doc.addPage({ size: "A4", layout: opts.landscape ? "landscape" : "portrait", margin: 0 });
    return header(true);
  }

  function finish(): Promise<Buffer> {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.moveTo(M, H - 38).lineTo(W - M, H - 38).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font("Helvetica").fontSize(7.5).fillColor(SUBTLE).text(`Supervisão de Atendimento · ${opts.subtitle}`, M, H - 30, { lineBreak: false });
      doc.text(`Página ${i + 1} de ${range.count}`, M, H - 30, { width: CW, align: "right", lineBreak: false });
    }
    doc.end();
    return done;
  }

  return { doc, W, H, M, CW, BOTTOM, header, sectionTitle, triangle, drawVariation, varCell, cards, noteBox, emptyState, newPage, finish };
}
