#!/usr/bin/env node
// Pinata retention pruner — lists pins for arc-s3 categories and deletes
// everything beyond `--retain N` per `(category, identityKey)` group.
//
// Usage:
//   node scripts/pinata/prune.mjs                  # dry-run preview, retain=10
//   node scripts/pinata/prune.mjs --apply          # actually delete
//   node scripts/pinata/prune.mjs --retain 5
//   node scripts/pinata/prune.mjs --category rfb6-copytrade-executor-event
//
// Env:
//   PINATA_JWT       (required)
//   PINATA_NETWORK   (default: public)

import process from "node:process";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const optVal = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const APPLY = flag("--apply");
const DRY = !APPLY || flag("--dry-run");
const RETAIN = Math.max(0, Number(optVal("--retain", "10")));
const ONLY_CATEGORY = optVal("--category", null);

const JWT = process.env.PINATA_JWT;
const NETWORK = process.env.PINATA_NETWORK ?? "public";
if (!JWT) {
  console.error("error: PINATA_JWT is required");
  process.exit(1);
}

// Each entry tells the pruner how to derive the identity key from `keyvalues`.
// First non-empty match wins.
const CHANNELS = [
  { category: "rfb5-run", keys: ["identityKey", "publisher"] },
  { category: "rfb6-run", keys: ["identityKey", "publisher"] },
  { category: "rfb6-copytrade-run", keys: ["identityKey", "publisher"] },
  {
    category: "rfb6-copytrade-executor-event",
    keys: ["identityKey", "wallet"],
  },
  { category: "reasoning-trace", keys: ["identityKey", "worker"] },
  // Onchain publisher uses a dynamic category configured via env; include
  // any extra categories the operator wants pruned via --category.
];

async function listAll(category) {
  const out = [];
  let token = null;
  while (true) {
    const url = new URL(`https://api.pinata.cloud/v3/files/${NETWORK}`);
    url.searchParams.set("name", category);
    url.searchParams.set("limit", "200");
    url.searchParams.set("order", "DESC");
    if (token) url.searchParams.set("pageToken", token);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${JWT}` },
    });
    if (!res.ok) {
      console.warn(`  list ${category} -> ${res.status} ${await res.text()}`);
      break;
    }
    const json = await res.json();
    const files = json?.data?.files ?? [];
    out.push(...files);
    token = json?.data?.next_page_token ?? null;
    if (!token || files.length === 0) break;
  }
  return out;
}

async function deleteFile(id) {
  const url = `https://api.pinata.cloud/v3/files/${NETWORK}/${id}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${JWT}` },
  });
  return res.ok || res.status === 404;
}

function groupByIdentity(files, keys) {
  const groups = new Map();
  for (const f of files) {
    const kv = f.keyvalues ?? {};
    let identity = null;
    for (const k of keys) {
      if (kv[k]) {
        identity = kv[k];
        break;
      }
    }
    if (!identity) identity = `__no-identity__:${f.id}`;
    const list = groups.get(identity) ?? [];
    list.push(f);
    groups.set(identity, list);
  }
  return groups;
}

async function pruneChannel({ category, keys }) {
  const files = await listAll(category);
  if (files.length === 0) {
    console.log(`[${category}] no files`);
    return { deleted: 0, kept: 0 };
  }
  const groups = groupByIdentity(files, keys);
  let deleted = 0;
  let kept = 0;
  for (const [identity, list] of groups) {
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const keep = list.slice(0, RETAIN);
    const drop = list.slice(RETAIN);
    kept += keep.length;
    for (const d of drop) {
      console.log(
        `[${category}] ${DRY ? "DRY" : "DEL"} ${d.id} (${identity}) ${
          d.created_at
        }`,
      );
      if (!DRY) {
        const ok = await deleteFile(d.id);
        if (ok) deleted += 1;
      }
    }
  }
  console.log(
    `[${category}] groups=${groups.size} files=${files.length} kept=${kept} ${
      DRY ? "to_delete" : "deleted"
    }=${files.length - kept}`,
  );
  return { deleted, kept };
}

(async () => {
  console.log(
    `pinata prune  network=${NETWORK}  retain=${RETAIN}  mode=${
      DRY ? "DRY-RUN" : "APPLY"
    }`,
  );
  const targets = ONLY_CATEGORY
    ? [
        {
          category: ONLY_CATEGORY,
          keys: ["identityKey", "candidateId", "publisher", "wallet"],
        },
      ]
    : CHANNELS;
  let total = 0;
  for (const ch of targets) {
    const { deleted } = await pruneChannel(ch);
    total += deleted;
  }
  console.log(`done. ${DRY ? "would delete" : "deleted"} ${total} files.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
