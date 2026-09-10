import { AppError } from '@/lib/errors/app-error';
import { AssetType } from '@/types/database';

export interface DetectedTypeInfo {
  detectedMime: string;
  extension: string;
  assetType: AssetType;
  isSafe: boolean;
  isQuarantined: boolean;
}

/**
 * Detect real binary MIME type by inspecting magic bytes / signatures
 */
export function detectContentType(buffer: Buffer): DetectedTypeInfo {
  if (!buffer || buffer.length < 4) {
    return {
      detectedMime: 'application/octet-stream',
      extension: 'bin',
      assetType: 'other',
      isSafe: true,
      isQuarantined: false,
    };
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return {
      detectedMime: 'image/jpeg',
      extension: 'jpg',
      assetType: 'image',
      isSafe: true,
      isQuarantined: false,
    };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return {
      detectedMime: 'image/png',
      extension: 'png',
      assetType: 'image',
      isSafe: true,
      isQuarantined: false,
    };
  }

  // 3. GIF: 47 49 46 38 ('GIF8')
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return {
      detectedMime: 'image/gif',
      extension: 'gif',
      assetType: 'image',
      isSafe: true,
      isQuarantined: false,
    };
  }

  // 4. WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return {
      detectedMime: 'image/webp',
      extension: 'webp',
      assetType: 'image',
      isSafe: true,
      isQuarantined: false,
    };
  }

  // 5. PDF: %PDF- (25 50 44 46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return {
      detectedMime: 'application/pdf',
      extension: 'pdf',
      assetType: 'document',
      isSafe: true,
      isQuarantined: false,
    };
  }

  // 6. MP4 / QuickTime / AVIF: ....ftyp
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (brand.includes('avif') || brand.includes('avis')) {
      return {
        detectedMime: 'image/avif',
        extension: 'avif',
        assetType: 'image',
        isSafe: true,
        isQuarantined: false,
      };
    }
    return {
      detectedMime: 'video/mp4',
      extension: 'mp4',
      assetType: 'video',
      isSafe: true,
      isQuarantined: false,
    };
  }

  // 7. WebM / Matroska: 1A 45 DF A3
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return {
      detectedMime: 'video/webm',
      extension: 'webm',
      assetType: 'video',
      isSafe: true,
      isQuarantined: false,
    };
  }

  // 8. ZIP archive / Office DOCX: 50 4B 03 04 ('PK\x03\x04')
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return {
      detectedMime: 'application/zip',
      extension: 'zip',
      assetType: 'archive',
      isSafe: false,
      isQuarantined: true,
    };
  }

  // 9. Executable binaries: Windows PE (4D 5A 'MZ') or ELF (7F 45 4C 46)
  if (
    (buffer[0] === 0x4d && buffer[1] === 0x5a) ||
    (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46)
  ) {
    return {
      detectedMime: 'application/x-executable',
      extension: 'exe',
      assetType: 'other',
      isSafe: false,
      isQuarantined: true,
    };
  }

  // 10. SVG or XML text: inspect first 1024 characters
  const headStr = buffer.slice(0, Math.min(buffer.length, 1024)).toString('utf8').trim().toLowerCase();
  if (headStr.includes('<svg') || (headStr.includes('<?xml') && headStr.includes('<svg'))) {
    return {
      detectedMime: 'image/svg+xml',
      extension: 'svg',
      assetType: 'image',
      isSafe: true,
      isQuarantined: false,
    };
  }

  return {
    detectedMime: 'application/octet-stream',
    extension: 'bin',
    assetType: 'other',
    isSafe: true,
    isQuarantined: false,
  };
}

/**
 * Validate that declared MIME matches actual detected binary MIME.
 * Throws UPLOAD_CONTENT_TYPE_MISMATCH on spoofing attempt.
 */
export function validateDeclaredVsDetectedMime(
  declaredMime: string,
  buffer: Buffer,
  filename?: string
): DetectedTypeInfo {
  const detected = detectContentType(buffer);
  const normalizedDeclared = declaredMime.trim().toLowerCase();

  // Allow generic octet-stream declaration if detected is safe
  if (normalizedDeclared === 'application/octet-stream' && !detected.isQuarantined) {
    return detected;
  }

  const isJpeg = (m: string) => m === 'image/jpeg' || m === 'image/jpg';
  const isVideo = (m: string) => m.startsWith('video/') || m === 'application/x-mpegurl';

  let matches = false;
  if (normalizedDeclared === detected.detectedMime) {
    matches = true;
  } else if (isJpeg(normalizedDeclared) && isJpeg(detected.detectedMime)) {
    matches = true;
  } else if (isVideo(normalizedDeclared) && detected.assetType === 'video') {
    matches = true;
  } else if (
    (normalizedDeclared.includes('zip') || normalizedDeclared.includes('compressed')) &&
    detected.detectedMime === 'application/zip'
  ) {
    matches = true;
  }

  // Strict MIME Spoof detection: e.g. declared image/jpeg, but binary is ZIP or executable
  if (!matches) {
    if (
      (normalizedDeclared.startsWith('image/') && !detected.detectedMime.startsWith('image/')) ||
      (normalizedDeclared.startsWith('video/') && detected.assetType !== 'video') ||
      (normalizedDeclared === 'application/pdf' && detected.detectedMime !== 'application/pdf') ||
      detected.isQuarantined
    ) {
      throw AppError.badRequest(
        `MIME spoofing detected: Declared [${declaredMime}] does not match actual binary [${detected.detectedMime}] for file ${filename || 'upload'}`,
        'UPLOAD_CONTENT_TYPE_MISMATCH'
      );
    }
  }

  return detected;
}
