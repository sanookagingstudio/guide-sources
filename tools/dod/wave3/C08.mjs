// C08 - Staff/Admin APKs: identity read from the PUBLISHED BYTES (live download), version binding against the
// source gradle, signature verified with apksigner, then a real install + launch on an Android emulator.
// Read-only on Track A's repo: the build itself is Track A's.
import { spawn, execFileSync, execSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { done } from "../lib/harness.mjs";
import { P, sha256File, gradleVersion } from "../lib/wave3-c.mjs";

const out = { apks: [], install: {} };
const tmp = mkdtempSync(path.join(P.tmp, "dod-c08-"));
const sha = (buf) => createHash("sha256").update(buf).digest("hex").toUpperCase();

// ActivityManager reports the activity resumed BEFORE the Capacitor WebView paints, so a screenshot taken at that
// moment is a blank white frame. Read the raw framebuffer (16-byte header + RGBA_8888) and require the app area to
// hold a rendered UI: colour variety plus pixels that are not the modal background.
const renderStats = (buf) => {
  if (!buf || buf.length < 16) return { ok: false, reason: "short framebuffer" };
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  const fmt = buf.readUInt32LE(8);
  const pixelStart = buf.length >= 16 + w * h * 4 ? 16 : 12;
  if (fmt !== 1 || pixelStart + w * h * 4 > buf.length) return { ok: false, reason: `framebuffer ${w}x${h} fmt ${fmt}` };
  const counts = new Map();
  let total = 0;
  for (let y = Math.floor(h * 0.12); y < Math.floor(h * 0.92); y += 6) {
    for (let x = 0; x < w; x += 6) {
      const i = pixelStart + (y * w + x) * 4;
      const key = ((buf[i] >> 4) << 8) | ((buf[i + 1] >> 4) << 4) | (buf[i + 2] >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
      total += 1;
    }
  }
  let modal = 0;
  for (const v of counts.values()) modal = Math.max(modal, v);
  const nonBackground = (total - modal) / total;
  return {
    ok: counts.size >= 12 && nonBackground >= 0.03,
    width: w,
    height: h,
    sampled: total,
    distinctColors: counts.size,
    nonBackgroundFraction: Number(nonBackground.toFixed(3)),
  };
};

const SPECS = [
  { key: "staff", file: "SANOOK_Staff_v1.0.54_release.apk", pkg: "com.sanookagingstudio.staff", gradle: `${P.mainweb}\\android\\app\\build.gradle` },
  { key: "admin", file: "FUNAGING_Admin_v1.0.50_release.apk", pkg: "com.sanookagingstudio.admin", gradle: `${P.mainweb}\\android-admin\\app\\build.gradle` },
];

for (const spec of SPECS) {
  const rec = { key: spec.key, file: spec.file };
  // 1. Fetch the file the public actually downloads and hash those bytes.
  const liveUrl = `https://funaging.club/releases/${spec.file}`;
  try {
    const r = await fetch(liveUrl, { redirect: "follow" });
    const buf = Buffer.from(await r.arrayBuffer());
    rec.liveStatus = r.status;
    rec.liveBytes = buf.length;
    rec.liveSha256 = sha(buf);
    const local = path.join(tmp, spec.file);
    writeFileSync(local, buf);
    rec.tmp = local;
  } catch (e) { rec.liveError = String(e).slice(0, 200); }

  // 2. Same bytes in the repo and in the Track C evidence copy?
  const repoFile = `${P.mainweb}\\public\\releases\\${spec.file}`;
  const evFile = `${P.apk}\\live\\${spec.file}`;
  rec.repoSha256 = existsSync(repoFile) ? sha256File(repoFile) : null;
  rec.evidenceSha256 = existsSync(evFile) ? sha256File(evFile) : null;
  rec.bytesIdentical = Boolean(rec.liveSha256 && rec.liveSha256 === rec.repoSha256 && rec.liveSha256 === rec.evidenceSha256);

  // 3. Signature + version from the downloaded bytes.
  const apk = rec.tmp;
  if (apk && existsSync(apk)) {
    try {
      const v = execSync(`"${P.buildTools}\\apksigner.bat" verify --print-certs --verbose "${apk}"`, { encoding: "utf8", timeout: 120000 });
      rec.signature = {
        verified: /\bVerifies\b/.test(v),
        v1: /Verified using v1 scheme \(JAR signing\): true/.test(v),
        v2: /Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(v),
        v3: /Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(v),
        certSha256: (v.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f:]+)/i) || [])[1]?.toUpperCase() || null,
        signerSubject: (v.match(/Signer #1 certificate DN:\s*(.+)/) || [])[1]?.trim() || null,
      };
    } catch (e) { rec.signature = { verified: false, error: String(e.message).slice(0, 200) }; }

    try {
      const b = execFileSync(`${P.buildTools}\\aapt2.exe`, ["dump", "badging", apk], { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      rec.package = (b.match(/package: name='([^']+)'/) || [])[1] || null;
      rec.versionCode = Number((b.match(/versionCode='(\d+)'/) || [])[1] || 0) || null;
      rec.versionName = (b.match(/versionName='([^']+)'/) || [])[1] || null;
      rec.hasCapacitorConfig = /assets\/capacitor\.config\.json/.test(b) || null;
    } catch (e) { rec.aaptError = String(e.message).slice(0, 200); }
  }

  rec.source = gradleVersion(spec.gradle);
  rec.binding = rec.versionCode === rec.source.versionCode && rec.versionName === rec.source.versionName;
  out.apks.push(rec);
}

// 4. Real install + launch on an emulator (AVD created by Track C in round 25).
// The emulator is ONE shared device: a second Track C sweep (or a driver re-run) starting `am start` between this
// check's launch and its topResumed read made C08 fail on a healthy APK (observed round 21). Serialize with a lock
// file in Track C's temp dir so two checks never drive the device at once; a stale lock (>20 min) is taken over.
const lockFile = path.join(P.tmp, "c08-emulator.lock");
const lockDeadline = Date.now() + 15 * 60 * 1000;
let lockFd = null;
while (lockFd === null) {
  try {
    lockFd = openSync(lockFile, "wx");
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  } catch {
    try {
      const held = JSON.parse(readFileSync(lockFile, "utf8"));
      if (Date.now() - Date.parse(held.at) > 20 * 60 * 1000) { unlinkSync(lockFile); continue; }
    } catch { /* half-written or vanished: retry */ }
    if (Date.now() > lockDeadline) break; // proceed anyway rather than hang: the device state is still asserted below
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const releaseLock = () => { try { if (lockFd !== null) closeSync(lockFd); } catch { /* closed */ } try { unlinkSync(lockFile); } catch { /* gone */ } };
process.on("exit", releaseLock);

const emulatorEnv = { ...process.env, ANDROID_SDK_ROOT: P.sdk, ANDROID_HOME: P.sdk, ANDROID_AVD_HOME: P.avdHome };
const adb = P.adb;
const adbRun = (args, opts = {}) => execFileSync(adb, args, { encoding: "utf8", timeout: 180000, ...opts });
let serial = "";
try {
  serial = String(adbRun(["devices"])).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^emulator-\d+\s+device$/.test(l))[0]?.split(/\s+/)[0] || "";
} catch { /* adb missing */ }

let emu = null;
if (!serial && existsSync(P.emulator)) {
  emu = spawn(P.emulator, ["-avd", "c08_verify", "-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect", "-no-snapshot-save"], {
    env: emulatorEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  for (let i = 0; i < 60 && !serial; i += 1) {
    try {
      serial = String(adbRun(["devices"])).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^emulator-\d+\s+(device|offline)$/.test(l))[0]?.split(/\s+/)[0] || "";
    } catch { /* not up */ }
    if (!serial) await new Promise((r) => setTimeout(r, 5000));
  }
}
if (serial) {
  out.install.serial = serial;
  for (let i = 0; i < 60; i += 1) {
    try {
      if (String(adbRun(["-s", serial, "shell", "getprop", "sys.boot_completed"])).trim() === "1") break;
    } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  for (const rec of out.apks) {
    const res = { key: rec.key };
    // CLEAN install, not an upgrade: `install -r` silently keeps a newer app already on the device (round 21's build
    // put admin 52/1.0.51 there, so -r of the published 51/1.0.50 failed INSTALL_FAILED_VERSION_DOWNGRADE while
    // `am start` still opened the OLD app and looked like a launch). Uninstall, install without -r, then read the
    // installed version back and require it to equal the version inside the downloaded bytes.
    try {
      res.uninstall = String(adbRun(["-s", serial, "uninstall", rec.package])).trim() || "Success";
    } catch (e) {
      const msg = String(e.message);
      res.uninstall = /Unknown package|not installed|DELETE_FAILED_INTERNAL_ERROR/i.test(msg) ? "not-installed" : `ERROR ${msg.slice(0, 160)}`;
    }
    try {
      res.install = String(adbRun(["-s", serial, "install", "-t", rec.tmp])).trim().split(/\r?\n/).pop();
    } catch (e) { res.install = `ERROR ${String(e.message).slice(0, 160)}`; }
    try {
      const d = String(adbRun(["-s", serial, "shell", "dumpsys", "package", rec.package]));
      res.installedVersionCode = Number((d.match(/versionCode=(\d+)/) || [])[1] || 0) || null;
      res.installedVersionName = (d.match(/versionName=([^\s]+)/) || [])[1] || null;
    } catch (e) { res.installedError = String(e.message).slice(0, 120); }
    try {
      const w = String(adbRun(["-s", serial, "shell", "am", "start", "-W", "-n", `${rec.package}/.MainActivity`]));
      res.startStatus = (w.match(/Status:\s*(\w+)/) || [])[1] || null;
      res.totalTime = (w.match(/TotalTime:\s*(\d+)/) || [])[1] || null;
    } catch (e) { res.startStatus = `ERROR ${String(e.message).slice(0, 120)}`; }
    // Poll the framebuffer until the WebView has painted AND settled: three consecutive samples (2 s apart) must be
    // identical, so a transient splash frame is not accepted as the app UI. First sample only after 6 s.
    try {
      const launchAt = Date.now();
      const samples = [];
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 6000 : 2000));
        const raw = execFileSync(adb, ["-s", serial, "exec-out", "screencap"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
        const s = { ...renderStats(raw), atMs: Date.now() - launchAt };
        samples.push(s);
        const last3 = samples.slice(-3);
        if (last3.length === 3 && last3.every((x) => x.ok && x.distinctColors === s.distinctColors && Math.abs(x.nonBackgroundFraction - s.nonBackgroundFraction) < 0.005)) {
          res.render = { ...s, settleMs: s.atMs, samples: samples.length };
          break;
        }
        if (attempt === 14) res.render = { ...s, samples: samples.length, settled: false, ok: false, reason: "UI never settled (splash or re-render loop)" };
      }
    } catch (e) { res.render = { ok: false, reason: String(e.message).slice(0, 120) }; }
    try {
      const top = String(adbRun(["-s", serial, "shell", "dumpsys", "activity", "activities"]));
      res.topResumed = (top.match(/topResumedActivity=ActivityRecord\{[^}]*\s([\w.]+)\/([\w.$]+)/) || []).slice(1).join("/") || null;
    } catch { /* ignore */ }
    try {
      const png = execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 40 * 1024 * 1024, timeout: 120000 });
      const pngPath = path.join(P.apk, "install", `dod_${rec.key}_launch.png`);
      writeFileSync(pngPath, png);
      res.screenshot = { file: pngPath, bytes: png.length, png: png.subarray(0, 4).toString("hex") === "89504e47" };
    } catch (e) { res.screenshot = { error: String(e.message).slice(0, 120) }; }
    out.install[rec.key] = res;
  }
  if (emu) { try { adbRun(["-s", serial, "emu", "kill"]); } catch { /* already gone */ } }
} else {
  out.install.error = "no emulator device became available";
}
if (emu) { try { emu.kill(); } catch { /* gone */ } }
releaseLock();

const problems = [];
const drift = [];
let recorded = null;
try { recorded = JSON.parse(readFileSync(`${P.apk}\\apk_provenance.json`, "utf8")); } catch { /* missing */ }

for (const rec of out.apks) {
  if (rec.liveStatus !== 200) problems.push(`${rec.key}: live download ${rec.liveStatus ?? rec.liveError}`);
  if (!rec.bytesIdentical) problems.push(`${rec.key}: live bytes differ from repo/evidence copy`);
  if (!rec.signature?.verified || !rec.signature?.v2) problems.push(`${rec.key}: signature not verified (v2)`);
  if (rec.package !== SPECS.find((s) => s.key === rec.key).pkg) problems.push(`${rec.key}: package ${rec.package}`);

  // The recorded provenance must equal what the bytes say (a stale record is a FAIL).
  const recRow = recorded?.apks?.find((a) => a.label === `${rec.key}_live`);
  if (!recRow) problems.push(`${rec.key}: no recorded provenance row (${rec.key}_live)`);
  else if (recRow.sha256?.toUpperCase() !== rec.liveSha256 || recRow.versionCode !== rec.versionCode || recRow.versionName !== rec.versionName) {
    problems.push(`${rec.key}: recorded provenance does not match the bytes`);
  }

  // Version binding to the CURRENT source tree: a published APK that lags its source is drift, reported not hidden.
  rec.bindingToSource = rec.versionCode === rec.source.versionCode && rec.versionName === rec.source.versionName;
  if (!rec.bindingToSource) drift.push(`${rec.key} ${rec.versionCode}/${rec.versionName} vs source ${rec.source.versionCode}/${rec.source.versionName}`);

  const inst = out.install[rec.key] || {};
  if (!/^Success$/i.test(String(inst.install || ""))) problems.push(`${rec.key}: install ${inst.install ?? "not run"}`);
  if (inst.installedVersionCode !== rec.versionCode) {
    problems.push(`${rec.key}: installed versionCode ${inst.installedVersionCode ?? "unknown"} != published ${rec.versionCode}`);
  }
  if (inst.startStatus !== "ok") problems.push(`${rec.key}: launch ${inst.startStatus ?? "not run"}`);
  if (!inst.render?.ok) problems.push(`${rec.key}: UI not rendered (${inst.render?.reason || `distinct=${inst.render?.distinctColors ?? "?"} nonBg=${inst.render?.nonBackgroundFraction ?? "?"}`})`);
  if (!inst.topResumed || !inst.topResumed.startsWith(rec.package)) problems.push(`${rec.key}: topResumedActivity ${inst.topResumed ?? "unknown"}`);
  if (!inst.screenshot?.png || (inst.screenshot.bytes || 0) < 5000) problems.push(`${rec.key}: launch screenshot not captured`);
}

done("C08", problems.length === 0, problems.length ? problems.join("; ") : `both APKs downloaded from funaging.club (SHA-256 identical in repo+evidence), recorded provenance matches the bytes, v2 signature verified, ${out.apks.map((a) => `${a.key} ${a.versionCode}/${a.versionName}`).join(", ")}, clean install (uninstall + install, installed versionCode readback) + launch Success with a painted, settled UI (${out.apks.map((a) => `${a.key} ${out.install[a.key]?.render?.distinctColors ?? "?"} colours @${out.install[a.key]?.render?.settleMs ?? "?"}ms`).join(", ")}) on ${out.install.serial}${drift.length ? `; WARN version drift vs source: ${drift.join("; ")}` : ""}`, { ...out, drift, tmp });
