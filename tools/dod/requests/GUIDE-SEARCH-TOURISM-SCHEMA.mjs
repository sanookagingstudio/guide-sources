// GUIDE-SEARCH-TOURISM-SCHEMA - TRACK C answer to Track F's cross-track request
// (tracks/requests.md: line "TO C :: guide-sources (public search) :: the dead public search" and its 2026-11-22
// follow-up "the SEARCH IS STILL DEAD on production").
//
// HISTORY: the first round fixed a REAL defect (the app asked PostgREST for `public.production_places`, which does
// not exist; the 4 approved rows live in the exposed `tourism_gs` schema of the Club project, DEC-014) and added
// the explicit empty state. That check had a HOLE: it accepted `narrowed <= cards`, so a filter that changes
// nothing (4 cards before -> 4 cards after typing) still PASSed. Track F was right that the closure did not
// assert a filter ANSWER; this repair closes the hole.
//
// PASS (exit 0) requires ALL of these, measured in THIS run against the REAL built app and the REAL production
// alias with a real Chromium:
//   1. The source carries the schema switch, has no `supabase.from('production_places')` left, states the empty
//      result, and the keyword really is wired into the query pipeline (controlled input -> filters -> fetch and
//      -> applyLocalFilters). A dead filter cannot pass on source.
//   2. `npm run typecheck` and `npm run build` are green.
//   3. LOCAL production build served by `next start` AND LIVE https://guide-sources.vercel.app, each:
//      - the approved-place read is 200 with `Accept-Profile: tourism_gs` and >=1 real card renders,
//      - the count heading equals the rendered cards,
//      - typing a real place's own name (char by char) fires new reads and NARROWS the list to >0 and < the
//        initial count, every remaining card's text contains the token, and the chosen place is still shown,
//      - the SAME probe repeated twice returns the identical title list (no stale-response flake),
//      - a token that appears in no card shows 0 cards AND the explicit empty state,
//      - 0 page errors.
//   4. LIVE provenance: the served bundle carries the tourism_gs marker, the alias is a production dpl_ that is
//      NOT the rollback target of the newest verified Deploy-Lock record for this work, and the live commit IS
//      the deployed ref (`origin/codex-mvp`) shipping the same app tree as HEAD.
//   5. No credential is echoed: the anon key/JWT never appears in anything this check records.
//
// Read-only against production (public page loads + their read-only REST GETs). No row is created or deleted. No
// secret is written to any file.
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
const NO_MATCH = "zzz-no-such-place-000";
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
const cmd = (line) => ["/d", "/s", "/c", line];
const squash = (s) => String(s || "").replace(/\s+/g, " ");

