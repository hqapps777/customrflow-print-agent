import { renderCupsText } from './cups-printer';
import type { BonElement } from '../types';

describe('renderCupsText', () => {
  it('produces newline-separated lines with bold markers', () => {
    const els: BonElement[] = [
      { type: 'text', value: 'Hallo', bold: true },
      { type: 'line', char: '-' },
      { type: 'text', value: 'Welt' },
      { type: 'blank', lines: 1 },
      { type: 'cut' },
    ];
    const out = renderCupsText(els);
    expect(out).toContain('**Hallo**');
    expect(out).toMatch(/^-{40}$/m);
    expect(out).toContain('Welt');
    expect(out).toContain('---CUT---');
  });
});
