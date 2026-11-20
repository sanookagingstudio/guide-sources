// C01 - guide-sources: the DEPLOYED ref is clean of debug artifacts, no committed credential VALUE exists,
// the cleanup branch is proven clean, and the main/deployed reconcile has a recorded outcome.
// Runs against the real git refs on disk; reads the Owner rotation record (values are never read/printed).
import { run, done } from "../lib/harness.mjs";
import { P, readText, scanSecretValues, words } from "../lib/wave3-c.mjs";

const gs = (args) => run("git", ["-C", P.gs, ...args], { timeoutMs: 120000 });
const ARTIFACT = /\.(txt|log|bak|publiclinebak)$|(^|\/)ONEPACK/i;

const refs = {};
for (const ref of ["codex-mvp", "main", "chore/clean-debug-artifacts"]) {
  const head = await gs(["rev-parse", "--verify", "--quiet", ref]);
  const tree = head.code === 0 ? await gs(["ls-tree", "-r", "--name-only", ref]) : { code: 1, out: "" };
  const files = tree.out.split(/\r?\n/).filter(Boolean);
  refs[ref] = {
    sha: head.code === 0 ? head.out.trim() : null,
    files: files.length,
    artifacts: files.filter((f) => ARTIFACT.test(f)).slice(0, 15),
    artifactCount: files.filter((f) => ARTIFACT.test(f)).length,
  };
}

// Content scan of the deployed ref: git grep -l returns NAMES only, never the matching bytes.
const VALUE_RE = [
  "sb_secret_[A-Za-z0-9_-]{16,}",
  "sb_publishable_[A-Za-z0-9_-]{16,}",
  "sk_live_[A-Za-z0-9]{16,}",
  "AKIA[0-9A-Z]{16}",
  "eyJhbGciOi[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}",
  "postgres(ql)?://[^\\s:@/]+:[^\\s@/]{6,}@",
  "BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY",
].join("|");
const grep = await gs(["grep", "-I", "-l", "-E", VALUE_RE, "codex-mvp", "--", "."]);
const deployedSecretFiles = grep.code === 0 ? grep.out.split(/\r?\n/).filter(Boolean) : [];
const grepBroken = grep.code !== 0 && grep.code !== 1;

// Ancestry: is the deployed ref contained in main (reconciled) or the other way round?
const depInMain = await gs(["merge-base", "--is-ancestor", "codex-mvp", "main"]);
const mainInDep = await gs(["merge-base", "--is-ancestor", "main", "codex-mvp"]);
const reconciled = depInMain.code === 0 || mainInDep.code === 0;

// Owner rotation record: the audit conclusion + whether the Owner-only steps are closed.
const rot = readText(`${P.owner}\\OWNER_ROTATE_GUIDE_SOURCES.md`);
const rotationRecorded = /committed credential values[\s\S]{0,40}?\*\*NONE\.\*\*/i.test(rot) || /0 full JWTs/i.test(rot);
const ownerStepOpen = /Owner check|Owner has either changed|not yet run|history decision/i.test(rot);
const piiExposureRecorded = /PII \(4 emails, 3 user ids\)/i.test(rot);

const problems = [];
if (!refs["codex-mvp"].sha) problems.push("deployed ref codex-mvp not found");
if (refs["codex-mvp"].artifactCount > 0) problems.push(`deployed ref codex-mvp@${(refs["codex-mvp"].sha || "").slice(0, 7)} still has ${refs["codex-mvp"].artifactCount} debug artifacts`);
if (deployedSecretFiles.length) problems.push(`deployed ref contains ${deployedSecretFiles.length} file(s) with a credential-VALUE shape`);
if (grepBroken) problems.push("git grep on codex-mvp failed (cannot prove the deployed ref is value-clean)");
if (!refs["chore/clean-debug-artifacts"].sha) problems.push("cleanup branch chore/clean-debug-artifacts missing");
else if (refs["chore/clean-debug-artifacts"].artifactCount > 0) problems.push(`cleanup branch still has ${refs["chore/clean-debug-artifacts"].artifactCount} artifacts`);
if (!reconciled) problems.push("main and the deployed ref diverged (no reconcile merge)");
if (!rotationRecorded) problems.push("no rotation audit conclusion recorded");
if (!piiExposureRecorded) problems.push("the PII exposure is not recorded in the rotation file");

done("C01", problems.length === 0, problems.length ? problems.join("; ") : `deployed ref clean, cleanup branch clean, main reconciled (${refs.main.sha.slice(0, 7)}), rotation audit recorded`, {
  refs,
  deployedSecretFiles,
  grepError: grepBroken ? words(grep.err) : "",
  rotation: { rotationRecorded, ownerStepOpen, piiExposureRecorded },
  scanPatterns: scanSecretValues(rot).map((h) => h.name),
});
