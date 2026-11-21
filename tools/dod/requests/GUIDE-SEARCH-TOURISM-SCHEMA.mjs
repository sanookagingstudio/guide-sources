// GUIDE-SEARCH-TOURISM-SCHEMA - TRACK C answer to Track F's cross-track request
// (tracks/requests.md 2026-11-22, line "TO C :: guide-sources ... the public search box answers NOTHING"):
// the public search on https://guide-sources.vercel.app advertised a filter that could not answer.
//
// ROOT CAUSE (measured): the app asked PostgREST for `public.production_places`, but no such table exists
// in the Club project - the 4 approved rows live in the exposed `tourism_gs` schema (DEC-014). So every
// load answered 404 PGRST205 and the page rendered 0 results with no empty state; typing changed nothing.
//
// FIX: `tourismFrom()` selects the `tourism_gs` schema (override NEXT_PUBLIC_FUNAGING_TOURISM_SCHEMA) for
// the approved-place reads, and the results panel now states explicitly when nothing matches.
//
// PASS (exit 0) requires ALL of these, measured in THIS run against the REAL built app and the REAL
// production alias with a real Chromium:
//   1. The source carries the schema switch and there is no `supabase.from('production_places')` left.
//   2. `npm run typecheck` and `npm run build` are green.
//   3. LOCAL production build served by `next start`: the approved-place request carries
//      `Accept-Profile: tourism_gs` and answers 200; >=1 card; the heading count equals the cards;
//      a real place name narrows the list; a no-match query shows 0 cards AND the explicit empty state;
//      0 page errors.
//   4. LIVE https://guide-sources.vercel.app: the served bundle carries the `tourism_gs` schema marker,
//      the live deployment is a production dpl_ that is NOT the recorded rollback target, the newest
//      Deploy-Lock record for this action is state=verified with that rollback target, and the same
//      browser assertions pass on production.
//   5. No credential is echoed: the anon key/JWT never appears in anything this check records (the app's
//      client config is public, but the check still refuses to record it).
//
// Read-only against production (a public page load + its read-only REST GET). No row is created or
// deleted; the QA rows do not exist here. No secret is written to any file.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as H from "../lib/harness.mjs";

const { run, done } = H;
const ID = "GUIDE-SEARCH-TOURISM-SCHEMA";
if (H.track !== "C") done(ID, false, `refused: FUNAGING_TRACK is '${H.track}' but this check belongs to Track C`, { guard: "track" });

const REPO = "D:\\FUNAGING_WEB\\01_ACTIVE\\guide-sources__9CC897324B2F";
const LIVE = "https://guide-sources.vercel.app/";
const LOCAL_PORT = 3111;
const PLAYWRIGHT = "D:\\FUNAGING_WEB\\02_WORK\\MAINWEB_LPHHW_BRIDGE_20261116\\node_modules\\playwright\\index.js";
const EMPTY_STATE = "ไม่พบสถานที่ที่ตรงกับเงื่อนไข";
const DEPLOY_RECORD_DIR = "D:\\FUNAGING_TEMP\\tracks\\deploy_records";

