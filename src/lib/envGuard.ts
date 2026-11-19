/**
 * Fail-closed environment guard for Guide Sources.
 *
 * Purpose: prevent a local/test build from silently targeting production.
 * The R5E incident: `.env.local` pointed at the production project, NEXT_PUBLIC_*
 * values were inlined at build time, and an isolated test JWT was rejected by the
 * production auth server with 401. Nothing was written, but the isolation claim
 * was false.
 *
 * Behaviour:
 *  - When FUNAGING_TEST_MODE is not '1', this module does nothing. Production and
 *    normal development are unaffected.
 *  - When FUNAGING_TEST_MODE === '1', every Supabase URL MUST resolve to loopback,
 *    and a service-role key must never appear in a NEXT_PUBLIC_* variable.
 *  - Violations throw at import time (fail closed) instead of falling back.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class EnvironmentIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentIsolationError';
  }
}

export function isTestMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.FUNAGING_TEST_MODE === '1';
}

function hostOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const URL_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_URL',
  'FUNAGING_CORE_SUPABASE_URL',
  'SUPABASE_URL',
] as const;

const KEY_VARS = [
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_ANON_KEY',
  'FUNAGING_CORE_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export function validateIsolatedEnv(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  if (!isTestMode(env)) return problems;

  let sawUrl = false;
  for (const name of URL_VARS) {
    const value = env[name];
    if (!value) continue;
    sawUrl = true;
    const host = hostOf(value);
    if (!host) problems.push(`${name}: not a valid URL`);
    else if (!LOOPBACK.has(host)) problems.push(`${name}: host ${host} is not loopback (refusing a non-isolated target)`);
  }
  if (!sawUrl) problems.push('no Supabase URL configured for test mode');

  // A service-role key must never be published to the browser.
  for (const name of KEY_VARS) {
    const value = env[name];
    if (!value) continue;
    if (name.startsWith('NEXT_PUBLIC_') && /service_role/i.test(name)) {
      problems.push(`${name}: service-role keys must never be NEXT_PUBLIC`);
    }
  }
  if (env.NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY) {
    problems.push('NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY must not exist');
  }
  return problems;
}

export function assertIsolatedEnv(env: Record<string, string | undefined> = process.env): void {
  const problems = validateIsolatedEnv(env);
  if (problems.length) {
    throw new EnvironmentIsolationError(`ENVIRONMENT_ISOLATION_VIOLATION: ${problems.join(' | ')}`);
  }
}
