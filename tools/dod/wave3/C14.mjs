// C14 - Supabase backups for every ACTIVE data project: prove, READ-ONLY against production, that a restorable backup
// exists and that the restore procedure is documented.
//
//  1. enumerate the data projects through the authenticated Management API (`supabase projects list -o json`);
//  2. ask the provider for its backup surface per ACTIVE project (`supabase backups list`), read-only;
//  3. locate the OWNER-CONTROLLED backup source: the archive HDD (found by serial, never by drive letter) -> newest
//     encrypted daily pack + its .sha256 sidecar + the runner's freshness status;
//  4. actually RESTORE that pack: decrypt it, extract it, re-hash every file in MANIFEST.json, then pg_restore the Club
//     and LPHHW dumps into a throwaway PostgreSQL 18 cluster under Track C's own temp and compare row counts with the
//     counts recorded in the MANIFEST at backup time. Parsing a dump's table of contents is NOT a restore and is not
//     accepted here;
//  5. require the restore procedure (the pack, the freshness test, pg_restore) in the RUNBOOK of each owning system.
//
// Production is only READ: two list calls and a status file. The only writes are the decrypted working copy, the
// throwaway cluster and the evidence JSON, all under Track C paths.
import { spawnSync } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { done, run } from "../lib/harness.mjs";
import { P } from "../lib/wave3-c.mjs";

// PostgreSQL 18 binaries: the pack is produced by pg_dump 18 (tools/backup/*.mjs) and pg_restore 17 cannot read a
// newer archive version, so the drill uses the same major the pack was written with.
const PG = "C:\\Program Files\\PostgreSQL\\18\\bin";
const TAR = "C:\\Windows\\System32\\tar.exe";
const ARCHIVE_DISK_SERIAL = "WXW2AB037PET";
const ARCHIVE_SUBDIR = "FUNAGING_ARCHIVE\\Backups\\DailyBackup";
const BACKUP_KEY = "D:\\FUNAGING_HOLDING\\RestrictedHolding\\ClubBackup\\backup-key.hex";
const BACKUP_STATUS = "D:\\FUNAGING_HOLDING\\RestrictedHolding\\ClubBackup\\logs\\latest.json";
const FRESHNESS_TOOL = "D:\\FUNAGING_LPHHW\\tools\\backup\\Test-BackupFreshness.ps1";
const MAX_AGE_H = 26;
const WORK_DUMP_DIR = "D:\\FUNAGING_TEMP\\tracks\\C\\backups";
const REQUESTS = "D:\\FUNAGING_TEMP\\tracks\\requests.md";

// The data projects in use. `name` is the Supabase project name (lower-cased for the lookup); `id` is ours.
// `repo`/`runbook` is the system that owns the data and must document the restore; `owner` is the track that writes it.
const PROJECTS = {
  club: {
    id: "club",
    ref: "hbjocppvllpcbmhkiode",
    owner: "A",
    repo: P.mainweb,
    runbook: path.join(P.mainweb, "docs", "RUNBOOK.md"),
    restoreTokens: [/pg_restore/i, /restore_drill|Test-BackupFreshness/i, /funaging-backup-|RestrictedHolding/i],
  },
  "lphhw-production": {
    id: "lphhw-production",
    ref: "uifjophgbgtodilzyuee",
    owner: "B",
    repo: "D:\\FUNAGING_LPHHW",
    runbook: "D:\\FUNAGING_LPHHW\\docs\\RUNBOOK.md",
    restoreTokens: [/pg_restore/i, /restore_drill|Test-BackupFreshness/i, /funaging-backup-|RestrictedHolding/i],
  },
};

const out = { manager: {}, projects: [], backup: {}, manifest: {}, drills: [], runbooks: [], retention: null };
const problems = [];
const warnings = [];
mkdirSync(P.tmp, { recursive: true });
mkdirSync(WORK_DUMP_DIR, { recursive: true });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex").toUpperCase();
const jsonFrom = (text) => {
  const s = String(text);
  try { return JSON.parse(s.trim()); } catch { /* the CLI prints warnings before the payload */ }
  const start = [s.indexOf("["), s.indexOf("{")].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) return null;
  const open = s[start];
  const end = s.lastIndexOf(open === "[" ? "]" : "}");
  if (end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
};
// Run a Windows CLI through cmd.exe so the npm shims (supabase.cmd) resolve.
const cli = (line, timeoutMs = 180000) => run("cmd.exe", ["/d", "/s", "/c", line], { timeoutMs, cwd: P.track });
const pwsh = (script, timeoutMs = 120000) =>
  spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: timeoutMs });