// ---- 1. source facts ------------------------------------------------------------------------------
const supa = readFileSync(`${REPO}\\src\\lib\\supabase.ts`, "utf8");
const places = readFileSync(`${REPO}\\src\\services\\placesService.ts`, "utf8");
const searchTab = readFileSync(`${REPO}\\src\\components\\SearchTab.tsx`, "utf8");
const searchTabFlat = squash(searchTab);
const placesFlat = squash(places);
out.source = {
  tourismFromHelper: supa.includes("export const tourismFrom") && supa.includes("supabase.schema(TOURISM_SCHEMA)"),
  schemaDefaultTourismGs: /tourism_gs/.test(supa) && /NEXT_PUBLIC_FUNAGING_TOURISM_SCHEMA/.test(supa),
  approvedReadUsesSchema: /tourismFrom\('production_places'\)/.test(places),
  noDeadPublicRead: !/supabase\.from\('production_places'\)/.test(places),
  emptyStatePresent: searchTab.includes(EMPTY_STATE),
  // the keyword must REACH the answer: controlled value <- state, onChange -> state, state -> query, and the
  // remote rows must pass through the keyword filter.
  keywordControlled: /value=\{filters\.keyword\}/.test(searchTabFlat),
  keywordOnChange: /onChange=\{\(e\) => setFilters\(\{ ?\.\.\.filters, ?keyword: e\.target\.value ?\}\)\}/.test(searchTabFlat),
  keywordInQuery: /listApprovedPlaces\(\{ ?keyword: filters\.keyword/.test(searchTabFlat),
  remoteRowsFiltered: /applyLocalFilters\(\(data \|\| \[\]\) as PlaceRecord\[\], filters\)/.test(placesFlat),
  haystackIncludesKeyword: /const keyword = text\(filters\.keyword\)\.toLowerCase\(\)/.test(placesFlat) && /haystack\.includes\(keyword\)/.test(placesFlat),
};
step(
  "the source reads approved places from tourism_gs and the keyword really reaches the answer (controlled input -> query -> applyLocalFilters)",
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

const cardTexts = async (page) => page.locator("article.search-card").allInnerTexts().catch(() => []);
const cardTitles = async (page) => (await page.locator("article.search-card .search-card__title").allInnerTexts().catch(() => [])).map(clean);
const headingText = async (page) => clean(await page.locator("h3", { hasText: "ผลการค้นหา" }).first().innerText().catch(() => ""));

async function waitForCards(page, min, ms) {
  const until = Date.now() + ms;
  let n = 0;
  while (Date.now() < until) {
    n = await page.locator("article.search-card").count();
    if (n >= min) return n;
    await page.waitForTimeout(400);
  }
  return n;
}

async function waitForCountBelow(page, below, ms) {
  const until = Date.now() + ms;
  let n = below;
  while (Date.now() < until) {
    n = await page.locator("article.search-card").count();
    if (n < below) return n;
    await page.waitForTimeout(300);
  }
  return n;
}

async function proveTarget(label, base, browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const rest = [];
  const pageErrors = [];
  page.on("response", async (r) => {
    if (!r.url().includes("/rest/v1/production_places")) return;
    let h = {};
    try { h = r.request().headers(); } catch { /* request gone */ }
    rest.push({ status: r.status(), acceptProfile: h["accept-profile"] || null });
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  try {
    const resp = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
    const initial = await waitForCards(page, 1, 60000);
    const before = {
      httpStatus: resp ? resp.status() : 0,
      cards: initial,
      heading: await headingText(page),
      titles: await cardTitles(page),
      texts: (await cardTexts(page)).map((t) => t.toLowerCase()),
      reads: rest.length,
    };
    const r = { ...before, rest: rest.slice(0, 8) };
    step(`${label}: page 200`, before.httpStatus === 200, `status=${before.httpStatus}`);
    step(`${label}: the approved-place read is 200 with Accept-Profile: tourism_gs`,
      rest.some((x) => x.status === 200 && x.acceptProfile === "tourism_gs"), `reads=${rest.length} ${JSON.stringify(rest.slice(0, 4))}`);
    step(`${label}: at least one real approved place is rendered`, before.cards >= 1, `cards=${before.cards} heading="${before.heading}"`);
    step(`${label}: the count heading equals the rendered cards`,
      before.heading === `ผลการค้นหา ${before.cards} รายการ`, `heading="${before.heading}" cards=${before.cards}`);

    // pick a token that is a WHOLE unique title, so its own place must survive the filter
    const counts = new Map();
    for (const t of before.titles) counts.set(t, (counts.get(t) || 0) + 1);
    const token = before.titles.find((t) => t.length >= 4 && counts.get(t) === 1 && !NO_MATCH.includes(t)) || "";
    r.token = token;
    step(`${label}: the rendered data carries a distinct place name to search for`, token.length >= 4, `titles=${JSON.stringify(before.titles)}`);

    const input = page.locator('input[list="search-suggestions"]');
    const runs = [];
    if (token) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await input.fill("");
        await page.waitForTimeout(700);
        const readsBefore = rest.length;
        await input.click();
        await input.pressSequentially(token, { delay: attempt === 2 ? 0 : 70 }); // attempt 3 = fastest typing
        const narrowed = await waitForCountBelow(page, before.cards, 20000);
        await page.waitForTimeout(1200);
        const cards = await page.locator("article.search-card").count();
        const heading = await headingText(page);
        const titles = await cardTitles(page);
        const texts = (await cardTexts(page)).map((t) => t.toLowerCase());
        runs.push({ attempt: attempt + 1, delayMs: attempt === 2 ? 0 : 70, readsFired: rest.length - readsBefore, cards, heading, titles, allContainToken: texts.every((t) => t.includes(token.toLowerCase())) });
        r[`run${attempt + 1}`] = runs[runs.length - 1];
        step(`${label} try${attempt + 1}: typing "${token}" fires new reads and NARROWS the answer`,
          runs[runs.length - 1].readsFired >= 1 && cards >= 1 && cards < before.cards,
          `readsFired=${runs[runs.length - 1].readsFired} cards=${cards} of ${before.cards} heading="${heading}"`);
        step(`${label} try${attempt + 1}: every remaining card really matches the typed token and the searched place is shown`,
          runs[runs.length - 1].allContainToken && titles.includes(token),
          `titles=${JSON.stringify(titles)}`);
      }
      r.deterministic = runs.every((x) => JSON.stringify(x.titles) === JSON.stringify(runs[0].titles));
      step(`${label}: the identical typed query returns the identical answer 3/3 (no stale-response flake)`,
        r.deterministic, JSON.stringify(runs.map((x) => x.titles)));

      const noMatchAbsent = before.texts.every((t) => !t.includes(NO_MATCH));
      await input.fill(NO_MATCH);
      await sleep(1800);
      const zero = await page.locator("article.search-card").count();
      const emptyState = await page.getByText(EMPTY_STATE).count();
      const zeroHeading = await headingText(page);
      r.noMatch = { tokenAbsentBefore: noMatchAbsent, cards: zero, emptyState, heading: zeroHeading };
      step(`${label}: a token that matches nothing shows 0 cards AND the explicit empty state`,
        noMatchAbsent && zero === 0 && emptyState === 1 && zeroHeading.includes("0"),
        JSON.stringify(r.noMatch));
    }
    step(`${label}: no page error while searching`, pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
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
  try {
    out.browser.local = await proveTarget("local", localBase, browser);
    out.browser.production = await proveTarget("production", LIVE, browser);
  } finally {
    await browser.close();
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
const local = out.browser.local || {};
const prod = out.browser.production || {};
const reason = ok
  ? `public search really answers: local build ${local.cards} card(s) -> "${local.token}" narrows to ${local.run1?.cards} (3/3 identical), no-match 0 + the explicit empty state; live ${prod.cards} card(s) -> "${prod.token}" narrows to ${prod.run1?.cards} (3/3 identical), no-match 0 + empty state; live ${live?.id} serves commit ${String(liveSha).slice(0, 12)} (rollback ${record?.rollbackTarget}), record verified; typecheck+build green; 0 page errors; no secret recorded`
  : problems.join(" | ");
done(ID, ok, reason, out);
