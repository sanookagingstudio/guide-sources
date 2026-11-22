// G3-GUIDE-TFI - MASTER_QUEUE row (Track C, G3), Owner rule 2026-11-21:
//   "Cross-system E2E on PRODUCTION: guide-sources creates a draft guide -> TFI handoff sees/uses it;
//    cleanup of the QA-created draft only. No concept-only/POST-LAUNCH exit. The check must FAIL
//    while the path is absent."
//
// PASS requires ALL of these, each proved against the REAL production systems in THIS run:
//   1. guide-sources production is live and self-describing: the alias resolves to a READY Production
//      deployment (vercel inspect), that deployment's recorded source commit is a real commit in the
//      repo, and the committed source at that commit carries the bridge store + the QA-only purge rule
//      (read from git, not from docs).
//   2. The health route answers 200 with contract `guide-source-draft@1.0.0` and store=postgres, and
//      an ANONYMOUS create is refused (401).
//   3. TFI production /version names a commit git proves is contained in TFI `master`, its provenance
//      is recorded (vercel-git or env-source-sha) with a deployment id, and the committed handler at
//      that commit really carries the /v1/bridge/guide-sources/draft routes + the QA- prefix rule.
//      An anonymous TFI draft read is refused (401).
//   4. ONE QA draft is created IN guide-sources production, read back THROUGH TFI production (visible
//      /usable), and a delayed read (12 s later) still returns it (durable store, not function memory).
//   5. Cleanup of exactly that QA record: the record is exported to the QA ledger, purged through TFI
//      production (200), then guide-sources and TFI both answer 404 and a second purge is 404. The QA
//      draft count in guide-sources returns to the pre-run baseline.
//
// No token is ever printed: values come from the DPAPI vault and only a fingerprint8 reaches evidence.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const H = await import(pathToFileURL("D:\\FUNAGING_TEMP\\tracks\\golive\\lib\\harness.mjs").href);
const { run, ps, done } = H;

const ID = "G3-GUIDE-TFI";
if (H.track !== "C") {
  done(ID, false, `refused: FUNAGING_TRACK is '${H.track}' but this check belongs to Track C`, { guard: "track" });
}

const P = {
  gs: "D:\\FUNAGING_WEB\\01_ACTIVE\\guide-sources__9CC897324B2F",
  tfi: "D:\\FunAging\\TourismIntelligence",
};
const URLS = {
  gs: "https://guide-sources.vercel.app",
  tfi: "https://tourism-intelligence-engine.vercel.app",
};
const SCOPE = "team_UkIW1iwLo9j1Shy7ArPdFXMI";
const QA_LEDGER = "D:\\FUNAGING_TEMP\\qa\\qa_rows.json";
const QA_DELETED = "D:\\FUNAGING_TEMP\\qa\\deleted";

const out = { steps: [] };
const problems = [];
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const step = (name, ok, detail) => {
  out.steps.push({ name, ok, detail });
  if (!ok) problems.push(`${name}: ${detail}`);
  return ok;
};

// ---- tokens from the vault (never printed) -------------------------------------------------------
const tokenScript = `
Import-Module 'D:\\FUNAGING_TEMP\\eco_owner\\tools\\FunagingSecrets.psm1' -Force
function Fp8([string]$v) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $h = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($v)) } finally { $sha.Dispose() }
  return (($h[0..3] | ForEach-Object { $_.ToString('x2') }) -join '')
}
$gs = Get-FunagingSecret -Key GUIDE_SOURCES_SERVICE_TOKEN
$tfi = Get-FunagingSecret -Key TFI_BRIDGE_TOKEN
@{ gs = $gs; tfi = $tfi; gsFp8 = (Fp8 $gs); tfiFp8 = (Fp8 $tfi) } | ConvertTo-Json -Compress
`;
const tok = await ps(tokenScript, { timeoutMs: 60000 });
if (!tok.json?.gs || !tok.json?.tfi) {
  done(ID, false, "could not read the guide-sources service token / TFI bridge token from the vault", { steps: out.steps, stderr: norm(tok.err).slice(0, 300) });
}
const GS_TOKEN = tok.json.gs;
const TFI_TOKEN = tok.json.tfi;
out.tokens = { guideSources: `fp8:${tok.json.gsFp8}`, tfi: `fp8:${tok.json.tfiFp8}` };

