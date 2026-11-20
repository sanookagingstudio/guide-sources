// C08 - Staff/Admin APKs: identity read from the PUBLISHED BYTES (live download), version binding against the
// source gradle, signature verified with apksigner, then a real install + launch on an Android emulator.
// Read-only on Track A's repo: the build itself is Track A's.
import { spawn, execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { done } from "../lib/harness.mjs";
import { P, sha256File, gradleVersion } from "../lib/wave3-c.mjs";

const out = { apks: [], install: {} };
const tmp = mkdtempSync(path.join(P.tmp, "dod-c08-"));
const sha = (buf) => createHash("sha256").update(buf).digest("hex").toUpperCase();

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
    try {
      res.install = String(adbRun(["-s", serial, "install", "-r", "-t", rec.tmp])).trim().split(/\r?\n/).pop();
    } catch (e) { res.install = `ERROR ${String(e.message).slice(0, 160)}`; }
    try {
      const w = String(adbRun(["-s", serial, "shell", "am", "start", "-W", "-n", `${rec.package}/.MainActivity`]));
      res.startStatus = (w.match(/Status:\s*(\w+)/) || [])[1] || null;
      res.totalTime = (w.match(/TotalTime:\s*(\d+)/) || [])[1] || null;
    } catch (e) { res.startStatus = `ERROR ${String(e.message).slice(0, 120)}`; }
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
  if (inst.startStatus !== "ok") problems.push(`${rec.key}: launch ${inst.startStatus ?? "not run"}`);
  if (!inst.topResumed || !inst.topResumed.startsWith(rec.package)) problems.push(`${rec.key}: topResumedActivity ${inst.topResumed ?? "unknown"}`);
  if (!inst.screenshot?.png || (inst.screenshot.bytes || 0) < 5000) problems.push(`${rec.key}: launch screenshot not captured`);
}

done("C08", problems.length === 0, problems.length ? problems.join("; ") : `both APKs downloaded from funaging.club (SHA-256 identical in repo+evidence), recorded provenance matches the bytes, v2 signature verified, ${out.apks.map((a) => `${a.key} ${a.versionCode}/${a.versionName}`).join(", ")}, install+launch Success on ${out.install.serial}${drift.length ? `; WARN version drift vs source: ${drift.join("; ")}` : ""}`, { ...out, drift, tmp });
