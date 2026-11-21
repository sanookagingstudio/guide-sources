// DoD check harness (DOD AS CODE, Owner 2026-11-22).
// Shared helpers for tools/dod/wave<N>/<item>.mjs. A check exits 0 ONLY when the item really works,
// writes an evidence JSON, and prints exactly one summary line: "PASS <id> <reason>" or "FAIL <id> <reason>".
// Nothing here fabricates evidence: every helper runs the real command / HTTP request / browser and records its output.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..", "..");
export const track = (process.env.FUNAGING_TRACK || "A").toUpperCase();
export const runId = process.env.DOD_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
export const evidenceDir = `D:\\FUNAGING_TEMP\\tracks\\${track}\\evidence\\dod`;
mkdirSync(evidenceDir, { recursive: true });

export const PROD = "https://funaging.club";
export const LOCAL = process.env.DOD_LOCAL_BASE || "http://127.0.0.1:5173";

export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || repoRoot,
      env: { ...process.env, ...(opts.env || {}) },
      shell: false,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
    }, opts.timeoutMs || 600000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

export const npx = (args, opts = {}) =>
  run(process.platform === "win32" ? "npx.cmd" : "npx", args, { shell: process.platform === "win32", ...opts });

// vitest through the local binary (avoids Windows shell quoting problems)
export const vitest = (args, opts = {}) =>
  run(process.execPath, ["node_modules/vitest/vitest.mjs", ...args], opts);

export async function httpGet(url, timeoutMs = 20000) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "funaging-dod-check" } });
    const body = await r.text();
    return { status: r.status, body, headers: Object.fromEntries(r.headers.entries()), ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, body: "", error: String(e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

export function chromePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || "";
}

export async function withBrowser(fn) {
  const { chromium } = await import("playwright");
  const launch = chromePath() ? { executablePath: chromePath() } : {};
  const browser = await chromium.launch(launch);
  try { return await fn(browser); } finally { await browser.close(); }
}

export function writeEvidence(id, data) {
  const payload = { id, track, runId, at: new Date().toISOString(), ...data };
  const file = path.join(evidenceDir, `${id}_${runId}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  writeFileSync(path.join(evidenceDir, `${id}_latest.json`), JSON.stringify(payload, null, 2));
  return file;
}

export function done(id, ok, reason, extra = {}) {
  const file = writeEvidence(id, { ok, reason, ...extra });
  const flat = String(reason).replace(/\s+/g, " ").trim().slice(0, 420);
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${flat} [evidence ${file}]`);
  process.exit(ok ? 0 : 1);
}

// One REAL browser sweep per run: control census + effect tests. Shared by A02..A04 so the sweep runs once.
export async function ensureBrowserSweep() {
  const dir = path.join(evidenceDir, ".cache", runId);
  mkdirSync(dir, { recursive: true });
  const meta = path.join(dir, "meta.json");
  if (existsSync(meta)) return JSON.parse(readFileSync(meta, "utf8"));
  const inv = path.join(dir, "controls.json");
  const eff = path.join(dir, "effects.json");
  const invRun = await run(process.execPath, ["tools/smoke/control-inventory.mjs", "--json", inv], { timeoutMs: 900000 });
  const effRun = await run(process.execPath, ["tools/smoke/control-effects.mjs", "--json", eff], { timeoutMs: 1500000 });
  const m = {
    dir, inv, eff, invCode: invRun.code, effCode: effRun.code,
    invTail: (invRun.out || "").slice(-800), effTail: (effRun.out || "").slice(-800),
    at: new Date().toISOString(),
  };
  writeFileSync(meta, JSON.stringify(m, null, 2));
  return m;
}

export function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

// One REAL browser media proof per run, shared by A07 and A14 (so the two checks cannot disagree and the
// heavy formflows run once). Each formflow authors blocks through the real admin UI on the LOCAL stack, then
// asserts the real public pages render them; production is never touched.
export async function ensureMediaFormflows() {
  const dir = path.join(evidenceDir, ".cache", runId);
  mkdirSync(dir, { recursive: true });
  const meta = path.join(dir, "media-formflows.json");
  if (existsSync(meta)) return JSON.parse(readFileSync(meta, "utf8"));
  const env = { PLAYWRIGHT_CHROMIUM_PATH: chromePath() };
  const flows = {
    entity: "tools/smoke/formflows/admin-media-blocks.formflow.mjs",
    website: "tools/smoke/formflows/admin-website-media-blocks.formflow.mjs",
  };
  const out = {};
  for (const [key, script] of Object.entries(flows)) {
    const r = await run(process.execPath, [script], { timeoutMs: 900000, env });
    const clean = `${r.out}\n${r.err}`.replace(/\u001b\[[0-9;]*m/g, "");
    // Both formflows end with one JSON document: { ok, passes, fails, results:[{control,verdict,evidence}], pageErrors }.
    let parsed = null;
    const at = clean.lastIndexOf("\n{");
    if (at > -1) {
      try { parsed = JSON.parse(clean.slice(at + 1)); } catch { parsed = null; }
    }
    const rows = Array.isArray(parsed?.results)
      ? parsed.results.map((x) => ({ verdict: x.verdict, control: String(x.control || ""), evidence: String(x.evidence || "").slice(0, 200) }))
      : [];
    out[key] = {
      script, exit: r.code,
      parsed: !!parsed,
      pass: parsed && Number.isFinite(parsed.passes) ? parsed.passes : rows.filter((x) => x.verdict === "PASS").length,
      fail: parsed && Number.isFinite(parsed.fails) ? parsed.fails : rows.filter((x) => x.verdict === "FAIL").length,
      pageErrors: Array.isArray(parsed?.pageErrors) ? parsed.pageErrors.length : null,
      rows,
      tail: clean.slice(-700),
    };
  }
  writeFileSync(meta, JSON.stringify({ at: new Date().toISOString(), flows: out }, null, 2));
  return { at: new Date().toISOString(), flows: out };
}

// A formflow is green only when it exited 0, printed at least `minPass` PASS rows, printed no FAIL row, and
// every control matching `mustContain` was seen as PASS.
export function flowGate(flow, { minPass, mustContain = [] }) {
  if (!flow) return { ok: false, why: "flow did not run" };
  const missing = mustContain.filter((needle) => !flow.rows.some((r) => r.control.includes(needle) && r.verdict === "PASS"));
  const pageErrors = flow.pageErrors == null ? 0 : flow.pageErrors;
  const ok = flow.exit === 0 && flow.parsed === true && flow.fail === 0 && flow.pass >= minPass && pageErrors === 0 && missing.length === 0;
  return {
    ok, why: ok
      ? "green"
      : `exit=${flow.exit} parsed=${flow.parsed} pass=${flow.pass} fail=${flow.fail} pageErrors=${pageErrors} missing=${JSON.stringify(missing)}`,
  };
}

