import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/serverEnv';

const supabaseUrl = serverEnv.SUPABASE_URL;
const anonKey = serverEnv.SUPABASE_ANON_KEY;
const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    if (!supabaseUrl) {
      return json(500, { error: 'MISSING_ENV: NEXT_PUBLIC_SUPABASE_URL' });
    }
    if (!anonKey) {
      return json(500, { error: 'MISSING_ENV: NEXT_PUBLIC_SUPABASE_ANON_KEY' });
    }
    if (!serviceRoleKey) {
      return json(500, { error: 'MISSING_ENV: SUPABASE_SERVICE_ROLE_KEY' });
    }

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) return json(401, { error: 'MISSING_TOKEN', role: null });

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(token);

    if (userError || !userData.user) {
      return json(401, {
        error: 'USER_VALIDATION_FAILED',
        detail: userError?.message || 'Invalid session',
        role: null,
      });
    }

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: roleRows, error: roleError } = await service
      .from('user_roles')
      .select('user_id, role')
      .eq('user_id', userData.user.id);

    if (roleError) {
      return json(500, {
        error: 'ROLE_QUERY_FAILED',
        detail: roleError.message,
        role: null,
      });
    }

    const roles = (roleRows || []).map((row) => row.role);
    const role = roles.includes('admin')
      ? 'admin'
      : roles.includes('editor')
        ? 'editor'
        : roles.includes('viewer')
          ? 'viewer'
          : null;

    return json(200, {
      user_id: userData.user.id,
      email: userData.user.email || '',
      role,
      roles,
    });
  } catch (e) {
    return json(500, {
      error: 'UNEXPECTED_ERROR',
      step: 'PROCESSING_REQUEST',
      detail: e instanceof Error ? e.message : 'Unknown error',
    });
  }
}
