// Draft store adapters for the standalone service.
//
// `mock-file` is the only adapter this build ships: a deterministic, atomic,
// file-backed store that keeps the contract's durability rule (a draft written
// by one process is readable by the next). There is deliberately NO Postgres /
// Supabase adapter in this package: the live store is a connect-day decision,
// and `GUIDE_LIVE_STORE_URL` is refused at startup instead of silently used.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GuideDraftRecord } from "./contract.js";

export type DraftStoreKind = "mock-file" | "unavailable";

export interface DraftStore {
  kind(): DraftStoreKind;
  put(record: GuideDraftRecord): Promise<DraftStoreKind>;
  get(draftId: string): Promise<GuideDraftRecord | null>;
  list(qaOnly: boolean, limit?: number): Promise<GuideDraftRecord[]>;
  /** Deletes a QA draft only; returns false (never throws) for anything else. */
  deleteQa(draftId: string): Promise<boolean>;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalize(row: Record<string, unknown>): GuideDraftRecord {
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

export function resolveStoreDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.GUIDE_MOCK_STORE_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return path.join(os.tmpdir(), "guide-sources-standalone", "mock-store");
}

/**
 * File-backed draft store: one JSON document, re-read on every operation so a
 * second process (or a restarted one) sees what the first wrote.
 */
export class FileDraftStore implements DraftStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "guide-drafts.json");
  }

  kind(): DraftStoreKind {
    return "mock-file";
  }

  private async load(): Promise<Map<string, GuideDraftRecord>> {
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as { drafts?: unknown };
      const map = new Map<string, GuideDraftRecord>();
      for (const row of Array.isArray(parsed.drafts) ? parsed.drafts : []) {
        if (row && typeof row === "object") {
          const record = normalize(row as Record<string, unknown>);
          map.set(record.draft_id, record);
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private async save(map: Map<string, GuideDraftRecord>): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const payload = JSON.stringify({ store: "mock-file", drafts: [...map.values()] }, null, 2);
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, this.file);
  }

  async put(record: GuideDraftRecord): Promise<DraftStoreKind> {
    const map = await this.load();
    const existing = map.get(record.draft_id);
    map.set(record.draft_id, {
      ...record,
      created_at: existing ? existing.created_at : record.created_at,
    });
    await this.save(map);
    return "mock-file";
  }

  async get(draftId: string): Promise<GuideDraftRecord | null> {
    return (await this.load()).get(draftId) ?? null;
  }

  async list(qaOnly: boolean, limit = 20): Promise<GuideDraftRecord[]> {
    const rows = [...(await this.load()).values()].filter((row) => (qaOnly ? row.qa === true : true));
    rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
    return rows.slice(0, limit);
  }

  async deleteQa(draftId: string): Promise<boolean> {
    const map = await this.load();
    const row = map.get(draftId);
    // The QA rule lives in the adapter too, exactly like the live SQL predicate
    // (`DELETE ... AND qa = true`), so a route bug cannot widen the delete.
    if (!row || row.qa !== true) return false;
    map.delete(draftId);
    await this.save(map);
    return true;
  }
}
