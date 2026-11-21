#!/usr/bin/env node
// G2-W3B-TFI - Every-button DoD for the Tourism Intelligence Engine UI (single-screen React SPA).
//
// The item is PASS only when, against the REAL app built from this source tree, served on 127.0.0.1
// exactly like apps/standalone/vercel.json rewrites it, with the REAL research-api behind /v1:
//   1. route inventory  - the app's one mounted screen (plus its real <title>) loads with HTTP 200 and a body;
//   2. control census   - every control on the screen is enumerated into the evidence file;
//   3. click-effect     - every enabled button is really clicked and must produce an observable effect
//                         (URL, DOM/text, dialog, control state or a same-origin request); every input is really
//                         typed and must hold its value; every checkbox really flips;
//   4. real work        - the token gate is checked against a protected route, one REAL research job is run
//                         through POST /v1/research and must render its report; the transfer buttons must reach
//                         their real route and get an honest answer;
//   5. component+handler- every rendered button/input resolves to a static tag+handler in src/App.tsx (0 HOLLOW);
//   6. zero hollow/dead/console - 0 hollow, 0 dead controls, 0 dead links, 0 console/page errors, 0 failed
//                         requests, and no unrecorded 4xx/5xx (a documented contract refusal is recorded, not
//                         hidden: this run has NO guide-sources credential, so the two SEND buttons answer the
//                         real route's 422 GUIDE_SOURCES_CREDENTIAL_UNAVAILABLE and never write to production).
//
// Nothing is uploaded or deployed. The research token is generated in-process, handed to the API child through
// its env and typed into the real UI field; only its fingerprint (fp8) reaches the log or the evidence file.
// Evidence: D:\FUNAGING_TEMP\tracks\<track>\evidence\dod\G2-W3B-TFI_latest.json
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromePath, done, httpGet, repoRoot } from "../lib/harness.mjs";

const SELFTEST = process.env.DOD_W3B_SELFTEST || "";
const ID = SELFTEST ? "G2-W3B-TFI_SELFTEST" : "G2-W3B-TFI";
// Canonical copy lives in the TFI repo; the runner copy lives in the track runner repo (guide-sources).
const TFI_ROOT = process.env.DOD_TFI_ROOT
  || (existsSync(path.join(repoRoot, "packages", "intelligence-ui", "src", "App.tsx")) ? repoRoot : "D:\\FunAging\\TourismIntelligence");
const APP_TSX = path.join(TFI_ROOT, "packages", "intelligence-ui", "src", "App.tsx");
const STANDALONE = path.join(TFI_ROOT, "apps", "standalone");
const DIST = path.join(STANDALONE, "dist");
const API_ENTRY = path.join(TFI_ROOT, "services", "research-api", "dist", "server.js");
const WORK = path.join("D:\\FUNAGING_TEMP\\tracks\\C\\tmp", "w3b_tfi");
const WEB_PORT = Number(process.env.DOD_W3B_TFI_PORT || 4396);
const API_PORT = Number(process.env.DOD_W3B_TFI_API_PORT || 4397);
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const sleeps = (ms) => new Promise((r) => setTimeout(r, ms));

// The real token: generated locally, never printed, never written to disk.
const TOKEN = randomBytes(32).toString("hex");
const TOKEN_FP8 = createHash("sha256").update(TOKEN).digest("hex").slice(0, 8);

const result = {
  id: ID,
  selftest: SELFTEST || null,
  repo: TFI_ROOT,
  base: BASE,
  apiBase: API,
  work: WORK,
  startedAt: new Date().toISOString(),
  tokenFp8: TOKEN_FP8,
  build: null,
  api: { started: false, health: null, dataRoot: path.join(WORK, "data") },
  routeInventory: [],
  staticKeys: [],
  initial: null,
  report: null,
  controls: [],
  apiCalls: [],
  documentedRefusals: [],
  hollow: [],
  dead: [],
  orphanKeys: [],
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  httpErrors: [],
  steps: [],
};

let webServer = null;
let apiChild = null;
const log = (m) => {
  result.steps.push({ at: new Date().toISOString(), msg: m });
  console.log(`[w3b] ${m}`);
};

