// C15 - MASTER_QUEUE C-MEDIAOS-DEPLOY (Track C): the MediaOS api PRODUCTION deployment is the
// reproducible Vercel Build Output artifact of this repo (343,361 bytes), promoted under Deploy-Lock,
// not the 2026-09-01 build (68.45 KB reported). Vercel reports a function's size COMPRESSED, so the
// round-17 "73.42 KB vs 343,361 bytes" note compared two units; this check compares like with like and
// relies on behaviour (deep-equal route inventory) plus the Deploy-Lock record for identity.
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { run, httpGet, done } from "../lib/harness.mjs";
import { P, URLS, runShell, words } from "../lib/wave3-c.mjs";

const ID = "C15";
const ARTIFACT = path.join(P.mediaos, ".vercel", "output", "functions", "index.func", "index.mjs");
const PRE_ROUND_DEPLOYMENT = "dpl_DZsbsCvNyHTzWpLEPPr7xMnepd7F"; // 2026-09-01 production, 70,093 bytes reported
const PRE_ROUND_SIZE = 70093;
const RECORDS = "D:\\FUNAGING_TEMP\\tracks\\deploy_records";
const EXPECTED_ARTIFACT_BYTES = 343361;

const out = { checks: [], artifact: {}, local: {}, live: {}, deployment: null, deployRecord: null };
const problems = [];
function check(name, ok, detail) {
  out.checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) problems.push(`${name}${detail ? ` (${detail})` : ""}`);
}

// 1. Rebuild the artifact with the project's configured build command.
const build = await run(process.execPath, ["infra-vercel-api-build.mjs"], { cwd: P.mediaos, timeoutMs: 600000 });
const builtBytes = Number((build.out.match(/bytes=(\d+)/) || [])[1] || 0);
const builtInputs = Number((build.out.match(/inputs=(\d+)/) || [])[1] || 0);
check(
  "the repo rebuilds the Build Output artifact",
  build.code === 0 && /VERCEL_API_BUILD ok/.test(build.out) && builtBytes === EXPECTED_ARTIFACT_BYTES,
  `exit=${build.code} bytes=${builtBytes} inputs=${builtInputs} ${words(build.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | "))}`
);

const bytes = readFileSync(ARTIFACT);
const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
const gzip = gzipSync(bytes, { level: 9 }).length;
out.artifact = { file: ARTIFACT, bytes: bytes.length, sha256, gzipBytes: gzip, inputs: builtInputs };
check("the artifact is the recorded 343,361-byte bundle", bytes.length === EXPECTED_ARTIFACT_BYTES && sha256.length === 64, `bytes=${bytes.length} sha256=${sha256}`);

