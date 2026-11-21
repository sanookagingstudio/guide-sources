#!/usr/bin/env node
// G2-W3B-FIELDAPP - Every-button DoD for the Funaging field app (Vite + React SPA).
//
// The item is PASS only when, against the REAL app built from this source tree and served on 127.0.0.1:
//   1. route inventory   - every <Route> declared in src/App.tsx (and the "*" fallback) loads with HTTP 200
//                          and a non-empty body, with the dynamic trip route loaded with a REAL trip id;
//   2. control census    - every control (button / role=button / input / textarea / select / link) on every
//                          route is enumerated and recorded in the evidence file;
//   3. click-effect      - every enabled button-like control is really clicked and must produce an observable
//                          effect (URL, DOM text/size, dialog, control state or a same-origin request);
//                          every input/textarea/select is really typed/selected and must hold its value;
//                          every checkbox is really clicked and must flip its checked state;
//   4. component+handler - every rendered button is attributed to a static key
//      keys                 (src/App.tsx#<Component>#<label>) inside the component closure of its route,
//                          and that key must declare a real onClick/onSubmit handler (0 HOLLOW);
//                          every control instance rendered at runtime must resolve to such a static tag;
//   5. zero hollow/dead/console - 0 hollow controls, 0 dead controls, 0 dead links, 0 console errors,
//                          0 page errors, 0 failed requests, 0 4xx/5xx responses.
//
// Writes are local only: the static build goes to the app's own dist/ (already gitignored) and the run log to
// tracks\C\tmp. Nothing is uploaded, nothing is deployed.
// Evidence: D:\FUNAGING_TEMP\tracks\<track>\evidence\dod\G2-W3B-FIELDAPP_latest.json
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromePath, done, repoRoot } from "../lib/harness.mjs";

const ID = process.env.DOD_W3B_SELFTEST ? "G2-W3B-FIELDAPP_SELFTEST" : "G2-W3B-FIELDAPP";
// The canonical copy lives in the field-app repo; the same file is copied into the track runner repo
// (guide-sources tools/dod/wave3b) so the wave driver can run it. Resolve the checkout explicitly there.
const FIELD_ROOT = process.env.DOD_FIELDAPP_ROOT
  || (existsSync(path.join(repoRoot, "src", "App.tsx")) ? repoRoot : "D:\\FUNAGING_WEB\\01_ACTIVE\\funaging-field-app__2C9CF4FBE075");
const APP_TSX = path.join(FIELD_ROOT, "src", "App.tsx");
const DATA_TS = path.join(FIELD_ROOT, "src", "data", "fieldData.ts");
const DIST = path.join(FIELD_ROOT, "dist");
const WORK = path.join("D:\\FUNAGING_TEMP\\tracks\\C\\tmp", "w3b_fieldapp");
const PORT = Number(process.env.DOD_W3B_FIELDAPP_PORT || 4395);
const BASE = `http://127.0.0.1:${PORT}`;
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const sleeps = (ms) => new Promise((r) => setTimeout(r, ms));

const result = {
  id: ID,
  repo: FIELD_ROOT,
  base: BASE,
  work: WORK,
  startedAt: new Date().toISOString(),
  build: null,
  routeInventory: [],
  staticKeys: [],
  staticLinks: [],
  componentCoverage: [],
  routes: [],
  controls: [],
  hollow: [],
  dead: [],
  orphanKeys: [],
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  httpErrors: [],
  steps: [],
};

let server = null;
const log = (m) => {
  result.steps.push({ at: new Date().toISOString(), msg: m });
  console.log(`[w3b] ${m}`);
};

