// C07 - Control Machine / Agent Center: the registry validates, then a REAL read-only probe runs across all 7
// systems, persists its task rows, survives a daemon restart, and REFUSES a path outside the registered roots.
import { readFileSync } from "node:fs";
import path from "node:path";
import { run, done } from "../lib/harness.mjs";
import { P, words } from "../lib/wave3-c.mjs";

const out = {};
const check = await run(process.execPath, ["tools/control-coverage.mjs", "--check"], { cwd: P.cm, timeoutMs: 120000 });
out.registryCheck = { code: check.code, tail: words(check.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")) };

const outDir = path.join("D:\\FUNAGING_TEMP\\tracks\\C\\evidence\\dod", "cm-coverage");
const runRes = await run(process.execPath, ["tools/control-coverage.mjs", "--run", "--out", outDir], { cwd: P.cm, timeoutMs: 900000 });
out.run = { code: runRes.code, tail: words(runRes.out.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")) };

let report = null;
try { report = JSON.parse(readFileSync(path.join(outDir, "control_coverage_report.json"), "utf8")); } catch { /* missing */ }
const summary = report
  ? {
      result: report.result,
      systems: (report.systems || []).length,
      pass: (report.systems || []).filter((s) => s.state === "PASS").length,
      persisted: report.persistence ? `${report.persistence.pass}/${report.persistence.checked}` : null,
      boundaryRefused: Boolean(report.refusals && report.refusals.outsideRoot && report.refusals.outsideRoot.refused),
      live: Boolean(report.live && report.live.reachable),
      failures: report.failures || [],
    }
  : null;
out.report = summary;

const problems = [];
if (check.code !== 0) problems.push(`registry check failed (exit ${check.code})`);
if (runRes.code !== 0) problems.push(`coverage run failed (exit ${runRes.code})`);
if (!summary) problems.push("no report written");
else {
  if (summary.result !== "PASS") problems.push(`report result ${summary.result}`);
  if (summary.systems !== 7 || summary.pass !== 7) problems.push(`probed ${summary.pass}/${summary.systems}, expected 7/7`);
  if (summary.persisted !== "7/7") problems.push(`restart persistence ${summary.persisted}, expected 7/7`);
  if (!summary.boundaryRefused) problems.push("outside-root path was not refused");
}

done("C07", problems.length === 0, problems.length ? problems.join("; ") : `registry ${out.registryCheck.tail.match(/REGISTRY_OK[^|]*/)?.[0] || "ok"}; probe 7/7 PASS, persistence 7/7, boundary refused, live ${summary.live}`, out);
