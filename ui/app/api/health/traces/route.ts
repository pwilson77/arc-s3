import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Contract, JsonRpcProvider } from "ethers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COURTHOUSE_ABI = [
  "function tasks(bytes32) view returns (address employer, address worker, uint256 paymentAmount, uint256 bondAmount, bytes32 traceHash, string ipfsURI, uint8 status, address publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
];

type CheckResult = {
  ok: boolean;
  status: "ok" | "fail" | "skip";
  message: string;
  details?: Record<string, unknown>;
};

function ipfsGatewayBaseUrl(): string {
  return (
    process.env.IPFS_GATEWAY_BASE_URL ?? "https://gateway.pinata.cloud/ipfs"
  );
}

function ipfsGatewayUrl(ipfsURI: string): string {
  const base = ipfsGatewayBaseUrl().replace(/\/+$/, "");
  const cidOrPath = ipfsURI.replace(/^ipfs:\/\//, "").replace(/^\/+/, "");
  return `${base}/${cidOrPath}`;
}

function sha256Hex(payload: string): string {
  return `0x${createHash("sha256").update(payload).digest("hex")}`;
}

function isBytes32(v: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

async function checkPinataAuth(): Promise<CheckResult> {
  const jwt = process.env.PINATA_JWT;
  const network = process.env.PINATA_NETWORK ?? "public";
  if (!jwt) {
    return {
      ok: true,
      status: "skip",
      message: "PINATA_JWT not set; skipping Pinata auth check",
    };
  }

  try {
    const res = await fetch(
      `https://api.pinata.cloud/v3/files/${network}?limit=1`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        status: "fail",
        message: `Pinata auth/list failed (${res.status})`,
        details: { body: body.slice(0, 400) },
      };
    }

    return {
      ok: true,
      status: "ok",
      message: `Pinata auth succeeded (network=${network})`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "fail",
      message: "Pinata auth request failed",
      details: { error: String(error) },
    };
  }
}

async function checkRpcAndCourthouse(): Promise<
  CheckResult & {
    provider?: JsonRpcProvider;
    courthouse?: Contract;
  }
> {
  const rpcUrl = process.env.ARC_RPC_URL;
  const courthouseAddress = process.env.S3_ESCROW_COURTHOUSE;

  if (!rpcUrl || !courthouseAddress) {
    return {
      ok: false,
      status: "fail",
      message: "ARC_RPC_URL and S3_ESCROW_COURTHOUSE are required",
    };
  }

  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    const code = await provider.getCode(courthouseAddress);
    const hasCode = code !== "0x";

    if (!hasCode) {
      return {
        ok: false,
        status: "fail",
        message: "Courthouse address has no contract code",
        details: {
          courthouseAddress,
          blockNumber,
          chainId: network.chainId.toString(),
        },
      };
    }

    const courthouse = new Contract(
      courthouseAddress,
      COURTHOUSE_ABI,
      provider,
    );

    return {
      ok: true,
      status: "ok",
      message: "RPC reachable and courthouse contract code found",
      details: {
        courthouseAddress,
        blockNumber,
        chainId: network.chainId.toString(),
      },
      provider,
      courthouse,
    };
  } catch (error) {
    return {
      ok: false,
      status: "fail",
      message: "RPC/courthouse check failed",
      details: { error: String(error) },
    };
  }
}

async function checkGatewayHashVerify(
  courthouse: Contract,
): Promise<CheckResult> {
  const taskId = process.env.TRACE_HEALTH_TASK_ID;
  if (!taskId) {
    return {
      ok: true,
      status: "skip",
      message:
        "TRACE_HEALTH_TASK_ID not set; skipping gateway/hash verification",
    };
  }

  if (!isBytes32(taskId)) {
    return {
      ok: false,
      status: "fail",
      message: "TRACE_HEALTH_TASK_ID must be a bytes32 hex string",
    };
  }

  try {
    const task = await courthouse.tasks(taskId);
    const traceHash = String(task.traceHash ?? "").toLowerCase();
    const ipfsURI = String(task.ipfsURI ?? "");

    if (!ipfsURI.startsWith("ipfs://")) {
      return {
        ok: false,
        status: "fail",
        message: "Task ipfsURI is empty or not ipfs://",
        details: { taskId, ipfsURI },
      };
    }

    const gatewayUrl = ipfsGatewayUrl(ipfsURI);
    const res = await fetch(gatewayUrl);
    if (!res.ok) {
      return {
        ok: false,
        status: "fail",
        message: `Gateway fetch failed (${res.status})`,
        details: { taskId, ipfsURI, gatewayUrl },
      };
    }

    const raw = await res.text();
    const computedHash = sha256Hex(raw).toLowerCase();
    const matches = computedHash === traceHash;

    return {
      ok: matches,
      status: matches ? "ok" : "fail",
      message: matches
        ? "Gateway fetch succeeded and hash matches onchain traceHash"
        : "Gateway fetch succeeded but hash mismatched onchain traceHash",
      details: {
        taskId,
        ipfsURI,
        gatewayUrl,
        traceHash,
        computedHash,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: "fail",
      message: "Task lookup or gateway verification failed",
      details: {
        taskId,
        error: String(error),
      },
    };
  }
}

export async function GET() {
  const pinata = await checkPinataAuth();
  const rpc = await checkRpcAndCourthouse();

  const gateway =
    rpc.ok && rpc.courthouse
      ? await checkGatewayHashVerify(rpc.courthouse)
      : {
          ok: false,
          status: "skip" as const,
          message:
            "Skipping gateway/hash verification because RPC/courthouse check failed",
        };

  const checks = {
    pinata,
    rpc: {
      ok: rpc.ok,
      status: rpc.status,
      message: rpc.message,
      details: rpc.details,
    },
    gateway,
  };

  const ok =
    checks.pinata.ok && checks.rpc.ok && checks.gateway.status !== "fail";

  return NextResponse.json({
    ok,
    checks,
    config: {
      hasPinataJwt: Boolean(process.env.PINATA_JWT),
      hasArcRpcUrl: Boolean(process.env.ARC_RPC_URL),
      hasCourthouseAddress: Boolean(process.env.S3_ESCROW_COURTHOUSE),
      traceHealthTaskId: process.env.TRACE_HEALTH_TASK_ID ?? null,
      gatewayBaseUrl: ipfsGatewayBaseUrl(),
    },
    timestamp: new Date().toISOString(),
  });
}
