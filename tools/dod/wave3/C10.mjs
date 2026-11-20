// C10 - baseline go-live: build ONE rollback index across every system from live probes + recorded deployment
// ids, then require a real go-live run record (pre-state, one change per system, post-smoke, single rollback
// target each). Without the Owner deploy window this check honestly FAILS - it never invents a run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { httpGet, done } from "../lib/harness.mjs";
import { P, URLS, readText, words } from "../lib/wave3-c.mjs";

const dir = "D:\\FUNAGING_TEMP\\tracks\\C\\evidence\\go_live";
mkdirSync(dir, { recursive: true });
const indexPath = path.join(dir, "rollback_index.json");

const readJson = (f) => {
  try { const t = readFileSync(f, "utf8"); return JSON.parse(t.slice(t.indexOf("{"))); } catch { return null; }
};
const tfi = readJson(`${P.tfi}\\docs\\deploy-provenance.json`);
const hub = readJson(`${P.hub}\\docs\\deploy-provenance.json`);
const fieldLive = readJson("D:\\FUNAGING_TEMP\\tracks\\C\\evidence\\field_live_deployment.json");
const fieldPrev = readJson("D:\\FUNAGING_TEMP\\tracks\\C\\evidence\\field_prev_prod_deployment.json");
const mediaosDoc = readText(`${P.mediaos}\\docs\\DEPLOY_MODEL.md`);

const mediaosId = (label) => {
  const row = mediaosDoc.split(/\r?\n/).find((l) => new RegExp(`^\\|\\s*${label}\\s*\\|`).test(l));
  return (row?.match(/dpl_[A-Za-z0-9]+/) || [])[0] || null;
};
const cmHead = (() => {
  try { return execFileSync("git", ["-C", P.cm, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
})();

const SYSTEMS = [
  { id: "guide-sources", url: URLS.gs, live: null, rollback: null, note: "deployed on codex-mvp@d16eed8; current/rollback deployment ids are read at the Owner window" },
  { id: "mediaos-web", url: URLS.mediaosWeb, live: mediaosId("web"), rollback: null, note: "live id from docs/DEPLOY_MODEL.md" },
  { id: "mediaos-api", url: `${URLS.mediaosApi}/health`, live: mediaosId("api"), rollback: null, note: "live id from docs/DEPLOY_MODEL.md" },
  { id: "tfi", url: URLS.tfi, live: tfi?.liveDeployment?.id || null, rollback: tfi?.rollbackTarget?.id || null, note: "docs/deploy-provenance.json" },
  { id: "omnichannel-hub", url: `${URLS.hub}/health`, live: hub?.production?.deployment_id || null, rollback: hub?.rollback?.deployment_id || null, note: "docs/deploy-provenance.json" },
  { id: "field-app", url: URLS.field, live: fieldLive?.id || null, rollback: fieldPrev?.id || null, note: "field app live/previous deployment evidence" },
  { id: "staff-apk", url: `${URLS.releases}/SANOOK_Staff_v1.0.54_release.apk`, live: null, rollback: "previous published APK (Track A)", note: "static release asset" },
  { id: "admin-apk", url: `${URLS.releases}/FUNAGING_Admin_v1.0.50_release.apk`, live: null, rollback: "previous published APK (Track A)", note: "static release asset" },
  { id: "machine-bible", url: null, live: null, rollback: "git HEAD (repo only)", note: "repo only, no deployment" },
  { id: "control-machine", url: null, live: cmHead, rollback: cmHead, note: "local daemon; rollback = git HEAD of D:\\CONTROL_MACHINE" },
];

const probed = [];
for (const s of SYSTEMS) {
  if (!s.url) { probed.push({ ...s, probe: { status: "N/A" } }); continue; }
  const r = await httpGet(s.url, 20000);
  probed.push({ ...s, probe: { status: r.status, bytes: r.body.length, at: new Date().toISOString() } });
}

const index = { schema: "track-c.rollback-index.v1", builtAt: new Date().toISOString(), readOnly: true, systems: probed };
writeFileSync(indexPath, JSON.stringify(index, null, 2));

const runPath = path.join(dir, "go_live_run.json");
const goLiveRun = existsSync(runPath) ? readJson(runPath) : null;

const badProbes = probed.filter((s) => s.url && s.probe.status !== 200);
const missingRollback = probed.filter((s) => s.url && !s.rollback);

const problems = [];
if (badProbes.length) problems.push(`live probes not 200: ${badProbes.map((s) => `${s.id}=${s.probe.status}`).join(", ")}`);
if (missingRollback.length) problems.push(`no rollback id recorded for ${missingRollback.map((s) => s.id).join(", ")}`);
if (!goLiveRun) problems.push("no go-live run record (Owner deploy window required): nothing was changed in production");
else if (!goLiveRun.systems || goLiveRun.systems.length < SYSTEMS.length) problems.push("go-live run record does not cover every system");
else if (goLiveRun.systems.some((s) => !s.postSmoke || s.postSmoke.status !== "PASS")) problems.push("go-live run has a system without a PASS post-smoke");

done("C10", problems.length === 0, problems.length ? problems.join("; ") : `rollback index built and a go-live run covers ${SYSTEMS.length} systems with a PASS post-smoke each`, {
  indexPath,
  runPath,
  probed: probed.map((s) => ({ id: s.id, url: s.url, status: s.probe.status, live: s.live, rollback: s.rollback })),
  goLiveRun: goLiveRun ? { at: goLiveRun.at, systems: goLiveRun.systems?.length } : null,
  note: words("the index is read-only: it observes the live deployments and the recorded rollback targets, it does not change anything"),
});
