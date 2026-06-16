import fs from 'node:fs/promises';
import path from 'node:path';
import { LlmClient } from '../lib/llm.js';
import { makeError, statusFromErrors } from '../lib/error-reporter.js';
import { stableStringify } from '../lib/json.js';
import { projectRoot } from '../lib/paths.js';

export const meta = {
  id: 'write-output',
  version: '0.1.0',
  input: ['finalDocument'],
  output: ['outputPath']
};

function slugPart(value) {
  return String(value || 'unknown')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
    .toLowerCase();
}

function applyTemplate(template, values, counter) {
  return template.replaceAll('{createdAtDate}', values.createdAtDate || 'unknown-date')
    .replaceAll('{counter}', String(counter).padStart(3, '0'))
    .replaceAll(/\{([a-zA-Z0-9_.-]+)\}/g, (_, key) => slugPart(values[key]));
}

export async function run(context) {
  const outputDir = context.paths.output;
  await fs.mkdir(outputDir, { recursive: true });

  const doc = context.artifacts.finalDocument;
  const naming = context.artifacts.selectedDocType?.crmNaming || { template: '{docType}_{createdAtDate}_{counter}' };
  const values = {
    docType: doc.docType,
    createdAtDate: new Date().toISOString().slice(0, 10),
    ...(doc.fields || {}),
    ...(doc.crm || {})
  };

  const fileName = `${applyTemplate(naming.template, values, context.counters.output)}${path.extname(context.document.name) ? '.json' : '.json'}`;
  const outputPath = path.join(outputDir, fileName);
  await fs.writeFile(outputPath, stableStringify(doc));

  return {
    ok: true,
    artifacts: { outputPath }
  };
}
