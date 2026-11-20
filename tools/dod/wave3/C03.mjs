// C03 - TFI: the residual register is closed AND the live deployment is self-describing.
// Re-proves the deployed /version from the live alias and reads the register rows; the local
// drift guard (scripts/verify-deploy-provenance.mjs) runs read-only as a second witness.
import { run, httpGet, done } from "../lib/harness.mjs";
import { P, readText, scanSecretValues, words } from "../lib/wave3-c.mjs";

const out = {};
const live = await httpGet("https://tourism-intelligence-engine.vercel.app/version");
const liveApi = await httpGet("https://tourism-intelligence-engine.vercel.app/api/version");
let body = null;
try { body = JSON.parse(live.body); } catch { /* not json */ }
out.liveVersion = {
  status: live.status,
  apiStatus: liveApi.status,
  json: Boolean(body),
  commit: body && (body.commit ?? null),
  commit_source: body && (body.commit_source ?? null),
  hasDeployment: Boolean(body && body.deployment),
  cacheControl: live.headers["cache-control"] || null,
  secretHits: live.status === 200 ? scanSecretValues(live.body).map((h) => h.name) : [],
};

const register = readText(`${P.tfi}\\docs\\RESIDUAL_REGISTER.md`);
const rows = register.split(/\r?\n/).filter((l) => /^\|\s*R-TFI-\d+/.test(l));
const open = rows
  .map((l) => l.split("|").map((c) => c.trim()).filter(Boolean))
  .filter((c) => /OPEN/.test(c[2] || ""))
  .map((c) => ({ id: c[0], status: c[2] }));
out.register = { rows: rows.length, open };

const verifier = await run(process.execPath, ["scripts/verify-deploy-provenance.mjs"], { cwd: P.tfi, timeoutMs: 180000 });
out.verifier = { code: verifier.code, tail: words(verifier.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")) };

const problems = [];
if (live.status !== 200) problems.push(`live /version -> ${live.status} (R-TFI-06: the deployed build predates the endpoint)`);
else if (!body) problems.push("live /version is not JSON");
else {
  if (!body.commit) problems.push("/version does not name a commit");
  if (!("commit_source" in body)) problems.push("/version has no commit_source (pre-contract build)");
  if (String(live.headers["cache-control"] || "").includes("public")) problems.push("/version is cacheable");
}
if (live.status === 200 && out.liveVersion.secretHits.length) problems.push("/version body has a credential-VALUE shape");
if (open.length) problems.push(`residual register still OPEN: ${open.map((o) => o.id).join(", ")}`);

done("C03", problems.length === 0, problems.length ? problems.join("; ") : `live /version 200 commit=${body.commit} source=${body.commit_source}; register ${rows.length} rows, 0 open`, out);
