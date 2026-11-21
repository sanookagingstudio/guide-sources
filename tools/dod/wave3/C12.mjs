// C12 - C-BRIDGE: the bridge environment for Hub / TFI / MediaOS is real and live.
//
// The item asked (MASTER_QUEUE C-BRIDGE): "Bridge env for Hub/TFI/MediaOS (generated locally, never printed)
// so TFI U1/U2 and Hub /api/tfi/brief stop 503".
//
// This check drives the REAL systems this round:
//   1. tools/c-bridge-probe.ps1 - vault presence (fingerprint8 only), `vercel env ls` NAMES on both production
//      projects, the live Hub route (anonymous 401 vs the vault bearer forwarded to LPHHW), the REAL TFI MediaOS
//      adapter imported from the TFI source and run against the live MediaOS API, and a live MediaOS route with
//      the same token.
//   2. The live Hub deployment must be the one a verified Deploy-Lock change produced (rollback target recorded
//      first, different from the live deployment).
// Nothing is printed that is a credential: the probe refuses to emit a 64-hex value and this check scans for one.
import { readdirSync, readFileSync } from "node:fs";
import { run, done } from "../lib/harness.mjs";
import { P, words } from "../lib/wave3-c.mjs";

const out = {};
const probePath = `${P.track}\\tools\\c-bridge-probe.ps1`;
const res = await run("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", probePath], { timeoutMs: 600000 });
out.probeExit = res.code;
const raw = res.out.slice(res.out.indexOf("{"));
let probe = null;
try { probe = JSON.parse(raw); } catch { /* non-json */ }
out.probe = probe;
if (!probe) out.probeTail = words(res.err || res.out);

const hubHead = (await run("git", ["-C", P.hub, "rev-parse", "HEAD"], { timeoutMs: 60000 })).out.trim();
out.hubHead = hubHead;

// The Deploy-Lock record that produced the live deployment.
const dir = "D:\\FUNAGING_TEMP\\tracks\\deploy_records";
let record = null;
try {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && /C-BRIDGE/i.test(f));
  const rows = files
    .map((f) => { try { return { f, j: JSON.parse(readFileSync(`${dir}\\${f}`, "utf8")) }; } catch { return null; } })
    // The record must be the HUB one: the workDir pins the repo (a C-BRIDGE-2 record for MediaOS also matches the
    // name pattern, and "newest wins" would then pick the wrong repository's change).
    .filter((r) => r && r.j.state === "verified" && /C-BRIDGE(?!-2)/i.test(String(r.j.action)) && String(r.j.workDir || "").toLowerCase() === P.hub.toLowerCase());
  rows.sort((a, b) => String(a.j.finishedAt).localeCompare(String(b.j.finishedAt)));
  record = rows.length ? { file: rows[rows.length - 1].f, ...rows[rows.length - 1].j } : null;
} catch { record = null; }
out.record = record ? { file: record.file, state: record.state, rollbackTarget: record.rollbackTarget, verifyTail: words(String(record.verify).slice(-200)) } : null;

const secretHits = (text) => /\b[0-9a-f]{64}\b/i.test(String(text));
out.leaked64HexInOutput = secretHits(res.out) || secretHits(res.err) || (probe ? secretHits(JSON.stringify(probe)) : false);

