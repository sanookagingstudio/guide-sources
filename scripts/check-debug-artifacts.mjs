// Gate: no debug artifact or environment file may ever be tracked again.
// Context: 91 committed build/RCE dumps and stale editor backups were removed in
// chore/clean-debug-artifacts (see docs/clean-debug-artifacts.md). This script turns that
// one-off cleanup into a rule: it fails if a tracked file matches an artifact pattern.
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

// Explicit exceptions. Keep this empty unless a file is genuinely required by the app.
const ALLOWED = new Set([]);

const RULES = [
  { name: 'debug dump (*.txt / *.log)', re: /\.(txt|log)$/i },
  { name: 'stale editor backup (*.bak, *.debugbak, *.publiclinebak, ...)', re: /\.[a-z0-9]*bak$/i },
  { name: 'committed env file', re: /(^|\/)\.env(\..*)?$/i, allow: new Set(['.env.example']) },
];

const hits = [];
for (const file of files) {
  if (ALLOWED.has(file)) continue;
  for (const rule of RULES) {
    if (rule.allow && rule.allow.has(file)) continue;
    if (rule.re.test(file)) hits.push(`${file}  <- ${rule.name}`);
  }
}

if (hits.length > 0) {
  console.error('Tracked debug artifacts or env files found (delete them, do not commit them):');
  for (const hit of hits) console.error(`  ${hit}`);
  console.error(`${hits.length} offending file(s).`);
  process.exit(1);
}

console.log(
  `Artifact gate OK: ${files.length} tracked files, 0 debug artifacts, 0 committed env files.`,
);
