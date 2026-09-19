import type { Metadata, Viewport } from 'next';
import MobileWorkspace from './mobile-workspace';

export const metadata: Metadata = {
  title: 'Mobile engineering',
  description: 'Create and track engineering work from the field.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#071713',
};

export default function MobilePage() {
  return <MobileWorkspace />;
}

