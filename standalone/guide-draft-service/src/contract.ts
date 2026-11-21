// Contract module for the guide-sources standalone service.
//
// The contract is the deployed bridge contract `guide-source-draft@1.0.0`
// (see ../../src/lib/bridge-store.ts). This file is the standalone, dependency
// free re-statement of it: field names, validation rules, refusals and the
// per-route live flags. `tools/dod/planv2/P2C-GUIDE.mjs` re-reads BOTH files
// independently and fails on drift, so this copy can never quietly diverge.

export const GUIDE_SOURCE_DRAFT_CONTRACT = "guide-source-draft@1.0.0";
export const QA_PREFIX = "QA-";

export type GuideDraftRecord = {
  draft_id: string;
  contract_version: string;
  title: string;
  summary: string;
  locale: string | null;
  qa: boolean;
  requested_by: string | null;
  claims: unknown[];
  sources: unknown[];
  created_at: string;
  updated_at: string;
};

/** The exact record field order of `GuideDraftRecord` (drift-checked). */
export const GUIDE_DRAFT_FIELDS = [
  "draft_id",
  "contract_version",
  "title",
  "summary",
  "locale",
  "qa",
  "requested_by",
  "claims",
  "sources",
  "created_at",
  "updated_at",
] as const;

/** One flag per contract route. All OFF by default; ON answers 501 until built. */
export const GUIDE_LIVE_FLAGS = [
  "GUIDE_LIVE_DRAFT_CREATE",
  "GUIDE_LIVE_DRAFT_READ",
  "GUIDE_LIVE_DRAFT_PURGE",
] as const;

export type GuideLiveFlag = (typeof GUIDE_LIVE_FLAGS)[number];

export type DraftRoute = {
  route: string;
  method: "POST" | "GET";
  path: string;
  live_flag: GuideLiveFlag;
};

export const DRAFT_ROUTES: readonly DraftRoute[] = [
  { route: "drafts.create", method: "POST", path: "/api/bridge/drafts", live_flag: "GUIDE_LIVE_DRAFT_CREATE" },
  { route: "drafts.read", method: "GET", path: "/api/bridge/drafts[/:id]", live_flag: "GUIDE_LIVE_DRAFT_READ" },
  { route: "drafts.purge", method: "POST", path: "/api/bridge/drafts/:id/purge", live_flag: "GUIDE_LIVE_DRAFT_PURGE" },
];

export const MAX_CLAIMS = 50;
export const MAX_SOURCES = 50;
export const MAX_TITLE = 300;
export const MAX_SUMMARY = 4000;

const ID_RE = /^[A-Za-z0-9._:-]{3,120}$/;

/** Credential-VALUE shapes refused at the contract boundary (never echoed back). */
const SECRET_SHAPES: Array<{ name: string; re: RegExp }> = [
  { name: "64-hex", re: /\b[0-9a-f]{64}\b/i },
  { name: "sk-key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "service-role-jwt", re: /\bservice_role\b/i },
];

/** Field names that only ever carry credentials on the live side. */
const SECRET_FIELDS = [
  "token",
  "password",
  "secret",
  "secret_key",
  "service_role_key",
  "authorization",
  "bearer",
  "api_key",
  "apikey",
  "private_key",
];

export type DraftInput = { record: GuideDraftRecord };
export type DraftInputError = { error: "draft_incomplete" | "secret_material"; fields: string[] };

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function arr(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

/**
 * Names the credential material found in a draft body, never the value itself.
 * A mock adapter is a test target: shipping a credential through it would put a
 * secret in a test store and in the contract-test transcript, so the boundary
 * refuses credential shapes and credential field names.
 */
export function findSecretMaterial(body: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown, at: string): void => {
    if (typeof value === "string") {
      for (const shape of SECRET_SHAPES) if (shape.re.test(value)) found.push(`${at}:${shape.name}`);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 20).forEach((item, index) => walk(item, `${at}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_FIELDS.includes(key.toLowerCase())) found.push(`${at}.${key}:credential-field`);
        walk(inner, `${at}.${key}`);
      }
    }
  };
  walk(body, "body");
  return [...new Set(found)];
}

/** Mirrors `toDraftInput` of the live app (`src/lib/bridge-draft.ts`). */
export function toDraftInput(body: unknown, now: Date = new Date()): DraftInput | DraftInputError {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "draft_incomplete", fields: ["body must be a JSON object"] };
  }
  const secret = findSecretMaterial(body);
  if (secret.length) return { error: "secret_material", fields: secret };

  const value = body as Record<string, unknown>;
  const fields: string[] = [];

  const title = str(value.title, MAX_TITLE);
  if (!title) fields.push("title");

  const summary = str(value.summary, MAX_SUMMARY);
  const locale = str(value.locale, 5);
  const qa = value.qa === true;
  const requestedBy = str(value.requested_by, 200);
  const claims = arr(value.claims, MAX_CLAIMS);
  const sources = arr(value.sources, MAX_SOURCES);

  const contract = str(value.contract_version, 40) || GUIDE_SOURCE_DRAFT_CONTRACT;
  if (contract !== GUIDE_SOURCE_DRAFT_CONTRACT) fields.push(`contract_version must be ${GUIDE_SOURCE_DRAFT_CONTRACT}`);

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const draftId = str(value.draft_id, 120) || `${qa ? QA_PREFIX : ""}GS-DRAFT-${stamp}`;
  if (!ID_RE.test(draftId)) fields.push("draft_id must be 3-120 chars of A-Za-z0-9._:-");
  if (qa && !draftId.startsWith(QA_PREFIX)) fields.push(`a qa draft must be named ${QA_PREFIX}*`);

  if (fields.length) return { error: "draft_incomplete", fields };

  const at = now.toISOString();
  return {
    record: {
      draft_id: draftId,
      contract_version: GUIDE_SOURCE_DRAFT_CONTRACT,
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
