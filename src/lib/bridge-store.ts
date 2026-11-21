// Durable store for guide drafts received from the intelligence/handoff side
// (`guide-source-draft@1.0.0`, consumed by TFI's Guide Sources consumer profile).
//
// Why this exists: the guide-sources site is a Next.js app on Vercel whose only
// data layer is a browser Supabase client, so there is no durable place for a
// draft to live between requests. A QA draft that has to be visible in TFI and
// then deleted cannot be kept in function memory (/tmp is per-instance and
// recycled). When `GUIDE_SOURCES_BRIDGE_STORE_URL` is set the record goes to the
// shared PostgreSQL (schema `guide_sources_bridge`); without it the store reports
// `unavailable` and every write is refused instead of pretending to succeed.
//
// Nothing here decides policy: the QA-only purge rule lives in the route and is
// enforced again by the SQL predicate (`DELETE ... AND qa = true`).
import postgres from "postgres";

export const BRIDGE_CONTRACT = "guide-source-draft@1.0.0";
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

export type DraftStoreKind = "postgres" | "unavailable";

const DDL = `
CREATE SCHEMA IF NOT EXISTS guide_sources_bridge;
CREATE TABLE IF NOT EXISTS guide_sources_bridge.guide_drafts (
  draft_id text PRIMARY KEY,
  contract_version text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  locale text,
  qa boolean NOT NULL DEFAULT false,
  requested_by text,
  claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS guide_drafts_qa_idx ON guide_sources_bridge.guide_drafts (qa);
`;

type Sql = ReturnType<typeof postgres>;

let sql: Sql | null = null;
let ready: Promise<void> | null = null;

export function storeKind(): DraftStoreKind {
  return process.env.GUIDE_SOURCES_BRIDGE_STORE_URL ? "postgres" : "unavailable";
}

function client(): Sql {
  if (!sql) {
    const url = String(process.env.GUIDE_SOURCES_BRIDGE_STORE_URL);
    const local = /@(localhost|127\.0\.0\.1)([:/]|$)/i.test(url);
    sql = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => undefined,
      // Supabase (and any managed Postgres) requires TLS; a local test server does not.
      ...(local ? {} : { ssl: "require" as const }),
    });
  }
  return sql;
}

async function ensureSchema(): Promise<void> {
  if (!process.env.GUIDE_SOURCES_BRIDGE_STORE_URL) return;
  if (!ready) {
    ready = (async () => {
      await client().unsafe(DDL);
    })();
    ready.catch(() => {
      ready = null;
      sql?.end({ timeout: 1 }).catch(() => undefined);
      sql = null;
    });
  }
  await ready;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function fromRow(row: Record<string, unknown>): GuideDraftRecord {
  return {
    draft_id: String(row.draft_id),
    contract_version: String(row.contract_version),
    title: String(row.title),
    summary: String(row.summary ?? ""),
    locale: row.locale == null ? null : String(row.locale),
    qa: row.qa === true,
    requested_by: row.requested_by == null ? null : String(row.requested_by),
    claims: Array.isArray(row.claims) ? (row.claims as unknown[]) : [],
    sources: Array.isArray(row.sources) ? (row.sources as unknown[]) : [],
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function putDraft(record: GuideDraftRecord): Promise<DraftStoreKind> {
  if (storeKind() !== "postgres") return "unavailable";
  await ensureSchema();
  const db = client();
  await db`
    INSERT INTO guide_sources_bridge.guide_drafts
      (draft_id, contract_version, title, summary, locale, qa, requested_by, claims, sources, created_at, updated_at)
    VALUES
      (${record.draft_id}, ${record.contract_version}, ${record.title}, ${record.summary}, ${record.locale},
       ${record.qa}, ${record.requested_by}, ${JSON.stringify(record.claims)}::jsonb, ${JSON.stringify(record.sources)}::jsonb,
       ${record.created_at}, ${record.updated_at})
    ON CONFLICT (draft_id) DO UPDATE SET
      title = EXCLUDED.title, summary = EXCLUDED.summary, locale = EXCLUDED.locale,
      claims = EXCLUDED.claims, sources = EXCLUDED.sources, updated_at = EXCLUDED.updated_at
  `;
  return "postgres";
}

export async function getDraft(draftId: string): Promise<GuideDraftRecord | null> {
  if (storeKind() !== "postgres") return null;
  await ensureSchema();
  const rows = await client()`SELECT * FROM guide_sources_bridge.guide_drafts WHERE draft_id = ${draftId} LIMIT 1`;
  return rows.length ? fromRow(rows[0] as Record<string, unknown>) : null;
}

export async function listDrafts(qaOnly: boolean, limit = 20): Promise<GuideDraftRecord[]> {
  if (storeKind() !== "postgres") return [];
  await ensureSchema();
  const rows = qaOnly
    ? await client()`SELECT * FROM guide_sources_bridge.guide_drafts WHERE qa = true ORDER BY updated_at DESC LIMIT ${limit}`
    : await client()`SELECT * FROM guide_sources_bridge.guide_drafts ORDER BY updated_at DESC LIMIT ${limit}`;
  return rows.map((row) => fromRow(row as Record<string, unknown>));
}

/** Deletes only a QA-marked row; returns the store used, or null when nothing matched. */
export async function deleteQaDraft(draftId: string): Promise<DraftStoreKind | null> {
  if (storeKind() !== "postgres") return null;
  await ensureSchema();
  const rows = await client()`
    DELETE FROM guide_sources_bridge.guide_drafts WHERE draft_id = ${draftId} AND qa = true RETURNING draft_id
  `;
  return rows.length ? "postgres" : null;
}
