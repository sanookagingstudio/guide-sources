// C05 - field-app: the REAL built bundle is driven in a real browser (Playwright) to prove the offline queue
// survives a reload, a sync attempt never fakes success, media capacity is enforced and permissions are named.
// The production alias is probed too, but a deploy that has not happened yet is recorded as a WARN, not invented.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { run, httpGet, done } from "../lib/harness.mjs";
import { P, readText, runShell, words } from "../lib/wave3-c.mjs";

const out = {};
const childEnv = { ...process.env, CI: "1" };

// 1. Build the real artifact.
const build = await runShell("npm run build", { cwd: P.field, timeoutMs: 600000 });
out.build = { code: build.code, tail: words(build.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")) };
const buildOk = build.code === 0;

// 2. Inspect the built bytes.
let bundle = { file: null, bytes: 0, hasIdempotencyKey: false, hasNothingWasSent: false, hasMockSync: false };
try {
  const dir = path.join(P.field, "dist", "assets");
  const file = readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f))[0];
  if (file) {
    const text = readText(path.join(dir, file), 20 * 1024 * 1024);
    bundle = {
      file,
      bytes: text.length,
      hasIdempotencyKey: text.includes("idempotencyKey"),
      hasNothingWasSent: /Nothing was sent/i.test(text),
      hasMockSync: /Mock mark all synced/i.test(text),
    };
  }
} catch { /* dist missing */ }
out.bundle = bundle;

// 3. Start the preview server on the built bundle and run the browser suite against it.
const port = Number(process.env.DOD_FIELD_PORT || 4319);
const preview = spawn("cmd.exe", ["/d", "/s", "/c", `npm run preview -- --port ${port} --strictPort`], {
  cwd: P.field, env: childEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let previewLog = "";
preview.stdout.on("data", (d) => (previewLog += d.toString()));
preview.stderr.on("data", (d) => (previewLog += d.toString()));

let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
  const r = await httpGet(`http://localhost:${port}/`, 4000);
  if (r.status === 200) up = true;
  else await new Promise((res) => setTimeout(res, 1000));
}
out.preview = { port, up, log: words(previewLog.slice(-400)) };

let pw = { code: -1, out: "" };
if (up) {
  pw = await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "tests/runtime-field-app.spec.ts", "--reporter=line", "--workers=1"], {
    cwd: P.field, env: { ...process.env, FIELD_APP_URL: `http://localhost:${port}` }, timeoutMs: 600000,
  });
}
out.playwright = { code: pw.code, tail: words(pw.out.split(/\r?\n/).filter(Boolean).slice(-4).join(" | ")) };
await run("cmd.exe", ["/d", "/s", "/c", `taskkill /PID ${preview.pid} /T /F`], { timeoutMs: 30000 });

// 4. Production alias: record the real state (a pending deploy is a WARN, never a fake PASS).
const liveHtml = await httpGet("https://funaging-field-app.vercel.app/");
let liveBundle = { url: null, hasMockSync: null, hasIdempotencyKey: null };
try {
  const src = (liveHtml.body.match(/src="([^"]*assets\/index-[^"]*\.js)"/) || [])[1];
  if (src) {
    const b = await httpGet(new URL(src, "https://funaging-field-app.vercel.app/").href, 60000);
    liveBundle = { url: src, hasMockSync: /Mock mark all synced/i.test(b.body), hasIdempotencyKey: b.body.includes("idempotencyKey") };
  }
} catch { /* leave unknown */ }
out.live = { status: liveHtml.status, bundle: liveBundle };

const problems = [];
if (!buildOk) problems.push(`npm run build failed (exit ${build.code})`);
if (!bundle.file) problems.push("dist/assets/index-*.js not produced");
else {
  if (!bundle.hasIdempotencyKey) problems.push("built bundle has no idempotencyKey");
  if (!bundle.hasNothingWasSent) problems.push("built bundle does not tell the truth ('Nothing was sent' missing)");
  if (bundle.hasMockSync) problems.push("built bundle still contains 'Mock mark all synced'");
}
if (!up) problems.push(`preview server did not answer on :${port}`);
if (pw.code !== 0) problems.push(`Playwright suite failed (exit ${pw.code})`);
const liveWarn = liveBundle.hasMockSync ? "live alias still serves the pre-round bundle (Owner deploy pending)" : "";

done("C05", problems.length === 0, problems.length ? problems.join("; ") : `built bundle ${bundle.file} (${bundle.bytes} B) drives 3 browser flows: queue survives reload, sync is honest, media gated${liveWarn ? `; WARN ${liveWarn}` : ""}`, { ...out, liveWarn });
