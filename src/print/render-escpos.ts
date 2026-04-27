import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import type { BonElement, PaperWidth } from '../types';

function columnsFor(width: PaperWidth): number {
  switch (width) {
    case 'MM_58':
      return 32;
    case 'MM_80':
      return 48;
    default:
      return 48;
  }
}

export type ThermalDialect = 'esc-pos' | 'star-prnt';

export function renderEscPos(
  elements: BonElement[],
  paperWidth: PaperWidth,
  dialect: ThermalDialect = 'esc-pos',
): Buffer {
  const enc = new ReceiptPrinterEncoder({
    language: dialect,
    columns: columnsFor(paperWidth),
  });
  enc.initialize();
  // Some Star firmwares ignore the very first formatting command if no
  // line-context exists yet. Force a known clean state explicitly so the
  // first text line honors center/right alignment.
  enc.align('left').bold(false).size(1, 1);

  for (const el of elements) {
    switch (el.type) {
      case 'text': {
        // Always set attributes explicitly (no conditional) so each line
        // starts with a known state — otherwise inherited flags from
        // previous lines bleed through and the FIRST line of a section
        // sometimes prints with the wrong alignment.
        const align: 'left' | 'center' | 'right' =
          el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : 'left';
        const w = el.size === 'xl' ? 2 : 1;
        const h = el.size === 'xl' ? 2 : el.size === 'lg' ? 2 : 1;
        enc.align(align).bold(!!el.bold).size(w, h);
        enc.text(el.value);
        enc.newline();
        // Reset to defaults so non-text elements (line, blank, qrcode) inherit
        // a clean state.
        enc.size(1, 1).align('left').bold(false);
        break;
      }
      case 'line': {
        const style = el.char === '=' ? 'double' : 'single';
        enc.rule({ style });
        break;
      }
      case 'blank': {
        for (let i = 0; i < (el.lines ?? 1); i++) enc.newline();
        break;
      }
      case 'qrcode': {
        enc.qrcode(el.value, { size: 6 });
        break;
      }
      case 'barcode': {
        enc.barcode(el.value, el.format === 'ean13' ? 'ean13' : 'code128', 60);
        break;
      }
      case 'image': {
        // Images would require loading from disk; placeholder: treat as centered label.
        enc.align('center').text(`[IMG:${el.ref}]`).newline().align('left');
        break;
      }
      case 'cut': {
        // Auto-feed 4 extra lines before cutting: the physical cutter on
        // thermal printers sits 2-4 lines above the current print head
        // position, so without this the cut slices through the last printed
        // lines (tested on Star TSP650II, typical for Epson TM-m30 too).
        for (let i = 0; i < 4; i++) enc.newline();
        enc.cut(el.partial ? 'partial' : 'full');
        break;
      }
      case 'cashdrawer': {
        enc.pulse();
        break;
      }
    }
  }

  return Buffer.from(enc.encode());
}