// 2. Run the real artifact in a real HTTP server and capture its contract.
const foundationRoot = await mkdtemp(path.join(tmpdir(), "mediaos-c15-"));
let localServer;
try {
  process.env.MEDIA_OS_FOUNDATION_ROOT = foundationRoot;
  const { default: handler } = await import(pathToFileURL(ARTIFACT).href);
  localServer = createServer(handler);
  await new Promise((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${localServer.address().port}`;
  const localRoot = await (await fetch(`${base}/`)).json();
  const localHealth = await (await fetch(`${base}/health`)).json();
  out.local = { mode: localRoot.mode, postRoutes: localRoot.routes?.post?.length, getRoutes: localHealth.routes?.get?.length, rootRoutes: localRoot.routes, healthRoutes: localHealth.routes };
  check("the artifact serves mode=standalone", localRoot.ok === true && localRoot.mode === "standalone" && Array.isArray(localRoot.routes?.post), `service=${localRoot.service} post=${out.local.postRoutes} get=${out.local.getRoutes}`);
} finally {
  if (localServer) {
    localServer.closeAllConnections?.();
    await new Promise((resolve) => localServer.close(resolve));
  }
  await rm(foundationRoot, { recursive: true, force: true });
}

// 3. The LIVE production alias answers exactly like the artifact (deep-equal route inventory).
const liveRoot = await httpGet(`${URLS.mediaosApi}/`);
const liveHealth = await httpGet(`${URLS.mediaosApi}/health`);
let liveRootJson = null;
let liveHealthJson = null;
try { liveRootJson = JSON.parse(liveRoot.body); } catch { /* not json */ }
try { liveHealthJson = JSON.parse(liveHealth.body); } catch { /* not json */ }
out.live = {
  root: { status: liveRoot.status, mode: liveRootJson?.mode ?? null, postRoutes: liveRootJson?.routes?.post?.length ?? null },
  health: { status: liveHealth.status, getRoutes: liveHealthJson?.routes?.get?.length ?? null },
};
check(
  "live / serves the artifact contract",
  liveRoot.status === 200 && liveRootJson?.ok === true && liveRootJson?.mode === "standalone" && liveRootJson?.service === "funaging-media-os-api",
  `status=${liveRoot.status} mode=${liveRootJson?.mode}`
);
const inventoryEqual =
  Boolean(liveRootJson && liveHealthJson) &&
  JSON.stringify(liveHealthJson.routes) === JSON.stringify(out.local.healthRoutes) &&
  JSON.stringify(liveRootJson.routes) === JSON.stringify(out.local.rootRoutes);
check(
  "live route inventory is deep-equal to the artifact's",
  inventoryEqual,
  `live post/get=${liveRootJson?.routes?.post?.length}/${liveHealthJson?.routes?.get?.length} artifact=${out.local.postRoutes}/${out.local.getRoutes}`
);
check("live /health 200", liveHealth.status === 200 && liveHealthJson?.ok === true, `status=${liveHealth.status}`);

const anonymous = await fetch(`${URLS.mediaosApi}/publishing/run`, { method: "POST", body: "{}" });
const anonymousJson = await anonymous.json().catch(() => null);
check("live identity guard refuses an anonymous POST", anonymous.status === 401 && anonymousJson?.code === "UNAUTHENTICATED", `status=${anonymous.status} code=${anonymousJson?.code}`);

// 4. The production deployment behind the alias: a new READY production deployment, one Node lambda,
//    whose reported (compressed) size matches this artifact and not the 2026-09-01 build.
const inspect = await runShell(`vercel inspect funaging-media-os-api.vercel.app --json`, { cwd: P.mediaos, timeoutMs: 180000 });
let deployment = null;
try { deployment = JSON.parse(inspect.out); } catch { deployment = null; }
const output = deployment?.builds?.[0]?.output || [];
const lambdas = output.filter((entry) => entry.type === "lambda");
const lambda = lambdas[0];
out.deployment = {
  id: deployment?.id ?? null,
  state: deployment?.readyState ?? null,
  target: deployment?.target ?? null,
  lambdas: lambdas.length,
  path: lambda?.path ?? null,
  runtime: lambda?.lambda?.runtime ?? null,
  reportedSize: lambda?.size ?? null,
  digest: lambda?.digest ?? null,
  previous: PRE_ROUND_DEPLOYMENT,
};
check(
  "the alias serves a NEW deployment, not the 2026-09-01 build",
  inspect.code === 0 && Boolean(deployment?.id) && deployment.id !== PRE_ROUND_DEPLOYMENT,
  `id=${deployment?.id} previous=${PRE_ROUND_DEPLOYMENT}`
);
check("the live deployment is READY production", deployment?.readyState === "READY" && deployment?.target === "production", `state=${deployment?.readyState} target=${deployment?.target}`);
check("exactly one Node lambda `index`", lambdas.length === 1 && lambda?.path === "index" && lambda?.lambda?.runtime === "nodejs24.x", `lambdas=${lambdas.length} path=${lambda?.path} runtime=${lambda?.lambda?.runtime}`);
check(
  "the lambda's reported size is this artifact (Vercel reports it compressed), not the old 70,093 bytes",
  typeof lambda?.size === "number" && lambda.size !== PRE_ROUND_SIZE && lambda.size > 60000 && Math.abs(lambda.size - gzip) / gzip < 0.15,
  `reported=${lambda?.size} raw=${bytes.length} gzip=${gzip} old=${PRE_ROUND_SIZE}`
);

// 5. The deployment serving the alias was made through Deploy-Lock with the rollback target recorded BEFORE
//    the change. After the C-SEC rotation the live deployment is the rotation's redeploy of this same artifact,
//    so a verified Track C record for C-MEDIAOS-DEPLOY (the original promotion) OR C-SEC (bootstrap/rotation)
//    that names the live deployment in this repository satisfies the invariant. An unrelated record cannot:
//    it must be Track C, state=verified, workDir this repo, name the live id, and carry a different rollback id.
let newest = null;
try {
  for (const name of readdirSync(RECORDS)) {
    if (!name.endsWith(".json") || !name.includes("_C_")) continue;
    try {
      const record = JSON.parse(readFileSync(path.join(RECORDS, name), "utf8"));
      if (record.state !== "verified" || !/(C-MEDIAOS-DEPLOY|C-SEC)/.test(String(record.action))) continue;
      if (String(record.workDir || "").toLowerCase() !== P.mediaos.toLowerCase()) continue;
      if (!String(record.change + record.verify).includes(deployment?.id)) continue;
      if (record.rollbackTarget === deployment?.id) continue;
      if (!/^dpl_/.test(String(record.rollbackTarget || ""))) continue;
      if (!newest || String(record.finishedAt) > String(newest.finishedAt)) newest = { file: name, ...record };
    } catch { /* not a record */ }
  }
} catch { newest = null; }
out.deployRecord = newest ? { file: newest.file, action: newest.action, rollbackTarget: newest.rollbackTarget, state: newest.state, startedAt: newest.startedAt, finishedAt: newest.finishedAt } : null;
check(
  "the live deployment was promoted under Deploy-Lock with a rollback target recorded first",
  Boolean(newest) && newest.rollbackTarget !== deployment?.id && /dpl_/.test(String(newest.rollbackTarget)),
  newest ? `${newest.file} rollback=${newest.rollbackTarget}` : "no verified C-MEDIAOS-DEPLOY/C-SEC record naming the live deployment"
);

done(
  ID,
  problems.length === 0,
  problems.length
    ? problems.join("; ")
    : `MediaOS api production ${deployment.id} serves the reproducible Build Output artifact (${bytes.length} bytes, sha256 ${sha256.slice(0, 16)}…; Vercel reports it compressed at ${lambda.size} B): deep-equal route inventory ${out.local.postRoutes} POST/${out.local.getRoutes} GET, mode=standalone, identity guard 401, one nodejs24.x lambda; promoted under Deploy-Lock, rollback ${newest.rollbackTarget}`,
  { artifact: out.artifact, local: out.local, live: out.live, deployment: out.deployment, deployRecord: out.deployRecord, checks: out.checks, problems }
);
