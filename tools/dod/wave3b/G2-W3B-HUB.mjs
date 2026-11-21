#!/usr/bin/env node
// G2-W3B-HUB - Every-button DoD for the Funaging Omnichannel Engagement Hub operator UI (Monitor Center).
//
// The item is PASS only when, against the REAL hub built from this source tree and served through the REAL
// request path (`createRuntime` + `handleNodeRequest`, production posture: HUB_ENV=production, file store,
// operator ticket gate), on 127.0.0.1:
//   1. route inventory   - every operator-UI document path the dispatcher serves ("/" and "/monitor") answers
//                          200 text/html with a non-empty body, the same bytes and the real page title;
//                          12 screens are declared (NAV) and each is reachable from the nav;
//   2. auth posture      - anonymous "/" answers 401 (as RUNBOOK documents), a forged ticket is refused, and a
//                          ticket minted by the real operator-ticket module gets a HttpOnly session cookie that
//                          opens the UI (200) - so the swept UI is the one production actually serves;
//   3. control census    - every control (button / role=button / input / link) on every screen is enumerated and
//                          recorded in the evidence file;
//   4. click-effect      - every enabled button-like control is really clicked and must produce an observable
//                          effect (URL, DOM text/size, dialog, control state, network or a rendered answer);
//                          every Inbox filter must ANSWER: either data rows or an explicit "no conversations"
//                          message naming the filter, plus exactly one active chip;
//   5. component+handler - every rendered button is attributed to a static key derived from src/monitor/ui-html.ts
//      keys                (NAV entry + nav handler binding, filter entry + chip handler binding) and that key
//                          must declare a real onclick handler (0 HOLLOW); the UI NAV must equal MONITOR_NAV in
//                          src/inbox.ts and every UI filter must be accepted by the server FILTERS set;
//   6. zero hollow/dead/console - 0 hollow controls, 0 dead controls, 0 dead links, 0 console errors, 0 page
//                          errors, 0 failed requests, 0 4xx/5xx responses on every screen;
//   7. honest failure    - when /api/snapshot is refused (session expired), the UI must say so in a banner
//                          instead of dying on an unhandled TypeError.
//
// Writes are local only: the hub's own dist/ (already gitignored), the file store under tracks\C\tmp and the run
// log. Nothing is uploaded, nothing is deployed, no token value is printed.
// Evidence: D:\FUNAGING_TEMP\tracks\<track>\evidence\dod\G2-W3B-HUB_latest.json
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromePath, done, repoRoot } from "../lib/harness.mjs";

const ID = process.env.DOD_W3B_SELFTEST ? "G2-W3B-HUB_SELFTEST" : "G2-W3B-HUB";
const WORK = path.join("D:\\FUNAGING_TEMP\\tracks\\C\\tmp", "w3b_hub");
const DEFAULT_HUB = "D:\\FUNAGING_WEB\\01_ACTIVE\\sanook-master-v2__8402E8309ACC\\funaging-omnichannel-engagement-hub";

function isHub(dir) {
  try {
    const p = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    return String(p.name || "").includes("omnichannel-engagement-hub");
  } catch {
    return false;
  }
}

const HUB_ROOT = process.env.DOD_HUB_ROOT || [repoRoot, DEFAULT_HUB].find(isHub) || "";
const DIST = path.join(HUB_ROOT, "dist");
const UI_TS = path.join(HUB_ROOT, "src", "monitor", "ui-html.ts");
const INBOX_TS = path.join(HUB_ROOT, "src", "inbox.ts");
const HTTP_TS = path.join(HUB_ROOT, "src", "runtime", "http.ts");
const STORE_DIR = path.join(WORK, "store");
const sleeps = (ms) => new Promise((r) => setTimeout(r, ms));

const result = {
  id: ID,
  repo: HUB_ROOT,
  work: WORK,
  startedAt: new Date().toISOString(),
  build: null,
  inventory: null,
  auth: null,
  apiContract: null,
  documents: [],
  screens: [],
  controls: [],
  hollow: [],
  dead: [],
  orphanKeys: [],
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  httpErrors: [],
  errorPath: null,
  failClosed: null,
  steps: [],
};

let server = null;
const log = (m) => {
  result.steps.push({ at: new Date().toISOString(), msg: m });
  console.log(`[w3b-hub] ${m}`);
};

