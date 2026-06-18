import fs from 'node:fs/promises';
import path from 'node:path';
import { stableStringify } from '../lib/json.js';

export const meta = {
  id: 'write-output',
  version: '0.2.0',
  label: 'Write PDF and JSON output',
  description: 'Copies the assembled PDF to output/ and writes a JSON result with the same base name.',
  input: ['finalDocument', 'assembledPdf'],
  output: ['outputPath', 'pdfPath']
};

function sanitizeFileNamePart(value) {
  return String(value ?? 'unknown')
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|«»„“'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'unknown';
}

function applyTemplate(template, values, counter) {
  return String(template || '{docType}_{createdAtDate}_{counter}')
    .replaceAll('{createdAtDate}', values.createdAtDate || 'unknown-date')
    .replaceAll('{counter}', String(counter).padStart(3, '0'))
    .replaceAll(/\{([a-zA-Z0-9_.-]+)\}/g, (_, key) => sanitizeFileNamePart(values[key]));
}

function withExtension(fileName, extension) {
  if (path.extname(fileName)) return fileName;
  return `${fileName}.${extension}`;
}

async function uniqueOutputPath(outputDir, fileName) {
  const candidate = path.join(outputDir, fileName);
  try {
    await fs.access(candidate);
  } catch {
    return candidate;
  }

  const parsed = path.parse(fileName);
  const base = parsed.name;
  const ext = parsed.ext;
  for (let index = 1; index < 1000; index += 1) {
    const next = path.join(outputDir, `${base}_${String(index).padStart(3, '0')}${ext}`);
    try {
      await fs.access(next);
    } catch {
      return next;
    }
  }
  throw new Error(`Cannot find unique output name for ${fileName}`);
}

export async function run(context) {
  const outputDir = context.paths.output;
  await fs.mkdir(outputDir, { recursive: true });

  const doc = context.artifacts.finalDocument;
  const naming = doc.selectedDocType?.outputNaming || doc.selectedDocType?.crmNaming || { template: '{docType}_{createdAtDate}_{counter}' };
  const values = {
    docType: doc.docType,
    docTypeName: doc.docTypeName,
    createdAtDate: new Date().toISOString().slice(0, 10),
    ...(doc.fields || {}),
    ...(doc.crm || {})
  };

  if (!context.artifacts.assembledPdf?.path) {
    return {
      ok: false,
      error: {
        code: 'MISSING_ASSEMBLED_PDF',
        message: 'Cannot write output PDF because assemble-document-pdf did not produce a file.',
        stage: meta.id,
        recoverable: false,
        suggestions: ['check assemble-document-pdf output']
      }
    };
  }

  const pdfFileName = withExtension(applyTemplate(naming.template, values, context.counters.output), 'pdf');
  const pdfPath = await uniqueOutputPath(outputDir, pdfFileName);
  const jsonFileName = `${path.basename(pdfFileName, path.extname(pdfFileName))}.json`;
  const jsonPath = await uniqueOutputPath(outputDir, jsonFileName);

  await fs.copyFile(context.artifacts.assembledPdf.path, pdfPath);

  const jsonDoc = {
    ...doc,
    pdfFileName: path.basename(pdfPath),
    jsonFileName: path.basename(jsonPath),
    outputPdfPath: pdfPath,
    outputJsonPath: jsonPath
  };

  await fs.writeFile(jsonPath, stableStringify(jsonDoc));

  return {
    ok: true,
    artifacts: {
      outputPath: jsonPath,
      pdfPath,
      finalDocument: jsonDoc
    }
  };
}
