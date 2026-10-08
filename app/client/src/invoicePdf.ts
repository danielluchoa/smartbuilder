import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Styled invoice PDF — a 1:1 export of the on-screen invoice sheet.
 *
 * The same layout the app renders in InvoiceDetail is drawn here with
 * vector graphics: an accent-colored header band (with the company logo
 * embedded when one is uploaded), the Bill-to block and aligned invoice
 * metadata, the Ref. band, a proper items table (accent header row, zebra
 * striping, Description / Quantity / Rate / Amount), the
 * Subtotal / Total / Paid rows, and the Balance Due highlighted in a
 * colored box. Labels arrive already localized (EN/PT follows the app
 * language toggle); amounts are always formatted as USD by the caller.
 */

type Rgb = ReturnType<typeof rgb>;

export type InvoicePdfLabels = {
  billTo: string;
  invoiceNumber: string;
  terms: string;
  invoiceDate: string;
  dueDate: string;
  ref: string;
  description: string;
  quantity: string;
  rate: string;
  amount: string;
  subtotal: string;
  total: string;
  paid: string;
  balanceDue: string;
  noClient: string;
  noItems: string;
};

export type InvoicePdfInput = {
  companyName: string;
  from: { name: string; address: string; phone: string; email: string; logoUrl: string } | null;
  billTo: { name: string; contactName: string; phone: string; email: string; email2: string; address: string } | null;
  invoice: {
    number: string;
    terms: string;
    issueDate: string;
    dueDate: string;
    projectAddress: string;
    projectName: string;
    status: string;
    statusLabel: string;
  };
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  total: number;
  paid: number;
  balance: number;
  accentHex: string;
  labels: InvoicePdfLabels;
  formatMoney: (cents: number) => string;
  formatDate: (iso: string) => string;
};

/* ---------------- color + text helpers ---------------- */

const WHITE: Rgb = rgb(1, 1, 1);
const INK: Rgb = rgb(0x12 / 255, 0x22 / 255, 0x2f / 255);
const SLATE: Rgb = rgb(0x33 / 255, 0x41 / 255, 0x55 / 255);
const MUTED: Rgb = rgb(0x5b / 255, 0x6b / 255, 0x7a / 255);
const GREEN_700: Rgb = rgb(0x15 / 255, 0x80 / 255, 0x3d / 255);
const ZEBRA: Rgb = rgb(0xf8 / 255, 0xfa / 255, 0xfc / 255);
const ROW_LINE: Rgb = rgb(0xe2 / 255, 0xe8 / 255, 0xf0 / 255);

function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return rgb(0xf9 / 255, 0x73 / 255, 0x16 / 255);
  const n = parseInt(m[1]!, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Mix two colors: `t` of `b` over `a`. Used for the accent tints and the
 *  white/85 header sub-lines the screen draws over the accent band. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return rgb(
    a.red + (b.red - a.red) * t,
    a.green + (b.green - a.green) * t,
    a.blue + (b.blue - a.blue) * t,
  );
}

/* Standard PDF fonts speak WinAnsi. Keep every character WinAnsi can
   encode (Latin-1 plus its punctuation set, which covers PT accents,
   “•”, “—”, “…”); anything else (emoji, symbols) is dropped instead of
   throwing mid-export. */
const WINANSI_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
function safeText(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0xff || WINANSI_EXTRA.has(cp)) out += ch;
    else if (cp === 0x00a0) out += " ";
  }
  return out;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = safeText(text).replace(/\s+\n/g, "\n").trim();
  if (!clean) return [];
  const lines: string[] = [];
  for (const paragraph of clean.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
        continue;
      }
      lines.push(line);
      /* A single word wider than the column is hard-split so it can
         never spill past the cell edge. */
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) { lines.push(chunk); chunk = ""; }
          chunk += ch;
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawText(page: PDFPage, text: string, x: number, baselineY: number, font: PDFFont, size: number, color: Rgb) {
  const t = safeText(text);
  if (!t) return;
  page.drawText(t, { x, y: baselineY, size, font, color });
}

