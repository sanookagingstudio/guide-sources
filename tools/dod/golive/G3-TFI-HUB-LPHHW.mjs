// G3-TFI-HUB-LPHHW - MASTER_QUEUE row (Track C, G3), Owner rule 2026-11-21:
//   "Cross-system E2E on PRODUCTION: TFI creates a brief -> Hub broker -> LPHHW /api/u4/briefs persists it
//    -> GET readback in LPHHW; cleanup of the QA brief only. No concept-only/POST-LAUNCH exit."
//
// PASS requires ALL of these, each proved against the REAL production systems in THIS run:
//   1. TFI production /version names a commit that git proves is contained in the TFI master branch.
//   2. TFI production exposes a brief-create route that delivers the certified `tfi.u4-game-brief.v1`
//      envelope to the Hub (source evidence in services/research-api where the deployed handler lives).
//   3. A TFI production bearer is available to this check from the DPAPI vault (never printed).
//   4. Hub /health + /version are live; an anonymous POST /api/tfi/brief is refused 401; an authorized
//      GET /api/tfi/brief with an unknown key is answered 404 NOT_FOUND *by LPHHW through the broker*.
//   5. LPHHW /version.json is live and its service-token intake answers 404 NOT_FOUND for an unknown key.
//   6. A QA cleanup path for `u4_briefs` EXISTS: a delete/purge route on the production server AND no
//      BEFORE DELETE trigger that refuses every row. Verified from the live route probe AND the live
//      database catalog (pg_trigger), not from documentation.
//   7. Only then: create ONE QA-prefixed brief through TFI production, read it back in LPHHW (via the Hub
//      and directly), export + delete exactly that QA brief, and prove the readback is 404 afterwards.
//
// If 6 is false the check REFUSES to create the brief (a row in an append-only table could never be
// cleaned up) and FAILS naming the exact missing prerequisite - it never weakens the DoD to "retained".
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const H = await import(pathToFileURL("D:\\FUNAGING_TEMP\\tracks\\golive\\lib\\harness.mjs").href);
const { run, done, httpGet } = H;
const { probeU4Catalog } = await import("./lib/u4-cleanup-probe.mjs");

// The golive harness defaults to Track B's evidence folder; this check is Track C's and must never write
// into another track's state.
if (H.track !== "C") {
  H.done("G3-TFI-HUB-LPHHW", false, `refused: FUNAGING_TRACK is '${H.track}' but this check belongs to Track C`, { guard: "track" });
}

const P = {
  gs: "D:\\FUNAGING_WEB\\01_ACTIVE\\guide-sources__9CC897324B2F",
  tfi: "D:\\FunAging\\TourismIntelligence",
  hub: "D:\\FUNAGING_WEB\\01_ACTIVE\\sanook-master-v2__8402E8309ACC\\funaging-omnichannel-engagement-hub",
  lphhw: "D:\\FUNAGING_LPHHW",
  track: "D:\\FUNAGING_TEMP\\tracks\\C",
};
const URLS = {
  tfi: "https://tourism-intelligence-engine.vercel.app",
  hub: "https://funaging-omnichannel-hub.vercel.app",
  lphhw: "https://lphhw.vercel.app",
};
// The TFI-side contract this row must provide (documented here because the check IS the contract).
const TFI_BRIEF_PATH = "/v1/bridge/u4-brief";
const PROBE = path.join(P.gs, "tools", "dod", "golive", "lib", "lphhw-u4-read-probe.ps1");
const ROUNDTRIP = path.join(P.gs, "tools", "dod", "golive", "lib", "tfi-brief-roundtrip.ps1");

const out = {};
const problems = [];
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

// ---- 1. TFI production provenance ---------------------------------------------------------------
const tfiV = await httpGet(`${URLS.tfi}/version`);
let tfiVersion = null;
try { tfiVersion = JSON.parse(tfiV.body); } catch { tfiVersion = null; }
const tfiHead = norm((await run("git", ["-C", P.tfi, "rev-parse", "HEAD"], { timeoutMs: 30000 })).out);
out.tfi = {
  status: tfiV.status,
  commit: tfiVersion?.commit ?? null,
  commitSource: tfiVersion?.commitSource ?? null,
  branch: tfiVersion?.branch ?? null,
  deploymentId: tfiVersion?.deploymentId ?? null,
  repoHead: tfiHead,
};
if (tfiV.status !== 200 || !tfiVersion?.commit) {
  problems.push(`TFI production /version is not readable (${tfiV.status})`);
} else {
  const anc = await run("git", ["-C", P.tfi, "merge-base", "--is-ancestor", String(tfiVersion.commit), "master"], { timeoutMs: 30000 });
  out.tfi.commitOnMaster = anc.code === 0;
  if (anc.code !== 0) problems.push(`TFI live commit ${String(tfiVersion.commit).slice(0, 12)} is not contained in master`);
  if (tfiVersion.commitSource !== "vercel-git" || tfiVersion.branch !== "master") {
    problems.push(`TFI live provenance is ${tfiVersion.commitSource}/${tfiVersion.branch}, not vercel-git/master`);
  }
}

