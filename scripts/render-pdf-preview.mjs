import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
const resource = (name) => path.join(root, name).replaceAll('\\', '/') + '/';
const [source, output] = process.argv.slice(2);
if (!source || !output || fs.statSync(source).size > 50 * 1024 * 1024) throw new Error('Invalid PDF input');
const task = getDocument({ data: new Uint8Array(fs.readFileSync(source)), isEvalSupported: false, useSystemFonts: false,
  standardFontDataUrl: resource('standard_fonts'), cMapUrl: resource('cmaps'), cMapPacked: true,
  wasmUrl: resource('wasm'), maxImageSize: 16 * 1024 * 1024, stopAtErrors: true });
try {
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(1200 / natural.width, 1600 / natural.height, 2);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
  fs.writeFileSync(output, canvas.toBuffer('image/png'));
  process.stdout.write(JSON.stringify({ pageCount: pdf.numPages }));
} finally { await task.destroy(); }
