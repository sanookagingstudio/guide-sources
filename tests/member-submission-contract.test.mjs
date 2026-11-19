import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// DEF-24 / GS-08 regression guards.
//
// Member submission must be its own authenticated surface: server-forced
// pending status, field allow-list, boolean-only duplicate check, and the admin
// adapter must stay admin|editor only.

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');

const memberRoute = read('src/app/api/funaging/member-submissions/route.ts');
const adminRoute = read('src/app/api/funaging/tourism-gs/route.ts');
const placesService = read('src/services/placesService.ts');
const page = read('src/app/page.tsx');

test('member submission route exists and is authentication-gated', () => {
  assert.ok(existsSync(join(root, 'src/app/api/funaging/member-submissions/route.ts')));
  assert.match(memberRoute, /authentication_required/);
  assert.match(memberRoute, /if \(!token\) return \{ error: json\(401/);
  assert.match(memberRoute, /auth\.getUser\(token\)/);
  assert.ok(!/requireGsAdmin/.test(memberRoute), 'member route must not reuse the admin gate');
});

test('status is forced server-side and never taken from the body', () => {
  assert.match(memberRoute, /status: 'pending'/);
  assert.match(memberRoute, /submitted_by: auth\.userId/);
  assert.ok(!/status\s*\?\?/.test(memberRoute), 'status must not be client-controlled');
  assert.ok(!/'rejection_reason'/.test(memberRoute), 'members must not set rejection_reason');
});

test('only allow-listed columns are accepted', () => {
  assert.match(memberRoute, /MEMBER_COLUMNS/);
  assert.match(memberRoute, /column_not_allowed/);
  for (const forbidden of ['id', 'status', 'rejection_reason', 'submitted_by', 'created_at', 'updated_at']) {
    const block = memberRoute.slice(memberRoute.indexOf('MEMBER_COLUMNS'), memberRoute.indexOf(']);', memberRoute.indexOf('MEMBER_COLUMNS')));
    assert.ok(!block.includes(`'${forbidden}'`), `${forbidden} must not be member-writable`);
  }
});

test('duplicate check returns a boolean, never rows', () => {
  assert.match(memberRoute, /\{ exists: \(count \?\? 0\) > 0 \}/);
  assert.ok(!/select\('\*'\)/.test(memberRoute), 'member route must not select full rows');
  assert.ok(!/rejection_reason\s*:/.test(memberRoute), 'member route must not write rejection_reason');
});

test('duplicate submissions are rejected before insert', () => {
  assert.match(memberRoute, /409/);
  assert.match(memberRoute, /duplicate_name/);
});

test('the admin adapter still requires admin or editor', () => {
  assert.match(adminRoute, /roles\.includes\('admin'\) && !roles\.includes\('editor'\)/);
  assert.match(adminRoute, /Editor or admin role required/);
});

test('the UI routes new submissions to the member endpoint and edits to the adapter', () => {
  assert.match(page, /submitMemberPlace\(form\)/);
  assert.match(page, /form\.id \? await saveStagingPlaceDetailed\(form\)/);
  assert.match(page, /checkMemberDuplicateName\(form\.name, form\.id\)/);
  assert.match(placesService, /export async function submitMemberPlace/);
  assert.match(placesService, /export async function checkMemberDuplicateName/);
});
