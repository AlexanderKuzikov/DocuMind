import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { createCanvas, Image } from '@napi-rs/canvas';
import { projectRoot } from '../lib/paths.js';

export const meta = {
  id: 'rasterize-first-page',
  version: '0.1.0',
  input: ['document'],
  output: ['image']
};

pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(projectRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {}
}

async function rasterizePdfFirstPage(filePath, stagingDir, dpi, format) {
  const loadingTask = pdfjs.getDocument(pathToFileURL(filePath).href);
  const pdfDocument = await loadingTask.promise;
  if (pdfDocument.numPages < 1) {
    throw new Error('PDF has no pages');
  }

  const page = await pdfDocument.getPage(1);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
  await pdfDocument.cleanup();

  const pngBuffer = canvas.toBuffer('image/png');
  const outputExt = format === 'png' ? 'png' : 'webp';
  const outputName = `page-001.${outputExt}`;
  const outputDir = path.join(stagingDir, 'raster');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, outputName);

  if (outputExt === 'webp') {
    await sharp(pngBuffer).webp({ quality: 90 }).toFile(outputPath);
  } else {
    await fs.writeFile(outputPath, pngBuffer);
  }

  return {
    path: outputPath,
    format: outputExt,
    dpi,
    width: viewport.width,
    height: viewport.height,
    pages: pdfDocument.numPages
  };
}

async function copyImageFirstPage(filePath, stagingDir, format) {
  const outputExt = format === 'png' ? 'png' : 'webp';
  const outputName = `page-001.${outputExt}`;
  const outputDir = path.join(stagingDir, 'raster');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, outputName);

  if (format === 'png') {
    await sharp(filePath).png().toFile(outputPath);
  } else {
    await sharp(filePath).webp({ quality: 90 }).toFile(outputPath);
  }

  const metadata = await sharp(outputPath).metadata();
  return {
    path: outputPath,
    format: outputExt,
    dpi: null,
    width: metadata.width,
    height: metadata.height,
    pages: 1
  };
}

export async function run(context) {
  const document = context.document || context.artifacts.document;
  const docId = context.document.id;
  const stagingDir = path.join(context.paths.staging, docId);
  const ext = path.extname(document.path).toLowerCase();
  const format = context.config.rasterize.format || 'webp';
  const dpi = context.config.rasterize.dpi || 200;

  let image;
  if (ext === '.pdf') {
    image = await rasterizePdfFirstPage(document.path, stagingDir, dpi, format);
  } else {
    image = await copyImageFirstPage(document.path, stagingDir, format);
  }

  await fs.mkdir(stagingDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify({
    docId,
    source: document.path,
    image,
    createdAt: new Date().toISOString()
  }, null, 2));

  return {
    ok: true,
    artifacts: { image }
  };
}
