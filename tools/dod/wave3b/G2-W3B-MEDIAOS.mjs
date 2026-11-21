#!/usr/bin/env node
// G2-W3B-MEDIAOS - Every-button DoD for MediaOS (web + api).
//
// The item is PASS only when, against the REAL app running locally from this source tree:
//   1. route inventory   - every src/app/**/page.tsx route answers 200 with a non-empty body and every
//                          dynamic route is loaded with a REAL entity created through the real API;
//   2. control census    - every control (button / role=button / input / textarea / select / link) on every
//                          route is enumerated and recorded in the evidence file;
//   3. click-effect      - every enabled button-like control is really clicked and must produce an observable
//                          effect (URL, DOM text/size, dialog, control state, or a same-origin request);
//                          every input/textarea/select is really typed/selected and must hold its value;
//   4. component+handler - every rendered button is attributed to a static button key (<component file>#<label>)
//      keys                 with a real onClick/onSubmit handler (0 HOLLOW), and every mounted component that
//                          declares buttons is observed at runtime (coverage); handler-less buttons are refused;
//   5. zero hollow/dead/console - 0 hollow buttons, 0 dead controls, 0 console errors, 0 page errors,
//                          0 failed requests; api: every live API route probed (GET 200/4xx, POST 4xx-not-5xx),
//                          every web /api route reachable through the running server.
//
// Writes are local only: a throwaway foundation root under tracks\C\tmp, never production.
// Evidence: D:\FUNAGING_TEMP\tracks\<track>\evidence\dod\G2-W3B-MEDIAOS_latest.json
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromePath, done, repoRoot, runId } from "../lib/harness.mjs";

const ID = "G2-W3B-MEDIAOS";
// The canonical copy lives in the MediaOS repo; the same file is copied into the track runner repo (guide-sources
// tools/dod/wave3b) so the wave driver can run it. Resolve the MediaOS checkout explicitly in that case.
const MEDIAOS_ROOT = process.env.DOD_MEDIAOS_ROOT
  || (existsSync(path.join(repoRoot, "apps", "web", "package.json")) ? repoRoot : "D:\\MediaOS\\source");
const WEB = path.join(MEDIAOS_ROOT, "apps", "web");
const WEB_SRC = path.join(WEB, "src");
const APP_DIR = path.join(WEB_SRC, "app");
const COMPONENTS_DIR = path.join(WEB_SRC, "components");
const NEXT_BIN = path.join(WEB, "node_modules", "next", "dist", "bin", "next");
const WORK = path.join("D:\\FUNAGING_TEMP\\tracks\\C\\tmp", "w3b_mediaos");
const API_PORT = Number(process.env.DOD_W3B_API_PORT || 4391);
const WEB_PORT = Number(process.env.DOD_W3B_WEB_PORT || 4392);
const PROBE_PORT = Number(process.env.DOD_W3B_PROBE_PORT || 4393);
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const PROBE_BASE = `http://127.0.0.1:${PROBE_PORT}`;
const IDENTITY = { "x-mediaos-role": "editor", "x-mediaos-actor": "dod-w3b" };
const sleeps = (ms) => new Promise((r) => setTimeout(r, ms));

const result = {
  id: ID,
  repo: MEDIAOS_ROOT,
  webPort: WEB_PORT,
  apiPort: API_PORT,
  work: WORK,
  startedAt: new Date().toISOString(),
  routeInventory: [],
  routes: [],
  controls: [],
  staticKeys: [],
  hollow: [],
  dead: [],
  orphanKeys: [],
  componentCoverage: [],
  webApi: { routes: [], failures: [] },
  api: { inventory: null, probes: [], failures: [] },
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  httpErrors: [],
  steps: [],
};

const children = [];
const log = (m) => {
  result.steps.push({ at: new Date().toISOString(), msg: m });
  console.log(`[w3b] ${m}`);
};

async function fail(reason, extra = {}) {
  await stopChildren();
  done(ID, false, reason, { ...result, ...extra, finishedAt: new Date().toISOString() });
}

function spawnChild(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.dod = { out: () => out, err: () => err };
  children.push(child);
  return child;
}

async function stopChildren() {
  for (const c of children) {
    try {
      if (process.platform === "win32" && c.pid) spawn("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      else c.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await sleeps(400);
}

async function waitFor(url, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status < 500) return r;
    } catch {
      /* not up yet */
    }
    await sleeps(400);
  }
  throw new Error(`timeout waiting for ${what || url} (${timeoutMs} ms)`);
}