async function fail(reason, extra = {}) {
  try { if (webServer) webServer.close(); } catch { /* gone */ }
  try { if (apiChild) apiChild.kill(); } catch { /* gone */ }
  done(ID, false, reason, { ...result, ...extra, finishedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------- static source analysis

function scanTag(src, start) {
  let depth = 0;
  let quote = "";
  for (let i = start + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote && src[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth <= 0) return { attrs: src.slice(start + 1, i), end: i + 1 };
  }
  return null;
}

function handlerOf(attrs, name) {
  const re = new RegExp(`${name}\\s*=\\s*\\{`, "g");
  const m = re.exec(attrs);
  if (!m) return "";
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < attrs.length; i += 1) {
    if (attrs[i] === "{") depth += 1;
    else if (attrs[i] === "}") {
      depth -= 1;
      if (depth === 0) return attrs.slice(m.index + m[0].length, i).trim();
    }
  }
  return "";
}

function attrValue(attrs, name) {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : "";
}

function labelsOf(content) {
  const labels = [];
  const plain = content.replace(/\{[\s\S]*?\}/g, " ");
  const text = plain.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text) labels.push(text);
  for (const m of content.matchAll(/"([^"\\]{2,})"/g)) {
    const s = m[1].replace(/\s+/g, " ").trim();
    if (s && !labels.includes(s)) labels.push(s);
  }
  return labels;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

function componentsOf(src) {
  const list = [];
  const re = /^(?:export\s+default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/gm;
  for (const m of src.matchAll(re)) list.push({ name: m[1], start: m.index });
  return list.map((c, i) => ({ ...c, end: i + 1 < list.length ? list[i + 1].start : src.length }));
}

function componentAt(components, index) {
  let hit = null;
  for (const c of components) {
    if (c.start <= index) hit = c;
    else break;
  }
  return hit;
}

function buildInventory() {
  const src = readFileSync(APP_TSX, "utf8");
  const components = componentsOf(src);
  const staticKeys = [];
  const tagRe = /<(button|input|textarea|select)\b/g;
  let m;
  while ((m = tagRe.exec(src)) !== null) {
    const tag = m[1];
    const tagInfo = scanTag(src, m.index);
    if (!tagInfo) continue;
    const comp = componentAt(components, m.index);
    if (!comp) continue;
    const line = lineOf(src, m.index);
    const type = attrValue(tagInfo.attrs, "type");
    const placeholder = attrValue(tagInfo.attrs, "placeholder");
    const testId = attrValue(tagInfo.attrs, "data-testid");
    const onChange = handlerOf(tagInfo.attrs, "onChange") || handlerOf(tagInfo.attrs, "onInput");
    if (tag === "button") {
      const close = src.indexOf("</button>", tagInfo.end);
      const content = close === -1 ? "" : src.slice(tagInfo.end, close);
      const onClick = handlerOf(tagInfo.attrs, "onClick");
      const labels = labelsOf(content);
      staticKeys.push({
        kind: "button",
        key: `${comp.name}#${labels[0] || `line${line}`}`,
        component: comp.name,
        line,
        labels,
        testId,
        handler: onClick,
        hasHandler: Boolean(onClick) || type === "submit",
      });
      continue;
    }
    staticKeys.push({
      kind: tag,
      inputType: type,
      key: `${comp.name}#${tag}${type ? `[${type}]` : ""}@${line}`,
      component: comp.name,
      line,
      labels: placeholder ? [placeholder] : [],
      placeholder,
      testId,
      handler: onChange,
      hasHandler: Boolean(onChange),
    });
  }
  return { src, components, staticKeys };
}

// ---------------------------------------------------------------- api child (real research-api)

function apiEnv() {
  const env = { ...process.env };
  // A local run must never reach a production database: the transfer credential is removed on purpose.
  for (const k of Object.keys(env)) {
    if (/^(GUIDE_SOURCES_|SUPABASE_|FUNAGING_CORE_SUPABASE_|MAIN_WEB_SUPABASE_|NEXT_PUBLIC_SUPABASE_|OPENAI_|OPENROUTER_)/.test(k)) delete env[k];
  }
  delete env.VERCEL;
  delete env.RESEARCH_API_LISTEN;
  env.PORT = String(API_PORT);
  env.RESEARCH_API_TOKEN = TOKEN;
  env.TOURISM_INTELLIGENCE_DATA_ROOT = result.api.dataRoot;
  env.NODE_ENV = "production";
  return env;
}

function startApi() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [API_ENTRY], { cwd: TFI_ROOT, env: apiEnv(), shell: false });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ child, out, err: `${err}${e}` }));
    const t0 = Date.now();
    const poll = setInterval(async () => {
      if (out.includes("research-api listening") || Date.now() - t0 > 30000) {
        clearInterval(poll);
        resolve({ child, out, err });
      }
    }, 200);
  });
}

