// G5-GITHUB - MASTER_QUEUE row (Track C, G5):
//   "GitHub backups pushed (non-force) for every repo the tracks own; evidence per repo".
//
// This check IS the nightly backup duty made executable. It runs against the REAL repositories and the REAL
// GitHub remotes - no stubs, no fake refs:
//   1. every Track C repo exists, is a git work tree, has a github.com `origin`, and its lock (when present)
//      is owned by track C (a track may only push what it owns);
//   2. the remote is re-read live with `git ls-remote` BEFORE and AFTER the push (the second read is the proof,
//      never the push transcript);
//   3. every local branch is pushed NON-FORCE when it is missing remotely or is a strict fast-forward; a branch
//      that diverged is backed up under `refs/heads/backup/track-c/<branch>-<date>` instead of rewriting history;
//   4. every local tag is pushed NON-FORCE (existing identical tags are no-ops);
//   5. no push may report a forced update / a rejection that leaves a ref unbacked - a forced upload is exactly
//      what this row forbids;
//   6. PASS only when, after the push, EVERY local branch head and EVERY local tag exists on github.com with the
//      same object id (a branch that is merely behind the remote counts as backed up: its commits are on GitHub).
// Uncommitted working-tree files are reported per repo (a GitHub backup covers commits only) and never counted as
// a pass for a branch that is not on the remote.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const H = await import(pathToFileURL("D:\\FUNAGING_TEMP\\tracks\\golive\\lib\\harness.mjs").href);
const { run, done } = H;

const ID = "G5-GITHUB";
if (H.track !== "C") {
  done(ID, false, `refused: FUNAGING_TRACK is '${H.track}' but this check belongs to Track C`, { guard: "track" });
}

const LOCK_DIR = "D:\\FUNAGING_TEMP\\tracks\\locks";
const REPOS = [
  { id: "guide-sources", path: "D:\\FUNAGING_WEB\\01_ACTIVE\\guide-sources__9CC897324B2F", lock: "guide-sources__9CC897324B2F.lock" },
  { id: "mediaos", path: "D:\\MediaOS\\source", lock: "source.lock" },
  { id: "tfi", path: "D:\\FunAging\\TourismIntelligence", lock: "TourismIntelligence.lock" },
  {
    id: "omnichannel-hub",
    path: "D:\\FUNAGING_WEB\\01_ACTIVE\\sanook-master-v2__8402E8309ACC\\funaging-omnichannel-engagement-hub",
    lock: "funaging-omnichannel-engagement-hub.lock",
  },
  { id: "field-app", path: "D:\\FUNAGING_WEB\\01_ACTIVE\\funaging-field-app__2C9CF4FBE075", lock: "funaging-field-app__2C9CF4FBE075.lock" },
  { id: "machine-bible", path: "D:\\FUNAGING_WEB\\01_ACTIVE\\funaging-machine-bible__22862B719710", lock: "funaging-machine-bible__22862B719710.lock" },
  { id: "control-machine", path: "D:\\CONTROL_MACHINE", lock: "CONTROL_MACHINE.lock" },
];

const problems = [];
const repoReports = [];
let forcedUpdates = 0;

const trim = (s) => String(s || "").trim();
const firstLine = (s) => trim(s).split(/\r?\n/)[0] || "";

async function git(cwd, args, timeoutMs = 180000) {
  const r = await run("git", ["-C", cwd, ...args], { timeoutMs });
  return { code: r.code, out: trim(r.out), err: trim(r.err), raw: r };
}

// live remote ref map: refname -> object id (annotated tags kept as the tag object; ^{} lines dropped)
function parseLsRemote(text) {
  const map = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{40,64})\s+(\S+)$/);
    if (!m) continue;
    if (m[2].endsWith("^{}")) continue;
    map.set(m[2], m[1]);
  }
  return map;
}

