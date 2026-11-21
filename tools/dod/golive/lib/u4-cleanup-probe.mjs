// u4-cleanup-probe.mjs - READ-ONLY catalog probe of the LIVE LPHHW production database.
//
// Answers ONE question for G3-TFI-HUB-LPHHW with raw catalog evidence: can a QA-created `u4_briefs`
// row ever be cleaned up through the schema the LPHHW production server uses?
//
// Nothing is written. No row content is read (counts and catalog definitions only). No credential is
// printed. The connection comes from tracks\C\tools\Get-DbUri.ps1 (vault-backed JSON, deleted here).
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const LPHHW_REPO = "D:\\FUNAGING_LPHHW";
const GET_DB_URI = "D:\\FUNAGING_TEMP\\tracks\\C\\tools\\Get-DbUri.ps1";
const TMP = "D:\\FUNAGING_TEMP\\tracks\\C\\tmp";

export async function probeU4Catalog() {
  const require = createRequire(path.join(LPHHW_REPO, "package.json"));
  const { Client } = require("pg");
  const outFile = path.join(TMP, `lphhw_db_${process.pid}_${Date.now()}.json`);
  const prep = spawnSync("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", GET_DB_URI,
    "-Project", "lphhw", "-OutFile", outFile], { encoding: "utf8" });
  if (prep.status !== 0) {
    return { ok: false, reason: `LPHHW database credential not available (Get-DbUri exit ${prep.status})` };
  }
  let cred;
  try { cred = JSON.parse(readFileSync(outFile, "utf8")); } finally { rmSync(outFile, { force: true }); }

  const client = new Client({
    host: cred.host, port: cred.port, user: cred.user, database: cred.database,
    password: cred.password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  });
  const rec = { ok: false, at: new Date().toISOString(), host: "supabase-lphhw-production" };
  try {
    await client.connect();
    const one = async (sql) => (await client.query(sql)).rows[0];
    rec.server = await one("select version() as v");
    rec.table = await one("select to_regclass('public.u4_briefs')::text as t");
    if (!rec.table?.t) { rec.ok = true; rec.exists = false; return rec; }
    rec.exists = true;
    rec.columns = (await client.query(
      "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='u4_briefs' order by ordinal_position",
    )).rows;
    rec.triggers = (await client.query(
      "select tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t where t.tgrelid = to_regclass('public.u4_briefs') and not t.tgisinternal order by tgname",
    )).rows;
    rec.deleteTriggers = rec.triggers.filter((t) => /BEFORE DELETE/i.test(t.def));
    rec.rowCount = await one("select count(*)::int as rows, count(distinct tenant_id)::int as tenants from public.u4_briefs");
    rec.grants = (await client.query(
      "select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='u4_briefs' order by grantee, privilege_type",
    )).rows;
    rec.deleteCapableRoles = [...new Set(rec.grants.filter((g) => g.privilege_type === "DELETE").map((g) => g.grantee))].sort();
    // The production server connects as a least-privilege login role; name it from pg_roles without values.
    rec.runtimeLogins = (await client.query(
      "select rolname from pg_roles where rolcanlogin and rolname not like 'pg\\_%' and rolname not in ('postgres','supabase_admin') order by rolname",
    )).rows.map((r) => r.rolname);
    rec.ok = true;
  } catch (e) {
    rec.error = String(e && e.message ? e.message : e);
  } finally {
    try { await client.end(); } catch { /* already closed */ }
  }
  return rec;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  console.log(JSON.stringify(await probeU4Catalog()));
}
