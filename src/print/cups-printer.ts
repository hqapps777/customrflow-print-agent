import type { BonElement } from '../types';
import { spawn } from 'child_process';

/**
 * CUPS-backed printing. Renders a minimal plain-text representation (CUPS
 * accepts text/plain natively) and pipes it via `lp -d <queue>`. Good
 * enough for kitchen tickets on USB thermal printers exposed through CUPS.
 */
export function renderCupsText(elements: BonElement[]): string {
  const lines: string[] = [];
  for (const el of elements) {
    switch (el.type) {
      case 'text':
        lines.push(el.bold ? `**${el.value}**` : el.value);
        break;
      case 'line':
        lines.push((el.char ?? '-').repeat(40));
        break;
      case 'blank':
        for (let i = 0; i < (el.lines ?? 1); i++) lines.push('');
        break;
      case 'qrcode':
        lines.push(`[QR:${el.value}]`);
        break;
      case 'barcode':
        lines.push(`[BC:${el.format}:${el.value}]`);
        break;
      case 'image':
        lines.push(`[IMG:${el.ref}]`);
        break;
      case 'cut':
        lines.push('', '---CUT---', '');
        break;
      case 'cashdrawer':
        break;
    }
  }
  return lines.join('\n') + '\n';
}

export function sendToCupsQueue(queue: string, body: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('lp', ['-d', queue], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`lp -d ${queue} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`lp exited with ${code}: ${stderr.trim()}`));
    });
    proc.stdin.end(body);
  });
}
