// C01 - guide-sources: the LIVE production deployment is built from the cleaned + reconciled commit.
// Proves, against the real targets:
//   1. production alias -> a READY deployment whose Vercel meta pins a git commit,
//   2. that commit's tree has zero committed debug artifacts and DOES contain the artifact gate,
//   3. `main` is an ancestor of it (the P1-03 reconcile) and origin/codex-mvp points at it (the deployed ref),
//   4. every committed *.txt/*.log/*.bak blob in the whole history was scanned for credential VALUES -> 0 hits,
//   5. the Owner rotation record states the audit conclusion + the PII exposure (values never read or printed),
//   6. the live site answers 200 with the app marker, the admin API stays 401, and dump paths are 404.
import { spawn } from "node:child_process";
import { done, httpGet, run } from "../lib/harness.mjs";
import { P, URLS, readText, scanSecretValues, words } from "../lib/wave3-c.mjs";

const gs = (args, timeoutMs = 180000) => run("git", ["-C", P.gs, ...args], { timeoutMs });
const ARTIFACT = /\.(txt|log|bak|publiclinebak)$|(^|\/)ONEPACK/i;
const DUMP = /\.(txt|log|bak)$/i;

function firstJson(text) {
  const t = String(text || "");
  const i = t.search(/[[{]/);
  if (i < 0) return null;
  try { return JSON.parse(t.slice(i)); } catch { return null; }
}

async function vercelJson(args) {
  const r = await run("cmd.exe", ["/d", "/s", "/c", `vercel ${args.join(" ")}`], { cwd: P.gs, timeoutMs: 180000 });
  return { json: firstJson(r.out) || firstJson(r.err), code: r.code, tail: words(`${r.out} ${r.err}`) };
}

// One `git cat-file --batch` for every dump blob in history: fast, and the bytes never leave this process.
function catBlobs(shas) {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", P.gs, "cat-file", "--batch"], { shell: false });
    const chunks = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.on("close", () => {
      const buf = Buffer.concat(chunks);
      const out = new Map();
      let i = 0;
      while (i < buf.length) {
        const nl = buf.indexOf(10, i);
        if (nl < 0) break;
        const header = buf.subarray(i, nl).toString("utf8");
        i = nl + 1;
        const m = /^([0-9a-f]{40}) (\w+) (\d+)$/.exec(header);
        if (!m) continue; // "<sha> missing" lines
        const size = Number(m[3]);
        out.set(m[1], buf.subarray(i, i + size).subarray(0, 512 * 1024));
        i += size + 1;
      }
      resolve(out);
    });
    child.stdin.write(shas.join("\n") + "\n");
    child.stdin.end();
  });
}

