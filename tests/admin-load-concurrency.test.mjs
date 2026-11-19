import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// DEF-17 regression suite.
//
// The admin panel's role gate and its latest-run-wins guard live in
// src/lib/adminRoleGate.ts. The module is transpiled here and imported for real
// (no copy of the logic), so these tests fail if the production guard regresses.
//
// The out-of-order cases below reproduce the exact defect: two load()
// invocations overlap, the older one resolves last, and its role/error/data
// must not overwrite the newer state.

const root = process.cwd();

function transpile(relPath) {
  const source = readFileSync(join(root, relPath), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: relPath,
  }).outputText;
}

const gateModule = await import(
  'data:text/javascript;base64,' + Buffer.from(transpile('src/lib/adminRoleGate.ts')).toString('base64')
);
const { createRunGuard, resolveGateRole } = gateModule;

const adminTabSource = readFileSync(join(root, 'src/components/AdminTab.tsx'), 'utf8');
const loadSource = adminTabSource.slice(
  adminTabSource.indexOf('const load = async'),
  adminTabSource.indexOf('const reloadRealUsers'),
);

// ---------------------------------------------------------------- role matrix

test('role gate accepts the authorised roles', () => {
  assert.equal(resolveGateRole('admin'), 'admin');
  assert.equal(resolveGateRole('editor'), 'editor');
  assert.equal(resolveGateRole('viewer'), 'viewer');
  assert.equal(resolveGateRole('EDITOR'), 'editor', 'role comparison is case-insensitive');
  assert.equal(resolveGateRole(' editor '), 'editor', 'surrounding whitespace is tolerated');
});

