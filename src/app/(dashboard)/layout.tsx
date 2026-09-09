'use client';

import { useState } from 'react';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { UploadModal } from '@/components/media/UploadModal';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { useRouter } from 'next/navigation';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const router = useRouter();

  const handleAssetUploaded = () => {
    // Refresh page or trigger notification
    router.refresh();
  };

  return (
    <AuthProvider>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader onOpenUpload={() => setUploadOpen(true)} />
          <main className="flex-1 p-6 overflow-y-auto">{children}</main>
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
