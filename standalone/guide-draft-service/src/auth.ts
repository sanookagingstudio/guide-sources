// Service-token gate, mirrored from the live app (`src/lib/bridge-auth.ts`).
//
// The token is supplied by the caller at start-up (in CI or a check: generated
// in process memory). It is never logged, never written to a file and never
// echoed in a response. An unset token is `unconfigured` (503, fail closed).
import { timingSafeEqual } from "node:crypto";

export type BridgeAuthState = "ok" | "unconfigured" | "unauthorized";

export const SERVICE_TOKEN_HEADER = "x-guide-sources-service-token";

export function checkServiceToken(
  header: (name: string) => string | undefined,
  expected: string
): BridgeAuthState {
  if (!expected) return "unconfigured";
  const supplied = header(SERVICE_TOKEN_HEADER) || "";
  if (!supplied) return "unauthorized";
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return "unauthorized";
  return timingSafeEqual(a, b) ? "ok" : "unauthorized";
}
