import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe', 'sharp', 'pdfjs-dist', '@napi-rs/canvas'],
  outputFileTracingIncludes: { '/api/v1/jobs/process': ['./scripts/render-pdf-preview.mjs', './node_modules/pdfjs-dist/**/*', './node_modules/@napi-rs/canvas/**/*'] },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