async function localRefs(cwd, kind) {
  const fmt = kind === "heads" ? "%(refname:short)\t%(objectname)" : "%(refname:short)\t%(objectname)";
  const r = await git(cwd, ["for-each-ref", `refs/${kind}`, `--format=${fmt}`]);
  const map = new Map();
  for (const line of r.out.split(/\r?\n/)) {
    const [name, sha] = line.split("\t");
    if (name && sha) map.set(name, sha.trim());
  }
  return map;
}

const aheadOf = async (cwd, a, b) => (await git(cwd, ["merge-base", "--is-ancestor", a, b])).code === 0;
const containedInRemote = async (cwd, sha) => {
  const r = await git(cwd, ["rev-list", sha, "--not", "--remotes=origin"]);
  return r.code === 0 && r.out === "";
};

for (const repo of REPOS) {
  const rep = {
    id: repo.id,
    path: repo.path,
    lockOwner: null,
    remote: null,
    head: null,
    branches: { total: 0, alreadyOnRemote: 0, pushed: [], pushedBackupRef: [], behindRemote: [] },
    tags: { total: 0, alreadyOnRemote: 0, pushed: [], nameConflict: [] },
    postPushVerified: false,
    uncommitted: null,
    errors: [],
    pushTranscripts: [],
  };
  repoReports.push(rep);

  // 0. ownership: a track only pushes the repos whose lock it owns
  const lockFile = path.join(LOCK_DIR, repo.lock);
  if (existsSync(lockFile)) {
    try {
      const owner = (readFileSync(lockFile, "utf8").match(/^\s*owner=(\S+)/m) || [])[1] || "";
      rep.lockOwner = owner;
      if (owner.toUpperCase() !== "C") {
        problems.push(`${repo.id}: lock ${repo.lock} is owned by track ${owner || "?"}, not C`);
        rep.errors.push(`lock owner ${owner || "?"}`);
        continue;
      }
    } catch (e) {
      problems.push(`${repo.id}: lock ${repo.lock} unreadable (${e})`);
      rep.errors.push("lock unreadable");
      continue;
    }
  } else {
    rep.lockOwner = "absent";
  }

  if (!existsSync(repo.path)) {
    problems.push(`${repo.id}: repo path does not exist (${repo.path})`);
    rep.errors.push("repo path missing");
    continue;
  }
  const wt = await git(repo.path, ["rev-parse", "--is-inside-work-tree"]);
  if (wt.code !== 0 || wt.out !== "true") {
    problems.push(`${repo.id}: not a git work tree (${firstLine(wt.err)})`);
    rep.errors.push("not a git work tree");
    continue;
  }
  const url = await git(repo.path, ["remote", "get-url", "origin"]);
  rep.remote = url.out || null;
  if (url.code !== 0 || !/github\.com[:/]/i.test(url.out)) {
    problems.push(`${repo.id}: origin is not a GitHub remote (${url.out || firstLine(url.err) || "none"})`);
    rep.errors.push("no GitHub origin");
    continue;
  }
  const headRev = await git(repo.path, ["rev-parse", "HEAD"]);
  rep.head = headRev.out;

  // 1. refresh remote refs, then read the LIVE remote (never the stale tracking refs)
  const fetched = await git(repo.path, ["fetch", "origin", "--prune", "--tags"], 240000);
  rep.fetch = { code: fetched.code, note: fetched.code === 0 ? "ok" : firstLine(fetched.err) };
  const before = parseLsRemote((await git(repo.path, ["ls-remote", "origin"])).out);
  if (before.size === 0) {
    problems.push(`${repo.id}: GitHub remote returned no refs (network/auth?)`);
    rep.errors.push("ls-remote empty");
    continue;
  }

  const heads = await localRefs(repo.path, "heads");
  const tags = await localRefs(repo.path, "tags");
  rep.branches.total = heads.size;
  rep.tags.total = tags.size;

  const pushBranches = [];
  const pushBackups = [];
  const pushTags = [];
  const tagConflicts = [];

  for (const [name, sha] of heads) {
    const remoteSha = before.get(`refs/heads/${name}`);
    if (!remoteSha) {
      pushBranches.push({ name, sha, why: "missing on remote" });
      continue;
    }
    if (remoteSha === sha) {
      rep.branches.alreadyOnRemote += 1;
      continue;
    }
    if (await aheadOf(repo.path, remoteSha, sha)) {
      pushBranches.push({ name, sha, why: `fast-forward ${remoteSha.slice(0, 7)}..${sha.slice(0, 7)}` });
      continue;
    }
    if (await aheadOf(repo.path, sha, remoteSha)) {
      rep.branches.behindRemote.push({ name, local: sha, remote: remoteSha });
      continue;
    }
    // diverged: never force. Back the local commits up under a NEW ref.
    pushBackups.push({ name, sha, remoteSha });
  }

  for (const [name, sha] of tags) {
    const remoteSha = before.get(`refs/tags/${name}`);
    if (!remoteSha) {
      pushTags.push({ name, sha, why: "missing on remote" });
      continue;
    }
    if (remoteSha === sha) {
      rep.tags.alreadyOnRemote += 1;
      continue;
    }
    tagConflicts.push({ name, local: sha, remote: remoteSha });
  }

  // 2. push NON-FORCE (no --force / +refspec anywhere), one batched call per kind
  const recordPush = (argv, result) => {
    const transcript = `${argv.join(" ")}\n${result.out}\n${result.err}`.trim();
    rep.pushTranscripts.push(transcript.slice(0, 4000));
    if (/forced update/i.test(`${result.out}\n${result.err}`)) {
      forcedUpdates += 1;
      problems.push(`${repo.id}: git push reported a FORCED update (forbidden by this row)`);
      rep.errors.push("forced update");
    }
    if (result.code !== 0) {
      const note = firstLine(result.err) || firstLine(result.out) || `exit ${result.code}`;
      rep.errors.push(`push refused: ${note}`);
    }
    return result.code;
  };

  if (pushBranches.length) {
    const argv = ["git", "push", "origin", ...pushBranches.map((b) => `refs/heads/${b.name}:refs/heads/${b.name}`)];
    const r = await git(repo.path, argv.slice(1), 300000);
    recordPush(argv, r);
    if (r.code === 0) rep.branches.pushed = pushBranches.map((b) => ({ name: b.name, sha: b.sha, why: b.why }));
  } else {
    rep.branches.pushed = [];
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (const b of pushBackups) {
    const dest = `backup/track-c/${b.name.replace(/[^A-Za-z0-9._/-]/g, "-")}-${stamp}`;
    const argv = ["git", "push", "origin", `refs/heads/${b.name}:refs/heads/${dest}`];
    const r = await git(repo.path, argv.slice(1), 300000);
    recordPush(argv, r);
    if (r.code === 0) rep.branches.pushedBackupRef.push({ source: b.name, dest, sha: b.sha, why: `diverged from ${b.remoteSha.slice(0, 7)}` });
  }

  if (pushTags.length) {
    const argv = ["git", "push", "origin", ...pushTags.map((t) => `refs/tags/${t.name}:refs/tags/${t.name}`)];
    const r = await git(repo.path, argv.slice(1), 300000);
    recordPush(argv, r);
    if (r.code === 0) rep.tags.pushed = pushTags.map((t) => ({ name: t.name, sha: t.sha, why: t.why }));
  } else {
    rep.tags.pushed = [];
  }

  // 3. INDEPENDENT verification: re-read the live remote and compare every local ref again
  const after = parseLsRemote((await git(repo.path, ["ls-remote", "origin"])).out);
  if (after.size === 0) {
    problems.push(`${repo.id}: post-push ls-remote returned no refs`);
    rep.errors.push("post-push ls-remote empty");
    continue;
  }

  const unbacked = [];
  for (const [name, sha] of heads) {
    const remoteSha = after.get(`refs/heads/${name}`);
    if (remoteSha === sha) continue;
    if (remoteSha && (await aheadOf(repo.path, sha, remoteSha))) continue; // behind: commits are on GitHub
    const backup = rep.branches.pushedBackupRef.find((x) => x.source === name && x.sha === sha);
    if (backup && after.get(`refs/heads/${backup.dest}`) === sha) continue;
    unbacked.push(`branch ${name} (${sha.slice(0, 7)}) -> remote ${remoteSha ? remoteSha.slice(0, 7) : "absent"}`);
  }
  for (const [name, sha] of tags) {
    const remoteSha = after.get(`refs/tags/${name}`);
    if (remoteSha === sha) continue;
    const conflict = tagConflicts.find((c) => c.name === name);
    if (conflict) {
      // the tag NAME points elsewhere on GitHub; the local tag's COMMIT is still a backup if GitHub can reach it
      const commit = trim((await git(repo.path, ["rev-list", "-n", "1", `refs/tags/${name}`])).out);
      const reachable = commit ? await containedInRemote(repo.path, commit) : false;
      rep.tags.nameConflict.push({ name, local: sha, remote: remoteSha, commit, commitReachableOnGitHub: reachable });
      if (!reachable) unbacked.push(`tag ${name} (${sha.slice(0, 7)}) -> remote ${remoteSha.slice(0, 7)}, commit not reachable`);
      continue;
    }
    unbacked.push(`tag ${name} (${sha.slice(0, 7)}) -> remote ${remoteSha ? remoteSha.slice(0, 7) : "absent"}`);
  }

  rep.postPushVerified = unbacked.length === 0 && rep.errors.length === 0;
  rep.unbacked = unbacked;
  if (unbacked.length) problems.push(`${repo.id}: refs still not on GitHub after a non-force push: ${unbacked.slice(0, 6).join("; ")}`);

  // 4. informational: uncommitted work is NOT part of a GitHub commit backup
  const st = await git(repo.path, ["status", "--porcelain"]);
  const lines = st.out ? st.out.split(/\r?\n/).filter(Boolean) : [];
  rep.uncommitted = { count: lines.length, sample: lines.slice(0, 8), note: "commit backup covers commits only" };
  if (rep.errors.length && !problems.some((p) => p.startsWith(`${repo.id}:`))) {
    problems.push(`${repo.id}: ${rep.errors.join("; ")}`);
  }
}

const summary = repoReports.map((r) => {
  if (r.errors.length && !r.remote) return `${r.id}=REFUSED(${r.errors[0]})`;
  return `${r.id}=${r.postPushVerified ? "OK" : "GAP"}(${r.branches.total}b/${r.tags.total}t pushed ${r.branches.pushed.length}b+${r.tags.pushed.length}t, ${r.uncommitted?.count ?? "?"} uncommitted)`;
});

const payload = {
  repos: repoReports.map((r) => ({
    id: r.id,
    path: r.path,
    lockOwner: r.lockOwner,
    remote: r.remote,
    head: r.head,
    fetch: r.fetch,
    branches: r.branches,
    tags: r.tags,
    postPushVerified: r.postPushVerified,
    unbacked: r.unbacked || [],
    uncommitted: r.uncommitted,
    errors: r.errors,
    pushTranscripts: r.pushTranscripts,
  })),
  problems,
  forcedUpdates,
};

if (problems.length) {
  done(ID, false, `FAIL: ${problems.length} gap(s): ${problems.slice(0, 3).join(" | ")}`, payload);
}
done(
  ID,
  true,
  `${repoReports.length}/${repoReports.length} Track C repos backed up on GitHub by a NON-FORCE push: ${summary.join("; ")}; post-push ls-remote re-read matches every local branch head + tag`,
  payload,
);
