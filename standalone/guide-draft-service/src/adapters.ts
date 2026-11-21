// Adapter resolution + per-route live flags.
//
// A standalone build must never reach a live system: when a live store URL is
// configured the process refuses to start (`resolveAdapters` returns null and
// `server.ts` exits 2). Flags are OFF unless explicitly turned on, and an ON
// flag answers an honest 501 instead of a fabricated live call.
import { GUIDE_LIVE_FLAGS, type GuideLiveFlag } from "./contract.js";
import { FileDraftStore, resolveStoreDir, type DraftStore } from "./store.js";

export const MOCK_ADAPTER = "mock-guide-draft@1";

export type Adapters = {
  kind: typeof MOCK_ADAPTER;
  store: DraftStore;
  live_connections: 0;
};

export function liveStoreUrl(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.GUIDE_LIVE_STORE_URL || "").trim();
}

/** null means "refuse to start": a live data source is configured for a mock build. */
export function resolveAdapters(env: NodeJS.ProcessEnv = process.env): Adapters | null {
  if (liveStoreUrl(env)) return null;
  return { kind: MOCK_ADAPTER, store: new FileDraftStore(resolveStoreDir(env)), live_connections: 0 };
}

export function flagEnabled(env: NodeJS.ProcessEnv, flag: GuideLiveFlag): boolean {
  const value = String(env[flag] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function flagSnapshot(env: NodeJS.ProcessEnv = process.env): Record<GuideLiveFlag, boolean> {
  return Object.fromEntries(GUIDE_LIVE_FLAGS.map((flag) => [flag, flagEnabled(env, flag)])) as Record<GuideLiveFlag, boolean>;
}
