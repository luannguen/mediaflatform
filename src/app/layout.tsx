import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'sonner';
import { DevToolsErrorSuppressor } from '@/components/common/DevToolsErrorSuppressor';

export const metadata: Metadata = {
  title: 'Media Platform | Independent DAM & Asset Infrastructure',
  description: 'Enterprise Headless Digital Asset Management with Zero-Trust Multi-Tenancy',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">
        <DevToolsErrorSuppressor />
        {children}
        <Toaster position="top-right" richColors theme="dark" />
      </body>
    </html>
  );
}