// --- 1. Enumerate the projects from the LIVE Management API (read-only) ---------------------------------------
const listRun = await cli("supabase projects list -o json");
const listJson = jsonFrom(listRun.out);
const rawProjects = Array.isArray(listJson) ? listJson : listJson?.projects;
if (!Array.isArray(rawProjects)) {
  done("C14", false, `cannot enumerate Supabase projects read-only (exit ${listRun.code}): ${String(listRun.err || listRun.out).slice(0, 300)}`, out);
}
const projects = rawProjects.map((p) => ({
  ref: p.ref ?? p.id ?? null,
  name: p.name ?? null,
  status: p.status ?? null,
  region: p.region ?? null,
  dbHost: p.database?.host ?? null,
  engine: p.database?.postgres_engine ?? null,
}));
const active = projects.filter((p) => /^ACTIVE/i.test(String(p.status)));
out.manager = {
  enumeratedBy: "supabase projects list -o json (authenticated Management API, read-only)",
  total: projects.length,
  activeCount: active.length,
  inactive: projects.filter((p) => !/^ACTIVE/i.test(String(p.status))).map((p) => `${p.name}=${p.status}`),
  projects,
};
if (active.length === 0) problems.push("no ACTIVE data project found - nothing to verify");

// --- 2. Provider backup surface per ACTIVE project (read-only) -----------------------------------------------
for (const p of active) {
  const rec = { ref: p.ref, name: p.name, status: p.status, region: p.region, engine: p.engine };
  const b = await cli(`supabase backups list --project-ref ${p.ref} -o json`);
  const body = jsonFrom(b.out);
  rec.provider = body
    ? {
        walgEnabled: body.walg_enabled ?? null,
        pitrEnabled: body.pitr_enabled ?? null,
        // The API answers `"backups": null` for an empty list (the text renderer prints []): null means none.
        listedBackups: Array.isArray(body.backups) ? body.backups.length : body.backups === null ? 0 : null,
        physicalBackupData: body.physical_backup_data ?? null,
        message: body.message ?? null,
        exit: b.code,
      }
    : { error: String(b.err || b.out).slice(0, 300), exit: b.code };
  out.projects.push(rec);
}

// --- 3. The owner-controlled backup source: archive HDD by SERIAL -> newest pack + sidecar + freshness -------
const locate = pwsh(`
$ErrorActionPreference = 'Stop'
$disk = Get-CimInstance Win32_DiskDrive | Where-Object { $_.SerialNumber -and $_.SerialNumber.Trim() -eq '${ARCHIVE_DISK_SERIAL}' } | Select-Object -First 1
$res = [ordered]@{ found = $false; volumes = @(); root = $null; freeBytes = $null; sizeBytes = $null }
if ($disk) {
  $res.found = $true
  foreach ($part in (Get-CimAssociatedInstance -InputObject $disk -ResultClassName Win32_DiskPartition)) {
    foreach ($vol in (Get-CimAssociatedInstance -InputObject $part -ResultClassName Win32_LogicalDisk)) {
      if (-not $vol.DeviceID) { continue }
      $res.volumes += "$($vol.DeviceID)"
      $cand = Join-Path $vol.DeviceID '${ARCHIVE_SUBDIR}'
      if (-not $res.root -and (Test-Path -LiteralPath $cand)) {
        $res.root = $cand; $res.freeBytes = [int64]$vol.FreeSpace; $res.sizeBytes = [int64]$vol.Size
      }
    }
  }
}
$res | ConvertTo-Json -Compress
`);
const archive = jsonFrom(locate.stdout);
out.backup.archive = { serial: ARCHIVE_DISK_SERIAL, locateExit: locate.status, ...(archive || { error: String(locate.stderr || "").slice(0, 300) }) };
if (!archive || !archive.root) {
  problems.push(`archive HDD ${ARCHIVE_DISK_SERIAL} not found with ${ARCHIVE_SUBDIR} (the owner-controlled backup source is off-line)`);
}

