// Service-token gate for the guide-sources bridge routes.
//
// The token is generated locally and stored only in the DPAPI vault
// (`GUIDE_SOURCES_SERVICE_TOKEN`); it is set on the Vercel project from the vault
// and never printed. An unset token is `unconfigured` (503, fail closed), never
// "allow".
import { timingSafeEqual } from "node:crypto";

export type BridgeAuthState = "ok" | "unconfigured" | "unauthorized";

export function bridgeAuth(headers: Headers): BridgeAuthState {
  const expected = process.env.GUIDE_SOURCES_SERVICE_TOKEN || "";
  if (!expected) return "unconfigured";
  const supplied = headers.get("x-guide-sources-service-token") || "";
  if (!supplied) return "unauthorized";
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return "unauthorized";
  return timingSafeEqual(a, b) ? "ok" : "unauthorized";
}
