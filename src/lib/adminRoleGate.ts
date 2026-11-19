// DEF-17: admin panel role gate + latest-run-wins guard.
// Extracted from AdminTab so the exact production logic is executable by tests
// (tests/admin-load-concurrency.test.mjs transpiles this module and drives it).

export type GateRole = 'admin' | 'editor' | 'viewer';

const GATE_ROLES: GateRole[] = ['admin', 'editor', 'viewer'];

/**
 * Map the role string returned by /api/admin/me onto an accepted gate role.
 * Anything else - member, anonymous, malformed payloads, undefined, objects -
 * resolves to null so the caller fails closed instead of mounting the panel.
 */
export function resolveGateRole(candidate: unknown): GateRole | null {
  if (typeof candidate !== 'string') return null;
  const normalised = candidate.trim().toLowerCase();
  return (GATE_ROLES as string[]).includes(normalised) ? (normalised as GateRole) : null;
}

export interface RunGuard {
  /** Start a new run and return its generation token. */
  begin(): number;
  /** Current generation. */
  current(): number;
  /** True only for the newest run. */
  isCurrent(run: number): boolean;
  /**
   * Apply a state commit only if `run` is still the newest generation.
   * Returns whether the commit was applied. A stale commit is dropped, never
   * queued: stale success, stale failure and stale loading all no-op.
   */
  commit(run: number, apply: () => void): boolean;
  /** Invalidate every pending run (used on unmount). */
  invalidate(): void;
}

/**
 * Latest-run-wins guard. Every async load() takes a generation token; only the
 * newest generation may commit state. This is what stops an out-of-order
 * role/error/loading response from overwriting a newer one.
 */
export function createRunGuard(): RunGuard {
  let generation = 0;
  return {
    begin() {
      return ++generation;
    },
    current() {
      return generation;
    },
    isCurrent(run) {
      return run === generation;
    },
    commit(run, apply) {
      if (run !== generation) return false;
      apply();
      return true;
    },
    invalidate() {
      generation += 1;
    },
  };
}