let pack = null;
let manifestObj = null;
let extractDir = null;
if (archive?.root) {
  const packs = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".enc")) {
        const st = statSync(full);
        packs.push({ file: full, name: e.name, bytes: st.size, at: st.mtime.toISOString(), mtimeMs: st.mtimeMs });
      }
    }
  };
  try { walk(archive.root); } catch (e) { problems.push(`cannot list ${archive.root}: ${String(e).slice(0, 200)}`); }
  packs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  out.retention = {
    dir: archive.root,
    packsFound: packs.length,
    newest: packs[0] ? { name: packs[0].name, bytes: packs[0].bytes, at: packs[0].at } : null,
    oldest: packs.at(-1) ? { name: packs.at(-1).name, bytes: packs.at(-1).bytes, at: packs.at(-1).at } : null,
    totalBytes: packs.reduce((a, b) => a + b.bytes, 0),
    freeBytes: archive.freeBytes ?? null,
    note: "owner-controlled encrypted packs; policy (backup runner latest.json) = 14 daily + 8 weekly. Track C only reads them.",
    workingSet: WORK_DUMP_DIR,
  };
  if (!packs.length) problems.push("no encrypted backup pack found in the archive");
  pack = packs[0] || null;
}

const ageHours = pack ? (Date.now() - pack.mtimeMs) / 3600000 : null;
out.backup.freshness = { maxAgeHours: MAX_AGE_H, newestPackAgeHours: ageHours === null ? null : Number(ageHours.toFixed(2)) };
if (pack) {
  if (ageHours > MAX_AGE_H) problems.push(`newest backup pack is ${ageHours.toFixed(1)} h old (limit ${MAX_AGE_H} h)`);
  const sidecar = `${pack.file}.sha256`;
  const digest = sha256(readFileSync(pack.file));
  const sidecarText = existsSync(sidecar) ? readFileSync(sidecar, "ascii").trim().toLowerCase() : "";
  out.backup.pack = {
    file: pack.file,
    bytes: pack.bytes,
    at: pack.at,
    sha256: digest,
    sidecarPresent: Boolean(sidecarText),
    sidecarMatches: Boolean(sidecarText) && sidecarText.includes(digest.toLowerCase()),
  };
  if (!out.backup.pack.sidecarPresent) problems.push(`no .sha256 sidecar next to ${pack.name}`);
  else if (!out.backup.pack.sidecarMatches) problems.push(`sha256 of ${pack.name} does not match its sidecar`);
  if (existsSync(BACKUP_STATUS)) {
    const j = JSON.parse(readFileSync(BACKUP_STATUS, "utf8"));
    const stampAge = j.stamp ? (Date.now() - Date.parse(`${j.stamp.slice(0, 4)}-${j.stamp.slice(4, 6)}-${j.stamp.slice(6, 8)}T${j.stamp.slice(8, 10)}:${j.stamp.slice(10, 12)}:00Z`)) / 3600000 : null;
    out.backup.runner = { ok: j.ok === true, stamp: j.stamp, ageHours: stampAge === null ? null : Number(stampAge.toFixed(2)), exit: j.exit, durationSec: j.durationSec };
    if (j.ok !== true) problems.push("backup runner's last run did not report ok=true");
  } else {
    problems.push(`no backup runner status file at ${BACKUP_STATUS}`);
  }
  const fresh = spawnSync("pwsh", ["-NoProfile", "-File", FRESHNESS_TOOL], { encoding: "utf8", timeout: 120000 });
  out.backup.freshnessTool = { file: FRESHNESS_TOOL, exit: fresh.status, out: String(fresh.stdout || "").trim().slice(0, 200), err: String(fresh.stderr || "").trim().slice(0, 200) };
  if (fresh.status !== 0) problems.push(`Test-BackupFreshness.ps1 exit ${fresh.status}: ${String(fresh.stdout || fresh.stderr).trim().slice(0, 160)}`);

  // --- 3b. decrypt + extract the pack and re-hash every file in its MANIFEST -------------------------------
  const key = Buffer.from(readFileSync(BACKUP_KEY, "utf8").trim(), "hex");
  extractDir = mkdtempSync(path.join(P.tmp, "c14-pack-"));
  const tarFile = path.join(extractDir, "pack.tar");
  let decryptOk = false;
  try {
    const enc = readFileSync(pack.file);
    const d = createDecipheriv("aes-256-gcm", key, enc.subarray(8, 20));
    d.setAuthTag(enc.subarray(20, 36));
    writeFileSync(tarFile, Buffer.concat([d.update(enc.subarray(36)), d.final()]));
    decryptOk = true;
  } catch (e) {
    problems.push(`cannot decrypt the pack: ${String(e).slice(0, 200)}`);
  }
  if (decryptOk) {
    const ex = spawnSync(TAR, ["-xf", tarFile, "-C", extractDir], { encoding: "utf8", timeout: 300000 });
    const manifestFile = path.join(extractDir, "MANIFEST.json");
    if (ex.status !== 0 || !existsSync(manifestFile)) {
      problems.push(`cannot extract the pack (tar exit ${ex.status})`);
    } else {
      manifestObj = JSON.parse(readFileSync(manifestFile, "utf8"));
      let bad = 0;
      const badSample = [];
      for (const f of manifestObj.files) {
        const full = path.join(extractDir, f.path);
        if (!existsSync(full) || sha256(readFileSync(full)) !== String(f.sha256).toUpperCase()) {
          bad++;
          if (badSample.length < 5) badSample.push(f.path);
        }
      }
      out.manifest = {
        file: manifestFile,
        files: manifestObj.files.length,
        mismatches: bad,
        mismatchSample: badSample,
        liveCounts: manifestObj.live,
      };
      if (bad) problems.push(`${bad}/${manifestObj.files.length} files in the pack MANIFEST do not match their recorded sha256`);
    }
  }
}

