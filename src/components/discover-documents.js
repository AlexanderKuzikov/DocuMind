import fs from 'node:fs/promises';
import path from 'node:path';

export const meta = {
  id: 'discover-documents',
  version: '0.2.0',
  input: ['inputDir'],
  output: ['documents']
};

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);

/**
 * Recursively collect all supported files under dir.
 * Node 18.17+ supports fs.readdir with { recursive: true }.
 */
async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      // In recursive mode, entry.path contains the parent directory
      const parentDir = entry.path ?? entry.parentPath ?? dir;
      return path.join(parentDir, entry.name);
    })
    .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort();
}

export async function run(context) {
  const inputDir = context.paths.input;
  const files = await collectFiles(inputDir);

  if (!files.length) {
    return {
      ok: false,
      error: {
        code: 'NO_INPUT_DOCUMENTS',
        message: `No supported documents found in ${inputDir} (searched recursively)`,
        stage: meta.id,
        recoverable: false,
        suggestions: ['Put PDF/PNG/JPG/WEBP files into the configured input folder or its subfolders']
      }
    };
  }

  return {
    ok: true,
    artifacts: {
      documents: files.map((file) => ({ path: file, name: path.basename(file) }))
    }
  };
}
