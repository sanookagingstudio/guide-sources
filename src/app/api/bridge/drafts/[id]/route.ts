import { NextResponse } from "next/server";
import { bridgeAuth } from "@/lib/bridge-auth";
import { getDraft } from "@/lib/bridge-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** GET /api/bridge/drafts/:id - the stored draft, read back from the durable store. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = bridgeAuth(request.headers);
  if (auth === "unconfigured") {
    return NextResponse.json({ ok: false, code: "BRIDGE_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  if (auth !== "ok") return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });

  const { id } = await context.params;
  try {
    const draft = await getDraft(String(id));
    if (!draft) return NextResponse.json({ ok: false, code: "DRAFT_NOT_FOUND" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true, draft }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "BRIDGE_STORE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
