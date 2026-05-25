// Shared IPFS helper for arc-s3 agents (Pinata v3).
//
// Two upload modes are supported:
//
//  1. `uploadArtifactToIpfs` — append-only POST. New CID every call.
//  2. `replaceLatestArtifact` — POST then DELETE older versions for the same
//     `(category, identityKey)`, keeping at most `retain` newest pins.
//
// The replace-and-prune mode lets agents publish a fresh artifact every run
// without unbounded storage growth on Pinata. A small JSON sidecar index is
// maintained on disk so the steady-state path is one POST + (at most) one
// DELETE; a fallback to the Pinata list API kicks in when the sidecar is
// missing or stale.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

async function fetchWithRetry(
  input: string,
  init: RequestInit,
  retries = 2,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(input, init);
      if (res.ok || attempt === retries || res.status < 500) {
        return res;
      }
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw lastError ?? new Error("request failed");
}

export type PinataNetwork = "public" | "private";

export type UploadArtifactArgs = {
  jwt: string;
  network: PinataNetwork;
  category: string;
  runId: string;
  payload: string;
  keyvalues?: Record<string, string>;
};

export type UploadArtifactResult = {
  fileId: string;
  cid: string;
  ipfsURI: string;
  createdAt: string;
};

type PinataFileData = {
  id?: string;
  cid?: string;
  created_at?: string;
};

export async function uploadArtifactToIpfs(
  args: UploadArtifactArgs,
): Promise<UploadArtifactResult> {
  if (!args.jwt) {
    throw new Error("PINATA_JWT is required to upload artifacts to IPFS");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([args.payload], { type: "application/json" }),
    `${args.category}-${args.runId}.json`,
  );
  form.append("name", args.category);
  form.append("network", args.network);
  form.append(
    "keyvalues",
    JSON.stringify({
      category: args.category,
      runId: args.runId,
      timestamp: new Date().toISOString(),
      ...(args.keyvalues ?? {}),
    }),
  );

  const res = await fetchWithRetry(
    "https://uploads.pinata.cloud/v3/files",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${args.jwt}` },
      body: form,
    },
    2,
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Pinata upload failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }

  const json = (await res.json()) as { data?: PinataFileData };
  const cid = json.data?.cid;
  const fileId = json.data?.id;
  if (!cid || !fileId) {
    throw new Error("Pinata response missing data.id or data.cid");
  }
  return {
    fileId,
    cid,
    ipfsURI: `ipfs://${cid}`,
    createdAt: json.data?.created_at ?? new Date().toISOString(),
  };
}

export type PinataFileRecord = {
  id: string;
  name: string;
  cid: string;
  size: number;
  mime_type: string;
  created_at: string;
  keyvalues?: Record<string, string>;
};

export type ListFilesArgs = {
  jwt: string;
  network: PinataNetwork;
  category: string;
  /** Optional keyvalue equality filter on `identityKey`. */
  identityKey?: string;
  /** Page size from Pinata (capped at 200). */
  pageLimit?: number;
  /** Maximum total files returned across pages. */
  max?: number;
};

/**
 * List Pinata files for a given category (the stable `name`), newest first.
 * Pages through `next_page_token` up to `max` items.
 */
export async function listPinataFilesByCategory(
  args: ListFilesArgs,
): Promise<PinataFileRecord[]> {
  if (!args.jwt) return [];
  const pageLimit = Math.max(1, Math.min(args.pageLimit ?? 200, 200));
  const max = Math.max(1, args.max ?? 1_000);
  const out: PinataFileRecord[] = [];
  let token: string | null | undefined = undefined;

  while (out.length < max) {
    const url = new URL(`https://api.pinata.cloud/v3/files/${args.network}`);
    url.searchParams.set("name", args.category);
    url.searchParams.set("limit", String(pageLimit));
    url.searchParams.set("order", "DESC");
    if (args.identityKey) {
      // Pinata v3 supports keyvalue filters via `metadata[<key>]=<value>`.
      url.searchParams.set("metadata[identityKey]", args.identityKey);
    }
    if (token) url.searchParams.set("pageToken", token);

    const res = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${args.jwt}` },
      },
      2,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Pinata list failed (${res.status}) for ${args.category}: ${body.slice(
          0,
          200,
        )}`,
      );
    }
    const json = (await res.json()) as {
      data?: { files?: PinataFileRecord[]; next_page_token?: string | null };
    };
    const page = json.data?.files ?? [];
    out.push(...page);
    token = json.data?.next_page_token ?? null;
    if (!token || page.length === 0) break;
  }

  return out.slice(0, max);
}

/** Delete a single Pinata file by id. Returns true if the API accepted the delete. */
export async function deletePinataFile(args: {
  jwt: string;
  network: PinataNetwork;
  fileId: string;
}): Promise<boolean> {
  if (!args.jwt) return false;
  const url = `https://api.pinata.cloud/v3/files/${args.network}/${args.fileId}`;
  const res = await fetchWithRetry(
    url,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${args.jwt}` },
    },
    2,
  );
  if (res.status === 404) return true;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Pinata delete failed (${res.status}) for ${args.fileId}: ${body.slice(
        0,
        200,
      )}`,
    );
  }
  return true;
}

// ---- Sidecar index --------------------------------------------------------

type SidecarEntry = {
  fileId: string;
  cid: string;
  createdAt: string;
};

type SidecarIndex = {
  version: 1;
  channels: Record<string, SidecarEntry[]>;
};

function emptyIndex(): SidecarIndex {
  return { version: 1, channels: {} };
}

