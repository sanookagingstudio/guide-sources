// C06 - Machine Bible: the committed infrastructure registry passes the repo's own validator AND the 14 tests
// that prove each rule refuses a tampered registry. Numbers are read from the registry, not from a claim.
import { run, done } from "../lib/harness.mjs";
import { P, readText, words } from "../lib/wave3-c.mjs";

const out = {};
const validator = await run(process.execPath, ["validators/validate-infrastructure.mjs"], { cwd: P.mb, timeoutMs: 180000 });
out.validator = { code: validator.code, tail: words(validator.out.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")) };
const errorCount = Number((validator.out.match(/ERROR_COUNT=(\d+)/) || [])[1] ?? -1);

const tests = await run(process.execPath, ["--test", "tests/infrastructure.test.mjs"], { cwd: P.mb, timeoutMs: 300000 });
out.tests = { code: tests.code, tail: words(tests.out.split(/\r?\n/).filter(Boolean).slice(-4).join(" | ")) };
const passMatch = tests.out.match(/(?:ℹ|#)\s*pass (\d+)/);
const failMatch = tests.out.match(/(?:ℹ|#)\s*fail (\d+)/);
const pass = passMatch ? Number(passMatch[1]) : 0;
const fail = failMatch ? Number(failMatch[1]) : 0;

let reg = null;
try { reg = JSON.parse(readText(`${P.mb}\\registries\\infrastructure.json`)); } catch { /* missing */ }
const counts = reg
  ? {
      repositories: (reg.repositories || []).length,
      hostingProjects: (reg.hosting_projects || reg.hostingProjects || []).length,
      dataProjects: (reg.data_projects || reg.dataProjects || []).length,
      secretNames: (reg.secret_names || reg.secretNames || reg.secrets || []).length,
      namesOnly: reg.names_only === true || reg.namesOnly === true,
    }
  : null;
out.registry = counts;

const problems = [];
if (validator.code !== 0 || errorCount !== 0) problems.push(`validator exit ${validator.code}, ERROR_COUNT=${errorCount}`);
if (tests.code !== 0 || fail > 0) problems.push(`infrastructure tests: ${pass} pass / ${fail} fail`);
if (!counts) problems.push("registries/infrastructure.json missing or unreadable");
else {
  if (!counts.namesOnly) problems.push("registry is not marked names_only");
  if (counts.secretNames < 100 || counts.hostingProjects < 10 || counts.repositories < 8) problems.push("registry coverage smaller than the evidenced census");
}

done("C06", problems.length === 0, problems.length ? problems.join("; ") : `validator ERROR_COUNT=0; ${pass}/${pass + fail} tests; registry ${counts.repositories} repos / ${counts.hostingProjects} hosts / ${counts.dataProjects} data projects / ${counts.secretNames} secret names (names_only)`, out);