// --- 4. Restore drill: the pack's dumps -> a throwaway PostgreSQL cluster, counts compared with the MANIFEST ---
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.unref();
  srv.on("error", reject);
  srv.listen(0, "127.0.0.1", () => { const port = srv.address().port; srv.close(() => resolve(port)); });
});
const pg = (exe, args, opts = {}) => spawnSync(path.join(PG, exe), args, { encoding: "utf8", timeout: 600000, ...opts });
const errorLines = (txt) => String(txt || "").split(/\r?\n/).filter((l) => /error:/i.test(l));

// Which restored objects each project must prove, and how to count them.
const DRILLS = {
  club: {
    db: "club_drill",
    liveKey: "club",
    minimums: {},
    dumps: ["club/club-auth.dump", "club/club-storage_meta.dump", "club/club-public.dump"],
    queries: {
      auth_users: "select count(*) from auth.users",
      storage_objects: "select count(*) from storage.objects",
      storage_buckets: "select count(*) from storage.buckets",
      public_policies: "select count(*) from pg_policies where schemaname='public'",
    },
    expected: (live) => ({
      auth_users: live?.["auth.users"] ?? null,
      storage_objects: live?.["storage.objects"] ?? null,
      storage_buckets: live?.["storage.buckets"] ?? null,
      public_policies: live?.publicPolicies ?? null,
    }),
  },
  "lphhw-production": {
    db: "lphhw_drill",
    liveKey: "lphhw",
    minimums: { lphhw_tables: 1 },
    dumps: ["lphhw/lphhw-auth.dump", "lphhw/lphhw-public.dump", "lphhw/lphhw-lphhw.dump"],
    queries: {
      audit_rows: "select count(*) from lphhw.audit",
      audit_chain_breaks: "select count(*) from (select prev_hash, lag(hash) over (order by id) as expected from lphhw.audit) s where expected is not null and prev_hash is distinct from expected",
      lphhw_tables: "select count(*) from information_schema.tables where table_schema='lphhw' and table_type='BASE TABLE'",
    },
    expected: (live) => ({ audit_rows: live?.auditRows ?? null, audit_chain_breaks: 0 }),
  },
};

