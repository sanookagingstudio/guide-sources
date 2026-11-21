// P2C-GUIDE - guide-sources: standalone build to contract with mock adapters + contract tests in CI;
// no live connection; connect day = flip a flag per route + E2E + flag-off rollback.
//
// Proves on the real repo (no stubs, no hard-coded PASS):
//   1. the standalone contract (`standalone/guide-draft-service/src/contract.ts`) has not drifted from
//      the DEPLOYED contract (`src/lib/bridge-store.ts`): same contract id, same 11 record fields, same
//      QA prefix - re-read here independently of the package's own tests,
//   2. the package really builds and its contract tests really pass - run through the SAME command the
//      CI workflow runs (`npm --prefix standalone/guide-draft-service run ci`),
//   3. the CI workflow exists, triggers on the package and runs that command,
//   4. the REAL built HTTP service answers health/version and drives the whole contract over the mock
//      file adapter: create -> read-back -> list -> survive a process restart -> QA-only purge -> gone,
//   5. refusals are real: no/wrong token (401), unset token (503), bad contract version, missing title,
//      credential material, non-JSON, unknown path, wrong method,
//   6. no live connection: adapter is the mock, `live_connections` is 0, no outbound client in the
//      sources, and a live store URL makes the process refuse to start,
//   7. the per-route gate: flag ON answers 501 LIVE_ADAPTER_NOT_BUILT for THAT route only, the other
//      routes keep serving, and flag back to 0 serves the mock again (the rollback path, executed),
//   8. connect day is documented per route with its flag name and the flag-off rollback.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { done, run } from "../lib/harness.mjs";

const GS = process.env.P2C_GUIDE_ROOT || "D:\\FUNAGING_WEB\\01_ACTIVE\\guide-sources__9CC897324B2F";
const PKG_REL = "standalone/guide-draft-service";
const PKG = path.join(GS, PKG_REL);
const EXERCISE_ROOT = path.join("D:\\FUNAGING_TEMP\\tracks\\C\\work", "p2c_guide");
const out = { repo: GS, package: PKG, checks: {} };
const problems = [];

if ((process.env.FUNAGING_TRACK || "").toUpperCase() !== "C") {
  console.error("P2C-GUIDE refuses to run: FUNAGING_TRACK must be C (this check writes Track C evidence)");
  process.exit(1);
}

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const readJson = (file) => JSON.parse(read(file) || "{}");

async function git(args) {
  const result = await run("git", ["-C", GS, ...args], { timeoutMs: 30000 });
  return result.out.trim();
}

