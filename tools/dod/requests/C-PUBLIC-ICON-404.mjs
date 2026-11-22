// C-PUBLIC-ICON-404 - the two remaining Track C public pages declare a page icon and load clean.
//
// Defect (Track F crawler 2026-11-21T21:39Z, re-measured by Track C round 41 and round 42): an anonymous visitor
// of https://funaging-machine-bible.vercel.app/ and https://guide-sources.vercel.app/ got ONE 404 console error
// per load because the document declared no page icon and the project served no /favicon.ico, so the browser's
// automatic favicon request 404'd.
//
// This check proves the REPAIR against the real targets, not a grep:
//   1. TWO independent real Chromium loads of each live page through the shared probe
//      (dod/golive/lib/public-page-console-probe -> public-page-gate.mjs): HTTP 200, a DECLARED non-empty
//      icon, ZERO console errors and ZERO first-party responses >= 400 - with only the ALREADY-RECORDED
//      third-party response allowed (guide-sources' Supabase REST 402 = Track A's P1-A-SUPABASE-EGRESS-402,
//      recorded by URL; any other error on either page FAILS).
//   2. The declared icon really resolves: a data URI is carried by the document; an http(s) icon path is
//      fetched and must answer 200 with an SVG/image content type (a declared-but-404 icon FAILS).
//   3. Provenance: the live production deployment is READY, carries a git commit, and that commit is the
//      deployed ref for guide-sources (`git ls-remote origin refs/heads/codex-mvp`, the C01 rule) and exists
//      in the machine-bible repo with the icon in its committed index.html.
//
// CLI-level, read-only against production apart from the deploys this row already recorded under Deploy-Lock.
import { done, httpGet, run } from "../lib/harness.mjs";
import { gatePublicPage } from "../golive/lib/public-page-gate.mjs";
import { P, words } from "../lib/wave3-c.mjs";

const MB = "https://funaging-machine-bible.vercel.app/";
const GS = "https://guide-sources.vercel.app/";
// The ONE recorded third-party response, by URL: the Club Supabase REST 402 that every guide-sources load shows.
// It is Track A's Owner row P1-A-SUPABASE-EGRESS-402 and NOT part of this row's fix; nothing else is tolerated.
const GS_ALLOW = ["hbjocppvllpcbmhkiode\\.supabase\\.co"];

