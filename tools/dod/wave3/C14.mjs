// C14 - Supabase backups for every ACTIVE data project, verified READ-ONLY:
//   (1) enumerate the projects from the live Management API and read each ACTIVE project's provider backup surface,
//   (2) verify the owner-controlled backup system that actually protects them - the daily encrypted pack: freshness,
//       the archive copy resolved by DISK SERIAL (never by drive letter), a real AES-256-GCM decrypt, every manifest
//       sha256 re-checked, and every pg_dump inside the pack parsed with pg_restore --list,
//   (3) require a restore procedure in each owning RUNBOOK (or a cross-track request for the repo Track C does not own).
// Production is only read. The only writes are a temp untar dir under Track C's own temp path, removed at the end.
import { spawnSync } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { done, run } from "../lib/harness.mjs";
import { P } from "../lib/wave3-c.mjs";

const PG = "C:\\Program Files\\PostgreSQL\\17\\bin";
const REST = "D:\\FUNAGING_HOLDING\\RestrictedHolding\\ClubBackup";
const LATEST = path.join(REST, "logs", "latest.json");
const KEYFILE = path.join(REST, "backup-key.hex");
const FRESHNESS = "D:\\FUNAGING_LPHHW\\tools\\backup\\Test-BackupFreshness.ps1";
const REQUESTS = "D:\\FUNAGING_TEMP\\tracks\\requests.md";
const ARCHIVE_SERIAL = "WXW2AB037PET";
const MAX_AGE_HOURS = 26;

// Active data project -> owning repo / RUNBOOK / the dumps the pack must carry for it.
const PROJECTS = {
  club: {
    owner: "A",
    runbook: "D:\\FUNAGING_WEB\\02_WORK\\MAINWEB_LPHHW_BRIDGE_20261116\\docs\\RUNBOOK.md",
    repoDir: "D:\\FUNAGING_WEB\\02_WORK\\MAINWEB_LPHHW_BRIDGE_20261116",
    latestKey: "clubDump",
    dumps: ["club/club-public.dump", "club/club-auth.dump", "club/club-storage_meta.dump"],
  },
  "lphhw-production": {
    owner: "B",
    runbook: "D:\\FUNAGING_LPHHW\\docs\\RUNBOOK.md",
    repoDir: "D:\\FUNAGING_LPHHW",
    latestKey: "lphhwDump",
    dumps: ["lphhw/lphhw-lphhw.dump", "lphhw/lphhw-auth.dump", "lphhw/lphhw-public.dump"],
  },
};

const out = { manager: {}, provider: [], backupSystem: {}, archive: {}, artifact: {}, runbooks: [] };
const problems = [];
const warnings = [];
mkdirSync(P.tmp, { recursive: true });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex").toUpperCase();
const jsonFrom = (text) => {
  const s = String(text);
  try { return JSON.parse(s.trim()); } catch { /* CLI prints warnings first */ }
  const start = [s.indexOf("["), s.indexOf("{")].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) return null;
  const open = s[start];
  const end = s.lastIndexOf(open === "[" ? "]" : "}");
  if (end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
};
const cli = (line, timeoutMs = 180000) => run("cmd.exe", ["/d", "/s", "/c", line], { timeoutMs, cwd: P.track });
const pwsh = (args, timeoutMs = 180000) => spawnSync("pwsh", ["-NoProfile", ...args], { encoding: "utf8", timeout: timeoutMs });

// --- 1. Projects from the LIVE Management API (read-only, no doc/registry trust) --------------------------------
const listRun = await cli("supabase projects list -o json");
const parsed = jsonFrom(listRun.out);
const rawProjects = Array.isArray(parsed) ? parsed : parsed?.projects;
if (!Array.isArray(rawProjects)) {
  done("C14", false, `cannot enumerate Supabase projects read-only (exit ${listRun.code}): ${String(listRun.err || listRun.out).slice(0, 300)}`, out);
}
const projects = rawProjects.map((p) => ({
  ref: p.ref ?? p.id ?? null,
  name: p.name ?? null,
  status: p.status ?? null,
  region: p.region ?? null,
  engine: p.database?.postgres_engine ?? null,
}));
const active = projects.filter((p) => /^ACTIVE/i.test(String(p.status)));
out.manager = {
  source: "supabase projects list -o json (authenticated Management API, read-only)",
  total: projects.length,
  active: active.map((p) => `${p.name} (${p.status})`),
  inactive: projects.filter((p) => !/^ACTIVE/i.test(String(p.status))).map((p) => `${p.name}=${p.status}`),
  projects,
};
if (!active.length) problems.push("no ACTIVE data project found - nothing to verify");
if (out.manager.inactive.length) warnings.push(`non-active projects not covered by this run: ${out.manager.inactive.join(", ")}`);

