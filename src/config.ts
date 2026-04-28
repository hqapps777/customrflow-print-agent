import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import type { AgentConfig } from './types';
import { isProdBuild, PROD_BACKEND_URL } from './build-config';

const SERVICE = 'xflow-print-agent';
const ACC_JWT = 'device-jwt';
const ACC_HMAC = 'hmac-secret';

const CONFIG_DIR =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA || '.', 'xflow-print-agent')
    : path.join(process.env.HOME || '.', '.config', 'xflow-print-agent');

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

// Best-effort keychain: fall back to file-stored secrets if keytar is not available
// (keytar is a native module and can fail to load on some platforms).
async function loadKeytar() {
  try {
    return await import('keytar');
  } catch {
    return null;
  }
}

export async function loadConfig(): Promise<AgentConfig> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  let raw = '';
  try {
    raw = await fs.readFile(CONFIG_FILE, 'utf-8');
  } catch {
    // first run
  }
  const file: Partial<AgentConfig> & { deviceJwt?: string; hmacSecret?: string } = raw
    ? YAML.parse(raw)
    : {};

  const keytar = await loadKeytar();
  const deviceJwt =
    (keytar ? await keytar.getPassword(SERVICE, ACC_JWT) : file.deviceJwt) ?? null;
  const hmacSecret =
    (keytar ? await keytar.getPassword(SERVICE, ACC_HMAC) : file.hmacSecret) ?? null;

  // In prod builds the backend URL is locked — file.backendUrl and
  // XFLOW_BACKEND_URL are ignored to prevent pointing a customer's
  // agent at an attacker-controlled backend.
  const backendUrl = isProdBuild()
    ? PROD_BACKEND_URL
    : file.backendUrl || process.env.XFLOW_BACKEND_URL || PROD_BACKEND_URL;

  return {
    backendUrl,
    agentId: file.agentId || null,
    locationId: file.locationId || null,
    deviceJwt,
    hmacSecret,
    printers: file.printers || [],
    uiPort: file.uiPort || Number(process.env.CUSTOMRFLOW_AGENT_UI_PORT) || 38701,
  };
}

export async function saveConfig(cfg: AgentConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const keytar = await loadKeytar();
  const toWrite: any = {
    // In prod builds we intentionally do NOT persist backendUrl so a later
    // hand-edit of config.yaml cannot redirect the agent.
    ...(isProdBuild() ? {} : { backendUrl: cfg.backendUrl }),
    agentId: cfg.agentId,
    locationId: cfg.locationId,
    printers: cfg.printers,
    uiPort: cfg.uiPort,
  };
  if (keytar) {
    if (cfg.deviceJwt) await keytar.setPassword(SERVICE, ACC_JWT, cfg.deviceJwt);
    if (cfg.hmacSecret) await keytar.setPassword(SERVICE, ACC_HMAC, cfg.hmacSecret);
  } else {
    // Warn but still persist so the agent can run without keytar on stripped systems.
    if (cfg.deviceJwt) toWrite.deviceJwt = cfg.deviceJwt;
    if (cfg.hmacSecret) toWrite.hmacSecret = cfg.hmacSecret;
  }
  await fs.writeFile(CONFIG_FILE, YAML.stringify(toWrite), 'utf-8');
}

export function configFilePath(): string {
  return CONFIG_FILE;
}

export function idempotencyCachePath(): string {
  return path.join(CONFIG_DIR, 'idempotency.json');
}