function firstJson(text) {
  const t = String(text || "");
  const i = t.search(/[[{]/);
  if (i < 0) return null;
  try { return JSON.parse(t.slice(i)); } catch { return null; }
}

async function vercelJson(cwd, args) {
  const r = await run("cmd.exe", ["/d", "/s", "/c", `vercel ${args.join(" ")}`], { cwd, timeoutMs: 180000 });
  return { json: firstJson(r.out) || firstJson(r.err), code: r.code, tail: words(`${r.out} ${r.err}`) };
}

// The live production deployment of an alias plus its Vercel git meta (from the project deployment list).
async function liveDeployment(cwd, alias, project) {
  const live = await vercelJson(cwd, ["inspect", alias, "--json", "--no-color"]);
  const host = String(live.json?.url || "").replace(/^https:\/\//, "");
  const ls = await vercelJson(cwd, ["ls", project, "--json", "--no-color"]);
  const list = ls.json ? (Array.isArray(ls.json) ? ls.json : ls.json.deployments || [ls.json]) : [];
  const entry = list.find((e) => e.url === host) || null;
  return {
    ok: !!live.json?.id && !!entry,
    id: live.json?.id || "",
    host,
    target: live.json?.target || "",
    readyState: live.json?.readyState || "",
    sha: entry?.meta?.gitCommitSha || entry?.meta?.sourceCommit || "",
    ref: entry?.meta?.gitCommitRef || "",
    sourceKind: entry?.meta?.sourceKind || "",
    state: entry?.state || "",
    tail: words(`${live.tail} ${ls.tail}`),
  };
}

// Two independent real browser loads; both must be clean for the page to count.
async function gateTwice(url, allow) {
  const samples = [];
  for (let i = 0; i < 2; i++) {
    const g = gatePublicPage(url, { allow, wait: 2500 });
    samples.push({
      ok: g.ok,
      status: g.page?.status ?? 0,
      icon: g.page?.iconDeclared || "",
      problems: g.problems,
      tolerated: g.tolerated,
      consoleErrors: g.page?.consoleErrors || [],
      httpErrors: g.page?.httpErrors || [],
      probeExit: g.exit,
    });
  }
  return samples;
}

async function git(repo, args, timeoutMs = 120000) {
  return run("git", ["-C", repo, ...args], { timeoutMs });
}

const problems = [];
const evidence = { pages: {}, provenance: {} };

for (const [key, url, allow] of [["machineBible", MB, []], ["guideSources", GS, GS_ALLOW]]) {
  const samples = await gateTwice(url, allow);
  const bad = samples.filter((s) => !s.ok);
  if (bad.length) {
    for (const s of bad) problems.push(`${url}: ${s.problems.join("; ")}`);
  }
  if (samples.some((s) => !s.icon)) problems.push(`${url}: a sample declared no page icon`);

  // The declared icon must resolve: data URI = carried by the document; http(s) = fetched, must be 200 + image.
  let iconStatus = null;
  let iconType = "";
  const icon = samples.find((s) => s.icon)?.icon || "";
  if (icon && !icon.startsWith("data:")) {
    const abs = new URL(icon, url).toString();
    const r = await httpGet(abs, 30000);
    iconStatus = r.status;
    iconType = r.headers?.["content-type"] || "";
    if (r.status !== 200) problems.push(`${url}: the declared icon ${abs} -> ${r.status} (a declared icon must resolve)`);
    else if (!/svg|image\/|icon/i.test(iconType)) problems.push(`${url}: the declared icon ${abs} answered 200 but content-type is '${iconType}'`);
    evidence.pages[key] = { url, samples, icon: { href: icon, status: iconStatus, contentType: iconType } };
  } else if (icon) {
    evidence.pages[key] = { url, samples, icon: { href: icon.slice(0, 160), dataUri: true, status: null } };
  } else {
    evidence.pages[key] = { url, samples, icon: { href: "", status: null } };
  }
}

// The machine-bible page's OWN internal links must resolve: the index is the registry entry point, so a tree
// deployed without its registries would still show a clean page but answer 404 for every link on it.
const mbRoot = await httpGet(MB, 30000);
const mbLinks = [...new Set([...String(mbRoot.body).matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]))];
const mbLinkStatus = [];
for (const link of mbLinks) {
  const r = await httpGet(new URL(link, MB).toString(), 30000);
  mbLinkStatus.push({ link, status: r.status });
  if (r.status !== 200) problems.push(`${MB}: the page links ${link} but the live site answers ${r.status}`);
}
evidence.internalLinks = { page: MB, status: mbRoot.status, links: mbLinkStatus };
if (mbRoot.status !== 200) problems.push(`${MB}: live page -> ${mbRoot.status} while reading its links`);

// Provenance: live deployment READY + a real git commit behind each page.
const mbLive = await liveDeployment(P.mb, "funaging-machine-bible.vercel.app", "funaging-machine-bible");
const gsLive = await liveDeployment(P.gs, "guide-sources.vercel.app", "guide-sources");
evidence.provenance.machineBible = mbLive;
evidence.provenance.guideSources = gsLive;

for (const [label, live] of [["machine-bible", mbLive], ["guide-sources", gsLive]]) {
  if (!live.ok) problems.push(`${label}: live deployment could not be resolved (${live.tail})`);
  if (live.target !== "production") problems.push(`${label}: live target is '${live.target}', not production`);
  if (live.readyState !== "READY") problems.push(`${label}: live deployment state is '${live.readyState}'`);
  if (!live.sha) problems.push(`${label}: the live deployment carries no git commit in its Vercel meta`);
}

if (mbLive.sha) {
  const has = await git(P.mb, ["cat-file", "-e", `${mbLive.sha}^{commit}`]);
  const committed = has.code === 0 ? await git(P.mb, ["show", `${mbLive.sha}:index.html`]) : { code: 1, out: "" };
  const iconInCommit = /rel=["']icon["'][^>]*href=["'][^"']+/.test(committed.out);
  evidence.provenance.machineBibleCommit = { sha: mbLive.sha, present: has.code === 0, iconInCommit };
  if (has.code !== 0) problems.push(`machine-bible: deployed commit ${mbLive.sha.slice(0, 7)} is not present in the repo`);
  else if (!iconInCommit) problems.push(`machine-bible: deployed commit ${mbLive.sha.slice(0, 7)} does not declare the icon in index.html`);
}

if (gsLive.sha) {
  const ls = await git(P.gs, ["ls-remote", "origin", "refs/heads/codex-mvp"], 120000);
  const remoteSha = ((ls.out || "").match(/^([0-9a-f]{40})\s/m) || [])[1] || "";
  evidence.provenance.guideSourcesRef = { deployed: gsLive.sha, codexMvp: remoteSha, lsRemoteExit: ls.code };
  if (ls.code !== 0) problems.push(`guide-sources: git ls-remote origin codex-mvp failed (exit ${ls.code})`);
  else if (remoteSha !== gsLive.sha) problems.push(`origin/codex-mvp is ${remoteSha.slice(0, 7)}, deployed is ${gsLive.sha.slice(0, 7)} (the C01 deployed-ref rule)`);
}

const toleratedSummary = Object.fromEntries(
  Object.entries(evidence.pages).map(([k, p]) => [k, [...new Set(p.samples.flatMap((s) => (s.tolerated || []).map((t) => `${t.kind}:${t.status ?? ""}:${String(t.url).replace(/\?.*$/, "")}`)))]]),
);

const ok = problems.length === 0;
done(
  "C-PUBLIC-ICON-404",
  ok,
  ok
    ? `machine-bible + guide-sources each loaded twice in a real Chromium: 200, a declared icon, 0 console errors and 0 first-party HTTP>=400 (guide-sources' only tolerated response is the recorded Supabase 402 by URL); live dpl ${mbLive.id} @${mbLive.sha.slice(0, 7)} and ${gsLive.id} @${gsLive.sha.slice(0, 7)} = origin/codex-mvp`
    : problems.join("; "),
  {
    targets: { machineBible: MB, guideSources: GS },
    allowed: GS_ALLOW,
    tolerated: toleratedSummary,
    pages: evidence.pages,
    provenance: evidence.provenance,
  },
);
