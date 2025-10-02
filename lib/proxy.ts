import { ProxyAgent } from "undici";

const DEFAULT_PROXY_LIST_URL =
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/countries/US/data.json";

type RemoteProxyEntry = {
  proxy?: unknown;
  protocol?: unknown;
  score?: unknown;
};

function isHttpProxyEntry(entry: RemoteProxyEntry): entry is { proxy: string } {
  return typeof entry.proxy === "string" && entry.proxy.startsWith("http://");
}

export async function fetchUsHttpProxyList(sourceUrl?: string): Promise<string[]> {
  const targetUrl = sourceUrl ?? DEFAULT_PROXY_LIST_URL;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "botc-imghost/1.0 (+https://github.com/)",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn(`Failed to fetch proxy list from ${targetUrl} (status ${response.status}).`);
      return [];
    }

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      console.warn(`Unexpected proxy list format from ${targetUrl}.`);
      return [];
    }

    return data
      .filter((entry): entry is RemoteProxyEntry => typeof entry === "object" && entry !== null)
      .filter(isHttpProxyEntry)
      .map((entry) => entry.proxy);
  } catch (error) {
    console.warn(`Failed to retrieve proxy list from ${targetUrl}:`, error);
    return [];
  }
}

export function createProxyAgent(proxyUrl: string) {
  return new ProxyAgent(proxyUrl);
}

export const proxyDefaults = {
  listUrl: DEFAULT_PROXY_LIST_URL,
};
