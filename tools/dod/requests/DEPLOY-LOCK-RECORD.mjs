// DEPLOY-LOCK-RECORD - the Deploy-Lock gate must never run a production change without leaving a record file.
//
// The request (tracks/requests.md, Track F round 45):
//   the gate names its record file with the ENTIRE -Action text, so a long action produces a path past the
//   Windows 260-character limit; `Set-Content` throws - and that write sits inside `try { } catch { }`, so the
//   failure is silent: the change still runs and deploys.log records it, but tracks/deploy_records/ carries no
//   record of it. Needs a capped slug (e.g. first 80 chars + a short hash of the full action) and to stop
//   swallowing the write error.
//
// PASS (exit 0) requires, measured in THIS run:
//   1. The gate parses (PowerShell AST, 0 errors) and its record-name logic is the capped one
//      (80-char slug + 8-hex hash of the FULL action), with a loud failure path and exit code 7.
//   2. The old behaviour really was broken: the previous naming rule applied to a 356-char action yields a
//      path >= 260 chars (computed here, fail-closed control).
//   3. A REAL gate run with a 356-char action and a change command that does nothing but fail exits 6 and
//      writes a record file whose name is < 240 chars, carries the capped slug, and whose JSON holds the FULL
//      action text and state=change-failed.
//   4. deploys.log carries the matching `record: <path>` line.
//
// SAFETY: the change command is `pwsh -NoProfile -Command "exit 7"` - it touches no product, no repo, no
// production and no credential. The run only takes the deploy lock for a few seconds and records honestly that
// its change failed. No secret is read, printed or written.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const H = await import(pathToFileURL("D:\\FUNAGING_TEMP\\tracks\\golive\\lib\\harness.mjs").href);
const { run, ps, done } = H;

const ID = "DEPLOY-LOCK-RECORD";
if (H.track !== "C") {
  done(ID, false, `refused: FUNAGING_TRACK is '${H.track}' but this check belongs to Track C`, { guard: "track" });
}

const GATE = "D:\\FUNAGING_TEMP\\tracks\\Deploy-Lock.ps1";
const RECORD_DIR = "D:\\FUNAGING_TEMP\\tracks\\deploy_records";
const LOG = "D:\\FUNAGING_TEMP\\tracks\\deploys.log";

const out = { steps: [] };
const problems = [];
const step = (name, ok, detail) => {
  out.steps.push({ name, ok, detail });
  if (!ok) problems.push(`${name}: ${detail}`);
  return ok;
};
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

// ---- 1. the gate parses and carries the repair -------------------------------------------------------------
const astScript = `
$e = $null; $t = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${GATE.replace(/\\/g, "\\\\")}', [ref]$t, [ref]$e)
$fin = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.TryStatement] }, $true) | ForEach-Object { $_.Body.Extent.Text }
@{ errors = @($e).Count; finallyText = ($fin -join "\`n"); } | ConvertTo-Json -Depth 4
`;
const ast = await ps(astScript, { timeoutMs: 120000 });
const parseErrors = Number(ast.json?.errors ?? -1);
const gateText = readFileSync(GATE, "utf8");
out.gate = {
  parseErrors,
  bytes: gateText.length,
  cappedSlug: gateText.includes("$slug.Length -gt 80") && gateText.includes("Substring(0, 80)") && gateText.includes("Substring(0, 8)"),
  loudFailure: gateText.includes("RECORD WRITE FAILED") && gateText.includes("if ($exitCode -eq 0) { $exitCode = 7 }"),
  fallbackName: gateText.includes("_record_"),
  oldNamingRemoved: !gateText.includes("((Now) -replace '[:]', '')"),
};
step("the gate parses with 0 AST errors", parseErrors === 0, `parseErrors=${parseErrors} ${norm(ast.err).slice(0, 200)}`);
step(
  "the record name is capped (80-char slug + 8-hex hash) with a loud failure and exit 7",
  out.gate.cappedSlug && out.gate.loudFailure && out.gate.fallbackName && out.gate.oldNamingRemoved,
  JSON.stringify(out.gate),
);

