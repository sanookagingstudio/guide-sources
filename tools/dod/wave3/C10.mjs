// C10 - baseline go-live: ONE rollback index built from live evidence (Vercel alias -> deployment id, a rollback
// target that really exists and is NOT the live deployment, public APK bytes, both local git HEADs), a live
// post-smoke for all 10 systems, and a recorded go-live run. A first run must be backed by at least one real
// Deploy-Lock change (state=verified, rollback recorded before the change); later runs re-verify the same record
// and the live state instead of demanding a new deploy, so the check stays honest and repeatable.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { done, httpGet } from "../lib/harness.mjs";
import { P, URLS, readText, words } from "../lib/wave3-c.mjs";

const SCOPE = "team_UkIW1iwLo9j1Shy7ArPdFXMI";
const recDir = "D:\\FUNAGING_TEMP\\tracks\\deploy_records";
const dir = "D:\\FUNAGING_TEMP\\tracks\\C\\evidence\\go_live";
const rawDir = path.join(dir, "raw");
mkdirSync(rawDir, { recursive: true });
const indexPath = path.join(dir, "rollback_index.json");
const runPath = path.join(dir, "go_live_run.json");
const WINDOW_MS = 60 * 60 * 1000; // a first go-live run looks for Deploy-Lock changes of the last hour

const readJson = (f, fallback = null) => {
  try { const t = readText(f); return JSON.parse(t.slice(t.indexOf("{"))); } catch { return fallback; }
};
const sha40 = (s) => /^[0-9a-f]{40}$/.test(String(s || ""));

// synchronous command helper: this check reads state, it does not run long jobs
const sh = (line) => {
  try { return execFileSync("cmd.exe", ["/d", "/s", "/c", line], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); }
  catch (e) { return String(e.stdout || ""); }
};
function vercelJson(line) {
  const text = sh(`${line} --no-color --scope ${SCOPE} 2>nul`) || "";
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j <= i) throw new Error(`no JSON from: ${line.split(" ").slice(0, 3).join(" ")}`);
  return JSON.parse(text.slice(i, j + 1));
}
const inspect = (ref) => vercelJson(`vercel inspect ${ref} --json`);

const problems = [];
const index = { schema: "track-c.rollback-index.v2", builtAt: new Date().toISOString(), readOnly: true, scope: SCOPE, systems: [] };

const SYSTEMS = [
  { id: "guide-sources", kind: "vercel", project: "guide-sources", domain: "guide-sources.vercel.app", url: URLS.gs },
  { id: "mediaos-web", kind: "vercel", project: "funaging-media-os-web", domain: "funaging-media-os-web.vercel.app", url: URLS.mediaosWeb },
  { id: "mediaos-api", kind: "vercel", project: "funaging-media-os-api", domain: "funaging-media-os-api.vercel.app", url: `${URLS.mediaosApi}/health` },
  { id: "tfi", kind: "vercel", project: "tourism-intelligence-engine", domain: "tourism-intelligence-engine.vercel.app", url: URLS.tfi },
  { id: "omnichannel-hub", kind: "vercel", project: "funaging-omnichannel-hub", domain: "funaging-omnichannel-hub.vercel.app", url: `${URLS.hub}/health` },
  { id: "field-app", kind: "vercel", project: "funaging-field-app", domain: "funaging-field-app.vercel.app", url: URLS.field },
  { id: "staff-apk", kind: "asset", url: `${URLS.releases}/SANOOK_Staff_v1.0.54_release.apk`, note: "static release asset (Track A build)" },
  { id: "admin-apk", kind: "asset", url: `${URLS.releases}/FUNAGING_Admin_v1.0.50_release.apk`, note: "static release asset (Track A build)" },
  { id: "machine-bible", kind: "repo", repo: P.mb, note: "repo only, no deployment" },
  { id: "control-machine", kind: "repo", repo: P.cm, note: "local daemon; rollback = git HEAD of D:\\CONTROL_MACHINE" },
];

