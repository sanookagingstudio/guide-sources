// C11 - C-SEC rotation proof: a LIVE credential was generated locally, set on a deployed system, stored only in
// the DPAPI vault, the deployment was re-made, and the OLD value is now refused while the NEW one is accepted.
//
// Target: the MediaOS api service token (MEDIA_OS_SERVICE_TOKEN). apps/api/src/foundation/auth.ts maps
// `Authorization: Bearer <token>` to role 'automation'; a route that requires 'admin' therefore answers
// 403 {role:'automation'} for the accepted token and 401 UNAUTHENTICATED for anything else, which separates
// "credential accepted" from "no credential" without any write to production.
//
// This check also proves the guide-sources side of the row: no VALUE of any current vault secret exists anywhere
// in that public repository's object store (so there is nothing left to rotate there - the dumps exposed PII,
// 0 credential values, as C01 recorded).
//
// Values are never read by Node: PowerShell derives each value from the vault in its own process, measures it and
// probes with it. This file only ever sees names, lengths, fingerprint8, HTTP statuses and deployment ids.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { run, done } from "../lib/harness.mjs";
import { P, words } from "../lib/wave3-c.mjs";

const ROT = path.join(P.track, "tools", "rotation");
const STATE = path.join(P.track, "work", "mediaos_token_state.json");
const RECORDS = "D:\\FUNAGING_TEMP\\tracks\\deploy_records";
const KEY = "MEDIA_OS_SERVICE_TOKEN";
const RETIRED = "MEDIA_OS_SERVICE_TOKEN_RETIRED_20261121";

const out = { key: KEY, retiredKey: RETIRED, rotationScripts: {}, problems: [] };
const problems = out.problems;

function pwshJson(script, args, timeoutMs = 240000) {
  return run("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
    cwd: P.track,
    timeoutMs,
  });
}

// ---------------------------------------------------------------- 1. vault shape (no values)
const stateScript = path.join(ROT, "Get-VaultTokenState.ps1");
out.rotationScripts.getVaultState = existsSync(stateScript);
if (!out.rotationScripts.getVaultState) problems.push("Get-VaultTokenState.ps1 missing");
const vaultRun = await pwshJson(stateScript, ["-Csv", `${KEY},${RETIRED}`, "-Json"]);
let vault = null;
try { vault = JSON.parse(vaultRun.out.slice(vaultRun.out.indexOf("{"))); } catch { vault = null; }
const kCurrent = vault?.keys?.find((k) => k.name === KEY);
const kRetired = vault?.keys?.find((k) => k.name === RETIRED);
out.vault = {
  exit: vaultRun.code,
  keys: vault?.keys ?? [],
  current: kCurrent ? { present: kCurrent.present, length: kCurrent.length, hex: kCurrent.hex, fingerprint8: kCurrent.fingerprint8 } : null,
  retired: kRetired ? { present: kRetired.present, length: kRetired.length, hex: kRetired.hex, fingerprint8: kRetired.fingerprint8 } : null,
};
if (!kCurrent?.present || kCurrent.length !== 64 || !kCurrent.hex) problems.push("current token is not a 64-char hex value in the vault");
if (!kRetired?.present || kRetired.length !== 64 || !kRetired.hex) problems.push("retired token is not a 64-char hex value in the vault");
if (kCurrent && kRetired && kCurrent.fingerprint8 === kRetired.fingerprint8) problems.push("retired and current tokens are the same value");

