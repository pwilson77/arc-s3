// IPFS-backed artifact reader used by UI server components.
//
// Lists pinned artifacts from Pinata by their stable `name` (category), then
// fetches each CID's JSON via the configured IPFS gateway. All reads happen at
// request time (Next.js dynamic="force-dynamic"); callers may cache the result
// in their own short-lived in-memory caches if needed.

export type PinataFileRecord = {
  id: string;
  name: string;
  cid: string;
  size: number;
  mime_type: string;
  created_at: string;
  keyvalues?: Record<string, string>;
};

type PinataListResponse = {
  data?: {
    files?: PinataFileRecord[];
    next_page_token?: string | null;
  };
};

function ipfsGatewayBaseUrl(): string {
  return (
    process.env.IPFS_GATEWAY_BASE_URL ?? "https://gateway.pinata.cloud/ipfs"
  );
}

function ipfsGatewayUrl(cid: string): string {
  const base = ipfsGatewayBaseUrl().replace(/\/+$/, "");
  const clean = cid.replace(/^ipfs:\/\//, "").replace(/^\/+/, "");
  return `${base}/${clean}`;
}

function pinataAuthHeader(): string | null {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return null;
  return `Bearer ${jwt}`;
}

function pinataNetwork(): "public" | "private" {
  const v = process.env.PINATA_NETWORK ?? "public";
  return v === "private" ? "private" : "public";
}

/**
 * List pins for a given logical category (e.g. "rfb5-run", "rfb6-run",
 * "rfb6-copytrade-run", "rfb6-copytrade-executor-event"), most recent first.
 *
 * Returns an empty array if PINATA_JWT is not configured so the UI degrades
 * gracefully on local dev without secrets.
 */
export async function listPinataFilesByCategory(
  category: string,
  limit = 50,
): Promise<PinataFileRecord[]> {
  const auth = pinataAuthHeader();
  if (!auth) return [];

  const url = new URL(
    `https://api.pinata.cloud/v3/files/${pinataNetwork()}`,
  );
  url.searchParams.set("name", category);
  url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 200))));
  url.searchParams.set("order", "DESC");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: auth },
      cache: "no-store",
    });
  } catch (err) {
    console.warn(`[ipfs-store] pinata list failed for ${category}:`, err);
    return [];
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[ipfs-store] pinata list ${category} returned ${res.status}: ${body.slice(0, 200)}`,
    );
    return [];
  }

  const json = (await res.json()) as PinataListResponse;
  return json.data?.files ?? [];
}

/**
 * Fetch and JSON-parse a pinned artifact by CID via the configured gateway.
 * Returns null on any failure (network, non-200, malformed JSON).
 */
export async function fetchArtifactByCid<T>(
  cid: string,
  opts: { timeoutMs?: number } = {},
): Promise<T | null> {
  const url = ipfsGatewayUrl(cid);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 5_000,
  );
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[ipfs-store] gateway fetch failed for ${cid}:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convenience: list latest pins by category, then resolve each to its JSON
 * artifact via the gateway. Failed fetches are skipped.
 */
export async function loadArtifactsByCategory<T>(
  category: string,
  limit = 50,
  perFetchTimeoutMs = 5_000,
): Promise<Array<{ cid: string; createdAt: string; artifact: T }>> {
  const files = await listPinataFilesByCategory(category, limit);
  if (files.length === 0) return [];

  const results = await Promise.all(
    files.map(async (file) => {
      const artifact = await fetchArtifactByCid<T>(file.cid, {
        timeoutMs: perFetchTimeoutMs,
      });
      if (!artifact) return null;
      return { cid: file.cid, createdAt: file.created_at, artifact };
    }),
  );

  return results.filter((entry) => entry !== null) as Array<{
    cid: string;
    createdAt: string;
    artifact: T;
  }>;
}
