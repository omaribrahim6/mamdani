import type { Metadata, Viewport } from 'next';
import { Big_Shoulders_Stencil, Overpass } from 'next/font/google';
import './globals.css';

const stencil = Big_Shoulders_Stencil({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-stencil',
});
const ui = Overpass({
  subsets: ['latin'],
  variable: '--font-ui',
});

export const metadata: Metadata = {
  title: 'Mamdani',
  description: 'Point at what’s broken. Say “Mamdani, fix this.” Your city gets a report it can act on.',
  applicationName: 'Mamdani',
  appleWebApp: { capable: true, title: 'Mamdani', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#26292c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${stencil.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
