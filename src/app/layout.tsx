import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: { default: 'ECA Promotion Fair', template: '%s · ECA Fair' }, description: 'Club sign-up and payment for the ECA Promotion Fair.', icons: '/logo.png' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light dark' };

export default function Root({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