// ---------------------------------------------------------------- 2. rotation state
out.state = null;
if (!existsSync(STATE)) {
  problems.push("rotation state file missing (no verified rotation was recorded)");
} else {
  try { out.state = JSON.parse(readFileSync(STATE, "utf8")); } catch { out.state = null; }
  if (!out.state) problems.push("rotation state file is not JSON");
}
if (out.state) {
  if (out.state.mode !== "rotate") problems.push(`state mode is ${out.state.mode}, not rotate`);
  if (!/^dpl_/.test(out.state.deployment || "")) problems.push("state has no deployment id");
  if (!/^dpl_/.test(out.state.previousDeployment || "")) problems.push("state has no previous deployment id");
  if (out.state.deployment === out.state.previousDeployment) problems.push("state deployment equals its rollback target");
  if (out.state.key !== KEY) problems.push(`state key is ${out.state.key}`);
  if (out.state.retiredKey !== RETIRED) problems.push(`state retiredKey is ${out.state.retiredKey}`);
  if (kCurrent && out.state.fingerprint8?.current !== kCurrent.fingerprint8) problems.push("state current fingerprint8 does not match the vault");
  if (kRetired && out.state.fingerprint8?.previous !== kRetired.fingerprint8) problems.push("state previous fingerprint8 does not match the retired vault entry");
  if (out.state.probe?.currentStatus !== 403 || out.state.probe?.currentRole !== "automation") problems.push("state probe did not record the new token accepted as role automation");
  if (out.state.probe?.previousStatus !== 401) problems.push("state probe did not record the retired token refused 401");
}

// ---------------------------------------------------------------- 3. live proof (values stay in PowerShell)
const smokeScript = path.join(ROT, "mediaos-token-smoke.ps1");
out.rotationScripts.smoke = existsSync(smokeScript);
if (!out.rotationScripts.smoke) problems.push("mediaos-token-smoke.ps1 missing");
const smoke = existsSync(smokeScript)
  ? await pwshJson(smokeScript, ["-Mode", "rotated"], 300000)
  : { code: -1, out: "", err: "missing" };
out.liveProbe = {
  exit: smoke.code,
  checks: (smoke.out.match(/SMOKE_MEDIAOS_TOKEN_OK mode=rotated checks=(\d+)/) || [])[1] || "0",
  pass: (smoke.out.match(/^PASS /gm) || []).length,
  fail: (smoke.out.match(/^FAIL /gm) || []).length,
  lines: smoke.out.split(/\r?\n/).filter((l) => /^(PASS|FAIL) /.test(l)).map((l) => l.slice(0, 220)),
  tail: words(smoke.out.slice(-300)),
};
if (smoke.code !== 0) problems.push(`live rotation smoke exit ${smoke.code}: ${words(smoke.err || smoke.out).slice(0, 200)}`);
if (Number(out.liveProbe.checks) < 12) problems.push(`only ${out.liveProbe.checks} live checks ran (expected 12+)`);
const leaked = /\b[0-9a-f]{64}\b/i.test(smoke.out) || /\b[0-9a-f]{64}\b/i.test(smoke.err) || /\b[0-9a-f]{64}\b/i.test(vaultRun.out);
out.valueLeak = leaked;
if (leaked) problems.push("a 64-hex value appeared in the tool output (value leak)");

// ---------------------------------------------------------------- 4. Deploy-Lock records (the change was gated)
const records = existsSync(RECORDS) ? readdirSync(RECORDS).filter((f) => f.endsWith(".json")).sort() : [];
const parsed = [];
for (const f of records) {
  const full = path.join(RECORDS, f);
  try {
    const r = JSON.parse(readFileSync(full, "utf8"));
    if (String(r.track) === "C" && /C-SEC/i.test(String(r.action || ""))) parsed.push({ file: full, ...r });
  } catch { /* not a deploy record */ }
}
out.deployRecords = parsed.map((r) => ({ file: path.basename(r.file), action: String(r.action).slice(0, 120), state: r.state, rollbackTarget: r.rollbackTarget, startedAt: r.startedAt }));

const rotationRecord = [...parsed]
  .filter((r) => r.state === "verified" && /rotation/i.test(r.action) && r.verify.includes(`retired=${kRetired?.fingerprint8}`))
  .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
