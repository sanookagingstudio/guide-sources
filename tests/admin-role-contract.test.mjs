import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// DEF-14 regression: the client admin gate must accept the same role set the
// server authorises (admin OR editor) and must resolve the role from the real
// /api/admin/me response shape ({ role, roles[] }).

const root = process.cwd();
const adminTab = readFileSync(join(root, 'src/components/AdminTab.tsx'), 'utf8');
const route = readFileSync(join(root, 'src/app/api/admin/me/route.ts'), 'utf8');

test('server contract: /api/admin/me resolves roles from gs_user_roles', () => {
  assert.match(route, /gs_user_roles/);
  assert.match(route, /role/, 'route must return a role field');
});

test('client gate resolves role from role || roles[0]', () => {
  assert.match(adminTab, /resolvedRole/);
  assert.match(adminTab, /(roleResult|rr)\.role\s*\|\|/, 'must fall back when role is absent');
  assert.match(adminTab, /roles/, 'must consider the roles array');
});

test('client gate is not admin-only', () => {
  // a bare `=== "admin"` comparison would lock out editors
  assert.ok(!/role\s*===\s*['"]admin['"]/.test(adminTab), 'gate must not require admin exclusively');
});

test('client never writes protected gs_ tables directly', () => {
  assert.ok(!/from\(['"]gs_user_roles['"]\)\s*\.insert/.test(adminTab));
  assert.ok(!/from\(['"]gs_admin_audit_logs['"]\)\s*\.insert/.test(adminTab));
});

test('gate fails closed and distinguishes unauthorised', () => {
  assert.match(adminTab, /if \(!resolvedRole\)/);
});