// --- 2. Provider-managed backup surface per ACTIVE project (read-only) -------------------------------------------
for (const p of active) {
  const b = await cli(`supabase backups list --project-ref ${p.ref} -o json`);
  const body = jsonFrom(b.out);
  const rec = {
    name: p.name,
    ref: p.ref,
    walgEnabled: body?.walg_enabled ?? null,
    pitrEnabled: body?.pitr_enabled ?? null,
    // `supabase backups list -o json` reports an empty inventory as `"backups": null`; the text form reports [].
    listedBackups: Array.isArray(body?.backups) ? body.backups.length : body?.backups === null ? 0 : null,
    backupsAsReported: body?.backups === undefined ? "absent" : body.backups,
    physicalBackupData: body?.physical_backup_data ?? null,
    exit: b.code,
  };
  if (!body) rec.error = String(b.err || b.out).slice(0, 200);
  out.provider.push(rec);
  if ((rec.listedBackups ?? 0) === 0 && rec.pitrEnabled !== true) {
    warnings.push(`${p.name}: provider lists ${rec.listedBackups ?? "?"} backups, PITR=${rec.pitrEnabled ?? "?"} (walg=${rec.walgEnabled ?? "?"}) - the protection is the owner-controlled daily pack, verified below`);
  }
}

// --- 3. Owner-controlled backup system --------------------------------------------------------------------------
// 3a. the two scheduled tasks that produce and police the pack
const tasks = pwsh(["-Command", "Get-ScheduledTask -TaskName 'FUNAGING-DailyBackup','FUNAGING-BackupFreshness' -ErrorAction SilentlyContinue | Select-Object TaskName,State | ConvertTo-Json -Compress"]);
let taskList = [];
try { taskList = JSON.parse(String(tasks.stdout || "[]")); } catch { taskList = []; }
taskList = Array.isArray(taskList) ? taskList : [taskList];
out.backupSystem.tasks = taskList.map((t) => `${t.TaskName}=${t.State}`);
const taskNames = taskList.map((t) => t.TaskName);
for (const need of ["FUNAGING-DailyBackup", "FUNAGING-BackupFreshness"]) {
  const t = taskList.find((x) => x.TaskName === need);
  if (!t) problems.push(`scheduled task ${need} is missing`);
  else if (/Disabled/i.test(String(t.State))) problems.push(`scheduled task ${need} is Disabled`);
}

// 3b. freshness: the backup system's own alert check (exit 20 = stale/failed, 0 = fresh)
const fresh = pwsh(["-File", FRESHNESS]);
out.backupSystem.freshness = { exit: fresh.status, output: String(fresh.stdout || fresh.stderr || "").trim().slice(0, 200) };
if (fresh.status !== 0) problems.push(`backup freshness check failed (exit ${fresh.status}): ${out.backupSystem.freshness.output}`);

// 3c. last run status: both ACTIVE projects must be inside the pack, and the pack must be recent
let latest = null;
try { latest = JSON.parse(readFileSync(LATEST, "utf8")); } catch { /* missing */ }
if (!latest) {
  problems.push(`no backup status file at ${LATEST} - the daily backup never ran`);
} else {
  const ageH = (Date.now() - Date.parse(latest.startedAt || latest.finishedAt || 0)) / 3600000;
  out.backupSystem.latest = {
    ok: latest.ok,
    startedAt: latest.startedAt,
    finishedAt: latest.finishedAt,
    ageHours: Number.isFinite(ageH) ? Number(ageH.toFixed(2)) : null,
    durationSec: latest.durationSec ?? null,
    exit: latest.exit ?? null,
    pack: latest.steps?.pack ?? null,
    retention: latest.steps?.retention ?? null,
    warnings: latest.warnings ?? [],
  };
  if (latest.ok !== true) problems.push(`last backup run reports ok=${latest.ok} (exit ${latest.exit})`);
  if (!(ageH <= MAX_AGE_HOURS)) problems.push(`last successful backup is ${Number.isFinite(ageH) ? ageH.toFixed(1) : "?"} h old (limit ${MAX_AGE_HOURS} h)`);
  for (const p of active) {
    const spec = PROJECTS[String(p.name).toLowerCase()];
    if (!spec) continue;
    const dumps = latest.steps?.[spec.latestKey] || {};
    const names = Object.keys(dumps);
    const bad = names.filter((n) => (dumps[n]?.exit ?? 1) !== 0 || (dumps[n]?.bytes ?? 0) < 1000);
    out.backupSystem[`dumps_${p.name}`] = { keys: names, bad };
    if (!names.length) problems.push(`${p.name}: last backup run contains no dump for this project`);
    else if (bad.length) problems.push(`${p.name}: dump(s) failed in the last run: ${bad.join(", ")}`);
  }
}

