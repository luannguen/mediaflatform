'use strict';

/**
 * Strapi Custom Upload Provider for Enterprise Media Platform
 * Compatible with Strapi v4 & v5
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
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
      if (!apiKey) throw new Error('Media Platform API key is required');
      let tempDir;
      let source = file.buffer;
      let size = source?.length;
      const api = async (route, method, body) => {
        const response = await fetch(cleanBaseUrl + route, { method, headers: { 'Content-Type': 'application/json', 'X-Media-Api-Key': apiKey }, body: body ? JSON.stringify(body) : undefined, timeout: 30000, redirect: 'error' });
        const json = await response.json();
        if (!response.ok) throw new Error('Media Platform request failed: ' + response.status + ' ' + (json.error?.code || 'API_ERROR'));
        return json.data;
      };
      let asset;
      try {
        if (!source) {
          if (!file.stream) throw new Error('File stream or buffer is required');
          tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'media-platform-'));
          const target = path.join(tempDir, 'upload');
          let bytes = 0;
          await pipeline(file.stream, new Transform({ transform(chunk, enc, cb) { bytes += chunk.length; cb(bytes > 500*1024*1024 ? new Error('File exceeds 500 MiB') : null, chunk); } }), fs.createWriteStream(target));
          size = bytes; source = fs.createReadStream(target);
        }
        const created = await api('/api/v1/uploads/sessions', 'POST', { filename: file.hash + file.ext, file_size: size, mime_type: file.mime, visibility: 'public' });
        const response = await fetch(created.capability.uploadUrl, { method: created.capability.method, headers: { ...created.capability.headers, 'Content-Length': String(size) }, body: source, timeout: 300000, redirect: 'error' });
        if (!response.ok) throw new Error('Media Platform storage upload failed: ' + response.status);
        const completed = await api('/api/v1/uploads/sessions/' + created.session.id + '/complete', 'POST', {});
        asset = completed.asset;
        if (collectionId) await api('/api/v1/collections/' + encodeURIComponent(collectionId) + '/assets', 'POST', { asset_ids: [asset.id] });
      } finally {
        if (source && typeof source.destroy === 'function') source.destroy();
        if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true });
      }

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
          throw new Error('Media Platform could not trash the asset: ' + res.status);
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