function channelKey(category: string, identityKey: string): string {
  return `${category}:${identityKey}`;
}

async function readSidecar(filePath: string): Promise<SidecarIndex> {
  if (!existsSync(filePath)) return emptyIndex();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SidecarIndex>;
    if (parsed && parsed.version === 1 && parsed.channels) {
      return { version: 1, channels: parsed.channels };
    }
  } catch {
    // Fall through to fresh index if the sidecar is corrupted.
  }
  return emptyIndex();
}

async function writeSidecar(
  filePath: string,
  index: SidecarIndex,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(index, null, 2), "utf8");
}

// ---- Replace-latest with retention ---------------------------------------

export type ReplaceLatestArgs = {
  jwt: string;
  network: PinataNetwork;
  /** Pinata `name` field — the logical channel/category. */
  category: string;
  /**
   * Logical identity within the category (e.g. publisher id, wallet, taskId).
   * All prior pins with the same `(category, identityKey)` will be subject to
   * the retention policy.
   */
  identityKey: string;
  /** Run-specific id used in the filename + `runId` keyvalue. */
  runId: string;
  payload: string;
  /** Extra keyvalues to attach. `identityKey` is added automatically. */
  keyvalues?: Record<string, string>;
  /**
   * How many versions to keep (including the newly-uploaded one). Default `1`.
   * Use a larger number to keep history; set to `0` to disable pruning.
   */
  retain?: number;
  /**
   * Path to a local JSON sidecar that tracks `(category, identityKey) -> file
   * ids`. Optional — when absent, prior versions are discovered via the Pinata
   * list API instead.
   */
  indexFilePath?: string;
  /**
   * Callback for non-fatal prune errors. Defaults to console.warn.
   */
  onPruneError?: (err: unknown, fileId: string) => void;
};

export type ReplaceLatestResult = UploadArtifactResult & {
  /** File ids that were deleted from Pinata as part of pruning. */
  pruned: string[];
};

/**
 * Upload a new artifact and prune older versions for the same `identityKey`
 * within a category so the latest `retain` pins survive.
 */
export async function replaceLatestArtifact(
  args: ReplaceLatestArgs,
): Promise<ReplaceLatestResult> {
  const retain = args.retain ?? 1;
  const onPruneError =
    args.onPruneError ??
    ((err, fileId) =>
      console.warn(
        `[pinata:prune] failed to delete ${fileId} (${args.category}/${args.identityKey}):`,
        err,
      ));

  const uploaded = await uploadArtifactToIpfs({
    jwt: args.jwt,
    network: args.network,
    category: args.category,
    runId: args.runId,
    payload: args.payload,
    keyvalues: {
      ...(args.keyvalues ?? {}),
      identityKey: args.identityKey,
    },
  });

  if (retain <= 0) {
    // Pruning disabled — still update sidecar if provided.
    if (args.indexFilePath) {
      const idx = await readSidecar(args.indexFilePath);
      const key = channelKey(args.category, args.identityKey);
      const entries = idx.channels[key] ?? [];
      entries.unshift({
        fileId: uploaded.fileId,
        cid: uploaded.cid,
        createdAt: uploaded.createdAt,
      });
      idx.channels[key] = entries;
      await writeSidecar(args.indexFilePath, idx);
    }
    return { ...uploaded, pruned: [] };
  }

  // Build the list of prior pins for this (category, identityKey).
  let priors: SidecarEntry[] = [];
  let sidecar: SidecarIndex | null = null;
  const key = channelKey(args.category, args.identityKey);

  if (args.indexFilePath) {
    sidecar = await readSidecar(args.indexFilePath);
    priors = (sidecar.channels[key] ?? []).filter(
      (e) => e.fileId !== uploaded.fileId,
    );
  }

  if (priors.length === 0) {
    // Fall back to the API (sidecar missing, stale, or never populated).
    try {
      const remote = await listPinataFilesByCategory({
        jwt: args.jwt,
        network: args.network,
        category: args.category,
        identityKey: args.identityKey,
        max: Math.max(retain * 4, 50),
      });
      priors = remote
        .filter((f) => f.id !== uploaded.fileId)
        .map((f) => ({
          fileId: f.id,
          cid: f.cid,
          createdAt: f.created_at,
        }));
    } catch (err) {
      onPruneError(err, "<list>");
    }
  }

  // Newest first; keep (retain - 1) priors so total with new upload == retain.
  priors.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const keepPriors = priors.slice(0, Math.max(0, retain - 1));
  const dropPriors = priors.slice(Math.max(0, retain - 1));

  const pruned: string[] = [];
  for (const drop of dropPriors) {
    try {
      const ok = await deletePinataFile({
        jwt: args.jwt,
        network: args.network,
        fileId: drop.fileId,
      });
      if (ok) pruned.push(drop.fileId);
    } catch (err) {
      onPruneError(err, drop.fileId);
    }
  }

  if (args.indexFilePath) {
    if (!sidecar) sidecar = await readSidecar(args.indexFilePath);
    sidecar.channels[key] = [
      {
        fileId: uploaded.fileId,
        cid: uploaded.cid,
        createdAt: uploaded.createdAt,
      },
      ...keepPriors,
    ];
    await writeSidecar(args.indexFilePath, sidecar);
  }

  return { ...uploaded, pruned };
}

/**
 * Default sidecar path resolver. Callers may pass through `PINATA_INDEX_FILE`
 * from their env; otherwise this returns `undefined` and the helper falls back
 * to the Pinata list API on every prune.
 */
export function resolveDefaultIndexFilePath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.PINATA_INDEX_FILE || undefined;
}
