# Strapi Custom Upload Provider for Media Platform

Seamlessly connect Strapi CMS (v4 & v5) Media Library with Enterprise Headless Media Platform DAM.

## Features
- **Auto Offloading**: Directly uploads media to Media Platform storage.
- **Dynamic Sharp Resizing**: All Strapi responsive image breakpoints leverage real-time Sharp CDN transformations with `fit=focal` preserving focal points.
- **WebP & AVIF Delivery**: Automatic next-gen format negotiation.
- **Zero Duplication**: Keep Strapi database light while media files reside in high-availability enterprise storage.

## Installation

```bash
npm install ./plugins/strapi-provider-upload-media-platform
# or
yarn add file:./plugins/strapi-provider-upload-media-platform
```

## Configuration

In `config/plugins.js` (or `config/plugins.ts`):

```js
module.exports = ({ env }) => ({
  upload: {
    config: {
      provider: 'strapi-provider-upload-media-platform',
      providerOptions: {
        baseUrl: env('MEDIA_PLATFORM_URL', 'http://localhost:3000'),
        apiKey: env('MEDIA_PLATFORM_API_KEY'),
        collectionId: env('MEDIA_PLATFORM_COLLECTION_ID'),
        defaultFormat: 'webp',
        defaultQuality: 80,
      },
    },
  },
});
```

## Security Headers (CORS / CSP)

In `config/middlewares.js`, ensure your Media Platform URL is whitelisted in `strapi::security`:

```js
module.exports = [
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'http://localhost:3000', 'https://*.yourdomain.com'],
          'media-src': ["'self'", 'data:', 'blob:', 'http://localhost:3000', 'https://*.yourdomain.com'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  // ... other middlewares
];
```
