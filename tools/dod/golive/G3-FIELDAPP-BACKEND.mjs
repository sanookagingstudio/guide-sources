// G3-FIELDAPP-BACKEND - MASTER_QUEUE row (Track C, G3), Owner rule 2026-11-21:
//   "Cross-system E2E on PRODUCTION: field-app capture -> backend (Main Web/LPHHW per contract)
//    -> the row is visible/usable in the target; cleanup of the QA-created row only.
//    No concept-only/POST-LAUNCH exit. The check must FAIL while the path is absent."
//
// This check exercises the REAL systems in THIS run and never accepts a local/mock path:
//   1. Source production: https://funaging-field-app.vercel.app serves the built capture app; `vercel inspect`
//      resolves the alias to a READY Production deployment, and the live bundle really carries the durable
//      action queue + the HTTP sync transport.
//   2. A REAL capture in Chromium on that production URL: report an incident -> the app says the draft is saved
//      and queued -> /action-log lists `field.incident.created` as queued -> "Sync now" answers
//      "Nothing was sent: ... stay queued" AND makes zero outbound POSTs. That is the honest production
//      source-side state: capture works, nothing can leave the device.
//   3. Target production: Main Web (funaging.club) and LPHHW are probed for a field-capture intake. Absence is
//      proven against a live server (the same host answers 200 on /api/health and LPHHW answers a REAL route
//      with 400 validation), so a 404 is the route's absence and not a dead host.
//   4. A production create is attempted ONLY when the repo declares an endpoint + readback + QA purge contract
//      (contracts/field-sync-endpoint.json). Without it the check REFUSES to write a row it could not delete -
//      the append-only lesson from G3-TFI-HUB-LPHHW. The E2E itself is create -> readback -> delayed readback ->
//      QA purge -> 404 in both systems -> second purge 404.
//
// PASS requires (2) and (4) to be green. Everything else is recorded raw so the failure names the exact gap.
// No token value is ever printed: the LPHHW service token comes from the DPAPI vault and only an fp8 reaches evidence.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const H = await import(pathToFileURL("D:\\FUNAGING_TEMP\\tracks\\golive\\lib\\harness.mjs").href);
const { run, ps, done, httpGet } = H;

const ID = "G3-FIELDAPP-BACKEND";
if (H.track !== "C") {
  done(ID, false, `refused: FUNAGING_TRACK is '${H.track}' but this check belongs to Track C`, { guard: "track" });
}

const P = {
  field: "D:\\FUNAGING_WEB\\01_ACTIVE\\funaging-field-app__2C9CF4FBE075",
  mainweb: "D:\\FUNAGING_WEB\\02_WORK\\MAINWEB_LPHHW_BRIDGE_20261116",
  lphhw: "D:\\FUNAGING_LPHHW",
  gs: "D:\\FUNAGING_WEB\\01_ACTIVE\\guide-sources__9CC897324B2F",
};
const URLS = {
  field: "https://funaging-field-app.vercel.app",
  mainweb: "https://funaging.club",
  lphhw: "https://lphhw.vercel.app",
};
const SCOPE = "team_UkIW1iwLo9j1Shy7ArPdFXMI";

