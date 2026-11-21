import { NextResponse } from "next/server";
import { BRIDGE_CONTRACT, storeKind } from "@/lib/bridge-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bridge/health - public readiness of the guide-source-draft bridge.
 *
 * Read-only and safe to expose: it names the contract, the store kind and the
 * clock, never a credential or an environment value.
 */
export async function GET() {
  const store = storeKind();
  return NextResponse.json(
    {
      ok: store === "postgres",
      service: "guide-sources",
      contract: BRIDGE_CONTRACT,
      contract_version: BRIDGE_CONTRACT,
      store,
      at: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}
