import type { Metadata } from 'next';
import './globals.css';

const siteUrl = new URL(
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:5173',
);

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: 'Vector Work',
  manifest: '/manifest.webmanifest',
  title: {
    default: 'Vector Work',
    template: '%s | Vector Work',
  },
  description:
    'Shared engineering work tracking for engineers and management.',
  openGraph: {
    title: 'Vector Work',
    description: 'Engineering work, aligned.',
    type: 'website',
    url: '/',
    images: [
      {
        url: '/og.png',
        width: 1792,
        height: 1024,
        alt: 'Vector Work — Engineering work, aligned.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vector Work',
    description: 'Engineering work, aligned.',
    images: ['/og.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Vector Work',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/vector-work-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/vector-work-192.png', sizes: '192x192' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