test('role gate fails closed for member, anonymous and malformed payloads', () => {
  for (const bad of ['member', 'anonymous', 'anon', 'authenticated', '', '   ', 'administrator', null, undefined, 42, {}, [], { role: 'admin' }]) {
    assert.equal(resolveGateRole(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// ------------------------------------------------------- latest-run-wins guard

test('stale role success cannot overwrite a newer role', () => {
  const guard = createRunGuard();
  const state = { role: null };
  const older = guard.begin();
  const newer = guard.begin();

  assert.equal(guard.commit(newer, () => { state.role = 'editor'; }), true);
  assert.equal(guard.commit(older, () => { state.role = 'admin'; }), false, 'stale commit must be dropped');
  assert.equal(state.role, 'editor', 'stale privilege must never overwrite newer role');
});

test('stale failure cannot overwrite a newer success', () => {
  const guard = createRunGuard();
  const state = { role: 'checking', message: '' };
  const older = guard.begin();
  const newer = guard.begin();

  guard.commit(newer, () => { state.role = 'editor'; state.message = ''; });
  guard.commit(older, () => { state.role = null; state.message = 'Admin role required'; });

  assert.equal(state.role, 'editor');
  assert.equal(state.message, '', 'a stale error must not paint the banner');
});

test('stale success cannot overwrite a newer failure', () => {
  const guard = createRunGuard();
  const state = { role: 'checking', message: '' };
  const older = guard.begin();
  const newer = guard.begin();

  guard.commit(newer, () => { state.role = null; state.message = 'Missing AuthContext session token'; });
  guard.commit(older, () => { state.role = 'editor'; state.message = ''; });

  assert.equal(state.role, null, 'a stale success must not resurrect a session');
  assert.equal(state.message, 'Missing AuthContext session token');
});

test('stale data commit cannot overwrite newer rows', () => {
  const guard = createRunGuard();
  const state = { staging: [], approved: [] };
  const older = guard.begin();
  const newer = guard.begin();

  guard.commit(newer, () => { state.staging = ['row-3']; state.approved = ['row-3']; });
  guard.commit(older, () => { state.staging = ['row-1', 'row-2']; state.approved = []; });

  assert.deepEqual(state.staging, ['row-3']);
  assert.deepEqual(state.approved, ['row-3']);
});

test('stale loading/error commit is dropped, newer one applies', () => {
  const guard = createRunGuard();
  const state = { loading: true, error: '' };
  const older = guard.begin();
  const newer = guard.begin();

  guard.commit(newer, () => { state.loading = false; });
  guard.commit(older, () => { state.loading = true; state.error = 'network down'; });

  assert.equal(state.loading, false);
  assert.equal(state.error, '', 'stale error state must not persist');
});

test('unmount invalidation drops every pending run', () => {
  const guard = createRunGuard();
  const state = { role: null };
  const pending = guard.begin();
  guard.invalidate();

  assert.equal(guard.isCurrent(pending), false);
  assert.equal(guard.commit(pending, () => { state.role = 'editor'; }), false);
  assert.equal(state.role, null, 'a run resolving after unmount must not commit');

  const afterRemount = guard.begin();
  assert.equal(guard.isCurrent(afterRemount), true, 'a fresh mount gets a fresh generation');
});

test('commit only applies for the current generation', () => {
  const guard = createRunGuard();
  const run = guard.begin();
  let applied = 0;

  assert.equal(guard.commit(run, () => { applied += 1; }), true);
  assert.equal(guard.commit(run, () => { applied += 1; }), true, 'the current run may commit more than once');
  guard.invalidate();
  assert.equal(guard.commit(run, () => { applied += 1; }), false);
  assert.equal(applied, 2);
});

// --------------------------------------------------- source-shape regressions

test("'use client' stays the first statement in AdminTab.tsx", () => {
  const firstStatement = adminTabSource.replace(/^\uFEFF/, '').trimStart().split(/\r?\n/)[0].trim();
  assert.equal(firstStatement, "'use client';", `first statement was ${firstStatement}`);
});

test('temporary role diagnostics are gone', () => {
  for (const marker of ['__BUILD_MARKER', '__loadSeq', 'AUTH_DEBUG', 'LOAD_ENTER', 'ROLE_BRANCH']) {
    assert.ok(!adminTabSource.includes(marker), `${marker} must not remain in production source`);
  }
  assert.ok(!/console\.(log|debug|info)\(/.test(adminTabSource), 'no console diagnostics in AdminTab');
});

test('load() routes every state commit through the generation guard', () => {
  assert.ok(loadSource.length > 0, 'load() body must be present');
  const commits = loadSource.match(/loadGuard\.commit\(run,/g) || [];
  assert.ok(commits.length >= 10, `expected guarded commits for role/data/logs/users/message, found ${commits.length}`);
  const staleChecks = loadSource.match(/loadGuard\.isCurrent\(run\)/g) || [];
  assert.ok(staleChecks.length >= 2, 'async boundaries must be re-checked before committing');

  // No unguarded state setter may remain once the guarded commit blocks are
  // removed from the load body.
  const withoutGuardedCommits = loadSource
    .replace(/loadGuard\.commit\(run,\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\}\);/g, '')
    .replace(/loadGuard\.commit\(run,\s*\(\)\s*=>[^;]*\);/g, '');
  const unguarded = withoutGuardedCommits
    .split(/\r?\n/)
    .filter((line) => /^\s*set[A-Z][A-Za-z]*\(/.test(line));
  assert.deepEqual(unguarded, [], `unguarded state commits: ${unguarded.join(' | ')}`);
});

test('unmount invalidates pending runs', () => {
  assert.match(adminTabSource, /return \(\) => \{ loadGuard\.invalidate\(\); \};/);
});

test('403 is a permission state, other failures are real errors', () => {
  assert.match(loadSource, /\/403\|forbidden\|admin role required\/i/, '403 must be classified');
  assert.match(loadSource, /User management is available to administrators only\./);
  assert.match(loadSource, /Could not load users: /, '500/network/malformed must not claim a permission denial');
});

test('a permission notice is not wiped by the success path', () => {
  assert.match(loadSource, /let notice = '';/);
  assert.match(loadSource, /setMessage\(notice\)/, 'message must be committed once from notice, not cleared early');
  assert.ok(!/setMessage\(''\)/.test(loadSource), 'unconditional setMessage(\'\') would erase the permission message');
});