// ---- 2. the old rule really exceeded the Windows limit ------------------------------------------------------
const action = "SELFTEST Deploy-Lock record path (no production change) " + "x".repeat(300);
const stamp = "2026-01-01T00-00-00Z";
const oldSlug = action.replace(/[^A-Za-z0-9._-]/g, "_");
const oldPath = path.join(RECORD_DIR, `${stamp}_C_${oldSlug}.json`);
out.oldRule = { actionLength: action.length, oldNameLength: path.basename(oldPath).length, oldPathLength: oldPath.length };
step(
  "the pre-fix naming rule produced a path past the Windows limit (fail-closed control)",
  oldPath.length >= 260,
  `action=${action.length} chars -> path ${oldPath.length} chars (limit 260)`,
);

// ---- 3. a REAL gate run records the change -----------------------------------------------------------------
const before = new Set(readdirSync(RECORD_DIR));
let gateRun = null;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const r = await run(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      GATE,
      "-Track",
      "C",
      "-Action",
      action,
      "-RollbackTarget",
      "selftest: no production change is executed by this run",
      "-Command",
      'pwsh -NoProfile -Command "exit 7"',
      "-WaitMinutes",
      "2",
    ],
    { timeoutMs: 240000, cwd: "D:\\FUNAGING_TEMP\\tracks\\C\\tmp" },
  );
  gateRun = { attempt, exit: r.code, tail: norm(`${r.out}\n${r.err}`).slice(-800) };
  if (r.code === 5) continue; // the deploy lock was held by another live track: retry
  break;
}
out.gateRun = gateRun;
step("the gate ran and refused to verify a failing change (exit 6)", gateRun?.exit === 6, `exit=${gateRun?.exit} ${gateRun?.tail?.slice(0, 300)}`);

const created = readdirSync(RECORD_DIR).filter((f) => !before.has(f));
const mine = created
  .map((f) => path.join(RECORD_DIR, f))
  .filter((p) => {
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      return j.action === action;
    } catch {
      return false;
    }
  });
out.records = { createdCount: created.length, matching: mine.map((p) => path.basename(p)) };
step("exactly one new record file names this run", mine.length === 1, `created=${created.length} matching=${mine.length}`);

if (mine.length === 1) {
  const file = mine[0];
  const name = path.basename(file);
  const rec = JSON.parse(readFileSync(file, "utf8"));
  const cappedSlug = action.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  out.record = {
    file,
    nameLength: name.length,
    pathLength: file.length,
    state: rec.state,
    actionMatchesFullText: rec.action === action,
    rollbackTarget: rec.rollbackTarget,
    recordFileField: rec.recordFile ?? null,
    hasCappedSlug: name.includes(cappedSlug),
    hasHash: /_[0-9a-f]{8}\.json$/.test(name),
    nameMatchesField: typeof rec.recordFile === "string" ? path.resolve(rec.recordFile).toLowerCase() === path.resolve(file).toLowerCase() : false,
  };
  step("the record file name is inside the path limit", file.length < 240, `pathLength=${file.length}`);
  step("the name carries the 80-char capped slug + the 8-hex hash", out.record.hasCappedSlug && out.record.hasHash, name);
  step(
    "the record keeps the FULL action and the real state",
    rec.action === action && rec.state === "change-failed",
    `state=${rec.state} actionLength=${String(rec.action).length} expected=${action.length}`,
  );
  step("the record names itself (recordFile)", out.record.nameMatchesField === true, `recordFile=${rec.recordFile}`);

  const log = readFileSync(LOG, "utf8").split(/\r?\n/).filter((l) => l.includes(name));
  out.logLines = log.slice(-3);
  step("deploys.log carries the record path", log.length >= 1, `matching log lines=${log.length}`);
} else {
  step("the record file was found", false, `matching=${mine.length}`);
}

// ---- verdict -----------------------------------------------------------------------------------------------
out.problems = problems;
const ok = problems.length === 0;
const reason = ok
  ? `gate AST clean; old 356-char action -> ${out.oldRule.oldPathLength}-char path (unwritable) vs new ${out.record.pathLength}-char record carrying the full action; real gate run exit 6 state=change-failed, 1 record, log line present`
  : problems.join(" | ");
done(ID, ok, reason, out);
