import type { Metadata, Viewport } from 'next';
import './globals.css';

// Installable PWA identity (OWNER-ICONS): one consistent icon family shared by all nine FUNAGING apps.
// The bytes live in public/icons/guide-sources/ so the manifest and every declared icon are served from
// this app's own origin, and start_url/scope point at this app only.
const ICONS = '/icons/guide-sources';

export const metadata: Metadata = {
  title: 'Guide Sources',
  description: 'Standalone Guide Sources app for member submissions, search, and admin review.',
  manifest: `${ICONS}/manifest.webmanifest`,
  applicationName: 'Guide Sources',
  icons: {
    icon: [
      { url: `${ICONS}/favicon-32.png`, sizes: '32x32', type: 'image/png' },
      { url: `${ICONS}/favicon-48.png`, sizes: '48x48', type: 'image/png' },
      { url: `${ICONS}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { url: `${ICONS}/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { url: `${ICONS}/icon.svg`, type: 'image/svg+xml' },
    ],
    apple: [{ url: `${ICONS}/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' }],
    other: [{ rel: 'msapplication-TileImage', url: `${ICONS}/mstile-150.png` }],
  },
  appleWebApp: { capable: true, title: 'แหล่งท่องเที่ยว', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#8A5A3B',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
