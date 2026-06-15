import { existsSync, readFileSync } from 'node:fs';

const required = [
  'src/app/page.tsx',
  'src/app/layout.tsx',
  'src/app/globals.css',
  'src/components/MemberTab.tsx',
  'src/components/SearchTab.tsx',
  'src/components/AdminTab.tsx',
  'src/services/placesService.ts',
  'src/services/mediaService.ts',
  'src/services/importService.ts',
  'src/integrations/mainWebAdapter.ts',
  'supabase/migrations/0001_guide_sources_schema.sql',
];
const missing = required.filter((file) => !existsSync(file));
if (missing.length) {
  console.error(`Missing runtime files: ${missing.join(', ')}`);
  process.exit(1);
}
const env = readFileSync('.env.example', 'utf8');
for (const key of ['VITE_SUPABASE_URL=', 'VITE_SUPABASE_ANON_KEY=', 'VITE_MEDIA_UPLOAD_ENABLED=false']) {
  if (!env.includes(key)) {
    console.error(`Missing env key: ${key}`);
    process.exit(1);
  }
}
console.log('Guide Sources Next runtime contract files are present.');