const problems = [];
if (res.code !== 0) problems.push(`probe exit ${res.code}`);
if (!probe) problems.push(`probe output is not JSON: ${words(res.err || res.out).slice(0, 200)}`);
else {
  const v = probe.vault || {};
  for (const n of ["LPHHW_SERVICE_TOKEN", "MEDIA_OS_SERVICE_TOKEN", "HUB_INGEST_TOKEN"]) {
    if (!v[n]?.present) problems.push(`${n} missing from the vault`);
    else if (!/^[0-9a-f]{8}$/.test(String(v[n].fingerprint8))) problems.push(`${n} has no fingerprint8`);
  }
  const fps = ["LPHHW_SERVICE_TOKEN", "MEDIA_OS_SERVICE_TOKEN", "HUB_INGEST_TOKEN"].map((n) => v[n]?.fingerprint8);
  if (new Set(fps).size !== 3) problems.push("bridge tokens are not three distinct values (two principals stay two principals)");

  const h = probe.hubEnv || {};
  for (const n of ["LPHHW_BASE_URL", "LPHHW_SERVICE_TOKEN", "HUB_INGEST_TOKEN"]) if (!h[n]) problems.push(`Hub production env lacks ${n}`);
  const t = probe.tfiEnv || {};
  for (const n of ["MEDIAOS_BASE_URL", "MEDIA_OS_SERVICE_TOKEN"]) if (!t[n]) problems.push(`TFI production env lacks ${n}`);

  const s = probe.hubSmoke;
  if (probe.hubSmokeExit !== 0 || !s) problems.push(`Hub live smoke exit ${probe.hubSmokeExit}`);
  else {
    if ((s.problems || []).length) problems.push(`Hub smoke problems: ${s.problems.join("; ")}`);
    if (s.health !== 200) problems.push(`Hub /health ${s.health}`);
    if (s.anonymous?.status !== 401 || s.anonymous?.code !== "UNAUTHORIZED") problems.push(`Hub anonymous brief ${JSON.stringify(s.anonymous)}`);
    const post = s.authorizedPost || {};
    if (post.status === 503) problems.push("Hub authorized brief still answers 503");
    else if (post.code === "UNAUTHORIZED") problems.push("Hub did not accept the vault HUB_INGEST_TOKEN");
    else if (!post.code && !(post.status >= 200 && post.status < 300)) problems.push(`Hub authorized brief returned no upstream code and no 2xx (status ${post.status})`);
    // A 2xx is now the healthy end state (LPHHW accepts the certified brief); the proof of the LPHHW hop is the
    // readback through the same route. An upstream error code is still accepted as forwarding proof (older state).
    if (post.status >= 200 && post.status < 300 && s.authorizedReadback?.status !== 200) {
      problems.push(`Hub authorized brief was accepted (${post.status}) but the LPHHW readback is ${JSON.stringify(s.authorizedReadback)}`);
    }
    const liveCommit = String(s.version?.commit || "");
    const anc = liveCommit ? await run("git", ["-C", P.hub, "merge-base", "--is-ancestor", liveCommit, "HEAD"], { timeoutMs: 60000 }) : { code: 1 };
    if (anc.code !== 0) problems.push(`live Hub commit '${liveCommit}' is not contained in repo HEAD '${hubHead}'`);
    if (s.version?.commitSource !== "env") problems.push(`live Hub commit_source '${s.version?.commitSource}'`);
    if (!s.version?.deploymentId?.startsWith("dpl_")) problems.push("live Hub /version has no deployment id");
  }

  // The live deployment must be the one a verified, rollback-first Deploy-Lock change produced.
  if (!record) problems.push("no verified Deploy-Lock record for C-BRIDGE");
  else {
    if (!String(record.rollbackTarget || "").startsWith("dpl_")) problems.push("C-BRIDGE record has no dpl_ rollback target");
    if (record.rollbackTarget === s?.version?.deploymentId) problems.push("rollback target equals the live deployment (nothing to roll back to)");
    const liveHost = String(s?.version?.deploymentUrl || "");
    if (!liveHost || !String(record.change || "").includes(liveHost)) problems.push(`the verified record does not name the live deployment ${liveHost}`);
    if (!/SMOKE_PASS/.test(String(record.verify || ""))) problems.push("the verified record carries no SMOKE_PASS");
  }

  const a = probe.tfiAdapter;
  if (!a || a.parseError) problems.push("TFI MediaOS adapter probe did not return JSON");
  else {
    if (a.configured !== true) problems.push("TFI MediaOS adapter is still not configured");
    if (a.notConfigured !== false) problems.push("TFI MediaOS adapter still reports MEDIAOS_NOT_CONFIGURED");
    const reasons = [a.reasonClass?.health, a.reasonClass?.negotiate].map(String);
    if (reasons.some((r) => r === "MEDIAOS_NOT_CONFIGURED")) problems.push("TFI adapter reason is MEDIAOS_NOT_CONFIGURED");
    if (a.health?.state !== "ok" && !/^MEDIAOS_HTTP_\d+$/.test(String(a.health?.reason))) problems.push(`TFI adapter health returned '${a.health?.reason}' (not a MediaOS answer)`);
  }

  // MediaOS accepts the same token on a real route (the S13 U1/U2 destination surface).
  if (probe.mediaos?.towerStatus !== 200) problems.push(`MediaOS /intelligence/tower with the vault token -> ${probe.mediaos?.towerStatus}`);
  if (probe.mediaos?.healthStatus !== 200) problems.push(`MediaOS /health -> ${probe.mediaos?.healthStatus}`);
}
if (out.leaked64HexInOutput) problems.push("a 64-hex value appeared in the output (value leak)");

const liveCode = probe?.hubSmoke?.authorizedPost?.code
  ?? (probe?.hubSmoke?.authorizedPost?.status ? `accepted ${probe.hubSmoke.authorizedPost.status} by LPHHW` : "?");
const tfiReason = probe?.tfiAdapter?.reasonClass?.negotiate ?? "?";
done(
  "C12",
  problems.length === 0,
  problems.length
    ? problems.join("; ")
    : `bridge env live: Hub LPHHW pair + vault ingest token on ${probe.hubSmoke.version.deploymentId} (anonymous 401, authorized forwards to LPHHW -> ${liveCode}, no 503); TFI MediaOS pair set, real adapter configured -> ${tfiReason} (no NOT_CONFIGURED); MediaOS token accepted 200; Deploy-Lock ${probe ? "verified" : "?"} with rollback ${out.record?.rollbackTarget}; no 64-hex value in output`,
  out,
);
