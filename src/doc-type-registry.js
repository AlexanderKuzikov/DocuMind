import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfigPath } from './lib/config.js';

export async function scanDocTypes(config) {
  const dir = resolveConfigPath(config, config.paths.docTypes);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort();

  const docTypes = [];
  for (const file of files) {
    const content = JSON.parse(await fs.readFile(file, 'utf8'));
    docTypes.push({
      ...content,
      sourceFile: file
    });
  }

  const byType = new Map();
  for (const docType of docTypes) {
    if (!docType.type) {
      throw new Error(`Doc type ${docType.sourceFile} has no "type" field`);
    }
    if (byType.has(docType.type)) {
      throw new Error(`Duplicate doc type: ${docType.type}`);
    }
    byType.set(docType.type, docType);
  }

  return docTypes;
}

export function findDocType(docTypes, type) {
  return docTypes.find((item) => item.type === type) || null;
}
