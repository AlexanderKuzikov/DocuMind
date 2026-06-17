import { makeError } from '../lib/error-reporter.js';

export const meta = {
  id: 'normalize-fields',
  version: '0.1.0',
  input: ['firstPassResult', 'rawExtracted'],
  output: ['finalDocument']
};

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return text;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeDigits(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\D/g, '');
}

function normalizePhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('7') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return value;
}

function normalizeField(field, value) {
  if (value === undefined) return null;
  let result = value;
  for (const rule of field.normalization || []) {
    if (rule === 'uppercase') result = String(result).toLocaleUpperCase('ru-RU');
    if (rule === 'lowercase') result = String(result).toLocaleLowerCase('ru-RU');
    if (rule === 'trim') result = String(result).trim();
    if (rule === 'digits-only') result = normalizeDigits(result);
    if (rule === 'phone') result = normalizePhone(result);
    if (rule.startsWith('length:')) {
      const lengthSpec = rule.split(':')[1];
      const allowedLengths = lengthSpec.split('|').map((item) => Number(item.trim())).filter(Number.isFinite);
      if (allowedLengths.length > 1) {
        const text = String(result);
        result = allowedLengths.includes(text.length) ? text : text.slice(0, Math.max(...allowedLengths));
      } else {
        const length = Number(lengthSpec);
        result = String(result).slice(0, length);
      }
    }
  }
  if (field.type === 'date') result = normalizeDate(result);
  if (field.type === 'array' && result !== null && result !== undefined && !Array.isArray(result)) result = [result];
  return result;
}

function collectFields(raw, target = {}) {
  if (!raw || typeof raw !== 'object') return target;
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      collectFields(value, target);
    } else {
      target[key] = value;
    }
    target[key] = value;
  }
  return target;
}

export async function run(context) {
  const firstPass = context.artifacts.firstPassResult || {};
  const rawExtracted = context.artifacts.rawExtracted || {};
  const docType = firstPass.docType || rawExtracted.docTypeGuess || 'unknown';
  const docTypeConfig = context.docTypes.find((item) => item.type === docType) || null;

  const fields = collectFields(rawExtracted, {});
  for (const field of docTypeConfig?.firstPassFields || []) {
    if (firstPass.fields?.[field.id] !== undefined) {
      fields[field.id] = normalizeField(field, firstPass.fields[field.id]);
    }
  }

  const errors = [];
  for (const field of docTypeConfig?.firstPassFields || []) {
    if (field.required && (fields[field.id] === undefined || fields[field.id] === null || fields[field.id] === '')) {
      errors.push(makeError('REQUIRED_FIELD_MISSING', `Required field is missing: ${field.id}`, meta.id, {
        recoverable: true,
        suggestions: ['repeat extraction', 'check source image quality', 'review debug prompts/responses']
      }));
    }
  }

  const finalDocument = {
    docId: context.document.id,
    docType,
    docTypeName: docTypeConfig?.name || 'Unknown document type',
    status: errors.length ? 'partial' : 'ok',
    source: {
      inputPath: context.document.path,
      imagePath: context.artifacts.image?.path || null
    },
    firstPass,
    rawExtracted,
    fields,
    validation: {
      ok: errors.length === 0,
      errors
    },
    crm: {
      documentType: docType,
      documentNumber: fields.document_number || fields.number || (fields.series && fields.number ? `${fields.series}${fields.number}` : null) || fields.invoice_number || fields.record_number || null,
      documentDate: fields.document_date || fields.accident_date || fields.invoice_date || fields.marriage_date || fields.birth_date || null
    },
    createdAt: new Date().toISOString()
  };

  return {
    ok: true,
    artifacts: { finalDocument }
  };
}
