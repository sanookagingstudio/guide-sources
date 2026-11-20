// C09 - bridge env: the two service tokens exist in the DPAPI vault, are well-formed, distinct, not reused,
// and no plaintext copy exists. The verifier is check-only (it never prints a value); this check also scans its
// own output for a 64-hex token shape.
import { existsSync } from "node:fs";
import { run, done } from "../lib/harness.mjs";
import { P, words } from "../lib/wave3-c.mjs";

const out = {};
const script = `${P.owner}\\tools\\Test-BridgeEnv.ps1`;
out.scriptPresent = existsSync(script);
const res = await run("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { cwd: P.owner, timeoutMs: 900000 });
out.exit = res.code;
out.stdout = words(res.out.slice(-600));
out.stderr = words(res.err.slice(-300));
const ok = res.code === 0 && /BRIDGE_ENV_OK names=2 checks=(\d+)/.test(res.out);
const checks = Number((res.out.match(/BRIDGE_ENV_OK names=2 checks=(\d+)/) || [])[1] || 0);
const leaked = /\b[0-9a-f]{64}\b/i.test(res.out) || /\b[0-9a-f]{64}\b/i.test(res.err);
out.leaked64HexInOutput = leaked;

const problems = [];
if (!out.scriptPresent) problems.push("Test-BridgeEnv.ps1 missing");
if (!ok) problems.push(`bridge env verifier exit ${res.code}: ${words(res.err || res.out).slice(0, 200)}`);
if (checks < 11) problems.push(`only ${checks} checks ran (expected 11)`);
if (leaked) problems.push("a 64-hex value appeared in the verifier output (value leak)");

done("C09", problems.length === 0, problems.length ? problems.join("; ") : `BRIDGE_ENV_OK names=2 checks=${checks}; no 64-hex value in output`, out);