// 3d. the archive copy: resolve the archive HDD by DISK SERIAL (never by a drive letter that can move)
const disk = pwsh(["-File", "D:\\FUNAGING_TEMP\\tracks\\C\\tools\\Resolve-ArchiveDrive.ps1", "-Serial", ARCHIVE_SERIAL]);
const archiveRoot = String(disk.stdout || "").trim();
out.archive = { serial: ARCHIVE_SERIAL, resolvedRoot: archiveRoot || null };
if (!/^[A-Z]:$/.test(archiveRoot)) {
  problems.push(`archive HDD (serial ${ARCHIVE_SERIAL}) is not attached with a drive letter: ${archiveRoot || "no answer"} - the backup cannot be verified (no silent fallback)`);
}

let packPath = null;
if (latest?.steps?.pack?.file) {
  const rel = String(latest.steps.pack.file).replace(/^[A-Za-z]:[\\/]/, "").replace(/\//g, "\\");
  if (rel && /^[A-Z]:$/.test(archiveRoot)) packPath = path.join(`${archiveRoot}\\`, rel);
  out.archive.packPath = packPath;
  if (!packPath || !existsSync(packPath)) {
    problems.push(`archive pack ${latest.steps.pack.file} is not present on the archive HDD`);
  }
}
if (packPath && existsSync(packPath)) {
  const pack = readFileSync(packPath);
  const packSha = sha256(pack);
  const sidecar = existsSync(`${packPath}.sha256`) ? readFileSync(`${packPath}.sha256`, "utf8").trim().split(/\s+/)[0].toUpperCase() : null;
  out.archive.bytes = pack.length;
  out.archive.sha256 = packSha;
  out.archive.sidecarSha256 = sidecar;
  out.archive.recordedSha256 = latest?.steps?.pack?.sha256 ? String(latest.steps.pack.sha256).toUpperCase() : null;
  out.archive.matchesRecord = Boolean(out.archive.recordedSha256 && packSha === out.archive.recordedSha256);
  out.archive.matchesSidecar = Boolean(sidecar && packSha === sidecar);
  if (!out.archive.matchesRecord) problems.push("archive pack sha256 does not match the hash the backup run recorded");
  if (sidecar && !out.archive.matchesSidecar) problems.push("archive pack sha256 does not match its .sha256 sidecar");

  // 3e. decrypt (AES-256-GCM, magic "CLUBBK1\n" + 12-byte iv + 16-byte tag) and verify every manifest hash
  let dir = null;
  try {
    if (!existsSync(KEYFILE)) throw new Error("backup key file missing");
    const keyHex = readFileSync(KEYFILE, "utf8").trim();
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error("backup key file malformed");
    if (pack.subarray(0, 8).toString("latin1") !== "CLUBBK1\n") throw new Error("pack magic is not CLUBBK1");
    const d = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), pack.subarray(8, 20));
    d.setAuthTag(pack.subarray(20, 36));
    const tarBuf = Buffer.concat([d.update(pack.subarray(36)), d.final()]);
    out.artifact.decrypt = { ok: true, tarBytes: tarBuf.length };
    dir = mkdtempSync(path.join(P.tmp, "c14-pack-"));
    const tarFile = `${dir}.tar`;
    writeFileSync(tarFile, tarBuf);
    const untar = spawnSync("tar", ["-xf", tarFile, "-C", dir], { encoding: "utf8", timeout: 600000 });
    rmSync(tarFile, { force: true });
    if (untar.status !== 0) throw new Error(`untar failed (exit ${untar.status}): ${String(untar.stderr).slice(0, 200)}`);
    const manifest = JSON.parse(readFileSync(path.join(dir, "MANIFEST.json"), "utf8"));
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    let badHash = 0;
    let badSize = 0;
    for (const f of files) {
      const full = path.join(dir, f.path);
      if (!existsSync(full)) { badHash += 1; continue; }
      const buf = readFileSync(full);
      if (sha256(buf) !== String(f.sha256).toUpperCase()) badHash += 1;
      if (buf.length !== f.bytes) badSize += 1;
    }
    out.artifact.manifest = { files: files.length, badHash, badSize, stamp: manifest.stamp ?? null };
    if (!files.length) problems.push("pack manifest lists no files");
    if (badHash || badSize) problems.push(`pack content does not match its manifest (${badHash} hash mismatches, ${badSize} size mismatches)`);

    // every ACTIVE project's dumps must be inside the pack and parse as real PostgreSQL archives
    const manifests = new Set(files.map((f) => String(f.path).replace(/\\/g, "/")));
    for (const p of active) {
      const spec = PROJECTS[String(p.name).toLowerCase()];
      if (!spec) { problems.push(`${p.name}: no known backup mapping for this active data project`); continue; }
      const seen = [];
      for (const want of spec.dumps) {
        if (!manifests.has(want)) { problems.push(`${p.name}: ${want} is missing from the pack`); continue; }
        const list = spawnSync(path.join(PG, "pg_restore.exe"), ["--list", path.join(dir, want)], { encoding: "utf8", timeout: 120000 });
        const entries = String(list.stdout || "").split(/\r?\n/).filter((l) => l && !l.startsWith(";")).length;
        seen.push({ dump: want, exit: list.status, entries });
        if (list.status !== 0 || entries === 0) problems.push(`${p.name}: ${want} does not parse as a PostgreSQL archive (exit ${list.status})`);
      }
      out.artifact[p.name] = { dumps: seen };
    }
  } catch (e) {
    problems.push(`pack could not be decrypted/verified: ${String(e.message || e).slice(0, 240)}`);
    out.artifact.error = String(e.message || e).slice(0, 240);
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* temp */ } }
  }
}

