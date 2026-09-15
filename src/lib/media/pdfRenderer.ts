import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Separate process bounds malformed PDF CPU time and JS heap use. */
export async function renderPdfPreview(source: string, workDir: string, signal?: AbortSignal) {
  const output = path.join(workDir, 'pdf-preview.png');
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--max-old-space-size=256', path.join(process.cwd(), 'scripts/render-pdf-preview.mjs'), source, output],
    { timeout: 30000, maxBuffer: 65536, windowsHide: true, signal });
  const result = JSON.parse(stdout.slice(stdout.lastIndexOf('{')));
  if (!Number.isSafeInteger(result.pageCount) || result.pageCount < 1) throw new Error('CORRUPTED_SOURCE: Invalid PDF page count');
  const thumbnail = await sharp(await fs.readFile(output)).webp({ quality: 85 }).toBuffer();
  return { pageCount: result.pageCount as number, thumbnail };
}
