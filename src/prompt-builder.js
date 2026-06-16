import fs from 'node:fs/promises';
import { resolveConfigPath } from './lib/config.js';

function render(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => {
    return text.replaceAll(`{{${key}}}`, value);
  }, template);
}

function formatField(field) {
  const required = field.required ? 'required' : 'optional';
  const validation = field.validation ? `, validation=${field.validation}` : '';
  return `- ${field.id} — ${field.label}, ${field.type}, ${required}${validation}`;
}

export async function readTemplate(config, name) {
  const templatePath = resolveConfigPath(config, `./prompts/templates/${name}.md`);
  return fs.readFile(templatePath, 'utf8');
}

export function buildTypesList(docTypes) {
  return docTypes
    .map((docType) => {
      const aliases = docType.aliases?.length ? `; aliases: ${docType.aliases.join(', ')}` : '';
      return `- ${docType.type} — ${docType.name}${aliases}`;
    })
    .join('\n');
}

export function buildRecognitionFeatures(docTypes) {
  return docTypes
    .map((docType) => {
      const features = (docType.recognitionFeatures || []).map((feature) => `  - ${feature}`).join('\n');
      return `${docType.type} — ${docType.name}\n${features}`;
    })
    .join('\n\n');
}

export function buildFirstPassFields(docTypes) {
  return docTypes
    .map((docType) => {
      const fields = (docType.firstPassFields || []).map(formatField).join('\n');
      return `${docType.type}:\n${fields}`;
    })
    .join('\n\n');
}

export async function buildUniversalPrompt(config, docTypes) {
  const template = await readTemplate(config, 'universal');
  return render(template, {
    typesList: buildTypesList(docTypes),
    recognitionFeatures: buildRecognitionFeatures(docTypes),
    firstPassFields: buildFirstPassFields(docTypes)
  });
}

export async function buildSpecificPrompt(config, docType, previousResult) {
  const template = await readTemplate(config, 'specific');
  return render(template, {
    docType: docType.type,
    docTypeName: docType.name,
    previousResult: JSON.stringify(previousResult, null, 2)
  });
}

export async function buildUnknownPrompt(config, previousResult) {
  const template = await readTemplate(config, 'generic-unknown');
  return render(template, {
    previousResult: JSON.stringify(previousResult, null, 2)
  });
}