if (manifestObj && out.manifest.mismatches === 0) {
  const cluster = mkdtempSync(path.join(P.tmp, "c14-pg-"));
  const port = await freePort();
  const logFile = path.join(cluster, "pg.log");
  let started = false;
  const tInit = Date.now();
  const init = pg("initdb.exe", ["-D", cluster, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C", "--no-sync"]);
  if (init.status === 0) {
    // stdio:"ignore" is required on Windows: the postmaster inherits the pipes, so spawnSync would wait for an EOF
    // that only comes when the server stops - the check would hang until its own timeout.
    const start = spawnSync(path.join(PG, "pg_ctl.exe"), ["-D", cluster, "-o", `-p ${port} -c listen_addresses=127.0.0.1`, "-l", logFile, "-w", "start"], { stdio: "ignore", timeout: 120000 });
    started = start.status === 0;
  }
  out.backup.cluster = { port, initExit: init.status, started, ms: Date.now() - tInit };
  const psql = (db, sql) => pg("psql.exe", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", db, "-Atc", sql]);
  const scalar = (db, sql) => {
    const r = psql(db, sql);
    const v = Number(String(r.stdout || "").trim().split(/\r?\n/)[0]);
    return Number.isFinite(v) ? v : null;
  };
  try {
    if (!started) {
      problems.push(`throwaway PostgreSQL cluster did not start (init ${init.status}): ${String(init.stderr || "").slice(-200)}`);
    } else {
      for (const rec of out.projects) {
        const key = String(rec.name || "").toLowerCase();
        const spec = PROJECTS[key];
        const plan = DRILLS[key];
        if (!spec || !plan) { problems.push(`${rec.name}: no restore plan for this active data project`); continue; }
        const drill = { project: rec.name, db: plan.db, startedAt: new Date().toISOString(), dumps: [] };
        const t0 = Date.now();
        psql("postgres", `drop database if exists ${plan.db}`);
        const mk = psql("postgres", `create database ${plan.db}`);
        if (mk.status !== 0) { problems.push(`${rec.name}: cannot create the drill database (exit ${mk.status}): ${String(mk.stderr || "").trim().slice(0, 160)}`); continue; }
        for (const q of ["create extension if not exists pgcrypto", 'create extension if not exists "uuid-ossp"', "create role anon nologin", "create role authenticated nologin", "create role service_role nologin"]) psql(plan.db, q);
        for (const rel of plan.dumps) {
          const file = path.join(extractDir, rel);
          if (!existsSync(file)) { drill.dumps.push({ rel, missing: true }); continue; }
          const r = pg("pg_restore.exe", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", plan.db, "--no-owner", "--no-privileges", file]);
          const errs = errorLines(r.stderr);
          drill.dumps.push({ rel, bytes: statSync(file).size, exit: r.status, errorCount: errs.length, errorSample: errs.slice(0, 3).map((e) => e.slice(0, 140)) });
        }
        const counts = {};
        for (const [k, q] of Object.entries(plan.queries)) counts[k] = scalar(plan.db, q);
        const expected = plan.expected(manifestObj.live?.[plan.liveKey]);
        drill.counts = counts;
        drill.expected = expected;
        drill.mismatched = Object.entries(expected)
          .filter(([k, v]) => v !== null && counts[k] !== v)
          .map(([k, v]) => `${k}: restored ${counts[k]} manifest ${v}`);
        drill.expectedMissing = Object.entries(expected).filter(([, v]) => v === null).map(([k]) => k);
        drill.belowMinimum = Object.entries(plan.minimums || {}).filter(([k, v]) => !(counts[k] >= v)).map(([k, v]) => `${k}: restored ${counts[k]} minimum ${v}`);
        drill.nonFatalRestoreErrors = drill.dumps.reduce((a, d) => a + (d.errorCount || 0), 0);
        drill.ms = Date.now() - t0;
        drill.ok = drill.dumps.every((d) => !d.missing) && drill.mismatched.length === 0 && drill.belowMinimum.length === 0 && drill.expectedMissing.length === 0;
        if (drill.ok && drill.nonFatalRestoreErrors > 0) warnings.push(`${rec.name}: pg_restore reported ${drill.nonFatalRestoreErrors} non-fatal cross-schema error(s) (samples kept in the evidence); every MANIFEST count still matches`);
        out.drills.push(drill);
        // Per-project verdict: a restorable owner-controlled backup exists.
        rec.drill = { ok: drill.ok, db: plan.db, counts, expected, mismatched: drill.mismatched };
      }
    }
  } finally {
    if (started) { try { spawnSync(path.join(PG, "pg_ctl.exe"), ["-D", cluster, "-m", "immediate", "-w", "stop"], { stdio: "ignore", timeout: 120000 }); } catch { /* already stopped */ } }
    try { rmSync(cluster, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* next prune */ }
    try { if (extractDir) rmSync(extractDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* next prune */ }
  }
}

// --- 5. Backup verdict per ACTIVE project: provider backup OR a proved owner-controlled restore -----------------
for (const rec of out.projects) {
  const prov = rec.provider || {};
  const providerBacked = (prov.listedBackups ?? 0) > 0 || prov.pitrEnabled === true;
  const ownerProved = Boolean(rec.drill?.ok);
  rec.backupVerdict = { providerBacked, ownerControlledProved: ownerProved };
  if (!rec.drill && !PROJECTS[String(rec.name || "").toLowerCase()]) {
    problems.push(`${rec.name}: no known system/RUNBOOK mapping for this active data project`);
  }
  if (ownerProved) {
    if (!providerBacked) warnings.push(`${rec.name}: provider lists 0 backups and PITR is off (walg=${prov.walgEnabled ?? "?"}); the safety net is the owner-controlled pack restored in this run`);
  } else if (providerBacked) {
    warnings.push(`${rec.name}: owner-controlled drill not proved, but the provider lists backups`);
  } else {
    problems.push(`${rec.name}: NO restorable backup - the provider lists 0 backups / PITR off AND the owner-controlled pack restore was not proved`);
  }
}

// --- 6. Restore procedure documented in the RUNBOOK of each owning system --------------------------------------
let requestsText = "";
try { requestsText = readFileSync(REQUESTS, "utf8"); } catch { /* no requests file */ }
for (const rec of out.projects) {
  const key = String(rec.name || "").toLowerCase();
  const spec = PROJECTS[key];
  if (!spec) continue;
  if (!existsSync(spec.runbook)) {
    out.runbooks.push({ project: rec.name, ownerTrack: spec.owner, file: spec.runbook, exists: false });
    problems.push(`${rec.name}: RUNBOOK ${spec.runbook} does not exist`);
    continue;
  }
  const txt = readFileSync(spec.runbook, "utf8");
  const missing = spec.restoreTokens.filter((re) => !re.test(txt)).map(String);
  const lines = txt.split(/\r?\n/).filter((l) => /restore|backup/i.test(l)).slice(0, 6).map((l) => l.trim().slice(0, 150));
  out.runbooks.push({ project: rec.name, ownerTrack: spec.owner, file: spec.runbook, bytes: txt.length, restoreProcedure: missing.length === 0, missing, lines });
  if (missing.length) {
    const req = requestsText.split(/\r?\n/).find((l) => l.toLowerCase().includes("restore") && l.includes(rec.ref));
    if (!req) problems.push(`${rec.name}: ${spec.runbook} lacks the restore procedure (missing ${missing.join(", ")}) and no cross-track request names it`);
    else warnings.push(`${rec.name}: restore procedure still missing from its RUNBOOK; cross-track request recorded`);
  }
}

const provSummary = out.projects.map((p) => `${p.name}: listed=${p.provider?.listedBackups ?? "?"} pitr=${p.provider?.pitrEnabled ?? "?"} walg=${p.provider?.walgEnabled ?? "?"}`);
const drillSummary = out.drills.map((d) => `${d.project}: ${d.ok ? `restored into ${d.db} and every count equals the MANIFEST (${Object.entries(d.counts).map(([k, v]) => `${k}=${v}`).join(", ")})` : `NOT PROVED (${d.mismatched?.join("; ") || d.belowMinimum?.join("; ") || "dump/restore failed"})`}`);
const runbookSummary = out.runbooks.map((r) => `${r.project}: ${r.restoreProcedure ? "restore procedure present" : "MISSING"}`);
const reason = problems.length
  ? problems.join("; ")
  : `every ACTIVE project has a restorable backup (${provSummary.join(" | ")}; pack ${out.backup.pack?.sha256?.slice(0, 12)}… ${out.manifest.files} files, 0 manifest mismatches) - ${drillSummary.join("; ")}; ${runbookSummary.join("; ")}`;

done("C14", problems.length === 0, reason, { ...out, problems, warnings });
