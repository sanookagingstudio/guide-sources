#!/usr/bin/env node
// DoD sweep runner (DOD AS CODE, Owner 2026-11-22).
// Runs every executable check of one wave, sequentially, with a per-check timeout, and writes a machine-readable
// result the driver reads: { wave, track, total, passed, checks:[{id,status,reason,ms,file}] }.
//
// Usage:
//   node tools/dod/run-wave.mjs --wave 1 --track A --json <path> [--only A03] [--timeout 2400000]
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const arg = (name, dflt = "") => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : dflt;
};

const wave = arg("wave", "1");
const trackId = arg("track", process.env.FUNAGING_TRACK || "A").toUpperCase();
const only = arg("only", "");
const timeoutMs = Number(arg("timeout", "2400000"));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const waveDir = path.join(here, `wave${wave}`);
const outFile = arg("json", path.join("D:\\FUNAGING_TEMP\\tracks", trackId, "evidence", "dod", `sweep_wave${wave}_latest.json`));

if (!existsSync(waveDir)) {
  console.log(`WAVE ${wave} 0/0 (no checks in ${waveDir})`);
  process.exit(0);
}

let files = readdirSync(waveDir).filter((f) => f.endsWith(".mjs")).sort();
if (only) files = files.filter((f) => f.startsWith(only));

const checks = [];
for (const f of files) {
  const id = path.basename(f, ".mjs");
  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(waveDir, f)], {
      cwd: repoRoot,
      env: { ...process.env, FUNAGING_TRACK: trackId, DOD_RUN_ID: runId },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); process.stdout.write(d); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
  const line = (result.out || "").split(/\r?\n/).reverse().find((l) => /^(PASS|FAIL)\s+\S+/.test(l.trim()));
  const status = line ? line.trim().split(/\s+/)[0] : "FAIL";
  const reason = line ? line.trim().replace(/^(PASS|FAIL)\s+\S+\s*/, "") : (result.err || "no PASS/FAIL line").trim().slice(-300);
  checks.push({ id, status, reason, ms: Date.now() - started, exit: result.code });
}

const passed = checks.filter((c) => c.status === "PASS").length;
const total = checks.length;
mkdirSync(path.dirname(outFile), { recursive: true });
const payload = { wave: Number(wave), track: trackId, runId, at: new Date().toISOString(), total, passed, checks };
writeFileSync(outFile, JSON.stringify(payload, null, 2));
writeFileSync(path.join(path.dirname(outFile), `sweep_wave${wave}_${runId}.json`), JSON.stringify(payload, null, 2));

console.log("");
for (const c of checks) console.log(`${c.status.padEnd(4)} ${c.id} ${(c.reason || "").slice(0, 140)}`);
console.log(`WAVE ${wave} ${passed}/${total}`);
console.log(`result: ${outFile}`);
process.exit(0);
