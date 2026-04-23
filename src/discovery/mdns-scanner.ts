import Bonjour from 'bonjour-service';

export interface DiscoveredPrinter {
  name: string;
  host: string;
  port: number;
  serviceType: string;
}

/**
 * Scan the local network for printer services over mDNS/Zeroconf.
 * Returns a deduplicated list of host:port entries with their service type.
 */
export async function scanNetwork(timeoutMs: number = 5000): Promise<DiscoveredPrinter[]> {
  const bonjour = new Bonjour();
  const seen = new Map<string, DiscoveredPrinter>();
  const types = ['ipp', 'printer', 'pdl-datastream'];
  const browsers = types.map((type) =>
    bonjour.find({ type }, (svc) => {
      const host = svc.referer?.address || svc.host || '';
      const port = svc.port;
      if (!host || !port) return;
      const key = `${host}:${port}`;
      if (!seen.has(key)) {
        seen.set(key, { name: svc.name, host, port, serviceType: type });
      }
    }),
  );
  await new Promise((r) => setTimeout(r, timeoutMs));
  for (const b of browsers) b.stop();
  bonjour.destroy();
  return Array.from(seen.values());
}