// ---- 2. TFI production create route (source evidence where the deployed handler lives) -----------
const handlerFile = path.join(P.tfi, "services", "research-api", "src", "vercel-handler.ts");
const serverFile = path.join(P.tfi, "services", "research-api", "src", "server.ts");
const readText = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const routes = [handlerFile, serverFile].map(readText).join("\n");
const createRoute = {
  file: handlerFile,
  u4BriefRoute: new RegExp(`["'\`]${TFI_BRIEF_PATH.replace(/[/\\]/g, "\\$&")}["'\`]`).test(routes),
  hubClient: /api\/tfi\/brief|HUB_INGEST_TOKEN|u4-game-brief/i.test(routes),
  hubPathLiteral: TFI_BRIEF_PATH,
};
out.tfiCreate = createRoute;
if (!createRoute.u4BriefRoute) {
  problems.push(
    `TFI production has NO brief-create route: services/research-api/src/{vercel-handler,server}.ts never route ${TFI_BRIEF_PATH} (the deployed api/engine bundle is built from them)`,
  );
}
if (!createRoute.hubClient) {
  problems.push("TFI source has no Hub delivery client (no /api/tfi/brief call, no HUB_INGEST_TOKEN use)");
}

// ---- 3. TFI bearer availability (vault names + BOOL only) ---------------------------------------
const probeRun = await run("pwsh", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PROBE], {
  timeoutMs: 240000,
});
let probe = null;
try { probe = JSON.parse(probeRun.out.slice(probeRun.out.indexOf("{"))); } catch { probe = null; }
out.live = probe;
if (!probe) {
  problems.push(`the read-only live probe returned no JSON (exit ${probeRun.code}): ${norm(probeRun.err || probeRun.out)}`);
} else {
  const hub = probe.hub || {};
  const lphhw = probe.lphhw || {};
  if (hub.health?.status !== 200) problems.push(`Hub /health -> ${hub.health?.status}`);
  if (hub.version?.status !== 200) problems.push(`Hub /version -> ${hub.version?.status}`);
  if (hub.anonymousPost?.status !== 401) problems.push(`Hub anonymous POST /api/tfi/brief -> ${hub.anonymousPost?.status} (not fail-closed)`);
  if (hub.authorizedReadUnknown?.status !== 404) {
    problems.push(`Hub authorized read must reach LPHHW and answer 404 for an unknown key, got ${hub.authorizedReadUnknown?.status} ${hub.authorizedReadUnknown?.code || ""}`.trim());
  }
  if (lphhw.version?.status !== 200) problems.push(`LPHHW /version.json -> ${lphhw.version?.status}`);
  if (lphhw.authenticatedAnonymous?.status !== 401) problems.push(`LPHHW intake without a service token -> ${lphhw.authenticatedAnonymous?.status}`);
  if (lphhw.authorizedReadUnknown?.status !== 404) {
    problems.push(`LPHHW service-token read of an unknown key -> ${lphhw.authorizedReadUnknown?.status}`);
  }
  if (!probe.vault?.TFI_RESEARCH_API_TOKEN) {
    problems.push("no TFI production bearer in the DPAPI vault (key TFI_RESEARCH_API_TOKEN) - the check cannot authenticate to TFI production");
  }
}