async function fail(reason, extra = {}) {
  if (server) server.close();
  done(ID, false, reason, { ...result, ...extra, finishedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------- static source analysis

// Scan a JSX/HTML tag starting at src[start] === "<", tracking {} depth and quotes so "=>" or a nested
// template literal does not end the tag. Returns { attrs, end } where end is just after the closing ">".
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
  const names = new Set(components.map((c) => c.name));

  // routes: every <Route path="..." element={<Component ... />
  const routes = [];
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<([A-Za-z0-9_]+)/g)) {
    routes.push({ path: m[1], component: m[2], template: m[1], dynamic: m[1].includes(":"), catchAll: m[1] === "*" });
  }

  // controls, keyed by their enclosing component
  const staticKeys = [];
  const staticLinks = [];
  const tagRe = /<(button|input|select|textarea|Link)\b/g;
  let m;
  while ((m = tagRe.exec(src)) !== null) {
    const tag = m[1];
    if (tag === "Link" && src[m.index + 5] !== " ") continue; // e.g. <LinkList is not a <Link
    const tagInfo = scanTag(src, m.index);
    if (!tagInfo) continue;
    const comp = componentAt(components, m.index);
    if (!comp) continue;
    const line = lineOf(src, m.index);
    if (tag === "Link") {
      const to = attrValue(tagInfo.attrs, "to");
      const toExpression = handlerOf(tagInfo.attrs, "to");
      staticLinks.push({ component: comp.name, line, to: to || toExpression, hasTarget: Boolean(to || toExpression) });
      continue;
    }
    if (tag === "button") {
      const close = src.indexOf("</button>", tagInfo.end);
      const content = close === -1 ? "" : src.slice(tagInfo.end, close);
      const onClick = handlerOf(tagInfo.attrs, "onClick");
      const onSubmit = handlerOf(tagInfo.attrs, "onSubmit");
      const type = attrValue(tagInfo.attrs, "type");
      const labels = labelsOf(content);
      staticKeys.push({
        kind: "button",
        key: `${comp.name}#${labels[0] || `line${line}`}`,
        component: comp.name,
        line,
        labels,
        handler: onClick || onSubmit || "",
        hasHandler: Boolean(onClick || onSubmit) || type === "submit",
      });
      continue;
    }
    const type = attrValue(tagInfo.attrs, "type");
    const onChange = handlerOf(tagInfo.attrs, "onChange");
    const onInput = handlerOf(tagInfo.attrs, "onInput");
    const tagKey = `${tag}${type ? `[${type}]` : ""}@${line}`;
    staticKeys.push({
      kind: tag,
      inputType: type,
      key: `${comp.name}#${tagKey}`,
      component: comp.name,
      line,
      labels: [],
      handler: onChange || onInput || "",
      hasHandler: Boolean(onChange || onInput),
    });
  }

  // component closure per route: the element component plus every component it renders (one file app)
  const closureOf = (root) => {
    const seen = new Set([root]);
    const queue = [root];
    while (queue.length) {
      const name = queue.pop();
      const current = components.find((c) => c.name === name);
      if (!current) continue;
      const body = src.slice(current.start, current.end);
      for (const ref of body.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)) {
        const child = ref[1];
        if (!names.has(child) || seen.has(child)) continue;
        seen.add(child);
        queue.push(child);
      }
    }
    return [...seen];
  };
  for (const r of routes) r.closure = closureOf(r.component);
  return { src, components, routes, staticKeys, staticLinks };
}

function matchesTemplate(pathname, template) {
  if (template === "*") return true;
  const a = pathname.replace(/\/$/, "").split("/").filter(Boolean);
  const b = template.replace(/\/$/, "").split("/").filter(Boolean);
  if (a.length !== b.length) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (b[i].startsWith(":")) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------- static server (SPA fallback, like vercel.json)

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const urlPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
      const file = path.join(DIST, urlPath);
      if (!file.toLowerCase().startsWith(DIST.toLowerCase())) {
        res.writeHead(403).end("no");
        return;
      }
      if (existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
        res.end(readFileSync(file));
        return;
      }
      // the app's vercel.json rewrites every unknown path to /index.html
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(path.join(DIST, "index.html")));
    });
    srv.on("error", reject);
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
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
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
        checked: typeof el.checked === "boolean" ? el.checked : null,
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
      const name = norm(el.getAttribute("aria-label") || el.innerText || el.getAttribute("value") || el.getAttribute("title") || "").toLowerCase();
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
    // strip the sweep's own bookkeeping attributes: they must never count as a product effect
    html: document.body.innerHTML.replace(/ data-dod-(?:idx|clicked)="[^"]*"/g, "").length,
    dialogs: document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]').length,
    states: [...document.querySelectorAll('button, [role="button"], input, select, textarea')]
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

