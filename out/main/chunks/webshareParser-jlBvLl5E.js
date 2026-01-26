"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
function parseWebshareProxies(input) {
  const lines = input.trim().split("\n");
  const proxies = [];
  console.log(`[WebshareParser] Parsing ${lines.length} lines...`);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.includes(",") ? "," : ":";
    const parts = trimmed.split(separator).map((p) => p.trim());
    if (parts.length < 4) {
      console.warn("[WebshareParser] Invalid line (need at least 4 parts):", trimmed);
      console.warn("[WebshareParser] Parts found:", parts);
      continue;
    }
    const [ip, portStr, username, password, country, city] = parts;
    const port = parseInt(portStr);
    if (!ip || isNaN(port)) {
      console.warn("[WebshareParser] Invalid IP or port:", trimmed);
      continue;
    }
    proxies.push({
      host: ip,
      port,
      username: username || void 0,
      password: password || void 0,
      type: "http",
      // Webshare mặc định là HTTP
      enabled: true,
      platform: "Webshare",
      country: country || void 0,
      city: city || void 0
    });
  }
  console.log(`[WebshareParser] Parsed ${proxies.length} proxies from Webshare format`);
  return proxies;
}
function getWebshareFreeProxies() {
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
  return parseWebshareProxies(hardcodedProxies);
}
exports.getWebshareFreeProxies = getWebshareFreeProxies;
exports.parseWebshareProxies = parseWebshareProxies;
