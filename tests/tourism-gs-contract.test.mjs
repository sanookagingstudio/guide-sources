import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Static regression guards for the tourism_gs write contract (R-07..R-10).
// These read the committed source and assert invariants that, if broken,
// reintroduce the DEF-01 class of defect (payload columns that do not exist).

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');

const placesService = read('src/services/placesService.ts');
const route = read('src/app/api/funaging/tourism-gs/route.ts');
const migration = read('supabase/migrations/20261109000000_tourism_gs_canonical.sql');

test('R-07: the writable-column list exists and excludes source_channel', () => {
  const block = placesService.slice(
    placesService.indexOf('STAGING_WRITABLE_COLUMNS'),
    placesService.indexOf('] as const', placesService.indexOf('STAGING_WRITABLE_COLUMNS')),
  );
  assert.ok(block.length > 0, 'STAGING_WRITABLE_COLUMNS not found');
  assert.ok(!block.includes('source_channel'), 'source_channel must not be writable');
  assert.ok(block.includes("'name'"), 'expected core column name');
  assert.ok(block.includes("'status'"), 'expected status column');
});

test('R-07b: an insert supplies an id (the live column has no default)', () => {
  assert.match(placesService, /if\s*\(forInsert\)\s*payload\.id\s*=/);
  assert.match(placesService, /saveStagingPlaceDetailed/);
});

test('R-08: sync state distinguishes synced / local-only / failed', () => {
  assert.match(placesService, /PlaceSyncState\s*=\s*'synced'\s*\|\s*'local-only'\s*\|\s*'failed'/);
  assert.match(placesService, /syncState:\s*'synced'/);
  assert.match(placesService, /syncState:\s*'failed'/);
  // the old silent catch is gone
  assert.ok(!/catch\s*\(error\)\s*\{\s*return localSaved;\s*\}/.test(placesService),
    'silent fallback must not return localSaved without a sync state');
});

test('R-10: the API allow-lists columns and validates status', () => {
  assert.match(route, /WRITABLE_PLACE_COLUMNS/);
  assert.match(route, /column_not_allowed/);
  assert.match(route, /PLACE_STATUSES/);
  assert.match(route, /invalid_status/);
  // raw pass-through must be gone
  assert.ok(!route.includes('.insert(body.row'), 'raw body.row insert must be removed');
  assert.ok(!route.includes('.update(body.row'), 'raw body.row update must be removed');
});

test('R-09: tourism_gs migration matches the live shape and has no source_channel', () => {
  assert.match(migration, /create schema if not exists tourism_gs/);
  assert.match(migration, /create table if not exists tourism_gs\.staging_places/);
  assert.match(migration, /id uuid not null/);
  assert.ok(!migration.includes('source_channel'));
  assert.match(migration, /enable row level security/);
});
