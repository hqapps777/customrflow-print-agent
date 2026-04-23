export type PrinterProtocol = 'ESCPOS_TCP' | 'STAR_LINE_TCP' | 'CUPS_IPP';
export type PaperWidth = 'MM_58' | 'MM_80' | 'A4' | 'LABEL';

export interface PrinterConfig {
  id: string;
  displayName: string;
  protocol: PrinterProtocol;
  host?: string;
  port?: number;
  cupsQueue?: string;
  paperWidth: PaperWidth;
}

export interface AgentConfig {
  backendUrl: string;
  agentId: string | null;
  locationId: string | null;
  deviceJwt: string | null;
  hmacSecret: string | null;
  printers: PrinterConfig[];
  uiPort: number;
}

export interface IncomingJob {
  jobId: string;
  printerId: string;
  payload: BonElement[];
  paperWidth?: PaperWidth;
  protocol?: PrinterProtocol;
  host?: string;
  port?: number;
  cupsQueue?: string;
}

export type BonElement =
  | { type: 'text'; value: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; bold?: boolean; align?: 'left' | 'center' | 'right'; underline?: boolean }
  | { type: 'line'; char?: '-' | '=' | '_' }
  | { type: 'blank'; lines?: number }
  | { type: 'qrcode'; value: string; size?: 's' | 'm' | 'l' }
  | { type: 'barcode'; value: string; format: 'code128' | 'ean13' }
  | { type: 'image'; ref: string }
  | { type: 'cut'; partial?: boolean }
  | { type: 'cashdrawer' };

export interface HeartbeatPrinterStatus {
  id: string;
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'PAPER_LOW' | 'PAPER_OUT' | 'COVER_OPEN' | 'ERROR';
  lastSuccessAt?: string;
  lastError?: string | null;
}
