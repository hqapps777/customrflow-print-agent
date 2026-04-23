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

  for (const el of elements) {
    switch (el.type) {
      case 'text': {
        if (el.bold) enc.bold(true);
        if (el.align === 'center') enc.align('center');
        else if (el.align === 'right') enc.align('right');
        if (el.size === 'xl') enc.size(2, 2);
        else if (el.size === 'lg') enc.size(1, 2);
        enc.text(el.value);
        enc.newline();
        enc.size(1, 1);
        enc.align('left');
        enc.bold(false);
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