function fail(reason, extra = {}) {
  if (server) server.close();
  done(ID, false, reason, { ...result, ...extra, finishedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------- static source analysis

// Depth-aware array literal reader: finds `const NAME =` then the first "[" and its matching "]".
function arrayLiteral(src, name) {
  const head = new RegExp(`const\\s+${name}\\s*=`).exec(src);
  if (!head) return null;
  const open = src.indexOf("[", head.index);
  if (open === -1) return null;
  let depth = 0;
  let quote = "";
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote && src[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const body = src.slice(open + 1, i);
        return [...body.matchAll(/"([^"\\]*)"/g)].map((m) => m[1]);
      }
    }
  }
  return null;
}

function expectedTitles(src) {
  const out = {};
  // if (view === "X") { ... "<h2>Title</h2>" ... } - the block runs until the next view branch
  const marks = [...src.matchAll(/if\s*\(\s*view\s*===\s*"([^"]+)"\s*\)/g)];
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
    const h2 = /<h2>([^<]*)<\/h2>/.exec(src.slice(start, end));
    if (h2) out[marks[i][1]] = h2[1];
  }
  return out;
}

function buildInventory() {
  const ui = readFileSync(UI_TS, "utf8");
  const inboxSrc = readFileSync(INBOX_TS, "utf8");
  const httpSrc = readFileSync(HTTP_TS, "utf8");
  const nav = arrayLiteral(ui, "NAV") || [];
  const filters = arrayLiteral(ui, "filters") || [];
  const monitorNav = arrayLiteral(inboxSrc, "MONITOR_NAV") || [];
  const serverFilters = arrayLiteral(httpSrc, "FILTERS") || [];
  const titles = expectedTitles(ui);

  const navBound = /querySelectorAll\("nav button"\)\s*\.forEach\([^)]*=>\s*\{?[^}]*b\.onclick/.test(ui);
  const chipBound = /querySelectorAll\("\.chip"\)\s*\.forEach\([^)]*=>\s*\{?[^}]*c\.onclick/.test(ui);
  const chipFetch = /fetch\("\/api\/inbox\?filter="\s*\+/.test(ui);
  const snapshotFetch = /fetch\("\/api\/snapshot"\)/.test(ui);
  // the handler bound to nav buttons must actually change the view and re-render
  const navHandlerBody = /b\.onclick\s*=\s*\(\)\s*=>\s*\{([^}]*)\}/.exec(ui);
  const navHandlerReal = Boolean(navHandlerBody && /view\s*=/.test(navHandlerBody[1]) && /render\(\)/.test(navHandlerBody[1]));

  const staticKeys = [
    ...nav.map((n) => ({
      key: `renderNav#${n}`,
      kind: "nav",
      label: n,
      handler: navHandlerReal ? "b.onclick = () => { view = data-view; render(); }" : "",
      hasHandler: navBound && navHandlerReal,
    })),
    ...filters.map((f) => ({
      key: `inboxFilter#${f}`,
      kind: "chip",
      label: f,
      handler: chipBound && chipFetch ? "c.onclick = async () => { fetch('/api/inbox?filter=' + data-f); render list }" : "",
      hasHandler: chipBound && chipFetch,
    })),
  ];

  const titleMap = {};
  for (const n of nav) titleMap[n] = titles[n] || n;

  return { ui, nav, filters, monitorNav, serverFilters, titles: titleMap, staticKeys, navBound, chipBound, chipFetch, snapshotFetch };
}

// ---------------------------------------------------------------- server (real dispatch path)

let hub = null; // { cfg, runtime, token, cookie, base }

async function startHub() {
  const load = (p) => import(pathToFileURL(path.join(DIST, p)).href);
  const { loadHubRuntimeConfig } = await load("src/runtime/config.js");
  const { createRuntime, handleNodeRequest } = await load("src/runtime/http.js");
  const { mintOperatorTicket, OPERATOR_COOKIE } = await load("src/runtime/operator-ticket.js");

  rmSync(STORE_DIR, { recursive: true, force: true });
  mkdirSync(STORE_DIR, { recursive: true });
  // generated locally, never printed: only the length + fingerprint8 reach the evidence
  const token = randomBytes(32).toString("hex");
  const cfg = loadHubRuntimeConfig({
    HUB_ENV: "production",
    HUB_STORE: "file",
    HUB_FILE_STORE_DIR: STORE_DIR,
    HUB_INGEST_TOKEN: token,
    HUB_PORT: "8799",
  });
  if (!cfg.ok) throw new Error(`config refused: ${cfg.error}`);
  const runtime = await createRuntime(cfg.value);
  if (runtime.readyError) throw new Error(`runtime not ready: ${runtime.readyError}`);
  const srv = createServer((req, res) => {
    void handleNodeRequest(req, res, runtime, cfg.value);
  });
  await new Promise((resolve, reject) => {
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", resolve);
  });
  server = srv;
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;

  const mint = (ttl) => mintOperatorTicket(cfg.value.ingestToken, ttl);
  const ticket = mint(8 * 60 * 60 * 1000);
  const enter = await fetch(`${base}/api/operator-enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket }),
    redirect: "manual",
  });
  const setCookie = enter.headers.get("set-cookie") || "";
  const cookiePair = setCookie.split(";")[0];
  if (!cookiePair.startsWith(`${OPERATOR_COOKIE}=`)) throw new Error("operator-enter did not set the session cookie");
  hub = {
    base,
    cfg: cfg.value,
    cookieName: OPERATOR_COOKIE,
    cookie: cookiePair.slice(OPERATOR_COOKIE.length + 1),
    cookieSecure: /;\s*Secure/i.test(setCookie),
    cookieHttpOnly: /;\s*HttpOnly/i.test(setCookie),
    enterStatus: enter.status,
    mint,
    tokenLen: String(cfg.value.ingestToken).length,
  };
  return hub;
}

// fingerprint8 of a generated token is not a secret (it is the first 8 hex chars, as other C checks record);
// keep it only for the evidence line, never the value.
function fp8(v) {
  return String(v).slice(0, 8);
}

// ---------------------------------------------------------------- browser helpers

const snapshot = (page) =>
  page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText,
    // the sweep's own bookkeeping attributes must never count as a product effect
    html: document.body.innerHTML.replace(/ data-dod-(?:idx|clicked)="[^"]*"/g, "").length,
    dialogs: document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]').length,
    states: [...document.querySelectorAll('button, [role="button"], input, select, textarea')]
      .map((el) => `${el.getAttribute("aria-pressed") || ""}${el.getAttribute("aria-expanded") || ""}${el.hasAttribute("disabled") ? "D" : ""}${el.className}${el.value || ""}`)
      .join("|"),
  }));

async function settle(page, maxMs = 2500) {
  let prev = await snapshot(page);
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleeps(150);
    const now = await snapshot(page);
    if (now.text === prev.text && now.html === prev.html && now.states === prev.states) return;
    prev = now;
  }
}

function effectOf(before, after, requests) {
  const effects = [];
  if (before.url !== after.url) effects.push("url");
  if (before.text !== after.text) effects.push("text");
  if (before.html !== after.html) effects.push("dom");
  if (before.dialogs !== after.dialogs) effects.push("dialog");
  if (before.states !== after.states) effects.push("state");
  if (requests > 0) effects.push("network");
  return effects;
}

async function census(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
      return el.getClientRects().length > 0;
    };
    const nodes = [...document.querySelectorAll('button, [role="button"], input, textarea, select, a[href]')];
    nodes.forEach((el, index) => el.setAttribute("data-dod-idx", String(index)));
    return nodes.map((el, index) => {
      const tag = el.tagName.toLowerCase();
      const label =
        norm(el.getAttribute("aria-label")) ||
        norm(el.innerText) ||
        norm(el.getAttribute("value")) ||
        norm(el.getAttribute("title")) ||
        norm(el.getAttribute("placeholder")) ||
        norm(el.getAttribute("href")) ||
        "";
      return {
        index,
        tag,
        type: el.getAttribute("type") || "",
        role: el.getAttribute("role") || "",
        label,
        href: el.getAttribute("href"),
        inNav: Boolean(el.closest("nav")),
        className: el.className || "",
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
        visible: visible(el),
        value: typeof el.value === "string" ? el.value : null,
      };
    });
  });
}

const BUTTON_SEL = 'button, [role="button"], input[type="submit"], input[type="button"]';

async function clickByLabel(page, label, inNav) {
  const handle = await page.evaluateHandle(
    ({ label, inNav, sel }) => {
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
      const target = norm(label).toLowerCase();
      for (const el of document.querySelectorAll(sel)) {
        const name = norm(el.getAttribute("aria-label") || el.innerText || el.getAttribute("value") || el.getAttribute("title") || "").toLowerCase();
        if (name !== target) continue;
        if (inNav !== undefined && Boolean(el.closest("nav")) !== inNav) continue;
        if (el.hasAttribute("data-dod-clicked")) continue;
        el.setAttribute("data-dod-clicked", "1");
        return el;
      }
      return null;
    },
    { label, inNav, sel: BUTTON_SEL }
  );
  const el = handle.asElement();
  if (!el) return false;
  try {
    await el.click({ timeout: 5000 });
  } catch {
    await el.evaluate((e) => e.click());
  }
  return true;
}

function attachListeners(page, scope, bucket) {
  let requests = 0;
  const local = { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [], requests: () => requests };
  page.on("console", (msg) => {
    if (msg.type() === "error") local.consoleErrors.push({ scope, text: msg.text(), url: (msg.location() || {}).url || "" });
  });
  page.on("pageerror", (e) => local.pageErrors.push({ scope, text: String(e) }));
  page.on("request", (req) => {
    if (["fetch", "xhr"].includes(req.resourceType())) requests += 1;
  });
  page.on("requestfailed", (req) => {
    const failure = (req.failure() || {}).errorText || "";
    if (failure !== "net::ERR_ABORTED") local.requestFailures.push({ scope, url: req.url(), failure });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) local.httpErrors.push({ scope, status: res.status(), url: res.url() });
  });
  return local;
}

// ---------------------------------------------------------------- main

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  log(`repo ${HUB_ROOT || "(not found)"}`);
  if (!HUB_ROOT) return fail("harmonic prerequisite: the omnichannel-engagement-hub checkout could not be found", {});
  for (const need of [UI_TS, INBOX_TS, HTTP_TS, path.join(HUB_ROOT, "package.json"), path.join(HUB_ROOT, "tsconfig.json")]) {
    if (!existsSync(need)) return fail(`missing prerequisite ${need}`, {});
  }

  // ---- 1. build the REAL hub from source (tsc, type-checked)
  const build = await new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      cwd: HUB_ROOT,
      shell: process.platform === "win32",
      env: { ...process.env },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* gone */
      }
    }, 600000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
  writeFileSync(path.join(WORK, "build.log"), `${build.out}\n${build.err}`);
  result.build = { exit: build.code, tail: `${build.out}\n${build.err}`.slice(-1200) };
  if (build.code !== 0) return fail(`real build failed (exit ${build.code})`, {});
  const httpJs = path.join(DIST, "src", "runtime", "http.js");
  if (!existsSync(httpJs)) return fail(`build produced no ${httpJs}`, {});
  result.build.distHttpBytes = statSync(httpJs).size;
  log(`build ok (dist/src/runtime/http.js ${result.build.distHttpBytes} B)`);

  // ---- 2. static inventory: screens, filters, handlers, drift against the server
  const inv = buildInventory();
  result.inventory = {
    nav: inv.nav,
    titles: inv.titles,
    filters: inv.filters,
    monitorNav: inv.monitorNav,
    serverFilters: inv.serverFilters,
    navHandlerBound: inv.navBound,
    chipHandlerBound: inv.chipBound,
    chipFetchPresent: inv.chipFetch,
    snapshotFetchPresent: inv.snapshotFetch,
    staticKeys: inv.staticKeys.map((k) => ({ key: k.key, kind: k.kind, handler: k.handler, hasHandler: k.hasHandler })),
  };
  if (!inv.nav.length) return fail("no NAV screen list could be read from src/monitor/ui-html.ts", {});
  if (!inv.filters.length) return fail("no Inbox filter list could be read from src/monitor/ui-html.ts", {});
  const navDrift = inv.nav.filter((n) => !inv.monitorNav.includes(n)).concat(inv.monitorNav.filter((n) => !inv.nav.includes(n)));
  const filterDrift = inv.filters.filter((f) => !inv.serverFilters.includes(f));
  const handlerlessKeys = inv.staticKeys.filter((k) => !k.hasHandler);
  if (navDrift.length) result.hollow.push({ kind: "nav-drift-vs-MONITOR_NAV", entries: navDrift });
  if (filterDrift.length) result.hollow.push({ kind: "inbox-filter-not-accepted-by-server", entries: filterDrift });
  if (handlerlessKeys.length) result.hollow.push(...handlerlessKeys.map((k) => ({ kind: "static-control-without-handler", key: k.key })));
  log(`inventory: ${inv.nav.length} screens, ${inv.filters.length} inbox filters, ${inv.staticKeys.length} static keys, drift ${navDrift.length + filterDrift.length}`);

  // ---- 3. start the real hub in production posture and prove the operator auth gate
  try {
    await startHub();
  } catch (e) {
    return fail(`the real hub could not be started: ${String(e).slice(0, 200)}`, {});
  }
  const { base, mint, cookieName, cookie, cookieSecure, cookieHttpOnly, enterStatus, tokenLen } = hub;
  log(`hub listening on ${base} (env=production store=file token len=${tokenLen} fp8=${fp8(hub.cfg.ingestToken)})`);

  const raw = async (p, opts) => {
    const r = await fetch(`${base}${p}`, opts);
    const body = await r.text();
    return { status: r.status, body, headers: Object.fromEntries(r.headers.entries()) };
  };
  const withCookie = { cookie: `${cookieName}=${cookie}` };
  const auth = { anon: {}, forged: {}, minted: {}, authed: {}, cookieHttpOnly, cookieSecure, enterStatus, tokenLen, tokenFp8: fp8(hub.cfg.ingestToken) };
  auth.anon.root = await raw("/");
  auth.anon.monitor = await raw("/monitor");
  auth.anon.snapshot = await raw("/api/snapshot");
  const forged = await raw("/api/operator-enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: "dod.not-a-real-ticket" }), redirect: "manual" });
  auth.forged.enter = { status: forged.status, body: forged.body.slice(0, 200) };
  const minted = await raw("/api/operator-enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: mint(60000) }), redirect: "manual" });
  auth.minted.enter = { status: minted.status, location: minted.headers.location || "", setCookie: (minted.headers["set-cookie"] || "").replace(/=[^;]+;/, "=[redacted];") };
  auth.authed.root = await raw("/", { headers: withCookie });
  auth.authed.monitor = await raw("/monitor", { headers: withCookie });
  auth.authed.snapshot = await raw("/api/snapshot", { headers: withCookie });
  result.auth = {
    ...auth,
    anon: Object.fromEntries(Object.entries(auth.anon).map(([k, v]) => [`${k}`, { status: v.status, bodyStart: v.body.slice(0, 120) }])),
    authed: Object.fromEntries(Object.entries(auth.authed).map(([k, v]) => [k, { status: v.status, bytes: v.body.length, title: (/<title>([^<]*)<\/title>/.exec(v.body) || [])[1] || "" }])),
  };
  const authProblems = [];
  for (const p of ["root", "monitor", "snapshot"]) if (auth.anon[p].status !== 401) authProblems.push(`anonymous ${p} answered ${auth.anon[p].status}, expected 401`);
  if (auth.forged.enter.status !== 401) authProblems.push(`forged ticket answered ${auth.forged.enter.status}, expected 401`);
  if (auth.minted.enter.status !== 303) authProblems.push(`minted ticket answered ${auth.minted.enter.status}, expected 303`);
  if (!cookieHttpOnly) authProblems.push("session cookie is not HttpOnly");
  if (auth.authed.root.status !== 200 || auth.authed.monitor.status !== 200) authProblems.push(`authenticated UI answered ${auth.authed.root.status}/${auth.authed.monitor.status}, expected 200`);
  if (auth.anon.root.body.length && !/UNAUTHORIZED/.test(auth.anon.root.body)) authProblems.push("anonymous 401 body does not name UNAUTHORIZED");
  log(`auth: anon ${auth.anon.root.status}/${auth.anon.monitor.status}/${auth.anon.snapshot.status}, forged ${auth.forged.enter.status}, minted ${auth.minted.enter.status}, authed ${auth.authed.root.status}/${auth.authed.monitor.status}, HttpOnly=${cookieHttpOnly} Secure=${cookieSecure}`);

  // ---- 4. the API payloads the UI renderer actually reads
  const snapBody = JSON.parse(auth.authed.snapshot.body);
  const requiredPlatformCells = ["MESSAGES", "COMMENTS", "PUBLISH", "ANALYTICS", "MODERATION"];
  const api = {
    snapshotStatus: auth.authed.snapshot.status,
    nav: Array.isArray(snapBody.nav) ? snapBody.nav.length : null,
    platforms: Array.isArray(snapBody.platforms) ? snapBody.platforms.length : null,
    inbox: Array.isArray(snapBody.inbox) ? snapBody.inbox.length : null,
    tasks: Array.isArray(snapBody.tasks) ? snapBody.tasks.length : null,
    matricesComplete: Array.isArray(snapBody.platforms)
      && snapBody.platforms.every((p) => p && p.matrix && requiredPlatformCells.every((c) => typeof p.matrix[c] === "string")),
    inboxFilters: {},
  };
  for (const f of inv.filters) {
    let r = await raw(`/api/inbox?filter=${encodeURIComponent(f)}`, { headers: withCookie });
    if (r.status === 429) {
      // the hub rate-limits at 20 req/s per ip; a paced read must not be refused
      await sleeps(1200);
      r = await raw(`/api/inbox?filter=${encodeURIComponent(f)}`, { headers: withCookie });
    }
    let n = null;
    let shapeOk = false;
    try {
      const rows = JSON.parse(r.body);
      n = Array.isArray(rows) ? rows.length : null;
      shapeOk = Array.isArray(rows) && rows.every((x) => x && x.conversation && typeof x.conversation.provider_id === "string" && typeof x.conversation.state === "string" && typeof x.reply_available === "boolean");
    } catch {
      /* recorded below */
    }
    api.inboxFilters[f] = { status: r.status, rows: n, shapeOk };
    await sleeps(90);
  }
  result.apiContract = api;
  const apiProblems = [];
  if (api.snapshotStatus !== 200) apiProblems.push(`/api/snapshot answered ${api.snapshotStatus}`);
  if (!Array.isArray(snapBody.nav)) apiProblems.push("/api/snapshot has no nav array");
  if (!api.matricesComplete) apiProblems.push("/api/snapshot platforms lack the capability matrix the Platforms screen prints");
  for (const [f, v] of Object.entries(api.inboxFilters)) {
    if (v.status !== 200 || v.rows === null || !v.shapeOk) apiProblems.push(`/api/inbox?filter=${f} answered ${v.status} rows=${v.rows} shapeOk=${v.shapeOk}`);
  }
  log(`api: snapshot ${api.snapshotStatus} platforms=${api.platforms} nav=${api.nav} inboxFilters=${Object.keys(api.inboxFilters).length}`);

  // ---- 5. browser: route inventory, every screen, every control
  const requireFrom = (dir) => createRequire(path.join(dir, "package.json"));
  const pwCandidates = [process.env.DOD_PLAYWRIGHT_ROOT, "D:\\FUNAGING_WEB\\01_ACTIVE\\funaging-field-app__2C9CF4FBE075", "D:\\MediaOS\\source"].filter(Boolean);
  let chromium = null;
  for (const c of pwCandidates) {
    try {
      ({ chromium } = requireFrom(c)("playwright"));
      log(`playwright from ${c}`);
      break;
    } catch {
      /* try the next */
    }
  }
  if (!chromium) {
    try {
      ({ chromium } = await import("playwright"));
      log("playwright from the check's own resolution");
    } catch (e) {
      return fail(`playwright is not installed anywhere this check can reach: ${String(e).slice(0, 200)}`, {});
    }
  }
  const launchOpts = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    if (!chromePath()) return fail(`chromium could not launch: ${String(e).slice(0, 200)}`, {});
    browser = await chromium.launch({ ...launchOpts, executablePath: chromePath() });
  }

  const cookieForBrowser = {
    name: cookieName,
    value: cookie,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    secure: false, // local run is http; the production header carries Secure (recorded above)
    sameSite: "Lax",
  };

  const documents = [];
  const screens = [];
  const runtimeButtons = [];
  try {
    // 5a. every operator-UI document path
    for (const p of ["/", "/monitor"]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addCookies([cookieForBrowser]);
      const page = await ctx.newPage();
      const l = attachListeners(page, `document ${p}`, result);
      const resp = await page.goto(`${base}${p}`, { waitUntil: "networkidle", timeout: 30000 });
      await sleeps(200);
      const title = await page.title();
      const body = (await page.locator("body").innerText().catch(() => "")).trim();
      const navCount = await page.locator("nav button").count();
      documents.push({ path: p, status: resp ? resp.status() : 0, title, bodyLength: body.length, navButtons: navCount });
      result.consoleErrors.push(...l.consoleErrors);
      result.pageErrors.push(...l.pageErrors);
      result.requestFailures.push(...l.requestFailures);
      result.httpErrors.push(...l.httpErrors);
      await ctx.close();
    }
    result.documents = documents;
    log(`documents: ${documents.map((d) => `${d.path} ${d.status} nav=${d.navButtons}`).join(", ")}`);

    // 5b. every screen: reach it from the nav, then click every control on it
    for (const screen of inv.nav) {
      const expectedTitle = inv.titles[screen];
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addCookies([cookieForBrowser]);
      const page = await ctx.newPage();
      const l = attachListeners(page, `screen ${screen}`, result);
      const rec = { screen, expectedTitle, title: "", navActive: "", reached: false, controls: 0, buttons: [], chips: [], errors: [] };
      try {
        await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 30000 });
        await settle(page);
        const clicked = await clickByLabel(page, screen, true);
        if (!clicked) rec.errors.push(`nav button "${screen}" not found`);
        await settle(page);
        const h2 = (await page.locator("main h2").first().innerText().catch(() => "")).trim();
        rec.title = h2;
        rec.navActive = (await page.evaluate(() => (document.querySelector("nav button.active") || {}).innerText || "")).trim();
        rec.reached = h2 === expectedTitle;
        if (!rec.reached) rec.errors.push(`screen title "${h2}" != expected "${expectedTitle}"`);
        if (rec.navActive !== screen) rec.errors.push(`nav active "${rec.navActive}" != "${screen}"`);

        if (process.env.DOD_W3B_SELFTEST === "dead") {
          await page.evaluate(() => {
            const b = document.createElement("button");
            b.type = "button";
            b.id = "dod-dead-probe";
            b.textContent = "DOD dead probe";
            document.body.appendChild(b);
          });
        }

        const all = await census(page);
        rec.controls = all.length;
        const nonNav = all.filter((c) => (c.tag === "button" || c.role === "button" || c.type === "submit" || c.type === "button") && c.visible && !c.inNav);
        for (const b of nonNav) {
          const brec = { screen, label: b.label, disabled: b.disabled, status: "FAIL", effects: [], error: "", rows: null, answer: "" };
          if (b.disabled) {
            brec.status = "SKIP_DISABLED";
          } else {
            try {
              await settle(page);
              const before = await snapshot(page);
              const reqBefore = l.requests();
              const ok = await clickByLabel(page, b.label, false);
              if (!ok) brec.error = "control not found on re-read";
              else {
                let after = before;
                let effects = [];
                for (let i = 0; i < 20; i += 1) {
                  await sleeps(120);
                  after = await snapshot(page);
                  effects = effectOf(before, after, l.requests() - reqBefore);
                  if (effects.length) break;
                }
                brec.effects = effects;
                brec.status = effects.length ? "PASS" : "DEAD";
                if (!effects.length) brec.error = "no observable effect within 2.4 s";
                // the Inbox filters must ANSWER, not only fire a request
                const answer = await page.evaluate(() => {
                  const list = document.getElementById("list");
                  if (!list) return null;
                  const rows = list.querySelectorAll("table tr").length;
                  const bodyRows = Math.max(0, rows - (list.querySelector("table th") ? 1 : 0));
                  const text = (list.innerText || "").replace(/\s+/g, " ").trim();
                  const active = [...document.querySelectorAll("#filters .chip.active")].map((c) => (c.innerText || "").trim());
                  return { rows: bodyRows, text: text.slice(0, 200), active };
                });
                if (answer) {
                  brec.rows = answer.rows;
                  brec.answer = answer.rows > 0 ? "rows" : /no conversations (match|for)/i.test(answer.text) ? "empty-state" : "NO_ANSWER";
                  brec.activeChips = answer.active;
                  if (brec.answer === "NO_ANSWER") {
                    brec.status = "DEAD";
                    brec.error = "filter fired but rendered no answer and no empty-state message";
                  } else if (answer.active.length !== 1 || answer.active[0] !== b.label) {
                    brec.status = "DEAD";
                    brec.error = `active filter chip is ${JSON.stringify(answer.active)}, expected ["${b.label}"]`;
                  }
                  if (inv.filters.includes(b.label)) rec.chips.push({ label: b.label, rows: brec.rows, answer: brec.answer, status: brec.status });
                }
              }
            } catch (e) {
              brec.error = String(e).slice(0, 200);
            }
          }
          rec.buttons.push(brec);
          runtimeButtons.push({ screen, label: b.label, status: brec.status, effects: brec.effects, inNav: false });
        }
        // a reached screen must always render its title and at least one control-free body region
        rec.ok = rec.reached && rec.buttons.every((b) => b.status !== "DEAD");
        if (rec.buttons.some((b) => b.status === "DEAD")) rec.errors.push(`${rec.buttons.filter((b) => b.status === "DEAD").length} dead control(s)`);
      } catch (e) {
        rec.errors.push(String(e).slice(0, 300));
        rec.ok = false;
      } finally {
        result.consoleErrors.push(...l.consoleErrors);
        result.pageErrors.push(...l.pageErrors);
        result.requestFailures.push(...l.requestFailures);
        result.httpErrors.push(...l.httpErrors);
        await page.close().catch(() => {});
        await ctx.close().catch(() => {});
      }
      screens.push(rec);
      log(`screen ${screen} -> "${rec.title}" active="${rec.navActive}" controls=${rec.controls} buttons=${rec.buttons.length}${rec.errors.length ? ` ERRORS: ${rec.errors.join(" | ")}` : ""}`);
    }
    result.screens = screens;

    // 5c. honest failure: a refused snapshot must be reported, not thrown
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addCookies([cookieForBrowser]);
      const page = await ctx.newPage();
      const l = attachListeners(page, "snapshot-refused", result);
      await page.route("**/api/snapshot", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"UNAUTHORIZED"}' }));
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleeps(1200);
      const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const banner = /snapshot unavailable/i.test(body) || /unauthori[sz]ed/i.test(body);
      // the browser always logs a "Failed to load resource" line for the refusal this check injected:
      // it is the test's own noise, recorded separately, never counted as a product console error
      const noise = l.consoleErrors.filter((c) => /Failed to load resource/i.test(c.text) && /\/api\/snapshot$/.test(c.url));
      const productConsole = l.consoleErrors.filter((c) => !noise.includes(c));
      result.errorPath = {
        injected: "GET /api/snapshot -> 401",
        bannerShown: banner,
        bodyStart: body.slice(0, 240),
        pageErrors: l.pageErrors,
        consoleErrors: l.consoleErrors,
        injectedConsoleNoise: noise.length,
        ok: banner && l.pageErrors.length === 0 && productConsole.length === 0,
      };
      result.pageErrors.push(...l.pageErrors);
      result.consoleErrors.push(...productConsole);
      log(`error path: banner=${banner} pageErrors=${l.pageErrors.length} body="${body.slice(0, 80)}"`);
      await page.close().catch(() => {});
      await ctx.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ---- 6. component + handler key attribution for every runtime button (nav labels were clicked once per screen)
  const observed = new Set();
  for (const s of screens) {
    const key = inv.staticKeys.find((k) => k.kind === "nav" && k.label === s.screen);
    if (!key) {
      result.hollow.push({ kind: "runtime-nav-without-static-tag", screen: s.screen });
      continue;
    }
    if (!key.hasHandler) result.hollow.push({ kind: "runtime-nav-without-handler", screen: s.screen, key: key.key });
    else observed.add(key.key);
    runtimeButtons.push({ screen: s.screen, label: s.screen, status: s.reached ? "PASS" : "FAIL", effects: ["dom"], inNav: true });
  }
  for (const b of runtimeButtons.filter((x) => !x.inNav)) {
    const key = inv.staticKeys.find((k) => k.kind === "chip" && k.label === b.label);
    if (!key) {
      // an unkeyed runtime button is the fail-closed probe by construction
      result.hollow.push({ kind: "runtime-button-without-static-tag", screen: b.screen, label: b.label });
      continue;
    }
    if (!key.hasHandler) result.hollow.push({ kind: "runtime-button-without-handler", screen: b.screen, label: b.label, key: key.key });
    else observed.add(key.key);
  }
  for (const k of inv.staticKeys.filter((x) => x.hasHandler)) {
    if (!observed.has(k.key)) result.orphanKeys.push({ key: k.key, kind: k.kind, label: k.label });
  }

  // ---- 7. verdict
  const deadButtons = runtimeButtons.filter((b) => b.status === "DEAD");
  const failedScreens = screens.filter((s) => !s.ok);
  const badDocs = documents.filter((d) => d.status !== 200 || d.bodyLength === 0 || d.navButtons !== inv.nav.length);
  const answeredChips = screens.flatMap((s) => s.chips).filter((c) => c.answer === "rows" || c.answer === "empty-state");
  const summary = {
    documents: documents.length,
    documentsOk: documents.length - badDocs.length,
    screens: screens.length,
    screensReached: screens.filter((s) => s.reached).length,
    boardFails: failedScreens.map((s) => ({ screen: s.screen, errors: s.errors })),
    buttons: runtimeButtons.length,
    buttonsPass: runtimeButtons.filter((b) => b.status === "PASS").length,
    buttonsDead: deadButtons.map((b) => ({ screen: b.screen, label: b.label })),
    chips: screens.flatMap((s) => s.chips).length,
    chipsAnswered: answeredChips.length,
    hollow: result.hollow.length,
    orphanKeys: result.orphanKeys.length,
    consoleErrors: result.consoleErrors.length,
    pageErrors: result.pageErrors.length,
    requestFailures: result.requestFailures.length,
    httpErrors: result.httpErrors.length,
    authProblems,
    apiProblems,
  };
  result.summary = summary;

  const problems = [];
  if (badDocs.length) problems.push(`${badDocs.length}/${documents.length} document path(s) failed (${badDocs.map((d) => `${d.path}:${d.status}:nav=${d.navButtons}`).join(", ")})`);
  if (authProblems.length) problems.push(`auth: ${authProblems.join("; ")}`);
  if (apiProblems.length) problems.push(`api: ${apiProblems.join("; ")}`);
  if (failedScreens.length) problems.push(`${failedScreens.length} screen(s) failed (${failedScreens.map((s) => `${s.screen}:${s.errors.join("/")}`).join(", ")})`);
  if (deadButtons.length) problems.push(`${deadButtons.length} dead control(s) (${deadButtons.map((b) => `${b.screen}:${b.label}`).join(", ")})`);
  if (answeredChips.length !== screens.flatMap((s) => s.chips).length) problems.push(`${screens.flatMap((s) => s.chips).length - answeredChips.length} inbox filter(s) gave no answer`);
  if (result.hollow.length) problems.push(`${result.hollow.length} hollow control(s) (${result.hollow.map((h) => h.kind).join(", ")})`);
  if (result.errorPath && !result.errorPath.ok) problems.push("refused snapshot is not reported honestly");
  if (result.consoleErrors.length) problems.push(`${result.consoleErrors.length} console error(s)`);
  if (result.pageErrors.length) problems.push(`${result.pageErrors.length} page error(s)`);
  if (result.requestFailures.length) problems.push(`${result.requestFailures.length} failed request(s)`);
  if (result.httpErrors.length) problems.push(`${result.httpErrors.length} http failure response(s)`);
  result.failClosed = {
    mode: process.env.DOD_W3B_SELFTEST || "(none)",
    injected: process.env.DOD_W3B_SELFTEST === "dead" ? "a handlerless button on every screen" : "",
    detected: process.env.DOD_W3B_SELFTEST === "dead" ? deadButtons.length + result.hollow.length > 0 : null,
  };

  const reason = problems.length === 0
    ? `${summary.documents}/${summary.documents} operator-UI documents 200 (auth gate 401 anon / 303 ticket / cookie HttpOnly), ${summary.screens}/${summary.screens} screens reached with their own title, ${summary.buttonsPass}/${summary.buttons} buttons produced an effect, ${summary.chipsAnswered}/${summary.chips} inbox filters answered (rows or empty-state) with exactly one active chip, 0 dead/hollow, 0 console/page/request/http errors, refused snapshot reported honestly`
    : `FAILED: ${problems.join("; ")}`;

  if (server) server.close();
  done(ID, problems.length === 0, reason, { ...result, finishedAt: new Date().toISOString() });
}

main().catch(async (e) => {
  if (server) server.close();
  await fail(`check threw: ${String(e).slice(0, 300)}`);
});
