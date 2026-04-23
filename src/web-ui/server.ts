import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import type { AgentConfig, PrinterConfig } from '../types';
import { saveConfig } from '../config';
import { scanNetwork } from '../discovery/mdns-scanner';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface WebUiOptions {
  config: AgentConfig;
  onPair: (code: string, displayName: string) => Promise<void>;
  onTestPrint: (printerId: string) => Promise<{ ok: boolean; error?: string }>;
}

export async function startLocalUi(opts: WebUiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const staticDir = path.join(__dirname, 'static');
  try {
    await app.register(fastifyStatic, { root: staticDir, prefix: '/' });
  } catch {
    // empty static dir in dev; inline index below handles '/'
  }

  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(renderIndex());
  });

  app.get('/api/status', async () => ({
    agentId: opts.config.agentId,
    locationId: opts.config.locationId,
    paired: !!opts.config.deviceJwt,
    printers: opts.config.printers,
    uiPort: opts.config.uiPort,
    backendUrl: opts.config.backendUrl,
  }));

  app.post('/api/discover', async () => {
    const found = await scanNetwork(4000);
    // Dedupe by host — prefer 9100 (ESC/POS) over 631 (IPP) over others.
    const byHost = new Map<string, { name: string; host: string; port: number; serviceType: string }>();
    for (const p of found) {
      const existing = byHost.get(p.host);
      if (!existing || preferredPort(p.port) > preferredPort(existing.port)) {
        byHost.set(p.host, p);
      }
    }
    return { printers: Array.from(byHost.values()) };
  });

  app.post<{ Body: { code: string; displayName: string } }>('/api/pair', async (req, reply) => {
    try {
      await opts.onPair(req.body.code, req.body.displayName);
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.post<{
    Body: {
      displayName: string;
      protocol: 'ESCPOS_TCP' | 'STAR_LINE_TCP' | 'CUPS_IPP';
      host?: string;
      port?: number;
      cupsQueue?: string;
      paperWidth: 'MM_58' | 'MM_80' | 'A4' | 'LABEL';
    };
  }>('/api/printers', async (req, reply) => {
    if (!opts.config.deviceJwt) {
      reply.code(400);
      return { ok: false, error: 'Agent not paired yet' };
    }
    try {
      // Create in backend first — it returns the canonical id
      const created = await backendRegisterPrinter(
        opts.config.backendUrl,
        opts.config.deviceJwt,
        req.body,
      );
      // Mirror locally
      const printer: PrinterConfig = {
        id: created.id,
        displayName: req.body.displayName,
        protocol: req.body.protocol,
        host: req.body.host,
        port: req.body.port,
        cupsQueue: req.body.cupsQueue,
        paperWidth: req.body.paperWidth,
      };
      opts.config.printers.push(printer);
      await saveConfig(opts.config);
      return { ok: true, printer };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: (err as Error).message };
    }
  });

  app.delete<{ Params: { id: string } }>('/api/printers/:id', async (req) => {
    const before = opts.config.printers.length;
    opts.config.printers = opts.config.printers.filter((p) => p.id !== req.params.id);
    await saveConfig(opts.config);
    return { ok: true, removed: before - opts.config.printers.length };
  });

  app.post<{ Params: { id: string } }>('/api/printers/:id/test', async (req) => {
    return opts.onTestPrint(req.params.id);
  });

  const chosenPort = await listenWithFallback(app, opts.config.uiPort);
  if (chosenPort !== opts.config.uiPort) {
    opts.config.uiPort = chosenPort;
    await saveConfig(opts.config);
  }
  return app;
}

/**
 * Try the preferred port; on EADDRINUSE, fall back through a small range
 * (up to +9 hops). Returns the port actually bound.
 */
async function listenWithFallback(app: FastifyInstance, preferred: number): Promise<number> {
  const attempts = [preferred, ...Array.from({ length: 9 }, (_, i) => preferred + i + 1)];
  for (const port of attempts) {
    try {
      await app.listen({ port, host: '127.0.0.1' });
      return port;
    } catch (err: any) {
      if (err?.code !== 'EADDRINUSE') throw err;
      // try next port
    }
  }
  throw new Error(
    `All local UI ports in range ${attempts[0]}-${attempts[attempts.length - 1]} are in use.`,
  );
}

function preferredPort(p: number): number {
  if (p === 9100) return 3; // ESC/POS raw — best
  if (p === 631) return 2; // IPP — good
  if (p === 515) return 1; // LPD — last
  return 0;
}

function backendRegisterPrinter(
  backendUrl: string,
  deviceJwt: string,
  body: object,
): Promise<{ id: string; displayName: string }> {
  const url = new URL(`${backendUrl}/printing/agent/printers`);
  const payload = Buffer.from(JSON.stringify(body));
  const options: http.RequestOptions = {
    method: 'POST',
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      Authorization: `Bearer ${deviceJwt}`,
    },
  };
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`bad backend response: ${body}`));
          }
        } else {
          reject(new Error(`backend rejected: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function renderIndex(): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Customrflow Print Agent</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 2em; max-width: 720px; color: #111; }
  h1 { font-size: 1.5em; margin-top: 0; }
  h3 { margin: 0 0 .5em 0; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 1em 1.2em; margin-bottom: 1em; background: white; }
  .status-on { color: #059669; font-weight: 600; }
  .status-off { color: #dc2626; font-weight: 600; }
  input, select, button { font-size: 1em; padding: .6em .8em; border-radius: 6px; border: 1px solid #d1d5db; }
  input:focus, select:focus { outline: 2px solid #f97316; border-color: #f97316; }
  button.primary { background: #f97316; color: white; border: 0; cursor: pointer; font-weight: 600; }
  button.primary:hover { background: #ea580c; }
  button.primary:disabled { background: #cbd5e1; cursor: not-allowed; }
  button.ghost { background: transparent; border: 1px solid #d1d5db; cursor: pointer; }
  button.danger { color: #dc2626; background: transparent; border: 1px solid #fecaca; cursor: pointer; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: .7em 0; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
  li:last-child { border-bottom: 0; }
  .muted { color: #6b7280; font-size: .85em; }
  .row { display: flex; gap: .5em; align-items: center; flex-wrap: wrap; }
  .stack { display: flex; flex-direction: column; gap: .5em; }
  .toast { position: fixed; bottom: 1em; right: 1em; background: #111; color: white; padding: .8em 1.2em; border-radius: 8px; }
</style>
</head>
<body>
<h1>Customrflow Print Agent</h1>
<div id="status" class="card"><em>Lade Status…</em></div>
<div id="pairing"></div>
<div id="printers" class="card">
  <h3>Drucker</h3>
  <div id="printer-list"></div>
  <div class="row" style="margin-top:1em">
    <button id="btn-scan" class="primary">Netzwerk scannen (mDNS)</button>
    <button id="btn-manual" class="ghost">Manuell hinzufügen</button>
  </div>
  <div id="scan-result"></div>
</div>
<div id="toast-slot"></div>

<script>
const el = (id) => document.getElementById(id);
const html = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg, bg='#111') {
  const t = html('<div class="toast" style="background:'+bg+'">'+esc(msg)+'</div>');
  el('toast-slot').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

async function renderAll() {
  const s = await fetch('/api/status').then(r => r.json());
  el('status').innerHTML = \`
    <b>Status:</b>
    <span class="\${s.paired ? 'status-on' : 'status-off'}">\${s.paired ? 'gepaart' : 'nicht gepaart'}</span>
    <div class="muted" style="margin-top:.3em">
      \${s.agentId ? 'Agent: <code>'+esc(s.agentId)+'</code><br>' : ''}
      Backend: <code>\${esc(s.backendUrl)}</code>
    </div>\`;

  if (!s.paired) {
    el('pairing').innerHTML = \`
      <div class="card">
        <h3>Pairing</h3>
        <p class="muted">Gib den 6-stelligen Code aus dem Customrflow-Dashboard ein.</p>
        <form onsubmit="pair(event)" class="row">
          <input name="code" pattern="\\\\d{6}" placeholder="123456" required style="width:8em">
          <input name="name" placeholder="Anzeigename dieses Agents" required style="flex:1;min-width:10em">
          <button type="submit" class="primary">Pairen</button>
        </form>
      </div>\`;
  } else {
    el('pairing').innerHTML = '';
  }

  renderPrinterList(s.printers);
}

function renderPrinterList(printers) {
  if (!printers || printers.length === 0) {
    el('printer-list').innerHTML = '<p class="muted">Noch keine Drucker. Scanne das Netzwerk oder füge manuell einen hinzu.</p>';
    return;
  }
  const ul = html('<ul></ul>');
  for (const p of printers) {
    const connection = p.protocol === 'ESCPOS_TCP' ? (p.host + ':' + (p.port || 9100)) : ('CUPS: ' + (p.cupsQueue || '?'));
    const li = html(\`
      <li>
        <div>
          <b>\${esc(p.displayName)}</b>
          <div class="muted">\${esc(p.protocol)} · \${esc(connection)} · \${esc(p.paperWidth)}</div>
        </div>
        <div class="row">
          <button class="ghost" onclick="testPrint('\${p.id}')">Testdruck</button>
          <button class="danger" onclick="removePrinter('\${p.id}')">Entfernen</button>
        </div>
      </li>\`);
    ul.appendChild(li);
  }
  el('printer-list').innerHTML = '';
  el('printer-list').appendChild(ul);
}

async function pair(ev) {
  ev.preventDefault();
  const f = ev.target;
  const r = await fetch('/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: f.code.value, displayName: f.name.value }),
  });
  const j = await r.json();
  if (j.ok) { toast('Gepaart!', '#059669'); await renderAll(); }
  else { toast('Fehler: ' + j.error, '#dc2626'); }
}

async function scan() {
  const btn = el('btn-scan');
  btn.disabled = true; btn.textContent = 'Scanne…';
  try {
    const r = await fetch('/api/discover', { method: 'POST' });
    const j = await r.json();
    renderScanResult(j.printers);
  } finally {
    btn.disabled = false; btn.textContent = 'Netzwerk scannen (mDNS)';
  }
}

function renderScanResult(printers) {
  const box = el('scan-result');
  if (!printers || printers.length === 0) {
    box.innerHTML = '<p class="muted" style="margin-top:1em">Keine Drucker gefunden. Router blockiert evtl. mDNS — füge den Drucker manuell hinzu.</p>';
    return;
  }
  box.innerHTML = '<h4 style="margin-top:1.5em">Gefundene Drucker</h4>';
  for (const p of printers) {
    const card = html(\`
      <div class="card" style="background:#f9fafb">
        <div style="display:flex;justify-content:space-between;gap:1em;align-items:start">
          <div>
            <b>\${esc(p.name)}</b>
            <div class="muted">\${esc(p.host)}:\${p.port} · mDNS: \${esc(p.serviceType)}</div>
          </div>
        </div>
        <div class="stack" style="margin-top:.8em">
          <input placeholder="Anzeigename (z.B. Küche)" value="\${esc(p.name)}" data-field="name">
          <div class="row">
            <select data-field="protocol" style="flex:2">
              <option value="ESCPOS_TCP">ESC/POS (Epson, Bixolon, Citizen, HPRT …)</option>
              <option value="STAR_LINE_TCP">Star-Line (Star TSP, mC, BSC …)</option>
            </select>
            <select data-field="paper" style="flex:1">
              <option value="MM_80">80 mm</option>
              <option value="MM_58">58 mm</option>
            </select>
            <input placeholder="Port" value="\${p.port === 631 || p.port === 515 ? 9100 : p.port}" data-field="port" style="width:6em">
            <button class="primary" data-host="\${esc(p.host)}">Übernehmen</button>
          </div>
        </div>
      </div>\`);
    card.querySelector('button').addEventListener('click', async (ev) => {
      const btn = ev.target;
      btn.disabled = true; btn.textContent = 'Lege an…';
      const name = card.querySelector('[data-field=name]').value.trim();
      const protocol = card.querySelector('[data-field=protocol]').value;
      const paper = card.querySelector('[data-field=paper]').value;
      const port = parseInt(card.querySelector('[data-field=port]').value, 10);
      const host = btn.dataset.host;
      try {
        const r = await fetch('/api/printers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: name, protocol,
            host, port, paperWidth: paper,
          }),
        });
        const j = await r.json();
        if (j.ok) {
          toast('Drucker "' + name + '" übernommen.', '#059669');
          card.remove();
          await renderAll();
        } else {
          toast('Fehler: ' + j.error, '#dc2626');
          btn.disabled = false; btn.textContent = 'Übernehmen';
        }
      } catch (e) {
        toast('Fehler: ' + e.message, '#dc2626');
        btn.disabled = false; btn.textContent = 'Übernehmen';
      }
    });
    box.appendChild(card);
  }
}

async function testPrint(id) {
  const r = await fetch('/api/printers/' + id + '/test', { method: 'POST' });
  const j = await r.json();
  toast(j.ok ? 'Testdruck gesendet' : 'Fehler: ' + j.error, j.ok ? '#059669' : '#dc2626');
}

async function removePrinter(id) {
  if (!confirm('Drucker entfernen?')) return;
  await fetch('/api/printers/' + id, { method: 'DELETE' });
  await renderAll();
}

function manualAdd() {
  el('scan-result').innerHTML = '';
  const card = html(\`
    <div class="card" style="background:#f9fafb;margin-top:1em">
      <h4 style="margin-top:0">Drucker manuell hinzufügen</h4>
      <div class="stack">
        <input placeholder="Anzeigename" data-field="name">
        <div class="row">
          <input placeholder="IP oder Hostname" data-field="host" style="flex:2">
          <input placeholder="Port" value="9100" data-field="port" style="flex:1">
        </div>
        <select data-field="protocol">
          <option value="ESCPOS_TCP">ESC/POS (Epson, Bixolon, Citizen, HPRT …)</option>
          <option value="STAR_LINE_TCP">Star-Line (Star TSP, mC, BSC …)</option>
        </select>
        <select data-field="paper">
          <option value="MM_80">80 mm Thermo</option>
          <option value="MM_58">58 mm Thermo</option>
        </select>
        <button class="primary">Übernehmen</button>
      </div>
    </div>\`);
  card.querySelector('button').addEventListener('click', async (ev) => {
    const btn = ev.target;
    const name = card.querySelector('[data-field=name]').value.trim();
    const host = card.querySelector('[data-field=host]').value.trim();
    const port = parseInt(card.querySelector('[data-field=port]').value, 10);
    const protocol = card.querySelector('[data-field=protocol]').value;
    const paper = card.querySelector('[data-field=paper]').value;
    if (!name || !host) return toast('Name + IP sind Pflicht', '#dc2626');
    btn.disabled = true; btn.textContent = 'Lege an…';
    const r = await fetch('/api/printers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name, protocol, host, port, paperWidth: paper }),
    });
    const j = await r.json();
    if (j.ok) { toast('Drucker "' + name + '" übernommen.', '#059669'); card.remove(); await renderAll(); }
    else { toast('Fehler: ' + j.error, '#dc2626'); btn.disabled = false; btn.textContent = 'Übernehmen'; }
  });
  el('scan-result').appendChild(card);
}

el('btn-scan').addEventListener('click', scan);
el('btn-manual').addEventListener('click', manualAdd);
renderAll();
setInterval(renderAll, 15000);
</script>
</body>
</html>`;
}
