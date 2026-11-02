import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Attendance Admin',
  description: 'Shift attendance and on-shift location review',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
