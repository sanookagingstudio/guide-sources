// C16 - MASTER_QUEUE C-BRIDGE-2 (Track C): bridge delivery END TO END.
//
// The item: "LPHHW production needs the `x-tfi-service-token` POST/GET `/api/u4/briefs` intake (request TO B
// 2026-11-21) and MediaOS production needs the `/v1/bridge/{health,contracts,negotiate,asset-handoff}` contract
// routes the TFI adapter calls, so U1/U2 and the Hub broker reach a real 201/200 readback".
//
// This check drives the real systems:
//   1. `tools/mediaos-bridge-probe.ps1` - the LIVE MediaOS `/v1/bridge/*` surface authenticated with the vault
//      MEDIA_OS_SERVICE_TOKEN (health, 7 frozen contracts, negotiate, asset-handoff semantics, no 64-hex leak).
//   2. `tools/c-bridge-probe.ps1` - the LIVE Hub broker forwards the vault ingest token to LPHHW, and the REAL
//      TFI MediaOS adapter (imported from TFI source) talks to the live MediaOS API.
//   3. A verified Deploy-Lock record that produced the live MediaOS deployment (rollback recorded first).
// It is PASS only when the delivery actually lands: MediaOS answers the contract surface AND the Hub broker gets a
// real 200/201 readback from LPHHW. A 401 from the upstream LPHHW is a FAIL with that exact reason - never a PASS.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { run, done } from "../lib/harness.mjs";
import { P, URLS, words } from "../lib/wave3-c.mjs";

const out = { mediaos: null, bridge: null, record: null };
const problems = [];
const leaked = (text) => /\b[0-9a-f]{64}\b/i.test(String(text));

// ---- 1. MediaOS /v1/bridge surface (live, vault token, values never printed) ----
const mProbe = `${P.track}\\tools\\mediaos-bridge-probe.ps1`;
const m = await run("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", mProbe], { timeoutMs: 300000 });
out.mediaos = {
  exit: m.code,
  passLine: words((m.out || "").split(/\r?\n/).find((l) => /MEDIAOS_BRIDGE_PROBE/.test(l)) || ""),
  fails: words((m.out || "").split(/\r?\n/).filter((l) => /^FAIL /.test(l.trim())).join(" | ")),
};
if (m.code !== 0) problems.push(`MediaOS /v1/bridge probe exit ${m.code}: ${out.mediaos.fails || words(m.err || m.out)}`);

// ---- 2. Hub -> LPHHW delivery + the real TFI adapter (live) ----
const bProbe = `${P.track}\\tools\\c-bridge-probe.ps1`;
const b = await run("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", bProbe], { timeoutMs: 600000 });
let probe = null;
try { probe = JSON.parse(b.out.slice(b.out.indexOf("{"))); } catch { probe = null; }
if (!probe) problems.push(`c-bridge-probe did not return JSON (exit ${b.code}): ${words(b.err || b.out)}`);
else {
  const post = probe.hubSmoke?.authorizedPost || {};
  out.bridge = {
    exit: b.code,
    hubAuthorizedPost: { status: post.status ?? null, code: post.code ?? null },
    hubVersion: probe.hubSmoke?.version?.deploymentId ?? null,
    tfiHealth: probe.tfiAdapter?.health ?? null,
    tfiNegotiate: probe.tfiAdapter?.negotiate ?? null,
    tfiReasonClass: probe.tfiAdapter?.reasonClass ?? null,
    mediaosTower: probe.mediaos?.towerStatus ?? null,
  };
  const delivered = [200, 201].includes(Number(post.status));
  if (!delivered) {
    problems.push(
      `the Hub broker's authorized brief is not delivered: LPHHW answered ${post.status ?? "?"} ${post.code ?? ""}`.trim()
    );
  }
  const tfiHealth = probe.tfiAdapter?.health || {};
  if (tfiHealth.state !== "ok" && !/^MEDIAOS_HTTP_\d+$/.test(String(tfiHealth.reason || ""))) {
    problems.push(`TFI adapter health is not a MediaOS answer: ${tfiHealth.state ?? "?"} ${tfiHealth.reason ?? ""}`.trim());
  }
  const negotiate = probe.tfiAdapter?.negotiate || {};
  if (String(negotiate.reason || "").startsWith("MEDIAOS_NOT_CONFIGURED")) problems.push("TFI adapter is still MEDIAOS_NOT_CONFIGURED");
  if (Number(probe.mediaos?.towerStatus) !== 200) problems.push(`MediaOS /intelligence/tower -> ${probe.mediaos?.towerStatus}`);
}

