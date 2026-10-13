import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Monad Constellation',
  description: 'Every active Monad wallet as a star, every token a planet. Built from Nansen.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