// 1. live production deployment + provenance
const live = await vercelJson(["inspect", "guide-sources.vercel.app", "--json", "--no-color"]);
const ls = await vercelJson(["ls", "guide-sources", "--json", "--no-color"]);
const lsList = ls.json ? (Array.isArray(ls.json) ? ls.json : ls.json.deployments || [ls.json]) : [];
const liveHost = String(live.json?.url || "").replace(/^https:\/\//, "");
const entry = lsList.find((e) => e.url === liveHost) || null;
const deployedSha = entry?.meta?.gitCommitSha || entry?.meta?.sourceCommit || "";

// 2. the deployed tree
const head = deployedSha ? await gs(["rev-parse", "--verify", "--quiet", `${deployedSha}^{commit}`]) : { code: 1, out: "" };
const tree = deployedSha ? await gs(["ls-tree", "-r", "--name-only", deployedSha]) : { code: 1, out: "" };
const files = tree.out.split(/\r?\n/).filter(Boolean);
const artifacts = files.filter((f) => ARTIFACT.test(f));
const hasGate = files.includes("scripts/check-debug-artifacts.mjs");

// 3. reconcile + deployed ref
const mainInDeployed = deployedSha ? await gs(["merge-base", "--is-ancestor", "main", deployedSha]) : { code: 1 };
const remoteHead = await gs(["rev-parse", "--verify", "--quiet", "origin/codex-mvp"]);
const lsRemote = await gs(["ls-remote", "origin", "refs/heads/codex-mvp"], 60000);
const lsRemoteSha = (lsRemote.out.match(/^([0-9a-f]{40})\s/m) || [])[1] || "";

// 4. every committed dump blob in history, scanned for VALUE shapes (only names/counts are kept)
const objs = await gs(["rev-list", "--all", "--objects"], 300000);
const blobPaths = new Map();
for (const line of objs.out.split(/\r?\n/)) {
  const sp = line.indexOf(" ");
  if (sp < 0) continue;
  const sha = line.slice(0, sp);
  const p = line.slice(sp + 1);
  if (DUMP.test(p) && !blobPaths.has(sha)) blobPaths.set(sha, p);
}
const blobs = await catBlobs([...blobPaths.keys()]);
const valueHits = [];
let dumpsScanned = 0;
let bytesScanned = 0;
for (const [sha, path] of blobPaths) {
  const buf = blobs.get(sha);
  if (!buf) continue;
  dumpsScanned += 1;
  bytesScanned += buf.length;
  for (const h of scanSecretValues(buf.toString("utf8"))) valueHits.push({ path, pattern: h.name, count: h.count });
}

// 5. rotation record (Owner-readable; the check never prints a value)
const rot = readText(`${P.owner}\\OWNER_ROTATE_GUIDE_SOURCES.md`);
const rotationRecorded = /committed credential values[\s\S]{0,60}?\*\*NONE\.\*\*/i.test(rot) || /0 full JWTs/i.test(rot);
const piiRecorded = /PII \(4 emails, 3 user ids\)/i.test(rot);
const ownerStepOpen = /Owner check|not yet run|history decision/i.test(rot);
const rotValueHits = scanSecretValues(rot).map((h) => h.name);

// 6. live behaviour
const root = await httpGet(`${URLS.gs}/`, 30000);
const me = await httpGet(`${URLS.gs}/api/admin/me`, 30000);
const dump1 = await httpGet(`${URLS.gs}/GUIDE_SOURCES_ADMIN_SET_PASSWORD.txt`, 30000);
const dump2 = await httpGet(`${URLS.gs}/GUIDE_SOURCES_ADMIN_ME_RCE.txt`, 30000);
const rootMarker = /<title>Guide Sources<\/title>/.test(root.body) && /TRAVEL SOURCE MANAGER/.test(root.body);

const problems = [];
if (!live.json?.id) problems.push(`live alias inspect failed (${live.tail})`);
if (!entry) problems.push(`deployment ${liveHost} not found in vercel ls (${ls.tail})`);
if (live.json?.target !== "production") problems.push(`alias target is ${live.json?.target}, not production`);
if (entry && entry.state !== "READY") problems.push(`deployment state ${entry.state}`);
if (!deployedSha) problems.push("the live deployment has no git commit in its Vercel meta (no provenance)");
if (deployedSha && head.code !== 0) problems.push(`deployed commit ${deployedSha.slice(0, 7)} not present in the local repo`);
if (deployedSha && artifacts.length) problems.push(`deployed commit still has ${artifacts.length} debug artifacts (${artifacts.slice(0, 3).join(", ")})`);
if (deployedSha && !hasGate) problems.push("deployed commit does not contain the artifact gate scripts/check-debug-artifacts.mjs");
if (deployedSha && mainInDeployed.code !== 0) problems.push("main is not an ancestor of the deployed commit (no reconcile)");
if (deployedSha && remoteHead.out.trim() !== deployedSha) problems.push(`origin/codex-mvp is ${remoteHead.out.trim().slice(0, 7)}, deployed is ${deployedSha.slice(0, 7)}`);
if (lsRemoteSha && lsRemoteSha !== deployedSha) problems.push(`remote refs/heads/codex-mvp is ${lsRemoteSha.slice(0, 7)}, deployed is ${deployedSha.slice(0, 7)}`);
if (dumpsScanned < 60) problems.push(`only ${dumpsScanned} dump blobs scanned (expected the full history, >= 60)`);
if (valueHits.length) problems.push(`${valueHits.length} credential-VALUE hit(s) in committed dumps: ${valueHits.map((h) => `${h.pattern}@${h.path}`).slice(0, 3).join(", ")}`);
if (!rotationRecorded) problems.push("the rotation record does not state the committed-credential conclusion");
if (!piiRecorded) problems.push("the PII exposure is not recorded in the rotation file");
if (rotValueHits.length) problems.push(`the rotation record itself contains VALUE-shaped text (${rotValueHits.join(",")})`);
if (root.status !== 200) problems.push(`live / -> ${root.status}`);
else if (!rootMarker) problems.push("live / does not carry the Guide Sources marker");
if (me.status !== 401) problems.push(`live /api/admin/me -> ${me.status} (expected 401)`);
for (const [name, r] of [["GUIDE_SOURCES_ADMIN_SET_PASSWORD.txt", dump1], ["GUIDE_SOURCES_ADMIN_ME_RCE.txt", dump2]]) {
  if (r.status !== 404) problems.push(`live /${name} -> ${r.status} (a committed dump path is served)`);
}

done("C01", problems.length === 0, problems.length ? problems.join("; ") : `production ${live.json.id} serves ${deployedSha.slice(0, 7)} (0 debug artifacts, gate present, main merged, origin/codex-mvp agrees); ${dumpsScanned} committed dump blobs (${Math.round(bytesScanned / 1024)} KiB) scanned, 0 credential values; rotation audit recorded; live / 200, /api/admin/me 401, dump paths 404`, {
  live: { id: live.json?.id, url: liveHost, target: live.json?.target, readyState: live.json?.readyState },
  provenance: { deployedSha, meta: entry?.meta || null, sourceKind: entry?.meta?.sourceKind || "", gitRef: entry?.meta?.gitCommitRef || "" },
  tree: { files: files.length, artifactCount: artifacts.length, artifacts: artifacts.slice(0, 10), hasArtifactGate: hasGate },
  reconcile: { mainInDeployed: mainInDeployed.code === 0, originCodexMvp: remoteHead.out.trim(), lsRemoteSha, lsRemoteOk: lsRemote.code === 0 },
  dumpScan: { dumpsScanned, bytesScanned, patterns: ["supabase-secret", "supabase-publishable", "stripe-live", "aws-access-key", "jwt", "postgres-url-with-password", "pem-private-key", "generic-bearer", "github-token", "google-api-key"], valueHits },
  rotation: { rotationRecorded, piiRecorded, ownerStepOpen, valueShapesInRecord: rotValueHits, record: `${P.owner}\\OWNER_ROTATE_GUIDE_SOURCES.md` },
  http: {
    root: { status: root.status, bytes: root.body.length, marker: rootMarker },
    adminMe: me.status, adminUsers: (await httpGet(`${URLS.gs}/api/admin/users`, 30000)).status,
    dumps: { GUIDE_SOURCES_ADMIN_SET_PASSWORD: dump1.status, GUIDE_SOURCES_ADMIN_ME_RCE: dump2.status },
  },
});