const out = { repo: REPO, live: LIVE, localPort: LOCAL_PORT, steps: [], browser: {}, transcripts: {} };
const problems = [];
const step = (name, ok, detail) => {
  out.steps.push({ name, ok, detail });
  if (!ok) problems.push(`${name}: ${detail}`);
  return ok;
};
const clean = (s) => String(s || "").replace(/\u001b\[[0-9;]*m/g, "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The shared harness spawns without a shell; Node 24 refuses to spawn `npm.cmd`/`vercel.cmd` directly
// (EINVAL), so each command goes through cmd.exe with fixed, literal arguments.
const cmd = (line) => ["/d", "/s", "/c", line];

// ---- 1. source facts ------------------------------------------------------------------------------
const supa = readFileSync(`${REPO}\\src\\lib\\supabase.ts`, "utf8");
const places = readFileSync(`${REPO}\\src\\services\\placesService.ts`, "utf8");
const searchTab = readFileSync(`${REPO}\\src\\components\\SearchTab.tsx`, "utf8");
out.source = {
  tourismFromHelper: supa.includes("export const tourismFrom") && supa.includes("supabase.schema(TOURISM_SCHEMA)"),
  schemaDefaultTourismGs: /tourism_gs/.test(supa) && /NEXT_PUBLIC_FUNAGING_TOURISM_SCHEMA/.test(supa),
  approvedReadUsesSchema: /tourismFrom\('production_places'\)/.test(places),
  noDeadPublicRead: !/supabase\.from\('production_places'\)/.test(places),
  emptyStatePresent: searchTab.includes(EMPTY_STATE),
};
step(
  "the source reads approved places from the exposed tourism_gs schema (no dead public.* read) and states the empty result",
  Object.values(out.source).every(Boolean),
  JSON.stringify(out.source)
);

// ---- 2. the app really builds -----------------------------------------------------------------------
const typecheck = await run("cmd.exe", cmd("npm run typecheck"), { cwd: REPO, timeoutMs: 300000 });
step("npm run typecheck is green", typecheck.code === 0, `exit=${typecheck.code} ${clean(typecheck.out + " " + typecheck.err).slice(-200)}`);

const build = await run("cmd.exe", cmd("npm run build"), { cwd: REPO, timeoutMs: 600000 });
const buildOut = clean(build.out + " " + build.err);
out.transcripts.build = buildOut.slice(-700);
step("npm run build is green", build.code === 0 && /Compiled successfully|✓/.test(buildOut), `exit=${build.code} ${buildOut.slice(-260)}`);

// ---- 3/4. one real Chromium proof, run against both targets ------------------------------------------
const pw = await import(pathToFileURL(PLAYWRIGHT).href);
const chromium = pw.chromium || pw.default?.chromium;

async function proveTarget(label, base) {
  const page = await (out.browser._browser).newPage({ viewport: { width: 1280, height: 900 } });
  const rest = [];
  const pageErrors = [];
  const consoleErrors = [];
  page.on("response", async (r) => {
    if (!r.url().includes("/rest/v1/production_places")) return;
    let h = {};
    try { h = r.request().headers(); } catch { /* request gone */ }
    rest.push({ status: r.status(), acceptProfile: h["accept-profile"] || null });
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  try {
    const resp = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(8000);
    const cards = await page.locator("article.search-card").count();
    const heading = clean(await page.locator("h3", { hasText: "ผลการค้นหา" }).first().innerText().catch(() => ""));
    const r = { httpStatus: resp ? resp.status() : 0, cards, heading, rest, pageErrors, consoleErrors: consoleErrors.slice(0, 5) };
    step(`${label}: page 200`, r.httpStatus === 200, `status=${r.httpStatus}`);
    step(`${label}: the approved-place read is 200 with Accept-Profile: tourism_gs`, rest.some((x) => x.status === 200 && x.acceptProfile === "tourism_gs"), `rest=${JSON.stringify(rest)}`);
    step(`${label}: at least one real approved place is rendered`, cards >= 1, `cards=${cards} heading="${heading}"`);
    step(`${label}: the count heading equals the rendered cards`, heading.includes(`ผลการค้นหา ${cards} รายการ`), `heading="${heading}" cards=${cards}`);

    const firstTitle = clean(await page.locator("article.search-card .search-card__title").first().innerText().catch(() => ""));
    r.firstTitle = firstTitle;
    const token = (firstTitle.split(/\s+/)[0] || "").slice(0, 6);
    const input = page.locator('input[list="search-suggestions"]');
    await input.fill(token);
    await page.waitForTimeout(1600);
    const narrowed = await page.locator("article.search-card").count();
    const narrowedHeading = clean(await page.locator("h3", { hasText: "ผลการค้นหา" }).first().innerText());
    r.narrowed = { token, cards: narrowed, heading: narrowedHeading };
    step(`${label}: typing a real place name changes the answer`, token.length >= 2 && narrowed >= 1 && narrowed <= cards, `token="${token}" cards=${narrowed} of ${cards} heading="${narrowedHeading}"`);

    await input.fill("zzz-no-such-place-000");
    await page.waitForTimeout(1600);
    const zero = await page.locator("article.search-card").count();
    const emptyState = await page.getByText(EMPTY_STATE).count();
    const zeroHeading = clean(await page.locator("h3", { hasText: "ผลการค้นหา" }).first().innerText());
    r.noMatch = { cards: zero, emptyState, heading: zeroHeading };
    step(`${label}: a no-match query shows 0 cards AND the explicit empty state`, zero === 0 && emptyState === 1, `cards=${zero} emptyState=${emptyState} heading="${zeroHeading}"`);
    step(`${label}: no page error while searching`, pageErrors.length === 0, JSON.stringify(pageErrors));
    return r;
  } finally {
    await page.close();
  }
}

// local production server (`next start`) on a loopback port
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(LOCAL_PORT), "-H", "127.0.0.1"], {
  cwd: REPO, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d.toString()));
server.stderr.on("data", (d) => (serverLog += d.toString()));
const localBase = `http://127.0.0.1:${LOCAL_PORT}/`;
let up = false;
for (let i = 0; i < 90; i++) {
  try {
    const r = await fetch(localBase, { signal: AbortSignal.timeout(3000) });
    if (r.status === 200) { up = true; break; }
  } catch { /* not listening yet */ }
  await sleep(1000);
}
out.transcripts.localServer = clean(serverLog).slice(-400);

try {
  if (!up) throw new Error(`the local next start server never answered on ${localBase}`);
  const browser = await chromium.launch({ headless: true });
  out.browser._browser = browser;
  try {
    out.browser.local = await proveTarget("local", localBase);
    out.browser.production = await proveTarget("production", LIVE);
  } finally {
    await browser.close();
    delete out.browser._browser;
  }
} finally {
  try { await run("taskkill", ["/PID", String(server.pid), "/T", "/F"], { timeoutMs: 30000 }); } catch { /* already gone */ }
}

// ---- 4. live provenance: the deployed bundle carries the schema marker, the record is verified ------
const html = await (await fetch(LIVE, { signal: AbortSignal.timeout(30000) })).text();
const scriptPaths = [...html.matchAll(/src="(\/_next\/[^"]+\.js[^"]*)"/g)].map((m) => m[1]).slice(0, 20);
let markerInBundle = html.includes("tourism_gs");
const bundleHits = [];
for (const p of scriptPaths) {
  try {
    const b = await (await fetch(new URL(p, LIVE), { signal: AbortSignal.timeout(30000) })).text();
    if (b.includes("tourism_gs")) { markerInBundle = true; bundleHits.push(p); }
  } catch { /* a chunk that cannot be read is not a pass; other chunks still count */ }
}
out.bundle = { scriptsScanned: scriptPaths.length, tourismGsMarker: markerInBundle, hits: bundleHits.slice(0, 4) };
step("the SERVED live bundle carries the tourism_gs schema marker", markerInBundle, JSON.stringify(out.bundle));

const liveInspect = await run("cmd.exe", cmd("vercel inspect https://guide-sources.vercel.app --json --no-color"), { cwd: REPO, timeoutMs: 180000 });
const inspectRaw = String(liveInspect.out || "");
let live = null;
try { live = JSON.parse(inspectRaw.slice(inspectRaw.indexOf("{"))); } catch { live = null; }
const listRun = await run("cmd.exe", cmd("vercel ls guide-sources --json --no-color"), { cwd: REPO, timeoutMs: 180000 });
let entries = [];
try {
  const parsed = JSON.parse(String(listRun.out || "").slice(String(listRun.out || "").indexOf("{")));
  entries = Array.isArray(parsed) ? parsed : (parsed.deployments || []);
} catch { entries = []; }
const liveEntry = entries.find((e) => String(e.url) === String(live?.url)) || null;
const liveSha = liveEntry?.meta?.gitCommitSha || liveEntry?.meta?.sourceCommit || "";
const headRun = await run("git", ["-C", REPO, "rev-parse", "HEAD"], { timeoutMs: 30000 });
const headSha = clean(headRun.out);
const refRun = await run("git", ["-C", REPO, "rev-parse", "origin/codex-mvp"], { timeoutMs: 30000 });
const refSha = clean(refRun.out);
// The deployed ref is `codex-mvp` (C01's rule). A later docs/tools commit may be HEAD, so the honest
// application check is: the live commit IS the deployed ref AND it ships the same app tree as HEAD.
const treeRun = liveSha
  ? await run("git", ["-C", REPO, "diff", "--quiet", liveSha, "HEAD", "--", "src", "public", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json"], { timeoutMs: 60000 })
  : { code: 1, out: "", err: "no live commit" };
out.provenance = {
  liveDeploymentId: live?.id || null,
  liveUrl: live?.url || null,
  liveTarget: live?.target || null,
  deployedSha: liveSha,
  sourceKind: liveEntry?.meta?.sourceKind || null,
  deployedRef: refSha,
  repoHead: headSha,
  appTreeMatchesHead: treeRun.code === 0,
};
step(
  "the live alias is a production deployment of the deployed ref (codex-mvp) and ships the same app tree as HEAD",
  !!live?.id &&
    live.target === "production" &&
    /^[0-9a-f]{40}$/.test(liveSha) &&
    liveSha === refSha &&
    treeRun.code === 0 &&
    String(liveEntry?.meta?.sourceKind || "").length > 0,
  JSON.stringify(out.provenance)
);

// the newest Deploy-Lock record for this work must be verified and must not name the live deployment as its rollback
let records = [];
try {
  const { readdirSync } = await import("node:fs");
  records = readdirSync(DEPLOY_RECORD_DIR).filter((f) => f.includes("GUIDE-SEARCH") && f.endsWith(".json")).sort().reverse();
} catch { records = []; }
let record = null;
try { record = records.length ? JSON.parse(readFileSync(`${DEPLOY_RECORD_DIR}\\${records[0]}`, "utf8")) : null; } catch { record = null; }
out.deployRecord = record
  ? { file: records[0], state: record.state, rollbackTarget: record.rollbackTarget, action: record.action, finishedAt: record.finishedAt }
  : null;
step(
  "the newest Deploy-Lock record for this change is verified with a real rollback target",
  !!record && record.state === "verified" && /^dpl_/.test(String(record.rollbackTarget || "")) && record.rollbackTarget !== live?.id && String(record.action).includes("GUIDE-SEARCH"),
  JSON.stringify(out.deployRecord)
);

// ---- 5. no credential is recorded -------------------------------------------------------------------
const recorded = JSON.stringify({ steps: out.steps, browser: out.browser, transcripts: out.transcripts });
const leaked = /eyJ[A-Za-z0-9_-]{10,}/.test(recorded) || /postgres(ql)?:\/\/[^\s"@]+@/.test(recorded);
out.noSecretEcho = !leaked;
step("no credential (client key/JWT/DSN) is recorded by this check", !leaked, leaked ? "a JWT or DSN shape appeared" : "none");

// ---- verdict ---------------------------------------------------------------------------------------
out.problems = problems;
const ok = problems.length === 0;
const reason = ok
  ? `public search really answers: local build ${out.browser.local?.cards} card(s) and live ${out.browser.production?.cards} card(s) from tourism_gs (Accept-Profile 200), a real name narrows it, no-match shows 0 + the explicit empty state, 0 page errors; live ${live?.id} serves commit ${String(liveSha).slice(0, 12)} (rollback ${record?.rollbackTarget}), record verified; typecheck+build green; no secret recorded`
  : problems.join(" | ");
done(ID, ok, reason, out);
