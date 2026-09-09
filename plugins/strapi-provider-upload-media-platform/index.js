'use strict';

/**
 * Strapi Custom Upload Provider for Enterprise Media Platform
 * Compatible with Strapi v4 & v5
 */

const FormData = require('form-data');
const fetch = require('node-fetch');

module.exports = {
  init(providerOptions = {}) {
    const {
      baseUrl = process.env.MEDIA_PLATFORM_URL || 'http://localhost:3000',
      apiKey = process.env.MEDIA_PLATFORM_API_KEY,
      collectionId = process.env.MEDIA_PLATFORM_COLLECTION_ID,
      defaultFormat = 'webp',
      defaultQuality = 80,
    } = providerOptions;

    const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

    const uploadFile = async (file) => {
      const form = new FormData();

      // Strapi provides file.stream or file.buffer
      if (file.stream) {
        form.append('file', file.stream, {
          filename: `${file.hash}${file.ext}`,
          contentType: file.mime,
        });
      } else if (file.buffer) {
        form.append('file', file.buffer, {
          filename: `${file.hash}${file.ext}`,
          contentType: file.mime,
        });
      } else {
        throw new Error('File buffer or stream not found in Strapi file object');
      }

      if (collectionId) {
        form.append('collection_id', collectionId);
      }

      const headers = form.getHeaders();
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${cleanBaseUrl}/api/v1/uploads/direct`, {
        method: 'POST',
        headers,
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Media Platform upload failed [${response.status}]: ${errorText}`);
      }

      const result = await response.json();
      const asset = result.data;

      // Assign delivery CDN URL to Strapi file
      const deliveryUrl = `${cleanBaseUrl}/api/v1/delivery/${asset.id}?format=${defaultFormat}&quality=${defaultQuality}`;
      file.url = deliveryUrl;
      file.provider_metadata = {
        asset_id: asset.id,
        storage_provider: asset.storage_provider,
        checksum: asset.checksum,
        focal_point: asset.metadata_json?.focal_point || { x: 0.5, y: 0.5 },
      };

      // Assign responsive formats if available
      if (file.formats && typeof file.formats === 'object') {
        Object.keys(file.formats).forEach((key) => {
          const format = file.formats[key];
          format.url = `${cleanBaseUrl}/api/v1/delivery/${asset.id}?width=${format.width}&height=${format.height}&format=${defaultFormat}&quality=${defaultQuality}&fit=focal`;
        });
      }

      return file;
    };

    return {
      uploadStream(file) {
        return uploadFile(file);
      },
      upload(file) {
        return uploadFile(file);
      },
      async delete(file) {
        const assetId = file.provider_metadata?.asset_id;
        if (!assetId) return;

        const headers = {
          'Content-Type': 'application/json',
        };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const res = await fetch(`${cleanBaseUrl}/api/v1/assets/${assetId}`, {
          method: 'DELETE',
          headers,
        });

        if (!res.ok) {
          console.warn(`[MediaPlatform] Warning: Failed to delete asset ${assetId}`);
        }
      },
      checkFileSize(file, { sizeLimit }) {
        if (sizeLimit && file.size > sizeLimit) {
          throw new Error(`File size ${file.size} exceeds maximum limit of ${sizeLimit}`);
        }
      },
    };
  },
};