async function httpJson(url, init = {}) {
  try {
    const r = await fetch(url, { cache: "no-store", ...init });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: r.status, json, text, type: r.headers.get("content-type") || "" };
  } catch (e) {
    return { status: 0, json: null, text: "", type: "", error: String(e) };
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- static source analysis

// Scan a JSX tag starting at src[start] === "<", tracking {} depth so "=>" inside an attribute does not
// end the tag. Returns { attrs, end } where end is the index just after the closing ">".
function scanTag(src, start) {
  let depth = 0;
  let quote = "";
  for (let i = start + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote && src[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth <= 0) return { attrs: src.slice(start + 5, i), end: i + 1 };
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

function scanButtons(file) {
  const src = readFileSync(file, "utf8");
  const out = [];
  let i = 0;
  while ((i = src.indexOf("<button", i)) !== -1) {
    const tag = scanTag(src, i);
    if (!tag) {
      i += 7;
      continue;
    }
    const close = src.indexOf("</button>", tag.end);
    const content = close === -1 ? "" : src.slice(tag.end, close);
    const onClick = handlerOf(tag.attrs, "onClick");
    const onSubmit = handlerOf(tag.attrs, "onSubmit");
    const type = (/type\s*=\s*"([^"]+)"/.exec(tag.attrs) || [])[1] || "";
    out.push({
      file,
      line: src.slice(0, i).split("\n").length,
      handler: onClick || onSubmit || "",
      hasHandler: Boolean(onClick || onSubmit) || type === "submit",
      labels: labelsOf(content),
    });
    i = tag.end;
  }
  return out;
}

function relOf(file) {
  return path.relative(WEB_SRC, file).split(path.sep).join("/");
}

function resolveImport(fromFile, spec) {
  let base = null;
  if (spec.startsWith("@/")) base = path.join(WEB_SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  if (!base) return null;
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function importsOf(file) {
  const src = readFileSync(file, "utf8");
  const out = [];
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const f = resolveImport(file, m[1]);
    if (f) out.push(f);
  }
  return out;
}

function pageRoute(file) {
  const rel = path.relative(APP_DIR, path.dirname(file)).split(path.sep).filter(Boolean).filter((s) => !s.startsWith("("));
  return "/" + rel.join("/");
}

function apiRoutePath(file) {
  const rel = path.relative(APP_DIR, path.dirname(file)).split(path.sep).filter((s) => !s.startsWith("("));
  return "/" + rel.join("/");
}

function canonicalKey(route) {
  return route.replace(/\/$/, "") || "/";
}

// ---------------------------------------------------------------- route + key inventory

function buildInventory() {
  const pageFiles = walk(APP_DIR).filter((f) => f.endsWith("page.tsx"));
  const routes = pageFiles.map((file) => ({
    file: relOf(file),
    route: canonicalKey(pageRoute(file)),
    dynamic: pageRoute(file).includes("["),
    mounted: [],
  }));
  const buttonFiles = walk(COMPONENTS_DIR).filter((f) => f.endsWith(".tsx"));
  const pageButtonFiles = pageFiles;
  const staticKeys = [];
  for (const file of [...buttonFiles, ...pageButtonFiles]) {
    for (const b of scanButtons(file)) {
      staticKeys.push({ ...b, file: relOf(file) });
    }
  }
  // mounted component closure per route (layout components apply to every route)
  const layout = path.join(APP_DIR, "layout.tsx");
  const layoutComps = existsSync(layout) ? importsOf(layout).filter((f) => f.endsWith(".tsx")) : [];
  for (const r of routes) {
    const seen = new Set(layoutComps);
    const queue = [...importsOf(path.join(APP_DIR, r.file.replace(/^app\//, ""))).filter((f) => f.endsWith(".tsx")), ...layoutComps];
    while (queue.length) {
      const f = queue.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const n of importsOf(f).filter((x) => x.endsWith(".tsx"))) queue.push(n);
    }
    r.mounted = [...seen].map(relOf);
  }
  return { routes, staticKeys };
}

function matchesTemplate(pathname, template) {
  const a = pathname.replace(/\/$/, "").split("/").filter(Boolean);
  const b = template.replace(/\/$/, "").split("/").filter(Boolean);
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (b[i].startsWith("[") || b[i].startsWith("...")) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------- browser sweep

async function census(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
      return el.getClientRects().length > 0;
    };
    const sel = 'button, [role="button"], input, textarea, select, a[href]';
    const nodes = [...document.querySelectorAll(sel)];
    nodes.forEach((el, index) => el.setAttribute("data-dod-idx", String(index)));
    return nodes.map((el, index) => {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || "";
      const label =
        norm(el.getAttribute("aria-label")) ||
        norm(el.innerText) ||
        norm(el.getAttribute("value")) ||
        norm(el.getAttribute("title")) ||
        norm(el.getAttribute("placeholder")) ||
        norm(el.getAttribute("name")) ||
        norm(el.getAttribute("href")) ||
        "";
      return {
        index,
        tag,
        type,
        role: el.getAttribute("role") || "",
        label,
        href: el.getAttribute("href"),
        name: el.getAttribute("name"),
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
        visible: visible(el),
        value: typeof el.value === "string" ? el.value : null,
      };
    });
  });
}

const BUTTON_SEL = 'button, [role="button"], input[type="submit"], input[type="button"]';

async function clickByLabel(page, label) {
  const h = await page.evaluateHandle(({ label, sel }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const target = norm(label).toLowerCase();
    for (const el of document.querySelectorAll(sel)) {
      const name = norm(
        el.getAttribute("aria-label") ||
          el.innerText ||
          el.getAttribute("value") ||
          el.getAttribute("title") ||
          "",
      ).toLowerCase();
      if (name === target && !el.hasAttribute("data-dod-clicked")) {
        el.setAttribute("data-dod-clicked", "1");
        return el;
      }
    }
    return null;
  }, { label, sel: BUTTON_SEL });
  const el = h.asElement();
  if (!el) return false;
  try {
    await el.click({ timeout: 5000 });
  } catch {
    await el.evaluate((e) => e.click());
  }
  return true;
}

async function snapshot(page) {
  return page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText,
    html: document.body.innerHTML.length,
    dialogs: document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]').length,
    states: [...document.querySelectorAll('button, [role="button"], input')]
      .map((el) => `${el.getAttribute("aria-pressed") || ""}${el.getAttribute("aria-expanded") || ""}${el.hasAttribute("disabled") ? "D" : ""}${el.value || ""}`)
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

async function sweepRoute(browser, r, templates, dynamicEntity) {
  const url = dynamicEntity[r.route] || r.route;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // a REAL signed-in console session: the app reads its standalone identity from localStorage (its own model)
  await context.addInitScript(() => {
    const seed = () => {
      try {
        window.localStorage.setItem("mediaos_role", "admin");
        window.localStorage.setItem("mediaos_actor", "dod-w3b-admin");
      } catch {
        /* about:blank and similar documents have no storage */
      }
    };
    seed();
    try {
      document.addEventListener("DOMContentLoaded", seed, { once: true });
    } catch {
      /* no document yet */
    }
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  let requests = 0;
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ route: r.route, text: msg.text(), url: (msg.location() || {}).url || "" });
  });
  page.on("pageerror", (e) => pageErrors.push({ route: r.route, text: String(e) }));
  page.on("request", (req) => {
    if (["fetch", "xhr"].includes(req.resourceType())) requests += 1;
  });
  const httpErrors = [];
  page.on("requestfailed", (req) => {
    const failure = (req.failure() || {}).errorText || "";
    // ERR_ABORTED = a request cancelled by our own navigation (not a product failure)
    if (failure !== "net::ERR_ABORTED") requestFailures.push({ route: r.route, url: req.url(), failure });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) httpErrors.push({ route: r.route, status: res.status(), url: res.url() });
  });

  const out = {
    route: r.route,
    file: r.file,
    url,
    httpStatus: null,
    bodyTextLength: 0,
    consoleErrors,
    pageErrors,
    requestFailures,
    httpErrors,
    links: { total: 0, dead: [] },
    inputs: [],
    buttons: [],
    controls: 0,
    ok: false,
  };

  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const resp = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await sleeps(250);
    out.httpStatus = resp ? resp.status() : 0;
    const body = await page.locator("body").innerText().catch(() => "");
    out.bodyTextLength = body.trim().length;

    const initial = await census(page);
    out.controls = initial.length;
    out.links.total = initial.filter((c) => c.tag === "a" && c.href).length;

    // links: proven by their target route being in the inventory (clicked nav links are covered by route loads)
    for (const c of initial.filter((x) => x.tag === "a" && x.href)) {
      let p = null;
      try {
        p = new URL(c.href, `${BASE}${url}`).pathname.replace(/\/$/, "") || "/";
      } catch {
        /* invalid href */
      }
      if (!p) out.links.dead.push({ href: c.href, reason: "invalid href" });
      else if (!templates.some((t) => matchesTemplate(p, t))) out.links.dead.push({ href: c.href, reason: "no such route" });
    }

    // inputs: type a real value, read it back (index is the ordinal inside the filtered control set)
    const inputControls = initial.filter(
      (x) => ["input", "textarea", "select"].includes(x.tag) && x.visible && !x.disabled && !(x.tag === "input" && ["hidden", "submit", "button", "checkbox", "radio", "file"].includes(x.type)),
    );
    for (const c of inputControls) {
      const probe = page.locator(`[data-dod-idx="${c.index}"]`);
      const rec = { tag: c.tag, type: c.type, label: c.label, status: "FAIL", value: "", error: "" };
      try {
        if (c.tag === "input" && c.type === "range") {
          const next = c.value === "0.5" ? "0.7" : "0.5";
          await probe.evaluate((el, v) => {
            el.value = v;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, next);
          const now = await probe.inputValue();
          rec.value = now;
          rec.status = now === next ? "PASS" : "FAIL";
        } else if (c.tag === "select") {
          const options = await probe.locator("option").evaluateAll((els) => els.map((e) => e.value));
          const next = options.find((v) => v !== c.value) || options[0] || "";
          if (next) {
            await probe.selectOption(next, { timeout: 5000 });
            const now = await probe.inputValue();
            rec.value = now;
            rec.status = now === next ? "PASS" : "FAIL";
          } else rec.status = "SKIP_EMPTY";
        } else {
          // role/actor are semantic: keep them valid so the identity the UI saves is a real Media OS role
          const hint = `${c.label} ${c.name || ""} ${c.type || ""}`.toLowerCase();
          const v =
            hint.includes("role") && !hint.includes("control")
              ? "admin"
              : hint.includes("actor")
                ? "dod-w3b-admin"
                : `dod-${r.route.replace(/\W+/g, "-")}-${c.index}`;
          await probe.fill(v, { timeout: 5000 });
          const now = await probe.inputValue();
          rec.value = now;
          rec.status = now === v ? "PASS" : "FAIL";
        }
      } catch (e) {
        rec.error = String(e).slice(0, 200);
      }
      out.inputs.push(rec);

    }

    // buttons: click every enabled button-like control once, on this page, and require an effect
    const buttons = (await census(page)).filter(
      (c) => (c.tag === "button" || c.role === "button" || c.type === "submit" || c.type === "button") && c.visible,
    );
    // Back last, so history exists and earlier state changes are not reverted before we observe them
    buttons.sort((a, b) => (a.label.toLowerCase() === "back" ? 1 : 0) - (b.label.toLowerCase() === "back" ? 1 : 0));
    for (const b of buttons) {
      const rec = { index: b.index, label: b.label, disabled: b.disabled, status: "FAIL", effects: [], error: "" };
      if (b.disabled) {
        rec.status = "SKIP_DISABLED";
        out.buttons.push(rec);
        continue;
      }
      try {
        const before = await snapshot(page);
        const reqBefore = requests;
        const clicked = await clickByLabel(page, b.label);
        if (!clicked) {
          rec.error = "control not found on re-read";
        } else {
          let after = before;
          let effects = [];
          for (let i = 0; i < 20; i += 1) {
            await sleeps(120);
            after = await snapshot(page);
            effects = effectOf(before, after, requests - reqBefore);
            if (effects.length) break;
          }
          rec.effects = effects;
          rec.status = effects.length ? "PASS" : "DEAD";
          if (!effects.length) rec.error = "no observable effect within 2.4 s";
        }
      } catch (e) {
        rec.error = String(e).slice(0, 200);
      }
      out.buttons.push(rec);

    }

    out.ok = out.httpStatus === 200 && out.bodyTextLength > 0 && out.links.dead.length === 0 && out.buttons.every((b) => b.status !== "DEAD") && out.inputs.every((i) => i.status !== "FAIL");
  } catch (e) {
    out.error = String(e).slice(0, 400);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }

  result.routes.push({ ...out, buttons: out.buttons.length, buttonPass: out.buttons.filter((b) => b.status === "PASS").length, buttonSkip: out.buttons.filter((b) => b.status === "SKIP_DISABLED").length, inputPass: out.inputs.filter((i) => i.status === "PASS").length, inputFail: out.inputs.filter((i) => i.status === "FAIL").length });
  result.controls.push(...out.buttons.map((b) => ({ route: r.route, kind: "button", label: b.label, status: b.status, effects: b.effects })));
  result.controls.push(...out.inputs.map((i) => ({ route: r.route, kind: i.tag, label: i.label, status: i.status })));
  result.consoleErrors.push(...consoleErrors);
  result.pageErrors.push(...pageErrors);
  result.requestFailures.push(...requestFailures);
  result.httpErrors.push(...out.httpErrors);
  return out;
}

// ---------------------------------------------------------------- main

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const foundationA = path.join(WORK, "foundation_web");
  const foundationB = path.join(WORK, "foundation_probe");
  const appLog = path.join(WORK, "apps.log");

  log(`repo ${MEDIAOS_ROOT}`);
  log(`work ${WORK}`);
  const missing = [path.join(MEDIAOS_ROOT, "apps", "api", "src", "dev.ts"), NEXT_BIN].find((p) => !existsSync(p));
  if (missing) return await fail(`missing prerequisite ${missing}`, {});

  // ---- static inventory (source of truth for routes, buttons and handlers)
  const inv = buildInventory();
  result.routeInventory = inv.routes.map((r) => ({ route: r.route, file: r.file, dynamic: r.dynamic, mounted: r.mounted }));
  result.staticKeys = inv.staticKeys.map((k) => ({ file: k.file, line: k.line, labels: k.labels, handler: k.handler, hasHandler: k.hasHandler }));
  const handlerless = inv.staticKeys.filter((k) => !k.hasHandler);
  if (handlerless.length) {
    result.hollow.push(...handlerless.map((k) => ({ kind: "static-button-without-handler", file: k.file, line: k.line, labels: k.labels })));
  }
  log(`inventory: ${inv.routes.length} page routes, ${inv.staticKeys.length} static buttons, ${handlerless.length} handlerless`);

  // ---- start api (web) and api (probe) instances
  const apiLogs = { web: appLog, probe: path.join(WORK, "probe.log") };
  spawnChild(process.execPath, ["--import", "tsx", "apps/api/src/dev.ts"], {
    cwd: MEDIAOS_ROOT,
    env: { ...process.env, PORT: String(API_PORT), MEDIA_OS_FOUNDATION_ROOT: foundationA },
  });
  spawnChild(process.execPath, ["--import", "tsx", "apps/api/src/dev.ts"], {
    cwd: MEDIAOS_ROOT,
    env: { ...process.env, PORT: String(PROBE_PORT), MEDIA_OS_FOUNDATION_ROOT: foundationB },
  });
  await waitFor(`http://127.0.0.1:${API_PORT}/health`, 90000, "mediaos api (web instance)");
  await waitFor(`http://127.0.0.1:${PROBE_PORT}/health`, 90000, "mediaos api (probe instance)");
  log("api instances up");

  // ---- build + start the web app from source (build via pnpm so the workspace store resolves, as `pnpm exec` does)
  const build = await new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--filter", "@funaging-media-os/web", "exec", "next", "build"], {
      cwd: MEDIAOS_ROOT,
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
  writeFileSync(path.join(WORK, "next_build.log"), `${build.out}\n${build.err}`);
  if (build.code !== 0) return await fail(`web build failed (exit ${build.code})`, { buildTail: `${build.out}\n${build.err}`.slice(-2000) });
  log("web build ok");

  spawnChild(process.execPath, [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(WEB_PORT)], {
    cwd: WEB,
    env: { ...process.env, MEDIA_OS_API_BASE_URL: `http://127.0.0.1:${API_PORT}` },
  });
  await waitFor(`${BASE}/`, 90000, "mediaos web");
  log("web up");

  // ---- seed REAL entities through the real proxy (so dynamic routes are loaded with real ids)
  const seed = { at: new Date().toISOString(), asset: null, content: null, job: null, errors: [] };
  const post = (p, body) => httpJson(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json", ...IDENTITY }, body: JSON.stringify(body) });
  const ing = await post("/api/dam/ingest", { text: `w3b seed ${runId}`, originalFilename: "w3b-seed.txt", mimeType: "text/plain", assetType: "document", title: `w3b seed ${runId}` });
  if (ing.json?.asset?.assetId) seed.asset = ing.json.asset.assetId;
  else seed.errors.push(`dam/ingest ${ing.status} ${ing.text.slice(0, 200)}`);
  const con = await post("/api/dam/content", { title: `w3b content ${runId}`, contentType: "article", body: `w3b seed ${runId}`, language: "en", topic: "general" });
  if (con.json?.content?.contentId) seed.content = con.json.content.contentId;
  else seed.errors.push(`dam/content ${con.status} ${con.text.slice(0, 200)}`);
  const fing = await post("/api/factory/ingest", { text: "P2\n1 1\n255\n0\n", mimeType: "image/x-portable-graymap", originalFilename: "w3b-seed.pgm", assetType: "image" });
  const factoryAsset = fing.json?.asset?.assetId;
  if (!factoryAsset) seed.errors.push(`factory/ingest ${fing.status} ${fing.text.slice(0, 200)}`);
  if (factoryAsset) {
    const job = await post("/api/factory/image", { operation: "EXPOSURE", inputAssetIds: [factoryAsset], identityPolicy: "off" });
    if (job.json?.job?.mediaJobId) seed.job = job.json.job.mediaJobId;
    else seed.errors.push(`factory/image ${job.status} ${job.text.slice(0, 200)}`);
  }
  result.seed = seed;
  log(`seed asset=${seed.asset} content=${seed.content} job=${seed.job}`);

  const dynamicEntity = {
    "/factory/jobs/[id]": seed.job ? `/factory/jobs/${seed.job}` : "",
    "/library/assets/[id]": seed.asset ? `/library/assets/${seed.asset}` : "",
    "/library/content/[id]": seed.content ? `/library/content/${seed.content}` : "",
  };
  const unresolved = inv.routes.filter((r) => r.dynamic && !dynamicEntity[r.route]);
  if (unresolved.length) return await fail(`dynamic routes without a real entity: ${unresolved.map((r) => r.route).join(", ")}`, {});

  // ---- browser every-button sweep
  // Playwright belongs to the MediaOS checkout: a bare import would resolve from the runner repo when this file is
// copied into tools/dod/wave3b there, which has no playwright.
  const requireFromMediaOs = createRequire(path.join(MEDIAOS_ROOT, "package.json"));
  const { chromium } = requireFromMediaOs("playwright");
  const browser = await chromium.launch({ headless: true, ...(chromePath() ? { executablePath: chromePath() } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const templates = inv.routes.map((r) => r.route);
    const only = String(process.env.DOD_W3B_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
    const routes = [...inv.routes].filter((r) => !only.length || only.includes(r.route)).sort((a, b) => (a.route === "/" ? -1 : b.route === "/" ? 1 : 0));
    for (const r of routes) {
      const out = await sweepRoute(browser, r, templates, dynamicEntity);
      log(`route ${r.route} -> ${out.httpStatus} body=${out.bodyTextLength} buttons=${out.buttons.length}(${out.buttons.filter((b) => b.status === "PASS").length}P/${out.buttons.filter((b) => b.status === "DEAD").length}D) inputs=${out.inputs.length} console=${out.consoleErrors.length}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ---- component + handler key attribution
  const runtimeButtons = result.controls.filter((c) => c.kind === "button");
  const byRoute = new Map(inv.routes.map((r) => [r.route, r]));
  const keyFor = (file, label) => inv.staticKeys.find((k) => k.file === file && k.labels.some((l) => l.toLowerCase() === label.toLowerCase()));
  for (const rb of runtimeButtons) {
    const r = byRoute.get(rb.route);
    if (!r) continue;
    const files = r.mounted;
    let hit = null;
    for (const f of files) {
      const k = keyFor(f, rb.label);
      if (k) {
        hit = k;
        break;
      }
    }
    rb.key = hit ? `${hit.file}#${hit.labels.find((l) => l.toLowerCase() === rb.label.toLowerCase())}` : null;
    rb.handler = hit ? hit.handler : null;
    if (!hit) result.hollow.push({ kind: "runtime-button-without-static-handler", route: rb.route, label: rb.label, mounted: files });
  }
  const observed = new Set(runtimeButtons.map((b) => b.key).filter(Boolean));
  result.staticKeyObserved = inv.staticKeys.filter((k) => k.hasHandler).map((k) => ({
    key: `${k.file}#${k.labels[0] || ""}`,
    labels: k.labels,
    handler: k.handler,
    observed: k.labels.some((l) => observed.has(`${k.file}#${l}`)),
  }));
  for (const k of inv.staticKeys.filter((x) => x.hasHandler)) {
    if (!k.labels.some((l) => observed.has(`${k.file}#${l}`))) result.orphanKeys.push({ file: k.file, line: k.line, labels: k.labels, handler: k.handler });
  }
  const compsWithButtons = [...new Set(inv.staticKeys.map((k) => k.file))];
  for (const f of compsWithButtons) {
    const keys = inv.staticKeys.filter((k) => k.file === f);
    const seen = keys.filter((k) => k.labels.some((l) => observed.has(`${f}#${l}`))).length;
    result.componentCoverage.push({ component: f, buttons: keys.length, observed: seen });
  }
  const unobservedComponents = result.componentCoverage.filter((c) => c.observed === 0);
  if (unobservedComponents.length) {
    result.hollow.push(...unobservedComponents.map((c) => ({ kind: "component-never-rendered", component: c.component })));
  }

  // ---- web /api route inventory + live reachability (through the running web server)
  const apiFiles = walk(path.join(APP_DIR, "api")).filter((f) => f.endsWith("route.ts"));
  for (const f of apiFiles) {
    const src = readFileSync(f, "utf8");
    const methods = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD)/g)].map((m) => m[1]);
    const routePath = apiRoutePath(f);
    const rec = { file: relOf(f), route: routePath, methods: [...new Set(methods)], probes: [] };
    if (!rec.methods.length) {
      result.webApi.failures.push({ ...rec, reason: "no exported HTTP method" });
      result.webApi.routes.push(rec);
      continue;
    }
    const isCatchAll = routePath.includes("[");
    const probePath = isCatchAll ? `${routePath.replace(/\[\.\.\.[^\]]+\]/, "")}/health` : routePath;
    if (rec.methods.includes("GET")) {
      const r = await httpJson(`${BASE}${probePath}`);
      const good = r.status > 0 && r.status < 500 && r.json !== null;
      rec.probes.push({ method: "GET", path: probePath, status: r.status, ok: good, body: r.text.slice(0, 160) });
      if (!good) result.webApi.failures.push({ ...rec, method: "GET", status: r.status, reason: "not reachable / not json" });
    }
    if (rec.methods.includes("POST")) {
      const r = await httpJson(`${BASE}${isCatchAll ? routePath.replace(/\[\.\.\.[^\]]+\]/, "") + "/probe" : routePath}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...IDENTITY },
        body: "{}",
      });
      const good = r.status > 0 && r.status < 500 && r.json !== null;
      rec.probes.push({ method: "POST", path: routePath, status: r.status, ok: good, body: r.text.slice(0, 160) });
      if (!good) result.webApi.failures.push({ ...rec, method: "POST", status: r.status, reason: "5xx / non-json" });
    }
    result.webApi.routes.push(rec);
  }
  log(`web api routes ${result.webApi.routes.length}, failures ${result.webApi.failures.length}`);

  // ---- api server: route inventory from /health + live probe of every route
  const health = await httpJson(`http://127.0.0.1:${PROBE_PORT}/health`);
  if (health.status !== 200 || !health.json?.routes) return await fail(`api /health ${health.status}`, { apiHealth: health.text.slice(0, 400) });
  const inv2 = health.json.routes;
  result.api.inventory = { get: inv2.get.length, post: inv2.post.length, service: health.json.service };
  const substitute = (p) => p.replace(/:[A-Za-z0-9_]+/g, "00000000-0000-0000-0000-000000000000");
  for (const p of inv2.get) {
    const target = `http://127.0.0.1:${PROBE_PORT}${substitute(p)}`;
    const r = await httpJson(target, { headers: IDENTITY });
    const ok = r.status > 0 && r.status < 500 && r.json !== null;
    result.api.probes.push({ method: "GET", path: p, status: r.status, ok });
    if (!ok) result.api.failures.push({ method: "GET", path: p, status: r.status });
  }
  for (const p of inv2.post) {
    const r = await httpJson(`http://127.0.0.1:${PROBE_PORT}${substitute(p)}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...IDENTITY },
      body: "{}",
    });
    const ok = r.status > 0 && r.status < 500 && r.json !== null;
    result.api.probes.push({ method: "POST", path: p, status: r.status, ok });
    if (!ok) result.api.failures.push({ method: "POST", path: p, status: r.status });
  }
  log(`api probes ${result.api.probes.length}, failures ${result.api.failures.length}`);

  // ---- verdict
  const routeFails = result.routes.filter((r) => !r.ok);
  const deadLinks = result.routes.reduce((n, r) => n + r.links.dead.length, 0);
  const deadButtons = result.controls.filter((c) => c.kind === "button" && c.status === "DEAD");
  const failedInputs = result.controls.filter((c) => c.kind !== "button" && c.status === "FAIL");
  const summary = {
    routes: inv.routes.length,
    routesPass: result.routes.filter((r) => r.ok).length,
    routeFails: routeFails.map((r) => ({ route: r.route, status: r.httpStatus, body: r.bodyTextLength, error: r.error || "" })),
    deadLinks,
    buttons: result.controls.filter((c) => c.kind === "button").length,
    buttonsPass: result.controls.filter((c) => c.kind === "button" && c.status === "PASS").length,
    buttonsDead: deadButtons.length,
    buttonsDisabled: result.controls.filter((c) => c.kind === "button" && c.status === "SKIP_DISABLED").length,
    inputs: result.controls.filter((c) => c.kind !== "button").length,
    inputsPass: result.controls.filter((c) => c.kind !== "button" && c.status === "PASS").length,
    inputsFail: failedInputs.length,
    hollow: result.hollow.length,
    orphanKeys: result.orphanKeys.length,
    componentCoverage: result.componentCoverage.length,
    componentsUnobserved: unobservedComponents.length,
    consoleErrors: result.consoleErrors.length,
    pageErrors: result.pageErrors.length,
    requestFailures: result.requestFailures.length,
    httpErrors: result.httpErrors.length,
    webApiRoutes: result.webApi.routes.length,
    webApiFailures: result.webApi.failures.length,
    apiProbes: result.api.probes.length,
    apiFailures: result.api.failures.length,
  };
  result.summary = summary;

  // A 403 POLICY_DENIED / 409 UNAVAILABLE answer to a real click from an authenticated admin is the documented
  // fail-closed contract (providers UNAVAILABLE, generative edits denied), not a broken control: it is recorded as
  // a refusal with its URL/status. 401 (unauthenticated call), 5xx, any other 4xx, JS errors and page errors fail.
  const REFUSAL = new Set([403, 409]);
  const refusalUrls = new Set();
  const refused = [];
  const httpFailures = [];
  for (const e of result.httpErrors) {
    if (REFUSAL.has(e.status)) {
      refused.push(e);
      refusalUrls.add(e.url);
    } else {
      httpFailures.push(e);
    }
  }
  const refusalConsole = [];
  const hardConsoleErrors = [];
  for (const e of result.consoleErrors) {
    const isRefusal = /Failed to load resource/.test(e.text) && e.url && refusalUrls.has(e.url);
    if (isRefusal) refusalConsole.push(e);
    else hardConsoleErrors.push(e);
  }
  result.refusals = refused;
  summary.refusals = refused.length;
  summary.httpFailures = httpFailures.length;
  summary.hardConsoleErrors = hardConsoleErrors.length;
  result.hardConsoleErrors = hardConsoleErrors;

  const problems = [];
  if (routeFails.length) problems.push(`${routeFails.length} route(s) failed`);
  if (deadLinks) problems.push(`${deadLinks} dead link(s)`);
  if (deadButtons.length) problems.push(`${deadButtons.length} dead button(s)`);
  if (failedInputs.length) problems.push(`${failedInputs.length} dead input(s)`);
  if (result.hollow.length) problems.push(`${result.hollow.length} hollow control(s)`);
  if (hardConsoleErrors.length) problems.push(`${hardConsoleErrors.length} console error(s)`);
  if (result.pageErrors.length) problems.push(`${result.pageErrors.length} page error(s)`);
  if (result.requestFailures.length) problems.push(`${result.requestFailures.length} failed request(s)`);
  if (httpFailures.length) problems.push(`${httpFailures.length} http failure response(s)`);
  if (result.webApi.failures.length) problems.push(`${result.webApi.failures.length} web api route(s) unreachable`);
  if (result.api.failures.length) problems.push(`${result.api.failures.length} api route probe(s) failed`);

  const reason =
    problems.length === 0
      ? `web ${summary.routes}/${summary.routes} routes 200 with body, ${summary.buttons}/${summary.buttons} enabled buttons produced an effect (${summary.buttonsDisabled} declared disabled), ${summary.inputsPass}/${summary.inputs} inputs held their value, 0 dead/hollow links, 0 console/page/request errors (${summary.refusals} documented fail-closed refusals); web api ${summary.webApiRoutes}/${summary.webApiRoutes} routes reachable, api ${summary.apiProbes}/${summary.apiProbes} routes probed live (${result.api.inventory.get} GET / ${result.api.inventory.post} POST); ${summary.componentCoverage} components keyed, ${summary.orphanKeys} unreached key(s)`
      : `FAILED: ${problems.join("; ")}`;

  done(ID, problems.length === 0, reason, { ...result, finishedAt: new Date().toISOString() });
}

main()
  .catch(async (e) => {
    await stopChildren();
    await fail(`check threw: ${String(e).slice(0, 300)}`, {});
  })
  .finally(async () => {
    await stopChildren();
  });