function drawRight(page: PDFPage, text: string, rightX: number, baselineY: number, font: PDFFont, size: number, color: Rgb) {
  const t = safeText(text);
  if (!t) return;
  page.drawText(t, { x: rightX - font.widthOfTextAtSize(t, size), y: baselineY, size, font, color });
}

/* ---------------- image ---------------- */

function dataUrlBytes(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    const raw = m[3] ?? "";
    const bin = m[2] ? atob(raw) : decodeURIComponent(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: (m[1] ?? "").toLowerCase(), bytes };
  } catch {
    return null;
  }
}

/* ---------------- the document ---------------- */

const PAGE_W = 612;
const PAGE_H = 792;
const BORDER = 36;
const X = 48;
const RIGHT = PAGE_W - X; // 564
const WIDTH = RIGHT - X; // 516

export async function makeStyledInvoicePdf(input: InvoicePdfInput): Promise<Blob> {
  const { labels } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${input.invoice.number}`);
  doc.setAuthor(input.from?.name || input.companyName);
  doc.setCreator("SmartBuilder");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const accent = hexToRgb(input.accentHex);
  const accentTint = mix(WHITE, accent, 0x14 / 255); // the screen's `${accent}14`
  const accentTintStrong = mix(WHITE, accent, 0x26 / 255); // `${accent}26`
  const onAccentSoft = mix(accent, WHITE, 0.85); // white/85 text on the band
  const onAccentFaint = mix(accent, WHITE, 0.7);

  let page = doc.addPage([PAGE_W, PAGE_H]);

  const drawOuterBorder = (p: PDFPage) => {
    p.drawRectangle({
      x: BORDER, y: BORDER, width: PAGE_W - BORDER * 2, height: PAGE_H - BORDER * 2,
      borderColor: accent, borderWidth: 2,
    });
  };
  drawOuterBorder(page);

  /* ---- header band (accent) with embedded logo ---- */
  const logo = await (async () => {
    const url = input.from?.logoUrl ?? "";
    if (!url.startsWith("data:image/")) return null;
    const decoded = dataUrlBytes(url);
    if (!decoded) return null;
    try {
      if (decoded.mime.includes("png")) return await doc.embedPng(decoded.bytes);
      if (decoded.mime.includes("jpg") || decoded.mime.includes("jpeg")) return await doc.embedJpg(decoded.bytes);
    } catch {
      return null;
    }
    return null;
  })();

  const HEADER_TOP = PAGE_H - X; // 744
  /* Logo box wraps the image the way the screen's white logo chip does:
     image capped at 120×44, white padding around it, company text after. */
  const logoSize = logo
    ? (() => {
        const scale = Math.min(120 / logo.width, 44 / logo.height, 1);
        const w = Math.max(1, Math.round(logo.width * scale));
        const h = Math.max(1, Math.round(logo.height * scale));
        return { w, h, boxW: w + 10, boxH: h + 8 };
      })()
    : null;
  const headerTextX = logoSize ? X + 16 + logoSize.boxW + 12 : X + 16;
  const headerTextW = RIGHT - 16 - headerTextX;

  const companyName = (input.from?.name || input.companyName).toUpperCase();
  /* Shrink the company name until it fits on one line, like the screen's
     truncating headline; only very long names wrap to a second line. */
  let nameSize = 19;
  while (nameSize > 11 && bold.widthOfTextAtSize(safeText(companyName), nameSize) > headerTextW) nameSize -= 1;
  const nameLines = wrapText(companyName, bold, nameSize, headerTextW).slice(0, 2);
  const addressLines = input.from?.address ? wrapText(input.from.address, regular, 10, headerTextW).slice(0, 2) : [];
  const contactLine = [input.from?.phone, input.from?.email].filter(Boolean).join(" • ");
  const textBlockH = nameLines.length * (nameSize + 3) + (addressLines.length ? addressLines.length * 12 + 2 : 0) + (contactLine ? 13 : 0);
  const headerHeight = Math.max(textBlockH, logoSize ? logoSize.boxH : 0) + 24;
  const headerBottom = HEADER_TOP - headerHeight;

  page.drawRectangle({ x: X, y: headerBottom, width: WIDTH, height: headerHeight, color: accent });

  if (logo && logoSize) {
    const boxX = X + 16;
    const boxY = headerBottom + (headerHeight - logoSize.boxH) / 2;
    page.drawRectangle({ x: boxX, y: boxY, width: logoSize.boxW, height: logoSize.boxH, color: WHITE });
    page.drawImage(logo, {
      x: boxX + (logoSize.boxW - logoSize.w) / 2,
      y: boxY + (logoSize.boxH - logoSize.h) / 2,
      width: logoSize.w,
      height: logoSize.h,
    });
  }

  let hy = HEADER_TOP - 12 - (logoSize ? Math.max(0, (logoSize.boxH - textBlockH) / 2) : 0);
  for (const line of nameLines) {
    hy -= nameSize;
    drawText(page, line, headerTextX, hy, bold, nameSize, WHITE);
    hy -= 3;
  }
  for (const line of addressLines) {
    hy -= 10;
    drawText(page, line, headerTextX, hy, regular, 10, WHITE);
    hy -= 2;
  }
  if (contactLine) {
    hy -= 9.5;
    drawText(page, contactLine, headerTextX, hy, regular, 9.5, onAccentSoft);
  }
  /* A whisper of the screen's muted hint when no address is on file would
     just waste band space in a PDF — the band simply stays shorter. */
  void onAccentFaint;

  let y = headerBottom - 20;

  /* ---- Bill to (left) + invoice metadata (right, aligned) ---- */
  const sectionTop = y;
  // Left column
  let ly = sectionTop;
  page.drawRectangle({ x: X, y: ly - 13, width: 3, height: 13, color: accent });
  drawText(page, labels.billTo, X + 9, ly - 10, bold, 8, accent);
  ly -= 14;
  const billLines: Array<{ text: string; font: PDFFont; size: number; color: Rgb; leading: number }> = [];
  if (input.billTo) {
    const b = input.billTo;
    billLines.push({ text: b.phone ? `${b.name} (${b.phone})` : b.name, font: bold, size: 11, color: INK, leading: 14 });
    if (b.contactName && b.contactName !== b.name) billLines.push({ text: `Attn: ${b.contactName}`, font: regular, size: 9.5, color: SLATE, leading: 12 });
    if (b.address) for (const l of wrapText(b.address, regular, 9.5, 250)) billLines.push({ text: l, font: regular, size: 9.5, color: SLATE, leading: 12 });
    if (b.email) billLines.push({ text: b.email, font: regular, size: 9.5, color: SLATE, leading: 12 });
    if (b.email2) billLines.push({ text: b.email2, font: regular, size: 9.5, color: SLATE, leading: 12 });
  } else {
    billLines.push({ text: labels.noClient, font: regular, size: 9.5, color: MUTED, leading: 12 });
  }
  for (const l of billLines) {
    ly -= l.size;
    drawText(page, l.text, X, ly, l.font, l.size, l.color);
    ly -= l.leading - l.size;
  }
  const leftBottom = ly;

  // Right column — labels aligned on a shared edge, values right-aligned.
  const labelRight = RIGHT - 118;
  let ry = sectionTop;
  const metaRows: Array<{ label: string; value: string; valueFont: PDFFont; valueColor: Rgb }> = [
    { label: labels.invoiceNumber, value: input.invoice.number, valueFont: bold, valueColor: accent },
    { label: labels.terms, value: input.invoice.terms, valueFont: regular, valueColor: INK },
    { label: labels.invoiceDate, value: input.formatDate(input.invoice.issueDate), valueFont: regular, valueColor: INK },
    { label: labels.dueDate, value: input.formatDate(input.invoice.dueDate), valueFont: regular, valueColor: INK },
  ];
  for (const row of metaRows) {
    ry -= 9.5;
    drawRight(page, row.label, labelRight, ry, bold, 9.5, SLATE);
    drawRight(page, row.value, RIGHT, ry, row.valueFont, row.valueFont === bold ? 10.5 : 9.5, row.valueColor);
    ry -= 6;
  }
  // Status pill, echoing the screen's badge under the metadata.
  const statusText = input.invoice.statusLabel;
  if (statusText) {
    const pillW = bold.widthOfTextAtSize(safeText(statusText), 7.5) + 16;
    const pillX = RIGHT - pillW;
    const pillY = ry - 15;
    const tone = input.invoice.status === "paga"
      ? { bg: rgb(0xdc / 255, 0xfc / 255, 0xe7 / 255), fg: rgb(0x16 / 255, 0x65 / 255, 0x2d / 255) }
      : input.invoice.status === "parcial"
        ? { bg: rgb(0xfe / 255, 0xf3 / 255, 0xc7 / 255), fg: rgb(0x92 / 255, 0x40 / 255, 0x0e / 255) }
        : input.invoice.status === "vencida"
          ? { bg: rgb(0xfe / 255, 0xe2 / 255, 0xe2 / 255), fg: rgb(0xb9 / 255, 0x1c / 255, 0x1c / 255) }
          : { bg: rgb(0xf3 / 255, 0xf4 / 255, 0xf6 / 255), fg: rgb(0x4b / 255, 0x55 / 255, 0x63 / 255) };
    page.drawRectangle({ x: pillX, y: pillY, width: pillW, height: 15, color: tone.bg });
    drawText(page, statusText, pillX + 8, pillY + 4.5, bold, 7.5, tone.fg);
    ry = pillY;
  }
  const rightBottom = ry;

  y = Math.min(leftBottom, rightBottom) - 12;
  page.drawRectangle({ x: X, y, width: WIDTH, height: 1.6, color: accent });
  y -= 4;

  /* ---- Ref. band ---- */
  if (input.invoice.projectAddress) {
    const refText = `${input.invoice.projectAddress}${input.invoice.projectName ? ` — ${input.invoice.projectName}` : ""}`;
    const refLabel = labels.ref;
    const refLabelW = bold.widthOfTextAtSize(safeText(refLabel), 9.5) + 4;
    const restLines = wrapText(refText, regular, 9.5, WIDTH - 20 - refLabelW);
    const tailLines: string[] = [];
    if (restLines.length > 1) {
      // Re-wrap the overflow at full band width for lines 2+.
      const first = restLines[0]!;
      const remainder = refText.slice(refText.indexOf(first) + first.length).trim();
      tailLines.push(...wrapText(remainder, regular, 9.5, WIDTH - 20));
      restLines.length = 1;
    }
    const allLines = [...restLines, ...tailLines];
    const bandH = allLines.length * 12 + 14;
    y -= bandH;
    page.drawRectangle({ x: X, y, width: WIDTH, height: bandH, color: accentTint });
    page.drawRectangle({ x: X, y, width: 4, height: bandH, color: accent });
    let ty = y + bandH - 7;
    allLines.forEach((line, i) => {
      ty -= 9.5;
      if (i === 0) {
        drawText(page, refLabel, X + 10, ty, bold, 9.5, accent);
        drawText(page, line, X + 10 + refLabelW, ty, regular, 9.5, INK);
      } else {
        drawText(page, line, X + 10, ty, regular, 9.5, INK);
      }
      ty -= 2.5;
    });
  }

  y -= 18;

  /* ---- items table ---- */
  const colDescX = X + 10;
  const colDescW = 262;
  const qtyRight = X + 372;
  const rateRight = X + 452;
  const amountRight = RIGHT - 10;

  const drawTableHeader = (topY: number): number => {
    const h = 25;
    page.drawRectangle({ x: X, y: topY - h, width: WIDTH, height: h, borderColor: accentTintStrong, borderWidth: 0.5, color: accent });
    const base = topY - 16.5;
    drawText(page, labels.description, colDescX, base, bold, 7.5, WHITE);
    drawRight(page, labels.quantity, qtyRight, base, bold, 7.5, WHITE);
    drawRight(page, labels.rate, rateRight, base, bold, 7.5, WHITE);
    drawRight(page, labels.amount, amountRight, base, bold, 7.5, WHITE);
    return topY - h;
  };

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    drawOuterBorder(page);
    return HEADER_TOP;
  };

  y = drawTableHeader(y);
  /* Outer frame of the table the screen draws around header + rows. */
  const tableFrameTop = y + 25;

  if (input.items.length === 0) {
    const rowH = 34;
    page.drawRectangle({ x: X, y: y - rowH, width: WIDTH, height: rowH, borderColor: accentTintStrong, borderWidth: 0.5 });
    drawText(page, labels.noItems, X + WIDTH / 2 - regular.widthOfTextAtSize(safeText(labels.noItems), 9.5) / 2, y - 20, regular, 9.5, MUTED);
    y -= rowH;
  }

  input.items.forEach((item, idx) => {
    const descLines = wrapText(item.description, regular, 9.5, colDescW);
    const rowH = Math.max(24, descLines.length * 11.5 + 11);
    if (y - rowH < BORDER + 16) {
      /* Continue on a fresh sheet: border + repeated accent header. */
      y = drawTableHeader(newPage());
    }
    const rowBottom = y - rowH;
    if (idx % 2 === 1) page.drawRectangle({ x: X, y: rowBottom, width: WIDTH, height: rowH, color: ZEBRA });
    page.drawRectangle({ x: X, y: rowBottom, width: WIDTH, height: 0.5, color: ROW_LINE });
    page.drawLine({ start: { x: X, y: rowBottom + rowH }, end: { x: X, y: rowBottom }, thickness: 0.5, color: accentTintStrong });
    page.drawLine({ start: { x: RIGHT, y: rowBottom + rowH }, end: { x: RIGHT, y: rowBottom }, thickness: 0.5, color: accentTintStrong });
    let dy = y - 6;
    for (const line of descLines) {
      dy -= 9.5;
      drawText(page, line, colDescX, dy, regular, 9.5, INK);
      dy -= 2;
    }
    const numBase = y - 15.5;
    drawRight(page, String(item.quantity), qtyRight, numBase, regular, 9.5, INK);
    drawRight(page, input.formatMoney(item.unitPrice), rateRight, numBase, regular, 9.5, INK);
    drawRight(page, input.formatMoney(item.total), amountRight, numBase, bold, 9.5, INK);
    y = rowBottom;
  });
  void tableFrameTop;

  /* ---- totals + Balance Due box ---- */
  const totalsH = 12 + 17 + 20 + 17 + 10 + 38;
  if (y - totalsH < BORDER + 14) {
    y = newPage();
  }
  y -= 18;
  const totalsX = RIGHT - 264;
  const drawTotalRow = (label: string, value: string, opts: { font?: PDFFont; color?: Rgb; labelColor?: Rgb; size?: number }) => {
    const size = opts.size ?? 9.5;
    const font = opts.font ?? regular;
    y -= size;
    drawText(page, label, totalsX, y, font, size, opts.labelColor ?? SLATE);
    drawRight(page, value, RIGHT, y, font, size, opts.color ?? INK);
    y -= 5;
  };
  drawTotalRow(labels.subtotal, input.formatMoney(input.total), {});
  y -= 3;
  page.drawRectangle({ x: totalsX, y, width: RIGHT - totalsX, height: 1.6, color: accent });
  y -= 5;
  drawTotalRow(labels.total, input.formatMoney(input.total), { font: bold, color: INK, labelColor: INK, size: 10.5 });
  drawTotalRow(labels.paid, input.formatMoney(input.paid), { font: bold, color: GREEN_700, labelColor: GREEN_700 });

  y -= 8;
  const boxH = 38;
  page.drawRectangle({ x: totalsX, y: y - boxH, width: RIGHT - totalsX, height: boxH, color: accent });
  drawText(page, labels.balanceDue.toUpperCase(), totalsX + 12, y - 22.5, bold, 8, mix(accent, WHITE, 0.92));
  drawRight(page, input.formatMoney(input.balance), RIGHT - 12, y - 25.5, bold, 16, WHITE);

  const bytes = await doc.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}