// ---------------------------------------------------------------- web server (static + real /v1 proxy)

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function proxy(req, res) {
  const target = new URL(req.url, API);
  const upstream = httpRequest(
    { hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: { ...req.headers, host: target.host } },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => res.writeHead(502, { "content-type": "application/json" }).end('{"error":"upstream_unreachable"}'));
  req.pipe(upstream);
}

function startWeb() {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const urlPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
      // apps/standalone/vercel.json rewrites /v1/* to the research api; the dev server also proxies /health
      if (urlPath === "/health" || urlPath.startsWith("/v1/")) return proxy(req, res);
      const file = path.join(DIST, urlPath === "/" ? "index.html" : urlPath);
      if (!file.toLowerCase().startsWith(DIST.toLowerCase())) return res.writeHead(403).end("no");
      if (existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
        return res.end(readFileSync(file));
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    });
    srv.on("error", reject);
    srv.listen(WEB_PORT, "127.0.0.1", () => resolve(srv));
  });
}

// ---------------------------------------------------------------- browser helpers

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
      const type = el.getAttribute("type") || "";
      const label =
        norm(el.closest("label")?.innerText) ||
        norm(el.getAttribute("aria-label")) ||
        norm(el.innerText) ||
        norm(el.getAttribute("placeholder")) ||
        norm(el.getAttribute("value")) ||
        norm(el.getAttribute("title")) ||
        norm(el.getAttribute("data-testid")) ||
        "";
      return {
        index,
        tag,
        type,
        role: el.getAttribute("role") || "",
        testId: el.getAttribute("data-testid") || "",
        label,
        href: el.getAttribute("href"),
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
        checked: typeof el.checked === "boolean" ? el.checked : null,
        value: typeof el.value === "string" ? el.value : null,
        visible: visible(el),
      };
    });
  });
}

async function snapshot(page) {
  return page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText,
    html: document.body.innerHTML.replace(/ data-dod-(?:idx|clicked)="[^"]*"/g, "").length,
    dialogs: document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]').length,
    states: [...document.querySelectorAll("button, [role=button], input, select, textarea")]
      .map((el) => `${el.getAttribute("aria-pressed") || ""}${el.getAttribute("aria-expanded") || ""}${el.hasAttribute("disabled") ? "D" : ""}${el.checked === true ? "C" : el.checked === false ? "c" : ""}${el.value || ""}`)
      .join("|"),
  }));
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

const BUTTON_SEL = 'button, [role="button"], input[type="submit"], input[type="button"]';

async function clickControl(page, { testId, label }) {
  const h = await page.evaluateHandle(({ testId, label, sel }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const target = norm(label).toLowerCase();
    const nodes = [...document.querySelectorAll(sel)];
    if (testId) {
      const byId = nodes.find((el) => el.getAttribute("data-testid") === testId && !el.hasAttribute("data-dod-clicked"));
      if (byId) { byId.setAttribute("data-dod-clicked", "1"); return byId; }
    }
    for (const el of nodes) {
      const name = norm(el.getAttribute("aria-label") || el.innerText || el.getAttribute("value") || el.getAttribute("title") || el.getAttribute("data-testid") || "").toLowerCase();
      if (name === target && !el.hasAttribute("data-dod-clicked")) { el.setAttribute("data-dod-clicked", "1"); return el; }
    }
    return null;
  }, { testId, label, sel: BUTTON_SEL });
  const el = h.asElement();
  if (!el) return false;
  try { await el.click({ timeout: 8000 }); } catch { await el.evaluate((e) => e.click()); }
  return true;
}

