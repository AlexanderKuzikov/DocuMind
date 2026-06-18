import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { createCanvas, Image, Path2D, DOMMatrix, DOMPoint, DOMRect } from '@napi-rs/canvas';
import { projectRoot } from '../lib/paths.js';

export const meta = {
  id: 'assemble-document-pdf',
  version: '0.1.0',
  label: 'Assemble document PDF',
  description: 'Converts all supported files of one document into one assembled PDF and keeps the first page image for LLM extraction.',
  input: ['document'],
  output: ['assembledPdf', 'image']
};

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif']);

let pdfjsPromise;

function ensureCanvasGlobals() {
  globalThis.Image = Image;
  globalThis.Path2D = Path2D;
  globalThis.DOMMatrix = DOMMatrix;
  globalThis.DOMPoint = DOMPoint;
  globalThis.DOMRect = DOMRect;
}

async function loadPdfJs() {
  ensureCanvasGlobals();
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  const pdfjs = await pdfjsPromise;
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(projectRoot, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  return pdfjs;
}

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

async function rasterizePdfPages(filePath, outputDir, dpi, quality) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    url: pathToFileURL(filePath).href,
    disableFontFace: true
  });
  const pdfDocument = await loadingTask.promise;
  const pages = [];
  const numPages = pdfDocument.numPages;

  for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      await page.render({
        canvasContext: context,
        viewport,
        canvasFactory: new NodeCanvasFactory()
      }).promise;
      const pngBuffer = canvas.toBuffer('image/png');
      const jpegBuffer = await sharp(pngBuffer).jpeg({ quality, progressive: false }).toBuffer();
      const outputPath = path.join(outputDir, `page-${String(pageNumber).padStart(3, '0')}.jpg`);
      await fs.writeFile(outputPath, jpegBuffer);
      pages.push({
        path: outputPath,
        format: 'jpeg',
        width: viewport.width,
        height: viewport.height,
        pageNumber
      });
    } finally {
      page.cleanup();
    }
  }

  await pdfDocument.cleanup();
  return pages;
}

async function rasterizeImagePage(filePath, outputDir, quality) {
  const metadata = await sharp(filePath).metadata();
  const jpegBuffer = await sharp(filePath)
    .rotate()
    .jpeg({ quality, progressive: false })
    .toBuffer();
  const outputPath = path.join(outputDir, 'page-001.jpg');
  await fs.writeFile(outputPath, jpegBuffer);
  return [
    {
      path: outputPath,
      format: 'jpeg',
      width: metadata.width || 0,
      height: metadata.height || 0,
      pageNumber: 1
    }
  ];
}

function escapePdfString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPdf(objects) {
  const parts = [];
  const offsets = new Map();
  let offset = 0;
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');
  parts.push(header);
  offset += header.length;

  function addObject(number, body) {
    offsets.set(number, offset);
    const text = `${number} 0 obj\n${body}\nendobj\n`;
    parts.push(text);
    offset += Buffer.byteLength(text, 'binary');
  }

  function addObjectStream(number, header, buffer) {
    offsets.set(number, offset);
    const footer = Buffer.from('\r\nendstream\nendobj\n', 'binary');
    const headerBuffer = Buffer.from(`${number} 0 obj\n${header}\nstream\r\n`, 'binary');
    parts.push(headerBuffer);
    parts.push(buffer);
    parts.push(footer);
    offset += headerBuffer.length + buffer.length + footer.length;
  }

  const pageObjects = objects.map((image, index) => ({
    page: 3 + index * 3,
    image: 4 + index * 3,
    contents: 5 + index * 3
  }));

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, `<< /Type /Pages /Kids [${pageObjects.map((item) => `${item.page} 0 R`).join(' ')}] /Count ${objects.length} >>`);

  for (let index = 0; index < objects.length; index += 1) {
    const image = objects[index];
    const pageObject = pageObjects[index];
    addObject(pageObject.page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << /Im0 ${pageObject.image} 0 R >> >> /Contents ${pageObject.contents} 0 R >>`);
    addObjectStream(
      pageObject.image,
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.buffer.length} >>`,
      image.buffer
    );
    addObject(pageObject.contents, `<< /Length ${44 + String(image.width).length + String(image.height).length} >>\nstream\nq ${image.width} 0 0 ${image.height} 0 0 cm /Im0 Do Q\nendstream`);
  }

  const nextObjectNumber = 3 + objects.length * 3;
  const xrefOffset = offset;
  parts.push(`xref\n0 ${nextObjectNumber}\n`);
  parts.push('0000000000 65535 f \n');
  for (let number = 1; number < nextObjectNumber; number += 1) {
    parts.push(`${String(offsets.get(number)).padStart(10, '0')} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${nextObjectNumber} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part, 'binary')));
}

async function assemblePdf(pages, outputPath) {
  const objects = await Promise.all(pages.map(async (page) => ({
    ...page,
    width: Math.round(page.width),
    height: Math.round(page.height),
    buffer: await fs.readFile(page.path)
  })));
  const pdfBuffer = buildPdf(objects);
  await fs.writeFile(outputPath, pdfBuffer);
  return {
    path: outputPath,
    pages: objects.length,
    width: objects[0]?.width || 0,
    height: objects[0]?.height || 0
  };
}

export async function run(context) {
  const document = context.document || context.artifacts.document;
  const docId = document.id;
  const stagingDir = path.join(context.paths.staging, docId, 'assembled');
  const dpi = context.config.rasterize?.dpi || 200;
  const quality = context.config.rasterize?.quality || 90;
  await fs.mkdir(stagingDir, { recursive: true });

  if (!Array.isArray(document.files) || !document.files.length) {
    return {
      ok: false,
      error: {
        code: 'NO_DOCUMENT_FILES',
        message: `Document ${docId} has no files to assemble.`,
        stage: meta.id,
        recoverable: false,
        suggestions: ['Check discover-documents output']
      }
    };
  }

  const pages = [];
  for (const file of document.files) {
    const ext = path.extname(file.path).toLowerCase();
    if (ext === '.pdf') {
      pages.push(...await rasterizePdfPages(file.path, stagingDir, dpi, quality));
    } else if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
      pages.push(...await rasterizeImagePage(file.path, stagingDir, quality));
    } else {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_FORMAT',
          message: `Unsupported file format: ${ext || '(no extension)'}. Supported: .pdf, .png, .jpg, .jpeg, .webp`,
          stage: meta.id,
          recoverable: false,
          suggestions: ['Convert unsupported file to PDF, JPEG, PNG, or WebP before processing']
        }
      };
    }
  }

  if (!pages.length) {
    return {
      ok: false,
      error: {
        code: 'NO_RASTER_PAGES',
        message: `Document ${docId} produced no raster pages.`,
        stage: meta.id,
        recoverable: false,
        suggestions: ['Check source files']
      }
    };
  }

  const assembledPdf = await assemblePdf(pages, path.join(stagingDir, 'document.pdf'));
  const firstPage = pages[0];

  await fs.writeFile(path.join(context.paths.staging, docId, 'manifest.json'), JSON.stringify({
    docId,
    source: document.files,
    assembledPdf,
    image: firstPage,
    createdAt: new Date().toISOString()
  }, null, 2));

  return {
    ok: true,
    artifacts: {
      assembledPdf,
      image: firstPage
    }
  };
}
