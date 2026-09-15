'use client';

import { useState, useRef } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { UploadModal } from '@/components/media/UploadModal';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { useRouter } from 'next/navigation';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const router = useRouter();
  const mobileNavigation = useRef<HTMLDetailsElement>(null);

  const handleAssetUploaded = () => {
    // Refresh page or trigger notification
    router.refresh();
  };

  return (
    <AuthProvider>
      <div className="flex flex-col md:flex-row min-h-screen bg-slate-950 text-slate-100">
        <details ref={mobileNavigation} className="md:hidden border-b border-slate-800 bg-slate-900">
          <summary className="cursor-pointer p-4 font-medium focus-visible:outline-2 focus-visible:outline-violet-400">Navigation</summary>
          <AppSidebar compact onNavigate={() => {
            if (mobileNavigation.current) {
              mobileNavigation.current.open = false;
              mobileNavigation.current.querySelector('summary')?.focus();
            }
          }} />
        </details>
        <div className="hidden md:block"><AppSidebar /></div>
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader onOpenUpload={() => setUploadOpen(true)} />
          <main className="flex-1 p-4 sm:p-6 overflow-y-auto">{children}</main>
        </div>

        <UploadModal
          isOpen={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={handleAssetUploaded}
        />
      </div>
    </AuthProvider>
  );
}
