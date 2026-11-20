// C03 - TFI: the residual register is closed AND the live deployment is self-describing.
// Proves the LIVE contract of /version and /api/version (the deployed build reports the commit it runs),
// checks the live deployment id against the recorded provenance + rollback target, reads the residual
// register, and requires the owner-facing RUNBOOK to carry the same facts. The local drift guard
// (scripts/verify-deploy-provenance.mjs) runs read-only as a second witness.
//
// Contract note: api/version.js returns `commitSource` (camelCase), documented in RUNBOOK + deploy-provenance.json.
// An earlier revision of this check looked for `commit_source` and therefore failed a working deployment.
import { run, httpGet, done } from "../lib/harness.mjs";
import { P, readText, scanSecretValues, words } from "../lib/wave3-c.mjs";

const out = {};
const parse = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

const live = await httpGet("https://tourism-intelligence-engine.vercel.app/version");
const liveApi = await httpGet("https://tourism-intelligence-engine.vercel.app/api/version");
const body = parse(live);
const apiBody = parse(liveApi);
const commitSource = body ? (body.commitSource ?? body.commit_source ?? null) : null;

// The recorded provenance: the live deployment it names and the rollback target that must be kept.
let record = null;
try { record = JSON.parse(readText(`${P.tfi}\\docs\\deploy-provenance.json`)); } catch { record = null; }

out.liveVersion = {
  status: live.status,
  apiStatus: liveApi.status,
  json: Boolean(body),
  apiJson: Boolean(apiBody),
  product: body?.product ?? null,
  engineVersion: body?.engineVersion ?? null,
  commit: body?.commit ?? null,
  commitSource,
  branch: body?.branch ?? null,
  deploymentId: body?.deploymentId ?? null,
  environment: body?.environment ?? null,
  builtFrom: body?.builtFrom ?? null,
  cacheControl: live.headers["cache-control"] || null,
  secretHits: live.status === 200 ? scanSecretValues(live.body).map((h) => h.name) : [],
  apiSecretHits: liveApi.status === 200 ? scanSecretValues(liveApi.body).map((h) => h.name) : [],
};

out.record = record
  ? {
      liveDeployment: record.liveDeployment?.id ?? null,
      recordedCommit: record.liveDeployment?.gitCommitSha ?? null,
      rollbackTarget: record.rollbackTarget?.id ?? null,
      repairBranch: record.repo?.repairBranch?.local ?? null,
      configDrift: record.configDrift?.status ?? null,
    }
  : null;

const register = readText(`${P.tfi}\\docs\\RESIDUAL_REGISTER.md`);
const rows = register.split(/\r?\n/).filter((l) => /^\|\s*R-TFI-\d+/.test(l));
const parsed = rows.map((l) => l.split("|").map((c) => c.trim()).filter(Boolean));
const open = parsed.filter((c) => /OPEN/.test(c[2] || "")).map((c) => ({ id: c[0], status: c[2] }));
const withoutClosure = parsed.filter((c) => !/CLOSED/.test(c[2] || "") || (c[3] || "").length < 20).map((c) => c[0]);
out.register = { rows: rows.length, open, withoutClosure };

const runbook = readText(`${P.tfi}\\RUNBOOK.md`);
out.runbook = {
  bytes: runbook.length,
  namesRollback: Boolean(record?.rollbackTarget?.id && runbook.includes(record.rollbackTarget.id)),
  namesRepairBranch: runbook.includes("feat/r5-tfi-guidesource-repair"),
  liveVersionParagraphStale: /answers 404 for `\/version`/.test(runbook),
};

const verifier = await run(process.execPath, ["scripts/verify-deploy-provenance.mjs"], { cwd: P.tfi, timeoutMs: 180000 });
out.verifier = { code: verifier.code, tail: words(verifier.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")) };

const problems = [];
if (live.status !== 200) problems.push(`live /version -> ${live.status}`);
else if (!body) problems.push("live /version is not JSON");
else {
  if (body.ok !== true) problems.push("/version ok !== true");
  if (body.product !== "TOURISM_INTELLIGENCE_ENGINE_V2") problems.push(`/version product=${body.product}`);
  if (!/^\d+\.\d+\.\d+$/.test(String(body.engineVersion || ""))) problems.push(`/version engineVersion=${body.engineVersion}`);
  if (!/^[0-9a-f]{40}$/.test(String(body.commit || ""))) problems.push("/version does not name a full 40-hex commit");
  if (commitSource !== "vercel-git" && commitSource !== "env-source-sha") {
    problems.push(`/version commitSource=${JSON.stringify(commitSource)} (must name its source, not be unrecorded)`);
  }
  if (!body.branch) problems.push("/version has no branch");
  if (!/^dpl_[A-Za-z0-9]+$/.test(String(body.deploymentId || ""))) problems.push("/version has no Vercel deploymentId");
  if (String(live.headers["cache-control"] || "").includes("public")) problems.push("/version is cacheable");
}
if (liveApi.status !== 200 || !apiBody) problems.push(`live /api/version -> ${liveApi.status} (not JSON)`);
else if (apiBody.commit !== body?.commit || (apiBody.commitSource ?? apiBody.commit_source) !== commitSource) {
  problems.push("/api/version disagrees with /version");
}
if (out.liveVersion.secretHits.length) problems.push("/version body has a credential-VALUE shape");
if (out.liveVersion.apiSecretHits.length) problems.push("/api/version body has a credential-VALUE shape");

if (!record) problems.push("docs/deploy-provenance.json does not parse");
else {
  if (body && record.liveDeployment?.id !== body.deploymentId) {
    problems.push(`recorded live deployment ${record.liveDeployment?.id} != live ${body.deploymentId}`);
  }
  if (body && record.liveDeployment?.gitCommitSha !== body.commit) {
    problems.push(`recorded commit ${record.liveDeployment?.gitCommitSha} != live ${body.commit}`);
  }
  if (!/^dpl_/.test(String(record.rollbackTarget?.id || ""))) problems.push("no rollback deployment id recorded");
  else if (record.rollbackTarget.id === record.liveDeployment?.id) problems.push("rollback target equals the live deployment");
  if (record.configDrift?.status !== "CLOSED") problems.push(`configDrift status=${record.configDrift?.status}`);
}

if (rows.length < 7) problems.push(`residual register has only ${rows.length} R-TFI rows`);
if (open.length) problems.push(`residual register still OPEN: ${open.map((o) => o.id).join(", ")}`);
if (withoutClosure.length) problems.push(`register rows without CLOSED status + closure evidence: ${withoutClosure.join(", ")}`);

if (!out.runbook.namesRollback) problems.push("RUNBOOK does not name the recorded rollback deployment id");
if (!out.runbook.namesRepairBranch) problems.push("RUNBOOK does not tell the repair-branch story");
if (out.runbook.liveVersionParagraphStale) problems.push("RUNBOOK still says the live alias answers 404 for /version");

if (verifier.code !== 0) problems.push(`verify-deploy-provenance.mjs exit ${verifier.code}`);

done(
  "C03",
  problems.length === 0,
  problems.length
    ? problems.join("; ")
    : `live /version 200 commit=${body.commit} source=${commitSource} dpl=${body.deploymentId}; record+rollback ids match; register ${rows.length} rows 0 open; RUNBOOK consistent`,
  out,
);