// ---- 3. The live MediaOS deployment came from a verified, rollback-first Deploy-Lock change ----
const dir = "D:\\FUNAGING_TEMP\\tracks\\deploy_records";
let record = null;
try {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || !name.includes("_C_")) continue;
    let j;
    try { j = JSON.parse(readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
    if (j.state !== "verified") continue;
    if (!/C-BRIDGE-2/.test(String(j.action))) continue;
    if (path.resolve(String(j.workDir || "")).toLowerCase() !== P.mediaos.toLowerCase()) continue;
    if (record && String(j.finishedAt) < String(record.finishedAt)) continue;
    record = { file: name, ...j };
  }
} catch { record = null; }
out.record = record ? { file: record.file, state: record.state, rollbackTarget: record.rollbackTarget, verify: words(String(record.verify || "").split(/\r?\n/).filter((l) => /MEDIAOS_BRIDGE_PROBE/.test(l)).join(" ")) } : null;
if (!record) problems.push("no verified C-BRIDGE-2 Deploy-Lock record for the MediaOS repo");
else {
  if (!/^dpl_/.test(String(record.rollbackTarget || ""))) problems.push("C-BRIDGE-2 record has no dpl_ rollback target");
  if (!/MEDIAOS_BRIDGE_PROBE \d+\/\d+ PASS/.test(String(record.verify || ""))) {
    problems.push("the C-BRIDGE-2 record carries no passing live bridge probe");
  }
}

// The live MediaOS alias must be a READY production deployment that is NOT the recorded rollback target.
const inspect = await run("cmd.exe", ["/d", "/s", "/c", "vercel inspect funaging-media-os-api.vercel.app --json"], {
  cwd: P.mediaos,
  timeoutMs: 180000,
});
let live = null;
try { live = JSON.parse(inspect.out.slice(inspect.out.indexOf("{"))); } catch { live = null; }
out.live = live ? { id: live.id, state: live.readyState, target: live.target, url: live.url } : null;
if (!live) problems.push(`live MediaOS deployment not readable (exit ${inspect.code})`);
else {
  if (live.readyState !== "READY" || live.target !== "production") problems.push(`live MediaOS ${live.readyState}/${live.target}`);
  if (record && record.rollbackTarget === live.id) problems.push("the live deployment is still the rollback target (nothing was delivered)");
}

if (leaked(b.out) || leaked(b.err) || leaked(m.out) || leaked(m.err)) problems.push("a 64-hex value appeared in the output");

const liveCode = out.bridge?.hubAuthorizedPost?.code ?? "?";
done(
  "C16",
  problems.length === 0,
  problems.length
    ? problems.join("; ")
    : `bridge delivery end to end: MediaOS /v1/bridge contract surface live (${out.mediaos?.passLine}), Hub broker authorized brief answered ${out.bridge?.hubAuthorizedPost?.status} by LPHHW, TFI adapter against live MediaOS ${JSON.stringify(out.bridge?.tfiHealth)}; Deploy-Lock verified with rollback ${out.record?.rollbackTarget}`,
  {
    ...out,
    liveUrls: { mediaosApi: URLS.mediaosApi, hub: URLS.hub },
    note: problems.length ? "C-BRIDGE-2 is only PARTLY delivered (see problems): the missing half is named there." : "delivered",
  }
);