async function call(url, init = {}, headers = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      ...init,
      headers: { "user-agent": "funaging-g3-check", ...(init.headers || {}), ...headers },
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text: text.slice(0, 1500), ms: Date.now() - t0 };
  } catch (error) {
    return { status: 0, json: null, text: "", error: String(error), ms: Date.now() - t0 };
  }
}

function parseJsonLoose(text) {
  const t = String(text || "");
  const first = Math.min(...["{", "["].map((c) => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  const last = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (!Number.isFinite(first) || last <= first) return null;
  try { return JSON.parse(t.slice(first, last + 1)); } catch { return null; }
}

const vercel = async (args, timeoutMs = 120000) =>
  run("cmd.exe", ["/d", "/s", "/c", `vercel ${args} --scope ${SCOPE}`], { timeoutMs, cwd: P.gs });

// ---- 1. guide-sources production deployment identity + deployed source ---------------------------
const gsInspect = await vercel(`inspect guide-sources.vercel.app --json`);
const gsInspectText = `${gsInspect.out}\n${gsInspect.err}`;
const gsLive = parseJsonLoose(gsInspect.out);
out.guideSources = {
  inspectExit: gsInspect.code,
  deploymentId: gsLive?.id ?? null,
  deploymentUrl: gsLive?.url ?? null,
  readyState: gsLive?.readyState ?? null,
  target: gsLive?.target ?? null,
  inspectSnippet: norm(gsInspectText).slice(0, 300),
};
step("guide-sources alias resolves to a READY production deployment",
  Boolean(gsLive?.id) && /^dpl_/.test(String(gsLive?.id)) && /READY/i.test(String(gsLive?.readyState)) && String(gsLive?.target).toLowerCase() === "production",
  `id=${gsLive?.id ?? null} state=${gsLive?.readyState ?? null} target=${gsLive?.target ?? null}`);

const gsLs = await vercel("ls guide-sources --json");
const gsList = parseJsonLoose(gsLs.out);
const gsEntries = Array.isArray(gsList) ? gsList : Array.isArray(gsList?.deployments) ? gsList.deployments : [];
const gsEntry = gsEntries.find((entry) => entry?.url === String(gsLive?.deploymentUrl || gsLive?.url || "").replace(/^https?:\/\//, "")) || gsEntries.find((entry) => entry?.id === gsLive?.id) || null;
const gsSourceCommit = gsEntry?.meta?.sourceCommit || gsEntry?.meta?.gitCommitSha || "";
out.guideSources.sourceCommit = gsSourceCommit || null;
const gsShow = async (p) => (await run("git", ["-C", P.gs, "show", `${gsSourceCommit}:${p}`], { timeoutMs: 30000 })).out;
let gsSrc = { store: "", purge: "", create: "", health: "" };
if (/^[0-9a-f]{7,40}$/.test(gsSourceCommit)) {
  gsSrc = {
    store: await gsShow("src/lib/bridge-store.ts"),
    purge: await gsShow("src/app/api/bridge/drafts/[id]/purge/route.ts"),
    create: await gsShow("src/app/api/bridge/drafts/route.ts"),
    health: await gsShow("src/app/api/bridge/health/route.ts"),
  };
}
out.guideSourcesSource = {
  sourceCommit: gsSourceCommit || null,
  storeHasDurableSchema: gsSrc.store.includes("CREATE SCHEMA IF NOT EXISTS guide_sources_bridge") && gsSrc.store.includes("guide_drafts"),
  purgeDeletesOnlyQaRow: /DELETE FROM guide_sources_bridge\.guide_drafts WHERE draft_id = \$\{draftId\} AND qa = true/.test(gsSrc.store),
  purgeRequiresQaFlagAndPrefix: gsSrc.purge.includes("draft.qa !== true") && gsSrc.purge.includes("startsWith(QA_PREFIX)"),
  createStoresDraft: gsSrc.create.includes("putDraft("),
  healthNamesContract: gsSrc.health.includes("BRIDGE_CONTRACT") && gsSrc.store.includes('"guide-source-draft@1.0.0"'),
};
step("deployed guide-sources source carries the durable store + QA-only purge",
  Boolean(out.guideSourcesSource.storeHasDurableSchema) && out.guideSourcesSource.purgeDeletesOnlyQaRow &&
  out.guideSourcesSource.purgeRequiresQaFlagAndPrefix && out.guideSourcesSource.createStoresDraft &&
  out.guideSourcesSource.healthNamesContract,
  JSON.stringify(out.guideSourcesSource));

const gsHealth = await call(`${URLS.gs}/api/bridge/health`);
out.guideSourcesHealth = { status: gsHealth.status, ok: gsHealth.json?.ok ?? null, contract: gsHealth.json?.contract ?? null, store: gsHealth.json?.store ?? null };
step("guide-sources bridge health is live with a durable store",
  gsHealth.status === 200 && gsHealth.json?.ok === true && gsHealth.json?.contract === "guide-source-draft@1.0.0" && gsHealth.json?.store === "postgres",
  `status=${gsHealth.status} contract=${gsHealth.json?.contract ?? null} store=${gsHealth.json?.store ?? null}`);

const anonGs = await call(`${URLS.gs}/api/bridge/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "anon" }) });
out.anonymousGuideSources = { status: anonGs.status, code: anonGs.json?.code ?? null };
step("anonymous guide-sources draft create is refused", anonGs.status === 401, `status=${anonGs.status} code=${anonGs.json?.code ?? null}`);

// ---- 2. TFI production provenance + deployed source ----------------------------------------------
const tfiV = await call(`${URLS.tfi}/version`);
out.tfi = { status: tfiV.status, version: tfiV.json };
if (tfiV.status === 200 && tfiV.json?.commit) {
  const anc = await run("git", ["-C", P.tfi, "merge-base", "--is-ancestor", String(tfiV.json.commit), "master"], { timeoutMs: 30000 });
  step("tfi live commit is contained in master", anc.code === 0, `commit=${String(tfiV.json.commit).slice(0, 12)} exit=${anc.code}`);
  step("tfi live provenance is recorded", ["vercel-git", "env-source-sha"].includes(String(tfiV.json.commitSource)) && Boolean(tfiV.json.branch) && /^dpl_/.test(String(tfiV.json.deploymentId)),
    `${tfiV.json.commitSource}/${tfiV.json.branch}/${tfiV.json.deploymentId}`);
} else {
  step("tfi /version is live", false, `status=${tfiV.status}`);
}

const tfiCommit = tfiV.json?.commit || "HEAD";
const tfiShow = async (p) => (await run("git", ["-C", P.tfi, "show", `${tfiCommit}:${p}`], { timeoutMs: 30000 })).out;
const tfiSrc = {
  handler: await tfiShow("services/research-api/src/vercel-handler.ts"),
  server: await tfiShow("services/research-api/src/server.ts"),
  draft: await tfiShow("services/research-api/src/guide-sources-draft.ts"),
  adapter: await tfiShow("services/research-api/src/adapters/guide-sources.ts"),
};
out.tfiSource = {
  handlerHasCreate: tfiSrc.handler.includes('"/v1/bridge/guide-sources/draft"'),
  handlerHasRead: tfiSrc.handler.includes("/^\\/v1\\/bridge\\/guide-sources\\/draft\\/([^/]+)$/"),
  handlerHasPurge: tfiSrc.handler.includes("/^\\/v1\\/bridge\\/guide-sources\\/draft\\/([^/]+)\\/purge$/"),
  serverHasRoutes: tfiSrc.server.includes('"/v1/bridge/guide-sources/draft"') && tfiSrc.server.includes('"/v1/bridge/guide-sources/draft/:id/purge"'),
  adapterPostsDrafts: tfiSrc.adapter.includes('"/api/bridge/drafts"'),
  routeRequiresQaPrefix: tfiSrc.draft.includes("/^QA-/"),
};
step("deployed TFI source carries the guide-sources draft routes",
  out.tfiSource.handlerHasCreate && out.tfiSource.handlerHasRead && out.tfiSource.handlerHasPurge &&
  out.tfiSource.serverHasRoutes && out.tfiSource.adapterPostsDrafts && out.tfiSource.routeRequiresQaPrefix,
  JSON.stringify(out.tfiSource));

const anonTfi = await call(`${URLS.tfi}/v1/bridge/guide-sources/draft/QA-ANON`, { headers: {} });
out.anonymousTfi = { status: anonTfi.status };
step("anonymous TFI draft read is refused", anonTfi.status === 401, `status=${anonTfi.status}`);

// ---- 3. baseline QA count, then the real E2E -----------------------------------------------------
const authGs = { "x-guide-sources-service-token": GS_TOKEN };
const authTfi = { authorization: `Bearer ${TFI_TOKEN}` };

const baseline = await call(`${URLS.gs}/api/bridge/drafts?qa=1`, { headers: authGs });
out.baseline = { status: baseline.status, count: baseline.json?.count ?? null };
step("guide-sources QA draft baseline is readable", baseline.status === 200 && typeof baseline.json?.count === "number", `status=${baseline.status} count=${baseline.json?.count ?? null}`);
const baselineCount = Number(baseline.json?.count ?? 0);

const qaId = `QA-G3-GUIDE-TFI-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const draftBody = {
  contract_version: "guide-source-draft@1.0.0",
  draft_id: qaId,
  title: "Guide draft: G3-GUIDE-TFI production proof",
  summary: "Created in guide-sources production by the Track C executable DoD check; purged in the same run.",
  locale: "th",
  qa: true,
  requested_by: "track-c-g3-check",
  claims: [{ claim: "The draft is stored durably in guide-sources and readable through TFI", credibility: "check", confidence: 1 }],
  sources: [{ url: `${URLS.gs}/api/bridge/health`, license: "internal" }],
};

// QA ledger: recorded AT creation (Owner rule for production QA writes).
function ledgerAppend(entry) {
  try {
    const doc = JSON.parse(readFileSync(QA_LEDGER, "utf8"));
    doc.rows = Array.isArray(doc.rows) ? doc.rows : [];
    doc.rows.push(entry);
    writeFileSync(QA_LEDGER, JSON.stringify(doc, null, 2));
    return true;
  } catch { return false; }
}
function ledgerClose(ref, patch) {
  try {
    const doc = JSON.parse(readFileSync(QA_LEDGER, "utf8"));
    const row = (doc.rows || []).find((r) => r.ref === ref);
    if (row) Object.assign(row, patch);
    writeFileSync(QA_LEDGER, JSON.stringify(doc, null, 2));
    return true;
  } catch { return false; }
}

const created = await call(`${URLS.gs}/api/bridge/drafts`, {
  method: "POST",
  headers: { "content-type": "application/json", ...authGs },
  body: JSON.stringify(draftBody),
});
out.create = { status: created.status, draftId: created.json?.draft_id ?? null, store: created.json?.store ?? null, qa: created.json?.qa ?? null, code: created.json?.code ?? null };
const createdOk = created.status === 201 && created.json?.draft_id === qaId && created.json?.store === "postgres";
step("guide-sources production created the QA draft durably", createdOk, `status=${created.status} store=${created.json?.store ?? null} code=${created.json?.code ?? null}`);
if (createdOk) {
  out.qaRow = { ref: qaId, table: "guide_sources_bridge.guide_drafts", environment: "production (Club PG via guide-sources bridge)", purpose: "G3-GUIDE-TFI cross-system E2E (create -> visible in TFI -> purge)", created_at_utc: new Date().toISOString(), created_by: "Track C executable check G3-GUIDE-TFI", prefix_ok: true, state: "qa draft stored (postgres)", cleanup: "pending" };
  out.qaRowRecorded = ledgerAppend(out.qaRow);
  step("QA row recorded in the QA ledger at creation", out.qaRowRecorded === true, `ledger=${QA_LEDGER}`);
}

// TFI production sees/uses it: the readback is served by TFI, which fetches guide-sources production.
const tfiRead1 = await call(`${URLS.tfi}/v1/bridge/guide-sources/draft/${encodeURIComponent(qaId)}`, { headers: authTfi });
out.tfiRead1 = { status: tfiRead1.status, id: tfiRead1.json?.data?.draft_id ?? null, title: tfiRead1.json?.data?.title ?? null, qa: tfiRead1.json?.data?.qa ?? null, code: tfiRead1.json?.code ?? null };
step("TFI production sees the draft from guide-sources",
  tfiRead1.status === 200 && tfiRead1.json?.data?.draft_id === qaId && tfiRead1.json?.data?.qa === true,
  `status=${tfiRead1.status} code=${tfiRead1.json?.code ?? null}`);

// A second read after a delay: a function-memory store cannot answer this after an instance boundary.
await new Promise((resolve) => setTimeout(resolve, 12000));
const gsRead2 = await call(`${URLS.gs}/api/bridge/drafts/${encodeURIComponent(qaId)}`, { headers: authGs });
out.guideSourcesRead2 = { status: gsRead2.status, at: new Date().toISOString(), id: gsRead2.json?.draft?.draft_id ?? null };
step("the draft survives a delayed read in guide-sources (durable store)", gsRead2.status === 200 && gsRead2.json?.draft?.draft_id === qaId, `status=${gsRead2.status}`);

// Export before delete (QA ledger policy), then purge through TFI production.
let exportPath = null;
try {
  mkdirSync(QA_DELETED, { recursive: true });
  exportPath = path.join(QA_DELETED, `${qaId}.json`);
  writeFileSync(exportPath, JSON.stringify({ ref: qaId, exported_at_utc: new Date().toISOString(), source: `${URLS.gs}/api/bridge/drafts/${qaId}`, record: gsRead2.json?.draft ?? null }, null, 2));
} catch { exportPath = null; }
out.exportPath = exportPath;

const purged = await call(`${URLS.tfi}/v1/bridge/guide-sources/draft/${encodeURIComponent(qaId)}/purge`, { method: "POST", headers: { ...authTfi, "content-type": "application/json" }, body: "{}" });
out.purge = { status: purged.status, deleted: purged.json?.data?.deleted ?? null, store: purged.json?.data?.store ?? null, code: purged.json?.code ?? null };
step("TFI purged the QA draft in guide-sources", purged.status === 200 && purged.json?.data?.deleted === true, `status=${purged.status} code=${purged.json?.code ?? null}`);

const gsGone = await call(`${URLS.gs}/api/bridge/drafts/${encodeURIComponent(qaId)}`, { headers: authGs });
out.afterGuideSources = { status: gsGone.status, code: gsGone.json?.code ?? null };
step("guide-sources answers 404 after the purge", gsGone.status === 404 && gsGone.json?.code === "DRAFT_NOT_FOUND", `status=${gsGone.status} code=${gsGone.json?.code ?? null}`);

const tfiGone = await call(`${URLS.tfi}/v1/bridge/guide-sources/draft/${encodeURIComponent(qaId)}`, { headers: authTfi });
out.afterTfi = { status: tfiGone.status, code: tfiGone.json?.code ?? null };
step("TFI readback answers 404 after the purge", tfiGone.status === 404, `status=${tfiGone.status} code=${tfiGone.json?.code ?? null}`);

const purgeAgain = await call(`${URLS.tfi}/v1/bridge/guide-sources/draft/${encodeURIComponent(qaId)}/purge`, { method: "POST", headers: { ...authTfi, "content-type": "application/json" }, body: "{}" });
out.purgeAgain = { status: purgeAgain.status, code: purgeAgain.json?.code ?? null };
step("a second purge of the same id is 404", purgeAgain.status === 404, `status=${purgeAgain.status}`);

const after = await call(`${URLS.gs}/api/bridge/drafts?qa=1`, { headers: authGs });
out.afterBaseline = { status: after.status, count: after.json?.count ?? null, baseline: baselineCount };
step("the QA draft count is back to the pre-run baseline", after.status === 200 && Number(after.json?.count ?? -1) === baselineCount, `count=${after.json?.count ?? null} baseline=${baselineCount}`);

if (out.qaRow && exportPath) {
  out.qaRowClosed = ledgerClose(qaId, { cleanup: "cleaned", cleaned_at_utc: new Date().toISOString(), export_path: exportPath });
}

// ---- 4. honesty + secret hygiene -----------------------------------------------------------------
out.qaOnlyLimit = "production refusal of a NON-QA purge is proved by the repo tests (tests/integration/guide-sources-draft.test.ts, 403 QA_ONLY) and the deployed source assertion, not by leaving a permanent non-QA row behind";
const serialized = JSON.stringify({ steps: out.steps });
out.secretValuesPrinted = [GS_TOKEN, TFI_TOKEN].filter((value) => value && serialized.includes(value)).length;
step("no secret VALUE appears in the output", out.secretValuesPrinted === 0, `hits=${out.secretValuesPrinted}`);

const ok = problems.length === 0;
done(ID, ok,
  ok
    ? `guide-sources ${out.guideSources.deploymentId} created QA draft ${qaId} (store=postgres), TFI ${String(tfiCommit).slice(0, 12)} saw it and a delayed read survived, purged through TFI -> 404 in guide-sources + TFI, QA count ${baselineCount}->${baselineCount}`
    : `failing legs: ${problems.join(" | ")}`,
  out);