async function preStep(page, r) {
  const info = {};
  if (r.path === "/media") {
    // drive the REAL capture input (the file picker behind the label) so the conditional "Remove" control exists
    await page.goto(`${BASE}/media`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleeps(250);
    const input = page.locator('input[data-media-input="true"]');
    await input.setInputFiles({ name: "w3b-field-photo.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await sleeps(600);
    info.mediaSeed = (await page.getByText("w3b-field-photo.png").count()) > 0 ? "queued photo visible" : "photo NOT visible";
  }
  if (r.path === "/action-log") {
    // queue one real action through the Checklist UI so the outbox screen has something to report on
    await page.goto(`${BASE}/checklist`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleeps(300);
    const box = page.locator('input[type="checkbox"]').first();
    if (await box.count()) {
      await box.click();
      await sleeps(200);
    }
    info.queueSeed = await page.evaluate(() => Boolean(window.localStorage.getItem("field-action-log")));
  }
  return info;
}

// Wait until the DOM stops changing, so an async update started by the PREVIOUS action can never be
// mistaken for the effect of the next click.
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

async function sweepRoute(browser, r, templates) {
  const url = r.testUrl;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera"] });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const httpErrors = [];
  let requests = 0;
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ route: r.label, text: msg.text(), url: (msg.location() || {}).url || "" });
  });
  page.on("pageerror", (e) => pageErrors.push({ route: r.label, text: String(e) }));
  page.on("request", (req) => {
    if (["fetch", "xhr"].includes(req.resourceType())) requests += 1;
  });
  page.on("requestfailed", (req) => {
    const failure = (req.failure() || {}).errorText || "";
    if (failure !== "net::ERR_ABORTED") requestFailures.push({ route: r.label, url: req.url(), failure });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) httpErrors.push({ route: r.label, status: res.status(), url: res.url() });
  });

  const out = {
    route: r.label,
    component: r.component,
    file: "src/App.tsx",
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
    preStep: null,
    ok: false,
  };

  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    out.preStep = await preStep(page, r);
    const resp = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await sleeps(250);
    out.httpStatus = resp ? resp.status() : 0;
    const body = await page.locator("body").innerText().catch(() => "");
    out.bodyTextLength = body.trim().length;
    // fail-closed control: an injected button with no handler and no effect must make this route FAIL
    if (process.env.DOD_W3B_SELFTEST === "dead") {
      await page.evaluate(() => {
        const b = document.createElement("button");
        b.type = "button";
        b.id = "dod-dead-probe";
        b.textContent = "DOD dead probe";
        document.body.appendChild(b);
      });
    }

    const initial = await census(page);
    out.controls = initial.length;
    out.links.total = initial.filter((c) => c.tag === "a" && c.href).length;

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

    // inputs: type/select/check a real value, read it back
    const inputControls = initial.filter(
      (x) => ["input", "textarea", "select"].includes(x.tag) && x.visible && !x.disabled
        && !(x.tag === "input" && ["hidden", "submit", "button", "file"].includes(x.type)),
    );
    const ordinals = new Map();
    for (const c of inputControls) {
      const group = `${c.tag}|${c.type}|${c.label}`;
      const ordinal = ordinals.get(group) || 0;
      ordinals.set(group, ordinal + 1);
      const rec = { tag: c.tag, type: c.type, label: c.label, status: "FAIL", value: "", error: "" };
      try {
        const idx = await page.evaluate(({ group, ordinal }) => {
          const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
          const visible = (el) => {
            const st = window.getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
            return el.getClientRects().length > 0;
          };
          const nodes = [...document.querySelectorAll('button, [role="button"], input, textarea, select, a[href]')];
          nodes.forEach((el, index) => el.setAttribute("data-dod-idx", String(index)));
          let seen = 0;
          for (let index = 0; index < nodes.length; index += 1) {
            const el = nodes[index];
            if (!["input", "textarea", "select"].includes(el.tagName.toLowerCase()) || !visible(el) || el.hasAttribute("disabled")) continue;
            const type = el.getAttribute("type") || "";
            if (el.tagName.toLowerCase() === "input" && ["hidden", "submit", "button", "file"].includes(type)) continue;
            const label =
              norm(el.getAttribute("aria-label")) ||
              norm(el.innerText) ||
              norm(el.getAttribute("value")) ||
              norm(el.getAttribute("title")) ||
              norm(el.getAttribute("placeholder")) ||
              norm(el.getAttribute("name")) ||
              "";
            if (`${el.tagName.toLowerCase()}|${type}|${label}` !== group) continue;
            if (seen === ordinal) return index;
            seen += 1;
          }
          return null;
        }, { group, ordinal });
        if (idx === null) {
          rec.error = "control not found on re-read";
          out.inputs.push(rec);
          continue;
        }
        const probe = page.locator(`[data-dod-idx="${idx}"]`);
        if (c.tag === "input" && c.type === "checkbox") {
          await probe.click({ timeout: 5000 });
          await sleeps(150);
          const now = await probe.isChecked();
          rec.value = String(now);
          rec.status = now === !c.checked ? "PASS" : "FAIL";
        } else if (c.tag === "select") {
          const options = await probe.locator("option").evaluateAll((els) => els.map((e) => e.value));
          const next = options.find((v) => v !== c.value) ?? options[0] ?? "";
          await probe.selectOption(next, { timeout: 5000 });
          const now = await probe.inputValue();
          rec.value = now;
          rec.status = now === next ? "PASS" : "FAIL";
        } else {
          const v = `dod-${r.label.replace(/\W+/g, "-")}-${c.index}`;
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

    // buttons: click every enabled button-like control once and require an observable effect
    const buttons = (await census(page)).filter(
      (c) => (c.tag === "button" || c.role === "button" || c.type === "submit" || c.type === "button") && c.visible,
    );
    for (const b of buttons) {
      const rec = { index: b.index, label: b.label, disabled: b.disabled, status: "FAIL", effects: [], error: "" };
      if (b.disabled) {
        rec.status = "SKIP_DISABLED";
        out.buttons.push(rec);
        continue;
      }
      try {
        await settle(page);
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

    out.ok = out.httpStatus === 200 && out.bodyTextLength > 0 && out.links.dead.length === 0
      && out.buttons.every((b) => b.status !== "DEAD") && out.inputs.every((i) => i.status !== "FAIL");
  } catch (e) {
    out.error = String(e).slice(0, 400);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }

  result.routes.push({
    ...out,
    buttonCount: out.buttons.length,
    buttonPass: out.buttons.filter((b) => b.status === "PASS").length,
    buttonSkip: out.buttons.filter((b) => b.status === "SKIP_DISABLED").length,
    inputPass: out.inputs.filter((i) => i.status === "PASS").length,
    inputFail: out.inputs.filter((i) => i.status === "FAIL").length,
  });
  result.controls.push(...out.buttons.map((b) => ({ route: r.label, kind: "button", label: b.label, status: b.status, effects: b.effects })));
  result.controls.push(...out.inputs.map((i) => ({ route: r.label, kind: i.tag, label: i.label, status: i.status })));
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
  log(`repo ${FIELD_ROOT}`);
  log(`work ${WORK}`);
  for (const need of [APP_TSX, DATA_TS, path.join(FIELD_ROOT, "package.json"), path.join(FIELD_ROOT, "index.html")]) {
    if (!existsSync(need)) return await fail(`missing prerequisite ${need}`, {});
  }
  const tripIds = [...readFileSync(DATA_TS, "utf8").matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (!tripIds.length) return await fail(`no trip id could be read from ${DATA_TS}`, {});

  // ---- build the real app from source (type-checked: tsc -b && vite build)
  const env = { ...process.env };
  delete env.VITE_FIELD_SYNC_URL; // the standalone build under test must be the committed one
  const build = await new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      cwd: FIELD_ROOT,
      shell: process.platform === "win32",
      env,
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
  result.build = { exit: build.code, tail: `${build.out}\n${build.err}`.slice(-1500) };
  if (build.code !== 0) return await fail(`real build failed (exit ${build.code})`, {});
  if (!existsSync(path.join(DIST, "index.html"))) return await fail(`build produced no ${path.join(DIST, "index.html")}`, {});
  result.build.distIndexBytes = statSync(path.join(DIST, "index.html")).size;
  log(`build ok (dist/index.html ${result.build.distIndexBytes} B)`);

  // ---- static inventory (source of truth for routes and control keys)
  const inv = buildInventory();
  result.routeInventory = inv.routes.map((r) => ({ route: r.path, component: r.component, dynamic: r.dynamic, catchAll: r.catchAll, closure: r.closure }));
  result.staticKeys = inv.staticKeys.map((k) => ({ key: k.key, kind: k.kind, component: k.component, line: k.line, labels: k.labels, handler: k.handler, hasHandler: k.hasHandler }));
  result.staticLinks = inv.staticLinks;
  const handlerless = inv.staticKeys.filter((k) => !k.hasHandler);
  if (handlerless.length) result.hollow.push(...handlerless.map((k) => ({ kind: "static-control-without-handler", key: k.key, line: k.line })));
  const targetlessLinks = inv.staticLinks.filter((l) => !l.hasTarget);
  if (targetlessLinks.length) result.hollow.push(...targetlessLinks.map((l) => ({ kind: "static-link-without-target", component: l.component, line: l.line })));
  log(`inventory: ${inv.routes.length} routes, ${inv.staticKeys.length} static controls, ${handlerless.length} handlerless, ${inv.staticLinks.length} links`);

  // ---- every route must resolve to a real url
  for (const r of inv.routes) {
    r.label = r.catchAll ? `${r.path} (${"/unknown-route"})` : r.dynamic ? r.path.replace(/:[A-Za-z0-9_]+/, tripIds[0]) : r.path;
    r.testUrl = r.catchAll ? "/unknown-route" : r.dynamic ? r.path.replace(/:[A-Za-z0-9_]+/, tripIds[0]) : r.path;
  }
  const dupes = new Set();
  const routes = inv.routes.filter((r) => {
    if (dupes.has(r.testUrl)) return false;
    dupes.add(r.testUrl);
    return true;
  });

  // ---- serve the built app exactly like the deployed static site
  server = await startServer();
  log(`serving ${DIST} on ${BASE}`);

  const requireFromFieldApp = createRequire(path.join(FIELD_ROOT, "package.json"));
  const { chromium } = requireFromFieldApp("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  } catch (e) {
    if (!chromePath()) throw e;
    browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  }
  try {
    const templates = inv.routes.map((r) => r.path);
    for (const r of routes) {
      const out = await sweepRoute(browser, r, templates);
      log(`route ${r.testUrl} -> ${out.httpStatus} body=${out.bodyTextLength} buttons=${out.buttons.length}(${out.buttons.filter((b) => b.status === "PASS").length}P/${out.buttons.filter((b) => b.status === "DEAD").length}D) inputs=${out.inputs.length}(${out.inputs.filter((i) => i.status === "PASS").length}P) console=${out.consoleErrors.length}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ---- component + handler key attribution
  const runtimeButtons = result.controls.filter((c) => c.kind === "button");
  const byRoute = new Map(inv.routes.map((r) => [r.label, r]));
  const observed = new Set();
  for (const rb of runtimeButtons) {
    const r = byRoute.get(rb.route);
    if (!r) continue;
    const candidates = inv.staticKeys.filter(
      (k) => k.kind === "button" && r.closure.includes(k.component) && k.labels.some((l) => l.toLowerCase() === rb.label.toLowerCase()),
    );
    const hit = candidates.find((k) => k.hasHandler) || candidates[0] || null;
    rb.key = hit ? hit.key : null;
    rb.handler = hit ? hit.handler : null;
    if (!hit) result.hollow.push({ kind: "runtime-button-without-static-tag", route: rb.route, label: rb.label, closure: r.closure });
    else if (!hit.hasHandler) result.hollow.push({ kind: "runtime-button-without-handler", route: rb.route, label: rb.label, key: hit.key });
    else observed.add(hit.key);
  }
  // every runtime input instance must resolve to a static tag with a handler in its component closure
  const runtimeInputs = result.routes.flatMap((r) => r.inputs.map((i) => ({ route: r.route, ...i })));
  const byRoute2 = new Map(inv.routes.map((r) => [r.label, r]));
  for (const ri of runtimeInputs) {
    const r = byRoute2.get(ri.route);
    if (!r) continue;
    const tag = ri.tag === "input" ? "input" : ri.tag;
    const hit = inv.staticKeys.find(
      (k) => k.kind === tag && r.closure.includes(k.component) && (!ri.type || !k.inputType || k.inputType === ri.type),
    );
    if (!hit) result.hollow.push({ kind: "runtime-input-without-static-tag", route: ri.route, tag: ri.tag, type: ri.type, label: ri.label, closure: r.closure });
    else if (!hit.hasHandler) result.hollow.push({ kind: "runtime-input-without-handler", route: ri.route, tag: ri.tag, key: hit.key });
    else observed.add(hit.key);
  }
  for (const k of inv.staticKeys.filter((x) => x.hasHandler)) {
    if (!observed.has(k.key)) result.orphanKeys.push({ key: k.key, kind: k.kind, line: k.line, labels: k.labels });
  }
  // the hidden file input is a real control: it is driven through the real file chooser in the /media pre-step
  const mediaSeeded = result.routes.some((r) => String((r.preStep || {}).mediaSeed || "").startsWith("queued photo visible"));
  if (mediaSeeded) {
    const fileKey = inv.staticKeys.find((k) => k.kind === "input" && k.inputType === "file");
    if (fileKey) {
      observed.add(fileKey.key);
      result.fileInputCapture = { key: fileKey.key, drove: "w3b-field-photo.png queued through the real file input" };
    }
  }
  for (const comp of [...new Set(inv.staticKeys.map((k) => k.component))]) {    const keys = inv.staticKeys.filter((k) => k.component === comp);
    result.componentCoverage.push({ component: comp, controls: keys.length, observed: keys.filter((k) => observed.has(k.key)).length });
  }
  const unobservedComponents = result.componentCoverage.filter((c) => c.observed === 0);
  if (unobservedComponents.length) result.hollow.push(...unobservedComponents.map((c) => ({ kind: "component-never-rendered", component: c.component })));

  // ---- verdict
  const routeFails = result.routes.filter((r) => !r.ok);
  const deadLinks = result.routes.reduce((n, r) => n + r.links.dead.length, 0);
  const deadButtons = result.controls.filter((c) => c.kind === "button" && c.status === "DEAD");
  const failedInputs = result.controls.filter((c) => c.kind !== "button" && c.status === "FAIL");
  const summary = {
    routes: routes.length,
    routesPass: result.routes.filter((r) => r.ok).length,
    routeFails: routeFails.map((r) => ({ route: r.route, status: r.httpStatus, body: r.bodyTextLength, error: r.error || "", dead: r.links.dead })),
    deadLinks,
    buttons: result.controls.filter((c) => c.kind === "button").length,
    buttonsPass: result.controls.filter((c) => c.kind === "button" && c.status === "PASS").length,
    buttonsDead: deadButtons.map((b) => ({ route: b.route, label: b.label })),
    buttonsDisabled: result.controls.filter((c) => c.kind === "button" && c.status === "SKIP_DISABLED").length,
    inputs: result.controls.filter((c) => c.kind !== "button").length,
    inputsPass: result.controls.filter((c) => c.kind !== "button" && c.status === "PASS").length,
    inputsFail: failedInputs.map((i) => ({ route: i.route, kind: i.kind, label: i.label })),
    hollow: result.hollow.length,
    orphanKeys: result.orphanKeys.length,
    componentCoverage: result.componentCoverage.length,
    componentsUnobserved: unobservedComponents.length,
    consoleErrors: result.consoleErrors.length,
    pageErrors: result.pageErrors.length,
    requestFailures: result.requestFailures.length,
    httpErrors: result.httpErrors.length,
  };
  result.summary = summary;

  const problems = [];
  if (routeFails.length) problems.push(`${routeFails.length} route(s) failed`);
  if (deadLinks) problems.push(`${deadLinks} dead link(s)`);
  if (deadButtons.length) problems.push(`${deadButtons.length} dead control(s) (${deadButtons.map((b) => `${b.route}:${b.label}`).join(", ")})`);
  if (failedInputs.length) problems.push(`${failedInputs.length} dead input(s) (${failedInputs.map((i) => `${i.route}:${i.label}`).join(", ")})`);
  if (result.hollow.length) problems.push(`${result.hollow.length} hollow control(s) (${result.hollow.map((h) => h.kind).join(", ")})`);
  if (result.consoleErrors.length) problems.push(`${result.consoleErrors.length} console error(s)`);
  if (result.pageErrors.length) problems.push(`${result.pageErrors.length} page error(s)`);
  if (result.requestFailures.length) problems.push(`${result.requestFailures.length} failed request(s)`);
  if (result.httpErrors.length) problems.push(`${result.httpErrors.length} http failure response(s)`);

  const reason = problems.length === 0
    ? `${summary.routes}/${summary.routes} routes 200 with body (real trip id), ${summary.buttonsPass}/${summary.buttons} enabled buttons produced an effect (${summary.buttonsDisabled} declared disabled), ${summary.inputsPass}/${summary.inputs} inputs held their value, 0 dead links/controls, 0 console/page/request errors, ${summary.componentCoverage} components keyed, ${summary.orphanKeys} unreached key(s)`
    : `FAILED: ${problems.join("; ")}`;

  if (server) server.close();
  done(ID, problems.length === 0, reason, { ...result, finishedAt: new Date().toISOString() });
}

main().catch(async (e) => {
  if (server) server.close();
  await fail(`check threw: ${String(e).slice(0, 300)}`);
});
