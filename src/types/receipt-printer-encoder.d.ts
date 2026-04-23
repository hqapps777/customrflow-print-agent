declare module '@point-of-sale/receipt-printer-encoder' {
  interface EncoderOptions {
    language?: string;
    columns?: number;
    [k: string]: unknown;
  }
  interface QrOptions { size?: number; model?: number; errorLevel?: string }
  interface RuleOptions { style?: 'single' | 'double'; width?: number }
  class ReceiptPrinterEncoder {
    constructor(opts?: EncoderOptions);
    initialize(): this;
    text(v: string): this;
    newline(n?: number): this;
    bold(on?: boolean): this;
    underline(on?: boolean): this;
    italic(on?: boolean): this;
    align(mode: 'left' | 'center' | 'right'): this;
    size(w: number, h: number): this;
    rule(opts?: RuleOptions): this;
    cut(mode?: 'partial' | 'full'): this;
    pulse(): this;
    qrcode(data: string, opts?: QrOptions): this;
    barcode(data: string, symbology: string, height: number): this;
    image(...args: unknown[]): this;
    encode(): Uint8Array;
  }
  export default ReceiptPrinterEncoder;
}