// ---- 4. QA cleanup capability: production route + production database catalog --------------------
const lphhwServer = readText(path.join(P.lphhw, "apps", "lphhw", "production", "server.mjs"));
const u4Repo = readText(path.join(P.lphhw, "apps", "lphhw", "production", "repositories", "u4.mjs"));
const deleteRoute = /\.method\s*===\s*['"]DELETE['"]/.test(lphhwServer) && /u4\/briefs/.test(lphhwServer);
const deleteSql = /\bDELETE\s+FROM\s+u4_briefs\b/i.test(u4Repo);
out.cleanupSource = { deleteRoute, deleteSql };
if (!deleteRoute && !deleteSql) {
  problems.push(
    "LPHHW production server has no delete/purge route for /api/u4/briefs and repositories/u4.mjs has no DELETE statement",
  );
}
if (probe?.lphhw?.authorizedDeleteUnknown?.status === 404 || probe?.lphhw?.authorizedDeleteUnknown?.status === 405) {
  out.cleanupSource.deleteHttpStatus = probe.lphhw.authorizedDeleteUnknown.status;
}

const catalog = await probeU4Catalog();
out.cleanupCatalog = catalog;
if (!catalog.ok) {
  problems.push(`the live LPHHW catalog probe failed: ${catalog.error || catalog.reason || "unknown"}`);
} else if (catalog.exists && catalog.deleteTriggers?.length) {
  problems.push(
    `LPHHW production u4_briefs refuses DELETE for every row: ${catalog.deleteTriggers.map((t) => t.tgname).join(", ")} (BEFORE DELETE -> ${catalog.deleteTriggers[0]?.def?.match(/EXECUTE FUNCTION\s+(\w+)/)?.[1] || "trigger"})`,
  );
} else if (catalog.exists && !catalog.deleteCapableRoles?.length) {
  problems.push("LPHHW production u4_briefs has no role with DELETE privilege");
}

// ---- 5. The QA round trip (only when every prerequisite is real) --------------------------------
let roundTrip = null;
if (problems.length === 0) {
  // Register the QA row BEFORE it exists (Owner QA rule: recorded at creation).
  const qaDir = "D:\\FUNAGING_TEMP\\qa";
  const qaRows = path.join(qaDir, "qa_rows.json");
  mkdirSync(qaDir, { recursive: true });
  const ledger = existsSync(qaRows) ? JSON.parse(readFileSync(qaRows, "utf8")) : { policy: "QA- writes on production are recorded here at creation.", rows: [] };
  const ref = `QA-TFI-HUB-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const entry = {
    ref, table: "public.u4_briefs", environment: "production (LPHHW via Hub broker)",
    purpose: "G3-TFI-HUB-LPHHW create -> visible -> readback -> cleanup",
    created_at_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z"), created_by: "Track C builder (autonomy)",
    prefix_ok: true, state: "creating", cleanup: "pending",
  };
  ledger.rows = [...(ledger.rows || []), entry];
  writeFileSync(qaRows, JSON.stringify(ledger, null, 2));

  const create = await run("pwsh", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ROUNDTRIP,
    "-Phase", "create", "-Ref", ref], { timeoutMs: 300000 });
  let created = null;
  try { created = JSON.parse(create.out.slice(create.out.indexOf("{"))); } catch { created = null; }
  roundTrip = { ref, create: created ? { ...created, idempotencyKey: undefined, key8: created.key8 } : null, createExit: create.code, cleanup: null };
  if (!created || create.code !== 0) {
    problems.push(`TFI production brief create failed: ${norm(create.err || create.out) || `exit ${create.code}`}`);
  } else {
    const cleanup = await run("pwsh", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ROUNDTRIP,
      "-Phase", "cleanup", "-Key", created.idempotencyKey], { timeoutMs: 180000 });
    let cleaned = null;
    try { cleaned = JSON.parse(cleanup.out.slice(cleanup.out.indexOf("{"))); } catch { cleaned = null; }
    roundTrip.cleanup = { ...cleaned, exit: cleanup.code };
    if (!cleaned || cleaned.afterReadbackStatus !== 404 || cleanup.code !== 0) {
      problems.push(`the QA brief could not be cleaned up (after-delete readback ${cleaned?.afterReadbackStatus ?? "?"})`);
    }
    // Record the cleanup in the QA ledger and export the QA row.
    const all = JSON.parse(readFileSync(qaRows, "utf8"));
    const row = (all.rows || []).find((r) => r.ref === ref);
    if (row) {
      row.state = `received (lphhw id ${created.lphhwId || "?"})`;
      row.cleanup = problems.length ? "failed" : "cleaned";
      row.cleaned_at_utc = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      row.export_path = `D:\\FUNAGING_TEMP\\qa\\deleted\\${ref}.json`;
      writeFileSync(qaRows, JSON.stringify(all, null, 2));
      mkdirSync(path.join(qaDir, "deleted"), { recursive: true });
      writeFileSync(row.export_path, JSON.stringify({ ref, created, cleaned }, null, 2));
    }
  }
}
out.roundTrip = roundTrip;

// ---- verdict ------------------------------------------------------------------------------------
const reason = problems.length
  ? problems.join("; ")
  : `TFI production created a certified u4 brief (${roundTrip?.create?.idempotencyKey8}), LPHHW persisted it and answered the GET readback, and the QA brief was exported + deleted (after-delete readback 404)`;
done("G3-TFI-HUB-LPHHW", problems.length === 0, reason, {
  ...out,
  note: problems.length
    ? "ABSENCE IS NOT A PASS: the check refuses to create an undeletable QA row and names every missing hop above"
    : "end to end on production",
  liveUrls: URLS,
  contract: { tfiCreateRoute: `POST ${TFI_BRIEF_PATH}`, hubBroker: "POST/GET /api/tfi/brief", lphhwIntake: "POST/GET /api/u4/briefs" },
});
