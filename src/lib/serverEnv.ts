import fs from 'fs';
import path from 'path';

function readDotEnvLocal(): Record<string, string> {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    const text = fs.readFileSync(envPath, 'utf8');
    const result: Record<string, string> = {};

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;

      const index = line.indexOf('=');
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }

    return result;
  } catch {
    return {};
  }
}

const fileEnv = readDotEnvLocal();

export const serverEnv = {
  SUPABASE_URL:
    fileEnv.NEXT_PUBLIC_SUPABASE_URL ||
    fileEnv.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    '',

  SUPABASE_ANON_KEY:
    fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    fileEnv.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    '',

  SUPABASE_SERVICE_ROLE_KEY:
    fileEnv.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '',

  FUNAGING_CORE_SUPABASE_URL:
    fileEnv.FUNAGING_CORE_SUPABASE_URL ||
    fileEnv.NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_URL ||
    process.env.FUNAGING_CORE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_URL ||
    '',

  FUNAGING_CORE_SUPABASE_ANON_KEY:
    fileEnv.FUNAGING_CORE_SUPABASE_ANON_KEY ||
    fileEnv.NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_ANON_KEY ||
    process.env.FUNAGING_CORE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_FUNAGING_CORE_SUPABASE_ANON_KEY ||
    '',

  FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY:
    fileEnv.FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.FUNAGING_CORE_SUPABASE_SERVICE_ROLE_KEY ||
    '',

  FUNAGING_TOURISM_SCHEMA:
    fileEnv.FUNAGING_TOURISM_SCHEMA ||
    fileEnv.NEXT_PUBLIC_FUNAGING_TOURISM_SCHEMA ||
    process.env.FUNAGING_TOURISM_SCHEMA ||
    process.env.NEXT_PUBLIC_FUNAGING_TOURISM_SCHEMA ||
    'tourism_gs',
};

export function maskServerKey(value: string) {
  return {
    length: value.length,
    first8: value.slice(0, 8),
    last8: value.slice(-8),
    hasWhitespace: /\s/.test(value),
    hasQuote: value.includes('"') || value.includes("'"),
  };
}