const out = { steps: [], probes: {} };
const problems = [];
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const step = (name, ok, detail) => {
  out.steps.push({ name, ok: Boolean(ok), detail });
  if (!ok) problems.push(`${name}: ${detail}`);
  return ok;
};

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
    return { status: r.status, json, text: text.slice(0, 800), ms: Date.now() - t0 };
  } catch (error) {
    return { status: 0, json: null, text: "", error: String(error), ms: Date.now() - t0 };
  }
}
const postJson = (url, body, headers = {}) =>
  call(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

// ---- 0. the declared backend contract (endpoint + readback + QA purge) ---------------------------
const contractFile = path.join(P.field, "contracts", "field-sync-endpoint.json");
let contract = null;
out.contract = { file: contractFile, present: existsSync(contractFile) };
if (existsSync(contractFile)) {
  try {
    contract = JSON.parse(readFileSync(contractFile, "utf8"));
    out.contract.parsed = contract;
  } catch (error) {
    out.contract.parseError = String(error);
  }
}

// ---- 1. field-app production: the capture build, its deployment, its env NAMES (never values) -----
const index = await httpGet(`${URLS.field}/`, 30000);
const bundlePath = (index.body.match(/src="(\/assets\/[^"]+\.js)"/) || [null, null])[1];
out.field = { indexStatus: index.status, bundlePath, indexBytes: index.body.length };
step("field-app production answers with the built app", index.status === 200 && Boolean(bundlePath), `status=${index.status} bundle=${bundlePath}`);

let bundle = { status: 0, body: "" };
if (bundlePath) bundle = await httpGet(`${URLS.field}${bundlePath}`, 60000);
const markers = {
  unconfiguredReason: bundle.body.includes("no upload contract is configured"),
  durableQueue: bundle.body.includes("idempotencyKey"),
  incidentEvent: bundle.body.includes("field.incident.created"),
  actionLog: bundle.body.includes("Offline Action Queue"),
};
out.field.bundle = { status: bundle.status, bytes: bundle.body.length, markers };
step("the live bundle carries the capture + queue + honest-sync code",
  bundle.status === 200 && markers.unconfiguredReason && markers.durableQueue && markers.incidentEvent,
  JSON.stringify({ status: bundle.status, ...markers }));

const inspect = await run("cmd.exe", ["/d", "/s", "/c", `vercel inspect funaging-field-app.vercel.app --scope ${SCOPE}`], { timeoutMs: 120000 });
const inspectOut = `${inspect.out}\n${inspect.err}`;
const fieldDpl = (inspectOut.match(/dpl_[A-Za-z0-9]+/) || [null])[0];
out.field.deploymentId = fieldDpl;
out.field.inspectSnippet = norm(inspectOut).slice(0, 400);
step("the alias resolves to a READY production deployment",
  Boolean(fieldDpl) && /●\s*Ready/.test(inspectOut) && /target\s+production/.test(inspectOut),
  `dpl=${fieldDpl}`);

const envLs = await run("cmd.exe", ["/d", "/s", "/c", `vercel env ls production --scope ${SCOPE}`], { cwd: P.field, timeoutMs: 120000 });
const envOut = `${envLs.out}\n${envLs.err}`;
const envNames = [...envOut.matchAll(/^\s*([A-Z0-9_]+)\s+/gm)].map((m) => m[1]);
out.field.envNames = envNames;
const syncUrlNames = envNames.filter((n) => n.includes("FIELD_SYNC") || n === "VITE_FIELD_SYNC_URL");
out.field.syncUrlNames = syncUrlNames;
step("NO field sync endpoint is configured for the production build",
  syncUrlNames.length === 0,
  `VITE_FIELD_SYNC_URL present=${syncUrlNames.length > 0}; production env names=${envNames.length}`);

// ---- 2. a REAL capture on production, then an honest sync attempt --------------------------------
const require_ = createRequire(path.join(P.field, "package.json"));
let browser = null;
const browserOut = { requests: [], posts: [], capture: null, sync: null, pageErrors: [] };
try {
  const { chromium } = require_("playwright");
  browser = await chromium.launch({
    executablePath: existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined,
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("request", (req) => {
    browserOut.requests.push({ method: req.method(), url: req.url() });
    if (req.method() === "POST") browserOut.posts.push(req.url());
  });
  page.on("pageerror", (e) => browserOut.pageErrors.push(String(e).slice(0, 200)));

  await page.goto(`${URLS.field}/incidents`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("textarea", { timeout: 20000 });
  const qaNote = `QA-G3-FIELDAPP-BACKEND ${new Date().toISOString()} - production capture proof, deleted with the browser context`;
  await page.selectOption("select", "Transport delay");
  await page.fill("textarea", qaNote);
  const postsBeforeCapture = browserOut.posts.length;
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForSelector("text=Draft saved on this device and queued for sync.", { timeout: 15000 });
  browserOut.capture = { saved: true, postsDuringCapture: browserOut.posts.length - postsBeforeCapture, note: qaNote };

  await page.goto(`${URLS.field}/action-log`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector(".queue-item", { timeout: 20000 });
  const queueText = norm(await page.locator(".queue-list").innerText());
  const postsBeforeSync = browserOut.posts.length;
  const t0 = Date.now();
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.waitForSelector("[data-sync-report]", { timeout: 20000 });
  const report = norm(await page.locator("[data-sync-report]").innerText());
  const postsDuringSync = browserOut.posts.length - postsBeforeSync;
  const queueAfter = norm(await page.locator(".queue-list").innerText());
  browserOut.sync = { report, ms: Date.now() - t0, postsDuringSync, queueAfter, stillQueued: /queued for sync/.test(queueAfter) };
  browserOut.queueText = queueText;
  step("a real capture on production is saved and queued on the device",
    /field\.incident\.created/.test(queueText) && /queued for sync/.test(queueText),
    `queue="${queueText.slice(0, 160)}"`);
  step("sync answers honestly (nothing was sent) and the capture stays queued",
    /^Nothing was sent/i.test(report) && browserOut.sync.stillQueued,
    `report="${report.slice(0, 160)}"`);
  step("the capture + sync attempt made ZERO outbound POSTs",
    browserOut.capture.postsDuringCapture === 0 && postsDuringSync === 0,
    `capturePosts=${browserOut.capture.postsDuringCapture} syncPosts=${postsDuringSync}`);
  out.browser = {
    url: `${URLS.field}/incidents`,
    capture: browserOut.capture,
    sync: browserOut.sync,
    requestCount: browserOut.requests.length,
    origins: [...new Set(browserOut.requests.map((r) => { try { return new URL(r.url).origin; } catch { return r.url; } }))],
    posts: browserOut.posts,
    pageErrors: browserOut.pageErrors,
  };
} catch (error) {
  out.browser = { browserOut, error: String(error) };
  step("a real capture on production could not be driven", false, String(error).slice(0, 300));
} finally {
  try { await browser?.close(); } catch { /* already closed */ }
}

// ---- 3. target production: is there ANY field-capture intake? -------------------------------------
const mwHealth = await httpGet(`${URLS.mainweb}/api/health`, 20000);
out.probes.mainwebHealth = { status: mwHealth.status, body: mwHealth.body.slice(0, 120) };
step("Main Web production server is live (a 404 below means the route is absent)", mwHealth.status === 200, `status=${mwHealth.status}`);

const qaKey = `QA-G3-FIELDAPP-BACKEND-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const probeBody = {
  event: "field.incident.created",
  idempotencyKey: qaKey,
  occurredAt: new Date().toISOString(),
  app: "funaging-field-app",
  payload: { tripId: "trip-001", staffId: "staff-demo", incidentType: "Transport delay", note: "QA G3 probe" },
};
// Presence is probed with OPTIONS/GET only. This check NEVER posts to an undeclared route, so it cannot
// leave behind a production row that has no purge path (the G3-TFI-HUB-LPHHW append-only lesson).
const presence = async (base, p, headers = {}) => {
  const opts = await call(`${base}${p}`, { method: "OPTIONS", headers }, {});
  const get = await call(`${base}${p}`, { headers }, {});
  return { path: p, options: opts.status, get: get.status, body: norm(get.text).slice(0, 100) };
};
const mainwebCandidates = ["/api/field/actions", "/api/field/capture", "/api/field/sync", "/api/field-sync", "/api/field/incidents"];
out.probes.mainweb = [];
for (const p of mainwebCandidates) out.probes.mainweb.push(await presence(URLS.mainweb, p));
const mainwebAll404 = out.probes.mainweb.every((p) => p.options === 404 && p.get === 404);
// source-level confirmation: no deployed api route file is a field-capture intake
const mwRouteFiles = (await run("cmd.exe", ["/d", "/s", "/c", `dir /b /s "${P.mainweb}\\api\\field*"`], { timeoutMs: 30000 }));
const mwNoFieldSource = !/\S\.js/.test(mwRouteFiles.out);
out.probes.mainwebSource = { fieldRouteFilesFound: !mwNoFieldSource, raw: norm(mwRouteFiles.out).slice(0, 160) };
step("Main Web production has NO field-capture intake (fact)", mainwebAll404 && mwNoFieldSource,
  `${out.probes.mainweb.map((p) => `${p.path}=opt:${p.options}/get:${p.get}`).join(" ")} source-routes=${mwNoFieldSource ? "none" : "FOUND"}`);

// LPHHW service token from the vault (fingerprint only reaches evidence)
const tokenScript = `
Import-Module 'D:\\FUNAGING_TEMP\\eco_owner\\tools\\FunagingSecrets.psm1' -Force
function Fp8([string]$v){ $sha=[System.Security.Cryptography.SHA256]::Create(); try { $h=$sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($v)) } finally { $sha.Dispose() }; return (($h[0..3] | ForEach-Object { $_.ToString('x2') }) -join '') }
$t = Get-FunagingSecret LPHHW_SERVICE_TOKEN
@{ token = $t; fp8 = (Fp8 $t) } | ConvertTo-Json -Compress
`;
const tok = await ps(tokenScript, { timeoutMs: 60000 });
out.probes.lphhwToken = { present: Boolean(tok.json?.token), fp8: tok.json?.fp8 ? `fp8:${tok.json.fp8}` : null };
const lphhwVersion = await httpGet(`${URLS.lphhw}/version.json`, 20000);
out.probes.lphhwVersion = { status: lphhwVersion.status, body: lphhwVersion.body.slice(0, 200) };
step("LPHHW production server is live", lphhwVersion.status === 200, `status=${lphhwVersion.status}`);

const lphhwHeaders = tok.json?.token ? { "x-tfi-service-token": tok.json.token } : {};
// negative control: a REAL LPHHW intake answers with validation, not 404
const control = await postJson(`${URLS.lphhw}/api/u4/briefs`, {}, lphhwHeaders);
out.probes.lphhwControl = { path: "/api/u4/briefs", status: control.status, body: norm(control.text).slice(0, 160) };
step("the LPHHW control route proves the probe can see a real route (not 404)", control.status === 400 || control.status === 401 || control.status === 403, `status=${control.status}`);

const lphhwCandidates = ["/api/field/actions", "/api/field/sync", "/api/field/capture"];
out.probes.lphhw = [];
for (const p of lphhwCandidates) out.probes.lphhw.push(await presence(URLS.lphhw, p, lphhwHeaders));
// LPHHW authenticates every /api/* path, so a 401 alone would not prove absence; the deployed source is checked too.
const lphhwSrc = await run("cmd.exe", ["/d", "/s", "/c", `findstr /s /i /c:"/api/field" "${P.lphhw}\\apps\\lphhw\\production\\*.mjs" "${P.lphhw}\\apps\\lphhw\\production\\*.js"`], { timeoutMs: 60000 });
const lphhwSourceHit = /\/api\/field/i.test(lphhwSrc.out);
out.probes.lphhwSource = { fieldRouteInDeployedSource: lphhwSourceHit };
const lphhwAbsent = !lphhwSourceHit && out.probes.lphhw.every((p) => p.get === 404 || p.get === 401);
step("LPHHW production has NO field-capture intake (fact)", lphhwAbsent,
  `${out.probes.lphhw.map((p) => `${p.path}=opt:${p.options}/get:${p.get}`).join(" ")} source=${lphhwSourceHit ? "FOUND" : "none"}`);

// The DoD leg itself: some backend must ACCEPT a production capture. Neither target does.
step("a backend intake accepts a field capture",
  false,
  `no intake exists: Main Web every candidate 404 (source has no api/field*), LPHHW every candidate 401 by the global /api gate and its deployed source has no /api/field route; only real service-token intake is /api/u4/briefs (${out.probes.lphhwControl.status} validation)`);

// ---- 4. the real E2E (only with a declared + purgeable endpoint contract) ------------------------
out.e2e = null;
const completeContract = Boolean(contract?.endpoint && contract?.readback && contract?.purge && contract?.reason);
if (!completeContract) {
  out.e2e = {
    ran: false,
    refused: "no contracts/field-sync-endpoint.json declaring endpoint + readback + QA purge: this check will not create a production row it could not delete",
  };
  step("a QA-safe backend contract is declared in the field-app repo", false, "contracts/field-sync-endpoint.json missing or incomplete (endpoint/readback/purge/reason)");
  step("the production capture was visible in the target and cleaned up", false,
    "not attempted: there is no endpoint to create it in and no declared QA purge, so the DoD leg (create -> visible/usable -> delete the QA row only) has no target");
} else {
  const qaId = probeBody.idempotencyKey;
  const created = await postJson(contract.endpoint, { ...probeBody, idempotencyKey: qaId }, contract.headers || {});
  out.e2e = { ran: true, qaId, create: { status: created.status, body: norm(created.text).slice(0, 200) } };
  step("the backend accepted the QA capture", created.status === 201 || created.status === 200, `status=${created.status}`);
  const read1 = await call(String(contract.readback).replace("{key}", encodeURIComponent(qaId)), { headers: contract.headers || {} });
  out.e2e.read1 = { status: read1.status, key: read1.json?.idempotencyKey ?? null };
  step("the row is visible/usable in the target", read1.status === 200 && read1.json?.idempotencyKey === qaId, `status=${read1.status}`);
  await new Promise((resolve) => setTimeout(resolve, 12000));
  const read2 = await call(String(contract.readback).replace("{key}", encodeURIComponent(qaId)), { headers: contract.headers || {} });
  out.e2e.read2 = { status: read2.status, at: new Date().toISOString() };
  step("the row survives a delayed readback (durable store)", read2.status === 200, `status=${read2.status}`);
  const purge = await postJson(String(contract.purge).replace("{key}", encodeURIComponent(qaId)), { qa: true }, contract.headers || {});
  out.e2e.purge = { status: purge.status, body: norm(purge.text).slice(0, 160) };
  step("the QA row was cleaned up", purge.status === 200, `status=${purge.status}`);
  const gone = await call(String(contract.readback).replace("{key}", encodeURIComponent(qaId)), { headers: contract.headers || {} });
  out.e2e.after = { status: gone.status };
  step("the target answers 404 after the cleanup", gone.status === 404, `status=${gone.status}`);
}

// ---- 5. the source contract still forbids the connection (recorded, not a pass) -------------------
try {
  const bridge = JSON.parse(readFileSync(path.join(P.field, "contracts", "funaging-bridge.contract.json"), "utf8"));
  out.sourceContract = {
    bridgeToMainWeb: bridge?.bridgeReadiness?.bridgeToMainWeb ?? null,
    mainWebStatus: bridge?.bridgeReadiness?.mainWebStatus ?? null,
    dataBoundary: bridge?.boundaries?.dataBoundary ?? null,
    acceptedFutureEvents: bridge?.bridgeReadiness?.acceptedFutureEvents ?? [],
  };
} catch (error) {
  out.sourceContract = { error: String(error) };
}
out.requiredEnvelope = "POST <endpoint> body {event, idempotencyKey, occurredAt, payload, app} + header idempotency-key (src/lib/syncTransport.ts toBridgePayload); cleanup must delete the QA-marked row only";

const ok = problems.length === 0;
done(ID, ok,
  ok
    ? `field-app production capture -> backend E2E proved: real Chromium capture queued and synced through the declared endpoint, the row was visible on a first + delayed readback and purged, both 404 afterwards (field-app ${fieldDpl})`
    : `failing legs: ${problems.join(" | ")}`,
  out);