if (!rotationRecord) {
  problems.push("no verified Deploy-Lock rotation record naming the retired fingerprint8");
} else {
  out.rotationRecord = {
    file: path.basename(rotationRecord.file),
    state: rotationRecord.state,
    rollbackTarget: rotationRecord.rollbackTarget,
    startedAt: rotationRecord.startedAt,
    finishedAt: rotationRecord.finishedAt,
  };
  if (out.state && rotationRecord.rollbackTarget !== out.state.previousDeployment) problems.push("rotation record rollback target is not the previous deployment in the state file");
  if (out.state && !rotationRecord.change.includes(`DEPLOYED id=${out.state.deployment}`)) problems.push("rotation record does not name the deployment in the state file");
  if (!rotationRecord.change.includes("old=401")) problems.push("rotation change probe did not record the retired token refused 401");
  if (!rotationRecord.change.includes("new=403")) problems.push("rotation change probe did not record the new token accepted 403");
  if (!rotationRecord.verify.includes("the OLD (retired) token no longer works (401)")) problems.push("rotation verify did not prove the retired token dead");
  if (!rotationRecord.verify.includes("the NEW token is accepted as identity (403 role=automation)")) problems.push("rotation verify did not prove the new token live");
}

// The bootstrap record ties the retired value to a moment when it WAS live (the old credential really worked before).
const bootstrapRecord = [...parsed]
  .filter((r) => r.state === "verified" && /bootstrap/i.test(r.action) && r.verify.includes(`fingerprint8=${kRetired?.fingerprint8}`) && r.verify.includes("the token is LIVE"))
  .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
out.bootstrapRecord = bootstrapRecord
  ? { file: path.basename(bootstrapRecord.file), state: bootstrapRecord.state, startedAt: bootstrapRecord.startedAt, rollbackTarget: bootstrapRecord.rollbackTarget }
  : null;
if (!bootstrapRecord) problems.push("no verified Deploy-Lock bootstrap record proving the retired token was live before it was retired");

// ---------------------------------------------------------------- 5. guide-sources: no vault value in the public history
const gitScanScript = path.join(ROT, "Test-VaultSecretsInGit.ps1");
out.rotationScripts.gitScan = existsSync(gitScanScript);
if (!out.rotationScripts.gitScan) problems.push("Test-VaultSecretsInGit.ps1 missing");
const gitScan = existsSync(gitScanScript)
  ? await pwshJson(gitScanScript, ["-Repo", P.gs, "-Json"], 300000)
  : { code: -1, out: "", err: "missing" };
let git = null;
try { git = JSON.parse(gitScan.out.slice(gitScan.out.indexOf("{"))); } catch { git = null; }
out.guideSourcesHistory = git
  ? { repo: git.repo, objects: git.objects, keysScanned: git.keysScanned, keysWithHits: git.keysWithHits, verdict: git.verdict, keys: (git.keys || []).map((k) => ({ name: k.name, length: k.length, hits: k.hits })) }
  : { exit: gitScan.code, tail: words(gitScan.out.slice(-300)) };
if (!git) problems.push(`vault-vs-git scan produced no JSON: ${words(gitScan.err || gitScan.out).slice(0, 160)}`);
else {
  if (git.verdict !== "NO_VAULT_VALUE_IN_GIT") problems.push(`a current vault value exists in the guide-sources object store (hits=${git.keysWithHits})`);
  if (git.keysScanned < 6) problems.push(`only ${git.keysScanned} vault values were scanned (expected all 6)`);
}

// ---------------------------------------------------------------- verdict
const p = kRetired?.fingerprint8 ?? "?";
const c = kCurrent?.fingerprint8 ?? "?";
const reason = problems.length
  ? problems.join("; ")
  : `${KEY} rotated on funaging-media-os-api: retired ${p} now 401, current ${c} accepted as role automation (403), rotation deployment ${out.state?.deployment} (the alias has since moved to a newer verified deployment that still refuses the retired value), Deploy-Lock record verified with rollback ${out.state?.previousDeployment}; retired value was live before rotation (verified bootstrap record); ${git.keysScanned} vault values scanned across ${git.objects} guide-sources objects, 0 hits`;

done("C11", problems.length === 0, reason, out);