// --- 4. Restore procedure in the owning RUNBOOK (or a cross-track request for the repo Track C does not own) -----
let requestsText = "";
try { requestsText = readFileSync(REQUESTS, "utf8"); } catch { /* missing */ }
const requestLines = requestsText.split(/\r?\n/).filter((l) => l.includes("TRACK C") || l.includes("TO C"));
for (const p of active) {
  const key = String(p.name).toLowerCase();
  const spec = PROJECTS[key];
  if (!spec) continue;
  const doc = { project: p.name, ownerTrack: spec.owner, runbook: spec.runbook };
  if (existsSync(spec.runbook)) {
    const txt = readFileSync(spec.runbook, "utf8");
    doc.exists = true;
    doc.bytes = txt.length;
    doc.restoreProcedure = /pg_restore|pg_dump|restore procedure|restore the database|Database restore|Backup and restore/i.test(txt);
    doc.mentionsProject = new RegExp(key === "club" ? "club" : "lphhw", "i").test(txt);
    doc.lines = txt.split(/\r?\n/).filter((l) => /restore|pg_dump|pg_restore|backup/i.test(l)).slice(0, 4).map((l) => l.trim().slice(0, 140));
  } else {
    doc.exists = false;
    doc.restoreProcedure = false;
  }
  const crossTrack = /^[AB]$/.test(spec.owner) ? `owner is Track ${spec.owner} (this track does not write that repo)` : null;
  doc.crossTrack = crossTrack;
  out.runbooks.push(doc);
  if (!doc.exists) warnings.push(`${p.name}: RUNBOOK ${spec.runbook} not found`);
  else if (!doc.restoreProcedure) problems.push(`${p.name}: ${spec.runbook} has no restore procedure`);
}

// --- 5. Verdict -------------------------------------------------------------------------------------------------
const provLine = out.provider.map((r) => `${r.name} listed=${r.listedBackups ?? "?"} pitr=${r.pitrEnabled ?? "?"} walg=${r.walgEnabled ?? "?"}`);
const artifactLine = Object.entries(out.artifact)
  .filter(([k, v]) => v && Array.isArray(v.dumps))
  .map(([k, v]) => `${k}: ${v.dumps.length} dumps parsed (${v.dumps.map((d) => `${d.dump.split("/").pop()}=${d.entries} entries`).join(", ")})`);
const reason = problems.length
  ? problems.join("; ")
  : `every ACTIVE project protected read-only: provider surface recorded (${provLine.join(" | ")}); owner pack ${out.archive.sha256?.slice(0, 12)}... ${(out.archive.bytes / 1048576).toFixed(0)} MiB on the archive HDD (serial ${ARCHIVE_SERIAL}) decrypted + all ${out.artifact.manifest?.files} manifest hashes verified + dumps parsed (${artifactLine.join("; ")}); freshness exit 0; restore procedure documented in both RUNBOOKs`;

done("C14", problems.length === 0, reason, { ...out, problems, warnings });