// ---------------------------------------------------------------- main

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(path.join(WORK, "data"), { recursive: true });
  log(`repo ${TFI_ROOT}`);
  for (const need of [APP_TSX, path.join(STANDALONE, "package.json"), path.join(TFI_ROOT, "package.json")]) {
    if (!existsSync(need)) return await fail(`missing prerequisite ${need}`);
  }

  // ---- 1. build the real monorepo (types + core + api + ui + standalone) from source
  const env = { ...process.env };
  delete env.VITE_API_BASE;
  delete env.RESEARCH_API_TOKEN;
  const build = await new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      cwd: TFI_ROOT, shell: process.platform === "win32", env,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 600000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
  });
  writeFileSync(path.join(WORK, "build.log"), `${build.out}\n${build.err}`);
  result.build = { exit: build.code, tail: `${build.out}\n${build.err}`.slice(-1200) };
  if (build.code !== 0) return await fail(`real build failed (exit ${build.code})`);
  if (!existsSync(path.join(DIST, "index.html"))) return await fail(`build produced no ${path.join(DIST, "index.html")}`);
  result.build.distIndexBytes = statSync(path.join(DIST, "index.html")).size;
  const assetsDir = path.join(DIST, "assets");
  const bundle = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
  result.build.assets = bundle;
  log(`build ok (dist/index.html ${result.build.distIndexBytes} B, ${bundle.length} asset(s))`);

  // ---- 2. start the real research-api (localhost, throwaway data root, token from env)
  const api = await startApi();
  apiChild = api.child;
  const health = await httpGet(`${API}/v1/health`, 15000);
  result.api = { ...result.api, started: true, health: { status: health.status, body: health.body.slice(0, 200) }, out: api.out.slice(-300), err: api.err.slice(-300) };
  if (health.status !== 200) return await fail(`real research-api did not answer /v1/health (${health.status})`);
  log(`research-api up (health ${health.status}, auth configured)`);

  // ---- 3. serve the built app exactly like vercel.json (static + /v1 proxy)
  webServer = await startWeb();
  log(`serving ${DIST} on ${BASE} with /v1 -> ${API}`);

  // ---- 4. static inventory (source of truth for control keys)
  const inv = buildInventory();
  result.staticKeys = inv.staticKeys.map((k) => ({ key: k.key, kind: k.kind, component: k.component, line: k.line, labels: k.labels, testId: k.testId, handler: k.handler, hasHandler: k.hasHandler }));
  for (const k of inv.staticKeys.filter((x) => !x.hasHandler)) {
    result.hollow.push({ kind: "static-control-without-handler", key: k.key, line: k.line });
  }
  // this app mounts one screen; the source must not silently gain a router we do not drive
  const routeLike = (inv.src.match(/<Route\s/g) || []).length;
  const title = (readFileSync(path.join(STANDALONE, "index.html"), "utf8").match(/<title>([^<]+)<\/title>/) || [])[1] || "";
  result.routeInventory = [{ route: "/", component: "TourismIntelligenceApp", routerRoutes: routeLike, title }];
  if (routeLike !== 0) return await fail(`the UI gained ${routeLike} <Route> declaration(s); this check only drives the single mounted screen`);
  log(`inventory: 1 screen (title "${title}"), ${inv.staticKeys.length} static controls, ${result.hollow.length} handlerless`);

  // ---- 5. browser sweep on the REAL build
  const requireFromTfi = createRequire(path.join(TFI_ROOT, "package.json"));
  const { chromium } = requireFromTfi("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  } catch (e) {
    if (!chromePath()) throw e;
    browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--no-sandbox"] });
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let requests = 0;
  const calls = [];
  page.on("console", (msg) => { if (msg.type() === "error") result.consoleErrors.push({ text: msg.text(), url: (msg.location() || {}).url || "" }); });
  page.on("pageerror", (e) => result.pageErrors.push({ text: String(e) }));
  page.on("request", (req) => { if (["fetch", "xhr"].includes(req.resourceType())) requests += 1; });
  page.on("requestfailed", (req) => {
    const failure = (req.failure() || {}).errorText || "";
    if (failure !== "net::ERR_ABORTED") result.requestFailures.push({ url: req.url(), failure });
  });
  page.on("response", async (res) => {
    const u = res.url();
    if (!u.startsWith(API) && !u.startsWith(BASE)) return;
    const pathOnly = u.replace(API, "").replace(BASE, "");
    if (res.status() >= 400) {
      // Documented contract refusals: the real route's own answer when the local run has no
      // guide-sources credential. Anything else is an http failure.
      const isTransfer = pathOnly.startsWith("/v1/research/") && pathOnly.includes("/guide-sources/transfer");
      let body = "";
      try { body = (await res.text()).slice(0, 300); } catch { /* body already consumed */ }
      if (isTransfer && res.status() === 422) {
        result.documentedRefusals.push({ url: pathOnly, status: res.status(), body });
      } else {
        result.httpErrors.push({ status: res.status(), url: pathOnly, body });
      }
    }
    if (["/v1/research", "/v1/facts", "/v1/health"].some((p) => pathOnly === p) || pathOnly.includes("/export") || pathOnly.includes("/transfer")) {
      calls.push({ method: res.request().method(), path: pathOnly, status: res.status() });
    }
  });

  const badAuth = SELFTEST === "badauth";
  const uiToken = badAuth ? randomBytes(32).toString("hex") : TOKEN;

  let httpStatus = 0;
  try {
    const resp = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await sleeps(250);
    httpStatus = resp ? resp.status() : 0;
    result.initial = {
      url: page.url(),
      title: await page.title(),
      bodyTextLength: (await page.locator("body").innerText()).trim().length,
      httpStatus,
    };
    if (httpStatus !== 200 || result.initial.bodyTextLength === 0) return await fail(`screen / did not load (${httpStatus})`);
    if (result.initial.title !== title) return await fail(`served title "${result.initial.title}" is not the source title "${title}"`);
    log(`screen / -> ${httpStatus}, ${result.initial.bodyTextLength} chars, title "${result.initial.title}"`);

    if (SELFTEST === "dead") {
      await page.evaluate(() => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "DOD dead probe";
        document.body.appendChild(b);
      });
    }

    // ---- inputs: really type each one, read it back, then restore a valid value
    const initialCensus = await census(page);
    const inputControls = initialCensus.filter((c) => ["input", "textarea", "select"].includes(c.tag) && c.visible && !c.disabled);
    result.initial.controls = initialCensus.map(({ index, tag, type, label, disabled, visible }) => ({ index, tag, type, label, disabled, visible }));
    const inputRecs = [];
    for (const c of inputControls) {
      const rec = { phase: "initial", kind: c.tag, tag: c.tag, type: c.type, testId: c.testId, label: c.label, status: "FAIL", value: "", error: "" };
      try {
        const probe = page.locator(`[data-dod-idx="${c.index}"]`);
        if (c.type === "checkbox") {
          await probe.click({ timeout: 5000 });
          await sleeps(120);
          const now = await probe.isChecked();
          rec.value = String(now);
          rec.status = now === !c.checked ? "PASS" : "FAIL";
          if (now !== c.checked) { await probe.click({ timeout: 5000 }); await sleeps(120); rec.restored = await probe.isChecked(); }
        } else {
          const v = `dod-${c.testId || c.tag}-${c.index}`;
          await probe.fill(v, { timeout: 5000 });
          const now = await probe.inputValue();
          rec.value = now;
          rec.status = now === v ? "PASS" : "FAIL";
        }
      } catch (e) {
        rec.error = String(e).slice(0, 200);
      }
      inputRecs.push(rec);
    }
    // restore the fields the real flow needs (the token and topic are what an operator types)
    const byTestId = (id) => page.locator(`[data-testid="${id}"]`);
    if (!(await byTestId("api-token").count())) return await fail("the API token control is missing from the UI");
    await byTestId("api-token").fill(uiToken);
    const firstText = page.locator('input:not([type="password"]):not([type="checkbox"])').first();
    await firstText.fill("coffee shops in Nan Thailand");
    const periodInput = page.locator("label", { hasText: "Period" }).locator("input");
    if (await periodInput.count()) await periodInput.fill("AUTO").catch(() => {});
    result.initial.inputs = inputRecs;

    // ---- buttons on the initial screen (token verify + research)
    const phase = async (name, opts = {}) => {
      await page.evaluate(() => document.querySelectorAll("[data-dod-clicked]").forEach((el) => el.removeAttribute("data-dod-clicked")));
      const buttons = (await census(page)).filter((c) => (c.tag === "button" || c.role === "button") && c.visible);
      const out = [];
      for (const b of buttons) {
        const rec = { phase: name, kind: "button", testId: b.testId, label: b.label, disabled: b.disabled, status: "FAIL", effects: [], error: "" };
        if (b.disabled) { rec.status = "SKIP_DISABLED"; out.push(rec); continue; }
        if (opts.skipLabels && opts.skipLabels.some((l) => b.label.toLowerCase().includes(l))) { rec.status = "HANDLED"; out.push(rec); continue; }
        try {
          await settle(page);
          const before = await snapshot(page);
          const reqBefore = requests;
          const clicked = await clickControl(page, { testId: b.testId, label: b.label });
          if (!clicked) { rec.error = "control not found on re-read"; out.push(rec); continue; }
          let after = before;
          let effects = [];
          for (let i = 0; i < 25; i += 1) {
            await sleeps(120);
            after = await snapshot(page);
            effects = effectOf(before, after, requests - reqBefore);
            if (effects.length) break;
          }
          rec.effects = effects;
          rec.status = effects.length ? "PASS" : "DEAD";
          if (!effects.length) rec.error = "no observable effect within 3 s";
        } catch (e) {
          rec.error = String(e).slice(0, 200);
        }
        out.push(rec);
      }
      return out;
    };

    // Verify token is clicked by the phase sweep; RESEARCH is the real job, so it is driven explicitly below
    const initialButtons = await phase("initial", { skipLabels: ["research"] });

    // the token gate must be really answered by a protected route
    const authOk = await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="token-status"]');
      return Boolean(el && /Token accepted|Token refused/i.test(el.textContent || ""));
    }, { timeout: 20000 }).then(() => true).catch(() => false);
    const authText = await byTestId("token-status").innerText().catch(() => "");
    result.authGate = { answered: authOk, text: authText.slice(0, 160) };
    if (!authOk) return await fail(`the token gate never answered (status "${authText.slice(0, 80)}")`);
    if (badAuth) return await fail(`negative control: the wrong token was refused ("${authText.slice(0, 80)}") and no research ran - this run must FAIL`);
    if (!/Token accepted/i.test(authText)) return await fail(`the locally issued token was refused by the protected route ("${authText.slice(0, 80)}")`);

    // ---- the REAL research job through the real API
    const researchClicked = await clickControl(page, { testId: "research-button", label: "RESEARCH" });
    if (!researchClicked) return await fail("the RESEARCH control could not be clicked");
    const rendered = await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="research-summary"]')), { timeout: 150000 })
      .then(() => true).catch(() => false);
    if (!rendered) {
      const err = await page.locator("body").innerText();
      return await fail(`no report rendered after the real research job (body: "${err.replace(/\s+/g, " ").slice(0, 160)}")`, { apiCalls: calls });
    }
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await settle(page, 4000);
    const researchCall = calls.filter((c) => c.path === "/v1/research").pop() || null;
    result.report = {
      summary: (await page.locator('[data-testid="research-summary"]').innerText()).replace(/\s+/g, " ").slice(0, 240),
      bodyTextLength: (await page.locator("body").innerText()).trim().length,
      checkboxes: await page.locator('input[type="checkbox"]').count(),
      researchCall,
    };
    if (!researchCall || researchCall.status !== 200) return await fail(`POST /v1/research did not answer 200 (${JSON.stringify(researchCall)})`, { apiCalls: calls });
    log(`real research rendered: ${result.report.summary.slice(0, 60)}... (checkbox ${result.report.checkboxes})`);

    // ---- inputs on the result screen (checkboxes + the approver identity)
    const resultCensus = await census(page);
    const initialKeys = new Set(inputControls.map((c) => `${c.tag}|${c.type}|${(c.label || "").toLowerCase()}`));
    const resultInputs = resultCensus.filter((c) => ["input", "textarea", "select"].includes(c.tag) && c.visible && !c.disabled
      && c.testId !== "api-token" && !initialKeys.has(`${c.tag}|${c.type}|${(c.label || "").toLowerCase()}`));
    const resultInputRecs = [];
    for (const c of resultInputs) {
      const rec = { phase: "result", kind: c.tag, tag: c.tag, type: c.type, label: c.label, status: "FAIL", value: "", error: "" };
      try {
        const probe = page.locator(`[data-dod-idx="${c.index}"]`);
        if (c.type === "checkbox") {
          await probe.click({ timeout: 5000 });
          await sleeps(120);
          const now = await probe.isChecked();
          rec.value = String(now);
          rec.status = now === !c.checked ? "PASS" : "FAIL";
          if (now !== c.checked) { await probe.click({ timeout: 5000 }); await sleeps(120); rec.restored = await probe.isChecked(); }
        } else {
          const v = `dod-approver-${c.index}`;
          await probe.fill(v, { timeout: 5000 });
          rec.value = await probe.inputValue();
          rec.status = rec.value === v ? "PASS" : "FAIL";
        }
      } catch (e) {
        rec.error = String(e).slice(0, 200);
      }
      resultInputRecs.push(rec);
    }
    result.report.inputs = resultInputRecs;

    // ---- buttons on the result screen (export, evidence toggle, both SEND controls must reach the real route)
    const resultButtons = await phase("result", { skipLabels: ["verify token", "research"] });
    result.controls = [...inputRecs, ...initialButtons, ...resultInputRecs, ...resultButtons];
    result.apiCalls = calls;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // ---- 6. component + handler key attribution
  const runtimeButtons = result.controls.filter((c) => c.phase && c.kind === "button" && c.status !== "SKIP_DISABLED");
  const observed = new Set();
  const matchStatic = (label) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const l = norm(label);
    const exact = inv.staticKeys.find((k) => k.kind === "button" && k.labels.some((x) => norm(x) === l));
    if (exact) return exact;
    return inv.staticKeys.find((k) => k.kind === "button" && k.labels.some((x) => norm(x).length > 3 && (l.includes(norm(x)) || norm(x).includes(l))));
  };
  for (const b of runtimeButtons) {
    if (b.status === "HANDLED") continue;
    const hit = matchStatic(b.label);
    b.key = hit ? hit.key : null;
    b.handler = hit ? hit.handler : null;
    if (!hit) result.hollow.push({ kind: "runtime-button-without-static-tag", label: b.label });
    else if (!hit.hasHandler) result.hollow.push({ kind: "runtime-button-without-handler", label: b.label, key: hit.key });
    else observed.add(hit.key);
  }
  // the RESEARCH button was driven by the real job, so its static key counts as observed
  const researchKey = matchStatic("RESEARCH");
  if (researchKey && result.report) observed.add(researchKey.key);
  for (const ri of result.controls.filter((c) => c.phase && c.kind && c.kind !== "button")) {
    const tag = ri.tag;
    const hit = inv.staticKeys.find((k) => k.kind === tag && (k.inputType || "") === (ri.type || "") && k.hasHandler
      && (!ri.label || !k.labels.length || k.labels.some((l) => (ri.label || "").toLowerCase().includes(l.toLowerCase()) || l.toLowerCase().includes((ri.label || "").toLowerCase()))))
      || inv.staticKeys.find((k) => k.kind === tag && (k.inputType || "") === (ri.type || "") && k.hasHandler);
    if (!hit) result.hollow.push({ kind: "runtime-input-without-static-tag", tag, type: ri.type, label: ri.label });
    else observed.add(hit.key);
  }
  for (const k of inv.staticKeys.filter((x) => x.hasHandler && x.kind === "button")) {
    if (!observed.has(k.key)) result.orphanKeys.push({ key: k.key, line: k.line, labels: k.labels });
  }
  result.componentCoverage = [...new Set(inv.staticKeys.map((k) => k.component))].map((comp) => {
    const keys = inv.staticKeys.filter((k) => k.component === comp);
    return { component: comp, controls: keys.length, observed: keys.filter((k) => observed.has(k.key)).length };
  });

  // ---- 7. verdict
  const deadButtons = result.controls.filter((c) => c.phase && c.kind === "button" && c.status === "DEAD");
  const failedInputs = result.controls.filter((c) => c.phase && c.kind && c.kind !== "button" && c.status === "FAIL");
  result.dead = deadButtons.map((b) => ({ phase: b.phase, label: b.label }));
  const skipped = result.controls.filter((c) => c.status === "SKIP_DISABLED");
  const transferCalls = (result.apiCalls || []).filter((c) => c.path.includes("/guide-sources/transfer"));
  const sendButtons = result.controls.filter((c) => c.phase === "result" && c.kind === "button" && /^SEND/i.test(String(c.label || "")));
  const sendPass = sendButtons.filter((c) => c.status === "PASS").length;
  const sendDisabled = sendButtons.filter((c) => c.status === "SKIP_DISABLED");

  // A documented contract refusal makes Chromium log "Failed to load resource ... 422" by itself; that line
  // belongs to the recorded refusal, not to a free-floating console error. Everything else still fails.
  const expectedConsole = result.consoleErrors.filter((e) => {
    const m = /status of (\d{3})/.exec(e.text || "");
    if (!m || !["422", "403", "409"].includes(m[1])) return false;
    let p = "";
    try { p = new URL(e.url || BASE).pathname; } catch { return false; }
    return result.documentedRefusals.some((r) => p === r.url);
  });
  const unexpectedConsole = result.consoleErrors.filter((e) => !expectedConsole.includes(e));
  result.consoleErrorsExpected = expectedConsole;

  const summary = {
    routes: result.routeInventory.length,
    routesPass: result.initial && result.initial.httpStatus === 200 ? 1 : 0,
    buttons: result.controls.filter((c) => c.phase && c.kind === "button" && c.status !== "HANDLED").length,
    buttonsPass: result.controls.filter((c) => c.phase && c.kind === "button" && c.status === "PASS").length,
    buttonsDisabled: skipped.length,
    deadButtons: deadButtons.map((b) => `${b.phase}:${b.label}`),
    inputs: result.controls.filter((c) => c.phase && c.kind && c.kind !== "button").length,
    inputsPass: result.controls.filter((c) => c.phase && c.kind && c.kind !== "button" && c.status === "PASS").length,
    failedInputs: failedInputs.map((i) => `${i.phase}:${i.label}`),
    hollow: result.hollow.length,
    orphanKeys: result.orphanKeys.length,
    components: result.componentCoverage.length,
    researchStatus: result.report ? (result.report.researchCall || {}).status : null,
    transferCalls: transferCalls.length,
    sendButtons: sendButtons.length,
    sendPass,
    sendDisabled: sendDisabled.map((s) => s.label),
    documentedRefusals: result.documentedRefusals.length,
    consoleErrors: unexpectedConsole.length,
    pageErrors: result.pageErrors.length,
    requestFailures: result.requestFailures.length,
    httpErrors: result.httpErrors.length,
  };
  result.summary = summary;

  const problems = [];
  if (summary.routesPass !== summary.routes) problems.push("screen / did not load");
  if (result.hollow.length) problems.push(`${result.hollow.length} hollow control(s) (${result.hollow.map((h) => h.kind).join(", ")})`);
  if (deadButtons.length) problems.push(`${deadButtons.length} dead control(s) (${deadButtons.map((b) => `${b.phase}:${b.label}`).join(", ")})`);
  if (failedInputs.length) problems.push(`${failedInputs.length} input(s) did not hold a value (${failedInputs.map((i) => `${i.phase}:${i.label}`).join(", ")})`);
  if (!result.report) problems.push("no real research report rendered");
  // A SEND control may only stay disabled when the report itself has nothing sendable/selectable.
  if (sendPass === 0) problems.push(`no SEND control reached the real transfer route (${sendButtons.length} present, ${sendDisabled.length} disabled)`);
  if (sendPass > 0 && transferCalls.length === 0) problems.push("a SEND control reported an effect but made no transfer call");
  if (unexpectedConsole.length) problems.push(`${unexpectedConsole.length} console error(s): ${unexpectedConsole.slice(0, 2).map((e) => e.text.slice(0, 90)).join(" | ")}`);
  if (result.pageErrors.length) problems.push(`${result.pageErrors.length} page error(s): ${result.pageErrors.slice(0, 2).map((e) => e.text.slice(0, 90)).join(" | ")}`);
  if (result.requestFailures.length) problems.push(`${result.requestFailures.length} failed request(s)`);
  if (result.httpErrors.length) problems.push(`${result.httpErrors.length} unrecorded http failure(s) (${result.httpErrors.slice(0, 3).map((e) => `${e.status} ${e.url}`).join(", ")})`);

  const reason = problems.length === 0
    ? `1/1 screen 200 with the source title, ${summary.buttonsPass}/${summary.buttons - summary.buttonsDisabled} enabled buttons produced an effect (${summary.buttonsDisabled} declared disabled: ${summary.sendDisabled.join(",") || "none"}), ${summary.inputsPass}/${summary.inputs} inputs held their value, real token gate accepted, real POST /v1/research ${summary.researchStatus} rendered a report, ${summary.transferCalls} transfer call(s) answered by the real route (${summary.documentedRefusals} documented refusal(s), no production write), 0 dead/hollow, 0 console/page/request errors`
    : `FAILED: ${problems.join("; ")}`;

  try { webServer.close(); } catch { /* gone */ }
  try { apiChild.kill(); } catch { /* gone */ }
  done(ID, problems.length === 0, reason, { ...result, finishedAt: new Date().toISOString() });
}

function listOf(dir) {
  try { return [...readdirSync(dir)]; } catch { return []; }
}

main().catch(async (e) => {
  try { if (webServer) webServer.close(); } catch { /* gone */ }
  try { if (apiChild) apiChild.kill(); } catch { /* gone */ }
  await fail(`check threw: ${String(e).slice(0, 300)}`);
});
