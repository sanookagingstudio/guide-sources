// Validation for the guide draft contract (`guide-source-draft@1.0.0`).
// Kept out of the route handlers so the same rules can be exercised directly.
import { BRIDGE_CONTRACT, QA_PREFIX, type GuideDraftRecord } from "./bridge-store";

export type DraftInput = {
  record: GuideDraftRecord;
};

export type DraftInputError = {
  error: string;
  fields: string[];
};

const ID_RE = /^[A-Za-z0-9._:-]{3,120}$/;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function arr(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

export function toDraftInput(body: unknown, now = new Date()): DraftInput | DraftInputError {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "draft_incomplete", fields: ["body must be a JSON object"] };
  }
  const value = body as Record<string, unknown>;
  const fields: string[] = [];

  const title = str(value.title, 300);
  if (!title) fields.push("title");

  const summary = str(value.summary, 4000);
  const locale = str(value.locale, 5);
  const qa = value.qa === true;
  const requestedBy = str(value.requested_by, 200);
  const claims = arr(value.claims, 50);
  const sources = arr(value.sources, 50);

  const contract = str(value.contract_version, 40) || BRIDGE_CONTRACT;
  if (contract !== BRIDGE_CONTRACT) fields.push(`contract_version must be ${BRIDGE_CONTRACT}`);

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const draftId = str(value.draft_id, 120) || `${qa ? QA_PREFIX : ""}GS-DRAFT-${stamp}`;
  if (!ID_RE.test(draftId)) fields.push("draft_id must be 3-120 chars of A-Za-z0-9._:-");
  if (qa && !draftId.startsWith(QA_PREFIX)) fields.push(`a qa draft must be named ${QA_PREFIX}*`);

  if (fields.length) return { error: "draft_incomplete", fields };

  const at = now.toISOString();
  return {
    record: {
      draft_id: draftId,
      contract_version: BRIDGE_CONTRACT,
      title,
      summary,
      locale: locale || null,
      qa,
      requested_by: requestedBy || null,
      claims,
      sources,
      created_at: at,
      updated_at: at,
    },
  };
}
