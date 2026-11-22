import { NextResponse } from "next/server";
import { bridgeAuth } from "@/lib/bridge-auth";
import { QA_PREFIX, deleteQaDraft, getDraft } from "@/lib/bridge-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * POST /api/bridge/drafts/:id/purge - delete the QA-marked draft ONLY.
 *
 * This is the only delete path. A draft that is not `qa: true` AND named `QA-*`
 * is refused with 403 QA_ONLY and stays in the store; the SQL predicate repeats
 * the rule (`DELETE ... AND qa = true`) so a route bug cannot widen it.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = bridgeAuth(request.headers);
  if (auth === "unconfigured") {
    return NextResponse.json({ ok: false, code: "BRIDGE_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  if (auth !== "ok") return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });

  const { id } = await context.params;
  const draftId = String(id);
  try {
    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ ok: false, code: "DRAFT_NOT_FOUND" }, { status: 404, headers: NO_STORE });
    if (draft.qa !== true || !draft.draft_id.startsWith(QA_PREFIX)) {
      return NextResponse.json(
        { ok: false, code: "QA_ONLY", detail: `only a ${QA_PREFIX}* draft marked qa may be purged` },
        { status: 403, headers: NO_STORE }
      );
    }
    const store = await deleteQaDraft(draftId);
    if (!store) return NextResponse.json({ ok: false, code: "DRAFT_NOT_FOUND" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true, deleted: true, draft_id: draftId, store }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "BRIDGE_STORE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
