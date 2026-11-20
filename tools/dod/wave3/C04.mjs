// C04 - Omnichannel Hub: master/branch reconcile proved by git ancestry, the LIVE deployment checked by the
// repo's own read-only provenance verifier, and the LPHHW bridge contract proved to carry env NAMES only.
import { run, done } from "../lib/harness.mjs";
import { P, readText, scanSecretValues, words } from "../lib/wave3-c.mjs";

const git = (args) => run("git", ["-C", P.hub, ...args], { timeoutMs: 60000 });
const out = {};

const head = (r) => r.out.trim();
const master = await git(["rev-parse", "master"]);
const deployedBranch = await git(["rev-parse", "feat/monitor-center-platform-factory-v1"]);
const deployedHead = await git(["rev-parse", "1d61d17"]);
const originMaster = await git(["rev-parse", "origin/master"]);
const masterHasDeployed = await git(["merge-base", "--is-ancestor", deployedHead.out.trim(), "master"]);
const originInMaster = await git(["merge-base", "--is-ancestor", "origin/master", "master"]);
out.git = {
  master: head(master),
  deployedBranch: head(deployedBranch),
  originMaster: head(originMaster),
  masterHasDeployedHead: masterHasDeployed.code === 0,
  originMasterInMaster: originInMaster.code === 0,
};

const verifier = await run(process.execPath, ["tools/verify-deploy-provenance.mjs"], { cwd: P.hub, timeoutMs: 180000 });
out.provenance = { code: verifier.code, tail: words(verifier.out.split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")) };

// Bridge contract: both files must name the two Tier-2 variables, and neither may carry a VALUE.
const doc = readText(`${P.hub}\\docs\\LPHHW_BRIDGE_CONTRACT.md`);
const code = readText(`${P.hub}\\src\\runtime\\tfi-brief.ts`);
const names = ["LPHHW_BASE_URL", "LPHHW_SERVICE_TOKEN"];
out.bridge = {
  docNames: names.filter((n) => doc.includes(n)),
  codeNames: names.filter((n) => code.includes(n)),
  docValueHits: scanSecretValues(doc).map((h) => h.name),
  codeValueHits: scanSecretValues(code).map((h) => h.name),
};

const problems = [];
if (masterHasDeployed.code !== 0) problems.push("master does not contain the deployed branch head 1d61d17 (master not reconciled)");
if (originInMaster.code !== 0) problems.push("origin/master is not an ancestor of local master (history rewritten?)");
if (verifier.code !== 0) problems.push(`live provenance verifier failed (exit ${verifier.code})`);
for (const n of names) {
  if (!doc.includes(n)) problems.push(`bridge doc does not name ${n}`);
  if (!code.includes(n)) problems.push(`bridge code does not name ${n}`);
}
if (out.bridge.docValueHits.length || out.bridge.codeValueHits.length) problems.push("bridge doc/code carries a credential-VALUE shape");

done("C04", problems.length === 0, problems.length ? problems.join("; ") : `master ${out.git.master.slice(0, 7)} contains deployed 1d61d17; live verifier ${(verifier.out.match(/(\d+\/\d+) checks passed/) || [])[1]} passed; bridge names=${names.length} values=0`, out);
