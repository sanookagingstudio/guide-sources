import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Guide Sources',
  description: 'Standalone Guide Sources app for member submissions, search, and admin review.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
