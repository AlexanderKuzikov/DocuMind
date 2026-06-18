import fs from 'node:fs/promises';
import path from 'node:path';

export const meta = {
  id: 'discover-documents',
  version: '0.3.0',
  label: 'Discover grouped documents',
  description: 'Finds top-level documents in input/: one top-level file or one top-level folder with supported files inside.',
  input: ['inputDir'],
  output: ['documents']
};

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const parentDir = entry.path ?? entry.parentPath ?? dir;
      return path.join(parentDir, entry.name);
    })
    .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

async function discoverDocuments(inputDir) {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const documents = [];

  for (const entry of entries) {
    const absolutePath = path.join(inputDir, entry.name);

    if (entry.isDirectory()) {
      const files = await collectFiles(absolutePath);
      if (!files.length) continue;
      documents.push({
        name: entry.name,
        path: files[0],
        files: files.map((file) => ({
          path: file,
          name: path.basename(file)
        })),
        sourceKind: 'folder'
      });
      continue;
    }

    if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      documents.push({
        name: path.basename(absolutePath),
        path: absolutePath,
        files: [
          {
            path: absolutePath,
            name: path.basename(absolutePath)
          }
        ],
        sourceKind: 'file'
      });
    }
  }

  return documents.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export async function run(context) {
  const inputDir = context.paths.input;
  const documents = await discoverDocuments(inputDir);

  if (!documents.length) {
    return {
      ok: false,
      error: {
        code: 'NO_INPUT_DOCUMENTS',
        message: `No supported documents found in ${inputDir}. Expected top-level files or folders with PDF/PNG/JPG/WEBP files.`,
        stage: meta.id,
        recoverable: false,
        suggestions: ['Put PDF/PNG/JPG/WEBP files into the configured input folder or top-level document folders']
      }
    };
  }

  return {
    ok: true,
    artifacts: {
      documents
    }
  };
}
