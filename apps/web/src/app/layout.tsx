import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tilik | Reviewer Portal',
  description: 'Evidence-integrity review for JKN health claims.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
