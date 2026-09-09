import React from 'react';
import type { Metadata } from 'next';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { LiveGallerySection } from './components/LiveGallerySection';
import { TransformationLab } from './components/TransformationLab';
import { PickerDemoSection } from './components/PickerDemoSection';
import { ApiConsoleSection } from './components/ApiConsoleSection';
import { FeatureSection } from './components/FeatureSection';
import { Footer } from './components/Footer';

export const metadata: Metadata = {
  title: 'MediaPlatform Demo Hub | Centralized Headless DAM & Dynamic CDN',
  description:
    'Khám phá nền tảng quản lý và phân phối media tập trung cho mọi ứng dụng: REST API v1, Dynamic Sharp CDN, Embeddable Picker Widget và Safe Delete Reference Guard.',
};

export default function LandingTestPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-sky-500/30 selection:text-sky-200">
      <Navbar />
      <main>
        <HeroSection />
        <LiveGallerySection />
        <TransformationLab />
        <PickerDemoSection />
        <ApiConsoleSection />
        <FeatureSection />
      </main>
      <Footer />
    </div>
  );
}
