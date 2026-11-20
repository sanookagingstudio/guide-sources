// TRACK C (wave 3) shared constants + helpers for tools/dod/wave3/C*.mjs.
// Read-only helpers: hash files, scan for VALUE-shaped secret patterns (never returns the value),
// run a Windows command line, and hold the absolute repo paths of the 10 queued internal systems.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { run } from "./harness.mjs";

export const P = {
  gs: "D:\\FUNAGING_WEB\\01_ACTIVE\\guide-sources__9CC897324B2F",
  mediaos: "D:\\MediaOS\\source",
  tfi: "D:\\FunAging\\TourismIntelligence",
  hub: "D:\\FUNAGING_WEB\\01_ACTIVE\\sanook-master-v2__8402E8309ACC\\funaging-omnichannel-engagement-hub",
  field: "D:\\FUNAGING_WEB\\01_ACTIVE\\funaging-field-app__2C9CF4FBE075",
  mb: "D:\\FUNAGING_WEB\\01_ACTIVE\\funaging-machine-bible__22862B719710",
  cm: "D:\\CONTROL_MACHINE",
  mainweb: "D:\\FUNAGING_WEB\\02_WORK\\MAINWEB_LPHHW_BRIDGE_20261116",
  owner: "D:\\FUNAGING_TEMP\\eco_owner",
  track: "D:\\FUNAGING_TEMP\\tracks\\C",
  apk: "D:\\FUNAGING_TEMP\\tracks\\C\\apk_evidence",
  tmp: "D:\\FUNAGING_TEMP\\tracks\\C\\tmp",
  sdk: "D:\\Android\\Sdk",
  buildTools: "D:\\Android\\Sdk\\build-tools\\34.0.0",
  adb: "D:\\Android\\Sdk\\platform-tools\\adb.exe",
  emulator: "D:\\Android\\Sdk\\emulator\\emulator.exe",
  avdHome: "D:\\FUNAGING_TEMP\\tracks\\C\\avd",
};

export const URLS = {
  gs: "https://guide-sources.vercel.app",
  mediaosWeb: "https://funaging-media-os-web.vercel.app",
  mediaosApi: "https://funaging-media-os-api.vercel.app",
  tfi: "https://tourism-intelligence-engine.vercel.app",
  hub: "https://funaging-omnichannel-hub.vercel.app",
  field: "https://funaging-field-app.vercel.app",
  releases: "https://funaging.club/releases",
};

// Windows needs a shell for *.cmd shims (npm, npx, vercel). Run through cmd.exe so nothing is re-quoted.
export const runShell = (line, opts = {}) =>
  run("cmd.exe", ["/d", "/s", "/c", line], { shell: false, ...opts });

export function sha256File(file) {
  const h = createHash("sha256");
  h.update(readFileSync(file));
  return h.digest("hex").toUpperCase();
}

export function readText(file, maxBytes = 4 * 1024 * 1024) {
  if (!existsSync(file)) return "";
  if (statSync(file).size > maxBytes) return readFileSync(file).subarray(0, maxBytes).toString("utf8");
  return readFileSync(file, "utf8");
}

// VALUE-shaped credential patterns only. A bare word such as "service_role" is a NAME and must not match.
export const SECRET_VALUE_PATTERNS = [
  ["supabase-secret", /sb_secret_[A-Za-z0-9_-]{16,}/g],
  ["supabase-publishable", /sb_publishable_[A-Za-z0-9_-]{16,}/g],
  ["stripe-live", /sk_live_[A-Za-z0-9]{16,}/g],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
  ["jwt", /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g],
  ["postgres-url-with-password", /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@/g],
  ["pem-private-key", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ["generic-bearer", /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{24,}/g],
  ["github-token", /gh[pousr]_[A-Za-z0-9]{30,}/g],
  ["google-api-key", /AIza[0-9A-Za-z_-]{30,}/g],
];

// Returns [{name, count}] - never the matched bytes.
export function scanSecretValues(text) {
  const hits = [];
  for (const [name, re] of SECRET_VALUE_PATTERNS) {
    const m = String(text).match(new RegExp(re.source, "g"));
    if (m && m.length) hits.push({ name, count: m.length });
  }
  return hits;
}

export const words = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 400);

export function gradleVersion(file) {
  const t = readText(file);
  const code = (t.match(/versionCode\s+(\d+)/) || [])[1] || "";
  const name = (t.match(/versionName\s+"([^"]+)"/) || [])[1] || "";
  return { versionCode: code ? Number(code) : null, versionName: name || null };
}

export function jsonSafe(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch { return { error: "not-serialisable" }; }
}
