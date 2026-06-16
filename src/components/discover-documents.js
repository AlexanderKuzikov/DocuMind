import fs from 'node:fs/promises';
import path from 'node:path';

export const meta = {
  id: 'discover-documents',
  version: '0.1.0',
  input: ['inputDir'],
  output: ['documents']
};

export async function run(context) {
  const inputDir = context.paths.input;
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const supported = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
  const documents = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(inputDir, entry.name))
    .filter((file) => supported.includes(path.extname(file).toLowerCase()))
    .sort();

  if (!documents.length) {
    return {
      ok: false,
      error: {
        code: 'NO_INPUT_DOCUMENTS',
        message: `No supported documents found in ${inputDir}`,
        stage: meta.id,
        recoverable: false,
        suggestions: ['Put PDF/PNG/JPG/WEBP files into the configured input folder']
      }
    };
  }

  return {
    ok: true,
    artifacts: {
      documents: documents.map((file) => ({ path: file, name: path.basename(file) }))
    }
  };
}
