const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local if present
if (fs.existsSync('.env.local')) {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[match[1].trim()] = val;
    }
  }
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

async function runTests() {
  console.log('=== STARTING MEDIA PLATFORM v3.0 INTEGRATION TEST SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  let cookieHeader = '';
  let imageAssetId = null;
  let videoAssetId = null;

  // 1. Authenticate as Admin
  console.log('--- STEP 1: Authentication ---');
  if (!adminEmail || !adminPassword) {
    assert(false, 'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local or environment');
    return;
  }

  try {
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
      }),
    });

    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
    cookieHeader = setCookies.map((c) => c?.split(';')[0]).filter(Boolean).join('; ');
    assert(loginRes.ok, `Admin authenticated successfully (HTTP ${loginRes.status})`);
  } catch (err) {
    assert(false, `Admin login failed: ${err.message}`);
  }

  // 2. Fetch or Create Test Assets
  console.log('\n--- STEP 2: Discover or Create Test Assets ---');
  try {
    const sharp = require('sharp');
    const samplePngBuffer = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 124, g: 58, b: 237 }, // purple
      },
    }).png().toBuffer();

    const formData = new FormData();
    const fileBlob = new Blob([samplePngBuffer], { type: 'image/png' });
    formData.append('file', fileBlob, `test-img-${Date.now()}.png`);
    formData.append('display_name', 'Focal & Palette Test Image');

    const uploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });
    const uploadJson = await uploadRes.json();
    if (uploadJson.data) {
      imageAssetId = uploadJson.data.id;
      assert(true, `Uploaded test image asset: ${imageAssetId}`);
    }
  } catch (err) {
    console.log('Upload error, trying existing assets:', err.message);
  }

  if (!imageAssetId) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/assets?limit=50`, {
        headers: { 'Cookie': cookieHeader },
      });
      const json = await res.json();
      if (json.data && Array.isArray(json.data)) {
        const img = json.data.find((a) => a.asset_type === 'image');
        if (img) imageAssetId = img.id;
      }
    } catch (e) {}
  }
  assert(!!imageAssetId, `Test image asset ready: ${imageAssetId}`);

  // Discover an existing processed 'ready' video asset first
  if (!videoAssetId) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/assets?limit=50`, {
        headers: { 'Cookie': cookieHeader },
      });
      const json = await res.json();
      if (json.data && Array.isArray(json.data)) {
        const readyVideo = json.data.find((a) => a.asset_type === 'video' && a.processing_status === 'ready');
        if (readyVideo) {
          videoAssetId = readyVideo.id;
          console.log(`  Found existing ready video asset: ${videoAssetId}`);
        }
      }
    } catch (e) {}
  }

  // If no ready video asset exists, create and process one
  if (!videoAssetId) {
    console.log('  Creating test video asset for testing...');
    try {
      const directRes = await fetch(`${BASE_URL}/api/v1/assets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
        },
        body: JSON.stringify({
          original_filename: 'product-demo.mp4',
          display_name: 'Product Showcase Demo',
          asset_type: 'video',
          mime_type: 'video/mp4',
          size_bytes: 12582912,
          storage_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        }),
      });
      const created = await directRes.json();
      if (created.data) {
        videoAssetId = created.data.id;
        assert(true, `Created test video asset: ${videoAssetId}`);
      }
    } catch (e) {
      console.log('Fallback to sample video ID');
      videoAssetId = 'med_sample_video_test_123';
    }
  }

  if (!videoAssetId) {
    videoAssetId = 'med_sample_video_test_123';
  }

  // 3. Module 1: Video Transcoding & HLS Streaming
  console.log('\n--- STEP 3: Module 1 - Video Transcoding & HLS Streaming ---');
  try {
    // Master HLS Playlist
    const masterRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${videoAssetId}/master.m3u8`);
    assert(masterRes.status === 200, `GET master.m3u8 returned HTTP 200`);
    const masterCt = masterRes.headers.get('content-type') || '';
    assert(
      masterCt.includes('application/vnd.apple.mpegurl') || masterCt.includes('application/x-mpegURL'),
      `Content-Type is HLS playlist: ${masterCt}`
    );
    const masterBody = await masterRes.text();
    assert(masterBody.includes('#EXTM3U'), `Master playlist includes #EXTM3U tag`);
    assert(masterBody.includes('720p.m3u8'), `Master playlist includes 720p variant stream`);
    assert(masterBody.includes('480p.m3u8'), `Master playlist includes 480p variant stream`);
    assert(!masterBody.includes('1080p.m3u8'), `Non-upscaling rule: 720p video correctly excludes 1080p stream`);

    // Variant Playlist 720p
    const variantRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${videoAssetId}/720p.m3u8`);
    assert(variantRes.status === 200, `GET 720p.m3u8 returned HTTP 200`);
    const variantBody = await variantRes.text();
    assert(variantBody.includes('#EXT-X-TARGETDURATION'), `Variant playlist includes #EXT-X-TARGETDURATION`);
    assert(variantBody.includes('.ts'), `Variant playlist contains .ts segment references`);

    // Poster Frame
    const posterRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${videoAssetId}/poster.webp`);
    assert(posterRes.status === 200, `GET poster.webp returned HTTP 200`);
    const posterCt = posterRes.headers.get('content-type') || '';
    assert(posterCt.includes('image/webp'), `Poster frame Content-Type is image/webp`);

    // Animated 3s Trailer Preview
    const trailerRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${videoAssetId}/trailer.webp`);
    assert(trailerRes.status === 200, `GET trailer.webp returned HTTP 200`);
    const trailerCt = trailerRes.headers.get('content-type') || '';
    assert(trailerCt.includes('image/webp'), `Trailer preview Content-Type is image/webp`);
  } catch (err) {
    assert(false, `Video HLS streaming test failed: ${err.message}`);
  }

  // 4. Module 2: Focal Point & Sharp Smart Cropping
  console.log('\n--- STEP 4: Module 2 - Focal Point & Smart Cropping ---');
  try {
    if (imageAssetId) {
      // Update focal point via PATCH
      const patchRes = await fetch(`${BASE_URL}/api/v1/assets/${imageAssetId}/focal-point`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
        },
        body: JSON.stringify({ x: 0.85, y: 0.15 }),
      });
      assert(patchRes.status === 200, `PATCH focal-point returned HTTP 200`);
      const patchJson = await patchRes.json();
      assert(patchJson.success === true, `Focal point update returned success=true`);
      assert(
        patchJson.data?.focal_point?.x === 0.85 && patchJson.data?.focal_point?.y === 0.15,
        `Focal coordinates verified: x=${patchJson.data?.focal_point?.x}, y=${patchJson.data?.focal_point?.y}`
      );

      // Delivery with fit=focal
      const deliveryRes = await fetch(`${BASE_URL}/api/v1/delivery/${imageAssetId}?width=300&height=200&fit=focal`);
      assert(deliveryRes.status === 200, `GET delivery with fit=focal returned HTTP 200`);
      const transformHeader = deliveryRes.headers.get('x-media-transform') || '';
      assert(transformHeader.includes('sharp-focal-crop'), `X-Media-Transform header indicates sharp-focal-crop`);
      const imgBuffer = await deliveryRes.arrayBuffer();
      assert(imgBuffer.byteLength > 100, `Returned image binary has valid size (${imgBuffer.byteLength} bytes)`);

      // Delivery with explicit query focal_x and focal_y
      const queryFocalRes = await fetch(
        `${BASE_URL}/api/v1/delivery/${imageAssetId}?width=250&height=250&focal_x=0.2&focal_y=0.9&fit=focal`
      );
      assert(queryFocalRes.status === 200, `GET delivery with custom focal_x/focal_y query returned HTTP 200`);
      assert(
        (queryFocalRes.headers.get('x-media-transform') || '').includes('sharp-focal-crop'),
        `Query focal parameters triggered sharp-focal-crop transformation`
      );
    } else {
      assert(false, `No image asset found to test focal point`);
    }
  } catch (err) {
    assert(false, `Focal point test failed: ${err.message}`);
  }

  // 5. Module 2: Dominant Palette Extraction
  console.log('\n--- STEP 5: Dominant Color Palette Extraction ---');
  try {
    if (imageAssetId) {
      const assetDetailRes = await fetch(`${BASE_URL}/api/v1/assets/${imageAssetId}`, {
        headers: { 'Cookie': cookieHeader },
      });
      const assetData = await assetDetailRes.json();
      const palette = assetData.data?.metadata_json?.palette;
      console.log('  Extracted Palette:', JSON.stringify(palette));
      assert(!!palette, `Asset contains extracted palette metadata`);
      if (palette) {
        assert(Array.isArray(palette.colors) && palette.colors.length === 5, `Palette contains 5 HEX swatches`);
        assert(typeof palette.dominant === 'string' && palette.dominant.startsWith('#'), `Dominant HEX is valid: ${palette.dominant}`);
      }
    }
  } catch (err) {
    assert(false, `Palette verification failed: ${err.message}`);
  }

  // 6. Module 3: Cross-Platform SDKs & Connectors Integrity
  console.log('\n--- STEP 6: Module 3 - Cross-Platform SDKs & CMS Connectors ---');
  try {
    // Check React Video SDK
    const reactSdkPath = path.resolve(__dirname, '../src/lib/sdk/react/MediaVideo.tsx');
    assert(fs.existsSync(reactSdkPath), `React MediaVideo component exists at src/lib/sdk/react/MediaVideo.tsx`);
    const reactSdkCode = fs.readFileSync(reactSdkPath, 'utf8');
    assert(reactSdkCode.includes('export function MediaVideo'), `MediaVideo exported correctly`);
    assert(reactSdkCode.includes('showTrailerOnHover'), `Hover trailer preview feature present in MediaVideo`);

    // Check React Native SDK
    const rnSdkPath = path.resolve(__dirname, '../src/lib/sdk/react-native/MediaImage.tsx');
    assert(fs.existsSync(rnSdkPath), `React Native MediaImage component exists at src/lib/sdk/react-native/MediaImage.tsx`);
    const rnSdkCode = fs.readFileSync(rnSdkPath, 'utf8');
    assert(rnSdkCode.includes('export function MediaImage'), `React Native MediaImage exported correctly`);
    assert(rnSdkCode.includes('focalX') && rnSdkCode.includes('fit'), `React Native component supports focal point & fit`);

    // Check Flutter SDK
    const flutterSdkPath = path.resolve(__dirname, '../src/lib/sdk/flutter/media_client.dart');
    assert(fs.existsSync(flutterSdkPath), `Flutter SDK exists at src/lib/sdk/flutter/media_client.dart`);
    const flutterSdkCode = fs.readFileSync(flutterSdkPath, 'utf8');
    assert(flutterSdkCode.includes('class MediaPlatformClient'), `Flutter MediaPlatformClient defined`);
    assert(flutterSdkCode.includes('class MediaImage extends StatelessWidget'), `Flutter MediaImage widget defined`);
    assert(flutterSdkCode.includes('getVideoHlsUrl'), `Flutter SDK supports HLS video streaming URL`);

    // Check WordPress Plugin
    const wpPluginPath = path.resolve(__dirname, '../plugins/wordpress/media-platform-connector.php');
    assert(fs.existsSync(wpPluginPath), `WordPress plugin exists at plugins/wordpress/media-platform-connector.php`);
    const wpPluginCode = fs.readFileSync(wpPluginPath, 'utf8');
    assert(wpPluginCode.includes('class MediaPlatformConnector'), `WordPress connector class defined`);
    assert(wpPluginCode.includes('wp_handle_upload'), `WordPress auto-offload upload hook implemented`);
    assert(wpPluginCode.includes('image_downsize'), `WordPress dynamic Sharp downsize hook implemented`);

    // Check Strapi Provider
    const strapiPkgPath = path.resolve(__dirname, '../plugins/strapi-provider-upload-media-platform/package.json');
    const strapiIndexPath = path.resolve(__dirname, '../plugins/strapi-provider-upload-media-platform/index.js');
    assert(fs.existsSync(strapiPkgPath), `Strapi provider package.json exists`);
    assert(fs.existsSync(strapiIndexPath), `Strapi provider index.js exists`);
    const strapiCode = fs.readFileSync(strapiIndexPath, 'utf8');
    assert(strapiCode.includes('uploadStream') && strapiCode.includes('upload') && strapiCode.includes('delete'), `Strapi upload provider methods implemented`);
  } catch (err) {
    assert(false, `Ecosystem SDK inspection failed: ${err.message}`);
  }

  console.log(`\n==================================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
