// Contract tests for the standalone guide-source-draft@1.0.0 service.
//
// These run against the BUILT output (dist/), not the sources: `npm run ci`
// builds first, then runs this file. They exercise the contract rules, the
// mock file adapter (including durability across instances) and the service
// token gate. No network, no live system, no credential value.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DRAFT_ROUTES,
  GUIDE_DRAFT_FIELDS,
  GUIDE_LIVE_FLAGS,
  GUIDE_SOURCE_DRAFT_CONTRACT,
  QA_PREFIX,
  findSecretMaterial,
  toDraftInput,
} from "../dist/contract.js";
import { FileDraftStore, resolveStoreDir } from "../dist/store.js";
import { checkServiceToken } from "../dist/auth.js";
import { MOCK_ADAPTER, flagEnabled, flagSnapshot, resolveAdapters } from "../dist/adapters.js";

const tempDir = () => mkdtempSync(path.join(os.tmpdir(), "guide-standalone-test-"));

const draft = (overrides = {}) => ({
  draft_id: "QA-CONTRACT-1",
  title: "Kyoto in November",
  summary: "Peak momiji, quieter weekdays.",
  locale: "en",
  qa: true,
  requested_by: "tfi-contract-test",
  claims: [{ claim: "peak season starts in late November", confidence: 0.8 }],
  sources: [{ url: "https://example.test/source", kind: "web" }],
  ...overrides,
});

test("contract id is the deployed guide-source-draft@1.0.0", () => {
  assert.equal(GUIDE_SOURCE_DRAFT_CONTRACT, "guide-source-draft@1.0.0");
  assert.equal(QA_PREFIX, "QA-");
});

test("record field list is the deployed 11-field order", () => {
  assert.deepEqual([...GUIDE_DRAFT_FIELDS], [
    "draft_id",
    "contract_version",
    "title",
    "summary",
    "locale",
    "qa",
    "requested_by",
    "claims",
    "sources",
    "created_at",
    "updated_at",
  ]);
});

test("three routes, each with its own live flag", () => {
  assert.equal(DRAFT_ROUTES.length, 3);
  assert.deepEqual(
    DRAFT_ROUTES.map((route) => route.route),
    ["drafts.create", "drafts.read", "drafts.purge"]
  );
  assert.deepEqual(
    DRAFT_ROUTES.map((route) => route.live_flag),
    ["GUIDE_LIVE_DRAFT_CREATE", "GUIDE_LIVE_DRAFT_READ", "GUIDE_LIVE_DRAFT_PURGE"]
  );
  assert.equal(new Set(GUIDE_LIVE_FLAGS).size, 3);
});

test("a minimal draft is accepted and defaults are filled", () => {
  const input = toDraftInput({ title: "  Minimal  " }, new Date("2026-11-21T10:00:00Z"));
  assert.ok(!("error" in input));
  assert.equal(input.record.title, "Minimal");
  assert.equal(input.record.summary, "");
  assert.equal(input.record.locale, null);
  assert.equal(input.record.qa, false);
  assert.equal(input.record.requested_by, null);
  assert.deepEqual(input.record.claims, []);
  assert.deepEqual(input.record.sources, []);
  assert.equal(input.record.contract_version, GUIDE_SOURCE_DRAFT_CONTRACT);
  assert.match(input.record.draft_id, /^GS-DRAFT-2026-11-21T10-00-00-000Z$/);
  assert.equal(input.record.created_at, "2026-11-21T10:00:00.000Z");
  assert.equal(input.record.updated_at, input.record.created_at);
});

test("a full draft keeps every contract field", () => {
  const input = toDraftInput(draft());
  assert.ok(!("error" in input));
  assert.deepEqual(Object.keys(input.record), [...GUIDE_DRAFT_FIELDS]);
  assert.equal(input.record.qa, true);
  assert.equal(input.record.locale, "en");
  assert.equal(input.record.requested_by, "tfi-contract-test");
  assert.equal(input.record.claims.length, 1);
  assert.equal(input.record.sources.length, 1);
});

test("a draft without a title is refused and names the field", () => {
  const input = toDraftInput({ summary: "no title" });
  assert.ok("error" in input);
  assert.equal(input.error, "draft_incomplete");
  assert.ok(input.fields.includes("title"));
});

