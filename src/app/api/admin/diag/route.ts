import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const hash = (value: string) => value ? crypto.createHash('sha256').update(value).digest('hex').slice(0, 16) : 'EMPTY';

type DiagCheck = Record<string, unknown>;

type DiagResult = {
  runtime_env: {
    url: string;
    anon_length: number;
    anon_hash: string;
    service_length: number;
    service_hash: string;
  };
  token: {
    provided: boolean;
    length: number;
  };
  checks: Record<string, DiagCheck>;
  fatal?: {
    message: string;
    stack: string | null | undefined;
  };
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  const result: DiagResult = {
    runtime_env: {
      url: supabaseUrl,
      anon_length: anonKey.length,
      anon_hash: hash(anonKey),
      service_length: serviceRoleKey.length,
      service_hash: hash(serviceRoleKey),
    },
    token: {
      provided: Boolean(token),
      length: token.length,
    },
    checks: {},
  };

  try {
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (token) {
      const { data, error } = await anon.auth.getUser(token);
      result.checks.anon_get_user = error
        ? { ok: false, error: error.message }
        : { ok: true, user_id: data.user?.id, email: data.user?.email };
    }

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const list = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    result.checks.service_list_users = list.error
      ? { ok: false, error: list.error.message }
      : { ok: true, users: list.data.users.map((u) => ({ id: u.id, email: u.email })) };

    const roles = await service.from('user_roles').select('user_id, role').order('user_id');
    result.checks.service_user_roles = roles.error
      ? { ok: false, error: roles.error.message }
      : { ok: true, rows: roles.data };

    if (result.checks.anon_get_user?.ok) {
      const exact = await service
        .from('user_roles')
        .select('user_id, role')
        .eq('user_id', result.checks.anon_get_user.user_id);

      result.checks.exact_role_for_token_user = exact.error
        ? { ok: false, error: exact.error.message }
        : { ok: true, rows: exact.data };
    }

    return NextResponse.json(result);
  } catch (e) {
    result.fatal = {
      message: String(e),
      stack: e instanceof Error ? e.stack : null,
    };
    return NextResponse.json(result, { status: 500 });
  }
}
