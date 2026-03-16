/**
 * Webshare Proxy Parser
 * Parse proxy từ Webshare format và convert sang ProxyConfig
 */

import { ProxyConfig } from '../../shared/types/proxy';

/**
 * Webshare proxy data từ table
 */
export interface WebshareProxyData {
  ip: string;
  port: number;
  username: string;
  password: string;
  country?: string;
  city?: string;
}

/**
 * Parse Webshare proxy list từ text hoặc array
 * Format: ip, port, username, password (mỗi dòng 1 proxy)
 * 
 * Example input:
 * ```
 * 142.111.48.253,7030,qfdakzos,7fvhf24fe3ud,US,Los Angeles
 * 23.95.150.145,6114,qfdakzos,7fvhf24fe3ud,US,Buffalo
 * ```
 */
export function parseWebshareProxies(
  input: string,
  preferredType: 'http' | 'https' | 'socks5' = 'http'
): Omit<ProxyConfig, 'id' | 'createdAt' | 'successCount' | 'failedCount'>[] {
  const lines = input.trim().split('\n');
  const proxies: Omit<ProxyConfig, 'id' | 'createdAt' | 'successCount' | 'failedCount'>[] = [];

  console.log(`[WebshareParser] Parsing ${lines.length} lines...`);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // Skip empty lines and comments

    // Support full URL format: scheme://user:pass@host:port
    if (trimmed.includes('://')) {
      try {
        const parsed = new URL(trimmed);
        const type = parsed.protocol.replace(':', '') as 'http' | 'https' | 'socks5';
        const host = parsed.hostname;
        const port = Number(parsed.port);
        const username = parsed.username || undefined;
        const password = parsed.password || undefined;

        if (!host || !Number.isFinite(port)) {
          console.warn('[WebshareParser] Invalid URL proxy format:', trimmed);
          continue;
        }

        proxies.push({
          host,
          port,
          username,
          password,
          type: type === 'socks5' ? 'socks5' : type === 'https' ? 'https' : 'http',
          enabled: true,
          platform: 'Webshare',
        });
        continue;
      } catch {
        console.warn('[WebshareParser] Invalid URL proxy format:', trimmed);
        continue;
      }
    }

    // Auto-detect separator: comma (,) or colon (:)
    // Formats supported:
    // - ip,port,username,password,country,city
    // - ip:port:username:password
    // - socks5:ip:port:username:password
    // - socks5,ip,port,username,password
    const separator = trimmed.includes(',') ? ',' : ':';
    const parts = trimmed.split(separator).map(p => p.trim());
    
    if (parts.length < 4) {
      console.warn('[WebshareParser] Invalid line (need at least 4 parts):', trimmed);
      console.warn('[WebshareParser] Parts found:', parts);
      continue;
    }

    let type: 'http' | 'https' | 'socks5' = preferredType;
    let ip = '';
    let portStr = '';
    let username = '';
    let password = '';
    let country: string | undefined;
    let city: string | undefined;

    const first = parts[0]?.toLowerCase();
    if (first === 'http' || first === 'https' || first === 'socks5') {
      type = first;
      [ip, portStr, username, password, country, city] = parts.slice(1);
    } else {
      [ip, portStr, username, password, country, city] = parts;
    }
    const port = parseInt(portStr);

    if (!ip || isNaN(port)) {
      console.warn('[WebshareParser] Invalid IP or port:', trimmed);
      continue;
    }

    proxies.push({
      host: ip,
      port: port,
      username: username || undefined,
      password: password || undefined,
      type,
      enabled: true,
      platform: 'Webshare',
      country: country || undefined,
      city: city || undefined,
    });
  }

  console.log(`[WebshareParser] Parsed ${proxies.length} proxies from Webshare format`);
  return proxies;
}

/**
 * Parse từ array of objects (nếu paste JSON từ API)
 */
export function parseWebshareProxiesFromJSON(data: WebshareProxyData[]): Omit<ProxyConfig, 'id' | 'createdAt' | 'successCount' | 'failedCount'>[] {
  return data.map(item => ({
    host: item.ip,
    port: item.port,
    username: item.username,
    password: item.password,
    type: 'http' as const,
    enabled: true,
    platform: 'Webshare',
    country: item.country,
    city: item.city,
  }));
}

/**
 * Quick add 10 Webshare free proxies (hardcoded từ user's list)
 * CHỈ dùng để demo/testing, production nên import từ file
 */
export function getWebshareFreeProxies(): Omit<ProxyConfig, 'id' | 'createdAt' | 'successCount' | 'failedCount'>[] {
  const hardcodedProxies = `
142.111.48.253,7030,qfdakzos,7fvhf24fe3ud,US,Los Angeles
23.95.150.145,6114,qfdakzos,7fvhf24fe3ud,US,Buffalo
198.23.239.134,6540,qfdakzos,7fvhf24fe3ud,US,Buffalo
107.172.163.27,6543,qfdakzos,7fvhf24fe3ud,US,Bloomingdale
198.105.121.200,6462,qfdakzos,7fvhf24fe3ud,GB,City Of London
64.137.96.74,6641,qfdakzos,7fvhf24fe3ud,ES,Madrid
84.247.60.125,6095,qfdakzos,7fvhf24fe3ud,PL,Warsaw
216.10.27.159,6837,qfdakzos,7fvhf24fe3ud,US,Dallas
23.26.71.145,5628,qfdakzos,7fvhf24fe3ud,US,Orem
23.27.208.120,5830,qfdakzos,7fvhf24fe3ud,US,Reston
  `.trim();

  return parseWebshareProxies(hardcodedProxies, 'socks5');
}

/**
 * Validate Webshare proxy format
 */
export function isValidWebshareFormat(input: string): boolean {
  const lines = input.trim().split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (lines.length === 0) return false;

  // Check first line format (split by comma)
  const parts = lines[0].split(',').map(p => p.trim());
  return parts.length >= 4; // At least ip, port, username, password
}
