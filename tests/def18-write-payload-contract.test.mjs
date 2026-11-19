import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// DEF-18 regression: every column a client sends must exist in the server
// allow-list, and the insert path must not require the caller to supply the PK.
//
// The approve control failed with HTTP 400 because approvePlace() sent
// source_staging_id (not allowed) and no id (required). This test derives both
// sides from source, so the same drift cannot return silently.

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');

const route = read('src/app/api/funaging/tourism-gs/route.ts');
const adminService = read('src/services/adminService.ts');
const placesService = read('src/services/placesService.ts');

function allowList() {
  const start = route.indexOf('WRITABLE_PLACE_COLUMNS');
  const block = route.slice(start, route.indexOf(']);', start));
  return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

function payloadKeys(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} not found`);
  const end = source.indexOf('\n  };', start);
  const block = source.slice(start, end);
  return [...block.matchAll(/\n\s{4}([a-z_]+):/g)].map((m) => m[1]);
}

test('R-11: approvePlace payload is a subset of the server allow-list', () => {
  const allowed = allowList();
  const keys = payloadKeys(adminService, 'export async function approvePlace');
  assert.ok(keys.length >= 10, `expected a full payload, parsed ${keys.length} keys`);
  const rejected = keys.filter((k) => !allowed.has(k));
  assert.deepEqual(rejected, [], `columns the server would reject: ${rejected.join(', ')}`);
  assert.ok(keys.includes('source_staging_id'), 'approve must record the staging provenance');
});

test('R-11b: staging create payload is a subset of the server allow-list', () => {
  const allowed = allowList();
  const keys = payloadKeys(placesService, 'const payload');
  const rejected = keys.filter((k) => !allowed.has(k));
  assert.deepEqual(rejected, [], `columns the server would reject: ${rejected.join(', ')}`);
});

test('R-12: POST assigns a uuid when the caller omits the primary key', () => {
  assert.match(route, /import \{ randomUUID \} from 'node:crypto';/);
  assert.match(route, /if \(!row\.id\) row\.id = randomUUID\(\);/);
  assert.ok(!route.includes("error: 'id_required'"), 'insert must not hard-require a client id');
});

test('R-12b: PATCH still cannot rewrite the primary key', () => {
  assert.match(route, /\(key !== 'id' \|\| forInsert\)/);
});

test('R-13: production_places accepts source_staging_id in the live schema', () => {
  const migration = read('supabase/migrations/20261109000000_tourism_gs_canonical.sql');
  assert.match(migration, /source_staging_id uuid/);
  assert.ok(allowList().has('source_staging_id'));
});