const SECRET_SHAPES = [
  { name: "64-hex", re: /\b[0-9a-f]{64}\b/i },
  { name: "sk-key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
];
const noSecretShapes = (text) => SECRET_SHAPES.filter((shape) => shape.re.test(text)).map((shape) => shape.name);

// ---------------------------------------------------------------- 1. contract drift (independent re-read)
out.head = await git(["rev-parse", "HEAD"]);
const appStorePath = path.join(GS, "src", "lib", "bridge-store.ts");
const standaloneContractPath = path.join(PKG, "src", "contract.ts");
const appStore = read(appStorePath);
const standaloneContract = read(standaloneContractPath);

function appContract() {
  const contract = (appStore.match(/export const BRIDGE_CONTRACT = "([^"]+)"/) || [])[1] || null;
  const qa = (appStore.match(/export const QA_PREFIX = "([^"]+)"/) || [])[1] || null;
  const block = (appStore.match(/export type GuideDraftRecord = \{([\s\S]*?)\n\};/) || [])[1] || "";
  const fields = block
    .split("\n")
    .map((line) => (line.match(/^\s{2}([a-z_]+)\s*:/) || [])[1])
    .filter(Boolean);
  return { contract, qa, fields };
}

function standaloneContractShape() {
  const contract = (standaloneContract.match(/export const GUIDE_SOURCE_DRAFT_CONTRACT = "([^"]+)"/) || [])[1] || null;
  const qa = (standaloneContract.match(/export const QA_PREFIX = "([^"]+)"/) || [])[1] || null;
  const block = (standaloneContract.match(/export const GUIDE_DRAFT_FIELDS = \[([\s\S]*?)\] as const;/) || [])[1] || "";
  const fields = [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  return { contract, qa, fields };
}

const app = appContract();
const standalone = standaloneContractShape();
out.drift = {
  app: app,
  standalone: standalone,
  contractEqual: app.contract !== null && app.contract === standalone.contract,
  fieldsEqual: JSON.stringify(app.fields) === JSON.stringify(standalone.fields),
  qaEqual: app.qa !== null && app.qa === standalone.qa,
};
if (!app.contract || !standalone.contract) problems.push("cannot read the contract id from the app or the standalone contract");
else if (app.contract !== standalone.contract) problems.push(`contract id drifted: app ${app.contract} vs standalone ${standalone.contract}`);
if (app.fields.length !== 11) problems.push(`the deployed GuideDraftRecord has ${app.fields.length} fields, expected 11`);
if (JSON.stringify(app.fields) !== JSON.stringify(standalone.fields)) {
  problems.push(`record fields drifted: app ${app.fields.join(",")} vs standalone ${standalone.fields.join(",")}`);
}
if (app.qa !== standalone.qa) problems.push(`QA prefix drifted: app ${app.qa} vs standalone ${standalone.qa}`);

// ---------------------------------------------------------------- 2. build + contract tests through the CI command
const pkgJson = readJson(path.join(PKG, "package.json"));
out.package = { build: pkgJson.scripts?.build || null, test: pkgJson.scripts?.test || null, ci: pkgJson.scripts?.ci || null };
for (const [name, needle] of [
  ["build", "tsc -p tsconfig.json"],
  ["test", "node --test tests/*.test.mjs"],
  ["ci", "npm run build && npm test"],
]) {
  if (!String(pkgJson.scripts?.[name] || "").includes(needle)) problems.push(`package.json script "${name}" does not contain "${needle}"`);
}

const ciRun = await run("cmd.exe", ["/c", `npm --prefix ${PKG_REL} run ci`], { cwd: GS, timeoutMs: 300000 });
const cleanCi = `${ciRun.out}\n${ciRun.err}`.replace(/\u001b\[[0-9;]*m/g, "");
const testPass = Number((cleanCi.match(/^ℹ pass (\d+)/m) || cleanCi.match(/\bpass (\d+)\b/) || [])[1] ?? -1);
const testFail = Number((cleanCi.match(/^ℹ fail (\d+)/m) || cleanCi.match(/\bfail (\d+)\b/) || [])[1] ?? -1);
out.ci = { exit: ciRun.code, testPass, testFail, tail: cleanCi.slice(-700) };
if (ciRun.code !== 0) problems.push(`npm --prefix ${PKG_REL} run ci exited ${ciRun.code}`);
if (testFail !== 0) problems.push(`contract tests reported ${testFail} failure(s)`);
if (!(testPass >= 20)) problems.push(`contract tests only reported ${testPass} passing test(s), expected at least 20`);
for (const artifact of ["dist/server.js", "dist/contract.js", "dist/store.js", "dist/adapters.js", "dist/auth.js"]) {
  if (!existsSync(path.join(PKG, artifact))) problems.push(`build produced no ${artifact}`);
}

// ---------------------------------------------------------------- 3. CI workflow
const workflowPath = path.join(GS, ".github", "workflows", "guide-standalone-contract.yml");
const workflow = read(workflowPath);
out.ci.workflow = { path: workflowPath, exists: existsSync(workflowPath) };
if (!out.ci.workflow.exists) problems.push("CI workflow .github/workflows/guide-standalone-contract.yml is missing");
else {
  out.ci.workflow.runsSameCommand = workflow.includes(`npm --prefix ${PKG_REL} run ci`);
  out.ci.workflow.triggersOnPackage = workflow.includes(`${PKG_REL}/**`);
  if (!out.ci.workflow.runsSameCommand) problems.push("CI workflow does not run the command this check ran");
  if (!out.ci.workflow.triggersOnPackage) problems.push("CI workflow does not trigger on the standalone package path");
}

// ---------------------------------------------------------------- HTTP harness
function startServer(env, extra = {}) {
  const lines = [];
  const child = spawn(process.execPath, [path.join(PKG, "dist", "server.js")], {
    env: { ...process.env, GUIDE_PORT: "0", GUIDE_SOURCE_SHA: out.head, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => lines.push(String(d)));
  child.stderr.on("data", (d) => lines.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const base = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not announce itself: ${lines.join("")}`)), 15000);
    child.stdout.on("data", () => {
      const match = lines.join("").match(/GUIDE_STANDALONE_LISTENING (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (extra.expectExit) resolve(null);
      else reject(new Error(`server exited ${code}: ${lines.join("")}`));
    });
  });
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill();
  });
  return { base, stop, exited, transcript: () => lines.join("") };
}

async function request(base, method, route, { body, token } = {}) {
  const headers = {};
  if (token !== undefined) headers["x-guide-sources-service-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: response.status, body: parsed, text };
}

const draft = (overrides = {}) => ({
  draft_id: "QA-P2C-GUIDE-1",
  title: "Kyoto in November (standalone contract)",
  summary: "Peak momiji, quieter weekdays; a standalone contract draft.",
  locale: "en",
  qa: true,
  requested_by: "p2c-guide-check",
  claims: [{ claim: "peak season starts in late November", confidence: 0.8 }],
  sources: [{ url: "https://example.test/source", kind: "web" }],
  ...overrides,
});

const token = (await import("node:crypto")).randomBytes(32).toString("hex"); // in memory only, never printed
mkdirSync(EXERCISE_ROOT, { recursive: true });
const storeDir = (name) => {
  const dir = mkdtempSync(path.join(EXERCISE_ROOT, `${name}-`));
  return dir;
};
const baseEnv = (dir) => ({ GUIDE_MOCK_STORE_DIR: dir, GUIDE_SOURCES_SERVICE_TOKEN: token });
const secretHits = [];
const noteText = (label, text) => {
  const hits = noSecretShapes(text);
  if (hits.length) secretHits.push(`${label}:${hits.join("|")}`);
};

// ---------------------------------------------------------------- 4. the contract over real HTTP
out.http = {};
const mainDir = storeDir("main");
const phaseOne = startServer(baseEnv(mainDir));
let baseUrl;
try {
  baseUrl = await phaseOne.base;
  const health = await request(baseUrl, "GET", "/health");
  noteText("health", health.text);
  out.http.health = { status: health.status, body: health.body };
  if (health.status !== 200) problems.push(`GET /health answered ${health.status}`);
  if (health.body?.status !== "ok") problems.push("GET /health is not ok");
  if (health.body?.adapter !== "mock-guide-draft@1") problems.push(`GET /health adapter is ${health.body?.adapter}`);
  if (health.body?.live_connections !== 0) problems.push("GET /health reports a live connection");
  if (health.body?.store !== "mock-file") problems.push(`GET /health store is ${health.body?.store}`);
  if (health.body?.source_sha !== out.head) problems.push(`GET /health source_sha ${health.body?.source_sha} != HEAD ${out.head}`);
  if (JSON.stringify(health.body?.flags) !== JSON.stringify({ GUIDE_LIVE_DRAFT_CREATE: false, GUIDE_LIVE_DRAFT_READ: false, GUIDE_LIVE_DRAFT_PURGE: false })) {
    problems.push(`default flags are not all OFF: ${JSON.stringify(health.body?.flags)}`);
  }

  const version = await request(baseUrl, "GET", "/version");
  noteText("version", version.text);
  out.http.version = { status: version.status, body: version.body };
  const routes = Array.isArray(version.body?.routes) ? version.body.routes : [];
  if (version.status !== 200) problems.push(`GET /version answered ${version.status}`);
  if (version.body?.contract_version !== app.contract) problems.push(`GET /version contract_version is ${version.body?.contract_version}`);
  if (version.body?.live_connections !== 0) problems.push("GET /version reports a live connection");
  if (routes.length !== 3) problems.push(`GET /version lists ${routes.length} routes, expected 3`);
  const expectedRoutes = {
    "drafts.create": "GUIDE_LIVE_DRAFT_CREATE",
    "drafts.read": "GUIDE_LIVE_DRAFT_READ",
    "drafts.purge": "GUIDE_LIVE_DRAFT_PURGE",
  };
  for (const [route, flag] of Object.entries(expectedRoutes)) {
    const row = routes.find((candidate) => candidate.route === route);
    if (!row) { problems.push(`GET /version has no ${route} route`); continue; }
    if (row.live_flag !== flag) problems.push(`${route} flag is ${row.live_flag}, expected ${flag}`);
    if (row.live_enabled !== false) problems.push(`${route} is live-enabled by default`);
  }

  const created = await request(baseUrl, "POST", "/api/bridge/drafts", { body: draft(), token });
  noteText("create", created.text);
  out.http.create = { status: created.status, body: created.body };
  if (created.status !== 201) problems.push(`POST /api/bridge/drafts answered ${created.status}`);
  if (created.body?.contract_version !== app.contract) problems.push("create response contract_version drifted");
  if (created.body?.store !== "mock-file") problems.push(`create response store is ${created.body?.store}`);
  if (created.body?.draft_id !== "QA-P2C-GUIDE-1" || created.body?.qa !== true) problems.push("create response did not echo the QA draft identity");

  const readBack = await request(baseUrl, "GET", "/api/bridge/drafts/QA-P2C-GUIDE-1", { token });
  noteText("read", readBack.text);
  out.http.read = { status: readBack.status, body: readBack.body };
  if (readBack.status !== 200) problems.push(`GET /api/bridge/drafts/QA-P2C-GUIDE-1 answered ${readBack.status}`);
  const record = readBack.body?.draft ?? {};
  if (record.title !== draft().title) problems.push("read-back title does not match the created draft");
  if (record.summary !== draft().summary) problems.push("read-back summary does not match the created draft");
  if (record.contract_version !== app.contract) problems.push("read-back contract_version drifted");
  const recordFields = Object.keys(record).sort();
  if (JSON.stringify(recordFields) !== JSON.stringify([...app.fields].sort())) problems.push(`read-back record fields ${recordFields.join(",")} != contract ${app.fields.join(",")}`);

  const list = await request(baseUrl, "GET", "/api/bridge/drafts?qa=1", { token });
  noteText("list", list.text);
  out.http.list = { status: list.status, body: list.body };
  const listed = Array.isArray(list.body?.drafts) ? list.body.drafts : [];
  if (list.status !== 200) problems.push(`GET /api/bridge/drafts?qa=1 answered ${list.status}`);
  if (!listed.some((row) => row.draft_id === "QA-P2C-GUIDE-1")) problems.push("the QA draft is not listed");

  // keep a non-QA draft to prove the purge refusal below
  const keep = await request(baseUrl, "POST", "/api/bridge/drafts", { body: draft({ draft_id: "GS-P2C-GUIDE-KEEP", qa: false }), token });
  noteText("keep", keep.text);
  if (keep.status !== 201) problems.push(`creating the non-QA draft answered ${keep.status}`);
  const refusedPurge = await request(baseUrl, "POST", "/api/bridge/drafts/GS-P2C-GUIDE-KEEP/purge", { token });
  noteText("purge-refused", refusedPurge.text);
  out.http.purgeRefused = { status: refusedPurge.status, body: refusedPurge.body };
  if (refusedPurge.status !== 403 || refusedPurge.body?.code !== "QA_ONLY") problems.push(`purging a non-QA draft answered ${refusedPurge.status} ${refusedPurge.body?.code} instead of 403 QA_ONLY`);
} finally {
  await phaseOne.stop();
}

// durability: a SECOND process on the same mock store sees the QA draft
const phaseTwo = startServer(baseEnv(mainDir));
try {
  const restarted = await phaseTwo.base;
  const afterRestart = await request(restarted, "GET", "/api/bridge/drafts/QA-P2C-GUIDE-1", { token });
  noteText("restart-read", afterRestart.text);
  out.http.afterRestart = { status: afterRestart.status };
  if (afterRestart.status !== 200) problems.push(`the QA draft did not survive a process restart (${afterRestart.status})`);
  const purged = await request(restarted, "POST", "/api/bridge/drafts/QA-P2C-GUIDE-1/purge", { token });
  noteText("purge", purged.text);
  out.http.purge = { status: purged.status, body: purged.body };
  if (purged.status !== 200 || purged.body?.deleted !== true) problems.push(`QA purge answered ${purged.status}`);
  const gone = await request(restarted, "GET", "/api/bridge/drafts/QA-P2C-GUIDE-1", { token });
  out.http.gone = { status: gone.status, code: gone.body?.code };
  if (gone.status !== 404) problems.push(`the purged draft still answers ${gone.status}`);
} finally {
  await phaseTwo.stop();
}

// ---------------------------------------------------------------- 5. refusals
const negDir = storeDir("negative");
const phaseNeg = startServer(baseEnv(negDir));
try {
  const negBase = await phaseNeg.base;
  const cases = {};
  const runCase = async (name, method, route, options = {}) => {
    const response = await request(negBase, method, route, options);
    noteText(name, response.text);
    cases[name] = { status: response.status, code: response.body?.code || null };
    return response;
  };
  await runCase("noToken", "POST", "/api/bridge/drafts", { body: draft() });
  await runCase("wrongToken", "POST", "/api/bridge/drafts", { body: draft(), token: "b".repeat(64) });
  await runCase("badVersion", "POST", "/api/bridge/drafts", { body: draft({ contract_version: "guide-source-draft@2.0.0" }), token });
  await runCase("noTitle", "POST", "/api/bridge/drafts", { body: draft({ title: "" }), token });
  await runCase("secretShape", "POST", "/api/bridge/drafts", { body: draft({ claims: [{ note: `key ${"deadbeef".repeat(8)}` }] }), token });
  await runCase("secretField", "POST", "/api/bridge/drafts", { body: draft({ token: "placeholder" }), token });
  await runCase("notJson", "POST", "/api/bridge/drafts", { body: "not json", token });
  await runCase("unknownPath", "GET", "/api/bridge/unknown", { token });
  await runCase("wrongMethod", "DELETE", "/api/bridge/drafts", { token });
  out.http.negative = cases;
  if (cases.noToken.status !== 401 || cases.noToken.code !== "UNAUTHORIZED") problems.push("a missing token was not refused with 401 UNAUTHORIZED");
  if (cases.wrongToken.status !== 401) problems.push("a wrong token was not refused with 401");
  if (cases.badVersion.status !== 400 || cases.badVersion.code !== "DRAFT_INCOMPLETE") problems.push("a wrong contract version was not refused with 400 DRAFT_INCOMPLETE");
  if (cases.noTitle.status !== 400) problems.push("a draft without a title was not refused");
  if (cases.secretShape.status !== 400 || cases.secretShape.code !== "SECRET_MATERIAL_REFUSED") problems.push("a credential-shaped claim was not refused with SECRET_MATERIAL_REFUSED");
  if (cases.secretField.status !== 400 || cases.secretField.code !== "SECRET_MATERIAL_REFUSED") problems.push("a credential field was not refused with SECRET_MATERIAL_REFUSED");
  if (cases.notJson.status !== 400 || cases.notJson.code !== "INVALID_JSON") problems.push("a non-JSON body was not refused with INVALID_JSON");
  if (cases.unknownPath.status !== 404) problems.push(`an unknown path answered ${cases.unknownPath.status}, expected 404`);
  if (cases.wrongMethod.status !== 405) problems.push(`a DELETE answered ${cases.wrongMethod.status}, expected 405`);
} finally {
  await phaseNeg.stop();
}

// unset token = 503 fail-closed
const phaseUnconfigured = startServer({ GUIDE_MOCK_STORE_DIR: storeDir("unconfigured"), GUIDE_SOURCES_SERVICE_TOKEN: "" });
try {
  const unconfiguredBase = await phaseUnconfigured.base;
  const response = await request(unconfiguredBase, "POST", "/api/bridge/drafts", { body: draft() });
  out.http.unconfigured = { status: response.status, code: response.body?.code };
  if (response.status !== 503 || response.body?.code !== "BRIDGE_NOT_CONFIGURED") problems.push(`an unset token answered ${response.status} ${response.body?.code} instead of 503 BRIDGE_NOT_CONFIGURED`);
} finally {
  await phaseUnconfigured.stop();
}

// a live store URL is refused at start-up (no live connection by construction)
const refusedStart = startServer({ GUIDE_LIVE_STORE_URL: "postgres://example.test/db" }, { expectExit: true });
const refusedCode = await refusedStart.exited;
out.noLiveConnection = { refusedExit: refusedCode, refusal: /GUIDE_STANDALONE_REFUSED/.test(refusedStart.transcript()) };
if (refusedCode !== 2) problems.push(`a live store URL exited ${refusedCode}, expected 2`);
if (!/GUIDE_STANDALONE_REFUSED/.test(refusedStart.transcript())) problems.push("a live store URL was not refused with GUIDE_STANDALONE_REFUSED");

// no outbound client anywhere in the package sources
const outbound = [];
const walkSources = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkSources(full);
    else if (entry.endsWith(".ts")) {
      const text = read(full);
      if (/\bfetch\s*\(|https?\.request\s*\(|net\.connect|tls\.connect|new\s+WebSocket|undici|from\s+"postgres"|supabase-js/.test(text)) {
        outbound.push(path.relative(PKG, full));
      }
    }
  }
};
walkSources(path.join(PKG, "src"));
out.noLiveConnection.outboundSources = outbound;
if (outbound.length) problems.push(`package sources carry an outbound/live client: ${outbound.join(",")}`);

// ---------------------------------------------------------------- 6. per-route flags + executed rollback
out.flags = { on: {}, rollback: {} };
const onDir = storeDir("flag-create");
const phaseOn = startServer({ ...baseEnv(onDir), GUIDE_LIVE_DRAFT_CREATE: "1" });
try {
  const onBase = await phaseOn.base;
  const version = await request(onBase, "GET", "/version");
  const create = (version.body?.routes || []).find((row) => row.route === "drafts.create");
  const read = (version.body?.routes || []).find((row) => row.route === "drafts.read");
  out.flags.on.version = { create: create?.live_enabled, read: read?.live_enabled };
  if (create?.live_enabled !== true) problems.push("GUIDE_LIVE_DRAFT_CREATE=1 did not mark the create route live");
  if (read?.live_enabled !== false) problems.push("the read route was reported live without its own flag");

  const refused = await request(onBase, "POST", "/api/bridge/drafts", { body: draft({ draft_id: "QA-P2C-GUIDE-FLAG" }), token });
  noteText("flag-on-create", refused.text);
  out.flags.on.create = { status: refused.status, code: refused.body?.code };
  if (refused.status !== 501 || refused.body?.code !== "LIVE_ADAPTER_NOT_BUILT") problems.push(`flag ON create answered ${refused.status} ${refused.body?.code} instead of 501 LIVE_ADAPTER_NOT_BUILT`);
  if (refused.body && "draft_id" in refused.body) problems.push("flag ON create still returned a fabricated draft");

  const readStillServes = await request(onBase, "GET", "/api/bridge/drafts", { token });
  out.flags.on.read = { status: readStillServes.status };
  if (readStillServes.status !== 200) problems.push(`flag ON create broke the read route (${readStillServes.status})`);
} finally {
  await phaseOn.stop();
}

// read flag ON refuses reads only
const phaseReadOn = startServer({ ...baseEnv(storeDir("flag-read")), GUIDE_LIVE_DRAFT_READ: "1" });
try {
  const readBase = await phaseReadOn.base;
  const readRefused = await request(readBase, "GET", "/api/bridge/drafts", { token });
  const createServes = await request(readBase, "POST", "/api/bridge/drafts", { body: draft({ draft_id: "QA-P2C-GUIDE-READFLAG" }), token });
  out.flags.on.readFlag = { read: readRefused.status, create: createServes.status };
  if (readRefused.status !== 501) problems.push(`flag ON read answered ${readRefused.status}, expected 501`);
  if (createServes.status !== 201) problems.push(`flag ON read broke create (${createServes.status})`);
} finally {
  await phaseReadOn.stop();
}

// purge flag ON refuses purge only
const phasePurgeOn = startServer({ ...baseEnv(storeDir("flag-purge")), GUIDE_LIVE_DRAFT_PURGE: "1" });
try {
  const purgeBase = await phasePurgeOn.base;
  const seed = await request(purgeBase, "POST", "/api/bridge/drafts", { body: draft({ draft_id: "QA-P2C-GUIDE-PURGEFLAG" }), token });
  const purgeRefused = await request(purgeBase, "POST", "/api/bridge/drafts/QA-P2C-GUIDE-PURGEFLAG/purge", { token });
  out.flags.on.purgeFlag = { seed: seed.status, purge: purgeRefused.status };
  if (seed.status !== 201) problems.push(`flag ON purge broke create (${seed.status})`);
  if (purgeRefused.status !== 501) problems.push(`flag ON purge answered ${purgeRefused.status}, expected 501`);
} finally {
  await phasePurgeOn.stop();
}

// rollback: flag back to 0 serves the mock again
const phaseRollback = startServer({ ...baseEnv(storeDir("flag-rollback")), GUIDE_LIVE_DRAFT_CREATE: "0" });
try {
  const rollbackBase = await phaseRollback.base;
  const served = await request(rollbackBase, "POST", "/api/bridge/drafts", { body: draft({ draft_id: "QA-P2C-GUIDE-ROLLBACK" }), token });
  out.flags.rollback = { status: served.status, store: served.body?.store };
  if (served.status !== 201 || served.body?.store !== "mock-file") problems.push("flag back to 0 did not restore the mock create (rollback path broken)");
} finally {
  await phaseRollback.stop();
}

// ---------------------------------------------------------------- 7. connect-day documentation
const connectPath = path.join(GS, "docs", "GUIDE_CONNECT_DAY.md");
const connectDoc = read(connectPath);
out.connectDay = { path: connectPath, exists: existsSync(connectPath) };
if (!out.connectDay.exists) problems.push("docs/GUIDE_CONNECT_DAY.md is missing");
else {
  out.connectDay.flagsNamed = ["GUIDE_LIVE_DRAFT_CREATE", "GUIDE_LIVE_DRAFT_READ", "GUIDE_LIVE_DRAFT_PURGE"].filter((flag) => connectDoc.includes(flag));
  out.connectDay.rollbackNamed = /flag-off rollback|flag back to 0|flag back to OFF/i.test(connectDoc);
  out.connectDay.noLiveConnectionStated = /no live connection/i.test(connectDoc);
  if (out.connectDay.flagsNamed.length !== 3) problems.push(`connect-day doc names ${out.connectDay.flagsNamed.length}/3 per-route flags`);
  if (!out.connectDay.rollbackNamed) problems.push("connect-day doc does not state the flag-off rollback");
  if (!out.connectDay.noLiveConnectionStated) problems.push("connect-day doc does not state that no live connection exists");
}

out.secretShapes = secretHits;
if (secretHits.length) problems.push(`a response carried a credential shape: ${secretHits.join(",")}`);

// ---------------------------------------------------------------- verdict
out.counts = {
  routes: 3,
  testedRoutes: 3,
  negativeControls: Object.keys(out.http.negative || {}).length,
  contractTestsPass: testPass,
  contractTestsFail: testFail,
  flagRollbacksProved: out.flags.rollback.status === 201,
  liveConnections: 0,
};

done("P2C-GUIDE", problems.length === 0,
  problems.length
    ? problems.join("; ")
    : `standalone guide-source-draft service (standalone/guide-draft-service, HEAD ${out.head.slice(0, 7)}): ${testPass}/${testPass + testFail} contract tests via the CI command, 11 fields+contract id+QA prefix match src/lib/bridge-store.ts (no drift), real HTTP 3/3 routes on mock-guide-draft@1: create 201 -> read -> restart -> QA purge 200 -> 404, ${out.counts.negativeControls}/${out.counts.negativeControls} refusals, live URL exit 2, per-route flag ON -> 501 only that route, back to 0 -> 201`,
  out);