test("a wrong contract version is refused", () => {
  const input = toDraftInput(draft({ contract_version: "guide-source-draft@2.0.0" }));
  assert.ok("error" in input);
  assert.ok(input.fields.some((field) => field.includes("contract_version")));
});

test("a non-object body is refused", () => {
  for (const body of [null, [], "text", 42]) {
    const input = toDraftInput(body);
    assert.ok("error" in input);
    assert.deepEqual(input.fields, ["body must be a JSON object"]);
  }
});

test("a qa draft must be named QA-* and identifiers are bounded", () => {
  const unprefixed = toDraftInput(draft({ draft_id: "GS-DRAFT-1" }));
  assert.ok("error" in unprefixed);
  assert.ok(unprefixed.fields.some((field) => field.includes("QA-")));

  const tooShort = toDraftInput(draft({ draft_id: "QA" }));
  assert.ok("error" in tooShort);
  assert.ok(tooShort.fields.some((field) => field.includes("draft_id")));

  const badChars = toDraftInput(draft({ draft_id: "QA draft with spaces" }));
  assert.ok("error" in badChars);
});

test("title and summary are bounded like the live validator", () => {
  const input = toDraftInput(draft({ title: "t".repeat(500), summary: "s".repeat(5000) }));
  assert.ok(!("error" in input));
  assert.equal(input.record.title.length, 300);
  assert.equal(input.record.summary.length, 4000);
});

test("claims and sources are capped at 50", () => {
  const input = toDraftInput(
    draft({
      claims: Array.from({ length: 80 }, (_, index) => ({ claim: `c${index}` })),
      sources: Array.from({ length: 80 }, (_, index) => ({ url: `https://example.test/${index}` })),
    })
  );
  assert.ok(!("error" in input));
  assert.equal(input.record.claims.length, 50);
  assert.equal(input.record.sources.length, 50);
});

test("a credential-shaped claim is refused by name, never echoed", () => {
  const shape = "deadbeef".repeat(8);
  const found = findSecretMaterial({ claims: [{ note: `key ${shape}` }] });
  assert.ok(found.some((entry) => entry.endsWith(":64-hex")));
  assert.ok(found.every((entry) => !entry.includes(shape)));

  const input = toDraftInput(draft({ claims: [{ note: `key ${shape}` }] }));
  assert.ok("error" in input);
  assert.equal(input.error, "secret_material");
  assert.ok(input.fields.every((entry) => !entry.includes(shape)));

  const jwt = `eyJ${"a".repeat(24)}.${"b".repeat(16)}`;
  assert.equal(toDraftInput(draft({ summary: jwt })).error, "secret_material");
});

test("credential field names are refused", () => {
  for (const field of ["token", "password", "api_key", "service_role_key"]) {
    const input = toDraftInput(draft({ [field]: "placeholder" }));
    assert.ok("error" in input, `${field} was not refused`);
    assert.equal(input.error, "secret_material");
  }
});

test("unknown fields are dropped, not stored", () => {
  const input = toDraftInput(draft({ note: "extra", qa_note: "extra" }));
  assert.ok(!("error" in input));
  assert.equal("note" in input.record, false);
  assert.equal("qa_note" in input.record, false);
});

test("the mock store round-trips a draft exactly", async () => {
  const store = new FileDraftStore(tempDir());
  assert.equal(store.kind(), "mock-file");
  const input = toDraftInput(draft());
  assert.ok(!("error" in input));
  assert.equal(await store.put(input.record), "mock-file");
  const read = await store.get(input.record.draft_id);
  assert.deepEqual(read, JSON.parse(JSON.stringify(input.record)));
});

test("the mock store upserts by draft_id and keeps created_at", async () => {
  const store = new FileDraftStore(tempDir());
  const first = toDraftInput(draft());
  assert.ok(!("error" in first));
  await store.put(first.record);
  const later = { ...first.record, title: "Revised", updated_at: "2026-11-21T11:00:00.000Z" };
  await store.put(later);
  const read = await store.get(first.record.draft_id);
  assert.equal(read.title, "Revised");
  assert.equal(read.created_at, first.record.created_at);
  assert.equal((await store.list(false)).filter((row) => row.draft_id === first.record.draft_id).length, 1);
});

