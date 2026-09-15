import { Asset } from '@/types/database';
import { getStorageProvider } from '@/lib/storage/factory';
import { validateDeclaredVsDetectedMime } from './magicByteValidator';
import { inspectSvgSafety } from './svgSanitizer';
import { validateUploadLimits } from '@/lib/security/uploadPolicy';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Stage only a provider-issued URL, and validate precisely the bytes the processor will read. */
export async function verifyAndStageSource(asset: Asset, target: string, signal?: AbortSignal) {
  validateUploadLimits(asset.asset_type, Number(asset.size_bytes));
  const url = await getStorageProvider().getSignedDownloadUrl(asset.storage_key, 900, asset.storage_bucket || undefined);
  const response = await fetch(url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error('SOURCE_NOT_FOUND: Storage source unavailable');
  const hash = createHash('sha256');
  let count = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    count += chunk.length;
    if (count > Number(asset.size_bytes)) return callback(new Error('CORRUPTED_SOURCE: Source exceeds declared size'));
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as any), meter, createWriteStream(target, { flags: 'wx' }), { signal });
  if (count !== Number(asset.size_bytes)) throw new Error('CORRUPTED_SOURCE: Source size mismatch');
  const checksum = hash.digest('hex');
  const declared = asset.metadata_json?.declared_checksum;
  if (declared && String(declared).toLowerCase() !== checksum) throw new Error('CORRUPTED_SOURCE: SHA-256 mismatch');
  const file = await fs.open(target, 'r');
  let head: Buffer;
  try { const buffer = Buffer.alloc(Math.min(count, 65536)); await file.read(buffer, 0, buffer.length, 0); head = buffer; }
  finally { await file.close(); }
  let detected;
  try { detected = validateDeclaredVsDetectedMime(asset.mime_type, head!, asset.original_filename); }
  catch { throw new Error('CORRUPTED_SOURCE: Declared MIME does not match source bytes'); }
  if (detected.isQuarantined || !detected.isSafe || detected.assetType !== asset.asset_type) throw new Error('CORRUPTED_SOURCE: Unsupported or unsafe content');
  if (detected.detectedMime === 'image/svg+xml' && !inspectSvgSafety(await fs.readFile(target, 'utf8')).isSafe) throw new Error('CORRUPTED_SOURCE: Unsafe SVG content');
  return { checksum, sizeBytes: count, detectedMime: detected.detectedMime };
}