for (const s of SYSTEMS) {
  const row = { id: s.id, kind: s.kind, url: s.url || null, note: s.note || null, live: null, rollback: null, rollbackKind: null, probe: null };

  if (s.kind === "vercel") {
    try {
      const list = vercelJson(`vercel ls ${s.project} --prod --json --limit 8`);
      writeFileSync(path.join(rawDir, `${s.id}_prod_list.json`), JSON.stringify(list, null, 2));
      const ready = (list.deployments || []).filter((d) => d.state === "READY" && d.target === "production");
      const alias = inspect(s.domain);
      writeFileSync(path.join(rawDir, `${s.id}_alias_inspect.json`), JSON.stringify(alias, null, 2));
      row.live = alias.id || null;
      if (alias.name !== s.project) problems.push(`${s.id}: ${s.domain} resolves to project ${alias.name}`);
      if (!ready.some((d) => inspect(d.url).id === row.live)) problems.push(`${s.id}: alias target ${row.live} is not a READY production deployment`);

      // rollback = the recorded rollback of the newest Deploy-Lock record that still resolves in this project,
      // else the newest READY deployment that is not live (pruned history -> promote-last-ready)
      const recorded = readdirSync(recDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ f, mtime: statSync(path.join(recDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .map(({ f }) => readJson(path.join(recDir, f)))
        .filter((r) => r && r.track === "C" && r.state === "verified" && /^dpl_/.test(String(r.rollbackTarget || "")));
      let candidate = null;
      for (const r of recorded) {
        const info = (() => { try { return inspect(r.rollbackTarget); } catch { return null; } })();
        if (info && info.name === s.project && info.id !== row.live) { candidate = { id: info.id, kind: "recorded-in-deploy-lock", from: r.action }; break; }
      }
      if (!candidate) {
        for (const d of ready) {
          const info = inspect(d.url);
          if (info.id !== row.live) { candidate = { id: info.id, kind: "previous-production-deployment", createdAt: d.createdAt }; break; }
        }
      }
      if (!candidate) {
        for (const d of vercelJson(`vercel ls ${s.project} --json --limit 10`).deployments || []) {
          if (d.state !== "READY") continue;
          const info = inspect(d.url);
          if (info.id !== row.live) { candidate = { id: info.id, kind: "promote-last-ready", createdAt: d.createdAt }; break; }
        }
      }
      row.rollback = candidate?.id || null;
      row.rollbackKind = candidate?.kind || null;
      if (!row.rollback) problems.push(`${s.id}: no rollback target resolvable in project ${s.project}`);
      if (row.rollback === row.live) problems.push(`${s.id}: rollback target equals the live deployment`);
      const probe = await httpGet(s.url, 20000);
      row.probe = { status: probe.status, bytes: probe.body.length, at: new Date().toISOString() };
    } catch (e) {
      problems.push(`${s.id}: vercel read failed (${String(e.message || e).slice(0, 120)})`);
    }
  }

  if (s.kind === "asset") {
    // The published APK bytes are the identity: hash what a user actually downloads and require the repo copy
    // (the immutable re-publish source) to produce the same digest, so the rollback entry is a real artifact id.
    const file = s.url.split("/").pop();
    let bytes = null;
    let status = 0;
    try {
      const r = await fetch(s.url, { redirect: "follow" });
      status = r.status;
      bytes = Buffer.from(await r.arrayBuffer());
    } catch { /* unreachable */ }
    const digest = bytes ? createHash("sha256").update(bytes).digest("hex").toUpperCase() : null;
    const repoCopy = `${P.mainweb}\\public\\releases\\${file}`;
    const repoDigest = existsSync(repoCopy) ? createHash("sha256").update(readFileSync(repoCopy)).digest("hex").toUpperCase() : null;
    row.live = digest;
    row.rollback = digest ? `sha256:${digest}` : null;
    row.rollbackKind = "republish-immutable-artifact";
    row.repoCopy = repoCopy;
    row.repoCopyDigest = repoDigest;
    row.probe = { status, bytes: bytes ? bytes.length : 0, sha256: digest, at: new Date().toISOString() };
    if (!digest) problems.push(`${s.id}: public download unavailable (status ${status})`);
    else if (repoDigest !== digest) problems.push(`${s.id}: repo copy digest ${repoDigest || "missing"} != published ${digest}`);
  }

  if (s.kind === "repo") {
    const sha = (() => { try { return execFileSync("git", ["-C", s.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
    row.live = sha40(sha) ? sha : null;
    row.rollback = row.live;
    row.rollbackKind = "git-head";
    row.probe = { status: "N/A", at: new Date().toISOString() };
    if (!row.live) problems.push(`${s.id}: git HEAD is not a 40-hex commit`);
  }

  index.systems.push(row);
}
writeFileSync(indexPath, JSON.stringify(index, null, 2));

// ---------- per-system post-smoke: real assertions against the live target ----------
const smoke = {};
const pass = (id, detail, extra = {}) => { smoke[id] = { status: "PASS", detail, at: new Date().toISOString(), ...extra }; };
const fail = (id, detail) => { smoke[id] = { status: "FAIL", detail, at: new Date().toISOString() }; problems.push(`${id}: ${detail}`); };

{
  const root = await httpGet(URLS.gs, 20000);
  const admin = await httpGet(`${URLS.gs}/api/admin/me`, 20000);
  const dump = await httpGet(`${URLS.gs}/GUIDE_SOURCES_ADMIN_SET_PASSWORD.txt`, 20000);
  if (root.status === 200 && admin.status === 401 && dump.status === 404) pass("guide-sources", "root 200, /api/admin/me 401, dump path 404");
  else fail("guide-sources", `root ${root.status}, admin ${admin.status}, dump ${dump.status}`);
}
{
  const root = await httpGet(URLS.mediaosWeb, 20000);
  const html = String(root.headers["content-type"] || "").includes("text/html");
  if (root.status === 200 && html && root.body.length > 10000) pass("mediaos-web", `200 text/html ${root.body.length} B`);
  else fail("mediaos-web", `status ${root.status} html=${html} bytes=${root.body.length}`);
}
{
  const health = await httpGet(`${URLS.mediaosApi}/health`, 20000);
  const root = await httpGet(URLS.mediaosApi, 20000);
  let mode = null;
  try { mode = JSON.parse(root.body).mode || null; } catch { /* not json */ }
  if (health.status === 200 && root.status === 200 && mode === "standalone") pass("mediaos-api", "/health 200, / 200 mode=standalone");
  else fail("mediaos-api", `/health ${health.status}, / ${root.status} mode=${mode}`);
}
{
  const v = await httpGet(`${URLS.tfi}/version`, 20000);
  let b = null;
  try { b = JSON.parse(v.body); } catch { /* not json */ }
  const noStore = String(v.headers["cache-control"] || "").toLowerCase().includes("no-store");
  if (v.status === 200 && b && sha40(b.commit) && ["vercel-git", "env-source-sha"].includes(b.commitSource) && /^dpl_/.test(String(b.deploymentId || "")) && noStore) {
    pass("tfi", `/version 200 commit=${String(b.commit).slice(0, 7)} source=${b.commitSource} dpl=${b.deploymentId} no-store`);
  } else fail("tfi", `/version ${v.status} contract incomplete`);
}
{
  const health = await httpGet(`${URLS.hub}/health`, 20000);
  const ready = await httpGet(`${URLS.hub}/ready`, 20000);
  const v = await httpGet(`${URLS.hub}/version`, 20000);
  const root = await httpGet(URLS.hub, 20000);
  let b = null;
  try { b = JSON.parse(v.body); } catch { /* not json */ }
  const noStore = String(v.headers["cache-control"] || "").toLowerCase().includes("no-store");
  if (health.status === 200 && ready.status === 200 && v.status === 200 && b && sha40(b.commit) && b.commit_source === "env" && /^dpl_/.test(String(b.deployment?.id || "")) && noStore && root.status === 401) {
    pass("omnichannel-hub", `/version commit=${String(b.commit).slice(0, 7)} source=env dpl=${b.deployment.id} no-store, root 401`);
  } else fail("omnichannel-hub", `health ${health.status}, ready ${ready.status}, version ${v.status}, root ${root.status}`);
}
{
  const root = await httpGet(`${URLS.field}/?smoke=${Date.now()}`, 30000);
  const src = (root.body.match(/(?:src|href)="([^"]*assets\/index-[^"]*\.js)"/) || [])[1] || null;
  const bundle = src ? await httpGet(new URL(src, URLS.field).href, 60000) : { status: 0, body: "" };
  const ok = root.status === 200 && Boolean(src)
    && bundle.body.includes("idempotencyKey") && bundle.body.includes("Nothing was sent") && !/Mock mark all synced/i.test(bundle.body);
  if (ok) pass("field-app", `${src.split("/").pop()} has idempotencyKey + honest sync, no mock`);
  else fail("field-app", `bundle ${src || "missing"} honest-sync assertions failed`);
}
for (const id of ["staff-apk", "admin-apk"]) {
  const row = index.systems.find((s) => s.id === id);
  const ok = row?.probe?.status === 200 && row.probe.bytes > 1000000 && row.probe.sha256 && row.rollback === `sha256:${row.probe.sha256}` && row.repoCopyDigest === row.probe.sha256;
  if (ok) pass(id, `200 ${row.probe.bytes} B, sha256 ${String(row.probe.sha256).slice(0, 12)}.. equals the repo copy (immutable rollback identity)`);
  else fail(id, `probe ${row?.probe?.status} bytes ${row?.probe?.bytes} sha256Match=${row?.repoCopyDigest === row?.probe?.sha256}`);
}
{
  let errors = -1;
  try {
    const r = execFileSync(process.execPath, ["validators/validate-infrastructure.mjs"], { cwd: P.mb, encoding: "utf8", timeout: 180000 });
    errors = Number((String(r).match(/ERROR_COUNT=(\d+)/) || [])[1] ?? 0);
  } catch (e) {
    errors = Number((String(e.stdout || "").match(/ERROR_COUNT=(\d+)/) || [])[1] ?? -1);
  }
  if (errors === 0) pass("machine-bible", "validator ERROR_COUNT=0 exit 0");
  else fail("machine-bible", `validator ERROR_COUNT=${errors}`);
}
{
  const head = index.systems.find((s) => s.id === "control-machine");
  if (sha40(head?.live) && head.live === head.rollback) pass("control-machine", `git HEAD ${String(head.live).slice(0, 7)} = rollback target`);
  else fail("control-machine", `git HEAD ${head?.live}`);
}

// ---------- the go-live run: a real change, recorded and re-verified ----------
const existing = readJson(runPath);
const validRecord = (file) => {
  const r = readJson(file);
  return Boolean(r && r.track === "C" && r.state === "verified" && /^dpl_|^project buildCommand/.test(String(r.rollbackTarget || "")));
};
const sinceMs = Date.now() - WINDOW_MS;
let changed = [];
if (existing && Array.isArray(existing.changed) && existing.changed.length) {
  changed = existing.changed.filter((c) => existsSync(c.deployRecord) && validRecord(c.deployRecord));
  if (changed.length === 0) problems.push("the recorded go-live run references no valid Deploy-Lock record any more");
} else {
  changed = readdirSync(recDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: path.join(recDir, f), mtimeMs: statSync(path.join(recDir, f)).mtimeMs }))
    .filter((x) => x.mtimeMs >= sinceMs)
    .map((x) => ({ ...x, rec: readJson(x.file) }))
    .filter((x) => x.rec && x.rec.track === "C" && x.rec.state === "verified")
    .filter((x) => index.systems.some((s) => s.kind === "vercel" && String(x.rec.action || "").toLowerCase().includes(s.id === "omnichannel-hub" ? "hub" : s.id)))
    .map((x) => ({ id: index.systems.find((s) => s.kind === "vercel" && String(x.rec.action || "").toLowerCase().includes(s.id === "omnichannel-hub" ? "hub" : s.id)).id, deployRecord: x.file, action: x.rec.action, at: x.rec.finishedAt, state: x.rec.state, rollbackTarget: x.rec.rollbackTarget }));
  if (changed.length === 0) problems.push("no verified Deploy-Lock change in the last hour: a first baseline go-live needs at least one real change");
}

const goLiveRun = {
  schema: "track-c.go-live-run.v1",
  at: existing?.at || new Date().toISOString(),
  lastVerifiedAt: new Date().toISOString(),
  kind: "baseline",
  deployLock: "D:\\FUNAGING_TEMP\\tracks\\Deploy-Lock.ps1 -Track C",
  changed,
  systems: index.systems.map((s) => ({
    id: s.id,
    live: s.live,
    rollback: s.rollback,
    rollbackKind: s.rollbackKind,
    change: changed.find((c) => c.id === s.id)?.action || "no change: production already serves the verified baseline",
    postSmoke: smoke[s.id],
  })),
};
writeFileSync(runPath, JSON.stringify(goLiveRun, null, 2));

const missingSmoke = index.systems.filter((s) => smoke[s.id]?.status !== "PASS");
if (missingSmoke.length) problems.push(`no PASS post-smoke for ${missingSmoke.map((s) => s.id).join(", ")}`);

done("C10", problems.length === 0, problems.length ? words(problems.join("; ")) : words(
  `baseline go-live: ${index.systems.length} systems covered, rollback index built (${index.systems.filter((s) => s.rollback).length} resolvable targets; every Vercel target is a real deployment that is not the live one, APK targets are immutable sha256 identities), ${changed.length} verified change(s) (${[...new Set(changed.map((c) => c.id))].join(", ")}), every post-smoke PASS`
), {
  indexPath,
  runPath,
  systems: index.systems.map((s) => ({ id: s.id, live: s.live, rollback: s.rollback, rollbackKind: s.rollbackKind, probe: s.probe?.status })),
  changed: changed.map((c) => ({ id: c.id, deployRecord: c.deployRecord, rollbackTarget: c.rollbackTarget })),
  postSmoke: smoke,
  note: "index and run record are derived from live Vercel reads, live HTTP probes and the Deploy-Lock records; nothing is hardcoded",
});