test("the mock store lists newest first and filters QA", async () => {
  const store = new FileDraftStore(tempDir());
  const older = toDraftInput(draft({ draft_id: "QA-OLDER" }), new Date("2026-11-21T09:00:00Z"));
  const newer = toDraftInput(draft({ draft_id: "QA-NEWER", qa: true }), new Date("2026-11-21T12:00:00Z"));
  const plain = toDraftInput(draft({ draft_id: "GS-PLAIN", qa: false }), new Date("2026-11-21T10:00:00Z"));
  for (const input of [older, newer, plain]) {
    assert.ok(!("error" in input));
    await store.put(input.record);
  }
  const all = await store.list(false);
  assert.deepEqual(all.map((row) => row.draft_id), ["QA-NEWER", "GS-PLAIN", "QA-OLDER"]);
  const qa = await store.list(true);
  assert.deepEqual(qa.map((row) => row.draft_id), ["QA-NEWER", "QA-OLDER"]);
});

test("the mock store deletes QA drafts only", async () => {
  const store = new FileDraftStore(tempDir());
  const qa = toDraftInput(draft({ draft_id: "QA-DELETE-ME" }));
  const plain = toDraftInput(draft({ draft_id: "GS-KEEP-ME", qa: false }));
  assert.ok(!("error" in qa) && !("error" in plain));
  await store.put(qa.record);
  await store.put(plain.record);

  assert.equal(await store.deleteQa("GS-KEEP-ME"), false);
  assert.notEqual(await store.get("GS-KEEP-ME"), null);
  assert.equal(await store.deleteQa("QA-DELETE-ME"), true);
  assert.equal(await store.get("QA-DELETE-ME"), null);
  assert.equal(await store.deleteQa("QA-NOT-THERE"), false);
});

test("mock durability: a second instance on the same directory sees the draft", async () => {
  const dir = tempDir();
  const writer = new FileDraftStore(dir);
  const input = toDraftInput(draft({ draft_id: "QA-DURABLE" }));
  assert.ok(!("error" in input));
  await writer.put(input.record);

  const reader = new FileDraftStore(dir);
  const read = await reader.get("QA-DURABLE");
  assert.equal(read.title, input.record.title);
});

test("store directory defaults to temp and honours GUIDE_MOCK_STORE_DIR", () => {
  assert.ok(resolveStoreDir({}).includes("guide-sources-standalone"));
  const explicit = path.resolve(os.tmpdir(), "guide-explicit");
  assert.equal(resolveStoreDir({ GUIDE_MOCK_STORE_DIR: explicit }), explicit);
});

test("service token gate is ok / unauthorized / unconfigured", () => {
  const expected = "a".repeat(64);
  assert.equal(checkServiceToken(() => expected, expected), "ok");
  assert.equal(checkServiceToken(() => "", expected), "unauthorized");
  assert.equal(checkServiceToken(() => "b".repeat(64), expected), "unauthorized");
  assert.equal(checkServiceToken(() => expected.slice(0, 63), expected), "unauthorized");
  assert.equal(checkServiceToken(() => "anything", ""), "unconfigured");
});

test("live flags are off unless explicitly on", () => {
  assert.equal(flagEnabled({}, "GUIDE_LIVE_DRAFT_CREATE"), false);
  for (const on of ["1", "true", "YES", "on"]) {
    assert.equal(flagEnabled({ GUIDE_LIVE_DRAFT_CREATE: on }, "GUIDE_LIVE_DRAFT_CREATE"), true);
  }
  for (const off of ["", "0", "false", "no"]) {
    assert.equal(flagEnabled({ GUIDE_LIVE_DRAFT_CREATE: off }, "GUIDE_LIVE_DRAFT_CREATE"), false);
  }
  assert.deepEqual(flagSnapshot({ GUIDE_LIVE_DRAFT_READ: "1" }), {
    GUIDE_LIVE_DRAFT_CREATE: false,
    GUIDE_LIVE_DRAFT_READ: true,
    GUIDE_LIVE_DRAFT_PURGE: false,
  });
});

test("adapters are mock-only and a live store URL is refused", () => {
  const adapters = resolveAdapters({ GUIDE_MOCK_STORE_DIR: tempDir() });
  assert.ok(adapters);
  assert.equal(adapters.kind, MOCK_ADAPTER);
  assert.equal(adapters.store.kind(), "mock-file");
  assert.equal(adapters.live_connections, 0);

  assert.equal(resolveAdapters({ GUIDE_LIVE_STORE_URL: "postgres://example.test/db" }), null);
});
