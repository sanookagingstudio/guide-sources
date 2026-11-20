// C02 - MediaOS: the project <-> directory mapping is re-derived from the LIVE Vercel project settings,
// the documented deploy procedure is re-verified against them, and the API deploy artifact is rebuilt and smoked.
import { run, httpGet, done } from "../lib/harness.mjs";
import { P, runShell, words } from "../lib/wave3-c.mjs";

const out = {};

// 1. Live project settings vs docs/DEPLOY_MODEL.md (the repo's own read-only verifier).
const verify = await run(process.execPath, ["tools/deploy/verify-deploy-model.mjs"], { cwd: P.mediaos, timeoutMs: 300000 });
out.verifyDeployModel = { code: verify.code, tail: words(verify.out.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")) };
const verifyOk = verify.code === 0 && /VERIFY_DEPLOY_MODEL (\d+)\/\1 PASS/.test(verify.out);

// 2. Rebuild the API deploy artifact with the configured build command, then smoke the real handler.
const build = await run(process.execPath, ["infra-vercel-api-build.mjs"], { cwd: P.mediaos, timeoutMs: 600000 });
out.apiBuild = { code: build.code, tail: words(build.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")) };
const buildOk = build.code === 0 && /VERCEL_API_BUILD ok/i.test(build.out);

const smoke = await run(process.execPath, ["tools/deploy/smoke-api-function.mjs"], { cwd: P.mediaos, timeoutMs: 420000 });
out.apiSmoke = { code: smoke.code, tail: words(smoke.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")) };
const smokeOk = smoke.code === 0 && /SMOKE_API_FUNCTION (\d+)\/\1 PASS/.test(smoke.out);

// 3. Both production aliases still answer with the documented shapes.
const web = await httpGet("https://funaging-media-os-web.vercel.app/");
const api = await httpGet("https://funaging-media-os-api.vercel.app/health");
let apiJson = null;
try { apiJson = JSON.parse(api.body); } catch { /* not json */ }
out.live = {
  web: { status: web.status, bytes: web.body.length, html: /<html/i.test(web.body) },
  api: { status: api.status, bytes: api.body.length, json: Boolean(apiJson), mode: apiJson && apiJson.mode ? apiJson.mode : null },
};
const liveOk = web.status === 200 && /<html/i.test(web.body) && web.body.length > 10000 && api.status === 200 && Boolean(apiJson);

const problems = [];
if (!verifyOk) problems.push("live Vercel settings no longer match docs/DEPLOY_MODEL.md");
if (!buildOk) problems.push(`infra-vercel-api-build.mjs failed (exit ${build.code})`);
if (!smokeOk) problems.push(`built API artifact smoke failed (exit ${smoke.code})`);
if (!liveOk) problems.push(`live aliases: web ${web.status}, api ${api.status}`);
if (web.status !== 200 && /40[13]/.test(String(web.status))) problems.push("web alias unreachable");

done("C02", problems.length === 0, problems.length ? problems.join("; ") : `live mapping re-derived (web apps/web, api repo root), verifier ${verify.out.match(/VERIFY_DEPLOY_MODEL (\d+\/\d+)/)?.[1]}, artifact rebuilt + ${smoke.out.match(/SMOKE_API_FUNCTION (\d+\/\d+)/)?.[1]} smoke, both aliases 200`, out);
