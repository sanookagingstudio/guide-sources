import { NextResponse } from "next/server";
import { bridgeAuth } from "@/lib/bridge-auth";
import { toDraftInput } from "@/lib/bridge-draft";
import { BRIDGE_CONTRACT, listDrafts, putDraft, storeKind } from "@/lib/bridge-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function authFailure(state: "unconfigured" | "unauthorized") {
  if (state === "unconfigured") {
    return NextResponse.json(
      { ok: false, code: "BRIDGE_NOT_CONFIGURED", detail: "the service token is not set on this deployment" },
      { status: 503, headers: NO_STORE }
    );
  }
  return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
}

/**
 * POST /api/bridge/drafts - create (or re-send) ONE guide draft.
 *
 * This is the write side of `guide-source-draft@1.0.0`: a draft arrives from the
 * intelligence side, is stored durably and can be read back by id. A QA draft is
 * named `QA-*` and is the only kind the purge route will delete.
 */
export async function POST(request: Request) {
  const auth = bridgeAuth(request.headers);
  if (auth !== "ok") return authFailure(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "DRAFT_INCOMPLETE", fields: ["body must be JSON"] }, { status: 400, headers: NO_STORE });
  }

  const input = toDraftInput(body);
  if ("error" in input) {
    return NextResponse.json({ ok: false, code: "DRAFT_INCOMPLETE", fields: input.fields }, { status: 400, headers: NO_STORE });
  }

  if (storeKind() !== "postgres") {
    return NextResponse.json(
      { ok: false, code: "BRIDGE_STORE_UNAVAILABLE", detail: "no durable draft store is configured" },
      { status: 503, headers: NO_STORE }
    );
  }

  try {
    const store = await putDraft(input.record);
    return NextResponse.json(
      {
        ok: true,
        contract: BRIDGE_CONTRACT,
        contract_version: BRIDGE_CONTRACT,
        draft_id: input.record.draft_id,
        qa: input.record.qa,
        store,
        created_at: input.record.created_at,
        url: `/api/bridge/drafts/${encodeURIComponent(input.record.draft_id)}`,
      },
      { status: 201, headers: NO_STORE }
    );
  } catch {
    return NextResponse.json(
      { ok: false, code: "BRIDGE_STORE_UNAVAILABLE", detail: "the durable store refused the write" },
      { status: 503, headers: NO_STORE }
    );
  }
}

/** GET /api/bridge/drafts[?qa=1] - the most recent drafts (QA filter for cleanup checks). */
export async function GET(request: Request) {
  const auth = bridgeAuth(request.headers);
  if (auth !== "ok") return authFailure(auth);

  const qaOnly = new URL(request.url).searchParams.get("qa") === "1";
  try {
    const drafts = await listDrafts(qaOnly);
    return NextResponse.json(
      {
        ok: true,
        contract: BRIDGE_CONTRACT,
        store: storeKind(),
        qa_only: qaOnly,
        count: drafts.length,
        drafts: drafts.map((draft) => ({ draft_id: draft.draft_id, qa: draft.qa, title: draft.title, updated_at: draft.updated_at })),
      },
      { status: 200, headers: NO_STORE }
    );
  } catch {
    return NextResponse.json(
      { ok: false, code: "BRIDGE_STORE_UNAVAILABLE", detail: "the durable store could not answer" },
      { status: 503, headers: NO_STORE }
    );
  }
}
