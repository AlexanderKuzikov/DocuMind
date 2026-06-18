import fs from 'node:fs/promises';
import { resolveConfigPath } from './lib/config.js';

function render(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => {
    return text.replaceAll(`{{${key}}}`, String(value));
  }, template);
}

function formatField(field) {
  const required = field.required ? 'required' : 'optional';
  const validation = field.validation ? `, validation=${field.validation}` : '';
  const hint = field.extractionHint ? ` — ${field.extractionHint}` : '';
  return `- ${field.id} — ${field.label}, ${field.type}, ${required}${validation}${hint}`;
}

function formatValidationRule(rule) {
  if (typeof rule === 'string') return `- ${rule}`;
  return `- ${rule.id || rule.field || 'rule'}: ${rule.message || rule.description || JSON.stringify(rule)}`;
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

export function buildSecondPassFields(docTypes) {
  return docTypes
    .map((docType) => {
      const fields = (docType.secondPassFields || []).map(formatField).join('\n');
      return `${docType.type}:\n${fields || '— не заданы'}`;
    })
    .join('\n\n');
}

export function buildOnePassFields(docTypes) {
  return docTypes
    .map((docType) => {
      const fields = (docType.fields || docType.firstPassFields || []).map(formatField).join('\n');
      return `${docType.type}:\n${fields}`;
    })
    .join('\n\n');
}

export function buildValidationRules(docTypes) {
  return docTypes
    .map((docType) => {
      const rules = Array.isArray(docType.validationRules)
        ? docType.validationRules.map(formatValidationRule).join('\n')
        : `— не заданы`;
      return `${docType.type}:\n${rules}`;
    })
    .join('\n\n');
}

export async function buildOnePassPrompt(config, docTypes) {
  const template = await readTemplate(config, 'one-pass');
  return render(template, {
    typesList: buildTypesList(docTypes),
    recognitionFeatures: buildRecognitionFeatures(docTypes),
    onePassFields: buildOnePassFields(docTypes),
    allowedDocTypes: docTypes.map((docType) => docType.type).concat(['unknown']).join(' | ')
  });
}

export async function buildUniversalPrompt(config, docTypes) {
  if (config.extraction?.mode === 'one-pass') {
    return buildOnePassPrompt(config, docTypes);
  }

  const template = await readTemplate(config, 'universal');
  return render(template, {
    typesList: buildTypesList(docTypes),
    recognitionFeatures: buildRecognitionFeatures(docTypes),
    firstPassFields: buildFirstPassFields(docTypes),
    allowedDocTypes: docTypes.map((docType) => docType.type).concat(['unknown']).join(' | ')
  });
}

export async function buildSpecificPrompt(config, docType, previousResult) {
  const template = await readTemplate(config, 'specific');
  return render(template, {
    docType: docType.type,
    docTypeName: docType.name,
    previousResult: JSON.stringify(previousResult, null, 2),
    secondPassFields: buildSecondPassFields([docType]),
    validationRules: buildValidationRules([docType])
  });
}

export async function buildUnknownPrompt(config, previousResult) {
  const template = await readTemplate(config, 'generic-unknown');
  return render(template, {
    previousResult: JSON.stringify(previousResult, null, 2)
  });
}
