import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function parseImportPayload(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  const [headerLine, ...rows] = trimmed.split(/\r?\n/);
  const headers = headerLine.split(',').map((h) => h.trim());
  return rows.map((row) => Object.fromEntries(row.split(',').map((cell, i) => [headers[i], cell.trim()])));
}

test('import parser accepts CSV and JSON payloads', () => {
  assert.deepEqual(parseImportPayload('name,province,category\nA,เชียงใหม่,คาเฟ่'), [{ name: 'A', province: 'เชียงใหม่', category: 'คาเฟ่' }]);
  assert.deepEqual(parseImportPayload('[{"name":"B"}]'), [{ name: 'B' }]);
});

test('Main Web adapter exports required contract names', () => {
  const adapter = readFileSync('src/integrations/mainWebAdapter.ts', 'utf8');
  for (const name of ['listApprovedPlaces', 'getPlaceById', 'searchPlaces', 'getPlaceMedia']) assert.match(adapter, new RegExp(name));
});
